/**
 * Payout Provider Service
 * ─────────────────────────────────────────────────────────────────────────────
 * YOUR INTERNAL ACQUIRER is the PROVIDER — licensed, self-hosted, Protocol 201.3.
 * Wise is the RAIL (transport layer) — it moves money after internal accounting.
 *
 * BANK_PAYOUT_PROVIDER=internal  → your acquirer is the provider
 * INTERNAL_PAYOUT_DOWNSTREAM=wise → Wise is the rail
 */

import { wiseCollectAndSend } from './wiseCollect.service';
import { submitDwollaPayout } from './dwollaOriginator.client';
import { acquirerConfig } from '../../config/acquirer';
import { Iso8583Codec } from '../payments/acquirer/iso8583.codec';
import { defaultUnframed } from '../payments/acquirer/iso8583.framing';
import {
  removeIso8583Frame,
  sendIso8583,
} from '../payments/acquirer/headerBuilder';

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
    bank_address?:    string;
    country?:         string;
    city?:            string;
    post_code?:       string;
    dwolla_funding_source_url?: string;
  };
  reference?: string;
}

export interface BankPayoutResult {
  success:            boolean;
  provider:           string;
  rail?:              string;
  providerReference?: string;
  status:             string;
  raw?:               any;
}

async function submitViaWiseRail(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const ccy     = (request.currency || 'USD').toUpperCase();
  const account = request.bankAccount;
  const ref     = request.reference || request.payoutId;
  const bic     = ccy === 'USD'
    ? (account.routing_number?.trim() || account.swift_code?.trim() || '')
    : (account.swift_code?.trim() || account.routing_number?.trim() || '');

  const result = await wiseCollectAndSend({
    amount:        request.amount,
    currency:      ccy,
    targetBic:     bic,
    targetAccount: account.account_number || account.iban || '',
    targetName:    account.account_holder || '',
    targetAddressLines: request.bankAccount.bank_address
      ? [request.bankAccount.bank_address]
      : undefined,
    targetCountry: request.bankAccount.country,
    targetCity: request.bankAccount.city,
    targetPostCode: request.bankAccount.post_code,
    reference:     ref.slice(0, 35),
    merchantId:    request.merchantId,
  });

  return {
    success:           result.success,
    provider:          'internal',
    rail:              'wise',
    providerReference: result.transferId,
    status:            result.success ? (result.status || 'SUBMITTED').toUpperCase() : 'FAILED',
    raw: {
      wise_transfer_id:  result.transferId,
      wise_uetr:         result.uetr,
      wise_status:       result.status,
      wise_balance_used: result.wiseBalance,
      message:           result.message,
    },
  };
}

async function submitViaDwolla(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const result = await submitDwollaPayout({
    payoutId: request.payoutId,
    amount: request.amount,
    currency: (request.currency || 'USD').toUpperCase(),
    reference: request.reference || request.payoutId,
    destinationFundingSourceUrl: request.bankAccount.dwolla_funding_source_url,
    metadata: { merchantId: request.merchantId },
  });

  return {
    success: result.success,
    provider: 'internal',
    rail: 'dwolla-ach',
    providerReference: result.providerReference,
    status: result.status,
    raw: { dwolla_status: result.status, message: result.message, response: result.raw },
  };
}

function currencyCode(currency: string): string {
  const codes: Record<string, string> = {
    USD: '840', EUR: '978', GBP: '826', AED: '784',
    SGD: '702', INR: '356', JPY: '392', CHF: '756',
    AUD: '036', CAD: '124', HKD: '344', MYR: '458',
  };
  const code = codes[currency.toUpperCase()];
  if (!code) throw new Error(`Unsupported payout currency for ISO8583: ${currency}`);
  return code;
}

function amountMinor(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Payout amount must be a finite positive number');
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor > 999999999999) {
    throw new Error('Payout amount exceeds ISO8583 field 4 capacity');
  }
  return String(minor).padStart(12, '0');
}

function utcTransmissionDateTime(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
}

async function submitViaIso8583Rail(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const host = acquirerConfig.host?.trim();
  const port = acquirerConfig.port;
  if (!host || !port) throw new Error('ACQUIRER_HOST and ACQUIRER_PORT are required for ISO8583 payout rail');

  const currency = (request.currency || 'USD').toUpperCase();
  const account = request.bankAccount.account_number || request.bankAccount.iban;
  if (!account) throw new Error('Bank account number or IBAN is required for ISO8583 payout rail');

  const stan = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  const reference = (request.reference || request.payoutId).replace(/[^A-Za-z0-9]/g, '').slice(-12).padStart(12, '0');
  const codec = new Iso8583Codec(undefined, { framing: defaultUnframed });
  const requestMessage = codec.pack({
    mti: '0200',
    fields: {
      2: account,
      3: '400000',
      4: amountMinor(Number(request.amount)),
      7: utcTransmissionDateTime(),
      11: stan,
      37: reference,
      41: (acquirerConfig.terminalId || 'TERM0001').slice(0, 8).padEnd(8, ' '),
      42: (request.merchantId || acquirerConfig.merchantId || 'MRC-1001').slice(0, 15).padEnd(15, ' '),
      49: currencyCode(currency),
    },
  });

  const framedResponse = await sendIso8583(host, port, requestMessage, acquirerConfig.timeoutMs);
  const response = codec.unpack(removeIso8583Frame(framedResponse));
  const responseCode = String(response.fields[39] || '96').trim();
  const success = responseCode === '00';
  const responseReference = response.fields[37];

  return {
    success,
    provider: 'internal',
    rail: 'iso8583-tcp',
    providerReference: responseReference
      ? (Buffer.isBuffer(responseReference) ? responseReference.toString('ascii') : String(responseReference)).trim()
      : reference,
    status: success ? 'SUBMITTED' : 'FAILED',
    raw: {
      mti: response.mti,
      response_code: responseCode,
      stan,
      header_mode: (process.env.ISO8583_HEADER || 'NONE').trim().toUpperCase(),
    },
  };
}

export async function submitBankPayout(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const provider   = (process.env.BANK_PAYOUT_PROVIDER       || 'internal').trim().toLowerCase();
  const downstream = (process.env.INTERNAL_PAYOUT_DOWNSTREAM || '').trim().toLowerCase();
  const wiseKey    = process.env.WISE_API_KEY?.trim();

  if (
    (provider === 'internal' || provider === 'primestack' || provider === 'external')
    && (downstream === 'iso8583' || downstream === 'iso8583-tcp' || downstream === 'vaultbank_iso8583')
  ) {
    return submitViaIso8583Rail(request);
  }

  if ((provider === 'internal' || provider === 'primestack') && downstream === 'wise' && wiseKey) {
    return submitViaWiseRail(request);
  }

  if (
    (provider === 'internal' || provider === 'primestack' || provider === 'external')
    && (downstream === 'dwolla' || downstream === 'vaultbank_dwolla')
  ) {
    return submitViaDwolla(request);
  }

  if (provider === 'internal' || provider === 'primestack') {
    return {
      success:  true,
      provider: 'internal',
      status:   'PENDING_RAIL',
      raw:      { note: 'Settlement instruction recorded. Set INTERNAL_PAYOUT_DOWNSTREAM=wise to activate Wise rail.' },
    };
  }

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

  return {
    success:  true,
    provider: 'manual',
    status:   'PENDING_BANK_CONFIRMATION',
    raw:      { note: 'Manual payout — operator confirms receipt.' },
  };
}

export async function getWiseDiagnostics(): Promise<any> {
  const wiseKey = process.env.WISE_API_KEY?.trim();
  if (!wiseKey) return { configured: false, message: 'WISE_API_KEY not set in .env' };
  try {
    const { getWiseBalance } = await import('./wiseCollect.service');
    const [usd, eur] = await Promise.all([
      getWiseBalance('USD').catch(() => 0),
      getWiseBalance('EUR').catch(() => 0),
    ]);
    return {
      configured: true,
      role:       'rail',
      provider:   'internal',
      balances: [{ currency: 'USD', amount: usd }, { currency: 'EUR', amount: eur }],
      note: 'Wise is the RAIL. Your internal acquirer (Protocol 201.3) is the PROVIDER.',
    };
  } catch (e: any) {
    return { configured: false, error: e.message };
  }
}

export default { submitBankPayout, getWiseDiagnostics };