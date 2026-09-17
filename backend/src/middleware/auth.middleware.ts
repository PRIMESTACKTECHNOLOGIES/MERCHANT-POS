import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { SECRET_KEY } from "../domain/auth/auth.service";

/**
 * Extract a valid JWT token from the incoming request.
 * Supports 3 locations (checked in order):
 *   1. Standard header:      Authorization: Bearer <token>
 *   2. RFC 6750 query param:  ?access_token=<token>   (for browser new tabs, iframes,
 *      thermal printer HTTP drivers, POS kiosk embeds, and any direct <a href> links
 *      that cannot send custom HTTP headers. Print dialogs in particular cannot
 *      attach Authorization headers when opening a raw URL.)
 *   3. Cookie:                cookies.auth_token / token
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers?.authorization;
  if (authHeader) {
    const parts = String(authHeader).split(' ');
    if (parts.length >= 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) return parts[1].trim();
    if (parts.length === 1 && parts[0].trim().length > 32) return parts[0].trim();
  }
  const q: any = req.query || {};
  if (q.access_token && typeof q.access_token === 'string' && q.access_token.trim().length > 32) {
    return q.access_token.trim();
  }
  if (q.token && typeof q.token === 'string' && q.token.trim().length > 32) {
    return q.token.trim();
  }
  const hdr: any = req.headers || {};
  if (hdr['x-auth-token'] && typeof hdr['x-auth-token'] === 'string') return hdr['x-auth-token'].trim();
  if (hdr['x-access-token'] && typeof hdr['x-access-token'] === 'string') return hdr['x-access-token'].trim();
  const ckRaw: any = (hdr.cookie && typeof hdr.cookie === 'string') ? hdr.cookie : '';
  if (ckRaw) {
    for (const piece of String(ckRaw).split(/; */)) {
      const [k, v] = piece.split('=');
      if ((k === 'auth_token' || k === 'token' || k === 'jwt') && v) {
        try { return decodeURIComponent(v).trim(); } catch (_) { return v.trim(); }
      }
    }
  }
  return null;
}

function isValidApiKey(req: Request): boolean {
  const configuredKeys = String(process.env.API_KEYS || process.env.API_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (configuredKeys.length === 0) return false;

  const headerKey = req.headers['x-api-key'];
  const authorization = req.headers.authorization;
  const providedKey = typeof headerKey === 'string'
    ? headerKey.trim()
    : authorization && authorization.toLowerCase().startsWith('apikey ')
      ? authorization.slice(7).trim()
      : '';

  return providedKey.length > 0 && configuredKeys.includes(providedKey);
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  if (isValidApiKey(req)) {
    (req as any).auth = { type: 'api_key' };
    return next();
  }

  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }

  jwt.verify(token, SECRET_KEY as string, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
    (req as any).user = user;
    next();
  });
};
