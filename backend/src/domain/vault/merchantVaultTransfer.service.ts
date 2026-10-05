import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { vaultEngine } from './vault.service';
import { walletsService } from '../wallets/wallets.service';

type TransferStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface MerchantVaultTransferResult {
  success: boolean;
  transferId: string;
  reference: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  merchantBalanceAfter: number;
  vaultBalanceAfter: number;
  externalReference?: string;
}

async function ensureTransferTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS merchant_vault_transfers (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      external_reference TEXT,
      status TEXT NOT NULL,
      request_payload TEXT NOT NULL,
      response_payload TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
}

function transferUrl() {
  const value = process.env.VAULT_BANK_TRANSFER_URL?.trim();
  if (!value) throw new Error('VAULT_BANK_TRANSFER_URL must be configured for real bank transfers');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('VAULT_BANK_TRANSFER_URL is invalid'); }
  const isLoopback = parsed.hostname === '127.0.0.1'
    || parsed.hostname === 'localhost'
    || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('VAULT_BANK_TRANSFER_URL must use HTTPS unless it targets the local loopback vault gateway');
  }
  return value;
}

function isConfirmedTransferResponse(body: any) {
  const status = String(
    body?.status
      || body?.transfer?.status
      || body?.entries?.[0]?.status
      || '',
  ).toUpperCase();
  return body?.success === true
    || body?.ok === true
    || ['COMPLETED', 'SETTLED', 'CREDITED', 'POSTED', 'SUCCESS', 'SUCCEEDED'].includes(status);
}

export async function callVaultBankLedger(input: {
  direction: 'credit' | 'debit';
  amount: number;
  currency: string;
  reference: string;
  merchantId?: string;
  type?: string;
  meta?: Record<string, unknown>;
}) {
  const settlement = new URL(transferUrl());
  settlement.pathname = settlement.pathname.replace(/\/settlement\/?$/, `/${input.direction}`);
  const apiKey = process.env.VAULT_BANK_API_KEY?.trim() || process.env.VAULT_BANK_TRANSFER_API_KEY?.trim();
  const secretKey = process.env.VAULT_BANK_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) throw new Error('VAULT_BANK_API_KEY and VAULT_BANK_SECRET_KEY are required');
  const requestBody = {
    amount: input.amount,
    currency: input.currency,
    reference: input.reference,
    merchantId: input.merchantId,
    type: input.type,
    meta: input.meta || {},
  };
  const payloadText = JSON.stringify(requestBody);
  const timestamp = String(Date.now());
  const nonce = `${timestamp}-${uuidv4()}`;
  const signature = crypto
    .createHmac('sha512', secretKey)
    .update(`${timestamp}.${nonce}.${payloadText}`, 'utf8')
    .digest('hex');
  const response = await fetch(settlement.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': apiKey,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature,
      'Idempotency-Key': input.reference,
    },
    body: payloadText,
  });
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw: raw.slice(0, 1000) }; }
  if (!response.ok) throw Object.assign(new Error(body?.message || `Vault bank ${input.direction} rejected (${response.status})`), { code: body?.error });
  return body;
}

export async function transferMerchantFundsToVault(input: {
  merchantId: string;
  amount: number;
  currency?: string;
  reference?: string;
}): Promise<MerchantVaultTransferResult> {
  await ensureTransferTable();
  const merchantId = String(input.merchantId || '').trim();
  const amount = Number(input.amount);
  const currency = String(input.currency || 'USD').toUpperCase().trim();
  const reference = String(input.reference || `MVT-${uuidv4().slice(0, 8).toUpperCase()}`).trim();
  if (!merchantId) throw Object.assign(new Error('merchantId is required'), { code: 'VALIDATION_ERROR' });
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('amount must be positive'), { code: 'VALIDATION_ERROR' });
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error('currency must be a three-letter ISO code'), { code: 'VALIDATION_ERROR' });
  if (!reference) throw Object.assign(new Error('reference is required'), { code: 'VALIDATION_ERROR' });

  const existing = (await db.query('SELECT * FROM merchant_vault_transfers WHERE reference = ? LIMIT 1', [reference])).rows[0] as any;
  if (existing?.status === 'COMPLETED') {
    const merchantWallet = await walletsService.getOrCreateMerchantWallet(merchantId, currency);
    return {
      success: true, transferId: existing.id, reference, merchantId, amount, currency,
      status: 'COMPLETED',
      merchantBalanceAfter: Number(merchantWallet.balance),
      vaultBalanceAfter: await vaultEngine.getVaultBalance(currency),
      externalReference: existing.external_reference || undefined,
    };
  }
  if (existing?.status === 'PENDING') throw Object.assign(new Error('A transfer with this reference is already in progress'), { code: 'TRANSFER_IN_PROGRESS' });

  const merchantWallet = await walletsService.getOrCreateMerchantWallet(merchantId, currency);
  const availableBalance = Number((await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id])).rows[0]?.balance || 0);
  if (availableBalance < amount) {
    throw Object.assign(new Error(`Insufficient ${currency} merchant wallet balance`), { code: 'NO_FUNDS' });
  }

  const transferId = existing?.id || uuidv4();
  const payload = {
    transferId,
    reference,
    merchantId,
    amount,
    currency,
    source: 'merchant_wallet',
    destination: 'vault_bank',
  };
  const now = new Date().toISOString();
  await db.query(
    `INSERT OR REPLACE INTO merchant_vault_transfers
      (id, merchant_id, amount, currency, reference, status, request_payload, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?, COALESCE((SELECT created_at FROM merchant_vault_transfers WHERE id = ?), ?))`,
    [transferId, merchantId, amount, currency, reference, JSON.stringify(payload), transferId, now],
  );

  let externalResponse: any;
  try {
    const endpoint = transferUrl();
    const requestBody = {
      entries: [{
        amount,
        currency,
        reference,
        merchantId,
        meta: { transferId, source: 'merchant_wallet' },
      }],
    };
    const payloadText = JSON.stringify(requestBody);
    const apiKey = process.env.VAULT_BANK_API_KEY?.trim() || process.env.VAULT_BANK_TRANSFER_API_KEY?.trim();
    const secretKey = process.env.VAULT_BANK_SECRET_KEY?.trim();
    if (!apiKey || !secretKey) throw new Error('VAULT_BANK_API_KEY and VAULT_BANK_SECRET_KEY are required');
    const timestamp = String(Date.now());
    const nonce = `${timestamp}-${uuidv4()}`;
    const signature = crypto.createHmac('sha512', secretKey).update(`${timestamp}.${nonce}.${payloadText}`, 'utf8').digest('hex');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Api-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
        'Idempotency-Key': reference,
      },
      body: payloadText,
    });
    const raw = await response.text();
    try { externalResponse = raw ? JSON.parse(raw) : {}; } catch { externalResponse = { raw: raw.slice(0, 1000) }; }
    if (!response.ok) throw new Error(`Vault bank transfer rejected (${response.status})`);
    if (!isConfirmedTransferResponse(externalResponse)) {
      throw new Error('Vault bank did not confirm the transfer. Merchant funds were not debited.');
    }
  } catch (error: any) {
    await db.query(
      'UPDATE merchant_vault_transfers SET status = ?, error_message = ?, response_payload = ? WHERE id = ?',
      ['FAILED', String(error?.message || error), JSON.stringify(externalResponse || {}), transferId],
    );
    throw error;
  }

  const externalReference = String(
    externalResponse?.entries?.[0]?.id
      || externalResponse?.transferId
      || externalResponse?.reference
      || externalResponse?.id
      || '',
  );
  await db.query('BEGIN IMMEDIATE');
  try {
    const current = Number((await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id])).rows[0]?.balance || 0);
    if (current < amount) throw Object.assign(new Error(`Insufficient ${currency} merchant wallet balance`), { code: 'NO_FUNDS' });
    await db.query(
      'UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?',
      [amount, now, merchantWallet.id],
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions
        (id, wallet_id, type, amount, currency, source, reference, description, created_at)
       VALUES (?, ?, 'debit', ?, ?, 'merchant_to_vault', ?, ?, ?)`,
      [uuidv4(), merchantWallet.id, amount, currency, reference, `Funds sent to vault bank${externalReference ? ` (${externalReference})` : ''}`, now],
    );
    await db.query(
      'UPDATE merchant_vault_transfers SET status = ?, external_reference = ?, response_payload = ?, completed_at = ? WHERE id = ?',
      ['COMPLETED', externalReference || null, JSON.stringify(externalResponse || {}), now, transferId],
    );
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }

  const merchantBalanceAfter = Number((await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id])).rows[0]?.balance || 0);
  return {
    success: true,
    transferId,
    reference,
    merchantId,
    amount,
    currency,
    status: 'COMPLETED',
    merchantBalanceAfter,
    vaultBalanceAfter: await vaultEngine.getVaultBalance(currency),
    externalReference: externalReference || undefined,
  };
}
