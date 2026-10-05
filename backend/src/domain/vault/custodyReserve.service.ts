import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

type Currency = 'USD' | 'EUR';

const currencyOf = (value: unknown): Currency => {
  const currency = String(value || '').toUpperCase();
  if (currency !== 'USD' && currency !== 'EUR') throw Object.assign(new Error('Only USD and EUR custody reserves are supported'), { code: 'VALIDATION_ERROR' });
  return currency;
};
const amountOf = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Amount must be a positive number'), { code: 'VALIDATION_ERROR' });
  return amount;
};

export class CustodyReserveEngine {
  async ensureTables() {
    await db.query(`CREATE TABLE IF NOT EXISTS vault_custody_accounts (
      id TEXT PRIMARY KEY, currency TEXT NOT NULL UNIQUE, provider_name TEXT,
      provider_account_reference TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS vault_custody_entries (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, currency TEXT NOT NULL,
      entry_type TEXT NOT NULL, amount REAL NOT NULL, available_delta REAL NOT NULL,
      pending_delta REAL NOT NULL, settled_delta REAL NOT NULL, external_reference TEXT NOT NULL UNIQUE,
      provider_reference TEXT, card_id TEXT, withdrawal_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, FOREIGN KEY (account_id) REFERENCES vault_custody_accounts(id))`);
    await db.query(`CREATE TABLE IF NOT EXISTS vault_custody_withdrawals (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, currency TEXT NOT NULL, amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING', external_reference TEXT NOT NULL UNIQUE,
      provider_reference TEXT, beneficiary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES vault_custody_accounts(id))`);
    const now = new Date().toISOString();
    for (const currency of ['USD', 'EUR'] as Currency[]) {
      await db.query(`INSERT OR IGNORE INTO vault_custody_accounts
        (id, currency, status, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?)`,
        [`VAULT-CUSTODY-${currency}`, currency, now, now]);
    }
  }

  private async account(currency: Currency) {
    await this.ensureTables();
    const result = await db.query('SELECT * FROM vault_custody_accounts WHERE currency = ? LIMIT 1', [currency]);
    if (!result.rows?.[0]) throw Object.assign(new Error(`Custody account for ${currency} was not found`), { code: 'NOT_FOUND' });
    return result.rows[0];
  }

  async creditExternalFunds(input: {
    currency: unknown; amount: unknown; externalReference: string; providerReference?: string | null;
    providerName: string; providerAccount: string; cardId?: string; fundingMethod?: string;
    metadata?: Record<string, unknown>;
  }) {
    const currency = currencyOf(input.currency);
    const amount = amountOf(input.amount);
    if (!input.externalReference?.trim() || !input.providerName?.trim() || !input.providerAccount?.trim()) {
      throw Object.assign(new Error('External reference, provider name, and provider account are required'), { code: 'VALIDATION_ERROR' });
    }
    const account = await this.account(currency);
    const now = new Date().toISOString();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(`INSERT INTO vault_custody_entries
        (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
         external_reference, provider_reference, card_id, metadata, created_at)
        VALUES (?, ?, ?, 'EXTERNAL_CREDIT', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), account.id, currency, amount, amount, amount, input.externalReference.trim(),
          input.providerReference || null, input.cardId || null,
          JSON.stringify({ providerName: input.providerName, providerAccount: input.providerAccount, fundingMethod: input.fundingMethod, ...(input.metadata || {}) }), now]);
      await db.query('UPDATE vault_custody_accounts SET updated_at = ? WHERE id = ?', [now, account.id]);
      await db.query('COMMIT');
    } catch (error: any) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      if (String(error?.message || '').toLowerCase().includes('unique')) throw Object.assign(new Error('This external funds reference has already been credited'), { code: 'DUPLICATE_REFERENCE' });
      throw error;
    }
    return this.getSummary(currency);
  }

  async createWithdrawal(input: { currency: unknown; amount: unknown; beneficiary: Record<string, unknown>; externalReference?: string }) {
    const currency = currencyOf(input.currency);
    const amount = amountOf(input.amount);
    if (!input.beneficiary || Object.keys(input.beneficiary).length === 0) throw Object.assign(new Error('Withdrawal beneficiary is required'), { code: 'VALIDATION_ERROR' });
    const account = await this.account(currency);
    const summary = await this.getSummary(currency);
    if (summary.available < amount) throw Object.assign(new Error('Insufficient available custody reserve'), { code: 'NO_FUNDS' });
    const id = uuidv4();
    const externalReference = input.externalReference?.trim() || `WITHDRAWAL-${id}`;
    const now = new Date().toISOString();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(`INSERT INTO vault_custody_withdrawals
        (id, account_id, currency, amount, status, external_reference, beneficiary, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        [id, account.id, currency, amount, externalReference, JSON.stringify(input.beneficiary), now, now]);
      await db.query(`INSERT INTO vault_custody_entries
        (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
         external_reference, withdrawal_id, metadata, created_at)
        VALUES (?, ?, ?, 'WITHDRAWAL_HOLD', ?, ?, ?, 0, ?, ?, '{}', ?)`,
        [uuidv4(), account.id, currency, -amount, -amount, amount, externalReference, id, now]);
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    return this.getWithdrawal(id);
  }

  async settleWithdrawal(id: string, providerReference: string) {
    if (!providerReference?.trim()) throw Object.assign(new Error('Provider reference is required'), { code: 'VALIDATION_ERROR' });
    await this.ensureTables();
    const row = (await db.query('SELECT * FROM vault_custody_withdrawals WHERE id = ? LIMIT 1', [id])).rows?.[0];
    if (!row) throw Object.assign(new Error('Custody withdrawal was not found'), { code: 'NOT_FOUND' });
    if (row.status !== 'PENDING') throw Object.assign(new Error('Custody withdrawal is not pending'), { code: 'INVALID_STATE' });
    const now = new Date().toISOString();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(`INSERT INTO vault_custody_entries
        (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
         external_reference, provider_reference, withdrawal_id, metadata, created_at)
        VALUES (?, ?, ?, 'WITHDRAWAL_SETTLED', ?, 0, ?, ?, ?, ?, ?, '{}', ?)`,
        [uuidv4(), row.account_id, row.currency, -Number(row.amount), -Number(row.amount), -Number(row.amount), `SETTLED-${id}`, providerReference.trim(), id, now]);
      await db.query('UPDATE vault_custody_withdrawals SET status = ?, provider_reference = ?, updated_at = ? WHERE id = ?', ['SETTLED', providerReference.trim(), now, id]);
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    return this.getWithdrawal(id);
  }

  async releaseWithdrawal(id: string) {
    await this.ensureTables();
    const row = (await db.query('SELECT * FROM vault_custody_withdrawals WHERE id = ? LIMIT 1', [id])).rows?.[0];
    if (!row) throw Object.assign(new Error('Custody withdrawal was not found'), { code: 'NOT_FOUND' });
    if (row.status !== 'PENDING') throw Object.assign(new Error('Custody withdrawal is not pending'), { code: 'INVALID_STATE' });
    const now = new Date().toISOString();
    await db.query(`INSERT INTO vault_custody_entries
      (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
       external_reference, withdrawal_id, metadata, created_at)
      VALUES (?, ?, ?, 'WITHDRAWAL_RELEASED', ?, ?, ?, 0, ?, ?, '{}', ?)`,
      [uuidv4(), row.account_id, row.currency, Number(row.amount), Number(row.amount), -Number(row.amount), `RELEASED-${id}`, id, now]);
    await db.query('UPDATE vault_custody_withdrawals SET status = ?, updated_at = ? WHERE id = ?', ['FAILED', now, id]);
    return this.getWithdrawal(id);
  }

  async createCryptoHold(input: { currency: unknown; amount: unknown; customerId: string; asset: string; network?: string }) {
    const currency = currencyOf(input.currency);
    const amount = amountOf(input.amount);
    if (!input.customerId?.trim() || !input.asset?.trim()) throw Object.assign(new Error('Customer and crypto asset are required'), { code: 'VALIDATION_ERROR' });
    const account = await this.account(currency);
    const summary = await this.getSummary(currency);
    if (summary.available < amount) throw Object.assign(new Error('Insufficient available custody reserve for crypto purchase'), { code: 'NO_FUNDS' });
    const holdId = uuidv4();
    const now = new Date().toISOString();
    await db.query(`INSERT INTO vault_custody_entries
      (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
       external_reference, metadata, created_at)
      VALUES (?, ?, ?, 'CRYPTO_HOLD', ?, ?, ?, 0, ?, ?, ?)`,
      [holdId, account.id, currency, -amount, -amount, amount, `CRYPTO-HOLD-${holdId}`,
        JSON.stringify({ customerId: input.customerId, asset: input.asset.toUpperCase(), network: input.network || null }), now]);
    return { holdId, externalReference: `CRYPTO-HOLD-${holdId}`, currency, amount };
  }

  async settleCryptoHold(holdId: string, providerReference: string) {
    if (!providerReference?.trim()) throw Object.assign(new Error('Provider reference is required'), { code: 'VALIDATION_ERROR' });
    await this.ensureTables();
    const hold = (await db.query(`SELECT * FROM vault_custody_entries WHERE id = ? AND entry_type = 'CRYPTO_HOLD' LIMIT 1`, [holdId])).rows?.[0];
    if (!hold) throw Object.assign(new Error('Crypto reserve hold was not found'), { code: 'NOT_FOUND' });
    const settled = await db.query('SELECT provider_reference FROM vault_custody_entries WHERE external_reference = ? LIMIT 1', [`CRYPTO-SETTLED-${holdId}`]);
    if (settled.rows?.[0]) return { holdId, status: 'SETTLED', providerReference: settled.rows[0].provider_reference };
    const released = await db.query('SELECT id FROM vault_custody_entries WHERE external_reference = ? LIMIT 1', [`CRYPTO-RELEASED-${holdId}`]);
    if (released.rows?.length) throw Object.assign(new Error('Crypto reserve hold was already released'), { code: 'INVALID_STATE' });
    const now = new Date().toISOString();
    await db.query(`INSERT INTO vault_custody_entries
      (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
       external_reference, provider_reference, metadata, created_at)
      VALUES (?, ?, ?, 'CRYPTO_SETTLED', ?, 0, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), hold.account_id, hold.currency, Number(hold.amount), -Number(hold.amount), -Number(hold.amount),
        `CRYPTO-SETTLED-${holdId}`, providerReference.trim(), hold.metadata || '{}', now]);
    return { holdId, status: 'SETTLED', providerReference: providerReference.trim() };
  }

  async releaseCryptoHold(holdId: string) {
    await this.ensureTables();
    const hold = (await db.query(`SELECT * FROM vault_custody_entries WHERE id = ? AND entry_type = 'CRYPTO_HOLD' LIMIT 1`, [holdId])).rows?.[0];
    if (!hold) throw Object.assign(new Error('Crypto reserve hold was not found'), { code: 'NOT_FOUND' });
    const settled = await db.query('SELECT id FROM vault_custody_entries WHERE external_reference = ? LIMIT 1', [`CRYPTO-SETTLED-${holdId}`]);
    if (settled.rows?.length) throw Object.assign(new Error('Crypto reserve hold was already settled'), { code: 'INVALID_STATE' });
    const released = await db.query('SELECT id FROM vault_custody_entries WHERE external_reference = ? LIMIT 1', [`CRYPTO-RELEASED-${holdId}`]);
    if (released.rows?.length) return { holdId, status: 'RELEASED' };
    const now = new Date().toISOString();
    await db.query(`INSERT INTO vault_custody_entries
      (id, account_id, currency, entry_type, amount, available_delta, pending_delta, settled_delta,
       external_reference, metadata, created_at)
      VALUES (?, ?, ?, 'CRYPTO_RELEASED', ?, ?, ?, 0, ?, ?, ?)`,
      [uuidv4(), hold.account_id, hold.currency, Number(hold.amount), Number(hold.amount), -Number(hold.amount),
        `CRYPTO-RELEASED-${holdId}`, hold.metadata || '{}', now]);
    return { holdId, status: 'RELEASED' };
  }

  async getSummary(currencyInput: unknown) {
    const currency = currencyOf(currencyInput);
    const account = await this.account(currency);
    const row = (await db.query(`SELECT COALESCE(SUM(available_delta), 0) AS available,
      COALESCE(SUM(pending_delta), 0) AS pending, COALESCE(SUM(settled_delta), 0) AS settled
      FROM vault_custody_entries WHERE account_id = ?`, [account.id])).rows?.[0] || {};
    return { accountId: account.id, currency, available: Number(row.available || 0), pending: Number(row.pending || 0), settled: Number(row.settled || 0), status: account.status };
  }

  async listEntries(currencyInput: unknown) {
    const currency = currencyOf(currencyInput);
    const account = await this.account(currency);
    return (await db.query('SELECT * FROM vault_custody_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT 500', [account.id])).rows || [];
  }

  private async getWithdrawal(id: string) {
    const row = (await db.query('SELECT * FROM vault_custody_withdrawals WHERE id = ? LIMIT 1', [id])).rows?.[0];
    return row ? { ...row, amount: Number(row.amount), beneficiary: JSON.parse(row.beneficiary || '{}') } : null;
  }
}

export const custodyReserveEngine = new CustodyReserveEngine();
