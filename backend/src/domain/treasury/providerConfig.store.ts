/**
 * Provider credentials store — lets the Treasury UI supply the provider /
 * global-server / C2M credentials at runtime.
 *
 * Precedence: a value typed in the UI (stored here) OVERRIDES the same
 * environment variable; anything never entered in the UI falls back to
 * process.env. Secrets are encrypted at rest (AES-256-GCM) and the API only
 * ever returns a masked fingerprint, never the plaintext.
 */
import crypto from 'crypto';
import { db } from '../../config/db';

export const PROVIDER_CONFIG_KEYS = [
  'PROVIDER_ENDPOINT_URL',
  'PROVIDER_API_KEY',
  'PROVIDER_SECRET_KEY',
  'PROVIDER_AUTH_SCHEME',
  'PROVIDER_SIGNATURE_ALGORITHM',
  'PROVIDER_TIMEOUT_MS',
  'GLOBAL_SERVER_URL',
  'GLOBAL_API_KEY',
  'GLOBAL_API_SECRET',
  'CUSTOMER_WALLET_PROVIDER_URL',
  'CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS',
] as const;

export type ProviderConfigKey = (typeof PROVIDER_CONFIG_KEYS)[number];

const KEY_SET = new Set<string>(PROVIDER_CONFIG_KEYS);

/** Keys whose values must be encrypted at rest and masked in responses. */
const SECRET_KEYS = new Set<string>([
  'PROVIDER_API_KEY',
  'PROVIDER_SECRET_KEY',
  'GLOBAL_API_KEY',
  'GLOBAL_API_SECRET',
]);

interface ConfigRow {
  key: string;
  value: string;
  encrypted: number;
  updated_at: string;
  updated_by: string | null;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )
  `);
  ensured = true;
}

function encKey(): Buffer {
  const secret =
    process.env.PAN_ENCRYPTION_SECRET ||
    'pos-2013-local-pan-encryption-key-change-in-prod-32byte';
  return crypto.createHash('sha256').update(`provider-config:${secret}`).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function fingerprint(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function readRows(): Promise<ConfigRow[]> {
  await ensureTable();
  const res = await db.query(`SELECT key, value, encrypted, updated_at, updated_by FROM provider_config`);
  return (res.rows || []) as ConfigRow[];
}

function decodeRow(row: ConfigRow): string {
  if (!row.encrypted) return row.value;
  try {
    return decrypt(row.value);
  } catch {
    return '';
  }
}

/**
 * Copy the stored values into process.env so the existing provider clients
 * (which read process.env) pick them up without any further changes. UI values
 * win over whatever the environment already had.
 */
export async function applyProviderConfigToEnv(): Promise<void> {
  const rows = await readRows();
  for (const row of rows) {
    if (!KEY_SET.has(row.key)) continue;
    const value = decodeRow(row);
    if (value) process.env[row.key] = value;
  }
}

export interface ConfigItem {
  key: string;
  isSecret: boolean;
  source: 'ui' | 'env' | 'unset';
  /** Plaintext for non-secrets; masked fingerprint for secrets. */
  displayValue: string | null;
}

export async function describeProviderConfig(): Promise<ConfigItem[]> {
  const rows = await readRows();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return PROVIDER_CONFIG_KEYS.map((key) => {
    const isSecret = SECRET_KEYS.has(key);
    const row = byKey.get(key);
    if (row) {
      const value = decodeRow(row);
      return {
        key,
        isSecret,
        source: 'ui' as const,
        displayValue: value ? (isSecret ? fingerprint(value) : value) : null,
      };
    }
    const envValue = String(process.env[key] || '');
    if (envValue) {
      return {
        key,
        isSecret,
        source: 'env' as const,
        displayValue: isSecret ? fingerprint(envValue) : envValue,
      };
    }
    return { key, isSecret, source: 'unset' as const, displayValue: null };
  });
}

/**
 * Save UI-supplied credentials. Only keys present in `values` are touched:
 *   · a non-empty string is stored (encrypted when it is a secret)
 *   · an empty string clears the stored value, falling back to the env var
 */
export async function saveProviderConfig(
  values: Record<string, unknown>,
  updatedBy: string,
): Promise<{ saved: string[]; cleared: string[]; ignored: string[] }> {
  await ensureTable();
  const saved: string[] = [];
  const cleared: string[] = [];
  const ignored: string[] = [];
  const now = new Date().toISOString();

  for (const [key, raw] of Object.entries(values || {})) {
    if (!KEY_SET.has(key)) {
      ignored.push(key);
      continue;
    }
    const value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!value) {
      await db.query(`DELETE FROM provider_config WHERE key = ?`, [key]);
      cleared.push(key);
      continue;
    }
    const isSecret = SECRET_KEYS.has(key);
    await db.query(
      `INSERT OR REPLACE INTO provider_config (key, value, encrypted, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [key, isSecret ? encrypt(value) : value, isSecret ? 1 : 0, now, updatedBy],
    );
    saved.push(key);
  }

  await applyProviderConfigToEnv();
  return { saved, cleared, ignored };
}
