import crypto from 'crypto';
import { Request, Router } from 'express';
import { db } from '../../config/db';
import { settlementEngine } from '../vault/settlement/SettlementEngine';

type BankSettlementStatus = 'processed' | 'failed' | 'returned';

const router = Router();
const statuses: BankSettlementStatus[] = ['processed', 'failed', 'returned'];
const previousStatuses = [
  'queued', 'sent', 'submitted', 'processing',
  'QUEUED', 'SENT', 'SUBMITTED', 'PROCESSING', 'PENDING_RAIL',
];

function isValidStatus(value: unknown): value is BankSettlementStatus {
  return statuses.includes(value as BankSettlementStatus);
}

function validSecret(req: Request): boolean {
  const configured = process.env.VAULT_BANK_WEBHOOK_SECRET?.trim();
  if (!configured) return false;
  const received = String(req.header('x-vault-webhook-secret') || '');
  const expected = Buffer.from(configured, 'utf8');
  const actual = Buffer.from(received, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

router.post('/bank/webhook', async (req, res) => {
  if (!process.env.VAULT_BANK_WEBHOOK_SECRET?.trim()) {
    return res.status(503).json({ success: false, error: 'VAULT_BANK_WEBHOOK_SECRET is not configured' });
  }
  if (!validSecret(req)) {
    return res.status(401).json({ success: false, error: 'Invalid bank webhook secret' });
  }

  const transferId = String(req.body?.transferId || '').trim();
  const payoutId = String(req.body?.payoutId || '').trim();
  const merchantId = String(req.body?.merchantId || '').trim();
  const status = String(req.body?.status || '').trim().toLowerCase() as BankSettlementStatus;
  const code = req.body?.code ? String(req.body.code).trim().slice(0, 32) : null;
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;

  if (!transferId || !payoutId || !merchantId || !isValidStatus(status)) {
    return res.status(400).json({
      success: false,
      error: 'transferId, payoutId, merchantId, and status (processed|failed|returned) are required',
    });
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_partner_webhook_events (
        transfer_id TEXT PRIMARY KEY,
        payout_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT,
        reason TEXT,
        received_at TEXT NOT NULL
      )
    `);

    const existing = await db.query(
      'SELECT * FROM bank_partner_webhook_events WHERE transfer_id = ? LIMIT 1',
      [transferId],
    );
    if (existing.rows.length) {
      const prior = existing.rows[0];
      if (prior.payout_id !== payoutId || prior.merchant_id !== merchantId || prior.status !== status) {
        return res.status(409).json({ success: false, error: 'Transfer webhook conflicts with an existing event' });
      }
      return res.json({ success: true, idempotent: true, status: prior.status });
    }

    const merchantPayout = await db.query(
      `SELECT id, merchant_id, status, provider_reference
         FROM merchant_payouts
        WHERE id = ? OR provider_reference = ?
        LIMIT 1`,
      [payoutId, transferId],
    );
    const vaultPayout = await db.query(
      `SELECT id, status, dwolla_transfer_url
         FROM vault_payouts
        WHERE id = ? OR dwolla_transfer_url = ?
        LIMIT 1`,
      [payoutId, transferId],
    );
    const settlement = await settlementEngine.getSettlement(payoutId);

    if (!merchantPayout.rows.length && !vaultPayout.rows.length && !settlement) {
      return res.status(404).json({ success: false, error: 'Payout not found' });
    }
    if (merchantPayout.rows[0] && String(merchantPayout.rows[0].merchant_id) !== merchantId) {
      return res.status(409).json({ success: false, error: 'Merchant does not own payout' });
    }

    const now = new Date().toISOString();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        `INSERT INTO bank_partner_webhook_events
          (transfer_id, payout_id, merchant_id, status, code, reason, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transferId, payoutId, merchantId, status, code, reason, now],
      );

      if (merchantPayout.rows[0]) {
        await db.query(
          `UPDATE merchant_payouts
              SET status = ?,
                  provider = COALESCE(provider, 'bank_partner'),
                  provider_reference = COALESCE(provider_reference, ?),
                  error_message = CASE WHEN ? IN ('failed', 'returned') THEN ? ELSE error_message END,
                  bank_return_code = ?,
                  bank_return_reason = ?,
                  updated_at = CURRENT_TIMESTAMP,
                  completed_at = CASE WHEN ? = 'processed' THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE id = ?
              AND status IN (${previousStatuses.map(() => '?').join(',')})`,
          [status, transferId, status, reason, code, reason, status, merchantPayout.rows[0].id, ...previousStatuses],
        );
      }

      if (vaultPayout.rows[0]) {
        await db.query(
          `UPDATE vault_payouts
              SET status = ?,
                  dwolla_transfer_url = COALESCE(dwolla_transfer_url, ?),
                  bank_return_code = ?,
                  bank_return_reason = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status IN (${previousStatuses.map(() => '?').join(',')})`,
          [status, transferId, code, reason, vaultPayout.rows[0].id, ...previousStatuses],
        );
      }

      if (settlement) {
        await settlementEngine.applyBankWebhook({
          payoutId,
          transferId,
          merchantId,
          status,
          code: code || undefined,
          reason: reason || undefined,
        });
      }

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

    return res.json({ success: true, transferId, payoutId, status });
  } catch (error: any) {
    console.error('[BankPartnerWebhook] Failed to update settlement:', error);
    return res.status(500).json({ success: false, error: 'Settlement status update failed' });
  }
});

export default router;
