import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../config/db';
import { walletsService } from '../../wallets/wallets.service';
import { vaultEngine, type VaultLedgerType } from '../vault.service';
import { reconcileVault } from '../reconciliation.service';
import {
  buildSepaPacs008Batch,
  buildSwiftMt103Batch,
  createVaultPayout,
  markPayoutConfirmed,
  markPayoutFailed,
  markPayoutsSent,
} from '../payout/sepaSwiftPayout.service';
import { verifyVaultApiKey } from './middleware/verifyApiKey';
import { verifyVaultHmac } from './middleware/verifySignature';
import { vaultRateLimiter } from './middleware/rateLimiter';
import { submitDwollaPayout } from '../../payouts/dwollaOriginator.client';
import { verifyVoiceAuthCode } from '../../payments/voiceAuthCode';
import { settlementEngine } from '../settlement/SettlementEngine';

const router = Router();
router.use(verifyVaultApiKey, verifyVaultHmac, vaultRateLimiter);

type SettlementMeta = Record<string, unknown>;

function fail(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function ledgerType(value: unknown, fallback: VaultLedgerType): VaultLedgerType {
  const candidate = String(value || fallback);
  const valid: VaultLedgerType[] = [
    'VAULT_TO_MERCHANT', 'MERCHANT_TO_VAULT', 'BATCH_TO_VAULT',
    'VAULT_TO_BANK', 'VAULT_RESERVE', 'ADJUSTMENT',
  ];
  if (!valid.includes(candidate as VaultLedgerType)) {
    throw Object.assign(new Error(`Unsupported vault ledger type: ${candidate}`), { code: 'VALIDATION_ERROR' });
  }
  return candidate as VaultLedgerType;
}

/**
 * ── LOCKED TO REAL RAILS ────────────────────────────────────────────────────
 * Every route that raises `vault_accounts.balance` must be backed by money that
 * actually arrived. A credit is only accepted when it is backed by EITHER:
 *
 *   (a) a recorded real-funds receipt in `vault_real_funds` (the row the signed
 *       bank/settlement rail writes), or
 *   (b) a compensating reversal of a debit that was really taken before
 *       (meta.originalDebit points at a COMPLETED ledger entry).
 *
 * Anything else is an unbacked mint and is rejected. This is what prevents an
 * authenticated caller (or a self-referencing acquirer) from creating
 * withdrawable balance out of thin air.
 */
async function assertCreditIsBacked(input: {
  reference: string;
  currency: string;
  meta?: any;
}) {
  const reference = String(input.reference || '').trim();
  const currency = String(input.currency || '').toUpperCase();
  if (!reference) {
    throw Object.assign(new Error('Vault credit blocked: a reference is required'), { code: 'UNBACKED_CREDIT_BLOCKED' });
  }
  const realFunds = await db.query(
    `SELECT id FROM vault_real_funds WHERE external_reference = ? LIMIT 1`,
    [reference],
  );
  if (realFunds.rows?.length) return;
  const originalDebit = input.meta?.originalDebit || input.meta?.original_debit;
  if (originalDebit) {
    const prior = await db.query(
      `SELECT id FROM vault_ledger WHERE reference = ? AND status = 'COMPLETED' LIMIT 1`,
      [String(originalDebit)],
    );
    if (prior.rows?.length) return;
  }
  throw Object.assign(
    new Error(
      'Vault credit blocked: no real funds received for reference ' + reference + ' (' + currency + '). Unbacked vault minting is disabled — vault balance may only increase via a confirmed settlement/bank receipt.',
    ),
    { code: 'UNBACKED_CREDIT_BLOCKED' },
  );
}

router.get('/balance', async (req, res) => {
  try {
    const currency = String(req.query.currency || 'USD').toUpperCase();
    return res.json({ success: true, currency, balance: await vaultEngine.getVaultBalance(currency) });
  } catch (error: any) { return fail(res, 400, error.message); }
});

router.get('/settlement/:id', async (req, res) => {
  try {
    const settlement = await settlementEngine.getSettlement(String(req.params.id || '').trim());
    if (!settlement) return res.status(404).json({ success: false, status: 'NOT_FOUND' });
    return res.json({ success: true, settlement });
  } catch (error: any) {
    return fail(res, 500, error?.message || 'Failed to load settlement');
  }
});

/**
 * Protocol 101.1 — verify a verbal authorization code.
 *
 * The vault bank is the issuer: it derives the 6-digit code from the card, the
 * amount, the merchant and the UTC day with VAULT_BANK_VOICE_AUTH_SECRET, so the
 * POS never holds the issuing secret — it only asks whether the code the merchant
 * read off the phone is real. Recording an approval also makes the code
 * single-use per merchant.
 *
 * This route answers an authorization question only; it never touches a vault
 * balance.
 */
router.post('/voice-auth/verify', async (req, res) => {
  const authCode = String(req.body?.auth_code ?? '').trim();
  const panLast4 = String(req.body?.pan_last4 ?? '').replace(/\D/g, '').slice(-4);
  const amountMinor = Number(req.body?.amount_minor);
  const currency = String(req.body?.currency || '').toUpperCase();
  const merchantId = String(req.body?.merchant_id ?? '').trim();

  if (!/^\d{4,6}$/.test(authCode)) return fail(res, 400, 'auth_code must be 4-6 digits');
  if (!panLast4) return fail(res, 400, 'pan_last4 is required');
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return fail(res, 400, 'amount_minor must be a positive number');
  if (!/^[A-Z]{3}$/.test(currency)) return fail(res, 400, 'currency must be a 3-letter code');
  if (!merchantId) return fail(res, 400, 'merchant_id is required');

  const secret = (process.env.VAULT_BANK_VOICE_AUTH_SECRET || '').trim();
  if (!secret) return fail(res, 503, 'VAULT_BANK_VOICE_AUTH_SECRET is not configured on the vault bank');

  try {
    if (!verifyVoiceAuthCode({ code: authCode, pan: panLast4, amountMinor, currency, merchantId }, secret)) {
      return res.json({
        success: true,
        approved: false,
        code: 'CODE_MISMATCH',
        reason: `Code ${authCode} does not match card ****${panLast4} for ${(amountMinor / 100).toFixed(2)} ${currency} at merchant ${merchantId} today`,
      });
    }

    const reference = `VA-VOICE-${uuidv4().slice(0, 8).toUpperCase()}`;
    try {
      await db.query(
        `INSERT INTO vault_voice_auth_codes
           (id, auth_code, merchant_id, pan_last4, amount_minor, currency, terminal_id, stan, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), authCode, merchantId, panLast4, amountMinor, currency,
          String(req.body?.terminal_id || ''), req.body?.stan ? String(req.body.stan) : null,
          reference, new Date().toISOString(),
        ],
      );
    } catch (error: any) {
      const message = String(error?.message || '');
      if (/UNIQUE|constraint/i.test(message)) {
        return res.json({
          success: true,
          approved: false,
          code: 'CODE_ALREADY_USED',
          reason: `Code ${authCode} has already been used at merchant ${merchantId}`,
        });
      }
      throw error;
    }

    return res.json({
      success: true,
      approved: true,
      verified: true,
      code: 'VOICE_AUTH_APPROVED',
      reference,
      auth_code: authCode,
      pan_last4: panLast4,
      amount_minor: amountMinor,
      currency,
    });
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
});

router.post('/bank/webhook', async (req, res) => {
  const payoutId = String(req.body?.payoutId || '').trim();
  const transferId = String(req.body?.transferId || '').trim();
  const status = String(req.body?.status || '').trim().toLowerCase();
  if ((!payoutId && !transferId) || !['processed', 'failed', 'returned'].includes(status)) {
    return fail(res, 400, 'payoutId or transferId and status (processed|failed|returned) are required');
  }
  try {
    return res.json(await settlementEngine.applyBankWebhook({
      payoutId: payoutId || undefined,
      transferId: transferId || undefined,
      status: status as 'processed' | 'failed' | 'returned',
      merchantId: req.body?.merchantId ? String(req.body.merchantId) : undefined,
      code: req.body?.code ? String(req.body.code) : undefined,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
    }));
  } catch (error: any) {
    return fail(res, 500, error?.message || 'Failed to apply bank webhook');
  }
});

router.post('/reconcile', async (_req, res) => {
  try {
    return res.json({ success: true, ...(await settlementEngine.reconcile()) });
  } catch (error: any) {
    return fail(res, 500, error?.message || 'Settlement reconciliation failed');
  }
});

router.post('/settlement', async (req, res) => {
  const directSettlement = req.body && !Array.isArray(req.body.entries) && req.body.settlementId;
  if (directSettlement) {
    const settlementId = String(req.body.settlementId || '').trim();
    const merchantId = String(req.body.merchantId || '').trim();
    const amount = Number(req.body.amount);
    const currency = String(req.body.currency || '').toUpperCase().trim();
    const reference = String(req.body.reference || settlementId).trim();
    const type = String(req.body.type || '').toUpperCase().trim();
    const meta: SettlementMeta = req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    const supportedTypes = ['PAYOUT_ACH', 'PAYOUT_WIRE', 'PAYOUT_SEPA'];

    if (!settlementId || !merchantId || !Number.isFinite(amount) || amount <= 0
      || !/^[A-Z]{3}$/.test(currency) || !supportedTypes.includes(type)) {
      return fail(res, 400, 'settlementId, merchantId, positive amount, ISO currency, and supported type are required');
    }

    const beneficiaryName = String(meta.beneficiaryName || '').trim();
    const requiredFields = type === 'PAYOUT_ACH'
      ? ['routingNumber', 'accountNumber']
      : type === 'PAYOUT_WIRE'
        ? ['swiftCode', 'iban']
        : ['iban', 'bic'];
    if (!beneficiaryName || requiredFields.some((field) => !String(meta[field] || '').trim())) {
      return fail(res, 400, `beneficiaryName and ${requiredFields.join(', ')} are required for ${type}`);
    }

    try {
      const existing = await db.query(
        'SELECT * FROM vault_settlements WHERE id = ? LIMIT 1',
        [settlementId],
      );
      if (existing.rows.length) {
        const prior = existing.rows[0];
        if (prior.merchant_id !== merchantId || Number(prior.amount) !== amount || prior.currency !== currency || prior.type !== type) {
          return fail(res, 409, 'Settlement ID is already associated with a different instruction');
        }
        return res.json({ success: true, status: prior.status, bankResp: prior.bank_response_json ? JSON.parse(prior.bank_response_json) : undefined, idempotent: true });
      }

      const created = await settlementEngine.createSettlement({
        merchantId,
        amount,
        currency,
        type: type as any,
        reference,
        settlementId,
        meta: {
          ...meta,
          beneficiaryName,
          reference,
        },
      });

      const bankResp = await settlementEngine.dispatchToBankPartner(created.settlementId);
      return res.json({ success: true, status: String(bankResp.status || 'sent'), bankResp, settlementId: created.settlementId });
    } catch (error: any) {
      console.error('[VaultSettlement] Bank Partner request failed:', error);
      await db.query(
        `UPDATE vault_settlements SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [settlementId],
      ).catch((dbError) => console.error('[VaultSettlement] Failed to record failure:', dbError));
      return res.status(502).json({ success: false, status: 'BANK_PARTNER_ERROR', message: error?.message || 'Bank Partner request failed' });
    }
  }

  const entries = req.body?.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 1000) {
    return fail(res, 400, 'entries must be a non-empty array with at most 1000 items');
  }
  try {
    const created = [];
    for (const entry of entries) {
      const amount = Number(entry?.amount);
      const currency = String(entry?.currency || '').toUpperCase();
      const reference = String(entry?.reference || '');
      if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !reference) {
        return fail(res, 400, 'Each settlement entry requires a positive amount, ISO currency, and reference');
      }
      const existing = await db.query(
        `SELECT id, amount, currency, reference, status
           FROM vault_ledger
          WHERE reference = ? AND type = 'BATCH_TO_VAULT' AND status = 'COMPLETED'
          LIMIT 1`,
        [reference],
      );
      if (existing.rows?.[0]) {
        created.push(existing.rows[0]);
        continue;
      }
      // Real-rails lock: a settlement batch entry may only raise vault balance
      // when the funds were actually received (recorded in vault_real_funds).
      await assertCreditIsBacked({
        reference,
        currency,
        meta: entry?.meta,
      });
      created.push(await vaultEngine.creditVault({
        amount, currency, reference,
        merchantId: entry?.merchantId || entry?.merchant_id || null,
        type: 'BATCH_TO_VAULT', meta: entry?.meta || {},
      }));
    }
    return res.status(201).json({ success: true, entries: created });
  } catch (error: any) { return fail(res, 400, error.message); }
});

router.post('/real-funds/confirm', async (req, res) => {
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency || '').toUpperCase();
  const externalReference = String(req.body?.externalReference || req.body?.reference || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !externalReference) {
    return fail(res, 400, 'amount, ISO currency, and externalReference are required');
  }
  try {
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
    const existing = await db.query(
      'SELECT * FROM vault_real_funds WHERE external_reference = ? LIMIT 1',
      [externalReference],
    );
    if (existing.rows?.[0]) return res.json({ success: true, realFunds: existing.rows[0], idempotent: true });
    const now = new Date().toISOString();
    const id = uuidv4();
    await db.query(
      `INSERT INTO vault_real_funds
        (id, currency, confirmed_amount, available_amount, external_reference, source, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, currency, amount, amount, externalReference, String(req.body?.source || 'external-bank-confirmation'), now],
    );
    const ledgerReference = `real-funds:${externalReference}`;
    const existingLedger = await db.query(
      `SELECT id FROM vault_ledger
        WHERE reference = ? AND type = 'BATCH_TO_VAULT' AND status = 'COMPLETED'
        LIMIT 1`,
      [ledgerReference],
    );
    if (!existingLedger.rows?.length) {
      await vaultEngine.creditVault({
        amount,
        currency,
        reference: ledgerReference,
        merchantId: req.body?.merchantId ? String(req.body.merchantId) : null,
        type: 'BATCH_TO_VAULT',
        meta: {
          source: String(req.body?.source || 'external-bank-confirmation'),
          externalReference,
          realFundsId: id,
        },
      });
    }
    return res.status(201).json({
      success: true,
      realFunds: { id, currency, confirmed_amount: amount, available_amount: amount, external_reference: externalReference, confirmed_at: now },
    });
  } catch (error: any) {
    return fail(res, 400, error?.message || 'Real funds confirmation failed');
  }
});

router.post('/debit', async (req, res) => {
  try {
    const entry = await vaultEngine.debitVault({
      amount: Number(req.body?.amount),
      currency: String(req.body?.currency || '').toUpperCase(),
      reference: String(req.body?.reference || ''),
      merchantId: req.body?.merchantId,
      type: ledgerType(req.body?.type, 'VAULT_RESERVE'),
      meta: req.body?.meta || {},
    });
    return res.status(201).json({ success: true, entry });
  } catch (error: any) {
    return fail(res, error?.code === 'NO_FUNDS' ? 409 : 400, error?.message || 'Vault debit failed');
  }
});

router.post('/credit', async (req, res) => {
  try {
    const currency = String(req.body?.currency || '').toUpperCase();
    const reference = String(req.body?.reference || '');
    // Real-rails lock: no credit may raise vault balance without backing funds.
    await assertCreditIsBacked({ reference, currency, meta: req.body?.meta });
    const entry = await vaultEngine.creditVault({
      amount: Number(req.body?.amount),
      currency,
      reference,
      merchantId: req.body?.merchantId,
      type: ledgerType(req.body?.type, 'ADJUSTMENT'),
      meta: req.body?.meta || {},
    });
    return res.status(201).json({ success: true, entry });
  } catch (error: any) {
    return fail(res, error?.code === 'UNBACKED_CREDIT_BLOCKED' ? 403 : 400, error?.message || 'Vault credit failed');
  }
});

router.post('/payout', async (req, res) => {
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency || '').toUpperCase();
  const bankAccount = req.body?.bankAccount;
  const idempotencyKey = req.header('idempotency-key')?.trim() || String(req.body?.idempotencyKey || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !bankAccount || !idempotencyKey) {
    return fail(res, 400, 'amount, ISO currency, bankAccount, and Idempotency-Key are required');
  }
  try {
    const existing = await db.query('SELECT * FROM vault_payouts WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]);
    if (existing.rows.length) return res.json({ success: true, payout: existing.rows[0], idempotent: true });
    const ledgerEntry = await vaultEngine.debitVault({
      amount, currency, reference: String(req.body?.reference || idempotencyKey),
      type: 'VAULT_TO_BANK', meta: { bankAccount, source: 'vault-bank-gateway' },
    });
    const downstream = (process.env.INTERNAL_PAYOUT_DOWNSTREAM || '').trim().toLowerCase();
    let dwolla: Awaited<ReturnType<typeof submitDwollaPayout>> | undefined;
    if (downstream === 'vaultbank_dwolla') {
      const merchantId = String(req.body?.merchantId || '').trim();
      const merchantFundingSource = merchantId
        ? await db.query(
          `SELECT dwolla_funding_source_url
             FROM merchant_wallets
            WHERE merchant_id = ?
            LIMIT 1`,
          [merchantId],
        )
        : { rows: [] };
      dwolla = await submitDwollaPayout({
        payoutId: idempotencyKey,
        amount,
        currency,
        reference: String(req.body?.reference || idempotencyKey),
        destinationFundingSourceUrl: bankAccount.dwollaFundingSourceUrl
          || bankAccount.dwolla_funding_source_url
          || merchantFundingSource.rows?.[0]?.dwolla_funding_source_url,
        metadata: {
          merchantId,
        },
      });
      if (!dwolla.success) {
        await vaultEngine.creditVault({
          amount,
          currency,
          reference: `ROLLBACK-${idempotencyKey}`,
          type: 'ADJUSTMENT',
          meta: { source: 'dwolla-payout-rollback', error: dwolla.message || dwolla.status },
        });
        return fail(res, dwolla.status === 'CONFIG_ERROR' ? 503 : 502, dwolla.message || 'Dwolla payout failed');
      }
    }
    const payout = {
      id: uuidv4(), idempotency_key: idempotencyKey, amount, currency,
      bank_account: JSON.stringify(bankAccount), ledger_entry_id: ledgerEntry.id,
      status: dwolla?.success ? 'SUBMITTED' : 'SUBMITTED', created_at: new Date().toISOString(),
    };
    if (dwolla?.providerReference) {
      await db.query(
        `UPDATE vault_payouts SET dwolla_transfer_url = ?, updated_at = ? WHERE idempotency_key = ?`,
        [dwolla.providerReference, new Date().toISOString(), idempotencyKey],
      );
    }
    await db.query(
      `INSERT INTO vault_payouts
        (id, idempotency_key, amount, currency, bank_account, ledger_entry_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [payout.id, payout.idempotency_key, payout.amount, payout.currency, payout.bank_account,
        payout.ledger_entry_id, payout.status, payout.created_at],
    );
    return res.status(201).json({ success: true, payout, dwolla });
  } catch (error: any) { return fail(res, error.code === 'NO_FUNDS' ? 409 : 400, error.message); }
});

async function createTypedPayout(req: any, type: 'SEPA' | 'SWIFT') {
  return createVaultPayout({
    amount: Number(req.body?.amount),
    currency: String(req.body?.currency || ''),
    beneficiaryName: String(req.body?.beneficiaryName || ''),
    beneficiaryIban: String(req.body?.beneficiaryIban || ''),
    beneficiaryBic: String(req.body?.beneficiaryBic || ''),
    reference: req.body?.reference,
    type,
    vaultCurrency: req.body?.vaultCurrency,
  });
}

router.post('/payout/sepa', async (req, res) => {
  try { return res.status(201).json(await createTypedPayout(req, 'SEPA')); }
  catch (error: any) { return fail(res, error.code === 'NO_FUNDS' ? 409 : 400, error.message); }
});

router.post('/payout/swift', async (req, res) => {
  try { return res.status(201).json(await createTypedPayout(req, 'SWIFT')); }
  catch (error: any) { return fail(res, error.code === 'NO_FUNDS' ? 409 : 400, error.message); }
});

router.post('/merchant/withdraw', async (req, res) => {
  const merchantId = String(req.body?.merchantId || '').trim();
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency || '').toUpperCase();
  const type = String(req.body?.type || 'SEPA').toUpperCase() as 'SEPA' | 'SWIFT';
  const reference = String(req.body?.reference || `Merchant ${merchantId} withdrawal`).trim();
  if (!merchantId || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return fail(res, 400, 'merchantId, positive amount, and ISO currency are required');
  }
  if (type !== 'SEPA' && type !== 'SWIFT') return fail(res, 400, 'type must be SEPA or SWIFT');
  let debited = false;
  try {
    const debit = await walletsService.debitMerchantWallet(merchantId, amount, 'merchant_withdrawal', reference, currency);
    debited = true;
    const payout = await createVaultPayout({
      amount, currency, beneficiaryName: String(req.body?.name || ''),
      beneficiaryIban: String(req.body?.iban || ''), beneficiaryBic: String(req.body?.bic || ''),
      reference, type, vaultCurrency: req.body?.vaultCurrency,
    });
    return res.status(201).json({ success: true, payout, merchantId, debit });
  } catch (error: any) {
    if (debited) await walletsService.creditMerchantWallet(merchantId, amount, 'merchant_withdrawal_rollback', reference, currency);
    return fail(res, error.code === 'NO_FUNDS' ? 409 : 400, error.message);
  }
});

router.get('/payout/batch/sepa', async (_req, res) => {
  try { return res.json(await buildSepaPacs008Batch()); }
  catch (error: any) { return fail(res, 500, error.message); }
});

router.get('/payout/sepa/batch', async (_req, res) => {
  try { return res.json(await buildSepaPacs008Batch()); }
  catch (error: any) { return fail(res, 500, error.message); }
});

router.get('/payout/batch/swift', async (_req, res) => {
  try { return res.json(await buildSwiftMt103Batch()); }
  catch (error: any) { return fail(res, 500, error.message); }
});

router.get('/payout/swift/batch', async (_req, res) => {
  try { return res.json(await buildSwiftMt103Batch()); }
  catch (error: any) { return fail(res, 500, error.message); }
});

router.post('/payout/status/sent', async (req, res) => {
  try { return res.json({ success: true, updated: await markPayoutsSent(req.body?.payoutIds || []) }); }
  catch (error: any) { return fail(res, 400, error.message); }
});

router.post('/payout/:payoutId/confirmed', async (req, res) => {
  try { return res.json({ success: true, updated: await markPayoutConfirmed(req.params.payoutId) }); }
  catch (error: any) { return fail(res, 400, error.message); }
});

router.post('/payout/:payoutId/failed', async (req, res) => {
  try { return res.json({ success: true, updated: await markPayoutFailed(req.params.payoutId) }); }
  catch (error: any) { return fail(res, 400, error.message); }
});

router.get('/ledger', async (req, res) => {
  try {
    return res.json({ success: true, ledger: await vaultEngine.listLedger({
      currency: req.query.currency ? String(req.query.currency) : undefined,
      type: req.query.type ? String(req.query.type) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }) });
  } catch (error: any) { return fail(res, 400, error.message); }
});

router.get('/reconcile', async (req, res) => {
  try { return res.json({ success: true, reconciliation: await reconcileVault(String(req.query.currency || 'USD')) }); }
  catch (error: any) { return fail(res, 400, error.message); }
});

export default router;
