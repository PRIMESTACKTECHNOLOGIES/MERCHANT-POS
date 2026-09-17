/**
 * Payout Provider Service
 * ─────────────────────────────────────────────────────────────────────────────
 * YOUR INTERNAL ACQUIRER is the PROVIDER — licensed, self-hosted, Protocol 201.3.
 * Wise is the RAIL (transport layer) — it moves money after internal accounting.
 *
 * Architecture:
 *   Merchant Wallet (debited)
 *       → Internal Acquirer records settlement instruction  ← PROVIDER
 *           → Wise API sends to destination bank            ← RAIL
 *               → ABSA / any bank receives funds
 *
 * BANK_PAYOUT_PROVIDER=internal  → your acquirer is the provider
 * INTERNAL_PAYOUT_DOWNSTREAM=wise → Wise is the rail
 *
 * No other gateway. No external provider. Wise is just wires.
 */

import { wiseCollectAndSend } from './wiseCollect.service';

export interface BankPayoutRequest {
  merchantId:  string;
  payoutId:    string;
  amount:      number;
  currency?:   string;
  bankAccount: {
    bank_name?:       string;
    account_holder?:  string;
    account_number?:  string;
    routing_number?:  string;
    swift_code?:      string;
    iban?:            string;
    account_type?:    string;
  };
  reference?: string;
}

export interface BankPayoutResult {
  success:           boolean;
  provider:          string;
  rail?:             string;
  providerReference?: string;
  status:            string;
  raw?:              any;
}

// ── Route payout through Wise as the rail ────────────────────────────────────
async function submitViaWiseRail(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const ccy     = (request.currency || 'USD').toUpperCase();
  const account = request.bankAccount;
  const ref     = request.reference || request.payoutId;

  // Determine BIC/routing — Wise needs swift_code or routing_number
  const bic     = account.swift_code?.trim()
    || account.routing_number?.trim()
    || 'ABSAZAJJ';

  const result = await wiseCollectAndSend({
    amount:    request.amount,
    currency:  ccy,
    targetBic: bic,
    targetAccount: account.account_number || account.iban || '',
    targetName: account.account_holder || 'JUKRUTI LOGISTICS PTY LTD',
    targetAddressLines: ['9 HOUTKAPPER STR', 'OLIFANTSHOEK 8450', 'SOUTH AFRICA'],
    reference: ref.slice(0, 35),
    merchantId: request.merchantId,
  });

  return {
    success:           result.success,
    provider:          'internal',           // YOUR acquirer is the provider
    rail:              'wise',               // Wise is just the rail
    providerReference: result.transferId,
    status:            result.success
      ? (result.status || 'SUBMITTED').toUpperCase()
      : 'FAILED',
    raw: {
      wise_transfer_id:  result.transferId,
      wise_uetr:         result.uetr,
      wise_status:       result.status,
      wise_balance_used: result.wiseBalance,
      message:           result.message,
      provider_note:     'Internal acquirer (Protocol 201.3) — Wise used as transport rail only.',
    },
  };
}

// ── Main entry point — called by bank.router.ts ───────────────────────────────
export async function submitBankPayout(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const provider    = (process.env.BANK_PAYOUT_PROVIDER    || 'internal').trim().toLowerCase();
  const downstream  = (process.env.INTERNAL_PAYOUT_DOWNSTREAM || '').trim().toLowerCase();
  const wiseKey     = process.env.WISE_API_KEY?.trim();

  // ── Internal acquirer + Wise rail ────────────────────────────────────────
  if ((provider === 'internal' || provider === 'primestack') && downstream === 'wise' && wiseKey) {
    console.log(`[Payout] Internal acquirer → Wise rail → ${request.bankAccount?.bank_name || 'bank'} ${request.bankAccount?.account_number || ''}`);
    return submitViaWiseRail(request);
  }

  // ── Internal acquirer — no rail configured ────────────────────────────────
  // Settlement instruction is already stored by executeInternalPayout().
  // This path returns a clean PENDING status so the caller knows the
  // instruction is recorded but no rail has been activated yet.
  if (provider === 'internal' || provider === 'primestack') {
    console.log(`[Payout] Internal acquirer — no downstream rail. Settlement instruction stored. Configure INTERNAL_PAYOUT_DOWNSTREAM=wise to activate Wise rail.`);
    return {
      success:  true,
      provider: 'internal',
      status:   'PENDING_RAIL',
      raw: {
        note: 'Settlement instruction recorded. No downstream rail active. Set INTERNAL_PAYOUT_DOWNSTREAM=wise in .env to send via Wise.',
        configure: 'INTERNAL_PAYOUT_DOWNSTREAM=wise',
      },
    };
  }

  // ── External provider (BANK_PAYOUT_API_URL) ───────────────────────────────
  if (provider === 'external') {
    const apiUrl = process.env.BANK_PAYOUT_API_URL?.trim();
    const apiKey = process.env.BANK_PAYOUT_API_KEY?.trim();
    if (!apiUrl) throw new Error('BANK_PAYOUT_API_URL is required for provider=external');
    if (!apiKey) throw new Error('BANK_PAYOUT_API_KEY is required for provider=external');

    const { default: axios } = await import('axios');
    const res = await axios.post(apiUrl, {
      provider:    provider,
      merchant_id: request.merchantId,
      payout_id:   request.payoutId,
      amount:      Number(request.amount),
      currency:    request.currency || 'USD',
      reference:   request.reference || request.payoutId,
      recipient: {
        bank_name:      request.bankAccount?.bank_name      || null,
        account_holder: request.bankAccount?.account_holder || null,
        account_number: request.bankAccount?.account_number || null,
        routing_number: request.bankAccount?.routing_number || null,
        iban:           request.bankAccount?.iban           || null,
        swift_code:     request.bankAccount?.swift_code     || null,
      },
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      timeout: 20000,
    });

    return {
      success:           true,
      provider:          'external',
      providerReference: res.data?.id || res.data?.reference,
      status:            String(res.data?.status || 'submitted'),
      raw:               res.data,
    };
  }

  // ── Manual / fallback ─────────────────────────────────────────────────────
  return {
    success:  true,
    provider: 'manual',
    status:   'PENDING_BANK_CONFIRMATION',
    raw:      { note: 'Manual payout — operator confirms receipt.' },
  };
}

// ── Wise diagnostics (balance check) ─────────────────────────────────────────
export async function getWiseDiagnostics(): Promise<any> {
  const wiseKey = process.env.WISE_API_KEY?.trim();
  if (!wiseKey) {
    return { configured: false, message: 'WISE_API_KEY not set in .env' };
  }
  try {
    const { getWiseBalance } = await import('./wiseCollect.service');
    const [usd, eur] = await Promise.all([
      getWiseBalance('USD').catch(() => 0),
      getWiseBalance('EUR').catch(() => 0),
    ]);
    return {
      configured: true,
      role:       'rail',                    // Wise is the rail, not the provider
      provider:   'internal',               // your acquirer is the provider
      balances: [
        { currency: 'USD', amount: usd },
        { currency: 'EUR', amount: eur },
      ],
      note: 'Wise is configured as the RAIL (transport). Your internal acquirer (Protocol 201.3) is the PROVIDER.',
    };
  } catch (e: any) {
    return { configured: false, error: e.message };
  }
}

export default { submitBankPayout, getWiseDiagnostics };
