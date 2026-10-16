import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { walletsService } from '../wallets/wallets.service';
import { verifyVaultApiKey } from '../vault/gateway/middleware/verifyApiKey';
import { verifyVaultHmac } from '../vault/gateway/middleware/verifySignature';
import { vaultRateLimiter } from '../vault/gateway/middleware/rateLimiter';
import { ensureSettlementFundingTables, fundOmnibusFromSettlement } from './settlementFunding.service';
import {
  getOrCreateVsa,
  lookupVsa,
  normalizeVsaId,
  type VirtualSettlementAccount,
} from './virtualSettlementAccount.service';

/**
 * Acquirer-facing settlement API.
 *
 *   POST /api/acquirer/settlement   acquirer pushes a settlement batch
 *   POST /api/acquirer/ack          acquirer acknowledges the batch
 *   POST /api/acquirer/vsa          issue a Virtual Settlement Account (replaces IBAN)
 *   GET  /api/acquirer/vsa/:vsaId   resolve a Virtual Settlement Account
 *   GET  /api/acquirer/settlement/:batchId   settlement batch status
 *
 * A settlement push is real money arriving from the acquirer, so it credits
 * VAULT_BANK_OMNIBUS (source of truth for scheme funding) and then the merchant's
 * internal wallet. Every route is therefore authenticated with the same
 * HMAC-SHA512 gateway contract as /api/vault-bank/* — an unauthenticated caller
 * could otherwise mint merchant balance.
 */
const router = Router();

router.use(verifyVaultApiKey, verifyVaultHmac, vaultRateLimiter);

let tablesEnsured = false;

async function ensureAcquirerTables(): Promise<void> {
  if (tablesEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS acquirer_settlement_batches (
      id TEXT PRIMARY KEY,
      settlement_batch_id TEXT NOT NULL UNIQUE,
      merchant_id TEXT NOT NULL,
      virtual_settlement_account TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      idempotency_key TEXT,
      raw_payload TEXT,
      ack_at TEXT,
      ack_payload TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS acquirer_settlement_transactions (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      settlement_batch_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      transaction_reference TEXT,
      auth_code TEXT,
      stan TEXT,
      rrn TEXT,
      card_last4 TEXT,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      raw_payload TEXT,
      created_at TEXT NOT NULL
    )
  `);
  tablesEnsured = true;
}

// ── Sensitive data stripping ────────────────────────────────────────────────
// Request payloads are persisted for audit/dispute. Card SAD (PAN, CVV, PIN,
// track data) must never reach the database, so those keys are removed before
// anything is written.
const SENSITIVE_KEY = /^(pan|card_number|cardnumber|primary_account_number|cvv|cvv2|cvc|pin|track1|track2|encrypted_pan|emv_data)$/i;

function stripSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripSensitive(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = stripSensitive(val, depth + 1);
  }
  return out;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return NaN;
  return Number(text);
}

function reject(res: Response, status: number, error: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ status: 'rejected', error, ...extra });
}

interface SettlementLine {
  reference: string | null;
  authCode: string | null;
  stan: string | null;
  rrn: string | null;
  last4: string | null;
  amount: number;
  currency: string;
  raw: Record<string, unknown>;
}

function pickTransaction(raw: unknown): SettlementLine {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = t[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return null;
  };
  return {
    reference: pick('transaction_id', 'transaction_reference', 'reference', 'rrn', 'stan'),
    authCode: pick('auth_code', 'authorization_code', 'approval_code', 'authCode'),
    stan: pick('stan', 'system_trace_audit_number'),
    rrn: pick('rrn', 'retrieval_reference_number'),
    last4: pick('card_last4', 'last4', 'card_suffix'),
    amount: parseAmount(t.amount ?? t.transaction_amount ?? t.amt),
    currency: String(pick('currency') || '').toUpperCase(),
    raw: (stripSensitive(raw) as Record<string, unknown>) || {},
  };
}

// ── POST /api/acquirer/settlement ───────────────────────────────────────────
router.post('/settlement', async (req: Request, res: Response) => {
  try {
    await ensureAcquirerTables();
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    const batchId = String(body.settlement_batch_id ?? body.batch_id ?? '').trim();
    if (!batchId) return reject(res, 400, 'settlement_batch_id is required');

    const amount = parseAmount(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return reject(res, 400, 'amount must be a positive number');

    const currency = String(body.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return reject(res, 400, 'currency must be a three-letter ISO code');

    // Resolve the merchant — either by merchant_id or by the Virtual Settlement
    // Account (VSA) the merchant shared with the acquirer.
    let merchantId = String(body.merchant_id ?? '').trim();
    const vsaInput = normalizeVsaId(String(
      body.virtual_settlement_account ?? body.settlement_account ?? body.vsa_id ?? '',
    ));
    let account: VirtualSettlementAccount | null = null;
    if (!merchantId && vsaInput) {
      account = await lookupVsa(vsaInput);
      if (!account) return reject(res, 404, `Unknown virtual settlement account: ${vsaInput}`);
      merchantId = account.merchant_id;
    }
    if (!merchantId) return reject(res, 400, 'merchant_id or virtual_settlement_account is required');

    // Idempotency — a batch that has already been credited must never be
    // credited twice. A batch left in any other state is a failed or interrupted
    // attempt and is re-processed below; the omnibus funding and the wallet
    // credit are both idempotent on the same reference, so re-running cannot
    // double-credit.
    const prior = await db.query(
      `SELECT id, status, merchant_id, virtual_settlement_account, amount, currency, transaction_count
         FROM acquirer_settlement_batches WHERE settlement_batch_id = ? LIMIT 1`,
      [batchId],
    );
    const priorRow = (prior.rows?.[0] as any) || null;
    if (priorRow?.status === 'CREDITED') {
      return res.json({
        status: 'received',
        idempotent: true,
        settlement_batch_id: batchId,
        merchant_id: priorRow.merchant_id,
        virtual_settlement_account: priorRow.virtual_settlement_account,
        amount: Number(priorRow.amount),
        currency: priorRow.currency,
        transaction_count: Number(priorRow.transaction_count) || 0,
        credited: true,
      });
    }
    // A batch being resumed belongs to the merchant it was first recorded against.
    if (priorRow) merchantId = String(priorRow.merchant_id || merchantId);

    const transactions = Array.isArray(body.transactions) ? body.transactions : [];
    const lines = transactions.map(pickTransaction);

    // Batch integrity — a settlement batch total must equal its line items.
    const priced = lines.filter((line) => Number.isFinite(line.amount));
    if (lines.length && priced.length === lines.length) {
      const computed = priced.reduce((total, line) => total + line.amount, 0);
      if (Math.abs(computed - amount) > 0.005) {
        return reject(res, 400, 'BATCH_TOTAL_MISMATCH', {
          message: `transactions total ${computed.toFixed(2)} does not equal batch amount ${amount.toFixed(2)}`,
          computed_total: Number(computed.toFixed(2)),
          declared_amount: amount,
        });
      }
      const foreign = lines.find((line) => line.currency && line.currency !== currency);
      if (foreign) {
        return reject(res, 400, 'BATCH_CURRENCY_MISMATCH', {
          message: `transaction currency ${foreign.currency} does not match batch currency ${currency}`,
        });
      }
    }

    // Allocate/read the VSA before any ledger movement.
    if (!account) account = await getOrCreateVsa(merchantId, currency);

    const now = new Date().toISOString();
    const batchRowId = priorRow ? String(priorRow.id) : uuidv4();
    // Single external reference per batch: both the omnibus funding and the
    // merchant wallet credit are idempotent against it.
    const externalReference = `ACQSET-${batchId}`;

    // NOTE: no BEGIN/COMMIT. This database layer flushes the whole database
    // (db.export()) after every write, which ends an open transaction, so a
    // COMMIT would always fail after the writes had already been applied.
    // Durability is instead handled by writing the batch record first and by
    // making every money movement idempotent on `externalReference`.
    await ensureSettlementFundingTables(currency);

    // Batch record is written (or reset) before any money moves, so a crash can
    // never leave a credit behind with no settlement record to match it against.
    if (priorRow) {
      await db.query(`DELETE FROM acquirer_settlement_transactions WHERE batch_id = ?`, [batchRowId]);
      await db.query(
        `UPDATE acquirer_settlement_batches
            SET merchant_id = ?, virtual_settlement_account = ?, amount = ?, currency = ?,
                transaction_count = ?, status = 'PENDING', error_message = NULL, updated_at = ?
          WHERE id = ?`,
        [merchantId, account.vsa_id, amount, currency, lines.length, now, batchRowId],
      );
    } else {
      await db.query(
        `INSERT INTO acquirer_settlement_batches
           (id, settlement_batch_id, merchant_id, virtual_settlement_account, amount, currency,
            transaction_count, status, idempotency_key, raw_payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        [
          batchRowId, batchId, merchantId, account.vsa_id, amount, currency,
          lines.length, req.header('idempotency-key') || null,
          JSON.stringify(stripSensitive(body)), now, now,
        ],
      );
    }

    for (const line of lines) {
      await db.query(
        `INSERT INTO acquirer_settlement_transactions
           (id, batch_id, settlement_batch_id, merchant_id, transaction_reference, auth_code,
            stan, rrn, card_last4, amount, currency, raw_payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), batchRowId, batchId, merchantId, line.reference, line.authCode,
          line.stan, line.rrn, line.last4,
          Number.isFinite(line.amount) ? line.amount : 0,
          line.currency || currency, JSON.stringify(line.raw), now,
        ],
      );
    }

    try {
      // 1) Fund the VAULT_BANK_OMNIBUS + vault ledger — real money received.
      await fundOmnibusFromSettlement({
        amount,
        currency,
        merchantId,
        externalReference,
        settlementId: batchRowId,
      });

      // 2) Credit the merchant's internal wallet — the balance the merchant sees
      //    and can request an external payout from.
      const credit = await walletsService.creditMerchantWallet(
        merchantId,
        amount,
        'ACQUIRER_SETTLEMENT',
        externalReference,
        currency,
      );

      await db.query(
        `UPDATE acquirer_settlement_batches
            SET status = 'CREDITED', error_message = NULL, updated_at = ?
          WHERE id = ?`,
        [new Date().toISOString(), batchRowId],
      );

      return res.json({
        status: 'received',
        settlement_batch_id: batchId,
        virtual_settlement_account: account.vsa_id,
        merchant_id: merchantId,
        amount,
        currency,
        transaction_count: lines.length,
        credited: true,
        credit_reference: credit?.transactionId || null,
        merchant_balance_after: credit?.balanceAfter ?? null,
      });
    } catch (error: any) {
      // The batch stays on record as FAILED so a retry can resume it — the
      // settlement must never disappear because a downstream step threw.
      await db.query(
        `UPDATE acquirer_settlement_batches
            SET status = 'FAILED', error_message = ?, updated_at = ?
          WHERE id = ?`,
        [String(error?.message || error).slice(0, 500), new Date().toISOString(), batchRowId],
      );
      throw error;
    }
  } catch (error: any) {
    console.error('[acquirer-settlement]', error);
    return res.status(500).json({ status: 'error', error: String(error?.message || error).slice(0, 500) });
  }
});

// ── POST /api/acquirer/ack ──────────────────────────────────────────────────
// The acquirer confirms it delivered a batch. Pure acknowledgement — no money moves.
router.post('/ack', async (req: Request, res: Response) => {
  try {
    await ensureAcquirerTables();
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const batchId = String(body.settlement_batch_id ?? body.batch_id ?? '').trim();
    if (batchId) {
      const now = new Date().toISOString();
      await db.query(
        `UPDATE acquirer_settlement_batches SET ack_at = ?, ack_payload = ?, updated_at = ?
         WHERE settlement_batch_id = ?`,
        [now, JSON.stringify(stripSensitive(body)), now, batchId],
      );
    }
    return res.json({ status: 'received' });
  } catch (error: any) {
    console.error('[acquirer-ack]', error);
    return res.status(500).json({ status: 'error', error: String(error?.message || error).slice(0, 500) });
  }
});

// ── POST /api/acquirer/vsa ──────────────────────────────────────────────────
// Issue (or return) the Virtual Settlement Account for a merchant.
router.post('/vsa', async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const merchantId = String(body.merchant_id ?? '').trim();
    if (!merchantId) return reject(res, 400, 'merchant_id is required');
    const currency = String(body.currency ?? 'USD').trim().toUpperCase();
    const account = await getOrCreateVsa(merchantId, currency);
    return res.json({
      merchant_id: account.merchant_id,
      virtual_settlement_account: account.vsa_id,
      currency: account.currency,
      status: account.status,
      created_at: account.created_at,
    });
  } catch (error: any) {
    console.error('[acquirer-vsa]', error);
    return res.status(500).json({ status: 'error', error: String(error?.message || error).slice(0, 500) });
  }
});

// ── GET /api/acquirer/vsa/:vsaId ────────────────────────────────────────────
router.get('/vsa/:vsaId', async (req: Request, res: Response) => {
  try {
    const account = await lookupVsa(req.params.vsaId);
    if (!account) return reject(res, 404, `Unknown virtual settlement account: ${normalizeVsaId(req.params.vsaId)}`);
    return res.json({
      merchant_id: account.merchant_id,
      virtual_settlement_account: account.vsa_id,
      currency: account.currency,
      status: account.status,
    });
  } catch (error: any) {
    console.error('[acquirer-vsa-lookup]', error);
    return res.status(500).json({ status: 'error', error: String(error?.message || error).slice(0, 500) });
  }
});

// ── GET /api/acquirer/settlement/:batchId ───────────────────────────────────
router.get('/settlement/:batchId', async (req: Request, res: Response) => {
  try {
    await ensureAcquirerTables();
    const result = await db.query(
      `SELECT settlement_batch_id, merchant_id, virtual_settlement_account, amount, currency,
              transaction_count, status, ack_at, created_at, updated_at
         FROM acquirer_settlement_batches WHERE settlement_batch_id = ? LIMIT 1`,
      [String(req.params.batchId || '').trim()],
    );
    if (!result.rows?.length) return reject(res, 404, 'Settlement batch not found');
    return res.json({ status: 'received', settlement: result.rows[0] });
  } catch (error: any) {
    console.error('[acquirer-settlement-status]', error);
    return res.status(500).json({ status: 'error', error: String(error?.message || error).slice(0, 500) });
  }
});

export default router;
