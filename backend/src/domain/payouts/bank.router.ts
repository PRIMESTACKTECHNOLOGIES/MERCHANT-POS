import { Router } from 'express';
import { debitMerchantWallet } from './payoutHelpers';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { submitBankPayout, getWiseDiagnostics } from './payoutProvider.service';
import { authenticateToken } from '../../middleware/auth.middleware';
import { invoiceReceiptService } from '../receipts/invoice-receipt.service';

const router = Router();

// GET /api/payout/bank/wise/diagnostics  (JWT-protected admin preflight)
// Returns profile, balances, and any configuration warnings. Run this from
// the Developer Dashboard to confirm Wise funding availability BEFORE submitting
// the first real payout (balance-insufficient = 402 response, no wallet debit).
router.get('/bank/wise/diagnostics', authenticateToken, async (req, res) => {
  const provider = (process.env.BANK_PAYOUT_PROVIDER || 'external').trim().toLowerCase();
  if (provider !== 'wise') {
    return res.status(400).json({
      ok: false,
      provider,
      error: 'BANK_PAYOUT_PROVIDER != wise. Diagnostics are only available for the native Wise provider.',
    });
  }
  try {
    const diag = await getWiseDiagnostics();
    return res.status(200).json({ ok: true, provider: 'wise', diagnostics: diag });
  } catch (e: any) {
    return res.status(502).json({
      ok: false,
      provider: 'wise',
      error: e.message || 'Wise diagnostics failed.',
    });
  }
});

// GET /api/merchant/:merchantId/bank-accounts
// Lists all inbuilt + ad-hoc bank accounts configured for a merchant.
// The row with is_default=1 is used automatically by /payout/bank when no
// bank_account payload is supplied (handy for one-click withdrawals).
router.get('/merchant/:merchantId/bank-accounts', authenticateToken, async (req, res) => {
  const { merchantId } = req.params as any;
  try {
    const rows = await db.query(
      `SELECT id, merchant_id, bank_name, account_holder, account_number, routing_number,
              account_type, iban, swift_code, bank_address, currency, is_default, verified, created_at
         FROM bank_accounts
        WHERE merchant_id = ?
        ORDER BY is_default DESC, currency ASC`,
      [merchantId]
    );
    return res.status(200).json({ ok: true, merchant_id: merchantId, accounts: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/merchant/:merchantId/payouts
// Lists payout history for the merchant (Wise state).
router.get('/merchant/:merchantId/payouts', authenticateToken, async (req, res) => {
  const { merchantId } = req.params as any;
  try {
    const rows = await db.query(
      `SELECT id, amount, currency, status, provider, provider_reference,
              error_message, created_at, updated_at, completed_at
         FROM merchant_payouts
        WHERE merchant_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [merchantId]
    );
    return res.status(200).json({ ok: true, merchant_id: merchantId, payouts: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/merchant/:merchantId/payout/bank
//
// Behavior:
//   - If req.body.bank_account is provided → use it (legacy / ad-hoc destination).
//   - Otherwise → auto-select the merchant's inbuilt DEFAULT bank account from
//     the bank_accounts table (WHERE merchant_id = ? AND is_default = 1).
//     Caller may also override via req.body.bank_account_id or req.body.currency
//     to pick a specific inbuilt account (e.g. currency = 'EUR' for SEPA payouts).
router.post('/merchant/:merchantId/payout/bank', authenticateToken, async (req, res) => {
  const { merchantId } = req.params as any;
  const rawAmount = req.body?.amount;
  const amount = Number(rawAmount);
  const currency = String(req.body?.currency || 'USD').toUpperCase();
  const bodyBankAccount = req.body?.bank_account || req.body?.bankAccount || null;
  const bodyBankAccountId = req.body?.bank_account_id || req.body?.bankAccountId || null;

  if (!rawAmount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const payoutProvider = process.env.BANK_PAYOUT_PROVIDER?.trim().toLowerCase();
  const payoutApiUrl = process.env.BANK_PAYOUT_API_URL?.trim();
  const payoutApiKey = process.env.BANK_PAYOUT_API_KEY?.trim() || process.env.WISE_API_KEY?.trim();

  const isWise = payoutProvider === 'wise';
  const isExternal = payoutProvider === 'external';

  if (!isWise && !isExternal) {
    return res.status(501).json({
      error: 'Bank payout is not enabled for production. Set BANK_PAYOUT_PROVIDER=wise (native Wise API) or BANK_PAYOUT_PROVIDER=external with BANK_PAYOUT_API_URL + API key.'
    });
  }

  if (isWise && !payoutApiKey) {
    return res.status(501).json({
      error: 'Wise payout provider requires WISE_API_KEY. Ensure the key is set in backend/.env and the Wise profile has a funded balance to cover payouts.'
    });
  }

  if (isExternal && (!payoutApiUrl || !payoutApiKey)) {
    return res.status(501).json({
      error: 'External payout provider requires both BANK_PAYOUT_API_URL and BANK_PAYOUT_API_KEY/WISE_API_KEY.'
    });
  }

  // ─── Resolve destination bank_account ────────────────────────────────────
  let bank_account: any = bodyBankAccount;
  let resolvedBankAccountId: string | null = null;
  let resolvedLabel = 'ad-hoc (body)';

  if (!bank_account) {
    try {
      let where = 'WHERE merchant_id = ?';
      const params: any[] = [merchantId];

      if (bodyBankAccountId) {
        where += ' AND id = ?';
        params.push(String(bodyBankAccountId));
      } else {
        // Prefer is_default=1 for the requested currency; fall back to any
        // is_default=1; fall back to first merchant account.
        where += ` AND (
          CASE WHEN currency = ? AND is_default = 1 THEN 0
               WHEN is_default = 1 THEN 1
               WHEN currency = ? THEN 2
               ELSE 3 END
        ) = 0`;
        params.push(currency, currency);
      }

      const pick = await db.query(
        `SELECT * FROM bank_accounts ${where} LIMIT 1`,
        params
      );
      if (pick.rows.length === 0) {
        return res.status(404).json({
          error:
            bodyBankAccountId
              ? `Bank account ${bodyBankAccountId} not found for merchant ${merchantId}.`
              : `No inbuilt bank account configured for merchant ${merchantId} (currency=${currency}). ` +
                `Seed one in bank_accounts with merchant_id + is_default=1, or pass body.bank_account.`,
        });
      }
      const row = pick.rows[0];
      resolvedBankAccountId = row.id;
      resolvedLabel = `inbuilt ${row.id} (${row.currency}, default=${row.is_default})`;
      bank_account = {
        id: row.id,
        bank_name: row.bank_name,
        bank_address: row.bank_address || null,
        account_holder: row.account_holder,
        account_number: row.account_number,
        routing_number: row.routing_number,
        account_type: row.account_type || 'CHECKING',
        iban: row.iban,
        swift_code: row.swift_code,
        currency: row.currency || currency,
        verified: !!row.verified,
      };
    } catch (e: any) {
      return res.status(500).json({ error: `Failed to resolve inbuilt bank account: ${e.message}` });
    }
  }

  const receiverCurrency = String(bank_account.currency || currency).toUpperCase();
  if (receiverCurrency !== currency) {
    return res.status(400).json({
      error: `Selected payout currency is ${currency}, but the receiver account accepts ${receiverCurrency}. Choose a matching account or currency.`,
      payout_currency: currency,
      receiver_currency: receiverCurrency,
    });
  }

  // ─── Wise PREFLIGHT: confirm sufficient balance BEFORE debiting wallet ───
  //      Failure path here returns early — no wallet debit, no DB insert, no partial state.
  if (isWise) {
    try {
      const { balances, profileId } = (await getWiseDiagnostics()) as any;
      const bal = balances?.find((b: any) => String(b.currency || '').toUpperCase() === currency) || null;
      const available = Number(bal?.amount?.value || 0);
      if (!bal || available < Number(amount) * 1.005) {
        return res.status(402).json({
          error:
            `Insufficient Wise ${currency} balance for payout. ` +
            `Available: ${available.toFixed(2)} ${currency}, ` +
            `Requested: ${Number(amount).toFixed(2)} ${currency} (incl. ~0.5% fee headroom). ` +
            `Top up Wise at https://wise.com → Balances → ${currency}.`,
          wise: {
            profileId,
            balance: bal?.amount || null,
            reserveAvailable: available,
            currency,
          },
        });
      }
    } catch (e: any) {
      // If Wise is unreachable during preflight we hard-fail: the wallet debit
      // must NEVER happen if we can't verify funding.
      return res.status(502).json({
        error: `Wise preflight failed — unable to verify balance: ${e.message || String(e)}. Payout aborted to avoid stranded debits.`,
      });
    }
  }

  try {
    // Debit merchant wallet (includes ledger)
    await debitMerchantWallet(merchantId, Number(amount), 'payout', 'bank_payout', { bank_account, bank_account_id: resolvedBankAccountId });

    const payoutId = uuidv4();
    const metaPayload: any = {
      requested_by: 'admin',
      bank_account_resolution: resolvedLabel,
      bank_account_id: resolvedBankAccountId,
      bank_account_snapshot: bank_account,
    };

    await db.query(
      `INSERT INTO merchant_payouts
         (id, merchant_id, amount, currency, bank_account, status, meta)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [payoutId, merchantId, amount, currency, JSON.stringify(bank_account), JSON.stringify(metaPayload)]
    );

    const payoutResult = await submitBankPayout({
      merchantId,
      payoutId,
      amount: Number(amount),
      currency,
      bankAccount: bank_account,
      reference: payoutId,
    });

    await db.query(
      `UPDATE merchant_payouts
          SET status = ?,
              provider = ?,
              provider_reference = ?,
              meta = ?,
              completed_at = CASE WHEN ? IN ('COMPLETED','SENT','OUTGOING_PAYMENT_SENT','CONVERTED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        payoutResult.status || 'submitted',
        payoutResult.provider || null,
        payoutResult.providerReference || null,
        JSON.stringify({ ...metaPayload, provider: payoutResult.provider, raw: payoutResult.raw }),
        String(payoutResult.status || '').toUpperCase(),
        payoutId,
      ]
    );

    await invoiceReceiptService.create({
      type: 'BANK_PAYOUT_RECEIPT', sourceTable: 'merchant_payouts', sourceId: payoutId,
      merchantId, amount: Number(amount), currency, status: payoutResult.status || 'submitted',
      reference: payoutId, description: 'Merchant bank payout receipt',
      details: { provider: payoutResult.provider || null, providerReference: payoutResult.providerReference || null, bankAccount: bank_account },
    });

    res.json({
      ok: true,
      payout_id: payoutId,
      status: payoutResult.status || 'submitted',
      provider: payoutResult.provider,
      provider_reference: payoutResult.providerReference,
      bank_account_resolution: resolvedLabel,
      bank_account_id: resolvedBankAccountId,
      message: 'Bank payout request submitted to live provider.',
    });
  } catch (e: any) {
    console.error('Bank payout error', e);
    // If we passed wallet debit (no rollback possible on SQLite non-transacted
    // ledger by design) — we still need to preserve the failure record so ops
    // can reconcile it. Best-effort only.
    try {
      if (e?._payoutId && merchantId) {
        await db.query(
          `UPDATE merchant_payouts SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND merchant_id = ?`,
          [e.message || String(e), e._payoutId, merchantId]
        );
      }
    } catch (_) { /* ignore */ }

    res.status(400).json({ error: e.message });
  }
});

export default router;
