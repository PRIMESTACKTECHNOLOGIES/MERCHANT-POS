import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

/**
 * A Virtual Settlement Account (VSA) is the internal wallet ID a merchant gives
 * the acquirer in place of an IBAN, e.g. `VSA-PS-000001`. Settlements addressed
 * to a VSA are credited to the merchant's internal wallet.
 */
export interface VirtualSettlementAccount {
  id: string;
  vsa_id: string;
  merchant_id: string;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const VSA_PREFIX = 'VSA-PS-';
const VSA_SEQ_WIDTH = 6;
// 'VSA-PS-' is exactly 7 characters, so the sequence starts at index 8 (SQLite
// SUBSTR is 1-based).
const VSA_SEQ_OFFSET = VSA_PREFIX.length + 1;

let tablesEnsured = false;

async function ensureVsaTables(): Promise<void> {
  if (tablesEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS virtual_settlement_accounts (
      id TEXT PRIMARY KEY,
      vsa_id TEXT NOT NULL UNIQUE,
      merchant_id TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tablesEnsured = true;
}

function formatVsa(sequence: number): string {
  return `${VSA_PREFIX}${String(sequence).padStart(VSA_SEQ_WIDTH, '0')}`;
}

export function isValidVsaId(value: string): boolean {
  return new RegExp(`^${VSA_PREFIX}\\d{${VSA_SEQ_WIDTH}}$`).test(
    String(value || '').trim().toUpperCase(),
  );
}

export function normalizeVsaId(value: string): string {
  return String(value || '').trim().toUpperCase();
}

export async function lookupVsa(vsaId: string): Promise<VirtualSettlementAccount | null> {
  const key = normalizeVsaId(vsaId);
  if (!key) return null;
  await ensureVsaTables();
  const result = await db.query(
    `SELECT * FROM virtual_settlement_accounts WHERE vsa_id = ? LIMIT 1`,
    [key],
  );
  return (result.rows?.[0] as VirtualSettlementAccount) || null;
}

export async function lookupVsaByMerchant(merchantId: string): Promise<VirtualSettlementAccount | null> {
  const mid = String(merchantId || '').trim();
  if (!mid) return null;
  await ensureVsaTables();
  const result = await db.query(
    `SELECT * FROM virtual_settlement_accounts WHERE merchant_id = ? LIMIT 1`,
    [mid],
  );
  return (result.rows?.[0] as VirtualSettlementAccount) || null;
}

/**
 * Returns the merchant's Virtual Settlement Account, allocating the next
 * sequential `VSA-PS-######` ID on first use.
 *
 * Allocation deliberately avoids BEGIN/COMMIT: this database layer flushes the
 * whole database (db.export()) after every write, which ends an open
 * transaction, so a COMMIT would always fail. Uniqueness is instead guaranteed
 * by the `vsa_id` UNIQUE constraint — a losing race inserts nothing and retries
 * with the next sequence number.
 */
export async function getOrCreateVsa(merchantId: string, currency = 'USD'): Promise<VirtualSettlementAccount> {
  const mid = String(merchantId || '').trim();
  if (!mid) throw Object.assign(new Error('merchant_id is required'), { code: 'VALIDATION_ERROR' });
  const ccy = String(currency || 'USD').trim().toUpperCase();
  const homeCurrency = /^[A-Z]{3}$/.test(ccy) ? ccy : 'USD';

  await ensureVsaTables();

  const existing = await lookupVsaByMerchant(mid);
  if (existing) return existing;

  for (let attempt = 0; attempt < 10; attempt++) {
    const maxRow = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTR(vsa_id, ?) AS INTEGER)), 0) AS max_seq
         FROM virtual_settlement_accounts`,
      [VSA_SEQ_OFFSET],
    );
    const sequence = (Number(maxRow.rows?.[0]?.max_seq) || 0) + 1;

    const now = new Date().toISOString();
    const account: VirtualSettlementAccount = {
      id: uuidv4(),
      vsa_id: formatVsa(sequence),
      merchant_id: mid,
      currency: homeCurrency,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    // INSERT OR IGNORE + changes() check: a vsa_id collision (concurrent
    // allocation) or an existing row for this merchant inserts nothing.
    const inserted = await db.query(
      `INSERT OR IGNORE INTO virtual_settlement_accounts
         (id, vsa_id, merchant_id, currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.vsa_id, account.merchant_id, account.currency, account.status, now, now],
    );

    if (inserted.rowCount) return account;

    // Nothing inserted — either the merchant already has a VSA (return it) or
    // the sequence number was taken (loop and try the next one).
    const raced = await lookupVsaByMerchant(mid);
    if (raced) return raced;
  }

  throw new Error(`Unable to allocate a virtual settlement account for merchant ${mid}`);
}
