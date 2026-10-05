/**
 * Vault Bank Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade vault bank engine:
 *   1. Real fund collection  (deposit API)
 *   2. Vault holding engine  (balance from entries ledger)
 *   3. Payout engine         (IBAN / routing / SWIFT)
 *   4. Reconciliation feed   (daily statement)
 *   5. Idempotency           (per request key dedup)
 *   6. Signed webhooks       (HMAC-SHA256)
 *   7. Entry history         (full ledger per account)
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepositResult {
  ok:         boolean;
  entryId:    string;
  accountId:  string;
  amount:     number;
  currency:   string;
  reference:  string;
  balance:    number;
}

export interface BalanceResult {
  ok:        boolean;
  accountId: string;
  currency:  string;
  balance:   number;
  credits:   number;
  debits:    number;
}

export interface PayoutParams {
  accountId:         string;
  amount:            number;
  currency:          string;
  beneficiaryName:   string;
  beneficiaryIban?:  string;
  beneficiaryRouting?: string;
  beneficiarySwift?: string;
  reference?:        string;
}

export interface PayoutResult {
  ok:      boolean;
  payoutId: string;
  accountId: string;
  amount:   number;
  currency: string;
  status:   string;
  beneficiaryName: string;
  beneficiaryIban?: string;
  reference: string;
}

export interface EntryResult {
  id:         string;
  account_id: string;
  direction:  string;
  amount:     number;
  currency:   string;
  reference:  string | null;
  source:     string | null;
  status:     string;
  created_at: string;
}

export interface ReconciliationResult {
  ok:        boolean;
  accountId: string;
  date:      string;
  entries:   EntryResult[];
  totalCredits: number;
  totalDebits:  number;
  netFlow:      number;
  openingBalance: number;
  closingBalance: number;
}

export interface WebhookSignature {
  timestamp: number;
  signature: string;
}

// ── Ensure tables exist ───────────────────────────────────────────────────────

async function ensureTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      direction   TEXT NOT NULL CHECK(direction IN ('credit','debit')),
      amount      REAL NOT NULL CHECK(amount > 0),
      currency    TEXT NOT NULL DEFAULT 'USD',
      reference   TEXT,
      source      TEXT,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ve_account ON vault_entries(account_id, currency, created_at)`); } catch {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_idempotency (
      key        TEXT PRIMARY KEY,
      response   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_payouts (
      id                   TEXT PRIMARY KEY,
      account_id           TEXT NOT NULL,
      beneficiary_name     TEXT,
      beneficiary_iban     TEXT,
      beneficiary_routing  TEXT,
      beneficiary_swift    TEXT,
      amount               REAL NOT NULL,
      currency             TEXT NOT NULL DEFAULT 'USD',
      status               TEXT NOT NULL DEFAULT 'PENDING',
      reference            TEXT,
      freeze_entry_id      TEXT,
      created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const col of [
    ['beneficiary_swift', 'TEXT'],
    ['freeze_entry_id',   'TEXT'],
    ['reference',         'TEXT'],
    ['updated_at',        "TEXT DEFAULT CURRENT_TIMESTAMP"],
  ] as const) {
    try { await db.query(`ALTER TABLE vault_payouts ADD COLUMN ${col[0]} ${col[1]}`); } catch {}
  }
}

// ── VaultBankService ──────────────────────────────────────────────────────────

export class VaultBankService {

  // ── 1. Deposit (real fund collection) ──────────────────────────────────────
  async deposit(
    accountId: string,
    amount:    number,
    currency:  string,
    reference: string,
    source:    string = 'deposit'
  ): Promise<DepositResult> {
    await ensureTables();

    if (!accountId) throw new Error('accountId is required');
    if (!amount || amount <= 0) throw new Error('amount must be positive');

    const ccy     = currency.toUpperCase();
    const entryId = uuidv4();
    const now     = new Date().toISOString();

    await db.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, 'POSTED', '{}', ?)`,
      [entryId, `VB-GRP-${entryId.slice(0,8)}`, accountId, amount, ccy, reference || null, source, now]
    );

    const bal = await this.getBalance(accountId, ccy);

    return {
      ok:        true,
      entryId,
      accountId,
      amount,
      currency:  ccy,
      reference: reference || entryId,
      balance:   bal.balance,
    };
  }

  // ── 2. Balance (vault holding — computed from entries) ─────────────────────
  async getBalance(accountId: string, currency: string = 'USD'): Promise<BalanceResult> {
    await ensureTables();

    const ccy = currency.toUpperCase();
    const rows = (await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0) AS debits
       FROM vault_entries
       WHERE account_id = ? AND currency = ? AND status = 'POSTED'`,
      [accountId, ccy]
    )).rows;

    const credits = Number(rows[0]?.credits ?? 0);
    const debits  = Number(rows[0]?.debits  ?? 0);

    return {
      ok:        true,
      accountId,
      currency:  ccy,
      balance:   credits - debits,
      credits,
      debits,
    };
  }

  // ── 3. Payout (IBAN / routing / SWIFT) ────────────────────────────────────
  async createPayout(params: PayoutParams): Promise<PayoutResult> {
    await ensureTables();

    const { accountId, amount, currency, beneficiaryName, beneficiaryIban, beneficiaryRouting, beneficiarySwift, reference } = params;

    if (!accountId)      throw new Error('accountId is required');
    if (!amount || amount <= 0) throw new Error('amount must be positive');
    if (!beneficiaryName) throw new Error('beneficiaryName is required');
    if (!beneficiaryIban && !beneficiaryRouting) {
      throw new Error('Either beneficiaryIban or beneficiaryRouting is required');
    }

    const ccy = (currency || 'USD').toUpperCase();

    // Check balance
    const bal = await this.getBalance(accountId, ccy);
    if (bal.balance < amount) {
      throw Object.assign(
        new Error(`Insufficient funds. Balance: ${ccy} ${bal.balance.toFixed(2)}, requested: ${ccy} ${amount.toFixed(2)}`),
        { code: 'INSUFFICIENT_FUNDS' }
      );
    }

    const now       = new Date().toISOString();
    const payoutId  = uuidv4();
    const freezeId  = uuidv4();
    const ref       = reference || `PAYOUT-${payoutId.slice(0, 8).toUpperCase()}`;

    // Freeze funds (debit entry)
    await db.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'debit', ?, ?, ?, 'payout_freeze', 'POSTED', '{}', ?)`,
      [freezeId, `VB-GRP-${freezeId.slice(0,8)}`, accountId, amount, ccy, ref, now]
    );

    // Record payout
    await db.query(
      `INSERT INTO vault_payouts
         (id, idempotency_key, amount, currency, bank_account, status, beneficiary_name, beneficiary_iban, beneficiary_bic, beneficiary_swift, reference, freeze_entry_id, fee, created_at, updated_at)
       VALUES (?,?,?,?,?,'PENDING',?,?,?,?,?,?,0,?,?)`,
      [payoutId,
       `VB-IDEM-${payoutId.slice(0,8)}`,
       amount, ccy,
       JSON.stringify({ accountId, beneficiaryName, beneficiaryIban, beneficiaryRouting, beneficiarySwift }),
       beneficiaryName, beneficiaryIban || null, beneficiaryRouting || null, beneficiarySwift || null,
       ref, freezeId, now, now]
    );
    return {
      ok:        true,
      payoutId,
      accountId,
      amount,
      currency:  ccy,
      status:    'PENDING',
      beneficiaryName,
      beneficiaryIban,
      reference: ref,
    };
  }

  // ── 4. Reconciliation feed (daily statement) ───────────────────────────────
  async getDailyReconciliation(accountId: string, date?: string): Promise<ReconciliationResult> {
    await ensureTables();

    const targetDate = date || new Date().toISOString().slice(0, 10);

    // All entries for this account on the target date
    const rows = (await db.query(
      `SELECT * FROM vault_entries
       WHERE account_id = ?
         AND substr(created_at, 1, 10) = ?
       ORDER BY created_at ASC`,
      [accountId, targetDate]
    )).rows as EntryResult[];

    const postedRows = rows.filter(e => e.status === 'POSTED');
    const totalCredits = postedRows.filter(e => e.direction === 'credit').reduce((s, e) => s + Number(e.amount), 0);
    const totalDebits  = postedRows.filter(e => e.direction === 'debit').reduce((s, e) => s + Number(e.amount), 0);

    // Opening balance = all entries BEFORE this date
    const openingRows = (await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0) AS c,
         COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END), 0) AS d
       FROM vault_entries
       WHERE account_id = ? AND status = 'POSTED' AND substr(created_at, 1, 10) < ?`,
      [accountId, targetDate]
    )).rows[0] as any;

    const openingBalance = Number(openingRows?.c ?? 0) - Number(openingRows?.d ?? 0);
    const closingBalance = openingBalance + totalCredits - totalDebits;

    return {
      ok: true,
      accountId,
      date:           targetDate,
      entries:        rows,
      totalCredits,
      totalDebits,
      netFlow:        totalCredits - totalDebits,
      openingBalance,
      closingBalance,
    };
  }

  // ── 5. Idempotency ─────────────────────────────────────────────────────────
  async checkIdempotency(key: string): Promise<any | null> {
    await ensureTables();

    const rows = (await db.query(
      `SELECT response FROM vault_idempotency WHERE key = ?`, [key]
    )).rows;

    if (!rows.length) return null;
    try { return JSON.parse(rows[0].response); } catch { return null; }
  }

  async storeIdempotency(key: string, response: any): Promise<void> {
    await ensureTables();
    try {
      await db.query(
        `INSERT OR IGNORE INTO vault_idempotency (key, response, created_at) VALUES (?, ?, ?)`,
        [key, JSON.stringify(response), new Date().toISOString()]
      );
    } catch { /* duplicate key — already stored */ }
  }

  // ── 6. Signed webhooks (HMAC-SHA256) ──────────────────────────────────────
  signWebhook(payload: object, secret: string): WebhookSignature {
    const timestamp = Date.now();
    const body      = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return { timestamp, signature };
  }

  verifyWebhook(payload: object, secret: string, timestamp: number, signature: string, toleranceMs: number = 300_000): boolean {
    if (Date.now() - timestamp > toleranceMs) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }

  // ── 7. Entry history ──────────────────────────────────────────────────────
  async getEntries(accountId: string, currency?: string, limit: number = 50): Promise<EntryResult[]> {
    await ensureTables();

    const rows = currency
      ? (await db.query(
          `SELECT * FROM vault_entries WHERE account_id = ? AND currency = ? ORDER BY created_at DESC LIMIT ?`,
          [accountId, currency.toUpperCase(), limit]
        )).rows
      : (await db.query(
          `SELECT * FROM vault_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`,
          [accountId, limit]
        )).rows;

    return rows as EntryResult[];
  }
}

export const vaultBankService = new VaultBankService();