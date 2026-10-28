import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { securityService } from '../domain/security/security.service';

/**
 * SECURITY SHIELD — server-side blocking for probes, scrapers and brute force.
 *
 * HONEST SCOPE — what this can and cannot do:
 *   CAN: ban the IP behind a probe/scanner/brute-force pattern, refuse to serve
 *        source maps and secrets-shaped files, rate-limit bulk bundle harvesting,
 *        and send browser security headers (CSP etc.) so injected code cannot
 *        phone home. These are real blocks — the request never reaches the app.
 *   CANNOT: stop a determined attacker from reading the JS bundle. Every file the
 *        browser renders is already on their machine. Real code protection lives
 *        in the server (JWT secrets, HMAC, no sourcemaps) — not in this file.
 *
 * Every limit is env-tunable so a false positive never requires a code change:
 *   SECURITY_SHIELD=off            kill switch (all checks below are skipped)
 *   SECURITY_BAN_MS                1st ban duration            (default 30 min)
 *   SECURITY_BAN_STRIKES           strikes before a ban        (default 3)
 *   SECURITY_STRIKE_WINDOW_MS      strike accumulation window  (default 10 min)
 *   SECURITY_STRIKE_COOLDOWN_MS    per-reason strike cooldown  (default 2 min)
 *   SECURITY_RATE_WINDOW_MS        rate-limit window           (default 60s)
 *   SECURITY_API_RATE_MAX          requests/window for pages+API (default 1200)
 *   SECURITY_ASSET_RATE_MAX        requests/window for js/css/images (default 1500)
 *   SECURITY_RATE_STRIKE_MULT      window overflow that earns a strike (default 10)
 *   SECURITY_CSP                   full Content-Security-Policy override
 *   SECURITY_NO_CSP=1              send no CSP at all
 */

// ── Configuration ────────────────────────────────────────────────────────────

const SHIELD_OFF = ['off', '0', 'false', 'no'].includes(
  String(process.env.SECURITY_SHIELD || '').trim().toLowerCase(),
);

function numEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const BAN_MS = numEnv('SECURITY_BAN_MS', 30 * 60 * 1000);
const BAN_STRIKES = numEnv('SECURITY_BAN_STRIKES', 3);
const STRIKE_WINDOW_MS = numEnv('SECURITY_STRIKE_WINDOW_MS', 10 * 60 * 1000);
const STRIKE_COOLDOWN_MS = numEnv('SECURITY_STRIKE_COOLDOWN_MS', 2 * 60 * 1000);
const RATE_WINDOW_MS = numEnv('SECURITY_RATE_WINDOW_MS', 60_000);
const API_RATE_MAX = numEnv('SECURITY_API_RATE_MAX', 1200);
const ASSET_RATE_MAX = numEnv('SECURITY_ASSET_RATE_MAX', 1500);
const RATE_STRIKE_MULT = numEnv('SECURITY_RATE_STRIKE_MULT', 10);
const MAX_BAN_MS = 24 * 60 * 60 * 1000;

// ── State (in-memory hot path, mirrored to security_ip_bans best-effort) ─────

interface BanRecord {
  ip: string;
  reason: string;
  strikes: number;
  bannedAt: number;
  expiresAt: number;
  hits: number;
}

interface StrikeRecord {
  points: number;
  windowStart: number;
  lastByReason: Map<string, number>;
}

const bans = new Map<string, BanRecord>();
const strikes = new Map<string, StrikeRecord>();
const banCounts = new Map<string, number>();
const buckets = new Map<string, { count: number; resetAt: number }>();

let bansLoaded = false;

/** Behind Render/Netlify the socket address is the proxy — use the forwarded client IP. */
export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0];
  const raw =
    (first && first.trim()) ||
    String(req.headers['x-real-ip'] || '').trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';
  const ip = String(raw).replace(/^::ffff:/, '').trim();
  return ip || 'unknown';
}

/**
 * Paths that must never be throttled or banned: payment webhooks arrive from
 * partner infrastructure on shared IPs, health checks come from the platform,
 * and the client intrusion telemetry must survive so a banned IP is still
 * recorded (its own endpoint rate-limits abuse separately).
 */
function isExemptPath(pathname: string): boolean {
  if (pathname === '/health' || pathname === '/api/health') return true;
  if (pathname.startsWith('/webhooks')) return true;
  if (pathname.startsWith('/api/vault/gateways')) return true;
  if (pathname.startsWith('/api/vault-bank')) return true;
  if (pathname.startsWith('/api/dwolla')) return true;
  if (pathname.startsWith('/api/security')) return true;
  return false;
}

const ASSET_RE = /\.(?:js|mjs|cjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|bmp|mp4|webm|wasm|json|txt|pdf|xml)$/i;

/**
 * Requests a browser never makes. Any hit is an automated probe:
 * secrets-shaped files, source maps, VCS/dot directories and CMS/panel scanners.
 * `.well-known` is exempt because ACME/DNS proofs legitimately live there.
 */
const PROBE_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /(?:^|\/)\.(?:env|git|svn|hg|aws|ssh|npmrc|htaccess|htpasswd|ds_store|docker|terraform|bash_history|netrc|pgpass)(?:$|\/|\.)/i, label: 'dotfile/dot-directory probe' },
  { re: /\.(?:env|bak|old|orig|save|swp|sql|sqlite|sqlite3|db|log|ini|pem|key|p12|pfx|jks|lock|map|ts|tsx)$/i, label: 'sensitive file extension probe' },
  { re: /(?:^|\/)(?:package|package-lock|composer|tsconfig|nuxt|angular|vite|webpack)\.(?:json|lock|js|ts)$/i, label: 'build manifest probe' },
  { re: /(?:^|\/)(?:wp-admin|wp-login\.php|wp-content|wp-includes|wp-json|xmlrpc\.php|phpmyadmin|pma|adminer\.php|administrator|joomla|drupal|typo3)(?:$|\/|\?)/i, label: 'CMS probe' },
  { re: /(?:^|\/)(?:cgi-bin|server-status|server-info|actuator|phpinfo\.php|info\.php|trace\.axd|elmah\.axd|solr|jenkins|zabbix|grafana|druid|telescope|_ignition|_debugbar|vendor\/phpunit|\.well-known\/\.\.)(?:$|\/|\?)/i, label: 'server/panel probe' },
  { re: /(?:^|\/)(?:id_rsa|id_dsa|credentials|secrets|dump\.sql|backup\.(?:sql|zip|tar|gz)|docker-compose\.ya?ml|web\.config|cli\.config)(?:$|\/|\?)/i, label: 'secret file probe' },
];

function isProbePath(pathname: string): string | null {
  if (pathname.startsWith('/.well-known/')) return null;
  for (const rule of PROBE_RULES) {
    if (rule.re.test(pathname)) return rule.label;
  }
  return null;
}

function decodePath(req: Request): string {
  const raw = (req.originalUrl || req.url || '/').split('?')[0];
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

// ── Ban bookkeeping ──────────────────────────────────────────────────────────

const DB_BANS_TABLE = 'security_ip_bans';

async function loadBansFromDb(): Promise<void> {
  if (bansLoaded) return;
  bansLoaded = true;
  try {
    const nowIso = new Date().toISOString();
    await db.query(`DELETE FROM ${DB_BANS_TABLE} WHERE expires_at <= ?`, [nowIso]);
    const rows = (await db.query(
      `SELECT ip_address, reason, strikes, hits, banned_at, expires_at FROM ${DB_BANS_TABLE} WHERE expires_at > ?`,
      [nowIso],
    )).rows as any[];
    for (const r of rows) {
      const expiresAt = Date.parse(String(r.expires_at));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
      bans.set(String(r.ip_address), {
        ip: String(r.ip_address),
        reason: String(r.reason || 'security policy'),
        strikes: Number(r.strikes) || BAN_STRIKES,
        bannedAt: Date.parse(String(r.banned_at)) || Date.now(),
        expiresAt,
        hits: Number(r.hits) || 0,
      });
    }
    if (rows.length) console.warn(`[SecurityShield] restored ${rows.length} active IP ban(s)`);
  } catch {
    // Missing table (older DB) or unavailable DB — in-memory bans still work.
  }
}

function persistBan(ban: BanRecord): void {
  const id = uuidv4();
  db.query(
    `INSERT INTO ${DB_BANS_TABLE} (id, ip_address, reason, strikes, hits, banned_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ban.ip, ban.reason, ban.strikes, ban.hits, new Date(ban.bannedAt).toISOString(), new Date(ban.expiresAt).toISOString()],
  ).catch(() => {});
}

function persistUnban(ip: string, reason: string): void {
  db.query(`DELETE FROM ${DB_BANS_TABLE} WHERE ip_address = ?`, [ip]).catch(() => {});
  securityService
    .logSecurityEvent({
      event_type: 'IP_UNBANNED',
      severity: 'info',
      ip_address: ip,
      action: `Ban lifted (${reason})`,
      status: 'success',
    })
    .catch(() => {});
}

/**
 * Ban an IP and record it. `escalate` doubles the duration on repeat offences so
 * a returning scanner is locked out for longer each time.
 */
export function banIp(ip: string, reason: string, strikePoints = BAN_STRIKES): BanRecord {
  const previous = banCounts.get(ip) || 0;
  const duration = Math.min(BAN_MS * Math.pow(2, Math.min(previous, 4)), MAX_BAN_MS);
  banCounts.set(ip, previous + 1);

  const ban: BanRecord = {
    ip,
    reason,
    strikes: strikePoints,
    bannedAt: Date.now(),
    expiresAt: Date.now() + duration,
    hits: 0,
  };
  bans.set(ip, ban);
  strikes.delete(ip);
  persistBan(ban);

  console.warn(
    `[SecurityShield] BANNED ${ip} for ${Math.round(duration / 1000)}s — ${reason}`,
  );

  securityService
    .logSecurityEvent({
      event_type: 'IP_BANNED',
      severity: 'critical',
      ip_address: ip,
      action: `Blocked: ${reason}`,
      status: 'blocked',
      metadata: JSON.stringify({ strikes, duration_ms: duration }),
    })
    .catch(() => {});

  securityService
    .createSecurityAlert({
      alert_type: 'ip_auto_banned',
      severity: 'high',
      title: 'Intrusion attempt blocked',
      message: `${ip} was blocked for ${Math.round(duration / 60000)} min (${reason})`,
      alert_data: JSON.stringify({ ip, reason, strikes, duration_ms: duration }),
    })
    .catch(() => {});

  return ban;
}

export function unbanIp(ip: string, reason = 'manual'): boolean {
  const existed = bans.delete(ip) || strikes.delete(ip);
  banCounts.delete(ip);
  if (existed) persistUnban(ip, reason);
  return existed;
}

export interface ActiveBan {
  ip: string;
  reason: string;
  strikes: number;
  hits: number;
  bannedAt: string;
  expiresAt: string;
  remainingMs: number;
}

export function listActiveBans(): ActiveBan[] {
  const now = Date.now();
  const out: ActiveBan[] = [];
  for (const [ip, ban] of bans) {
    if (ban.expiresAt <= now) { bans.delete(ip); continue; }
    out.push({
      ip,
      reason: ban.reason,
      strikes: ban.strikes,
      hits: ban.hits,
      bannedAt: new Date(ban.bannedAt).toISOString(),
      expiresAt: new Date(ban.expiresAt).toISOString(),
      remainingMs: ban.expiresAt - now,
    });
  }
  return out.sort((a, b) => b.remainingMs - a.remainingMs);
}

export function isBanned(ip: string): boolean {
  const ban = bans.get(ip);
  if (!ban) return false;
  if (ban.expiresAt <= Date.now()) { bans.delete(ip); return false; }
  return true;
}

/**
 * Add strike points for an IP; ban once the threshold inside the window is hit.
 * `cooldownMs` collapses repeated identical signals (e.g. a held Ctrl+U key
 * firing the client report every 1.5s) into one strike.
 */
export function recordStrike(
  ip: string,
  reason: string,
  options: { weight?: number; cooldownMs?: number } = {},
): BanRecord | null {
  const weight = options.weight ?? 1;
  const cooldownMs = options.cooldownMs ?? 0;
  const now = Date.now();

  let rec = strikes.get(ip);
  if (!rec || now - rec.windowStart > STRIKE_WINDOW_MS) {
    rec = { points: 0, windowStart: now, lastByReason: new Map() };
    strikes.set(ip, rec);
  }

  if (cooldownMs > 0) {
    const last = rec.lastByReason.get(reason) || 0;
    if (now - last < cooldownMs) return null;
  }
  rec.lastByReason.set(reason, now);
  rec.points += weight;

  if (rec.points >= BAN_STRIKES) {
    return banIp(ip, `${reason} (${rec.points} strikes)`, rec.points);
  }
  return null;
}

// ── Header hardening ─────────────────────────────────────────────────────────

function buildCsp(): string {
  const override = String(process.env.SECURITY_CSP || '').trim();
  if (override) return override;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https:",
    // 'unsafe-inline' is required by the injected window.APP_CONFIG script and
    // React inline styles; the value here is blocking foreign script origins,
    // iframes and data exfiltration channels.
    "script-src 'self' 'unsafe-inline' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // API host, PSP widgets (Stripe/Transak/Dwolla) and websockets.
    "connect-src 'self' https: wss:",
    "frame-src 'self' https: blob:",
  ].join('; ');
}

const CSP = buildCsp();
const CSP_ENABLED = !['1', 'true', 'yes'].includes(String(process.env.SECURITY_NO_CSP || '').toLowerCase());
const HSTS_ENABLED = String(process.env.SECURITY_HSTS || '').toLowerCase() !== 'off';
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const HTML_LIKE_RE = /^\/(?!api\/|auth\/|merchant\/|wallet\/|webhooks\/)/;

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  try {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(self), clipboard-write=(self), usb=(self), serial=(self)',
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (HSTS_ENABLED && IS_PROD) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    }
    if (CSP_ENABLED && HTML_LIKE_RE.test(req.path || '/')) {
      res.setHeader('Content-Security-Policy', CSP);
    }
  } catch {
    // Headers must never break a response.
  }
  next();
}

// ── Enforcement ──────────────────────────────────────────────────────────────

const TRAVERSAL_RE = /(?:\.\.[\\/]|%2e%2e|%00|\/\.\.\/)/i;

export function scannerShield(req: Request, res: Response, next: NextFunction): void {
  if (SHIELD_OFF) return next();

  const rawUrl = req.originalUrl || req.url || '/';
  const pathname = decodePath(req);
  const ip = getClientIp(req);

  // Encoded traversal / null bytes — two strikes, never a legitimate request.
  if (TRAVERSAL_RE.test(rawUrl) || /%00/i.test(rawUrl)) {
    recordStrike(ip, 'path traversal attempt', { weight: 2 });
    securityService
      .logSecurityEvent({
        event_type: 'PATH_TRAVERSAL_BLOCKED',
        severity: 'critical',
        ip_address: ip,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || undefined,
        action: `Blocked ${req.method} ${rawUrl.slice(0, 200)}`,
        status: 'blocked',
      })
      .catch(() => {});
    res.status(400).json({ error: 'Bad request' });
    return;
  }

  // TRACE/TRACK are only used to fingerprint or cross-site-trace a server.
  if (req.method === 'TRACE' || req.method === 'TRACK') {
    recordStrike(ip, 'TRACE method');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const probe = isProbePath(pathname);
  if (probe) {
    const ban = recordStrike(ip, probe);
    securityService
      .logSecurityEvent({
        event_type: ban ? 'SCANNER_BANNED' : 'SCANNER_BLOCKED',
        severity: ban ? 'critical' : 'warning',
        ip_address: ip,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || undefined,
        action: `${probe}: ${req.method} ${pathname.slice(0, 200)}`,
        status: 'blocked',
        metadata: JSON.stringify({ path: pathname.slice(0, 300) }),
      })
      .catch(() => {});
    console.warn(`[SecurityShield] blocked ${probe} from ${ip}: ${pathname.slice(0, 120)}`);
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}

export function banGuard(req: Request, res: Response, next: NextFunction): void {
  if (SHIELD_OFF) return next();
  void loadBansFromDb();

  if (isExemptPath(req.path || '/')) return next();

  const ip = getClientIp(req);
  const ban = bans.get(ip);
  if (!ban) return next();

  if (ban.expiresAt <= Date.now()) {
    bans.delete(ip);
    return next();
  }

  ban.hits += 1;
  res.setHeader('Retry-After', String(Math.ceil((ban.expiresAt - Date.now()) / 1000)));
  res.status(403).json({ error: 'Access denied by security policy' });
}

export function rateShield(req: Request, res: Response, next: NextFunction): void {
  if (SHIELD_OFF) return next();
  if (isExemptPath(req.path || '/')) return next();

  const ip = getClientIp(req);
  const isAsset = ASSET_RE.test(req.path || '');
  const bucket = isAsset ? 'asset' : 'app';
  const limit = isAsset ? ASSET_RATE_MAX : API_RATE_MAX;
  const key = `${bucket}:${ip}`;
  const now = Date.now();

  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(key, entry);
  }
  entry.count += 1;

  if (entry.count > limit) {
    // A normal browser stays far below the limit; a scraper enumerating the
    // bundle does not. Only extreme overflow earns a strike, so a NAT'd store
    // with many terminals reloading at once is throttled, never banned.
    if (entry.count > limit * RATE_STRIKE_MULT) {
      recordStrike(ip, `${bucket} flood`);
    }
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  next();
}

/** Mount order: headers → ban → scanner → rate limit. */
export function securityShield() {
  return [securityHeaders, banGuard, scannerShield, rateShield];
}

// ── Housekeeping: keep the maps from growing forever ─────────────────────────

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, ban] of bans) if (ban.expiresAt <= now) bans.delete(ip);
  for (const [ip, rec] of strikes) if (now - rec.windowStart > STRIKE_WINDOW_MS) strikes.delete(ip);
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
}, 5 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();
