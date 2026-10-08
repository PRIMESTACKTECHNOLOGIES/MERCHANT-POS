/**
 * Transak Virtual Bank Account (VBA) Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates virtual bank accounts for customers so they can fund their wallet
 * via bank transfer (GBP Faster Payments, EUR SEPA, USD ACH etc).
 *
 * Flow:
 *   1. Customer requests funding → POST /api/wallets/vba/create
 *   2. Your system calls Transak VBA API → gets unique bank account details
 *   3. Customer sends bank transfer to those details
 *   4. Transak confirms → webhook → POST /api/wallets/vba/webhook
 *   5. Your system credits customer/merchant wallet with real funds
 *
 * Docs: https://docs.transak.com/api/whitelabel/virtual-account-payments
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { db } from '../../config/db';

// ── Config ────────────────────────────────────────────────────────────────────
const TRANSAK_BASE = (process.env.TRANSAK_BASE_URL || 'https://api-gateway.transak.com').replace(/\/+$/, '');
const TRANSAK_STG  = 'https://api-gateway-stg.transak.com'; // staging
const TRANSAK_API_KEY    = (process.env.TRANSAK_API_KEY    || '').trim();
const TRANSAK_API_SECRET = (process.env.TRANSAK_API_SECRET || '').trim();
const TRANSAK_WEBHOOK_SECRET = (process.env.TRANSAK_WEBHOOK_SECRET || '').trim();
const IS_PROD = (process.env.TRANSAK_MODE || '').toLowerCase() === 'production';

function transakBaseUrl(): string {
  return IS_PROD ? TRANSAK_BASE : TRANSAK_STG;
}

// ── Auth token ────────────────────────────────────────────────────────────────
let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry - 30_000) return _accessToken;

  const resp = await axios.post(
    `${transakBaseUrl()}/api/v2/refresh-token`,
    { apiKey: TRANSAK_API_KEY, secret: TRANSAK_API_SECRET },
    { timeout: 10000 }
  );
  _accessToken  = String(resp.data?.data?.accessToken || '');
  _tokenExpiry  = Date.now() + 55 * 60 * 1000; // 55 min
  return _accessToken;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VbaCreateInput {
  customerId:     string;
  merchantId:     string;
  fiatCurrency:   string;   // 'GBP' | 'EUR' | 'USD'
  paymentMethod:  string;   // 'gbp_bank_transfer' | 'sepa_bank_transfer' | etc
  cryptoCurrency: string;   // 'USDT'
  walletAddress:  string;   // your receiving wallet
  network:        string;   // 'ethereum' | 'tron' | 'polygon'
  userIp:         string;   // customer IP (required by Transak)
  memoTag?:       string;
}

export interface VbaDetails {
  id:            string;
  status:        string;
  fiatCurrency:  string;
  paymentMethod: string;
  accountName?:  string;
  accountNumber?: string;
  sortCode?:      string;
  iban?:          string;
  bic?:           string;
  bankName?:      string;
  reference?:     string;
  expiresAt?:     string;
}

// ── Create VBA ────────────────────────────────────────────────────────────────
export async function createVba(input: VbaCreateInput): Promise<{
  ok: boolean;
  vbaId?: string;
  status?: string;
  bankDetails?: VbaDetails;
  error?: string;
}> {
  if (!TRANSAK_API_KEY) {
    return { ok: false, error: 'TRANSAK_API_KEY not configured' };
  }

  try {
    const token = await getAccessToken();

    const body = {
      source: {
        fiatCurrency:  input.fiatCurrency.toUpperCase(),
        paymentMethod: input.paymentMethod,
      },
      destination: {
        cryptoCurrency: input.cryptoCurrency.toUpperCase(),
        walletAddress:  input.walletAddress,
        network:        input.network,
        ...(input.memoTag ? { memoTag: input.memoTag } : {}),
      },
    };

    const resp = await axios.post(
      `${transakBaseUrl()}/api/v2/onramp-stream/vba`,
      body,
      {
        headers: {
          'x-api-key':   TRANSAK_API_KEY,
          'x-user-ip':   input.userIp,
          'authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const data = resp.data?.data;
    const vbaId = String(data?.id || uuidv4());

    // Store VBA reference in DB
    await db.query(`
      CREATE TABLE IF NOT EXISTS transak_vba_accounts (
        id TEXT PRIMARY KEY,
        vba_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        fiat_currency TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        crypto_currency TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        network TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'INITIATED',
        bank_details TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).catch(() => {});

    const now = new Date().toISOString();
    await db.query(
      `INSERT OR IGNORE INTO transak_vba_accounts
        (id, vba_id, customer_id, merchant_id, fiat_currency, payment_method,
         crypto_currency, wallet_address, network, status, bank_details, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), vbaId, input.customerId, input.merchantId,
        input.fiatCurrency, input.paymentMethod, input.cryptoCurrency,
        input.walletAddress, input.network,
        String(data?.status || 'INITIATED'),
        JSON.stringify(data || {}), now, now,
      ]
    ).catch(() => {});

    console.log(`[TransakVBA] Created VBA ${vbaId} for customer=${input.customerId} | ${input.fiatCurrency} → ${input.cryptoCurrency}`);

    return {
      ok: true,
      vbaId,
      status: String(data?.status || 'INITIATED'),
      bankDetails: {
        id:           vbaId,
        status:       String(data?.status || 'INITIATED'),
        fiatCurrency: input.fiatCurrency,
        paymentMethod: input.paymentMethod,
        accountName:  data?.accountHolderName || data?.beneficiaryName,
        accountNumber: data?.accountNumber || data?.virtualAccountNumber,
        sortCode:     data?.sortCode,
        iban:         data?.iban || data?.virtualIban,
        bic:          data?.bic || data?.swiftCode,
        bankName:     data?.bankName,
        reference:    data?.paymentReference || data?.reference,
        expiresAt:    data?.expiresAt,
      },
    };

  } catch (err: any) {
    const msg = err?.response?.data?.error?.message
      || err?.response?.data?.message
      || err.message;
    console.error('[TransakVBA] Create error:', msg);
    return { ok: false, error: msg };
  }
}

// ── Get VBA status ────────────────────────────────────────────────────────────
export async function getVbaStatus(vbaId: string): Promise<{
  ok: boolean;
  status?: string;
  data?: any;
  error?: string;
}> {
  try {
    const token = await getAccessToken();
    const resp = await axios.get(
      `${transakBaseUrl()}/api/v2/onramp-stream/vba/${vbaId}`,
      {
        headers: {
          'x-api-key':     TRANSAK_API_KEY,
          'authorization': `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );
    const data = resp.data?.data;
    return { ok: true, status: data?.status, data };
  } catch (err: any) {
    return { ok: false, error: err?.response?.data?.error?.message || err.message };
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────────
/**
 * Called when Transak sends a VBA webhook notification.
 * Verifies signature, then credits customer wallet with real fiat amount.
 */
export async function handleVbaWebhook(
  rawBody: Buffer | string,
  signature: string,
  bodyParsed: any,
): Promise<void> {
  // Verify webhook signature
  if (TRANSAK_WEBHOOK_SECRET) {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = crypto.createHmac('sha256', TRANSAK_WEBHOOK_SECRET).update(body).digest('hex');
    if (signature !== expected && `sha256=${signature}` !== `sha256=${expected}`) {
      throw Object.assign(new Error('Invalid Transak VBA webhook signature'), { code: 'INVALID_SIGNATURE' });
    }
  }

  const event     = bodyParsed?.data || bodyParsed;
  const eventType = String(event?.type || event?.eventName || '').toUpperCase();
  const status    = String(event?.status || '').toUpperCase();

  console.log(`[TransakVBA] Webhook: type=${eventType} status=${status}`);

  // Only process completed/funded events
  const isFunded = ['ORDER_COMPLETED', 'PAYMENT_RECEIVED', 'COMPLETED', 'FUNDED']
    .some(t => eventType.includes(t) || status.includes(t));

  if (!isFunded) {
    console.log(`[TransakVBA] Webhook ignored — not a funded event (${eventType}/${status})`);
    return;
  }

  const vbaId      = String(event?.vbaId || event?.id || '');
  const fiatAmount = Number(event?.fiatAmount || event?.amount || 0);
  const currency   = String(event?.fiatCurrency || event?.currency || 'GBP').toUpperCase();

  if (!vbaId || fiatAmount <= 0) {
    console.warn('[TransakVBA] Webhook missing vbaId or amount');
    return;
  }

  // Find the VBA record
  const vbaRow = (await db.query(
    'SELECT * FROM transak_vba_accounts WHERE vba_id = ? LIMIT 1',
    [vbaId]
  ).catch(() => ({ rows: [] }))).rows[0] as any;

  if (!vbaRow) {
    console.warn(`[TransakVBA] No VBA record found for vbaId=${vbaId}`);
    return;
  }

  const now = new Date().toISOString();

  // Update VBA status
  await db.query(
    'UPDATE transak_vba_accounts SET status = ?, updated_at = ? WHERE vba_id = ?',
    ['FUNDED', now, vbaId]
  ).catch(() => {});

  // Credit Omnibus (real funds confirmed)
  await db.query(`
    INSERT INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
    VALUES ('VAULT_BANK_OMNIBUS', ?, ?, 'VAULT BANK OMNIBUS', ?, ?)
    ON CONFLICT(account_id, currency) DO UPDATE SET
      balance = balance + excluded.balance, updated_at = excluded.updated_at
  `, [currency, fiatAmount, now, now]).catch(() => {});

  // Credit merchant wallet
  const merchantId = vbaRow.merchant_id || 'MRC-1001';
  let mwRow = (await db.query(
    'SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
    [merchantId, currency]
  )).rows[0] as any;

  if (!mwRow) {
    const mwId = uuidv4();
    await db.query(
      'INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, ?)',
      [mwId, merchantId, currency]
    );
    mwRow = { id: mwId };
  }

  await db.query(
    'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
    [fiatAmount, now, mwRow.id]
  );
  await db.query(
    `INSERT INTO merchant_wallet_transactions
      (id, wallet_id, type, amount, currency, source, reference, description, created_at)
     VALUES (?, ?, 'credit', ?, ?, 'transak_vba', ?, ?, ?)`,
    [
      uuidv4(), mwRow.id, fiatAmount, currency,
      vbaId, `Transak VBA funded: ${currency} ${fiatAmount} via ${vbaRow.payment_method}`, now,
    ]
  );

  // Vault ledger entry
  await db.query(`
    INSERT OR IGNORE INTO vault_ledger
      (id, ts, type, merchant_id, amount, currency, reference, status, meta)
    VALUES (?, ?, 'TRANSAK_VBA_FUNDED', ?, ?, ?, ?, 'COMPLETED', ?)
  `, [
    uuidv4(), now, merchantId, fiatAmount, currency, vbaId,
    JSON.stringify({ source: 'transak_vba_webhook', vbaId, eventType, fiatAmount, currency }),
  ]).catch(() => {});

  console.log(`[TransakVBA] ✅ Funded: ${currency} ${fiatAmount} → merchant=${merchantId} | vbaId=${vbaId}`);
}
