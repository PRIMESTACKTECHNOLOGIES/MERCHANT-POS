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
  return fail(res, 410, 'Manual real-funds confirmation is disabled; use the signed bank receipt webhook');
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
    const entry = await vaultEngine.creditVault({
      amount: Number(req.body?.amount),
      currency: String(req.body?.currency || '').toUpperCase(),
      reference: String(req.body?.reference || ''),
      merchantId: req.body?.merchantId,
      type: ledgerType(req.body?.type, 'ADJUSTMENT'),
      meta: req.body?.meta || {},
    });
    return res.status(201).json({ success: true, entry });
  } catch (error: any) {
    return fail(res, 400, error?.message || 'Vault credit failed');
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
