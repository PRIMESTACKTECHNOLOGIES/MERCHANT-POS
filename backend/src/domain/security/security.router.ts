import express, { Request, Response } from 'express';
import { securityService } from './security.service';
import { authenticateToken } from '../../middleware/auth.middleware';
import { db } from '../../config/db';

/**
 * CLIENT INTRUSION REPORTING
 *
 * Receives "someone tried to inspect / copy / save our frontend" signals from the
 * browser guard (client/src/lib/security-guard.ts) and writes them to
 * security_audit_log via SecurityService.
 *
 * This endpoint is intentionally UNAUTHENTICATED: the whole point is to record
 * anonymous probing, and an attacker probing the bundle does not hold a JWT.
 * Abuse is bounded by a per-IP in-memory rate limit + a strict event whitelist.
 */

export const securityEventRouter = express.Router();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; resetAt: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

// Only events the guard is known to emit — anything else is rejected.
const ALLOWED_EVENTS = new Set([
  'CLIENT_RIGHT_CLICK',
  'CLIENT_DEVTOOLS_ATTEMPT',
  'CLIENT_DEVTOOLS_OPEN',
  'CLIENT_SOURCE_VIEW_ATTEMPT',
  'CLIENT_SAVE_PAGE_ATTEMPT',
  'CLIENT_IMAGE_DRAG',
]);

function clip(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

securityEventRouter.post('/client-event', async (req: Request, res: Response) => {
  try {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    if (!allow(ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    const body = req.body ?? {};
    const event = String(body.event ?? '').toUpperCase();
    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ ok: false, error: 'unknown_event' });
    }

    await securityService.logSecurityEvent({
      event_type: event,
      severity: event === 'CLIENT_DEVTOOLS_OPEN' ? 'critical' : 'warning',
      ip_address: ip,
      user_agent: clip(req.headers['user-agent'], 400) ?? undefined,
      action: clip(body.detail, 300) || event,
      status: 'blocked',
      metadata: JSON.stringify({
        path: clip(body.path, 300),
        viewport: clip(body.viewport, 32),
        ts: clip(body.ts, 40),
      }),
    });

    console.warn(`[ClientSecurity] 🚨 ${event} | ip=${ip} | path=${clip(body.path, 120) ?? '-'}`);

    return res.json({ ok: true });
  } catch (err: any) {
    // Never leak internals and never break the client over a telemetry failure.
    console.error('[ClientSecurity] failed to record event:', err?.message);
    return res.json({ ok: false });
  }
});

/**
 * GET /api/security/client-events?limit=50
 * View who has been probing the frontend. JWT-protected (admin console).
 */
securityEventRouter.get('/client-events', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const result = await db.query(
      `SELECT id, event_type, severity, ip_address, user_agent, action, metadata, created_at
         FROM security_audit_log
        WHERE event_type LIKE 'CLIENT_%'
        ORDER BY created_at DESC
        LIMIT ?`,
      [limit]
    );
    return res.json({ ok: true, count: result.rowCount, events: result.rows });
  } catch (err: any) {
    console.error('[ClientSecurity] failed to read events:', err?.message);
    return res.status(500).json({ ok: false, error: 'query_failed' });
  }
});
