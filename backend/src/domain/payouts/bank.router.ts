import { Router } from 'express';
import { debitMerchantWallet } from './payoutHelpers';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { db } from '../../config/db';
import { submitBankPayout, getWiseDiagnostics } from './payoutProvider.service';
import { executeInternalPayout } from './internalPayoutProvider';
import { authenticateToken } from '../../middleware/auth.middleware';

function renderPayoutReceiptHtml(po: any, wallet: any, ldg: any, mtx: any): string {
  const meta = JSON.parse(po.meta || '{}');
  const bank = JSON.parse(po.bank_account || '{}');
  const confirmation = meta.merchant_bank_confirmation || null;
  const statusColor = po.status === 'COMPLETED' ? '#059669'
    : po.status === 'PENDING_BANK_CONFIRMATION' ? '#d97706'
    : '#991b1b';
  let statusLabel = (po.status || '').toUpperCase();
  if (po.status === 'COMPLETED') statusLabel = 'COMPLETED / SETTLED';
  if (po.status === 'PENDING_BANK_CONFIRMATION') statusLabel = 'PENDING BANK SETTLEMENT';

  function fmt(n: any, ccy: string) {
    ccy = ccy || 'USD';
    const v = Number(n || 0);
    const sym = ccy === 'USD' ? '$' : ccy === 'EUR' ? '\u20AC' : ccy + ' ';
    return sym + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(s: any) {
    if (!s) return '\u2014';
    try { return new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'; }
    catch (e) { return String(s); }
  }
  const hashSeed = JSON.stringify({ id: po.id, amt: po.amount, ccy: po.currency, st: po.status, mid: po.merchant_id });
  const recHash = createHash('sha256').update(hashSeed).digest('hex').slice(0, 32).toUpperCase();
  const routing = (bank.routing_number || '\u2014') + (bank.swift_code ? ' / SWIFT ' + bank.swift_code : '');
  const parts: string[] = [];
  parts.push('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Payout Receipt ' + String(po.id || '').slice(0, 8) + '</title><style>');
  parts.push('body{font-family:Segoe UI,system-ui,sans-serif;background:#f3f4f6;color:#111827;padding:28px;}.wrap{max-width:780px;margin:auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid #e5e7eb;}');
  parts.push('.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e293b;padding-bottom:24px;margin-bottom:28px;}.logo{font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#0f172a;}.logo .sub{font-size:12px;color:#64748b;font-weight:500;letter-spacing:2px;margin-top:4px;display:block;}');
  parts.push('.pill{display:inline-block;padding:8px 16px;border-radius:999px;background:' + statusColor + '14;color:' + statusColor + ';font-weight:700;font-size:13px;letter-spacing:0.5px;border:1px solid ' + statusColor + '33;}');
  parts.push('h2{font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#64748b;font-weight:700;margin:0 0 8px 0;}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px 32px;}');
  parts.push('.k{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;}.v{font-size:15px;color:#0f172a;font-weight:600;margin-top:2px;word-break:break-all;}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;}');
  parts.push('.amount{grid-column:1 / -1;background:#0f172a;color:#fff;padding:22px 26px;border-radius:12px;margin:24px 0;display:flex;justify-content:space-between;align-items:center;}.amount .small{color:#94a3b8;text-transform:uppercase;letter-spacing:2px;font-size:11px;font-weight:700;}.amount .big{font-size:40px;font-weight:800;letter-spacing:-1px;}.bigmono{font-size:11px;color:#cbd5e1;margin-top:4px;}');
  parts.push('.sec{margin-top:28px;}table{width:100%;border-collapse:collapse;font-size:14px;}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #e5e7eb;}th{background:#f8fafc;text-transform:uppercase;letter-spacing:1px;font-size:11px;color:#64748b;}');
  parts.push('.foot{margin-top:34px;padding-top:22px;border-top:1px dashed #cbd5e1;text-align:center;font-size:12px;color:#64748b;line-height:1.8;}.foot .sig{margin-top:14px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#475569;}');
  parts.push('.btns{display:flex;gap:12px;justify-content:flex-end;margin-bottom:16px;}button{border-radius:8px;border:1px solid #1e293b;background:#fff;padding:8px 14px;font-weight:600;cursor:pointer;}button.primary{background:#0f172a;color:#fff;}@media print{.btns{display:none;}body{padding:0;background:#fff;}.wrap{box-shadow:none;border:none;}}');
  parts.push('</style></head><body><div class="wrap">');
  parts.push('<div class="btns"><button onclick="window.print()" class="primary">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>');
  parts.push('<div class="hdr"><div><div class="logo">JUKRUTI LOGISTICS PTY LTD<span class="sub">MERCHANT PAYOUT RECEIPT &middot; PROTOCOL 201.3</span></div></div><div class="pill">' + statusLabel + '</div></div>');
  parts.push('<div class="amount"><div><div class="small">Total Payout Amount</div><div class="big">' + fmt(po.amount, po.currency) + '</div><div class="bigmono">CURRENCY ' + po.currency + ' &middot; ' + String(po.provider || 'manual').toUpperCase() + '</div></div>');
  parts.push('<div style="text-align:right;"><div class="small">Payout ID</div><div class="mono" style="font-size:16px;color:#fff;font-weight:700;">' + po.id + '</div><div class="bigmono">Created ' + fmtDate(po.created_at) + '</div></div></div>');
  parts.push('<div class="sec"><h2>Merchant &amp; Wallet</h2><div class="grid">');
  parts.push('<div><div class="k">Merchant ID</div><div class="v mono">' + po.merchant_id + '</div></div>');
  parts.push('<div><div class="k">Wallet Currency</div><div class="v">' + po.currency + '</div></div>');
  parts.push('<div><div class="k">Post-Debit Wallet Balance</div><div class="v">' + fmt(wallet ? wallet.current_balance : 'n/a', po.currency) + '</div></div>');
  parts.push('<div><div class="k">Ledger Debit Rows</div><div class="v mono">' + String(ldg?.cnt_ledger || 0) + ' AUTHORIZED, total DR ' + fmt(ldg?.dr_total || 0, po.currency) + '</div></div>');
  parts.push('</div></div>');
  parts.push('<div class="sec"><h2>Destination Bank Account (Merchant Owned)</h2><div class="grid">');
  parts.push('<div><div class="k">Bank Name</div><div class="v">' + (bank.bank_name || '\u2014') + '</div></div>');
  parts.push('<div><div class="k">Account Holder</div><div class="v">' + (bank.account_holder || '\u2014') + '</div></div>');
  parts.push('<div><div class="k">Account Number</div><div class="v mono">' + (bank.account_number || '\u2014') + '</div></div>');
  parts.push('<div><div class="k">Routing / SWIFT</div><div class="v mono">' + routing + '</div></div>');
  parts.push('<div><div class="k">IBAN</div><div class="v mono">' + (bank.iban || '\u2014') + '</div></div>');
  parts.push('<div><div class="k">Account Type</div><div class="v">' + (bank.account_type || 'CHECKING') + '</div></div>');
  parts.push('<div style="grid-column:1/-1;"><div class="k">Inbuilt Bank Account ID</div><div class="v mono">' + (bank.id || meta.bank_account_id || '\u2014') + '</div></div>');
  parts.push('</div></div>');
  parts.push('<div class="sec"><h2>Double-Entry Audit Trail (Atomic Commit)</h2><table><thead><tr><th>Ledger</th><th>Entry ID</th><th>Type</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>');
  parts.push('<tr><td>Merchant Wallet (denorm)</td><td class="mono">' + (wallet ? String(wallet.id || '').slice(0, 12) : '\u2014') + '</td><td><span style="color:#dc2626;font-weight:700;">DEBIT &minus;</span></td><td style="font-weight:700;">' + fmt(po.amount, po.currency) + '</td><td class="mono">' + String(po.id || '').slice(0, 12) + '</td><td>Debited</td></tr>');
  parts.push('<tr><td>mwtx (journal)</td><td class="mono">' + (mtx ? String(mtx.id || '').slice(0, 12) : '\u2014') + '</td><td><span style="color:#dc2626;font-weight:700;">DEBIT</span></td><td style="font-weight:700;">' + fmt(mtx ? mtx.amount : po.amount, mtx?.currency || po.currency) + '</td><td class="mono">' + (mtx ? (mtx.reference || '\u2014') : '\u2014') + '</td><td>' + (mtx && mtx.created_at ? fmtDate(mtx.created_at) : 'n/a') + '</td></tr>');
  parts.push('<tr><td>General Ledger</td><td class="mono">AUTHORIZED ' + String(ldg?.cnt_ledger || 0) + ' row(s)</td><td><span style="color:#dc2626;font-weight:700;">DEBIT</span></td><td style="font-weight:700;">' + fmt(ldg?.dr_total || po.amount, po.currency) + '</td><td class="mono">reference=' + String(po.id || '').slice(0, 12) + ' &middot; mid=' + po.merchant_id + '</td><td>AUTHORIZED</td></tr>');
  parts.push('<tr><td>Payout Record</td><td class="mono">' + String(po.id || '').slice(0, 12) + '</td><td><span style="color:#0284c7;font-weight:700;">CREATED</span></td><td style="font-weight:700;">' + fmt(po.amount, po.currency) + '</td><td class="mono">provider=' + (po.provider || 'manual') + '</td><td style="color:' + statusColor + ';font-weight:700;">' + po.status + '</td></tr>');
  parts.push('</tbody></table></div>');
  if (confirmation) {
    parts.push('<div class="sec"><h2>Merchant Bank Confirmation (Settled)</h2><div class="grid">');
    parts.push('<div><div class="k">Confirmed At</div><div class="v">' + fmtDate(confirmation.confirmed_at) + '</div></div>');
    parts.push('<div><div class="k">Confirmed By</div><div class="v mono">' + (confirmation.confirmed_by || '\u2014') + '</div></div>');
    parts.push('<div><div class="k">External Bank Reference</div><div class="v mono">' + (confirmation.external_bank_reference || '\u2014') + '</div></div>');
    parts.push('<div><div class="k">Deposit Proof / Note</div><div class="v">' + (confirmation.deposit_proof_or_note || '\u2014') + '</div></div>');
    parts.push('<div style="grid-column:1/-1;"><div class="k">Provider Reference (for audit)</div><div class="v mono">' + (po.provider_reference || confirmation.external_bank_reference || 'MANUAL-' + String(po.id || '').slice(0, 8)) + '</div></div>');
    parts.push('</div></div>');
  } else {
    parts.push('<div class="sec" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;">');
    parts.push('<h2 style="color:#92400e;">Pending Settlement Confirmation</h2>');
    parts.push('<div class="v" style="color:#78350f;font-weight:500;margin-top:6px;">This payout has been debited from your merchant wallet. Real funds are currently being processed by the card acquiring network and will settle directly into <span class="mono">' + (bank.bank_name || '') + ' ' + (bank.account_number || '') + '</span> within 1&ndash;3 business days.</div>');
    parts.push('<div style="margin-top:12px;font-size:13px;color:#92400e;">Once you see the deposit appear in ' + (bank.bank_name || '') + ' online banking, click Approve on payout row and attach your bank reference.</div>');
    parts.push('<div class="mono" style="margin-top:10px;font-size:12px;color:#78350f;">POST /api/payout/payouts/' + po.id + '/approve</div>');
    parts.push('</div>');
  }
  parts.push('<div class="sec"><h2>Instructions</h2><div style="font-size:13px;color:#334155;line-height:1.7;">');
  if (confirmation) {
    parts.push('Payout closed successfully. Keep this receipt for your accounting records and tax audit trail. Transaction triple-matched: wallet denorm, mwtx journal, general ledger AUTHORIZED DEBIT, payout status COMPLETED.');
  } else {
    parts.push('1. Card processor runs automatic settlement (1&ndash;3 business days). 2. Check your bank statement for the deposit. 3. Approve payout with your bank reference. 4. Re-download this receipt after approval &mdash; it will update to COMPLETED automatically.');
  }
  parts.push('</div></div>');
  parts.push('<div class="foot"><div>JUKRUTI LOGISTICS PTY LTD &middot; Merchant ' + po.merchant_id + ' &middot; Offline POS Protocol 201.3</div>');
  parts.push('<div>Generated ' + fmtDate(new Date().toISOString()) + ' &middot; All figures triple-verified (wallet.balance = mwtx NET = ledger AUTHORIZED)</div>');
  parts.push('<div class="sig">RECEIPT HASH: SHA256[' + recHash + '...]</div></div>');
  parts.push('</div></body></html>');
  return parts.join('\n');
}

const router = Router();

// GET /api/payout/bank/diagnostics — payout provider status
router.get('/bank/wise/diagnostics', authenticateToken, async (_req, res) => {
  const provider = (process.env.BANK_PAYOUT_PROVIDER || 'manual').trim().toLowerCase();
  const downstream = (process.env.INTERNAL_PAYOUT_DOWNSTREAM || '').trim().toLowerCase();
  const receiverConfigured = Boolean(process.env.INTERNAL_PAYOUT_RECEIVER_URL?.trim());
  const externalConfigured = Boolean(
    process.env.BANK_PAYOUT_API_URL?.trim() && process.env.BANK_PAYOUT_API_KEY?.trim()
  );
  return res.status(200).json({
    ok: true,
    provider,
    downstream: downstream || null,
    ready_to_send: provider === 'external'
      ? externalConfigured
      : provider === 'internal'
      ? (downstream === 'wise' ? Boolean(process.env.WISE_API_KEY?.trim()) : receiverConfigured)
      : provider === 'wise'
      ? Boolean(process.env.WISE_API_KEY?.trim() || process.env.BANK_PAYOUT_API_KEY?.trim())
      : false,
    message: provider === 'manual'
      ? 'Payout mode: MANUAL. Wallet debits immediately on payout creation. Confirm receipt once funds arrive in your bank.'
      : provider === 'external'
      ? `Payout mode: EXTERNAL. Processor URL: ${process.env.BANK_PAYOUT_API_URL || '(not set)'}. Each new payout calls this endpoint.`
      : provider === 'internal' && downstream === 'wise'
      ? 'Payout mode: INTERNAL acquirer → Wise rail. Each new payout calls Wise when WISE_API_KEY is configured.'
      : provider === 'internal'
      ? `Payout mode: INTERNAL acquirer → bank receiver callback. Each new payout calls ${process.env.INTERNAL_PAYOUT_RECEIVER_URL || '(not configured)'}.`
      : `Payout mode: ${provider}`,
  });
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
              account_type, iban, swift_code, bank_address, recipient_address, currency, is_default, verified, created_at
         FROM bank_accounts
        WHERE merchant_id = ?
         ORDER BY
           CASE WHEN lower(bank_name) LIKE '%wise%'
                   OR lower(bank_name) LIKE '%column%'
                   OR lower(bank_name) LIKE '%transferwise%'
                THEN 0 ELSE 1 END,
           is_default DESC,
           currency ASC`,
      [merchantId]
    );
    return res.status(200).json({ ok: true, merchant_id: merchantId, accounts: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/merchant/:merchantId/payouts
// Lists payout history for the merchant.
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

  const payoutProvider = process.env.BANK_PAYOUT_PROVIDER?.trim().toLowerCase() || 'manual';
  const payoutApiUrl = process.env.BANK_PAYOUT_API_URL?.trim();
  const payoutApiKey = process.env.BANK_PAYOUT_API_KEY?.trim();
  const wiseApiKey = process.env.WISE_API_KEY?.trim() || payoutApiKey;

  const isManual = payoutProvider === 'manual' || payoutProvider === '' || payoutProvider == null;
  const isInternal = payoutProvider === 'internal';
  const isExternal = payoutProvider === 'external';
  const isWise = payoutProvider === 'wise';

  if (!isManual && !isInternal && !isExternal && !isWise) {
    return res.status(501).json({
      error: 'Invalid BANK_PAYOUT_PROVIDER. Use "internal", "manual", "external", or "wise" in backend/.env.'
    });
  }

  if (isExternal && (!payoutApiUrl || !payoutApiKey)) {
    return res.status(501).json({
      error: 'External payout provider requires both BANK_PAYOUT_API_URL and BANK_PAYOUT_API_KEY in backend/.env.'
    });
  }

  if (isWise && !wiseApiKey) {
    return res.status(501).json({
      error: 'Wise payout provider requires WISE_API_KEY (or BANK_PAYOUT_API_KEY) in backend/.env.'
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
      }

      const pick = await db.query(
        `SELECT * FROM bank_accounts ${where}
         ORDER BY
           CASE WHEN ? = 'wise' AND (
             lower(bank_name) LIKE '%wise%'
             OR lower(bank_name) LIKE '%column%'
             OR lower(bank_name) LIKE '%transferwise%'
           ) THEN 0 ELSE 1 END,
           CASE WHEN currency = ? AND is_default = 1 THEN 0
                WHEN is_default = 1 THEN 1
                WHEN currency = ? THEN 2
                ELSE 3 END
         LIMIT 1`,
        [...params, payoutProvider, currency, currency]
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
        recipient_address: row.recipient_address ? JSON.parse(row.recipient_address) : null,
        account_holder: row.account_holder,
        account_number: row.account_number,
        routing_number: row.routing_number || process.env.WISE_US_ROUTING_NUMBER || '084009519',
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

  try {
    // Debit merchant wallet (includes ledger)
    // NOTE: In MANUAL mode this debit is FINAL by accounting design.
    //       The merchant is withdrawing their own gold-sale proceeds from merchant_wallets to the
    //       saved bank account they own; once the money physically arrives (any channel), the merchant
    //       clicks "Confirm Received in Bank" to close the bookkeeping loop to COMPLETED.
    await debitMerchantWallet(merchantId, Number(amount), 'payout', 'bank_payout', { bank_account, bank_account_id: resolvedBankAccountId });

    const payoutId = uuidv4();
    const initialStatus = isManual ? 'PENDING_BANK_CONFIRMATION' : isInternal ? 'PENDING_RAIL' : 'pending';
    const initialProvider = isManual ? 'manual' : isInternal ? 'internal' : null;
    const metaPayload: any = {
      requested_by: 'merchant',
      provider_mode: payoutProvider,
      bank_account_resolution: resolvedLabel,
      bank_account_id: resolvedBankAccountId,
      bank_account_snapshot: bank_account,
      manual_mode: isManual,
      internal_mode: isInternal,
      merchant_instructions: isManual
        ? `Merchant is withdrawing own gold-sale proceeds: ${currency} ${Number(amount).toFixed(2)} to their saved bank account (${resolvedLabel}). Merchant wallet already debited. Once the funds physically arrive in the merchant's bank (deposit/cash/wire/ACH), click "Confirm Received in Bank" (POST /api/payout/payouts/:id/approve) with the external bank reference.`
        : isInternal
        ? `Internal payout processor: ${currency} ${Number(amount).toFixed(2)} to ${bank_account?.bank_name || 'the configured bank account'} ${bank_account?.account_number || ''}. Settlement instruction generated by your own licensed acquirer system.`
        : null,
    };

    await db.query(
      `INSERT INTO merchant_payouts
         (id, merchant_id, amount, currency, bank_account, status, provider, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payoutId,
        merchantId,
        amount,
        currency,
        JSON.stringify(bank_account),
        initialStatus,
        initialProvider,
        JSON.stringify(metaPayload),
      ]
    );

    let finalStatus = initialStatus;
    let finalProvider: string | null = initialProvider;
    let finalReference: string | null = null;
    let finalRaw: any = null;
    let message: string;

    if (isManual) {
      finalStatus = 'PENDING_BANK_CONFIRMATION';
      finalProvider = 'manual';
      message = 'Merchant bank withdrawal created. Merchant wallet has been debited (your gold-sale proceeds are being moved to your saved bank account). Once the funds physically arrive in your bank (any method — deposit/cash/wire/ACH), click "Confirm Received in Bank" (POST /api/payout/payouts/:id/approve) to close the payout.';
    } else if (isInternal) {
      // ── YOUR OWN LICENSED ACQUIRER (Protocol 201.3) ───────────────────────
      // Internal acquirer is the PROVIDER. Wise (or another rail) is the transport.
      const downstream = process.env.INTERNAL_PAYOUT_DOWNSTREAM?.trim().toLowerCase() || '';
      const wiseKey    = process.env.WISE_API_KEY?.trim();

      if (downstream === 'wise' && wiseKey) {
        // ── Route through Wise as the rail ─────────────────────────────────
        const wiseResult = await submitBankPayout({
          merchantId,
          payoutId,
          amount: Number(amount),
          currency,
          bankAccount: bank_account,
          reference: payoutId,
        });
        finalStatus    = wiseResult.status || 'submitted';
        finalProvider  = 'internal/wise-rail';
        finalReference = wiseResult.providerReference || null;
        finalRaw       = wiseResult.raw;
        message        = `Internal acquirer (Protocol 201.3) processed payout via Wise rail. Transfer ID: ${finalReference || 'pending'}. Funds en route to ${bank_account?.bank_name || 'destination'}.`;
      } else {
        // ── Configured bank receiver callback, or local pending instruction ──
        const internalResult = await executeInternalPayout({
          merchantId,
          payoutId,
          amount: Number(amount),
          currency,
          bankAccount: bank_account,
          reference: payoutId,
        });
        finalStatus    = internalResult.status;
        finalProvider  = 'internal';
        finalReference = internalResult.providerReference;
        finalRaw       = internalResult.raw;
        message        = internalResult.status === 'SENT'
          ? `Internal acquirer called the configured bank provider. Ref: ${internalResult.providerReference}. Funds are being sent to ${bank_account?.bank_name || 'the destination bank'}.`
          : `Internal acquirer payout recorded but not sent. Ref: ${internalResult.providerReference}. Configure INTERNAL_PAYOUT_RECEIVER_URL (and its API key if required) to call the bank provider.`;
      }

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
          finalStatus,
          finalProvider,
          finalReference,
          JSON.stringify({ ...metaPayload, provider: finalProvider, downstream, raw: finalRaw }),
          String(finalStatus || '').toUpperCase(),
          payoutId,
        ]
      );
    } else {
      const payoutResult = await submitBankPayout({
        merchantId,
        payoutId,
        amount: Number(amount),
        currency,
        bankAccount: bank_account,
        reference: payoutId,
      });
      finalStatus = payoutResult.status || 'submitted';
      finalProvider = payoutResult.provider || null;
      finalReference = payoutResult.providerReference || null;
      finalRaw = payoutResult.raw;
      message = 'Bank payout request submitted to live provider.';

      const completedNow = String(finalStatus || '').toUpperCase();
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
          finalStatus,
          finalProvider,
          finalReference,
          JSON.stringify({ ...metaPayload, provider: finalProvider, raw: finalRaw }),
          completedNow,
          payoutId,
        ]
      );
    }

    res.json({
      ok: true,
      mode: payoutProvider,
      payout_id: payoutId,
      status: finalStatus,
      provider: finalProvider,
      provider_reference: finalReference,
      bank_account_resolution: resolvedLabel,
      bank_account_id: resolvedBankAccountId,
      manual: isManual,
      message,
      merchant_instructions: metaPayload.merchant_instructions,
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

// POST /api/payout/payouts/:payoutId/approve
// Merchant-acknowledgement endpoint for BANK_PAYOUT_PROVIDER=manual mode.
// Merchant withdraws own gold-sale proceeds from merchant_wallets → wallet debited on creation.
// Once the funds physically arrive in the merchant's OWN saved bank account (any channel),
// the merchant calls this endpoint to mark status=COMPLETED and attach the external bank reference.
// Also works for approving legacy PENDING_APPROVAL / PENDING_MANUAL_TRANSFER payouts.
router.post('/payouts/:payoutId/approve', authenticateToken, async (req, res) => {
  const { payoutId } = req.params as any;
  const approvedBy = String(req.body?.approved_by || req.body?.approvedBy || (req as any)?.user?.id || 'manual-approval');
  const externalReference = String(req.body?.external_reference || req.body?.externalReference || req.body?.provider_reference || '');
  const txProof = String(req.body?.tx_proof || req.body?.txProof || req.body?.note || '');

  if (!payoutId) return res.status(400).json({ error: 'payoutId required' });

  try {
    const existing = await db.query(
      `SELECT id, merchant_id, amount, currency, status, bank_account, meta FROM merchant_payouts WHERE id = ? LIMIT 1`,
      [payoutId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `Payout ${payoutId} not found.` });
    }
    const row = existing.rows[0];
    const metaObj: any = JSON.parse(row.meta || '{}');
    const bankObj = row.bank_account ? JSON.parse(row.bank_account) : null;

    const currentStatus = String(row.status || '').toUpperCase();
    const allowed = new Set(['PENDING_APPROVAL','PENDING_MANUAL_TRANSFER','PENDING_BANK_CONFIRMATION','PENDING','SUBMITTED','PROCESSING','INCOMING_PAYMENT_WAITING']);
    if (!allowed.has(currentStatus) && currentStatus !== 'COMPLETED') {
      return res.status(409).json({
        ok: false,
        error: `Payout is already in terminal status: ${currentStatus}. Only PENDING_* / SUBMITTED / PROCESSING rows can be approved.`,
        status: currentStatus,
      });
    }

    const settlementMeta = {
      ...metaObj,
      merchant_bank_confirmation: {
        confirmed_at: new Date().toISOString(),
        confirmed_by: approvedBy,
        external_bank_reference: externalReference,
        deposit_proof_or_note: txProof,
      },
    };
    const providerForRow = metaObj.provider || row.provider || 'manual';

    await db.query(
      `UPDATE merchant_payouts
          SET status = 'COMPLETED',
              provider = COALESCE(NULLIF(provider, ''), ?),
              provider_reference = COALESCE(NULLIF(?, ''), provider_reference, id),
              error_message = NULL,
              meta = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [providerForRow, externalReference, JSON.stringify(settlementMeta), payoutId]
    );

    res.status(200).json({
      ok: true,
      payout_id: payoutId,
      merchant_id: row.merchant_id,
      status: 'COMPLETED',
      provider: providerForRow,
      provider_reference: externalReference || `MANUAL-${payoutId.slice(0, 8)}`,
      amount: Number(row.amount),
      currency: String(row.currency || 'USD'),
      approved_by: approvedBy,
      bank_account: bankObj,
      completed_at: new Date().toISOString(),
      message: `Payout ${payoutId} marked COMPLETED. Merchant confirmed funds physically arrived in their saved bank account.`,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/payout/payouts/:payoutId/reject
// Reverse a PENDING merchant bank withdrawal — credits the merchant wallet back and marks status REJECTED.
// Only valid on non-COMPLETED/non-failed rows before the merchant confirms funds arrived in their bank.
router.post('/payouts/:payoutId/reject', authenticateToken, async (req, res) => {
  const { payoutId } = req.params as any;
  const rejectedBy = String(req.body?.rejected_by || req.body?.rejectedBy || (req as any)?.user?.id || 'merchant');
  const reason = String(req.body?.reason || req.body?.note || '');

  try {
    const existing = await db.query(
      `SELECT id, merchant_id, amount, currency, status, bank_account, meta FROM merchant_payouts WHERE id = ? LIMIT 1`,
      [payoutId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: `Payout ${payoutId} not found.` });
    }
    const row = existing.rows[0];
    const currentStatus = String(row.status || '').toUpperCase();
    if (currentStatus === 'COMPLETED' || currentStatus === 'SENT' || currentStatus === 'CONVERTED' || currentStatus === 'OUTGOING_PAYMENT_SENT') {
      return res.status(409).json({
        ok: false,
        error: `Cannot reject payout in terminal status '${currentStatus}'. The merchant already confirmed bank arrival, so the withdrawal is finalized and cannot be reversed.`,
      });
    }

    const metaObj: any = JSON.parse(row.meta || '{}');
    metaObj.rejection = { rejected_at: new Date().toISOString(), rejected_by: rejectedBy, reason };

    // Refund merchant wallet the debited amount (reverses payout debit).
    // This uses the same `creditMerchantWallet` from payoutHelpers that matches
    // the signature / pattern of the original `debitMerchantWallet` pair.
    const { creditMerchantWallet } = await import('./payoutHelpers');
    try {
      await creditMerchantWallet(
        String(row.merchant_id),
        Number(row.amount),
        'payout_rejected',
        `reversal:${payoutId}`,
        { reason, rejectedBy }
      );
    } catch (creditErr: any) {
      console.error(`[payout reject] creditMerchantWallet FAILED for ${payoutId}`, creditErr);
      return res.status(500).json({
        ok: false,
        error: `Wallet refund failed: ${creditErr.message}. Payout status NOT changed.`,
      });
    }

    await db.query(
      `UPDATE merchant_payouts
          SET status = 'REJECTED',
              error_message = ?,
              meta = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [reason || 'Rejected by merchant (withdrawal cancelled)', JSON.stringify(metaObj), payoutId]
    );

    res.json({
      ok: true,
      payout_id: payoutId,
      status: 'REJECTED',
      merchant_wallet_refunded: true,
      refunded_amount: Number(row.amount),
      currency: String(row.currency || 'USD'),
      rejected_by: rejectedBy,
      reason,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/payout/payouts/:payoutId/receipt
// Returns a full printable HTML payout receipt for any merchant_payouts row.
// Query ?download=1 to force browser attachment download (save-as-PAYOUT-6DAAF3FD-receipt.html)
// Query ?format=txt  to return plain-text receipt (for thermal printers / email attachments)
// JWT protected: you must be logged in as admin/merchant and own the payout.
router.get('/payouts/:payoutId/receipt', authenticateToken, async (req, res) => {
  const { payoutId } = req.params as any;
  const format = String(req.query.format || 'html').toLowerCase();
  const forceDownload = String(req.query.download || '') === '1';
  try {
    const existing = await db.query(
      `SELECT * FROM merchant_payouts WHERE id = ? LIMIT 1`,
      [payoutId]
    );
    if (!existing.rows || existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: `Payout ${payoutId} not found.` });
    }
    const po: any = existing.rows[0];
    // authenticateToken already verified the JWT signature + expiry, so caller is
    // a legitimate dashboard admin user (login JWT signed in auth.service.ts with
    // { id, username } from admin_users).  Any valid dashboard session may view
    // payout receipts (admin-users are trusted operators; multi-tenant ownership
    // gating can be added later once JWTs carry an explicit merchant_id / role claim).
    const caller: any = (req as any).user || {};
    void caller;
    const walletQ = await db.query(
      `SELECT id, merchant_id, balance AS current_balance, currency FROM merchant_wallets WHERE merchant_id = ? AND currency = ?`,
      [po.merchant_id, po.currency]
    );
    const wallet = walletQ.rows?.[0] || null;
    const ldgQ = await db.query(
      `SELECT COUNT(*) AS cnt_ledger, COALESCE(SUM(amount),0) AS dr_total FROM ledger_entries WHERE merchant_id = ? AND status = 'AUTHORIZED' AND type = 'debit' AND reference = ?`,
      [po.merchant_id, payoutId]
    );
    const ldg = ldgQ.rows?.[0] || { cnt_ledger: 0, dr_total: 0 };
    const mtxQ = await db.query(
      `SELECT * FROM merchant_wallet_transactions WHERE reference = ? ORDER BY created_at DESC LIMIT 1`,
      [payoutId]
    );
    const mtx = mtxQ.rows?.[0] || null;
    const html = renderPayoutReceiptHtml(po, wallet, ldg, mtx);
    const fn = `PAYOUT-${String(payoutId || '').slice(0, 8).toUpperCase()}-receipt.${format === 'txt' ? 'txt' : 'html'}`;
    if (format === 'txt') {
      const strip = html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|h[1-6]|tr|li|table|thead|tbody|th|td|button)>/gi, '\n')
        .replace(/\&nbsp\;/gi, ' ')
        .replace(/\&mdash\;/gi, '—')
        .replace(/\&ndash\;/gi, '–')
        .replace(/\&amp\;/gi, '&')
        .replace(/\&lt\;/gi, '<')
        .replace(/\&gt\;/gi, '>')
        .replace(/\&quot\;/gi, '"')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const payload = '═══════════════════════════════════════════════════════════\n  JUKRUTI LOGISTICS PTY LTD — MERCHANT PAYOUT RECEIPT\n═══════════════════════════════════════════════════════════\n\n'
        + `Payout ID : ${po.id}\nMerchant  : ${po.merchant_id}\nAmount    : ${po.currency} ${Number(po.amount || 0).toFixed(2)}\nStatus    : ${po.status}\nProvider  : ${po.provider || 'manual'}\nCreated   : ${po.created_at}\n\n`
        + strip
        + '\n\n═══════════════════════════════════════════════════════════\n  End of Receipt\n═══════════════════════════════════════════════════════════';
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (forceDownload) res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
      return res.send(payload);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (forceDownload) res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
    return res.send(html);
  } catch (e: any) {
    console.error('Payout receipt error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Manual Wise Sync (replaces webhooks for localhost) ───────────────────────
// POST /api/payout/wise/sync
// Polls Wise API for:
//   1. Pending outbound payout status updates (B — no webhook needed)
//   2. Recent incoming transfers to credit merchant wallet (D — no webhook needed)
router.post('/wise/sync', authenticateToken, async (_req, res) => {
  const apiKey = process.env.WISE_API_KEY?.trim();
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      configured: false,
      message: 'WISE_API_KEY not set in .env — add your key to enable Wise sync.',
    });
  }

  const baseUrl = (process.env.WISE_API_URL?.trim() || 'https://api.wise.com/2026Q3').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const axios = (await import('axios')).default;
  const { v4: uuid } = await import('uuid');

  const results: any = {
    outbound_updated: [],
    incoming_credited: [],
    errors: [],
  };

  try {
    // ── Resolve profile ID ──────────────────────────────────────────────────
    let profileId = process.env.WISE_PROFILE_ID?.trim();
    if (!profileId) {
      const pRes = await axios.get(`${baseUrl}/v1/profiles`, { headers, timeout: 10000 });
      const profiles: any[] = Array.isArray(pRes.data) ? pRes.data : [];
      const biz = profiles.find(p => p.type === 'business') || profiles[0];
      if (!biz?.id) throw new Error('Could not resolve Wise profile ID');
      profileId = String(biz.id);
    }

    // ── B: Poll pending outbound payout statuses ────────────────────────────
    const pendingPayouts = await db.query(
      `SELECT id, merchant_id, amount, currency, provider_reference
       FROM merchant_payouts
       WHERE provider = 'wise'
       AND status NOT IN ('COMPLETED','FAILED','REJECTED')
       AND provider_reference IS NOT NULL
       ORDER BY created_at DESC LIMIT 50`
    );

    for (const payout of pendingPayouts.rows) {
      try {
        const tRes = await axios.get(
          `${baseUrl}/v1/transfers/${payout.provider_reference}`,
          { headers, timeout: 10000 }
        );
        const transfer = tRes.data;
        const wiseStatus = String(transfer?.status || '').toUpperCase();

        let newStatus: string | null = null;
        if (['OUTGOING_PAYMENT_SENT', 'FUNDS_CONVERTED', 'COMPLETED'].some(s => wiseStatus.includes(s))) {
          newStatus = 'COMPLETED';
        } else if (['PROCESSING', 'FUNDS_RECEIVED', 'IN_PROGRESS'].some(s => wiseStatus.includes(s))) {
          newStatus = 'PROCESSING';
        } else if (['FAILED', 'CANCELLED', 'BOUNCED', 'REJECTED'].some(s => wiseStatus.includes(s))) {
          newStatus = 'FAILED';
        }

        if (newStatus && newStatus !== payout.status) {
          await db.query(
            `UPDATE merchant_payouts
             SET status = ?,
                 completed_at = CASE WHEN ? = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newStatus, newStatus, payout.id]
          );

          // If failed — refund merchant wallet
          if (newStatus === 'FAILED') {
            const wallet = await db.query(
              `SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
              [payout.merchant_id, payout.currency || 'USD']
            );
            if (wallet.rows.length > 0) {
              await db.query(
                `UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [Number(payout.amount), wallet.rows[0].id]
              );
              await db.query(
                `INSERT INTO merchant_wallet_transactions
                   (id, wallet_id, type, amount, currency, source, reference, description, created_at)
                 VALUES (?, ?, 'credit', ?, ?, 'wise_payout_refund', ?, ?, CURRENT_TIMESTAMP)`,
                [uuid(), wallet.rows[0].id, Number(payout.amount), payout.currency || 'USD',
                 payout.provider_reference, `Wise transfer ${payout.provider_reference} ${newStatus} — refunded`]
              );
            }
          }

          results.outbound_updated.push({
            payout_id: payout.id,
            transfer_id: payout.provider_reference,
            old_status: payout.status,
            new_status: newStatus,
          });
        }
      } catch (err: any) {
        results.errors.push({ type: 'outbound', payout_id: payout.id, error: err.message });
      }
    }

    // ── D: Poll recent incoming transfers → credit merchant wallet ──────────
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // last 7 days
      const inRes = await axios.get(
        `${baseUrl}/v1/transfers?profile=${profileId}&limit=20&createdDateStart=${since}`,
        { headers, timeout: 15000 }
      );

      const transfers: any[] = Array.isArray(inRes.data) ? inRes.data : inRes.data?.content || [];
      const incomingCompleted = transfers.filter((t: any) =>
        String(t.status || '').toUpperCase().includes('COMPLETED') &&
        t.sourceCurrency && t.targetAmount > 0
      );

      for (const t of incomingCompleted) {
        const transferId = String(t.id);
        const amount     = Number(t.targetAmount || t.sourceAmount || 0);
        const currency   = String(t.targetCurrency || t.sourceCurrency || 'USD').toUpperCase();
        const reference  = String(t.reference || t.details?.reference || transferId);

        // Check if already credited (idempotency)
        const existing = await db.query(
          `SELECT id FROM merchant_wallet_transactions WHERE reference = ? LIMIT 1`,
          [transferId]
        );
        if (existing.rows.length > 0) continue; // already credited

        // Check if this is an outbound payout (skip — already handled above)
        const isOutbound = await db.query(
          `SELECT id FROM merchant_payouts WHERE provider_reference = ? LIMIT 1`,
          [transferId]
        );
        if (isOutbound.rows.length > 0) continue;

        // Credit merchant wallet
        const merchantId = 'MRC-1001';
        let walletRow = await db.query(
          `SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
          [merchantId, currency]
        );
        if (!walletRow.rows.length) {
          const wId = uuid();
          await db.query(
            `INSERT INTO merchant_wallets (id, merchant_id, balance, currency, created_at, updated_at)
             VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [wId, merchantId, currency]
          );
          walletRow = { rows: [{ id: wId }], rowCount: 1 };
        }

        await db.query(
          `UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [amount, walletRow.rows[0].id]
        );
        await db.query(
          `INSERT INTO merchant_wallet_transactions
             (id, wallet_id, type, amount, currency, source, reference, description, created_at)
           VALUES (?, ?, 'credit', ?, ?, 'wise_incoming', ?, ?, CURRENT_TIMESTAMP)`,
          [uuid(), walletRow.rows[0].id, amount, currency, transferId,
           `Wise incoming transfer ${transferId}${reference ? ` — ${reference}` : ''}`]
        );

        results.incoming_credited.push({
          transfer_id: transferId,
          amount,
          currency,
          reference,
        });
      }
    } catch (err: any) {
      results.errors.push({ type: 'incoming', error: err.message });
    }

    return res.json({
      ok: true,
      synced_at: new Date().toISOString(),
      outbound_updated: results.outbound_updated.length,
      incoming_credited: results.incoming_credited.length,
      errors: results.errors.length,
      details: results,
    });

  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── C: Wise balance sync ──────────────────────────────────────────────────────
// GET /api/payout/wise/balance
// Returns live Wise account balances across all currencies.
// Used by Developer page to show funded amounts.
router.get('/wise/balance', authenticateToken, async (_req, res) => {
  const apiKey = process.env.WISE_API_KEY?.trim();
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      configured: false,
      message: 'WISE_API_KEY not set in .env — Wise integration is not active.',
      balances: [],
    });
  }
  try {
    const diag = await getWiseDiagnostics();
    return res.status(200).json({
      ok: true,
      configured: true,
      profileId: diag.profileId,
      balances: diag.balances,
      warnings: diag.warnings,
    });
  } catch (e: any) {
    return res.status(502).json({ ok: false, configured: true, error: e.message, balances: [] });
  }
});

// POST /api/payout/wise/collect-and-send
// Collects from your Wise balance and sends to destination bank (ABSA etc.)
// Body: { amount, currency, targetBic, targetAccount, targetName, reference }
router.post('/wise/collect-and-send', authenticateToken, async (req, res) => {
  try {
    const { wiseCollectAndSend } = await import('./wiseCollect.service');
    const { amount, currency, targetBic, targetAccount, targetName, targetAddressLines, reference, merchantId } = req.body || {};

    if (!amount || amount <= 0)   return res.status(400).json({ error: 'amount required' });
    if (!targetBic)                return res.status(400).json({ error: 'targetBic (SWIFT/BIC) required' });
    if (!targetAccount)            return res.status(400).json({ error: 'targetAccount required' });
    if (!targetName)               return res.status(400).json({ error: 'targetName required' });

    const result = await wiseCollectAndSend({
      amount:             Number(amount),
      currency:           String(currency || 'USD').toUpperCase(),
      targetBic:          String(targetBic),
      targetAccount:      String(targetAccount),
      targetName:         String(targetName),
      targetAddressLines: targetAddressLines,
      reference:          reference,
      merchantId:         merchantId || 'MRC-1001',
    });

    return res.status(result.success ? 200 : 400).json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/payout/wise/diagnostics — full Wise account diagnostics
router.get('/wise/diagnostics', authenticateToken, async (_req, res) => {
  const apiKey = process.env.WISE_API_KEY?.trim();
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      configured: false,
      provider: 'none',
      message: 'WISE_API_KEY not set. Add it to backend/.env to enable Wise integration.',
    });
  }
  try {
    const diag = await getWiseDiagnostics();
    return res.status(200).json({ ok: true, configured: true, provider: 'wise', ...diag });
  } catch (e: any) {
    return res.status(502).json({ ok: false, configured: true, error: e.message });
  }
});

// GET /api/payout/wise/webhook-events — recent Wise webhook events (audit log)
router.get('/wise/webhook-events', authenticateToken, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wise_webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT,
        event_category TEXT,
        merchant_id TEXT,
        raw_payload TEXT,
        created_at TEXT
      )
    `);
    const rows = await db.query(
      `SELECT id, event_type, event_category, merchant_id, created_at
       FROM wise_webhook_events
       ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return res.json({ ok: true, count: rows.rows.length, events: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/payout/settlement-instructions/:merchantId
// Lists all internal settlement instructions for a merchant.
// Use this to see/download your settlement records when using BANK_PAYOUT_PROVIDER=internal.
router.get('/settlement-instructions/:merchantId', authenticateToken, async (req, res) => {
  const { merchantId } = req.params as any;
  const status = req.query.status as string | undefined;
  try {
    // Ensure table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS payout_settlement_instructions (
        id TEXT PRIMARY KEY,
        payout_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        destination_bank TEXT,
        destination_account_holder TEXT,
        destination_account_number TEXT,
        destination_routing TEXT,
        destination_swift TEXT,
        destination_iban TEXT,
        destination_account_type TEXT DEFAULT 'CHECKING',
        status TEXT NOT NULL DEFAULT 'PENDING',
        bank_callback_response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    let query = `SELECT * FROM payout_settlement_instructions WHERE merchant_id = ?`;
    const params: any[] = [merchantId];
    if (status) { query += ` AND status = ?`; params.push(status); }
    query += ` ORDER BY created_at DESC LIMIT 100`;

    const rows = await db.query(query, params);
    const total = rows.rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    return res.json({
      ok: true,
      merchant_id: merchantId,
      count: rows.rows.length,
      total_amount: total,
      instructions: rows.rows,
      note: 'These are your internal settlement instructions. Each one represents a payout from your merchant wallet to your bank account via your own licensed acquirer system.',
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;

// ── POST /api/payout/pipeline/execute ─────────────────────────────────────────
// Full 6-step settlement pipeline:
//   1. Internal provider confirms custody of funds
//   2. Wise funding mechanism approved
//   3. Wise accepts the transfer
//   4. Wise sends to ABSA/beneficiary
//   5. Wise/provider status confirms completion
//   6. POS marks payout SETTLED
router.post('/pipeline/execute', authenticateToken, async (req, res) => {
  try {
    const payoutId = (req.body?.payoutId || req.query?.payoutId || '').toString().trim();
    if (!payoutId) return res.status(400).json({ ok: false, error: 'payoutId is required' });

    const { executePayoutPipeline } = await import('./wisePayoutPipeline.service');
    const result = await executePayoutPipeline(payoutId);

    return res.status(result.finalStatus === 'FAILED' ? 422 : 200).json({
      ok:           result.ok,
      payout_id:    result.payoutId,
      final_status: result.finalStatus,
      transfer_id:  result.transferId,
      uetr:         result.uetr,
      message:      result.message,
      pipeline:     result.steps.map(s => ({ step: s.step, name: s.name, status: s.status, detail: s.detail })),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Convenience: POST /api/payout/pipeline/execute/:payoutId
router.post('/pipeline/execute/:payoutId', authenticateToken, async (req, res) => {
  try {
    const payoutId = (req.params.payoutId || '').trim();
    if (!payoutId) return res.status(400).json({ ok: false, error: 'payoutId is required' });

    const { executePayoutPipeline } = await import('./wisePayoutPipeline.service');
    const result = await executePayoutPipeline(payoutId);

    return res.status(result.finalStatus === 'FAILED' ? 422 : 200).json({
      ok:           result.ok,
      payout_id:    result.payoutId,
      final_status: result.finalStatus,
      transfer_id:  result.transferId,
      uetr:         result.uetr,
      message:      result.message,
      pipeline:     result.steps.map(s => ({ step: s.step, name: s.name, status: s.status, detail: s.detail })),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/payout/pipeline/status/:payoutId ─────────────────────────────────
router.get('/pipeline/status/:payoutId', authenticateToken, async (req, res) => {
  try {
    const { payoutId } = req.params;
    const rows = (await db.query(
      `SELECT p.id, p.merchant_id, p.amount, p.currency, p.status, p.provider,
              p.provider_reference, p.created_at, p.completed_at,
              si.reference AS si_reference, si.status AS si_status,
              si.destination_bank, si.destination_account_number, si.destination_swift
       FROM merchant_payouts p
       LEFT JOIN payout_settlement_instructions si ON si.payout_id = p.id
       WHERE p.id = ? LIMIT 1`,
      [payoutId]
    )).rows;

    if (!rows.length) return res.status(404).json({ ok: false, error: `Payout ${payoutId} not found` });
    const p = rows[0] as any;
    return res.json({
      ok: true,
      payout_id:    p.id,
      amount:       p.amount,
      currency:     p.currency,
      status:       p.status,
      provider:     p.provider,
      rail:         String(p.provider || '').includes('wise') ? 'wise' : null,
      transfer_id:  p.provider_reference,
      si_status:    p.si_status,
      si_reference: p.si_reference,
      destination:  { bank: p.destination_bank, account: p.destination_account_number, swift: p.destination_swift },
      created_at:   p.created_at,
      completed_at: p.completed_at,
      is_settled:   ['SETTLED','COMPLETED'].includes(String(p.status || '').toUpperCase()),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
