import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { vaultEngine, type VaultLedgerEntry } from './vault.service';
import { appendVaultAudit } from './audit.service';

export type ReserveReason = 'RISK' | 'CHARGEBACK' | 'FRAUD' | 'HIGH_RISK_MERCHANT' | 'MANUAL_HOLD';

const reasons: ReserveReason[] = ['RISK', 'CHARGEBACK', 'FRAUD', 'HIGH_RISK_MERCHANT', 'MANUAL_HOLD'];

export class ReserveEngine {
  async createReserve(input: {
    merchantId: string;
    amount: number;
    currency: string;
    reason: ReserveReason;
    releaseTs?: string | null;
    meta?: Record<string, unknown>;
  }) {
    const currency = input.currency.toUpperCase();
    if (!input.merchantId || !Number.isFinite(input.amount) || input.amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !reasons.includes(input.reason)) {
      throw Object.assign(new Error('merchantId, positive amount, valid currency, and reserve reason are required'), { code: 'VALIDATION_ERROR' });
    }
    await db.query('BEGIN IMMEDIATE');
    try {
      const wallet = await db.query(
        'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
        [input.merchantId, currency]
      );
      if (!wallet.rows?.length || Number(wallet.rows[0].balance) < input.amount) {
        throw Object.assign(new Error('Insufficient merchant wallet balance'), { code: 'NO_FUNDS' });
      }
      const now = new Date().toISOString();
      const id = uuidv4();
      await db.query(
        `UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        [input.amount, now, wallet.rows[0].id]
      );
      await db.query(
        `INSERT INTO vault_reserve
          (id, ts, merchant_id, amount, currency, reason, release_ts, status, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [id, now, input.merchantId, input.amount, currency, input.reason, input.releaseTs || null, JSON.stringify(input.meta || {})]
      );
      const ledger = await vaultEngine.creditVault({
        amount: input.amount,
        currency,
        reference: `RESERVE-${input.merchantId}-${id}`,
        merchantId: input.merchantId,
        type: 'VAULT_RESERVE',
        meta: { reserveId: id, reason: input.reason },
      });
      await db.query('COMMIT');
      await appendVaultAudit({
        actor: 'system',
        event: 'RESERVE_CREATE',
        merchantId: input.merchantId,
        amount: input.amount,
        currency,
        reference: `RESERVE-${input.merchantId}-${id}`,
        after: { reserveId: id, status: 'ACTIVE' },
        meta: { reason: input.reason },
      });
      return { reserve: await this.getReserve(id), ledger };
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
      throw error;
    }
  }

  async releaseReserve(id: string): Promise<{ reserve: any; ledger: VaultLedgerEntry }> {
    await db.query('BEGIN IMMEDIATE');
    try {
      const result = await db.query(`SELECT * FROM vault_reserve WHERE id = ? LIMIT 1`, [id]);
      const reserve = result.rows?.[0];
      if (!reserve) throw Object.assign(new Error('Reserve not found'), { code: 'NOT_FOUND' });
      if (reserve.status !== 'ACTIVE') throw Object.assign(new Error('Reserve is not active'), { code: 'INVALID_STATE' });
      const ledgerId = uuidv4();
      const ledgerTs = new Date().toISOString();
      await db.query(
        `INSERT INTO vault_ledger
          (id, ts, type, merchant_id, amount, currency, reference, status, meta)
         VALUES (?, ?, 'VAULT_RESERVE', ?, ?, ?, ?, 'COMPLETED', ?)`,
        [
          ledgerId, ledgerTs, reserve.merchant_id, -Math.abs(Number(reserve.amount)),
          String(reserve.currency).toUpperCase(), `RESERVE-RELEASE-${id}`,
          JSON.stringify({ reserveId: id, release: true }),
        ]
      );
      await db.query(`UPDATE vault_reserve SET status = 'RELEASED' WHERE id = ?`, [id]);
      await db.query(
        `UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE merchant_id = ? AND currency = ?`,
        [Number(reserve.amount), new Date().toISOString(), reserve.merchant_id, reserve.currency]
      );
      await db.query('COMMIT');
      await appendVaultAudit({
        actor: 'system',
        event: 'RESERVE_RELEASE',
        merchantId: reserve.merchant_id,
        amount: Number(reserve.amount),
        currency: String(reserve.currency).toUpperCase(),
        reference: `RESERVE-RELEASE-${id}`,
        before: { reserveId: id, status: 'ACTIVE' },
        after: { reserveId: id, status: 'RELEASED' },
      });
      return {
        reserve: await this.getReserve(id),
        ledger: {
          id: ledgerId,
          ts: ledgerTs,
          type: 'VAULT_RESERVE',
          merchant_id: reserve.merchant_id,
          amount: -Math.abs(Number(reserve.amount)),
          currency: String(reserve.currency).toUpperCase(),
          reference: `RESERVE-RELEASE-${id}`,
          status: 'COMPLETED',
          meta: { reserveId: id, release: true },
        } as VaultLedgerEntry,
      };
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
      throw error;
    }
  }

  async cancelReserve(id: string) {
    const result = await db.query(`SELECT * FROM vault_reserve WHERE id = ? LIMIT 1`, [id]);
    if (!result.rows?.length) throw Object.assign(new Error('Reserve not found'), { code: 'NOT_FOUND' });
    if (result.rows[0].status !== 'ACTIVE') throw Object.assign(new Error('Reserve is not active'), { code: 'INVALID_STATE' });
    await db.query(`UPDATE vault_reserve SET status = 'CANCELLED' WHERE id = ?`, [id]);
    return this.getReserve(id);
  }

  async getReserve(id: string) {
    const result = await db.query('SELECT * FROM vault_reserve WHERE id = ? LIMIT 1', [id]);
    const row = result.rows?.[0];
    return row ? { ...row, amount: Number(row.amount), meta: JSON.parse(row.meta || '{}') } : null;
  }

  async listReserves(status?: string) {
    const result = await db.query(
      `SELECT * FROM vault_reserve ${status ? 'WHERE status = ?' : ''} ORDER BY ts DESC LIMIT 500`,
      status ? [status.toUpperCase()] : []
    );
    return (result.rows || []).map((row: any) => ({ ...row, amount: Number(row.amount), meta: JSON.parse(row.meta || '{}') }));
  }
}

export const reserveEngine = new ReserveEngine();
