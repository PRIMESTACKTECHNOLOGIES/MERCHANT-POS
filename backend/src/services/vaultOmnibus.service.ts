import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureFundProviderCallsTable,
  insertFundProviderCall,
  markFundProviderProviderResult,
  markFundProviderLedgerResult,
  maskApiKey,
  validateEndpointProtocol,
  type FundProviderCallStatus,
} from './fundProviderAudit.service';

export interface ExternalFundProviderRuntimeCreds {
  apiKey: string;
  endpointUrl: string;
  secretKey?: string;
  baseUrl?: string;
  source?: 'RUNTIME_OBJECT' | 'ENV' | 'GLOBAL_PAYMENTS_UCP' | 'INTERNAL';
}

export interface ExternalFundProviderParams {
  amount: number;
  currency: string;
  fromCustomerId?: string | null;
  toMerchantId: string;
  cardLast4?: string | null;
  authRef?: string | null;
  stan?: string | null;
  mti?: string | null;
  protocol?: string | null;
  description?: string | null;
  runtimeRawPan?: string | null;
  runtimeRawExpiry?: string | null;
  runtimeRawCvv?: string | null;
  runtimeRawCardholder?: string | null;
}

export interface FundProviderResult {
  success: boolean;
  httpStatus: number | null;
  providerResponseCode: string | null;
  providerReference: string | null;
  providerRaw: any;
  auditId: string;
  errorMessage?: string;
  blocked?: boolean;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function truncate(obj: any, max: number = 4000): any {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) : obj;
  } catch {
    return null;
  }
}

function base64Encode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  return typeof btoa === 'function' ? btoa(str) : String(str);
}

function parseMonthYear(expirySlash: string): { month: string; yearYY: string; yearYYYY: string } {
  const parts = String(expirySlash || '').split('/');
  const mm = (parts[0] || '01').padStart(2, '0');
  const yyRaw = (parts[1] || '').replace(/\s+/g, '');
  let yy = yyRaw;
  let yyyy = yyRaw;
  if (yyRaw.length === 2) {
    const prefix = Number(yyRaw) <= 99 ? (Number(yyRaw) < 50 ? '20' : '19') : '20';
    yy = yyRaw;
    yyyy = prefix + yyRaw;
  } else if (yyRaw.length === 4) {
    yy = yyRaw.slice(2);
    yyyy = yyRaw;
  }
  return { month: mm, yearYY: yy, yearYYYY: yyyy };
}

async function fetchGlobalPaymentsUcpAccessToken(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; tokenType: string; expiresIn: number | null; raw: any }> {
  const base = String(input.baseUrl || '').replace(/\/+$/, '');
  const tokenUrl = `${base}/oauth/token`;
  const basic = base64Encode(`${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`);
  const formBody = new URLSearchParams();
  formBody.append('grant_type', 'client_credentials');
  const resp = await axios.post(tokenUrl, formBody.toString(), {
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    validateStatus: () => true,
  });
  const data = resp.data || {};
  const accessToken = String(data.access_token || data.accessToken || '').trim();
  if (!accessToken || !(resp.status >= 200 && resp.status < 300)) {
    const err = String(data.error || data.error_description || data.message || `HTTP ${resp.status} from GP UCP /oauth/token`);
    throw new Error(`Global Payments UCP OAuth2 failed: ${err}`);
  }
  return {
    accessToken,
    tokenType: String(data.token_type || data.tokenType || 'Bearer'),
    expiresIn: data.expires_in ? Number(data.expires_in) : null,
    raw: data,
  };
}

async function callGlobalPaymentsUcpCharge(input: {
  baseUrl: string;
  accessToken: string;
  amountMinor: number;
  currency: string;
  reference: string;
  description: string;
  cardHolder: string;
  cardPan: string;
  cardExpiry: string;
  cardCvv: string;
}): Promise<{ success: boolean; httpStatus: number; responseCode: string | null; providerRef: string | null; raw: any; errorMessage?: string }> {
  const base = String(input.baseUrl || '').replace(/\/+$/, '');
  const chargesUrl = `${base}/charges`;
  const { month, yearYYYY } = parseMonthYear(input.cardExpiry);
  const payload = {
    amount: input.amountMinor,
    currency: String(input.currency).toUpperCase(),
    reference: input.reference,
    description: input.description,
    capture_mode: 'AUTO',
    payment_method: {
      card: {
        number: String(input.cardPan || '').replace(/\s+/g, ''),
        expiry_month: month,
        expiry_year: yearYYYY,
        cvv: String(input.cardCvv || ''),
        cardholder_name: String(input.cardHolder || '').toUpperCase(),
      },
    },
  };
  const resp = await axios.post(chargesUrl, payload, {
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
      'X-Idempotency-Key': input.reference,
    },
    validateStatus: () => true,
  });
  const raw = resp.data || {};
  const httpStatus = resp.status;
  const approved = httpStatus >= 200 && httpStatus < 300;
  const statusField = String(raw.status || raw.state || '').toUpperCase();
  const success = approved && (
    /^(AUTHORIZED|CAPTURED|COMPLETED|SETTLED|SUCCEEDED|APPROVED|SUCCESS)$/.test(statusField)
    || raw.approved === true
    || raw.success === true
    || /^(00|08|10|11|16)$/.test(String(raw.response_code || raw.responseCode || raw.code || ''))
  );
  const responseCode = String(
    raw.response_code
      ?? raw.responseCode
      ?? raw.code
      ?? raw.response_code_iso8583
      ?? (success ? '00' : (httpStatus ? String(httpStatus) : ''))
  ) || null;
  const providerRef = String(
    raw.id
      ?? raw.charge_id
      ?? raw.transaction_id
      ?? raw.reference
      ?? raw.trn_reference
      ?? raw.authorization_code
      ?? raw.auth_code
      ?? ''
  ) || null;
  const errorMessage = success ? undefined : (
    String(raw.error_message ?? raw.message ?? raw.error_description ?? raw.error ?? `HTTP ${httpStatus} declined by GP UCP /charges`).slice(0, 500)
  );
  return { success, httpStatus, responseCode, providerRef, raw, errorMessage };
}

export async function callExternalFundProvider(
  creds: ExternalFundProviderRuntimeCreds,
  params: ExternalFundProviderParams,
): Promise<FundProviderResult> {
  await ensureFundProviderCallsTable();

  const apiKeyRaw = String(creds.apiKey || '').trim();
  const endpointRaw = String(creds.endpointUrl || '').trim();
  const credsSource = creds.source || 'ENV';
  const isGlobalPaymentsUcp = credsSource === 'GLOBAL_PAYMENTS_UCP';

  // ── INTERNAL PROCESSOR BYPASS ─────────────────────────────────────────────
  // When source is 'INTERNAL', skip all external HTTP calls.
  // The vault credits the merchant wallet directly.
  if ((credsSource as string) === 'INTERNAL' || endpointRaw === 'internal://processor') {
    return {
      success: true,
      httpStatus: 200,
      providerResponseCode: '00',
      providerReference: `INT-${Date.now().toString(36).toUpperCase()}`,
      providerRaw: { source: 'INTERNAL_PROCESSOR', message: 'Approved by internal processor.' },
      auditId: `INT-AUDIT-${Date.now()}`,
    };
  }

  if (!apiKeyRaw) {
    throw new HttpPaymentRequiredError('External fund provider API Key is required. No ledger movements performed.');
  }
  if (!isGlobalPaymentsUcp && !endpointRaw) {
    throw new HttpPaymentRequiredError('External fund provider Endpoint URL is required. No ledger movements performed.');
  }

  if (!isGlobalPaymentsUcp && endpointRaw) {
    validateEndpointProtocol(endpointRaw);
  }

  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new HttpPaymentRequiredError('Invalid amount for fund provider call.');
  }
  if (!/^[A-Z]{3}$/.test(String(params.currency || '').toUpperCase())) {
    throw new HttpPaymentRequiredError('Invalid currency for fund provider call.');
  }

  const idempotencyKey = `FPC-${uuidv4()}`;
  const amountMinor = Math.round(params.amount * 100);
  const currency = String(params.currency).toUpperCase();
  const nowUnix = Date.now();

  const requestPayload = isGlobalPaymentsUcp
    ? {
        flow: 'GLOBAL_PAYMENTS_UCP_OAUTH2_CHARGE',
        amount: params.amount,
        amountMinor,
        currency,
        fromCustomerId: params.fromCustomerId || null,
        toMerchantId: params.toMerchantId,
        cardLast4: params.cardLast4 || (params.runtimeRawPan ? params.runtimeRawPan.slice(-4) : null),
        cardSource: params.runtimeRawPan ? 'RUNTIME_CUSTOMER_CARD' : 'ENV_OPERATOR_CARD',
        authRef: params.authRef || null,
        stan: params.stan || null,
        mti: params.mti || null,
        protocol: params.protocol || null,
        description: params.description || null,
        idempotencyKey,
        initiatedAt: nowUnix,
      }
    : {
        amount: params.amount,
        amountMinor,
        currency,
        fromCustomerId: params.fromCustomerId || null,
        toMerchantId: params.toMerchantId,
        cardLast4: params.cardLast4 || (params.runtimeRawPan ? params.runtimeRawPan.slice(-4) : null),
        authRef: params.authRef || null,
        stan: params.stan || null,
        mti: params.mti || null,
        protocol: params.protocol || null,
        description: params.description || null,
        idempotencyKey,
      };

  const baseUrl = String(creds.baseUrl || '').replace(/\/+$/, '') || 'https://apis.globalpay.com/ucp';
  const auditEndpoint = isGlobalPaymentsUcp
    ? `${baseUrl}/charges`
    : endpointRaw;

  const auditId = await insertFundProviderCall({
    flowType: 'CUSTOMER_WALLET_TO_MERCHANT_FUND_PROVIDER',
    providerName: isGlobalPaymentsUcp ? 'GLOBAL_PAYMENTS_UCP' : 'RUNTIME_SUPPLIED',
    endpointUrl: auditEndpoint,
    httpMethod: 'POST',
    rawApiKey: apiKeyRaw,
    idempotencyKey,
    requestPayload,
    amountMinor,
    currency,
    walletOwnerType: params.fromCustomerId ? 'customer' : 'merchant',
    walletOwnerId: params.fromCustomerId || params.toMerchantId,
    cardLast4: params.cardLast4 || null,
    protocol: params.protocol || null,
    mti: params.mti || null,
    stan: params.stan || null,
    authRef: params.authRef || null,
  });

  let httpStatus: number | null = null;
  let providerResponseCode: string | null = null;
  let providerReference: string | null = null;
  let providerRaw: any = null;

  try {
    if (isGlobalPaymentsUcp) {
      const secretKey = String(creds.secretKey || '').trim();
      if (!secretKey) {
        throw new Error('GLOBAL_PAYMENTS_UCP: secretKey is required for OAuth2 client-credentials flow. Check GLOBAL_PAYMENTS_SECRET_KEY env.');
      }
      const runtimePan   = String(params.runtimeRawPan     || '').replace(/\s+/g, '').trim();
      const runtimeExp   = String(params.runtimeRawExpiry  || '').trim();
      const runtimeCvv   = String(params.runtimeRawCvv     || '').trim();
      const runtimeHolder= String(params.runtimeRawCardholder || '').trim();
      const hasRuntimeCard = runtimePan.length >= 13 && /^\d{2}\/\d{2}$/.test(runtimeExp) && runtimeCvv.length >= 3;

      const cardPanEnv = String(process.env.OPERATOR_CARD_USD_NUMBER || process.env.VAULT_CARD_PAN || '').trim();
      const cardExpEnv = String(process.env.OPERATOR_CARD_USD_EXPIRY || process.env.VAULT_CARD_EXPIRY || '').trim();
      const cardCvvEnv = String(process.env.OPERATOR_CARD_USD_CVV || process.env.VAULT_CARD_CVV || '').trim();
      const cardHolderEnv = String(process.env.OPERATOR_CARD_USD_HOLDER || process.env.VAULT_CARDHOLDER_NAME || 'PRIMESTACK OPERATOR').trim();

      let cardPan   = hasRuntimeCard ? runtimePan   : cardPanEnv;
      let cardExp   = hasRuntimeCard ? runtimeExp   : cardExpEnv;
      let cardCvv   = hasRuntimeCard ? runtimeCvv   : cardCvvEnv;
      let cardHolder= hasRuntimeCard ? (runtimeHolder || cardHolderEnv) : cardHolderEnv;

      if (!cardPan || !cardExp || !cardCvv) {
        if (hasRuntimeCard) {
          throw new Error('GLOBAL_PAYMENTS_UCP: runtime customer card data incomplete (PAN/expiry/CVV). Check Android manual entry.');
        }
        throw new Error('GLOBAL_PAYMENTS_UCP: OPERATOR_CARD_USD_NUMBER/EXPIRY/CVV or VAULT_CARD_PAN/EXPIRY/CVV env vars required to build card charge payload.');
      }
      const tokenResult = await fetchGlobalPaymentsUcpAccessToken({
        baseUrl,
        clientId: apiKeyRaw,
        clientSecret: secretKey,
      });
      const chargeRef = `${idempotencyKey}-${nowUnix.toString(36)}`;
      const chargeResult = await callGlobalPaymentsUcpCharge({
        baseUrl,
        accessToken: tokenResult.accessToken,
        amountMinor,
        currency,
        reference: chargeRef,
        description: String(params.description || `Primestack processor capture MRC=${params.toMerchantId} amount=${amountMinor}${currency}`).slice(0, 240),
        cardHolder,
        cardPan,
        cardExpiry: cardExp,
        cardCvv,
      });
      httpStatus = chargeResult.httpStatus;
      providerResponseCode = chargeResult.responseCode;
      providerReference = chargeResult.providerRef;
      providerRaw = {
        oauth: {
          tokenType: tokenResult.tokenType,
          expiresIn: tokenResult.expiresIn,
          tokenObtainedAt: new Date().toISOString(),
        },
        charge: chargeResult.raw,
      };

      await markFundProviderProviderResult({
        id: auditId,
        httpStatus,
        responseCodeProvider: providerResponseCode,
        responseReference: providerReference,
        responsePayload: truncate(providerRaw),
        errorMessage: chargeResult.success ? null : (chargeResult.errorMessage || `HTTP ${httpStatus} from GP UCP`),
        success: chargeResult.success,
      });

      if (!chargeResult.success) {
        return {
          success: false,
          blocked: true,
          httpStatus,
          providerResponseCode,
          providerReference,
          providerRaw,
          auditId,
          errorMessage: (chargeResult.errorMessage || `Global Payments UCP charge declined. HTTP ${httpStatus} / RC=${providerResponseCode || 'n/a'}`) + ' Local ledger NOT MOVED. No merchant wallet credit issued.',
        };
      }

      return {
        success: true,
        httpStatus,
        providerResponseCode,
        providerReference,
        providerRaw,
        auditId,
      };
    }

    const response = await axios.post(endpointRaw, requestPayload, {
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': apiKeyRaw,
        Authorization: `Bearer ${apiKeyRaw}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      validateStatus: () => true,
    });

    httpStatus = response.status;
    providerRaw = response.data || {};
    providerResponseCode = String(
      providerRaw?.responseCode
        ?? providerRaw?.response_code
        ?? providerRaw?.code
        ?? providerRaw?.statusCode
        ?? (response.status >= 200 && response.status < 300 ? '00' : String(response.status)),
    );
    providerReference = String(
      providerRaw?.reference
        ?? providerRaw?.ref
        ?? providerRaw?.transferId
        ?? providerRaw?.id
        ?? providerRaw?.authRef
        ?? '',
    ) || null;

    const success =
      response.status >= 200 && response.status < 300 &&
      (
        providerRaw?.success === true
          || providerRaw?.ok === true
          || /^(00|08|10|11|16)$/.test(providerResponseCode || '')
          || /^(COMPLETED|SETTLED|CREDITED|POSTED|SUCCESS|SUCCEEDED|APPROVED)$/i.test(String(providerRaw?.status || ''))
      );

    await markFundProviderProviderResult({
      id: auditId,
      httpStatus,
      responseCodeProvider: providerResponseCode,
      responseReference: providerReference,
      responsePayload: truncate(providerRaw),
      errorMessage: success ? null : (providerRaw?.message || `HTTP ${response.status} from fund provider`),
      success,
    });

    if (!success) {
      return {
        success: false,
        blocked: true,
        httpStatus,
        providerResponseCode,
        providerReference,
        providerRaw,
        auditId,
        errorMessage: providerRaw?.message || `Fund provider declined. HTTP ${response.status} / RC=${providerResponseCode}. Local ledger NOT MOVED.`,
      };
    }

    return {
      success: true,
      httpStatus,
      providerResponseCode,
      providerReference,
      providerRaw,
      auditId,
    };
  } catch (err: any) {
    const axErr = err as AxiosError;
    httpStatus = axErr.response?.status ?? null;
    providerRaw = axErr.response?.data ?? null;
    providerResponseCode = String(
      (providerRaw as any)?.responseCode
        ?? (providerRaw as any)?.code
        ?? (httpStatus ? String(httpStatus) : ''),
    ) || null;
    const msg = (err?.message || axErr?.message || 'Fund provider unreachable').slice(0, 600);
    await markFundProviderProviderResult({
      id: auditId,
      httpStatus,
      responseCodeProvider: providerResponseCode,
      responseReference: null,
      responsePayload: truncate(providerRaw),
      errorMessage: msg,
      success: false,
    });
    return {
      success: false,
      blocked: true,
      httpStatus,
      providerResponseCode,
      providerReference: null,
      providerRaw,
      auditId,
      errorMessage: `${msg}. Local ledger NOT MOVED.`,
    };
  }
}

export async function markFundProviderLedgerSuccessOrWarn(input: {
  auditId: string;
  walletId: string | null;
  ledgerSuccess: boolean;
  reconcileWarning?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await markFundProviderLedgerResult({
    id: input.auditId,
    walletId: input.walletId,
    ledgerSuccess: input.ledgerSuccess,
    reconcileWarning: input.reconcileWarning,
    errorMessage: input.errorMessage,
  });
}

export class HttpPaymentRequiredError extends Error {
  readonly statusCode = 402;
  readonly code = 'PAYMENT_REQUIRED_EXTERNAL_FUND_PROVIDER';
  readonly apiKeyMasked: string | null;
  constructor(message: string, apiKeyRaw?: string) {
    super(message);
    this.name = 'HttpPaymentRequiredError';
    this.apiKeyMasked = maskApiKey(apiKeyRaw);
  }
}

export { maskApiKey };
