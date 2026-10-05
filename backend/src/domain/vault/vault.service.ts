import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { appendVaultAudit } from './audit.service';

export type VaultLedgerType =
  | 'VAULT_TO_MERCHANT'
  | 'MERCHANT_TO_VAULT'
  | 'BATCH_TO_VAULT'
  | 'VAULT_TO_BANK'
  | 'VAULT_RESERVE'
  | 'ADJUSTMENT'
  | 'CARD_CAPTURE'
  | 'REVERSAL';

export type VaultLedgerStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface VaultLedgerEntry {
  id: string;
  ts: string;
  type: VaultLedgerType;
  merchant_id: string | null;
  amount: number;
  currency: string;
  reference: string;
  status: VaultLedgerStatus;
  meta: Record<string, unknown>;
}

export interface VaultAccountPatch {
  bank_name?: string;
  bic?: string;
  iban?: string;
}

export interface VaultAccountCredit {
  accountId: string;
  amount: number;
  currency: string;
  reference: string;
  merchantId?: string | null;
  meta?: Record<string, unknown>;
}

export class VaultEngine {
  private validateMovement(input: {
    amount: number;
    currency: string;
    reference: string;
    type: VaultLedgerType;
  }): void {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw Object.assign(new Error('Amount must be a positive number'), { code: 'VALIDATION_ERROR' });
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw Object.assign(new Error('Currency must be a three-letter ISO code'), { code: 'VALIDATION_ERROR' });
    }
    if (!input.reference?.trim()) {
      throw Object.assign(new Error('Reference is required'), { code: 'VALIDATION_ERROR' });
    }
    const validTypes: VaultLedgerType[] = [
      'VAULT_TO_MERCHANT', 'MERCHANT_TO_VAULT', 'BATCH_TO_VAULT',
      'VAULT_TO_BANK', 'VAULT_RESERVE', 'ADJUSTMENT', 'CARD_CAPTURE', 'REVERSAL',
    ];
    if (!validTypes.includes(input.type)) {
      throw Object.assign(new Error(`Unsupported vault ledger type: ${input.type}`), { code: 'VALIDATION_ERROR' });
    }
  }

  private async appendMovement(input: {
    amount: number;
    currency: string;
    reference: string;
    merchantId?: string | null;
    type: VaultLedgerType;
    meta?: Record<string, unknown>;
    direction: 'credit' | 'debit';
  }): Promise<VaultLedgerEntry> {
    this.validateMovement(input);
    const balanceBefore = await this.getVaultBalance(input.currency);
    const signedAmount = input.direction === 'credit' ? input.amount : -input.amount;
    await db.query(
      `INSERT INTO vault_ledger
        (id, ts, type, merchant_id, amount, currency, reference, status, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`,
      [
        uuidv4(),
        new Date().toISOString(),
        input.type,
        input.merchantId || null,
        signedAmount,
        input.currency,
        input.reference.trim(),
        JSON.stringify(input.meta || {}),
      ]
    );
    const result = await db.query(
      `SELECT id, ts, type, merchant_id, amount, currency, reference, status, meta
         FROM vault_ledger WHERE rowid = last_insert_rowid()`
    );
    const row = result.rows?.[0];
    const entry = {
      ...row,
      amount: Number(row.amount),
      meta: JSON.parse(row.meta || '{}'),
    } as VaultLedgerEntry;

    // ── Sync vault_accounts.balance with the ledger total ────────────────────
    // Use incremental UPDATE (not recompute from ledger) to avoid divergence
    // between vault_accounts.balance (seeded manually) and the ledger SUM.
    try {
      if (signedAmount > 0) {
        await db.query(
          `UPDATE vault_accounts SET balance = balance + ?, updated_at = ? WHERE currency = ?`,
          [signedAmount, new Date().toISOString(), input.currency.toUpperCase()]
        );
      } else {
        await db.query(
          `UPDATE vault_accounts SET balance = balance - ?, updated_at = ? WHERE currency = ?`,
          [Math.abs(signedAmount), new Date().toISOString(), input.currency.toUpperCase()]
        );
      }
    } catch { /* non-critical — ledger is the source of truth */ }

    await appendVaultAudit({
      actor: 'system',
      event: input.direction === 'credit' ? 'LEDGER_CREDIT' : 'LEDGER_DEBIT',
      merchantId: input.merchantId,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      before: { vaultBalance: balanceBefore },
      after: { vaultBalance: balanceBefore + signedAmount },
      meta: { type: input.type, ledgerId: entry.id },
    });
    return entry;
  }

  async creditVault(input: Omit<Parameters<VaultEngine['appendMovement']>[0], 'direction'>): Promise<VaultLedgerEntry> {
    return this.appendMovement({ ...input, direction: 'credit' });
  }

  async creditAccount(input: VaultAccountCredit): Promise<VaultLedgerEntry> {
    const currency = String(input.currency || '').toUpperCase().trim();
    const account = await this.getAccount(input.accountId);
    if (!account) throw Object.assign(new Error(`Vault account ${input.accountId} not found`), { code: 'ACCOUNT_NOT_FOUND' });
    if (String(account.currency || '').toUpperCase() !== currency) {
      throw Object.assign(new Error(`Vault account ${input.accountId} currency mismatch`), { code: 'VALIDATION_ERROR' });
    }
    this.validateMovement({
      amount: input.amount,
      currency,
      reference: input.reference,
      type: 'BATCH_TO_VAULT',
    });

    const existing = await db.query(
      `SELECT id, ts, type, merchant_id, amount, currency, reference, status, meta
         FROM vault_ledger
        WHERE reference = ? AND type = 'BATCH_TO_VAULT' AND status = 'COMPLETED'
        LIMIT 1`,
      [input.reference],
    );
    if (existing.rows?.[0]) {
      const row = existing.rows[0];
      return { ...row, amount: Number(row.amount), meta: JSON.parse(row.meta || '{}') } as VaultLedgerEntry;
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        `INSERT INTO vault_ledger
          (id, ts, type, merchant_id, amount, currency, reference, status, meta)
         VALUES (?, ?, 'BATCH_TO_VAULT', ?, ?, ?, ?, 'COMPLETED', ?)`,
        [
          id, now, input.merchantId || null, input.amount, currency, input.reference,
          JSON.stringify({ ...(input.meta || {}), vault_account_id: input.accountId }),
        ],
      );
      await db.query(
        `UPDATE vault_accounts
            SET balance = balance + ?, updated_at = ?
          WHERE id = ?`,
        [input.amount, now, input.accountId],
      );
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }

    return {
      id,
      ts: now,
      type: 'BATCH_TO_VAULT',
      merchant_id: input.merchantId || null,
      amount: input.amount,
      currency,
      reference: input.reference,
      status: 'COMPLETED',
      meta: { ...(input.meta || {}), vault_account_id: input.accountId },
    };
  }

  async debitVault(input: Omit<Parameters<VaultEngine['appendMovement']>[0], 'direction'>): Promise<VaultLedgerEntry> {
    await db.query('BEGIN IMMEDIATE');
    try {
      const balance = await this.getVaultBalance(input.currency);
      if (balance < input.amount) {
        throw Object.assign(new Error(`Insufficient ${input.currency} vault funds`), { code: 'NO_FUNDS' });
      }
      const entry = await this.appendMovement({ ...input, direction: 'debit' });
      await db.query('COMMIT');
      return entry;
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  async getVaultBalance(currency: string): Promise<number> {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw Object.assign(new Error('Currency must be a three-letter ISO code'), { code: 'VALIDATION_ERROR' });
    }
    const result = await db.query(
      `SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('VAULT_TO_MERCHANT', 'VAULT_TO_BANK') THEN -ABS(amount)
            WHEN type IN ('MERCHANT_TO_VAULT', 'BATCH_TO_VAULT', 'CARD_CAPTURE') THEN ABS(amount)
            WHEN id LIKE 'settlement:%' OR id LIKE 'payout:%' THEN -ABS(amount)
            ELSE amount
          END
        ), 0) AS balance
         FROM vault_ledger
        WHERE currency = ? AND status = 'COMPLETED'`,
      [currency]
    );
    return Number(result.rows?.[0]?.balance || 0);
  }

  async listLedger(filters: { currency?: string; type?: string; status?: string; limit?: number } = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.currency) { clauses.push('currency = ?'); params.push(filters.currency.toUpperCase()); }
    if (filters.type) { clauses.push('type = ?'); params.push(filters.type); }
    if (filters.status) { clauses.push('status = ?'); params.push(filters.status.toUpperCase()); }
    const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 1000);
    const result = await db.query(
      `SELECT id, ts, type, merchant_id,
              CASE
                WHEN type IN ('VAULT_TO_MERCHANT', 'VAULT_TO_BANK') THEN -ABS(amount)
                WHEN type IN ('MERCHANT_TO_VAULT', 'BATCH_TO_VAULT', 'CARD_CAPTURE') THEN ABS(amount)
                WHEN id LIKE 'settlement:%' OR id LIKE 'payout:%' THEN -ABS(amount)
                ELSE amount
              END AS amount,
              currency, reference, status, meta
         FROM vault_ledger
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY ts DESC LIMIT ${limit}`,
      params
    );
    return (result.rows || []).map((row: any) => ({
      ...row,
      amount: Number(row.amount),
      meta: JSON.parse(row.meta || '{}'),
    })) as VaultLedgerEntry[];
  }
  async getAccount(id: string): Promise<any | null> {
    const result = await db.query('SELECT * FROM vault_accounts WHERE id = ? LIMIT 1', [id]);
    return result.rows?.[0] || null;
  }

  async reserveFunds(id: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Reserve amount must be positive');
    const account = await this.getAccount(id);
    if (!account) throw Object.assign(new Error(`Vault account ${id} not found`), { code: 'ACCOUNT_NOT_FOUND' });
    const available = Number(account.balance || 0) - Number(account.reserved_hold || 0);
    if (amount > available) throw Object.assign(new Error('Insufficient available vault funds'), { code: 'NO_FUNDS' });
    await db.query(
      `UPDATE vault_accounts
          SET reserved_hold = COALESCE(reserved_hold, 0) + ?, updated_at = ?
        WHERE id = ?`,
      [amount, new Date().toISOString(), id]
    );
  }

  async releaseReserve(id: string, amount: number): Promise<void> {
    await db.query(
      `UPDATE vault_accounts
          SET reserved_hold = MAX(0, COALESCE(reserved_hold, 0) - ?), updated_at = ?
        WHERE id = ?`,
      [amount, new Date().toISOString(), id]
    );
  }

  async settleReservedFunds(id: string, amount: number): Promise<void> {
    const account = await this.getAccount(id);
    if (!account) throw Object.assign(new Error(`Vault account ${id} not found`), { code: 'ACCOUNT_NOT_FOUND' });
    if (Number(account.reserved_hold || 0) < amount) {
      throw new Error(`Vault account ${id} does not have enough reserved funds to settle`);
    }
    await db.query(
      `UPDATE vault_accounts
          SET balance = balance - ?,
              reserved_hold = MAX(0, COALESCE(reserved_hold, 0) - ?),
              updated_at = ?
        WHERE id = ?`,
      [amount, amount, new Date().toISOString(), id]
    );
  }

  async updateAccount(id: string, patch: VaultAccountPatch): Promise<any> {
    const current = await this.getAccount(id);
    if (!current) return null;
    await db.query(
      `UPDATE vault_accounts
          SET bank_name = ?, bic = ?, iban = ?, updated_at = ?
        WHERE id = ?`,
      [
        patch.bank_name ?? current.bank_name,
        patch.bic ?? current.bic,
        patch.iban ?? current.iban,
        new Date().toISOString(),
        id,
      ]
    );
    return this.getAccount(id);
  }
}

export const vaultEngine = new VaultEngine();
