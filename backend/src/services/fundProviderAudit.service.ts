import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

export type FundProviderCallStatus = 'PENDING' | 'PROVIDER_SUCCESS' | 'PROVIDER_FAILED' | 'LEDGER_SUCCESS' | 'LEDGER_FAILED_RECONCILE_NEEDED';

export interface FundProviderCallRecord {
  id: string;
  flow_type: string;
  provider_name: string;
  endpoint_url: string;
  http_method: string;
  http_status: number | null;
  request_api_key_masked: string | null;
  request_idempotency_key: string | null;
  request_amount_minor: number | null;
  request_currency: string | null;
  request_payload_sha256: string | null;
  response_code_provider: string | null;
  response_reference: string | null;
  response_payload_truncated: string | null;
  response_at: string | null;
  ledger_status: FundProviderCallStatus;
  ledger_warning: string | null;
  wallet_id: string | null;
  wallet_owner_type: 'customer' | 'merchant' | null;
  wallet_owner_id: string | null;
  card_last4: string | null;
  protocol: string | null;
  mti: string | null;
  stan: string | null;
  auth_ref: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function maskApiKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

function sha256Hex(text: string): string {
  const cryptoLib = require('crypto') as typeof import('crypto');
  return cryptoLib.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function ensureFundProviderCallsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS fund_provider_calls (
      id TEXT PRIMARY KEY,
      flow_type TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      http_method TEXT NOT NULL,
      http_status INTEGER,
      request_api_key_masked TEXT,
      request_idempotency_key TEXT,
      request_amount_minor INTEGER,
      request_currency TEXT,
      request_payload_sha256 TEXT,
      response_code_provider TEXT,
      response_reference TEXT,
      response_payload_truncated TEXT,
      response_at TEXT,
      ledger_status TEXT NOT NULL DEFAULT 'PENDING',
      ledger_warning TEXT,
      wallet_id TEXT,
      wallet_owner_type TEXT,
      wallet_owner_id TEXT,
      card_last4 TEXT,
      protocol TEXT,
      mti TEXT,
      stan TEXT,
      auth_ref TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const cols = [
    ['request_api_key_masked', 'TEXT'],
    ['request_idempotency_key', 'TEXT'],
    ['response_payload_truncated', 'TEXT'],
    ['ledger_warning', 'TEXT'],
    ['wallet_owner_type', 'TEXT'],
    ['card_last4', 'TEXT'],
    ['protocol', 'TEXT'],
    ['mti', 'TEXT'],
    ['stan', 'TEXT'],
    ['auth_ref', 'TEXT'],
  ] as const;
  for (const [name, type] of cols) {
    try { await db.query(`ALTER TABLE fund_provider_calls ADD COLUMN ${name} ${type}`); } catch { /* exists */ }
  }
}

export async function insertFundProviderCall(input: {
  flowType: string;
  providerName: string;
  endpointUrl: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  rawApiKey?: string | null;
  idempotencyKey?: string | null;
  requestPayload?: Record<string, unknown> | string | null;
  amountMinor?: number | null;
  currency?: string | null;
  walletOwnerType?: 'customer' | 'merchant' | null;
  walletOwnerId?: string | null;
  cardLast4?: string | null;
  protocol?: string | null;
  mti?: string | null;
  stan?: string | null;
  authRef?: string | null;
}): Promise<string> {
  await ensureFundProviderCallsTable();
  const id = uuidv4();
  const now = new Date().toISOString();
  const payloadText =
    input.requestPayload == null ? '' :
    typeof input.requestPayload === 'string' ? input.requestPayload :
    JSON.stringify(input.requestPayload);
  await db.query(
    `INSERT INTO fund_provider_calls (
      id, flow_type, provider_name, endpoint_url, http_method,
      request_api_key_masked, request_idempotency_key,
      request_amount_minor, request_currency, request_payload_sha256,
      ledger_status, wallet_owner_type, wallet_owner_id,
      card_last4, protocol, mti, stan, auth_ref,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.flowType,
      input.providerName,
      input.endpointUrl,
      input.httpMethod,
      maskApiKey(input.rawApiKey),
      input.idempotencyKey || null,
      input.amountMinor ?? null,
      input.currency || null,
      payloadText ? sha256Hex(payloadText) : null,
      'PENDING',
      input.walletOwnerType || null,
      input.walletOwnerId || null,
      input.cardLast4 || null,
      input.protocol || null,
      input.mti || null,
      input.stan || null,
      input.authRef || null,
      now, now,
    ],
  );
  return id;
}

export async function markFundProviderProviderResult(input: {
  id: string;
  httpStatus: number | null;
  responseCodeProvider: string | null;
  responseReference: string | null;
  responsePayload?: Record<string, unknown> | string | null;
  errorMessage?: string | null;
  success: boolean;
}): Promise<void> {
  await ensureFundProviderCallsTable();
  const now = new Date().toISOString();
  const rawText =
    input.responsePayload == null ? '' :
    typeof input.responsePayload === 'string' ? input.responsePayload :
    JSON.stringify(input.responsePayload);
  await db.query(
    `UPDATE fund_provider_calls SET
       http_status = ?,
       response_code_provider = ?,
       response_reference = ?,
       response_payload_truncated = ?,
       response_at = ?,
       ledger_status = ?,
       error_message = ?,
       updated_at = ?
     WHERE id = ?`,
    [
      input.httpStatus,
      input.responseCodeProvider,
      input.responseReference,
      rawText ? rawText.slice(0, 4000) : null,
      now,
      input.success ? 'PROVIDER_SUCCESS' : 'PROVIDER_FAILED',
      input.errorMessage || null,
      now,
      input.id,
    ],
  );
}

export async function markFundProviderLedgerResult(input: {
  id: string;
  walletId: string | null;
  ledgerSuccess: boolean;
  reconcileWarning?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await ensureFundProviderCallsTable();
  const now = new Date().toISOString();
  await db.query(
    `UPDATE fund_provider_calls SET
       wallet_id = ?,
       ledger_status = ?,
       ledger_warning = ?,
       error_message = COALESCE(?, error_message),
       updated_at = ?
     WHERE id = ?`,
    [
      input.walletId || null,
      input.ledgerSuccess ? 'LEDGER_SUCCESS' : 'LEDGER_FAILED_RECONCILE_NEEDED',
      input.reconcileWarning || null,
      input.errorMessage || null,
      now,
      input.id,
    ],
  );
}

export function validateEndpointProtocol(url: string): void {
  if (!/^https?:\/\//i.test(String(url || '').trim())) {
    throw new Error(`Invalid endpoint protocol: URL must start with http:// or https://. Got: ${String(url).slice(0, 80)}`);
  }
}
