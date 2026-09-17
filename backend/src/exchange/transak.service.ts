import crypto from 'crypto';
import axios from 'axios';
import type {
  ExchangeProviderId,
  BuyAssetResult,
  SellAssetResult,
  WithdrawAssetResult,
  WithdrawOptions,
  GetPriceResult,
} from './exchange-provider.interface';

export type TransakMode = 'staging' | 'production';

export interface TransakConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  publicApiUrl: string;
  widgetUrl: string;
  referrerDomain: string;
  webhookSecret: string;
  authBaseUrl: string;
  mode: TransakMode;
}

export interface TransakCountryState {
  code: string;
  name: string;
  isAllowed: boolean;
}

export interface TransakCountryPartner {
  name: string;
  currencyCode: string;
  isCardPayment: boolean;
}

export type TransakSupportedDocument =
  | 'passport'
  | 'driving_licence'
  | 'national_identity_card'
  | (string & NonNullable<unknown>);

export interface TransakCountry {
  alpha2: string;
  alpha3: string;
  isAllowed: boolean;
  isLightKycAllowed?: boolean;
  name: string;
  currencyCode: string;
  supportedDocuments: TransakSupportedDocument[];
  partners?: TransakCountryPartner[];
  states?: TransakCountryState[];
}

export interface TransakCountriesResponse {
  response: TransakCountry[];
}

export interface TransakWidgetParams {
  apiKey?: string;
  referralCode?: string;
  referrerDomain?: string;
  redirectURL?: string;
  defaultCryptoCurrency?: string;
  defaultNetwork?: string;
  defaultFiatAmount?: number;
  defaultFiatCurrency?: string;
  cryptoCurrencyCode?: string;
  paymentMethod?: string;
  hideExchangeScreen?: boolean;
  disableWalletAddressForm?: boolean;
  userData?: Record<string, any>;
  fiatCurrency?: string;
  cryptoCurrencyList?: string;
  networks?: string;
  walletAddress?: string;
  email?: string;
  partnerCustomerId?: string;
  partnerOrderId?: string;
  partnerMetaData?: Record<string, any> | string;
  environment?: TransakMode;
  productsAvailed?: 'BUY' | 'SELL' | 'BUY,SELL';
  isAutoFillUserData?: boolean;
  excludeFiatCurrencies?: string;
  excludeNetworks?: string;
}

export interface CreateWidgetSessionResponse {
  sessionId?: string;
  widgetUrl: string;
  expiresAt: string;
}

export interface TransakOrder {
  id: string;
  status: string;
  statusHistories: Array<{ status: string; createdAt: string }>;
  fiatCurrency: string;
  fiatAmount: number;
  cryptoCurrency: string;
  cryptoAmount: number;
  network?: string;
  walletAddress?: string;
  transactionHash?: string;
  paymentOptionId?: string;
  partnerOrderId?: string;
  partnerCustomerId?: string;
  createdAt: string;
  updatedAt: string;
  conversionPrice?: number;
  fee?: number;
}

export interface CreateOrderRequest {
  requestId: string;
  userIp?: string;
}

export interface CreateOrderResponse {
  success: boolean;
  orderId?: string;
  status?: string;
  order?: TransakOrder;
  error?: string;
  message?: string;
}

// ── Headless Cards / Transaction Session Interfaces ─────────────────────
export interface TransactionSessionConfig {
  colorMode?: 'LIGHT' | 'DARK';
  colors?: {
    widgetBackgroundFillColor?: string;
    brandColor?: string;
    textPrimaryColor?: string;
    textSecondaryColor?: string;
    surfaceFillColor?: string;
    borderColor?: string;
    redColor?: string;
  };
}

export interface BillingAddress {
  firstName?: string;
  lastName?: string;
  street?: string;
  city?: string;
  state?: string;
  postCode?: string;
  country?: string;
}

export interface CreateTransactionSessionRequest {
  quoteId: string;
  walletAddress: string;
  successUrl: string;
  failureUrl: string;
  config?: TransactionSessionConfig;
  billingAddress?: BillingAddress;
}

export interface TransactionSessionResponse {
  success: boolean;
  sessionId?: string;
  expiresAt?: string;
  error?: string;
  message?: string;
}

export interface TransactionRequestStatusResponse {
  success: boolean;
  status?: string;
  orderId?: string;
  error?: string;
  message?: string;
}

export interface TransakUserOtpResponse {
  stateToken: string;
  email: string;
  expiresIn: number;
  isTncAccepted?: boolean;
}

export interface TransakUserVerifyResponse {
  accessToken: string;
  expiresAt?: number;
}

export interface TransakUserLimitsResponse {
  limits: Record<string, number>;
  spent: Record<string, number>;
  remaining: Record<string, number>;
  exceeded: Record<string, boolean>;
  shortage: Record<string, number>;
}

export interface TransakUserDetailsResponse {
  email: string;
  firstName?: string;
  lastName?: string;
  mobileNumber?: string;
  partnerUserId?: string;
  status?: string;
  kyc?: { status?: string; type?: 'SIMPLE' | 'STANDARD' | string };
  address?: Record<string, string>;
}

export interface TransakWalletAddressVerificationResponse {
  response: boolean;
}

export interface TransakWebhookQuery {
  eventID?: string;
  orderID?: string;
  limit?: number;
  skip?: number;
  startDate?: string;
  endDate?: string;
  status?: 'success' | 'failed';
}

export interface TransakWebhooksResponse {
  meta?: Record<string, unknown>;
  data: Array<Record<string, unknown>>;
}

export interface TransakOrdersQuery {
  limit?: number;
  skip?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
  sortOrder?: 'asc' | 'desc';
  walletAddress?: string;
  partnerOrderId?: string;
  productsAvailed?: 'BUY' | 'SELL';
}

export interface TransakOrdersResponse {
  meta?: Record<string, unknown>;
  data: Array<Record<string, unknown>>;
}

export interface TransakCryptoCurrency {
  symbol?: string;
  name?: string;
  isAllowed?: boolean;
  networks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

let accessTokenCache: {
  token: string;
  expiresAt: number;
} | null = null;

function isPlaceholder(value: string) {
  return !value || value.includes('your_') || value.includes('REPLACE') || value.includes('example');
}

export function isConfigured(): boolean {
  try {
    const cfg = getTransakConfig();
    return (cfg.mode === 'staging' || cfg.mode === 'production') && !isPlaceholder(cfg.apiKey) && !isPlaceholder(cfg.apiSecret);
  } catch {
    return false;
  }
}

export function getTransakConfig(): TransakConfig {
  const apiKey = process.env.TRANSAK_API_KEY?.trim() || '';
  const apiSecret = process.env.TRANSAK_API_SECRET?.trim() || '';
  const referrerDomain = process.env.TRANSAK_REFERRER_DOMAIN?.trim() || '';
  const webhookSecret = process.env.TRANSAK_WEBHOOK_SECRET?.trim() || '';
  const rawMode = (process.env.TRANSAK_MODE || '').toLowerCase();
  const requestedMode = rawMode as TransakMode;

  if (!apiKey || !apiSecret || isPlaceholder(apiKey) || isPlaceholder(apiSecret)) {
    throw new Error('Transak API keys not configured. Set TRANSAK_API_KEY and TRANSAK_API_SECRET.');
  }

  let mode: TransakMode = 'staging';
  let baseUrl = 'https://api-gateway-stg.transak.com';
  let publicApiUrl = 'https://api-stg.transak.com';
  let widgetUrl = 'https://global-stg.transak.com';

  if (requestedMode === 'production') {
    mode = 'production';
    baseUrl = process.env.TRANSAK_BASE_URL?.trim() || 'https://api-gateway.transak.com';
    publicApiUrl = process.env.TRANSAK_PUBLIC_API_URL?.trim() || 'https://api.transak.com';
    widgetUrl = process.env.TRANSAK_WIDGET_URL?.trim() || 'https://global.transak.com';
  } else {
    mode = 'staging';
    baseUrl = process.env.TRANSAK_BASE_URL?.trim() || 'https://api-gateway-stg.transak.com';
    publicApiUrl = process.env.TRANSAK_PUBLIC_API_URL?.trim() || 'https://api-stg.transak.com';
    widgetUrl = process.env.TRANSAK_WIDGET_URL?.trim() || 'https://global-stg.transak.com';
  }

  const authBaseUrl = process.env.TRANSAK_AUTH_BASE_URL?.trim() || (
    mode === 'production' ? 'https://api.transak.com' : 'https://api-stg.transak.com'
  );

  return { apiKey, apiSecret, baseUrl, publicApiUrl, widgetUrl, referrerDomain, webhookSecret, authBaseUrl, mode };
}

export async function generateAccessToken(forceRefresh = false): Promise<string> {
  const cfg = getTransakConfig();
  const now = Date.now();

  if (!forceRefresh && accessTokenCache && accessTokenCache.expiresAt > now + 60000) {
    return accessTokenCache.token;
  }

  try {
    const axiosInst = (await import('axios')).default;
    const res = await axiosInst.post(
      `${cfg.authBaseUrl}/partners/api/v2/refresh-token`,
      { apiKey: cfg.apiKey },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'api-secret': cfg.apiSecret,
        },
        timeout: 10000,
      }
    );

    const tokenData = res.data?.data || res.data;
    const token = tokenData?.accessToken || tokenData?.access_token || tokenData?.token;
    const expiresAt = Number(tokenData?.expiresAt || tokenData?.expires_at || 0) * 1000;

    if (!token) {
      throw new Error('Transak access token not returned in response');
    }

    accessTokenCache = {
      token,
      expiresAt: expiresAt > now ? expiresAt - 60000 : now + 6 * 24 * 60 * 60 * 1000,
    };

    return token;
  } catch (e: any) {
    throw new Error(`Transak access token generation failed: ${e?.message || String(e)}`);
  }
}

export async function createWidgetSession(
  widgetParams: TransakWidgetParams,
  opts?: { accessToken?: string; userIp?: string }
): Promise<CreateWidgetSessionResponse> {
  const cfg = getTransakConfig();
  const token = opts?.accessToken || (await generateAccessToken());
  const userIp = opts?.userIp || '0.0.0.0';

  const params: TransakWidgetParams & {
    apiKey: string;
    environment?: TransakMode;
    cryptoCurrencyCode?: string;
    network?: string;
    fiatAmount?: number;
    fiatCurrency?: string;
  } = {
    ...widgetParams,
    // These values must always come from the partner backend. Do not allow
    // client-supplied widget parameters to override them.
    apiKey: cfg.apiKey,
    referrerDomain: cfg.referrerDomain,
    environment: cfg.mode,
  };
  if (!cfg.referrerDomain) {
    throw new Error('Transak referrer domain is not configured. Set TRANSAK_REFERRER_DOMAIN.');
  }

  if (!params.cryptoCurrencyCode && params.defaultCryptoCurrency) {
    params.cryptoCurrencyCode = params.defaultCryptoCurrency;
  }
  if (!params.network && params.defaultNetwork) params.network = params.defaultNetwork;
  if (params.fiatAmount === undefined && params.defaultFiatAmount !== undefined) {
    params.fiatAmount = params.defaultFiatAmount;
  }
  if (!params.fiatCurrency && params.defaultFiatCurrency) params.fiatCurrency = params.defaultFiatCurrency;

  const axiosInst = (await import('axios')).default;

  try {
    const res = await axiosInst.post(
      `${cfg.baseUrl}/api/v2/auth/session`,
      { widgetParams: params },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'x-user-ip': userIp,
          'access-token': token,
        },
        timeout: 10000,
      }
    );

    const responseData = res.data?.data || res.data;
    const widgetUrl = responseData?.widgetUrl || responseData?.widget_url;
    const sessionId = responseData?.sessionId || responseData?.session_id || (() => {
      try { return widgetUrl ? new URL(widgetUrl).searchParams.get('sessionId') || '' : ''; } catch { return ''; }
    })();
    const expiresAt = res.data?.expiresAt || res.data?.expires_at
      || new Date(Date.now() + 5 * 60 * 1000).toISOString();

    if (!widgetUrl) {
      throw new Error('Transak widget session response missing widgetUrl');
    }

    return { ...(sessionId ? { sessionId } : {}), widgetUrl, expiresAt };
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    throw new Error(`Transak widget session creation failed: ${msg}`);
  }
}

export async function sendUserOtp(email: string, userIp: string): Promise<TransakUserOtpResponse> {
  const cfg = getTransakConfig();
  const res = await axios.post(
    `${cfg.baseUrl}/api/v2/auth/login`,
    { apiKey: cfg.apiKey, email },
    {
      headers: {
        'x-api-key': cfg.apiKey,
        'x-user-ip': userIp,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  const data = res.data?.data || res.data;
  if (!data?.stateToken) throw new Error('Transak OTP response did not contain stateToken');
  return data as TransakUserOtpResponse;
}

export async function verifyUserOtp(
  email: string,
  otp: string,
  stateToken: string,
  userIp: string
): Promise<TransakUserVerifyResponse> {
  const cfg = getTransakConfig();
  const res = await axios.post(
    `${cfg.baseUrl}/api/v2/auth/verify`,
    { apiKey: cfg.apiKey, email, otp, stateToken },
    {
      headers: {
        'x-api-key': cfg.apiKey,
        'x-user-ip': userIp,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  const data = res.data?.data || res.data;
  const accessToken = data?.accessToken || data?.access_token || data?.token;
  if (!accessToken) throw new Error('Transak OTP verification did not return accessToken');
  const ttl = Number(data?.ttl || 0);
  return {
    accessToken,
    expiresAt: data?.expiresAt || data?.expires_at || (ttl > 0 ? Date.now() + ttl * 1000 : undefined),
  };
}

export async function refreshUserAccessToken(accessToken: string, userIp: string): Promise<TransakUserVerifyResponse> {
  const cfg = getTransakConfig();
  const res = await axios.get(`${cfg.baseUrl}/api/v2/auth/refresh`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-api-key': cfg.apiKey,
      'x-user-ip': userIp,
    },
    timeout: 15000,
  });
  const data = res.data?.data || res.data;
  const refreshedToken = data?.accessToken || data?.access_token || data?.token;
  if (!refreshedToken) throw new Error('Transak token refresh did not return accessToken');
  return { accessToken: refreshedToken };
}

export async function logoutUser(accessToken: string, userIp: string): Promise<void> {
  const cfg = getTransakConfig();
  await axios.post(
    `${cfg.baseUrl}/api/v1/auth/logout`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': cfg.apiKey,
        'x-user-ip': userIp,
      },
      timeout: 15000,
    }
  );
}

export async function onboardUserAuthReliance(email: string, userIp: string): Promise<TransakUserDetailsResponse> {
  const cfg = getTransakConfig();
  const partnerAccessToken = await generateAccessToken();
  const res = await axios.post(
    `${cfg.baseUrl}/api/v2/user/onboard`,
    {},
    {
      headers: {
        'x-access-token': partnerAccessToken,
        'x-api-key': cfg.apiKey,
        'x-user-identifier': email,
        'x-user-ip': userIp,
      },
      timeout: 15000,
    }
  );
  const data = res.data?.data || res.data;
  if (!data?.email) throw new Error('Transak onboarding response did not contain email');
  return data as TransakUserDetailsResponse;
}

export async function verifyWalletAddress(
  cryptoCurrency: string,
  network: string,
  walletAddress: string,
): Promise<TransakWalletAddressVerificationResponse> {
  const cfg = getTransakConfig();
  const res = await axios.get(`${cfg.publicApiUrl}/cryptocoverage/api/v1/public/verify-wallet-address`, {
    params: { cryptoCurrency, network, walletAddress },
    headers: { 'x-api-key': cfg.apiKey },
    timeout: 15000,
  });
  const data = res.data?.data || res.data;
  if (typeof data?.response !== 'boolean') throw new Error('Transak wallet-address verification response is invalid');
  return { response: data.response };
}

export async function getWebhooks(query: TransakWebhookQuery = {}): Promise<TransakWebhooksResponse> {
  const cfg = getTransakConfig();
  const accessToken = await generateAccessToken();
  const params: Record<string, string | number> = {};
  if (query.eventID) params.eventID = query.eventID;
  if (query.orderID) params.orderID = query.orderID;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.skip !== undefined) params.skip = query.skip;
  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  if (query.status) params.status = query.status;

  const res = await axios.get(`${cfg.publicApiUrl}/partners/api/v2/webhooks`, {
    params,
    headers: {
      'x-api-key': cfg.apiKey,
      'access-token': accessToken,
    },
    timeout: 15000,
  });
  const data = res.data?.data || res.data;
  if (!data || !Array.isArray(data.data)) throw new Error('Transak webhooks response is invalid');
  return { meta: data.meta, data: data.data };
}

export async function getUserLimits(params: {
  fiatCurrency: string;
  paymentCategory: string;
  kycType: 'SIMPLE' | 'STANDARD';
  accessToken: string;
  userIp: string;
}): Promise<TransakUserLimitsResponse> {
  const cfg = getTransakConfig();
  const res = await axios.get(`${cfg.baseUrl}/api/v2/orders/user-limit`, {
    params: {
      fiatCurrency: params.fiatCurrency,
      isBuyOrSell: 'BUY',
      kycType: params.kycType,
      paymentCategory: params.paymentCategory,
    },
    headers: {
      'x-api-key': cfg.apiKey,
      'x-user-ip': params.userIp,
      Authorization: `Bearer ${params.accessToken}`,
    },
    timeout: 15000,
  });
  const data = res.data?.data || res.data;
  if (!data?.limits || !data?.remaining) throw new Error('Transak user-limit response is incomplete');
  return data as TransakUserLimitsResponse;
}

export async function getUserDetails(accessToken: string, userIp: string): Promise<TransakUserDetailsResponse> {
  const cfg = getTransakConfig();
  const res = await axios.get(`${cfg.baseUrl}/api/v2/user/`, {
    params: { apiKey: cfg.apiKey },
    headers: {
      'x-api-key': cfg.apiKey,
      'x-user-ip': userIp,
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
  const data = res.data?.data || res.data;
  if (!data?.email) throw new Error('Transak user-details response did not contain email');
  return data as TransakUserDetailsResponse;
}

export async function getOrderStatus(orderId: string): Promise<TransakOrder> {
  const cfg = getTransakConfig();
  const token = await generateAccessToken();

  const axiosInst = (await import('axios')).default;
  const res = await axiosInst.get(
    `${cfg.publicApiUrl}/partners/api/v2/order/${encodeURIComponent(orderId)}`,
    {
      headers: {
        'x-api-key': cfg.apiKey,
        'access-token': token,
      },
      timeout: 10000,
    }
  );

  const order = res.data?.data || res.data;
  if (!order || !(order.id || order._id)) {
    throw new Error('Transak order response did not contain an order');
  }
  return {
    ...order,
    id: order.id || order._id,
    statusHistories: order.statusHistories || [],
    createdAt: order.createdAt || '',
    updatedAt: order.updatedAt || order.createdAt || '',
  } as TransakOrder;
}

export async function getOrders(query: TransakOrdersQuery = {}): Promise<TransakOrdersResponse> {
  const cfg = getTransakConfig();
  const accessToken = await generateAccessToken();
  const params: Record<string, string | number> = {
    limit: Math.min(Math.max(Number(query.limit || 100), 1), 100),
    skip: Math.max(Number(query.skip || 0), 0),
  };

  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  if (query.status) params['filter[status]'] = query.status;
  if (query.sortOrder) params['filter[sortOrder]'] = query.sortOrder;
  if (query.walletAddress) params['filter[walletAddress]'] = query.walletAddress;
  if (query.partnerOrderId) params['filter[partnerOrderId]'] = query.partnerOrderId;
  if (query.productsAvailed) params['filter[productsAvailed]'] = JSON.stringify([query.productsAvailed]);

  const res = await axios.get(`${cfg.publicApiUrl}/partners/api/v2/orders`, {
    params,
    headers: {
      'x-api-key': cfg.apiKey,
      'access-token': accessToken,
    },
    timeout: 15000,
  });
  const data = res.data || {};
  if (!Array.isArray(data.data)) {
    throw new Error('Transak orders response did not contain a data array');
  }
  return { meta: data.meta, data: data.data };
}

export async function getCryptoCurrencies(): Promise<{ response: TransakCryptoCurrency[] }> {
  const cfg = getTransakConfig();
  const res = await axios.get(`${cfg.publicApiUrl}/cryptocoverage/api/v1/public/crypto-currencies`, {
    headers: { 'x-api-key': cfg.apiKey },
    timeout: 15000,
  });
  const data = res.data || {};
  const currencies = data.response || data.data || [];
  if (!Array.isArray(currencies)) {
    throw new Error('Transak crypto-currencies response did not contain an array');
  }
  return { response: currencies };
}

export async function createOrder(
  req: CreateOrderRequest,
  opts?: { accessToken?: string; userIp?: string }
): Promise<CreateOrderResponse> {
  const cfg = getTransakConfig();
  const token = opts?.accessToken || (await generateAccessToken());
  const userIp = opts?.userIp || req.userIp || '0.0.0.0';

  const axiosInst = (await import('axios')).default;

  try {
    const res = await axiosInst.post(
      `${cfg.baseUrl}/api/v2/orders`,
      { requestId: req.requestId },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'x-user-ip': userIp,
          'access-token': token,
        },
        timeout: 15000,
      }
    );

    const order = res.data?.data || res.data;
    if (!order || !order.orderId) {
      throw new Error('Transak createOrder: missing orderId in response');
    }

    return {
      success: true,
      orderId: order.orderId,
      status: order.status,
      order,
    };
  } catch (e: any) {
    const errorMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message || String(e);
    console.error('[Transak] createOrder failed:', errorMsg, 'requestId:', req.requestId);
    
    return {
      success: false,
      error: errorMsg,
      message: `Failed to create Transak order: ${errorMsg}`,
    };
  }
}

export function verifyWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  signingSecret?: string
): boolean {
  const secret = signingSecret || process.env.TRANSAK_WEBHOOK_SECRET?.trim() || '';
  if (!secret) return false;
  const provided = String(signatureHeader || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : payload.toString('utf8'))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided, 'hex')
  );
}

// Coin → default network mapping for the quotes endpoint
const COIN_DEFAULT_NETWORK: Record<string, string> = {
  USDT: 'tron',
  USDC: 'ethereum',
  ETH:  'ethereum',
  BTC:  'bitcoin',
  BNB:  'bsc',
  MATIC: 'polygon',
  SOL:  'solana',
};

// Coin → default fiat to quote in (USD preferred, fallback USD)
const QUOTE_FIAT = 'USD';

export async function getPrice(coin: string): Promise<GetPriceResult> {
  const symbol = (coin || '').toUpperCase();

  // Stablecoins are always $1 — no need to call the API
  if (symbol === 'USDT' || symbol === 'USDC') {
    return { priceUsd: 1.0, provider: 'transak', symbol, timestamp: Date.now() };
  }

  const cfg = getTransakConfig();
  const axiosInst = (await import('axios')).default;
  const network = COIN_DEFAULT_NETWORK[symbol] || 'ethereum';

  // ── Use the public quotes endpoint: GET /api/v1/pricing/public/quotes ─────
  // This matches the API docs exactly and requires no auth token.
  try {
    const res = await axiosInst.get(
      `${cfg.publicApiUrl}/api/v1/pricing/public/quotes`,
      {
        params: {
          partnerApiKey: cfg.apiKey,
          fiatCurrency:  QUOTE_FIAT,
          cryptoCurrency: symbol,
          network,
          isBuyOrSell:   'BUY',
          fiatAmount:    100,         // quote for $100 to derive unit price
          paymentMethod: 'credit_debit_card',
        },
        headers: { 'x-api-key': cfg.apiKey },
        timeout: 8000,
      }
    );

    const quote = res.data?.response;
    if (quote && quote.fiatAmount > 0 && quote.cryptoAmount > 0) {
      // conversionPrice = fiat per 1 crypto unit  →  priceUsd = fiatAmount / cryptoAmount
      const priceUsd = quote.fiatAmount / quote.cryptoAmount;
      return {
        priceUsd,
        provider: 'transak',
        symbol,
        timestamp: Date.now(),
        raw: {
          quoteId:             quote.quoteId,
          conversionPrice:     quote.conversionPrice,
          marketConversionPrice: quote.marketConversionPrice,
          slippage:            quote.slippage,
          fiatAmount:          quote.fiatAmount,
          cryptoAmount:        quote.cryptoAmount,
          totalFee:            quote.totalFee,
          feeDecimal:          quote.feeDecimal,
          feeBreakdown:        quote.feeBreakdown,
          network,
          paymentMethod:       quote.paymentMethod,
        },
      };
    }
  } catch (e: any) {
    // fall through to error below
  }

  throw new Error(`Transak: no price data for ${symbol} (network=${network})`);
}

export async function buyAssetWithUsd(
  asset: string,
  amountUsd: number
): Promise<BuyAssetResult> {
  const symbol = (asset || '').toUpperCase();
  const cfg = getTransakConfig();

  if (isConfigured() && cfg.mode !== 'staging') {
    return {
      ok: false,
      provider: 'transak',
      asset: symbol,
      amount_usd: amountUsd,
      executed_qty: 0,
      executedQty: 0,
      status: 'WIDGET_REQUIRED',
      raw: { note: 'Transak fiat on-ramp requires the hosted widget flow. Use createWidgetSession() to generate a widget URL and redirect the user.' },
    };
  }

  let price = 1.0;
  try { price = (await getPrice(symbol)).priceUsd || 1; } catch { /* fallback */ }
  if (price <= 0) price = 1;
  const qty = amountUsd / price;

  return {
    ok: true,
    provider: 'transak',
    asset: symbol,
    amount_usd: amountUsd,
    executed_qty: qty,
    executedQty: qty,
    status: 'WIDGET_PENDING',
    order_id: `transak-${Date.now()}`,
  };
}

export async function sellAssetForUsdt(
  asset: string,
  amountBase: number
): Promise<SellAssetResult> {
  const symbol = (asset || '').toUpperCase();
  const cfg = getTransakConfig();

  if (isConfigured() && cfg.mode !== 'staging') {
    return {
      ok: false,
      provider: 'transak',
      asset: symbol,
      amount_sold: amountBase,
      executed_qty: 0,
      executedQty: 0,
      usdt_received: 0,
      status: 'WIDGET_REQUIRED',
      raw: { note: 'Transak fiat off-ramp requires the hosted widget SELL flow. Use createWidgetSession() with productsAvailed=SELL.' },
    };
  }

  let price = 1.0;
  try { price = (await getPrice(symbol)).priceUsd || 1; } catch { /* fallback */ }
  const usdt = amountBase * price;

  return {
    ok: true,
    provider: 'transak',
    asset: symbol,
    amount_sold: amountBase,
    executed_qty: amountBase,
    executedQty: amountBase,
    usdt_received: usdt,
    status: 'WIDGET_PENDING',
    order_id: `transak-sell-${Date.now()}`,
  };
}

export async function withdrawAsset(
  asset: string,
  address: string,
  network: string,
  amount: number,
  _opts?: WithdrawOptions
): Promise<WithdrawAssetResult> {
  return {
    ok: false,
    provider: 'transak',
    accepted: false,
    info: 'Transak is a fiat on/off-ramp — use direct blockchain rails (tronweb, bscweb, polygonweb) or exchange withdrawals (kucoin, binance) for on-chain crypto sends.',
  };
}

export function supportsNetwork(network: string, asset?: string): boolean {
  const net = (network || '').toUpperCase();
  const supported = [
    'TRC20', 'TRON', 'TRX',
    'BEP20', 'BSC', 'ERC20_BSC',
    'ERC20', 'ETHEREUM', 'ETH',
    'POLYGON', 'MATIC', 'ERC20_POLYGON',
    'SOL', 'SOLANA',
    'BTC', 'BITCOIN',
  ];
  return supported.includes(net);
}

export function hasDirectBlockchainRail(): boolean {
  return false;
}

export async function getCountries(): Promise<TransakCountriesResponse> {
  const cfg = getTransakConfig();
  const url = `${cfg.publicApiUrl}/api/v2/countries`;
  const res = await axios.get(url, {
    headers: { 'x-api-key': cfg.apiKey || '' },
    timeout: 20000,
  });
  const data = (res?.data || {}) as TransakCountriesResponse;
  if (!Array.isArray(data.response)) {
    throw new Error('Transak getCountries: response.response array missing, got ' + JSON.stringify(Object.keys(data)).slice(0, 200));
  }
  return data;
}

// ── Types for fiat currencies endpoints ──────────────────────────────────

export interface TransakFiatPaymentOption {
  id: string;
  name: string;
  processingTime: string;
  icon?: string;
  limitCurrency: string;
  minAmount: number;
  maxAmount: number;
  defaultAmount: number;
  // public API fields
  isActive?: boolean;
  isConverted?: boolean;
  isPayOutAllowed?: boolean;
  minAmountForPayOut?: number;
  maxAmountForPayOut?: number;
  defaultAmountForPayOut?: number;
  // whitelabel API fields
  isBuyAllowed?: boolean;
  isSellAllowed?: boolean;
  minAmountForSell?: number;
  maxAmountForSell?: number;
  defaultAmountForSell?: number;
  isNftAllowed?: boolean;
  provider?: string;
  visaPayoutCountries?: string[];
  mastercardPayoutCountries?: string[];
}

export interface TransakFiatCurrency {
  symbol: string;
  name: string;
  isAllowed: boolean;
  isPopular?: boolean;
  isSellAllowed?: boolean;
  supportingCountries?: string[];
  logoSymbol?: string;
  roundOff: number;
  isPayOutAllowed?: boolean;
  paymentOptions: TransakFiatPaymentOption[];
  displayMessage?: string;
  icon?: string;
}

export interface TransakFiatCurrenciesResponse {
  response: TransakFiatCurrency[];
}

export interface TransakQuoteParams {
  cryptoCurrency: string;
  fiatCurrency: string;
  isBuyOrSell: 'BUY' | 'SELL';
  network: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  paymentMethod?: string;
  quoteCountryCode?: string;
}

export interface TransakQuoteFeeBreakdown {
  name: string;
  value: number;
  id: string;
  ids: string[];
}

export interface TransakQuoteResponse {
  quoteId: string;
  conversionPrice: number;
  marketConversionPrice: number;
  slippage: number;
  fiatCurrency: string;
  cryptoCurrency: string;
  paymentMethod: string;
  fiatAmount: number;
  cryptoAmount: number;
  isBuyOrSell: 'BUY' | 'SELL';
  network: string;
  feeDecimal: number;
  totalFee: number;
  feeBreakdown: TransakQuoteFeeBreakdown[];
  nonce: number;
  cryptoLiquidityProvider: string;
  notes: string[];
}

// ── GET /fiat/public/v1/currencies/fiat-currencies (Public API) ───────────
// Returns all supported fiat currencies, their payment options and limits.
// Public endpoint — only the API key header is needed, no auth token.
export async function getFiatCurrencies(): Promise<TransakFiatCurrenciesResponse> {
  const cfg = getTransakConfig();
  const url = `${cfg.publicApiUrl}/fiat/public/v1/currencies/fiat-currencies`;
  const res = await axios.get(url, {
    headers: { 'x-api-key': cfg.apiKey || '' },
    timeout: 20000,
  });
  const data = (res?.data || {}) as TransakFiatCurrenciesResponse;
  if (!Array.isArray(data.response)) {
    throw new Error(
      'Transak getFiatCurrencies: response.response array missing. Got: ' +
      JSON.stringify(Object.keys(data)).slice(0, 200)
    );
  }
  return data;
}

// ── GET /api/v2/lookup/currencies/fiat-currencies (Whitelabel API) ─────────
// Returns fiat currencies with per-payment-option isBuyAllowed / isSellAllowed
// flags and dedicated sell limits (minAmountForSell, maxAmountForSell, etc.).
//
// Differences from the public API:
//   - Requires BOTH  x-api-key  AND  x-user-ip  headers
//   - Also needs  ?apiKey=  query param
//   - Response shape: { data: { fiatCurrencies: [...] } }
//   - Uses isBuyAllowed / isSellAllowed instead of isActive / isPayOutAllowed
//
// The result is normalised to { response: [...] } so callers treat both
// endpoints identically.
export async function getFiatCurrenciesWhitelabel(
  userIp: string,
  opts?: { apiKey?: string }
): Promise<TransakFiatCurrenciesResponse> {
  const cfg = getTransakConfig();
  const key = opts?.apiKey || cfg.apiKey || '';

  const res = await axios.get(
    `${cfg.baseUrl}/api/v2/lookup/currencies/fiat-currencies`,
    {
      params:  { apiKey: key },
      headers: {
        'x-api-key': key,
        'x-user-ip': userIp,
      },
      timeout: 20000,
    }
  );

  const raw = res?.data || {};
  // Whitelabel returns { data: { fiatCurrencies: [...] } }
  const currencies: TransakFiatCurrency[] =
    raw?.data?.fiatCurrencies ||
    (Array.isArray(raw?.data) ? raw.data : []);

  if (!Array.isArray(currencies)) {
    throw new Error(
      'Transak getFiatCurrenciesWhitelabel: unexpected response shape. Got: ' +
      JSON.stringify(Object.keys(raw)).slice(0, 200)
    );
  }

  // Normalise to the same shape as the public API
  return { response: currencies };
}

// ── GET /api/v1/pricing/public/quotes ─────────────────────────────────────
// Returns a real-time fiat↔crypto quote with full fee breakdown.
// Public endpoint — no auth token needed, partnerApiKey passed as query param.
//
// Rules (from Transak docs):
//   BUY:  fiatAmount OR cryptoAmount required (if both, cryptoAmount takes precedence)
//   SELL: cryptoAmount REQUIRED; fiatAmount is ignored if passed
export async function getQuote(params: TransakQuoteParams): Promise<TransakQuoteResponse> {
  const cfg = getTransakConfig();

  const queryParams: Record<string, string | number> = {
    partnerApiKey:  cfg.apiKey,
    fiatCurrency:   params.fiatCurrency,
    cryptoCurrency: params.cryptoCurrency,
    isBuyOrSell:    params.isBuyOrSell,
    network:        params.network,
    paymentMethod:  params.paymentMethod || 'credit_debit_card',
  };

  if (params.isBuyOrSell === 'SELL') {
    // SELL: cryptoAmount is required
    if (!params.cryptoAmount || params.cryptoAmount <= 0) {
      throw new Error('Transak getQuote: cryptoAmount is required for SELL quotes');
    }
    queryParams.cryptoAmount = params.cryptoAmount;
  } else {
    // BUY: pass at least one of fiatAmount / cryptoAmount
    // If both provided, Transak uses cryptoAmount (docs: cryptoAmount takes precedence)
    if (params.cryptoAmount && params.cryptoAmount > 0) {
      queryParams.cryptoAmount = params.cryptoAmount;
    } else if (params.fiatAmount && params.fiatAmount > 0) {
      queryParams.fiatAmount = params.fiatAmount;
    } else {
      throw new Error('Transak getQuote: fiatAmount or cryptoAmount required for BUY quotes');
    }
  }

  if (params.quoteCountryCode) {
    queryParams.quoteCountryCode = params.quoteCountryCode;
  }

  const res = await axios.get(
    `${cfg.publicApiUrl}/api/v1/pricing/public/quotes`,
    {
      params:  queryParams,
      headers: { 'x-api-key': cfg.apiKey },
      timeout: 10000,
    }
  );

  const quote = res.data?.response as TransakQuoteResponse;
  if (!quote || !quote.quoteId) {
    throw new Error(
      'Transak getQuote: unexpected response — missing quoteId. Raw: ' +
      JSON.stringify(res.data).slice(0, 400)
    );
  }
  return quote;
}

// ── Headless Cards: Create Transaction Session ────────────────────────
export async function createTransactionSession(
  req: CreateTransactionSessionRequest,
  opts?: { accessToken?: string; userIp?: string }
): Promise<TransactionSessionResponse> {
  const cfg = getTransakConfig();
  const token = opts?.accessToken || (await generateAccessToken());
  const userIp = opts?.userIp || '0.0.0.0';

  const axiosInst = (await import('axios')).default;

  try {
    const payload: Record<string, any> = {
      quoteId: req.quoteId,
      walletAddress: req.walletAddress,
      successUrl: req.successUrl,
      failureUrl: req.failureUrl,
    };

    if (req.config) {
      payload.config = req.config;
    }

    if (req.billingAddress) {
      payload.billingAddress = req.billingAddress;
    }

    const res = await axiosInst.post(
      `${cfg.baseUrl}/api/v2/transaction-session/`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'x-user-ip': userIp,
          'x-access-token': token,
        },
        timeout: 15000,
      }
    );

    const sessionData = res.data?.data || res.data;
    if (!sessionData || !sessionData.sessionId) {
      throw new Error('Transak createTransactionSession: missing sessionId in response');
    }

    return {
      success: true,
      sessionId: sessionData.sessionId,
      expiresAt: sessionData.expiresAt,
    };
  } catch (e: any) {
    const errorMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message || String(e);
    console.error('[Transak] createTransactionSession failed:', errorMsg, 'quoteId:', req.quoteId);

    return {
      success: false,
      error: errorMsg,
      message: `Failed to create transaction session: ${errorMsg}`,
    };
  }
}

// ── Headless Cards: Get Transaction Request Status ─────────────────────
export async function getTransactionRequestStatus(
  requestId: string,
  opts?: { accessToken?: string; userIp?: string }
): Promise<TransactionRequestStatusResponse> {
  const cfg = getTransakConfig();
  const token = opts?.accessToken || (await generateAccessToken());
  const userIp = opts?.userIp || '0.0.0.0';

  const axiosInst = (await import('axios')).default;

  try {
    const res = await axiosInst.get(
      `${cfg.baseUrl}/api/v2/transaction-session/request/${requestId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'x-user-ip': userIp,
          'x-access-token': token,
        },
        timeout: 10000,
      }
    );

    const data = res.data?.data || res.data;
    if (!data) {
      throw new Error('Transak getTransactionRequestStatus: empty response');
    }

    return {
      success: true,
      status: data.status,
      orderId: data.orderId,
    };
  } catch (e: any) {
    const errorMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message || String(e);
    console.error('[Transak] getTransactionRequestStatus failed:', errorMsg, 'requestId:', requestId);

    return {
      success: false,
      error: errorMsg,
      message: `Failed to get transaction request status: ${errorMsg}`,
    };
  }
}

// ── POST /api/v2/transaction-session (Headless Apple Pay) ─────────────────
// Creates a Headless Apple Pay transaction session.
// The quoteId MUST have been generated with paymentMethod=apple_pay.
// Returns { sessionId } which the frontend passes to the Apple Pay JS API.
//
// Auth options (at least one required):
//   - Standard: pass accessToken (from generateAccessToken)
//   - Auth Reliance: pass partnerAccessToken + userIdentifier (email)
export interface ApplePaySessionConfig {
  colorMode?: 'LIGHT' | 'DARK';
  borderRadius?: string;
  height?: string;
  [key: string]: string | undefined;
}

export interface ApplePayTransactionSessionParams {
  quoteId: string;
  walletAddress: string;
  userIp: string;
  config?: ApplePaySessionConfig;
  // auth options
  accessToken?: string;       // standard flow
  partnerAccessToken?: string; // auth reliance flow
  userIdentifier?: string;    // auth reliance flow — user email
}

export async function createApplePayTransactionSession(
  params: ApplePayTransactionSessionParams
): Promise<{ sessionId: string }> {
  const cfg = getTransakConfig();
  const key = cfg.apiKey || '';

  // Build auth headers — at least one of the auth methods must be present
  const authHeaders: Record<string, string> = {
    'x-api-key': key,
    'x-user-ip': params.userIp,
    'Content-Type': 'application/json',
  };

  if (params.accessToken) {
    authHeaders['authorization'] = `Bearer ${params.accessToken}`;
  }
  if (params.partnerAccessToken) {
    authHeaders['x-access-token'] = params.partnerAccessToken;
  }
  if (params.userIdentifier) {
    authHeaders['x-user-identifier'] = params.userIdentifier;
  }

  const body: Record<string, unknown> = {
    quoteId: params.quoteId,
    walletAddress: params.walletAddress,
  };
  if (params.config && Object.keys(params.config).length > 0) {
    body.config = params.config;
  }

  const res = await axios.post(
    `${cfg.baseUrl}/api/v2/transaction-session`,
    body,
    { headers: authHeaders, timeout: 15000 }
  );

  const sessionId: string =
    res.data?.data?.sessionId ||
    res.data?.sessionId ||
    res.data?.session_id;

  if (!sessionId) {
    throw new Error(
      'Transak Apple Pay: transaction session response missing sessionId. Raw: ' +
      JSON.stringify(res.data).slice(0, 300)
    );
  }

  return { sessionId };
}

export const id: ExchangeProviderId = 'transak';
export const name = 'Transak Fiat On/Off-Ramp';
