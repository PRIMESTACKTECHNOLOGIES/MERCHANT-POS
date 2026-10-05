/**
 * ABSA Business Bank Service
 * ─────────────────────────────────────────────────────────────────────────────
 * ABSA sits at the END of the pipeline — it is where vault funds are sent
 * when the merchant wants to settle large amounts (gold suppliers, millions).
 *
 * Pipeline position:
 *   Vault Bank (accumulated funds)
 *         ↓
 *   POST /api/vault/send-to-absa   ← triggers this service
 *         ↓
 *   ABSA Business Account (no withdrawal limits)
 *         ↓
 *   From ABSA: pay gold suppliers / other banks / crypto exchange
 *
 * ABSA API Banking:
 *   - OAuth 2.0 (client_credentials grant)
 *   - Base URL: https://api.absa.africa (production)
 *              https://sandbox.api.absa.africa (sandbox)
 *   - Endpoints:
 *       POST /identity/token               — get access token
 *       GET  /payments/v1/accounts/{id}    — account balance
 *       POST /payments/v1/transfers        — SWIFT/RTGS outbound
 *       GET  /payments/v1/transfers/{id}   — transfer status
 *       GET  /payments/v1/transactions     — transaction history
 *
 * Register at: https://developer.absa.africa
 * Required env vars (see .env):
 *   ABSA_CLIENT_ID, ABSA_CLIENT_SECRET, ABSA_ACCOUNT_NUMBER,
 *   ABSA_WEBHOOK_SECRET, ABSA_ENVIRONMENT
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import crypto from 'crypto';

// ── Configuration ─────────────────────────────────────────────────────────────
function absaConfig() {
  const env = (process.env.ABSA_ENVIRONMENT || 'sandbox').toLowerCase();
  return {
    baseUrl:       env === 'production'
      ? 'https://api.absa.africa'
      : 'https://sandbox.api.absa.africa',
    clientId:      (process.env.ABSA_CLIENT_ID      || '').trim(),
    clientSecret:  (process.env.ABSA_CLIENT_SECRET  || '').trim(),
    accountNumber: (process.env.ABSA_ACCOUNT_NUMBER || '').trim(),
    webhookSecret: (process.env.ABSA_WEBHOOK_SECRET || '').trim(),
    environment:   env,
  };
}

// ── OAuth token cache ─────────────────────────────────────────────────────────
let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  const cfg = absaConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('ABSA_CLIENT_ID and ABSA_CLIENT_SECRET must be set in .env');
  }

  if (_accessToken && Date.now() < _tokenExpiry - 30_000) {
    return _accessToken;
  }

  const resp = await axios.post(
    `${cfg.baseUrl}/identity/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      scope:         'payments:read payments:write accounts:read',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );

  _accessToken  = String(resp.data.access_token);
  _tokenExpiry  = Date.now() + (Number(resp.data.expires_in || 3600) * 1000);
  return _accessToken;
}

function absaHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'X-Correlation-ID': uuidv4(),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AbsaBalance {
  accountNumber: string;
  currency:      string;
  available:     number;
  current:       number;
  status:        string;
}

export interface AbsaTransferInput {
  amount:            number;         // major units e.g. 50000.00
  currency:          string;         // ISO 3-letter
  beneficiaryName:   string;
  beneficiaryAccount: string;        // IBAN or account number
  beneficiaryBank:   string;         // bank name
  beneficiarySwift:  string;         // BIC/SWIFT
  beneficiaryAddress?: string;
  beneficiaryCountry?: string;
  reference:         string;         // payment reference (max 35 chars)
  transferType:      'SWIFT' | 'RTGS' | 'SEPA' | 'ACH';
  note?:             string;
}

export interface AbsaTransferResult {
  ok:           boolean;
  transferId?:  string;
  status?:      string;
  reference:    string;
  amount:       number;
  currency:     string;
  message:      string;
  error?:       string;
}

// ── Balance check ─────────────────────────────────────────────────────────────
export async function getAbsaBalance(currency = 'USD'): Promise<AbsaBalance> {
  const cfg   = absaConfig();
  const token = await getAccessToken();

  const resp = await axios.get(
    `${cfg.baseUrl}/payments/v1/accounts/${cfg.accountNumber}`,
    {
      headers: { ...absaHeaders(token), 'X-Currency': currency.toUpperCase() },
      timeout: 10000,
    }
  );

  const data = resp.data?.data || resp.data || {};
  return {
    accountNumber: cfg.accountNumber,
    currency:      String(data.currency || currency).toUpperCase(),
    available:     Number(data.availableBalance || data.available || 0),
    current:       Number(data.currentBalance   || data.current   || 0),
    status:        String(data.status || 'ACTIVE'),
  };
}

// ── Outbound transfer (vault → ABSA) ─────────────────────────────────────────
export async function sendToAbsa(input: AbsaTransferInput): Promise<AbsaTransferResult> {
  const cfg = absaConfig();

  if (!cfg.clientId || !cfg.clientSecret || !cfg.accountNumber) {
    return {
      ok: false, reference: input.reference, amount: input.amount,
      currency: input.currency,
      message: 'ABSA not configured — set ABSA_CLIENT_ID, ABSA_CLIENT_SECRET, ABSA_ACCOUNT_NUMBER in .env',
      error: 'ABSA_NOT_CONFIGURED',
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, reference: input.reference, amount: input.amount,
      currency: input.currency, message: 'Amount must be positive', error: 'INVALID_AMOUNT' };
  }

  const idempotencyKey = `ABSA-${input.reference}-${input.currency}`;

  // Check for duplicate in our DB
  await db.query(`
    CREATE TABLE IF NOT EXISTS absa_transfers (
      id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL, currency TEXT NOT NULL,
      beneficiary_name TEXT, beneficiary_account TEXT,
      beneficiary_swift TEXT, transfer_type TEXT,
      absa_transfer_id TEXT, status TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT
    )
  `).catch(() => {});

  const existing = (await db.query(
    'SELECT id, status, absa_transfer_id FROM absa_transfers WHERE reference = ? LIMIT 1',
    [input.reference]
  )).rows[0] as any;

  if (existing) {
    return {
      ok:         existing.status === 'COMPLETED',
      transferId: existing.absa_transfer_id,
      status:     existing.status,
      reference:  input.reference,
      amount:     input.amount,
      currency:   input.currency,
      message:    `Duplicate — existing transfer status: ${existing.status}`,
    };
  }

  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO absa_transfers (id, reference, amount, currency, beneficiary_name,
     beneficiary_account, beneficiary_swift, transfer_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    [uuidv4(), input.reference, input.amount, input.currency,
     input.beneficiaryName, input.beneficiaryAccount,
     input.beneficiarySwift, input.transferType, now]
  );

  try {
    const token = await getAccessToken();

    const payload = {
      sourceAccount:   cfg.accountNumber,
      amount:          input.amount.toFixed(2),
      currency:        input.currency.toUpperCase(),
      transferType:    input.transferType,
      idempotencyKey,
      beneficiary: {
        name:           input.beneficiaryName,
        accountNumber:  input.beneficiaryAccount,
        bankName:       input.beneficiaryBank,
        swiftCode:      input.beneficiarySwift,
        address:        input.beneficiaryAddress || '',
        country:        input.beneficiaryCountry || 'ZA',
      },
      remittanceInfo: input.reference.slice(0, 35),
      reference:      input.reference.slice(0, 35),
      note:           input.note || '',
    };

    const resp = await axios.post(
      `${cfg.baseUrl}/payments/v1/transfers`,
      payload,
      { headers: absaHeaders(token), timeout: 20000 }
    );

    const data       = resp.data?.data || resp.data || {};
    const transferId = String(data.transferId || data.id || data.transactionId || uuidv4());
    const status     = String(data.status || 'PENDING').toUpperCase();

    await db.query(
      `UPDATE absa_transfers SET absa_transfer_id = ?, status = ?, completed_at = ?
       WHERE reference = ?`,
      [transferId, status === 'COMPLETED' ? 'COMPLETED' : 'SUBMITTED',
       status === 'COMPLETED' ? now : null, input.reference]
    );

    console.log(`[ABSA] ✅ Transfer submitted: ${input.currency} ${input.amount} → ${input.beneficiaryName} | id=${transferId} status=${status}`);

    return {
      ok: true, transferId, status,
      reference: input.reference, amount: input.amount, currency: input.currency,
      message: `ABSA transfer ${transferId} submitted. Status: ${status}. ${input.currency} ${input.amount.toFixed(2)} → ${input.beneficiaryName}`,
    };

  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.response?.data?.error || err.message;
    await db.query(
      `UPDATE absa_transfers SET status = 'FAILED' WHERE reference = ?`,
      [input.reference]
    );
    console.error(`[ABSA] ❌ Transfer failed: ${msg}`);
    return {
      ok: false, reference: input.reference, amount: input.amount,
      currency: input.currency, message: `ABSA transfer failed: ${msg}`, error: msg,
    };
  }
}

// ── Transfer status check ─────────────────────────────────────────────────────
export async function getAbsaTransferStatus(transferId: string): Promise<{ status: string; details: any }> {
  const cfg   = absaConfig();
  const token = await getAccessToken();

  const resp = await axios.get(
    `${cfg.baseUrl}/payments/v1/transfers/${transferId}`,
    { headers: absaHeaders(token), timeout: 10000 }
  );
  const data = resp.data?.data || resp.data || {};
  return { status: String(data.status || 'UNKNOWN').toUpperCase(), details: data };
}

// ── Incoming webhook verification ─────────────────────────────────────────────
/**
 * Verify ABSA webhook signature.
 * ABSA sends X-ABSA-Signature: sha256=<hmac>
 */
export function verifyAbsaWebhook(rawBody: Buffer | string, signature: string): boolean {
  const cfg = absaConfig();
  if (!cfg.webhookSecret) return true; // not configured — pass through in dev
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = 'sha256=' + crypto.createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Handle ABSA incoming credit webhook.
 * When money arrives in the ABSA account, ABSA POSTs to /api/vault/absa/webhook.
 * We credit the vault Omnibus so the vault balance reflects real ABSA funds.
 */
export async function handleAbsaIncomingCredit(webhookBody: any): Promise<void> {
  const event = webhookBody?.event || webhookBody?.data || webhookBody;
  const eventType = String(event?.type || event?.eventType || '').toUpperCase();

  // Only process completed incoming credits
  if (!['CREDIT', 'INCOMING_PAYMENT', 'FUNDS_RECEIVED', 'PAYMENT_RECEIVED'].some(t => eventType.includes(t))) {
    console.log(`[ABSA] Webhook event ignored: ${eventType}`);
    return;
  }

  const amount    = Number(event?.amount || event?.transactionAmount || 0);
  const currency  = String(event?.currency || 'ZAR').toUpperCase();
  const reference = String(event?.reference || event?.transactionReference || uuidv4());
  const absaRef   = String(event?.transactionId || event?.id || reference);

  if (amount <= 0) return;

  const now = new Date().toISOString();

  // Fund Omnibus with the incoming amount
  await db.query(`
    CREATE TABLE IF NOT EXISTS omnibus_accounts (
      account_id TEXT NOT NULL, currency TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT 'VAULT BANK OMNIBUS',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, currency)
    )
  `).catch(() => {});

  await db.query(`
    INSERT INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
    VALUES ('VAULT_BANK_OMNIBUS', ?, ?, 'VAULT BANK OMNIBUS', ?, ?)
    ON CONFLICT(account_id, currency) DO UPDATE SET
      balance = balance + excluded.balance, updated_at = excluded.updated_at
  `, [currency, amount, now, now]);

  // Also credit vault_accounts for the dashboard balance display
  await db.query(`
    UPDATE vault_accounts
    SET balance = balance + ?, available_balance = available_balance + ?, updated_at = ?
    WHERE currency = ?
  `, [amount, amount, now, currency]).catch(() => {});

  // Ledger entry
  await db.query(`
    INSERT OR IGNORE INTO vault_ledger
      (id, ts, type, merchant_id, amount, currency, reference, status, meta)
    VALUES (?, ?, 'ABSA_INCOMING_CREDIT', NULL, ?, ?, ?, 'COMPLETED', ?)
  `, [
    uuidv4(), now, amount, currency, reference,
    JSON.stringify({ source: 'absa_webhook', absaRef, eventType }),
  ]).catch(() => {});

  console.log(`[ABSA] ✅ Incoming credit: ${currency} ${amount} | ref=${reference} | absaRef=${absaRef}`);
}

// ── Transaction history ───────────────────────────────────────────────────────
export async function getAbsaTransactions(limit = 50): Promise<any[]> {
  const cfg   = absaConfig();
  const token = await getAccessToken();

  const resp = await axios.get(
    `${cfg.baseUrl}/payments/v1/transactions`,
    {
      headers: absaHeaders(token),
      params:  { accountNumber: cfg.accountNumber, limit, sort: 'desc' },
      timeout: 10000,
    }
  );
  return resp.data?.data || resp.data?.transactions || resp.data || [];
}
