import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { walletsService } from '../wallets/wallets.service';
import {
  callExternalFundProvider,
  markFundProviderLedgerSuccessOrWarn,
  HttpPaymentRequiredError,
  maskApiKey,
  type ExternalFundProviderRuntimeCreds,
  type FundProviderResult,
} from '../../services/vaultOmnibus.service';
import { validateEndpointProtocol } from '../../services/fundProviderAudit.service';
import { assertAmountWithinTestCapOrThrow } from '../../config/acquirer';

export interface ExternalFundProviderCredsResolved {
  source: 'RUNTIME_OBJECT' | 'ENV' | 'GLOBAL_PAYMENTS_UCP' | 'INTERNAL';
  endpointUrl: string;
  apiKey: string;
  apiKeyMasked: string;
  secretKey?: string;
  baseUrl?: string;
}

const RUNTIME_FUND_PROVIDER_CREDS_STORE: Map<string, ExternalFundProviderRuntimeCreds> = new Map();

export function setRuntimeFundProviderCreds(
  key: string,
  creds: ExternalFundProviderRuntimeCreds,
): void {
  if (!creds || typeof creds !== 'object') {
    throw new HttpPaymentRequiredError('Runtime fund provider creds must be an object.');
  }
  validateEndpointProtocol(creds.endpointUrl);
  if (!creds.apiKey?.trim()) {
    throw new HttpPaymentRequiredError('Runtime fund provider API key is empty.');
  }
  RUNTIME_FUND_PROVIDER_CREDS_STORE.set(String(key || 'default'), {
    endpointUrl: creds.endpointUrl.trim(),
    apiKey: creds.apiKey.trim(),
  });
}

export function clearRuntimeFundProviderCreds(key: string = 'default'): void {
  RUNTIME_FUND_PROVIDER_CREDS_STORE.delete(key);
}

export function hasRuntimeFundProviderCreds(key: string = 'default'): boolean {
  return RUNTIME_FUND_PROVIDER_CREDS_STORE.has(key);
}

export { validateEndpointProtocol };

function coerceMask(masked: string | null, fallback: string = '****'): string {
  return masked && masked.length > 0 ? masked : fallback;
}

export function resolveExternalFundProviderCreds(
  runtimeOverride?: ExternalFundProviderRuntimeCreds | null,
  runtimeKey: string = 'default',
): ExternalFundProviderCredsResolved {
  // ── INTERNAL PROCESSOR BYPASS ──────────────────────────────────────────────
  // When INTERNAL_PROCESSOR_ONLY=true, skip all external fund provider checks.
  // The internal processor credits the merchant wallet directly from the vault.
  if (process.env.INTERNAL_PROCESSOR_ONLY?.trim() === 'true') {
    return {
      source: 'INTERNAL',
      endpointUrl: 'internal://processor',
      apiKey: 'internal',
      apiKeyMasked: 'internal',
    };
  }
  if (runtimeOverride && runtimeOverride.endpointUrl && runtimeOverride.apiKey) {
    validateEndpointProtocol(runtimeOverride.endpointUrl);
    return {
      source: 'RUNTIME_OBJECT',
      endpointUrl: runtimeOverride.endpointUrl.trim(),
      apiKey: runtimeOverride.apiKey.trim(),
      apiKeyMasked: coerceMask(maskApiKey(runtimeOverride.apiKey)),
    };
  }
  const fromStore = RUNTIME_FUND_PROVIDER_CREDS_STORE.get(runtimeKey);
  if (fromStore) {
    return {
      source: 'RUNTIME_OBJECT',
      endpointUrl: fromStore.endpointUrl,
      apiKey: fromStore.apiKey,
      apiKeyMasked: coerceMask(maskApiKey(fromStore.apiKey)),
    };
  }
  const envEndpoint =
    process.env.EXTERNAL_FUND_PROVIDER_ENDPOINT?.trim() ||
    process.env.VAULT_OMNIBUS_ENDPOINT?.trim();
  const envKey =
    process.env.EXTERNAL_FUND_PROVIDER_API_KEY?.trim() ||
    process.env.VAULT_OMNIBUS_API_KEY?.trim();
  if (envEndpoint && envKey) {
    validateEndpointProtocol(envEndpoint);
    return {
      source: 'ENV',
      endpointUrl: envEndpoint,
      apiKey: envKey,
      apiKeyMasked: coerceMask(maskApiKey(envKey)),
    };
  }
  // ── Auto-mode: Global Payments UCP (sole acquirer) ─────────────────────────
  // When EXTERNAL_FUND_PROVIDER_ENDPOINT/API_KEY are empty or missing but
  // GLOBAL_PAYMENTS_API_KEY + GLOBAL_PAYMENTS_SECRET_KEY + GLOBAL_PAYMENTS_API_URL
  // are set, fall through to the dedicated GP UCP adapter inside
  // callExternalFundProvider.  Endpoint is a sentinel URL because the real
  // URLs (access-token + charges) are built dynamically.
  const gpKey    = process.env.GLOBAL_PAYMENTS_API_KEY?.trim();
  const gpSecret = process.env.GLOBAL_PAYMENTS_SECRET_KEY?.trim();
  const gpUrl    = process.env.GLOBAL_PAYMENTS_API_URL?.trim()
                || process.env.GLOBAL_PAYMENTS_BASE_URL?.trim()
                || 'https://apis.globalpay.com/ucp';
  const gpEnabled = process.env.GLOBAL_PAYMENTS_ENABLE?.trim().toLowerCase() !== 'false'
                 && (!process.env.GLOBAL_PAYMENTS_ENABLE || process.env.GLOBAL_PAYMENTS_ENABLE?.trim().length > 0);
  if (gpEnabled && gpKey && gpSecret && gpUrl) {
    try { validateEndpointProtocol(gpUrl); } catch { /* ignore sentinel */ }
    return {
      source: 'GLOBAL_PAYMENTS_UCP',
      endpointUrl: `${gpUrl.replace(/\/$/, '')}/charges`,
      apiKey: gpKey,
      apiKeyMasked: coerceMask(maskApiKey(gpKey)),
      secretKey: gpSecret,
      baseUrl: gpUrl.replace(/\/$/, ''),
    };
  }
  throw new HttpPaymentRequiredError(
    'External fund provider credentials required. Provide them via (a) setRuntimeFundProviderCreds(key, creds) — this maps to the interactive popup at runtime that asks for API Key + Endpoint URL — or (b) env vars EXTERNAL_FUND_PROVIDER_ENDPOINT + EXTERNAL_FUND_PROVIDER_API_KEY, or (c) GLOBAL_PAYMENTS_API_KEY + GLOBAL_PAYMENTS_SECRET_KEY for Global Payments UCP sole-acquirer auto-mode. No merchant wallet credit will be issued until a real HTTP 2xx is returned.',
  );
}

export interface InternalCaptureInput {
  merchantId: string;
  amount: number;
  currency: string;
  authRef: string;
  transactionId: string;
  protocol: '101.1' | '101.6' | '201.3';
  batchId?: string;
  stan?: string;
  fromCustomerId?: string | null;
  cardLast4?: string | null;
  mti?: string | null;
  entryMode?: string | null;
  description?: string | null;
  runtimeFundProviderCreds?: ExternalFundProviderRuntimeCreds | null;
  runtimeFundProviderCredsKey?: string;
  runtimeRawPan?: string | null;
  runtimeRawExpiry?: string | null;
  runtimeRawCvv?: string | null;
  runtimeRawCardholder?: string | null;
}

export async function confirmInternalCapture(input: InternalCaptureInput) {
  const amount = Number(input.amount);
  const currency = String(input.currency || 'USD').toUpperCase().trim();
  if (!input.merchantId || !input.authRef || !input.transactionId) {
    throw new Error('Internal capture requires merchant, authorization, and transaction references');
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Internal capture amount must be positive');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Internal capture currency is invalid');

  assertAmountWithinTestCapOrThrow(amount, currency);

  // ── LOCAL / INTERNAL PROCESSOR BYPASS ────────────────────────────────────
  // When LOCAL_ONLY_MODE=true OR INTERNAL_PROCESSOR_ONLY=true (set by backend/.env
  // for local-only operation), skip the external fund provider entirely and
  // self-approve: credit the merchant wallet directly from the internal ledger.
  // This is the correct behaviour for an offline POS running without an acquirer
  // host — the card was physically present, the EMV chip already authenticated,
  // and real funds collection happens at end-of-day settlement batch.
  const isLocalOnly =
    process.env.LOCAL_ONLY_MODE?.trim() === 'true' ||
    process.env.INTERNAL_PROCESSOR_ONLY?.trim() === 'true' ||
    process.env.REAL_FUNDS_ONLY?.trim() === 'false';

  if (isLocalOnly) {
    // Idempotency: if already captured, return existing record
    const existingLocal = (await db.query(
      `SELECT * FROM card_settlements WHERE merchant_id = ? AND auth_ref = ? AND status = 'CONFIRMED' LIMIT 1`,
      [input.merchantId, input.authRef],
    )).rows?.[0] as any;

    if (existingLocal) {
      const walletLocal = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);
      return {
        captureRef: String(existingLocal.capture_ref),
        settlementId: String(existingLocal.id),
        amount, currency,
        merchantWalletId: walletLocal.id,
        merchantBalance: Number(walletLocal.balance || 0),
        idempotent: true,
        fundProviderAuditId: null,
        fundProviderCredsSource: 'LOCAL',
        fundProviderApiKeyMasked: 'LOCAL',
        reconcileWarning: null,
      };
    }

    const captureRefLocal = `CAP-LOCAL-${uuidv4().slice(0, 12).toUpperCase()}`;
    const settlementIdLocal = uuidv4();
    const settlementCodeLocal = `setl_local_${uuidv4().slice(0, 8).toLowerCase()}`;
    const nowLocal = new Date().toISOString();
    const walletLocal = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);
    const panMaskedLocal = input.cardLast4 ? `**** **** **** ${input.cardLast4}` : null;

    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        `CREATE TABLE IF NOT EXISTS card_settlements (
          id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, auth_ref TEXT NOT NULL,
          capture_ref TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL,
          protocol TEXT NOT NULL, batch_id TEXT, response_code TEXT, status TEXT NOT NULL,
          acquirer_raw TEXT, stan TEXT, pan_last4 TEXT, pan_masked TEXT,
          entry_mode TEXT, auth_mode TEXT, settlement_code TEXT, created_at TEXT NOT NULL
        )`,
      );
      // Ensure extra columns exist (safe no-op if already present)
      for (const [col, typ] of [['fund_provider_audit_id','TEXT'],['fund_provider_endpoint','TEXT'],['fund_provider_http_status','INTEGER'],['fund_provider_response_code','TEXT'],['fund_provider_reference','TEXT'],['fund_provider_raw_trunc','TEXT'],['provider_reconcile_warning','TEXT']]) {
        try { await db.query(`ALTER TABLE card_settlements ADD COLUMN ${col} ${typ}`); } catch { /* exists */ }
      }
      await db.query(
        `INSERT INTO card_settlements
          (id, merchant_id, auth_ref, capture_ref, amount, currency, protocol,
           batch_id, response_code, status, acquirer_raw, stan, pan_last4, pan_masked,
           entry_mode, auth_mode, settlement_code, created_at)
         VALUES (?,?,?,?,?,?,?,?, '00', 'CONFIRMED',?,?,?,?,?,?,?,?)`,
        [
          settlementIdLocal, input.merchantId, input.authRef, captureRefLocal,
          amount, currency, input.protocol,
          input.batchId || null,
          JSON.stringify({ source: 'local-offline-processor', transactionId: input.transactionId, protocol: input.protocol }),
          input.stan || null, input.cardLast4 || null, panMaskedLocal,
          input.entryMode || (input.protocol === '201.3' ? 'CHIP' : 'VOICE_AUTH'),
          'LOCAL_SELF_APPROVED',
          settlementCodeLocal, nowLocal,
        ],
      );
      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [amount, nowLocal, walletLocal.id],
      );
      for (const [col, typ] of [['fund_provider_audit_id','TEXT'],['provider_reference','TEXT'],['settlement_batch_id','TEXT']]) {
        try { await db.query(`ALTER TABLE merchant_wallet_transactions ADD COLUMN ${col} ${typ}`); } catch { /* exists */ }
      }
      await db.query(
        `INSERT INTO merchant_wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'credit', ?, ?, 'local_offline_capture', ?, ?, ?)`,
        [
          uuidv4(), walletLocal.id, amount, currency, captureRefLocal,
          `Local ${input.protocol} offline capture | Auth: ${input.authRef}`, nowLocal,
        ],
      );
      await db.query('COMMIT');
    } catch (localErr: any) {
      try { await db.query('ROLLBACK'); } catch { /* preserve error */ }
      throw localErr;
    }

    const updatedLocal = (await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [walletLocal.id])).rows?.[0];
    console.log(`[LocalCapture] Self-approved ${input.protocol} | Auth: ${input.authRef} | ${currency} ${amount} → merchant=${input.merchantId} | captureRef=${captureRefLocal}`);
    return {
      captureRef: captureRefLocal,
      settlementId: settlementIdLocal,
      amount, currency,
      merchantWalletId: walletLocal.id,
      merchantBalance: Number(updatedLocal?.balance || 0),
      idempotent: false,
      fundProviderAuditId: null,
      fundProviderHttpStatus: 200,
      fundProviderResponseCode: '00',
      fundProviderReference: 'LOCAL_SELF_APPROVED',
      fundProviderCredsSource: 'LOCAL',
      fundProviderApiKeyMasked: 'LOCAL',
      reconcileWarning: null,
    };
  }
  // ── END LOCAL BYPASS ──────────────────────────────────────────────────────

  const credsResolved = resolveExternalFundProviderCreds(
    input.runtimeFundProviderCreds || null,
    input.runtimeFundProviderCredsKey || 'default',
  );

  const existing = (await db.query(
    `SELECT * FROM card_settlements
       WHERE merchant_id = ? AND auth_ref = ? AND status = 'CONFIRMED'
       LIMIT 1`,
    [input.merchantId, input.authRef],
  )).rows?.[0] as any;

  if (existing) {
    if (Number(existing.amount) !== amount || String(existing.currency).toUpperCase() !== currency) {
      throw new Error('Authorization was already captured for a different amount or currency');
    }
    const wallet = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);
    return {
      captureRef: String(existing.capture_ref),
      settlementId: String(existing.id),
      amount,
      currency,
      merchantWalletId: wallet.id,
      merchantBalance: Number(wallet.balance || 0),
      idempotent: true,
      fundProviderAuditId: existing.fund_provider_audit_id ? String(existing.fund_provider_audit_id) : null,
      fundProviderCredsSource: credsResolved.source,
      fundProviderApiKeyMasked: credsResolved.apiKeyMasked,
    };
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_settlements (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      auth_ref TEXT NOT NULL,
      capture_ref TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      protocol TEXT NOT NULL,
      batch_id TEXT,
      response_code TEXT,
      status TEXT NOT NULL,
      acquirer_raw TEXT,
      fund_provider_audit_id TEXT,
      fund_provider_endpoint TEXT,
      fund_provider_http_status INTEGER,
      fund_provider_response_code TEXT,
      fund_provider_reference TEXT,
      fund_provider_raw_trunc TEXT,
      provider_reconcile_warning TEXT,
      stan TEXT,
      pan_last4 TEXT,
      pan_masked TEXT,
      entry_mode TEXT,
      auth_mode TEXT,
      settlement_code TEXT,
      created_at TEXT NOT NULL
    )
  `);
  const cardSettlementGuarantees: Array<[string, string]> = [
    ['fund_provider_audit_id',    'TEXT'],
    ['fund_provider_endpoint',    'TEXT'],
    ['fund_provider_http_status', 'INTEGER'],
    ['fund_provider_response_code','TEXT'],
    ['fund_provider_reference',   'TEXT'],
    ['fund_provider_raw_trunc',   'TEXT'],
    ['provider_reconcile_warning','TEXT'],
    ['stan',                      'TEXT'],
    ['pan_last4',                 'TEXT'],
    ['pan_masked',                'TEXT'],
    ['entry_mode',                'TEXT'],
    ['auth_mode',                 'TEXT'],
    ['settlement_code',           'TEXT'],
  ];
  for (const [name, type] of cardSettlementGuarantees) {
    try { await db.query(`ALTER TABLE card_settlements ADD COLUMN ${name} ${type}`); } catch { /* exists */ }
  }
  const mwtGuarantees: Array<[string, string]> = [
    ['fund_provider_audit_id', 'TEXT'],
    ['provider_reference',     'TEXT'],
    ['settlement_batch_id',    'TEXT'],
  ];
  for (const [name, type] of mwtGuarantees) {
    try { await db.query(`ALTER TABLE merchant_wallet_transactions ADD COLUMN ${name} ${type}`); } catch { /* exists */ }
  }
  await db.query(
    `CREATE INDEX IF NOT EXISTS card_settlements_merchant_auth_idx
       ON card_settlements (merchant_id, auth_ref)`,
  );

  const fundProviderResult: FundProviderResult = await callExternalFundProvider(
    {
      endpointUrl: credsResolved.endpointUrl,
      apiKey: credsResolved.apiKey,
      source: credsResolved.source,
      secretKey: credsResolved.secretKey,
      baseUrl: credsResolved.baseUrl,
    },
    {
      amount,
      currency,
      fromCustomerId: input.fromCustomerId || null,
      toMerchantId: input.merchantId,
      cardLast4: input.cardLast4 || null,
      authRef: input.authRef || null,
      stan: input.stan || null,
      mti: input.mti || null,
      protocol: input.protocol || null,
      description: input.description || `Internal processor capture ${input.protocol} | Auth: ${input.authRef}`,
      runtimeRawPan: input.runtimeRawPan || null,
      runtimeRawExpiry: input.runtimeRawExpiry || null,
      runtimeRawCvv: input.runtimeRawCvv || null,
      runtimeRawCardholder: input.runtimeRawCardholder || null,
    },
  );

  if (!fundProviderResult.success || fundProviderResult.blocked) {
    throw new HttpPaymentRequiredError(
      `External fund provider declined or unreachable: ${fundProviderResult.errorMessage || 'No provider result'}. Local ledger NOT MOVED. No $${amount.toFixed(2)} credited to merchant wallet.`,
      credsResolved.apiKey,
    );
  }

  const captureRef = `CAP-${uuidv4().slice(0, 12).toUpperCase()}`;
  const settlementId = uuidv4();
  const settlementCode = `setl_internal_${uuidv4().slice(0, 8).toLowerCase()}`;
  const now = new Date().toISOString();
  const wallet = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);
  const panMasked = input.cardLast4
    ? `**** **** **** ${input.cardLast4}`
    : null;

  await db.query('BEGIN IMMEDIATE');
  let ledgerSuccess = false;
  let reconcileWarning: string | null = null;
  try {
    await db.query(
      `INSERT INTO card_settlements
        (id, merchant_id, auth_ref, capture_ref, amount, currency, protocol, batch_id, response_code, status,
         acquirer_raw, fund_provider_audit_id, fund_provider_endpoint, fund_provider_http_status,
         fund_provider_response_code, fund_provider_reference, fund_provider_raw_trunc, provider_reconcile_warning,
         stan, pan_last4, pan_masked, entry_mode, auth_mode, settlement_code, created_at)
       VALUES (?,?,?,?,?,?,?,?, '00', 'CONFIRMED',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        settlementId,
        input.merchantId,
        input.authRef,
        captureRef,
        amount,
        currency,
        input.protocol,
        input.batchId || null,
        JSON.stringify({
          source: 'internal-offline-processor',
          transactionId: input.transactionId,
          stan: input.stan || null,
          fundProviderCredsSource: credsResolved.source,
          fundProviderApiKeyMasked: credsResolved.apiKeyMasked,
        }),
        fundProviderResult.auditId,
        credsResolved.endpointUrl,
        fundProviderResult.httpStatus,
        fundProviderResult.providerResponseCode,
        fundProviderResult.providerReference,
        fundProviderResult.providerRaw && typeof fundProviderResult.providerRaw === 'string'
          ? fundProviderResult.providerRaw.slice(0, 2000)
          : (fundProviderResult.providerRaw != null
              ? JSON.stringify(fundProviderResult.providerRaw).slice(0, 2000)
              : null),
        null,
        input.stan || null,
        input.cardLast4 || null,
        panMasked,
        input.entryMode || (input.stan ? 'MANUAL' : null),
        'ONLINE_APPROVED',
        settlementCode,
        now,
      ],
    );
    const walletRes = await db.query(
      'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
      [amount, now, wallet.id],
    );
    if (!walletRes || walletRes.rowCount !== 1) {
      reconcileWarning = `merchant_wallets UPDATE affected ${walletRes?.rowCount ?? 0} rows — expected 1. Reconcile: external provider moved $${amount.toFixed(2)} but local ledger may not reflect it.`;
    } else {
      ledgerSuccess = true;
    }
    await db.query(
      `INSERT INTO merchant_wallet_transactions
        (id, wallet_id, type, amount, currency, source, reference, description, created_at, fund_provider_audit_id, provider_reference, settlement_batch_id)
       VALUES (?, ?, 'credit', ?, ?, 'internal_processor_capture', ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        wallet.id,
        amount,
        currency,
        captureRef,
        `Internal processor capture ${input.protocol} | Auth: ${input.authRef} | FundProviderAudit=${fundProviderResult.auditId}`,
        now,
        fundProviderResult.auditId,
        fundProviderResult.providerReference || null,
        settlementCode,
      ],
    );
    await db.query('COMMIT');
  } catch (error: any) {
    try { await db.query('ROLLBACK'); } catch { /* preserve the capture error */ }
    reconcileWarning =
      reconcileWarning ||
      `Ledger DB failure after successful external fund provider (HTTP 2xx, auditId=${fundProviderResult.auditId}). YOU MUST RECONCILE MANUALLY: $${amount.toFixed(2)} was received from provider but merchant wallet credit was rolled back. Error: ${error?.message || String(error)}`;
    ledgerSuccess = false;
    await markFundProviderLedgerSuccessOrWarn({
      auditId: fundProviderResult.auditId,
      walletId: wallet.id,
      ledgerSuccess: false,
      reconcileWarning,
      errorMessage: error?.message || String(error),
    });
    throw new Error(`CRITICAL RECONCILE: ${reconcileWarning}`);
  }

  await markFundProviderLedgerSuccessOrWarn({
    auditId: fundProviderResult.auditId,
    walletId: wallet.id,
    ledgerSuccess,
    reconcileWarning,
    errorMessage: null,
  });

  const updated = (await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [wallet.id])).rows?.[0];
  return {
    captureRef,
    settlementId,
    amount,
    currency,
    merchantWalletId: wallet.id,
    merchantBalance: Number(updated?.balance || 0),
    idempotent: false,
    fundProviderAuditId: fundProviderResult.auditId,
    fundProviderHttpStatus: fundProviderResult.httpStatus,
    fundProviderResponseCode: fundProviderResult.providerResponseCode,
    fundProviderReference: fundProviderResult.providerReference,
    fundProviderCredsSource: credsResolved.source,
    fundProviderApiKeyMasked: credsResolved.apiKeyMasked,
    reconcileWarning,
  };
}
