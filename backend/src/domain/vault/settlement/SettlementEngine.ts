import { db } from '../../../config/db';
import { bankPartnerClient } from '../bank-partner.client';

export type SettlementType = 'PAYOUT_ACH' | 'PAYOUT_WIRE' | 'PAYOUT_SEPA';
export type SettlementStatus = 'received' | 'sent' | 'processed' | 'failed' | 'returned' | 'reconciled';

export interface CreateSettlementParams {
  merchantId: string;
  amount: number;
  currency: string;
  type: SettlementType;
  meta?: Record<string, unknown>;
  reference?: string;
  settlementId?: string;
}

export interface BankWebhookEvent {
  payoutId?: string;
  transferId?: string;
  status: 'processed' | 'failed' | 'returned';
  code?: string;
  reason?: string;
  merchantId?: string;
}

export class SettlementEngine {
  private readonly terminalStatuses = new Set<SettlementStatus>(['reconciled']);

  private canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
    if (from === to) return true;
    if (this.terminalStatuses.has(from)) return false;
    if (from === 'received') return to === 'sent' || to === 'failed';
    if (from === 'sent') return to === 'processed' || to === 'failed' || to === 'returned';
    if (from === 'processed' || from === 'failed' || from === 'returned') return to === 'reconciled';
    return false;
  }

  private ledgerIdForSettlement(settlementId: string): string {
    return `settlement:${String(settlementId).replace(/^settlement:/i, '')}`;
  }

  private async ensureSettlementSchema() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_settlements (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        type TEXT NOT NULL,
        reference TEXT,
        meta_json TEXT,
        status TEXT NOT NULL,
        bank_response_json TEXT,
        bank_return_code TEXT,
        bank_return_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const columns: Array<[string, string]> = [
      ['reference', 'TEXT'],
      ['meta_json', 'TEXT'],
      ['status', 'TEXT'],
      ['bank_response_json', 'TEXT'],
      ['bank_return_code', 'TEXT'],
      ['bank_return_reason', 'TEXT'],
    ];

    for (const [column, definition] of columns) {
      try {
        await db.query(`ALTER TABLE vault_settlements ADD COLUMN ${column} ${definition}`);
      } catch {
        // schema already contains this column
      }
    }
  }

  private parseMeta(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  async createSettlement(params: CreateSettlementParams) {
    await this.ensureSettlementSchema();

    if (!params.merchantId?.trim()) throw new Error('merchantId is required');
    if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('amount must be positive');
    if (!/^[A-Z]{3}$/.test(String(params.currency || '').toUpperCase())) {
      throw new Error('currency must be an ISO 4217 alpha-3 code');
    }
    const settlementId = String(params.settlementId || `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    const reference = String(params.reference || settlementId);
    const meta = params.meta && typeof params.meta === 'object' ? params.meta : {};

    const existing = await db.query('SELECT * FROM vault_settlements WHERE id = ? LIMIT 1', [settlementId]);
    if (existing.rows?.length) {
      const row = existing.rows[0];
      return {
        settlementId: row.id,
        status: row.status,
        idempotent: true,
        settlement: row,
      };
    }

    await db.query(
      `INSERT INTO vault_settlements
        (id, merchant_id, amount, currency, type, reference, meta_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'received', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        settlementId,
        params.merchantId,
        params.amount,
        params.currency,
        params.type,
        reference,
        JSON.stringify(meta),
      ],
    );

    return {
      settlementId,
      status: 'received',
      idempotent: false,
    };
  }

  async dispatchToBankPartner(settlementId: string) {
    await this.ensureSettlementSchema();

    const rowResult = await db.query('SELECT * FROM vault_settlements WHERE id = ? LIMIT 1', [settlementId]);
    if (!rowResult.rows?.length) {
      throw new Error('Settlement not found');
    }

    const settlement = rowResult.rows[0];
    const currentStatus = String(settlement.status) as SettlementStatus;
    if (!this.canTransition(currentStatus, 'sent')) {
      throw new Error(`Settlement cannot be dispatched from status ${currentStatus}`);
    }
    const meta = this.parseMeta(settlement.meta_json);
    const common = {
      settlementId: settlement.id,
      merchantId: settlement.merchant_id,
      amount: Number(settlement.amount),
      currency: String(settlement.currency),
      beneficiaryName: String(meta.beneficiaryName || '').trim(),
      reference: String(meta.reference || settlement.reference || settlement.id),
    };

    let bankResp: Record<string, unknown>;

    if (settlement.type === 'PAYOUT_ACH') {
      if (!common.beneficiaryName || !String(meta.routingNumber || '').trim() || !String(meta.accountNumber || '').trim()) {
        throw new Error('beneficiaryName, routingNumber, and accountNumber are required for PAYOUT_ACH');
      }
      bankResp = await bankPartnerClient.sendACH({
        ...common,
        beneficiaryRouting: String(meta.routingNumber).trim(),
        beneficiaryAccount: String(meta.accountNumber).trim(),
      });
    } else if (settlement.type === 'PAYOUT_WIRE') {
      if (!common.beneficiaryName || !String(meta.swiftCode || '').trim() || !String(meta.iban || '').trim()) {
        throw new Error('beneficiaryName, swiftCode, and iban are required for PAYOUT_WIRE');
      }
      bankResp = await bankPartnerClient.sendWire({
        ...common,
        swiftCode: String(meta.swiftCode).trim(),
        iban: String(meta.iban).trim(),
      });
    } else if (settlement.type === 'PAYOUT_SEPA') {
      if (!common.beneficiaryName || !String(meta.iban || '').trim() || !String(meta.bic || '').trim()) {
        throw new Error('beneficiaryName, iban, and bic are required for PAYOUT_SEPA');
      }
      bankResp = await bankPartnerClient.sendSEPA({
        ...common,
        iban: String(meta.iban).trim(),
        bic: String(meta.bic).trim(),
      });
    } else {
      throw new Error(`Unsupported settlement type: ${settlement.type}`);
    }

    const status = String(bankResp.status || 'sent').toLowerCase() as SettlementStatus;
    if (!['sent', 'processed', 'failed', 'returned'].includes(status)
      || !this.canTransition(currentStatus, status)) {
      throw new Error(`Bank Partner returned invalid settlement status ${status}`);
    }
    await db.query(
      `UPDATE vault_settlements
         SET status = ?, bank_response_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, JSON.stringify(bankResp || {}), settlementId],
    );

    try {
      await db.query(
        `UPDATE merchant_payouts
           SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR provider_reference = ?`,
        [status, settlementId, settlementId],
      );
    } catch {
      // secondary payout table may be absent or shaped differently
    }

    try {
      await db.query(
        `UPDATE vault_payouts
           SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR dwolla_transfer_url = ?`,
        [status, settlementId, settlementId],
      );
    } catch {
      // secondary vault table may not exist in this runtime
    }

    return bankResp;
  }

  async applyBankWebhook(event: BankWebhookEvent) {
    await this.ensureSettlementSchema();

    const settlementKey = String(event.payoutId || event.transferId || '').trim();
    if (!settlementKey) throw new Error('payoutId or transferId is required');
    const settlementResult = await db.query(
      `SELECT id, merchant_id, amount, currency, status
         FROM vault_settlements
        WHERE id = ? OR reference = ? OR json_extract(bank_response_json, '$.transferId') = ?
        LIMIT 1`,
      [settlementKey, settlementKey, settlementKey],
    );
    const settlement = settlementResult.rows?.[0];
    if (!settlement) {
      throw new Error('Settlement not found');
    }
    const currentStatus = String(settlement.status) as SettlementStatus;
    if (!this.canTransition(currentStatus, event.status)) {
      if (currentStatus === event.status || currentStatus === 'reconciled') {
        return { success: true, payoutId: settlement.id, status: currentStatus, idempotent: true };
      }
      throw new Error(`Invalid settlement transition ${currentStatus} -> ${event.status}`);
    }

    await db.query(
      `UPDATE vault_settlements
         SET status = ?, bank_return_code = ?, bank_return_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [event.status, event.code || null, event.reason || null, settlement.id],
    );

    try {
      await db.query(
        `UPDATE merchant_payouts
           SET status = ?, bank_return_code = ?, bank_return_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR provider_reference = ?`,
        [event.status, event.code || null, event.reason || null, settlement.id, settlement.id],
      );
    } catch {
      // optional sync to merchant payout table
    }

    try {
      await db.query(
        `UPDATE vault_payouts
           SET status = ?, bank_return_code = ?, bank_return_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR dwolla_transfer_url = ?`,
        [event.status, event.code || null, event.reason || null, settlement.id, settlement.id],
      );
    } catch {
      // optional sync to vault payout table
    }

    return { success: true, payoutId: settlement.id, status: event.status, idempotent: false };
  }

  async getSettlement(settlementId: string) {
    await this.ensureSettlementSchema();
    const result = await db.query(
      'SELECT * FROM vault_settlements WHERE id = ? LIMIT 1',
      [settlementId],
    );
    return result.rows?.[0] || null;
  }

  async reconcile() {
    await this.ensureSettlementSchema();

    const rows = await db.query(
      `SELECT * FROM vault_settlements WHERE status IN ('processed', 'returned', 'failed') ORDER BY updated_at ASC`,
    );

    for (const settlement of rows.rows || []) {
      const amount = Number(settlement.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Settlement ${settlement.id} has an invalid amount`);
      }

      if (settlement.status === 'processed') {
        const existingDebit = await db.query(
          `SELECT id FROM vault_ledger
            WHERE id = ? AND status = 'COMPLETED'
            LIMIT 1`,
          [this.ledgerIdForSettlement(settlement.id)],
        );
        if (!existingDebit.rows?.length) {
          await db.query(
            `INSERT INTO vault_ledger
              (id, ts, type, merchant_id, amount, currency, reference, status, meta)
             VALUES (?, CURRENT_TIMESTAMP, 'VAULT_TO_BANK', ?, ?, ?, ?, 'COMPLETED', ?)`,
            [
              this.ledgerIdForSettlement(settlement.id),
              settlement.merchant_id,
              -amount,
              String(settlement.currency).toUpperCase(),
              settlement.reference || settlement.id,
              JSON.stringify({
                settlementId: settlement.id,
                type: settlement.type,
                source: 'vault_settlements',
                settledBy: 'bank_webhook',
              }),
            ],
          );
        }
        await db.query(
          `UPDATE merchant_wallets
             SET payout_settled = payout_settled + ?
           WHERE merchant_id = ?`,
          [amount, settlement.merchant_id],
        );
      } else {
        await db.query(
          `UPDATE merchant_wallets
             SET balance = balance + ?
           WHERE merchant_id = ?`,
          [amount, settlement.merchant_id],
        );
      }

      await db.query(
        `UPDATE vault_settlements
           SET status = 'reconciled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [settlement.id],
      );
    }

    return { reconciled: (rows.rows || []).length };
  }
}

export const settlementEngine = new SettlementEngine();
