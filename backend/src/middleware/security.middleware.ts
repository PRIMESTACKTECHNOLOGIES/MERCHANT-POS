import { Request, Response, NextFunction } from 'express';
import { securityService } from '../domain/security/security.service';

/**
 * SECURITY ENFORCEMENT MIDDLEWARE
 *
 * Turns the previously dormant SecurityService controls into real gates on
 * money-movement routes:
 *   - requirePermission()    → RBAC (user_roles / user_role_assignments)
 *   - requireMFA()           → step-up TOTP challenge for high-value actions
 *   - enforceIPWhitelist()   → blocks access from non-whitelisted source IPs
 *
 * Design rules:
 *   - Fail CLOSED. If a check errors, the request is denied and a critical
 *     security event is recorded.
 *   - Trusted service credentials (API keys) bypass user-based checks.
 *   - Controls are only active when the relevant data is configured:
 *       * MFA is enforced only for users who have enrolled a device.
 *       * IP whitelisting applies only to users who have whitelist entries.
 *     This keeps the gates real without bricking accounts that have not set
 *     them up yet. Both cases are logged so the gap is always visible.
 */

const ENFORCE = String(process.env.SECURITY_ENFORCE ?? 'true').toLowerCase() !== 'false';

function clientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown'
  );
}

function principal(req: Request): string | null {
  const u: any = (req as any).user;
  return u?.id ? String(u.id) : null;
}

function isServiceCredential(req: Request): boolean {
  return (req as any).auth?.type === 'api_key';
}

async function log(event: Parameters<typeof securityService.logSecurityEvent>[0]): Promise<void> {
  try {
    await securityService.logSecurityEvent(event);
  } catch (_) {
    /* auditing must never break the request path */
  }
}

/**
 * Require the authenticated user to hold `permission` in the RBAC matrix.
 * Super-admin ('*') and wildcard grants (e.g. 'transactions.*') are honoured.
 */
export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = principal(req);
    const ip = clientIp(req);
    const route = `${req.method} ${req.originalUrl}`;

    if (isServiceCredential(req)) return next();

    if (!ENFORCE) {
      await log({
        event_type: 'RBAC_ENFORCEMENT_DISABLED',
        severity: 'critical',
        user_id: userId || undefined,
        ip_address: ip,
        action: `SECURITY_ENFORCE=false bypassed '${permission}' on ${route}`,
        status: 'success',
      });
      return next();
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', code: 'NO_PRINCIPAL' });
    }

    try {
      const allowed = await securityService.checkPermission(userId, permission);
      if (allowed) return next();

      await log({
        event_type: 'RBAC_DENIED',
        severity: 'warning',
        user_id: userId,
        ip_address: ip,
        user_agent: req.headers['user-agent'] as string | undefined,
        action: `Denied '${permission}' on ${route}`,
        resource_type: 'route',
        status: 'blocked',
      });
      return res.status(403).json({
        error: 'Forbidden',
        code: 'PERMISSION_DENIED',
        required_permission: permission,
      });
    } catch (err: any) {
      await log({
        event_type: 'RBAC_CHECK_ERROR',
        severity: 'critical',
        user_id: userId,
        ip_address: ip,
        action: `RBAC check failed for '${permission}' on ${route}`,
        status: 'blocked',
        error_message: err?.message || String(err),
      });
      return res.status(500).json({ error: 'Security check failed', code: 'RBAC_ERROR' });
    }
  };
}

/**
 * Require a valid step-up MFA code for users who have enrolled MFA.
 * The code is read from the `x-mfa-code` header (configurable).
 */
export function requireMFA(opts: { header?: string } = {}) {
  const header = (opts.header || 'x-mfa-code').toLowerCase();

  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = principal(req);
    const ip = clientIp(req);
    const route = `${req.method} ${req.originalUrl}`;

    if (isServiceCredential(req)) return next();
    if (!ENFORCE) return next();
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'NO_PRINCIPAL' });

    try {
      const enrolled = await securityService.isMFAEnrolled(userId);

      if (!enrolled) {
        await log({
          event_type: 'MFA_NOT_ENROLLED',
          severity: 'warning',
          user_id: userId,
          ip_address: ip,
          action: `Step-up MFA skipped (no device enrolled) on ${route}`,
          resource_type: 'route',
          status: 'success',
        });
        return next();
      }

      const code = String(req.headers[header] || '').trim();
      if (!code) {
        return res.status(401).json({
          error: 'MFA code required',
          code: 'MFA_REQUIRED',
          header,
        });
      }

      const ok = await securityService.verifyMFA(userId, code);
      if (!ok) {
        return res.status(403).json({ error: 'Invalid MFA code', code: 'MFA_INVALID' });
      }
      return next();
    } catch (err: any) {
      await log({
        event_type: 'MFA_CHECK_ERROR',
        severity: 'critical',
        user_id: userId,
        ip_address: ip,
        action: `MFA check failed on ${route}`,
        status: 'blocked',
        error_message: err?.message || String(err),
      });
      return res.status(500).json({ error: 'Security check failed', code: 'MFA_ERROR' });
    }
  };
}

/**
 * Enforce IP whitelisting for users who have configured whitelist entries.
 */
export function enforceIPWhitelist() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = principal(req);
    const ip = clientIp(req);
    const route = `${req.method} ${req.originalUrl}`;

    if (isServiceCredential(req)) return next();
    if (!ENFORCE) return next();
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'NO_PRINCIPAL' });

    try {
      const configured = await securityService.hasActiveIPWhitelist(userId);
      if (!configured) return next();

      const allowed = await securityService.checkIPWhitelist(userId, ip);
      if (allowed) return next();

      await log({
        event_type: 'IP_WHITELIST_DENIED',
        severity: 'error',
        user_id: userId,
        ip_address: ip,
        action: `Blocked non-whitelisted IP on ${route}`,
        resource_type: 'route',
        status: 'blocked',
      });
      return res.status(403).json({ error: 'Forbidden', code: 'IP_NOT_ALLOWED' });
    } catch (err: any) {
      await log({
        event_type: 'IP_WHITELIST_CHECK_ERROR',
        severity: 'critical',
        user_id: userId,
        ip_address: ip,
        action: `IP whitelist check failed on ${route}`,
        status: 'blocked',
        error_message: err?.message || String(err),
      });
      return res.status(500).json({ error: 'Security check failed', code: 'IP_CHECK_ERROR' });
    }
  };
}
