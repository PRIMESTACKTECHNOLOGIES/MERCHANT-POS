import crypto from 'crypto';
import { Request, Router } from 'express';
import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { createLedgerEntry, persistLedgerEntry } from '../ledger/ledger.service';
import { reconcileVault } from '../vault/reconciliation.service';
import { settlementEngine } from '../vault/settlement/SettlementEngine';
import { decideBankReceiptAllocation, type BankReceiptAllocationStatus } from './bank-incoming-allocation';
import { verifyBankIncomingSignature } from './bank-incoming-signature';

type BankSettlementStatus = 'processed' | 'failed' | 'returned';
type RawBodyRequest = Request & { rawBody?: Buffer };

const router = Router();
const statuses: BankSettlementStatus[] = ['processed', 'failed', 'returned'];
const previousStatuses = [
  'queued', 'sent', 'submitted', 'processing',
  'QUEUED', 'SENT', 'SUBMITTED', 'PROCESSING', 'PENDING_RAIL',
];

function isValidStatus(value: unknown): value is BankSettlementStatus {
  return statuses.includes(value as BankSettlementStatus);
}

router.post('/bank/incoming-credit', async (req, res) => {
  const secret = process.env.VAULT_BANK_INCOMING_WEBHOOK_SECRET?.trim() || '';
  if (!secret) {
    return res.status(503).json({ success: false, error: 'VAULT_BANK_INCOMING_WEBHOOK_SECRET is not configured' });
  }

  const timestamp = String(req.header('x-vault-timestamp') || '');
  const signature = String(req.header('x-vault-signature') || '');
  const rawBody = (req as RawBodyRequest).rawBody;
  if (!rawBody || !verifyBankIncomingSignature({ secret, timestamp, signature, rawBody })) {
    return res.status(401).json({ success: false, error: 'Invalid bank receipt signature or timestamp' });
  }

  const transactionId = String(req.body?.transactionId || '').trim();
  const reference = String(req.body?.reference || '').trim();
  const status = String(req.body?.status || '').trim().toLowerCase();
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency || '').trim().toUpperCase();
  if (!transactionId || transactionId.length > 128 || !reference || reference.length > 128
    || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000
    || !/^[A-Z]{3}$/.test(currency) || !status) {
    return res.status(400).json({
      success: false,
      error: 'transactionId, reference, positive amount, ISO currency, and status are required',
    });
  }
  if (status !== 'settled') {
    return res.status(202).json({ success: true, accepted: false, reason: 'Bank transaction is not settled' });
  }

  const rawDigest = crypto.createHash('sha256').update(rawBody).digest('hex');
  const receiptReference = `bank-incoming:${transactionId}`;
  const now = new Date().toISOString();
  let allocation: { merchantId: string; batchSettlementId: string } | null = null;
  let allocationStatus: BankReceiptAllocationStatus | null = null;
  let receiptAlreadyRecorded = false;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_incoming_receipts (
        provider_transaction_id TEXT PRIMARY KEY,
        reference TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        allocation_status TEXT NOT NULL,
        merchant_id TEXT,
        payload_sha256 TEXT NOT NULL,
        received_at TEXT NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_real_funds (
        id TEXT PRIMARY KEY,
        currency TEXT NOT NULL,
        confirmed_amount REAL NOT NULL,
        available_amount REAL NOT NULL,
        external_reference TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        confirmed_at TEXT NOT NULL
      )
    `);

    await db.query('BEGIN IMMEDIATE');
    try {
      const existing = await db.query(
        'SELECT * FROM bank_incoming_receipts WHERE provider_transaction_id = ? LIMIT 1',
        [transactionId],
      );
      if (existing.rows?.[0]) {
        const prior = existing.rows[0];
        if (prior.reference !== reference || Number(prior.amount) !== amount || prior.currency !== currency) {
          await db.query('ROLLBACK');
          return res.status(409).json({ success: false, error: 'Bank transaction conflicts with an existing receipt' });
        }
        if (prior.allocation_status === 'ALLOCATED') {
          await db.query('COMMIT');
          return res.json({
            success: true,
            idempotent: true,
            transactionId,
            allocationStatus: prior.allocation_status,
            merchantId: prior.merchant_id || null,
          });
        }
        receiptAlreadyRecorded = true;
      }

      const vaultAccounts = await db.query(
        `SELECT id FROM vault_accounts WHERE UPPER(currency) = ? AND UPPER(status) = 'ACTIVE'`,
        [currency],
      );
      if (vaultAccounts.rows?.length !== 1) {
        throw new Error(`Expected one active Vault Bank account for ${currency}; found ${vaultAccounts.rows?.length || 0}`);
      }

      const reconciliation = await reconcileVault(currency);
      const matches = await db.query(
        `SELECT id, batch_id, merchant_id, amount, currency
           FROM batch_settlement
          WHERE (settlement_ref = ? OR batch_id = ?)
            AND UPPER(status) = 'PENDING'`,
        [reference, reference],
      );
      let matchedSettlement: { id: string; batch_id: string; merchant_id: string; amount: number; currency: string } | null = null;
      if (matches.rows?.length === 1) {
        const candidate = matches.rows[0];
        if (String(candidate.currency).toUpperCase() === currency
          && Math.abs(Number(candidate.amount) - amount) < 0.000001) {
          matchedSettlement = {
            id: String(candidate.id),
            batch_id: String(candidate.batch_id),
            merchant_id: String(candidate.merchant_id),
            amount: Number(candidate.amount),
            currency: String(candidate.currency).toUpperCase(),
          };
        }
      }

      let existingWalletCredit = false;
      if (matchedSettlement) {
        const walletCredit = await db.query(
          `SELECT mwt.id
             FROM merchant_wallet_transactions mwt
             JOIN merchant_wallets mw ON mw.id = mwt.wallet_id
            WHERE mw.merchant_id = ? AND UPPER(mw.currency) = ?
               AND mwt.type = 'credit' AND mwt.reference IN (?, ?, ?)
            LIMIT 1`,
          [matchedSettlement.merchant_id, currency, reference, matchedSettlement.batch_id, transactionId],
        );
        existingWalletCredit = Boolean(walletCredit.rows?.length);
      }

      const allocationDecision = decideBankReceiptAllocation({
        matchCount: matches.rows?.length || 0,
        receiptAmount: amount,
        receiptCurrency: currency,
        settlementAmount: matchedSettlement?.amount,
        settlementCurrency: matchedSettlement?.currency,
        existingWalletCredit,
        reconciliationDifference: reconciliation.difference,
        bankCreditAlreadyRecorded: receiptAlreadyRecorded,
      });
      const willAllocate = allocationDecision.shouldAllocate;
      allocationStatus = allocationDecision.status;
      const merchantId = willAllocate && matchedSettlement ? matchedSettlement.merchant_id : null;

      if (!receiptAlreadyRecorded) {
        await db.query(
          `INSERT INTO bank_incoming_receipts
            (provider_transaction_id, reference, amount, currency, allocation_status, merchant_id, payload_sha256, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId, reference, amount, currency,
            allocationDecision.status,
            merchantId, rawDigest, now,
          ],
        );
        await db.query(
          `INSERT INTO vault_ledger
            (id, ts, type, merchant_id, amount, currency, reference, status, meta)
           VALUES (?, ?, 'BATCH_TO_VAULT', ?, ?, ?, ?, 'COMPLETED', ?)`,
          [
            uuidv4(), now, merchantId, amount, currency, receiptReference,
            JSON.stringify({ source: 'signed_bank_webhook', bankReference: reference, providerTransactionId: transactionId }),
          ],
        );
        await db.query(
          `UPDATE vault_accounts
              SET balance = balance + ?, updated_at = ?
            WHERE id = ?`,
          [amount, now, vaultAccounts.rows[0].id],
        );
        await db.query(
          `INSERT INTO vault_real_funds
            (id, currency, confirmed_amount, available_amount, external_reference, source, confirmed_at)
           VALUES (?, ?, ?, 0, ?, 'signed-bank-webhook', ?)`,
          [uuidv4(), currency, amount, receiptReference, now],
        );
      } else {
        await db.query(
          `UPDATE bank_incoming_receipts
              SET allocation_status = ?, merchant_id = ?, payload_sha256 = ?
            WHERE provider_transaction_id = ?`,
          [allocationDecision.status, merchantId, rawDigest, transactionId],
        );
      }

      if (willAllocate && matchedSettlement) {
        const walletRows = await db.query(
          'SELECT id FROM merchant_wallets WHERE merchant_id = ? AND UPPER(currency) = ? LIMIT 1',
          [matchedSettlement.merchant_id, currency],
        );
        const walletId = walletRows.rows?.[0]?.id || uuidv4();
        if (!walletRows.rows?.length) {
          await db.query(
            'INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, ?)',
            [walletId, matchedSettlement.merchant_id, currency],
          );
        }

        const walletTransactionId = uuidv4();
        await db.query(
          `UPDATE merchant_wallets
              SET balance = balance + ?, updated_at = ?
            WHERE id = ?`,
          [amount, now, walletId],
        );
        await db.query(
          `INSERT INTO merchant_wallet_transactions
            (id, wallet_id, type, amount, currency, source, reference, created_at)
           VALUES (?, ?, 'credit', ?, ?, 'bank_settlement', ?, ?)`,
          [walletTransactionId, walletId, amount, currency, transactionId, now],
        );

        const walletLedgerEntry = createLedgerEntry(
          walletTransactionId, 'credit', amount, currency, 'AUTHORIZED',
          `Settled bank receipt ${transactionId}`, matchedSettlement.merchant_id,
          'bank', transactionId, undefined, 'bank_settlement',
        );
        await persistLedgerEntry(walletLedgerEntry, db.query.bind(db));
        await db.query(
          `UPDATE batch_settlement SET status = 'SETTLED' WHERE id = ? AND UPPER(status) = 'PENDING'`,
          [matchedSettlement.id],
        );
        allocation = { merchantId: matchedSettlement.merchant_id, batchSettlementId: matchedSettlement.id };
      }

      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }

    const finalReconciliation = await reconcileVault(currency);
    if (!allocationStatus) throw new Error('Bank receipt allocation status was not recorded');
    return res.status(receiptAlreadyRecorded ? 200 : 201).json({
      success: true,
      idempotent: receiptAlreadyRecorded,
      transactionId,
      reference,
      amount,
      currency,
      allocationStatus,
      merchantId: allocation?.merchantId || null,
      reconciliation: finalReconciliation,
    });
  } catch (error: any) {
    console.error('[BankIncomingReceipt] Failed to reconcile bank receipt:', error);
    return res.status(503).json({ success: false, error: error?.message || 'Bank receipt could not be reconciled' });
  }
});

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
