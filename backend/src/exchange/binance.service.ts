import crypto from 'crypto';
import axios from 'axios';

interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  mode: 'live' | 'sandbox' | 'blocked';
}

/** FATF Travel Rule Standard PII for originator (sender) — passed as JSON to Binance Local Entity endpoints. */
export interface StandardPii {
  /** Full legal name of the originator */
  name: string;
  /** Originator's local account / customer ID on our platform */
  accountNumber?: string;
  /** Customer-facing internal user identifier (maps to Binance originator KYC reference) */
  customerId?: string;
  /** Date of birth — YYYY-MM-DD */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2 country code of the place of birth */
  placeOfBirthCountryCode?: string;
  /** Nationality ISO 2-letter code */
  nationality?: string;
  /** National ID / Passport number */
  nationalIdentificationNumber?: string;
  /** National ID type: PASSPORT / NATIONAL_ID / DRIVERS_LICENSE / SOCIAL_SECURITY */
  nationalIdentificationType?: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'SOCIAL_SECURITY' | string;
  /** Issuing country ISO 2-letter code */
  countryOfIssue?: string;
  /** Street address — line 1 */
  addressLine1?: string;
  /** Street address — line 2 */
  addressLine2?: string;
  /** City / Town */
  city?: string;
  /** State / Province / Region */
  state?: string;
  /** Postal / ZIP code */
  postalCode?: string;
  /** Country ISO 2-letter code of residential address */
  countryCode?: string;
}

export interface TravelRuleBrokerWithdrawRequest {
  address: string;
  coin: string;
  amount: number;
  withdrawOrderId: string;
  /** JSON string or JSON object of travel-rule questionnaire answers per country.  */
  questionnaire: Record<string, any> | string;
  /** Originator PII (the sender / customer) — required for /broker/withdraw/apply. */
  originatorPii: StandardPii;
  addressTag?: string;
  network?: string;
  addressName?: string;
  transactionFeeFlag?: boolean;
  walletType?: 0 | 1;
  recvWindow?: number;
}

/**
 * Request body for the PLAIN Travel Rule withdraw endpoint:
 *   POST /sapi/v1/localentity/withdraw/apply
 *
 * Binance support (2026-08-11) directed us to use THIS endpoint for accounts
 * under a Travel Rule-mandatory jurisdiction (e.g. India), instead of the
 * older /capital/withdraw/apply or the /broker/withdraw/apply variant (which
 * is only for licensed brokers of local entities and requires a broker flag
 * on the API key).
 *
 * The ONLY mandatory extra field vs standard withdraw is `questionnaire`
 * (per-country JSON answers).  originatorPii is NOT required on this endpoint
 * but is accepted if passed.
 */
export interface TravelRuleWithdrawRequest {
  address: string;
  coin: string;
  amount: number;
  withdrawOrderId?: string;
  /** JSON string or JSON object — per India/withdraw-questionnaire on Binance docs. */
  questionnaire: Record<string, any> | string;
  /** Optional — will be JSON-stringified if supplied; endpoint does not require it. */
  originatorPii?: StandardPii;
  addressTag?: string;
  network?: string;
  addressName?: string;
  transactionFeeFlag?: boolean;
  walletType?: 0 | 1;
  recvWindow?: number;
}

export interface BrokerWithdrawResponse {
  trId: number;
  accepted: boolean;
  info?: string;
  /** Plain /localentity/withdraw/apply sometimes returns id instead of trId */
  id?: string;
}

export interface LocalEntityCountry {
  countryCode: string;
  countryName: string;
  blockType: 'supported' | 'limited' | 'blocked' | string;
  depositAllowed: boolean;
  withdrawalAllowed: boolean;
  hasRegionRestrictions: boolean;
  lastUpdated: number;
}

export interface QuestionnaireRequirements {
  questionnaireCountryCode: string;
}

/**
 * Default India Travel Rule withdrawal questionnaire.
 *
 * Per Binance docs (Withdraw Questionnaire Contents -> India):
 *   https://developers.binance.com/en/docs/products/wallet/travel-rule/withdraw-questionnaire#india
 *
 * sendTo = "1"  ->  self-transfer (originator == beneficiary)
 *   -> bnfType, bnfName, country, city are NOT required
 * isAddressOwner = "1"  ->  originator confirms they own the destination address
 *   -> vasp / vaspName are NOT required (no 3rd-party VASP involved)
 *
 * If the beneficiary is a 3rd party (sendTo != "1") the caller MUST override this
 * with the full questionnaire including bnfType/bnfName/country fields.
 */
export const INDIA_WITHDRAW_QUESTIONNAIRE: Record<string, string> = {
  isAddressOwner: '1',
  sendTo: '1',
};

export function getBinanceConfig(): BinanceConfig {
  const apiKey = process.env.BINANCE_API_KEY?.trim() || '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() || '';
  const modeFromEnv = String(process.env.BINANCE_MODE || '').toLowerCase().trim();
  const defaultSandbox = modeFromEnv === 'sandbox';
  const baseUrl = process.env.BINANCE_BASE_URL?.trim()
    || (defaultSandbox ? 'https://testnet.binance.vision' : 'https://api.binance.com');

  function isPlaceholder(value: string) {
    return !value || value.includes('your_') || value.includes('REPLACE') || value.includes('example');
  }

  if (!apiKey || !apiSecret || isPlaceholder(apiKey) || isPlaceholder(apiSecret)) {
    throw new Error(
      'CRYPTO_PURCHASE_BLOCKED: Binance API keys not configured. ' +
      'Set BINANCE_API_KEY + BINANCE_API_SECRET in backend/.env for production use.'
    );
  }

  const resolvedMode: 'live' | 'sandbox' = defaultSandbox ? 'sandbox' : 'live';
  return { apiKey, apiSecret, baseUrl, mode: resolvedMode };
}

function signQuery(params: Record<string, any>, apiSecret: string) {
  const qs = new URLSearchParams(params as any).toString();
  const signature = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
  return `${qs}&signature=${signature}`;
}

function signBody(body: URLSearchParams, apiSecret: string) {
  const signature = crypto.createHmac('sha256', apiSecret).update(body.toString()).digest('hex');
  body.append('signature', signature);
  return body;
}

async function binanceRequestPost(path: string, params: Record<string, any> = {}) {
  const { apiKey, apiSecret, baseUrl } = getBinanceConfig();

  const timestamp = Date.now();
  const signed = signQuery({ ...params, timestamp }, apiSecret);
  const url = `${baseUrl}${path}?${signed}`;
  const res = await axios.post(url, undefined, {
    headers: { 'X-MBX-APIKEY': apiKey },
    timeout: 15000,
  });
  return res.data;
}

async function binanceRequestGet(path: string, params: Record<string, any> = {}) {
  const { apiKey, apiSecret, baseUrl } = getBinanceConfig();
  const timestamp = Date.now();
  const signed = signQuery({ ...params, timestamp }, apiSecret);
  const url = `${baseUrl}${path}?${signed}`;
  const res = await axios.get(url, {
    headers: { 'X-MBX-APIKEY': apiKey },
    timeout: 15000,
  });
  if (res.data?.code && res.data.code !== '0') {
    throw Object.assign(new Error(`Binance ${path} error ${res.data.code}: ${res.data.msg || ''}`), { response: { data: res.data }, data: res.data });
  }
  return res.data;
}

export interface BinanceSpotBalance {
  asset: string;
  free: string;
  locked: string;
  freeNum: number;
  lockedNum: number;
  total: number;
}

export async function getSpotBalances(onlyNonZero: boolean = true): Promise<{ balances: BinanceSpotBalance[]; accountType: string; canTrade: boolean; timestamp: number }> {
  const data = await binanceRequestGet('/api/v3/account');
  const allBalances: BinanceSpotBalance[] = (data.balances || []).map((b: any) => {
    const free = parseFloat(b.free || '0');
    const locked = parseFloat(b.locked || '0');
    return {
      asset: String(b.asset),
      free: String(b.free),
      locked: String(b.locked),
      freeNum: free,
      lockedNum: locked,
      total: free + locked,
    };
  });
  return {
    balances: onlyNonZero ? allBalances.filter((b) => b.total > 0) : allBalances,
    accountType: String(data.accountType || data.type || 'SPOT'),
    canTrade: Boolean(data.canTrade ?? true),
    timestamp: Date.now(),
  };
}

export async function getLatestPrice(symbol: string): Promise<{ symbol: string; price: number; timestamp: number }> {
  const { baseUrl } = getBinanceConfig();
  const res = await axios.get(`${baseUrl}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol.toUpperCase())}`, { timeout: 5000 });
  const price = parseFloat(res.data?.price ?? '0');
  if (!price || !Number.isFinite(price)) throw new Error(`Binance price unavailable for ${symbol}`);
  return { symbol: symbol.toUpperCase(), price, timestamp: Date.now() };
}

export function isSymbolTradable(coin: string, quote: string = 'USDT'): boolean {
  const pair = `${coin.toUpperCase()}${quote.toUpperCase()}`;
  const invalidSameAsset = coin.toUpperCase() === quote.toUpperCase();
  return !invalidSameAsset && coin.trim().length > 0 && quote.trim().length > 0;
}

// Market buy using quoteOrderQty (amount in quote asset, e.g., USDT).
//
// REAL SPOT EXECUTION — NO INTERNAL NUMBERS.
//   • Non-USDT asset (BTC, ETH, SOL, TRX, etc.):
//       → REAL Binance SPOT MARKET BUY using quoteOrderQty = amount_usd
//       → Real BASE asset (e.g. BTC) lands in Binance SPOT wallet
//       → Fills are real, executedQty is real, withdrawable via Binance withdrawal APIs
//
//   • USDT specifically (USDTUSDT pair is INVALID on Binance spot):
//       → 2-STEP REAL SPOT CONVERSION:
//           Step 1: USD → SPOT BUY BTC via quoteOrderQty  (real BTC in SPOT wallet)
//           Step 2: BTC → SPOT SELL for USDT via quantity  (real USDT in SPOT wallet)
//       → Result is real USDT that can be withdrawn to Tron/EVM chains
//         via Binance /sapi/v1/localentity/withdraw/apply (Travel Rule compliant)
//       → If Step 2 fails after Step 1 succeeds, BTC is left in SPOT wallet;
//         caller can manually sell/retry. No funds lost.
export async function buyAssetWithUsd(asset: string, amountUsd: number) {
  const normalizedAsset = (asset || '').toUpperCase();
  if (!normalizedAsset) throw new Error('Asset symbol is required');
  if (amountUsd <= 0 || !Number.isFinite(amountUsd)) throw new Error('Amount must be a positive number');

  const cfg = getBinanceConfig();
  if (cfg.mode !== 'live' && cfg.mode !== 'sandbox') {
    throw Object.assign(new Error(
      `Binance config mode='${cfg.mode}' — LIVE credentials required. ` +
      `Set BINANCE_API_KEY + BINANCE_API_SECRET in backend/.env and unset BINANCE_MODE=sandbox.`
    ), { blocked: true, need_real_keys: true });
  }

  if (normalizedAsset === 'USDT') {
    let step1Order: any = null;
    let btcQty = 0;
    try {
      step1Order = await buyAssetWithUsd('BTC', amountUsd);
      btcQty = Number(step1Order.executedQty ?? 0);
      if (!btcQty || btcQty <= 0) throw new Error('2-step USDT via BTC failed at step 1 BTC buy: 0 quantity executed');
      if (!step1Order?.ok) throw new Error('2-step USDT via BTC failed at step 1 BTC buy: order not-ok');

      const step2 = await sellAssetForUsdt('BTC', btcQty);
      const usdtGot = Number(step2.usdt_received ?? 0);
      if (!usdtGot || usdtGot <= 0) {
        throw Object.assign(
          new Error(
            `2-step USDT via BTC: Step 2 (BTC→USDT sell) returned 0 USDT. ` +
            `BTC ${btcQty.toFixed(8)} was bought in Step 1 but remains in your Binance SPOT wallet — ` +
            `sell BTC→USDT manually to recover.`
          ),
          {
            step1_btc_bought: btcQty,
            step1_order: step1Order,
            step2_raw: step2,
            manual_recovery_required: true,
          }
        );
      }

      const allFills = [...(step1Order.fills || []), ...(step2.fills || [])];
      const firstOrderId = step1Order.order_id || step2.order_id;
      return {
        ok: true,
        provider: 'binance',
        asset: 'USDT',
        amount_usd: Number(amountUsd),
        executed_qty: usdtGot,
        executedQty: usdtGot,
        fills: allFills,
        status: 'FILLED_2STEP_BTC_USDT',
        order_id: firstOrderId ? String(firstOrderId) : `USDT-2STEP-${Date.now()}`,
        mock: false,
        is_spot_real: true,
        usdt_withdrawable: true,
        raw: {
          step1_buy_btc: step1Order.raw,
          step1_order_id: step1Order.order_id,
          step1_btc_executed: btcQty,
          step2_sell_btc_usdt: step2.raw,
          step2_order_id: step2.order_id,
          step2_usdt_received: usdtGot,
          note:
            '2-step USD→BTC→USDT (USDTUSDT pair invalid on Binance spot; ' +
            'this alternative yields REAL USDT on Binance SPOT wallet with fills on both legs. ' +
            'USDT is withdrawable to TRC20/BEP20/PolygonERC20 via Binance Travel Rule withdraw API.)',
        },
      };
    } catch (e: any) {
      const extra = step1Order
        ? ` Step 1 (BTC buy) ${btcQty ? `executed ${btcQty.toFixed(8)} BTC — remains in Binance SPOT. Sell BTC→USDT manually to recover.` : 'may have executed; check Binance SPOT BTC balance.'}`
        : ' No BTC buy executed yet.';
      console.error(`[Binance 2-step USDT conversion failed]: ${e?.message || String(e)}.${extra}`);
      throw Object.assign(
        new Error(`Binance USDT 2-step conversion (USD→BTC→USDT) failed: ${e?.message || String(e)}.${extra}`),
        { cause: e, step1_btc_bought: btcQty || 0, step1_order: step1Order, manual_recovery: !!btcQty }
      );
    }
  }

  if (!isSymbolTradable(normalizedAsset, 'USDT')) {
    throw new Error(
      `Binance spot pair ${normalizedAsset}USDT is not tradable (same-asset or empty). ` +
      `For USDT purchases use asset='USDT' to trigger the 2-step USD→BTC→USDT flow.`
    );
  }

  const symbol = `${normalizedAsset}USDT`;
  const params = {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quoteOrderQty: amountUsd.toString(),
    newOrderRespType: 'FULL',
  } as Record<string, any>;

  const order = await binanceRequestPost('/api/v3/order', params);
  if (order?.code) {
    throw new Error(`Binance order failed: ${order.msg || 'Unknown error'}`);
  }

  const executedQty = parseFloat(
    order.executedQty ||
    order.fills?.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty || 0), 0) ||
    '0'
  );
  const quoteSpent = parseFloat(
    order.cummulativeQuoteQty ||
    order.fills?.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty || 0) * parseFloat(fill.price || 0), 0) ||
    '0'
  );

  if (executedQty <= 0) {
    throw Object.assign(
      new Error(
        `Binance ${symbol} MARKET BUY: executedQty=0. quoteOrderQty=${amountUsd} USDT. ` +
        `Check Binance SPOT order history — if order was rejected funds never left wallet. ` +
        `If partially filled, fills are in order.fills but total executedQty rounds to 0.`
      ),
      { order, symbol, quoteOrderQty: amountUsd }
    );
  }

  return {
    ok: true,
    provider: 'binance',
    asset: normalizedAsset,
    amount_usd: Number(amountUsd),
    quote_spent_usdt: quoteSpent,
    executed_qty: executedQty,
    executedQty,
    fills: order.fills || [],
    status: order.status || 'FILLED',
    order_id: order.orderId?.toString() || order.id?.toString() || undefined,
    mock: Boolean(order?.mock),
    is_spot_real: true,
    spot_symbol: symbol,
    order_type: 'MARKET',
    side: 'BUY',
    quoteOrderQty: Number(amountUsd),
    avg_fill_price: executedQty > 0 ? (quoteSpent / executedQty) : null,
    raw: order,
  };
}

export async function withdrawAsset(
  asset: string,
  address: string,
  network: string,
  amount: number,
  opts: {
    questionnaire?: Record<string, any> | string;
    withdrawOrderId?: string;
    originatorPii?: StandardPii;
    addressTag?: string;
    addressName?: string;
    transactionFeeFlag?: boolean;
    walletType?: 0 | 1;
    recvWindow?: number;
  } = {}
) {
  const questionnaire = opts.questionnaire || INDIA_WITHDRAW_QUESTIONNAIRE;
  const resp = await travelRuleWithdrawApply({
    address,
    coin: asset,
    amount,
    questionnaire,
    withdrawOrderId: opts.withdrawOrderId,
    originatorPii: opts.originatorPii,
    addressTag: opts.addressTag,
    network,
    addressName: opts.addressName,
    transactionFeeFlag: opts.transactionFeeFlag,
    walletType: opts.walletType,
    recvWindow: opts.recvWindow,
  });
  return {
    ...resp,
    id: resp?.id,
    withdrawId: resp?.id,
  };
}

async function binanceSignedPost(path: string, fields: Record<string, any>, config?: BinanceConfig): Promise<any> {
  const cfg = config || getBinanceConfig();

  const body = new URLSearchParams();
  const entries = Object.entries({
    ...fields,
    timestamp: fields.timestamp || Date.now(),
  } as Record<string, any>);
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') body.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    else body.append(k, String(v));
  }

  const signature = crypto.createHmac('sha256', cfg.apiSecret).update(body.toString()).digest('hex');
  const url = `${cfg.baseUrl}${path}?${body.toString()}&signature=${signature}`;

  const res = await axios.post(url, body.toString(), {
    headers: {
      'X-MBX-APIKEY': cfg.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 20000,
  });
  if (res.data?.code && res.data.code !== '0') {
    throw Object.assign(new Error(`Binance ${path} error ${res.data.code}: ${res.data.msg || ''}`), { response: { data: res.data }, data: res.data });
  }
  return res.data;
}

async function binanceSignedGet(path: string, query: Record<string, any> = {}, config?: BinanceConfig): Promise<any> {
  const cfg = config || getBinanceConfig();
  const params: Record<string, any> = { ...query, timestamp: query.timestamp || Date.now() };
  const signed = signQuery(params, cfg.apiSecret);
  const url = `${cfg.baseUrl}${path}?${signed}`;
  const res = await axios.get(url, {
    headers: { 'X-MBX-APIKEY': cfg.apiKey },
    timeout: 15000,
  });
  if (res.data?.code && res.data.code !== '0') {
    throw Object.assign(new Error(`Binance ${path} error ${res.data.code}: ${res.data.msg || ''}`), { response: { data: res.data }, data: res.data });
  }
  return res.data;
}

// ── Binance Local Entity / Travel Rule Broker API ──────────────────────────
// These endpoints are for Binance "brokers of local entities" that require
// Travel Rule compliance programmatically.  Requires API key with broker /
// local-entity entitlements (otherwise you get HTTP 403 / -4104).

/**
 * GET /sapi/v1/localentity/country/list
 * Active country list for travel-rule questionnaires.  Currently AU only per
 * Binance docs; more added over time.  Weight 1 (IP-based).
 */
export async function getLocalEntityCountryList(query: { recvWindow?: number; timestamp?: number } = {}): Promise<{ countries: LocalEntityCountry[]; lastUpdated: number }> {
  return binanceSignedGet('/sapi/v1/localentity/country/list', query);
}

/**
 * GET /sapi/v1/localentity/questionnaire-requirements
 * Returns the applicable travel-rule country code for this API key's entity,
 * i.e. which jurisdiction's questionnaire must be submitted in broker withdrawals.
 * Weight 1 (IP-based).
 */
export async function getLocalEntityQuestionnaireRequirements(query: { recvWindow?: number; timestamp?: number } = {}): Promise<QuestionnaireRequirements> {
  return binanceSignedGet('/sapi/v1/localentity/questionnaire-requirements', query);
}

/**
 * POST /sapi/v1/localentity/withdraw/apply
 *
 * PLAIN Travel Rule Withdraw endpoint — the one Binance Support specifically
 * told us to use on 2026-08-11 for accounts in Travel Rule mandatory
 * jurisdictions (e.g. India) when the older /capital/withdraw/apply returns
 * code -4104.
 *
 * DIFFERENCE vs /broker/withdraw/apply:
 *   - NO broker/local-entity API key entitlement required.
 *   - Mandatory field is ONLY `questionnaire` (per-country answers).
 *   - `originatorPii` is optional, not required.
 *   - `withdrawOrderId` is optional.
 *
 * Questionnaire content per jurisdiction: for India use the schema at
 * https://developers.binance.com/en/docs/products/wallet/travel-rule/withdraw-questionnaire#india
 *
 * @returns Typically { id, trId, accepted, info } but shape varies; typed as BrokerWithdrawResponse for convenience.
 */
export async function travelRuleWithdrawApply(req: TravelRuleWithdrawRequest): Promise<BrokerWithdrawResponse> {
  const payload: Record<string, any> = {
    address: req.address,
    coin: req.coin.toUpperCase(),
    amount: Number(req.amount),
    questionnaire: typeof req.questionnaire === 'string' ? req.questionnaire : JSON.stringify(req.questionnaire || {}),
  };
  if (req.withdrawOrderId) payload.withdrawOrderId = String(req.withdrawOrderId);
  if (req.originatorPii && Object.keys(req.originatorPii).length) payload.originatorPii = JSON.stringify(req.originatorPii);
  if (req.addressTag) payload.addressTag = req.addressTag;
  if (req.network) payload.network = req.network;
  if (req.addressName) payload.addressName = encodeURIComponent(req.addressName).replace(/%20/g, '%2520');
  if (typeof req.transactionFeeFlag === 'boolean') payload.transactionFeeFlag = String(req.transactionFeeFlag);
  if (typeof req.walletType === 'number') payload.walletType = String(req.walletType);
  if (typeof req.recvWindow === 'number') payload.recvWindow = String(req.recvWindow);
  return binanceSignedPost('/sapi/v1/localentity/withdraw/apply', payload);
}

/**
 * POST /sapi/v1/localentity/broker/withdraw/apply
 * Broker Withdraw for local entities requiring Travel Rule.  Weight 600
 * (account-based).  On success returns { trId, accepted, info }.
 *
 * NOTE: Binance support clarified on 2026-08-11 that this /broker/ variant is
 * ONLY for LICENSED BROKERS of local entities and requires a broker flag on
 * the API key.  For standard user accounts under a Travel Rule jurisdiction
 * (e.g. India) use travelRuleWithdrawApply() -> /localentity/withdraw/apply
 * instead, which needs ONLY the questionnaire field and no broker entitlement.
 *
 * The `questionnaire` field is typically fetched from Binance's per-country
 * "Withdraw Questionnaire Contents" support page; it's a JSON object of
 * answers such as { sendTo, satoshiToken, isAddressOwner, verifyMethod } for
 * the AE/AU/other entity the API key is registered under.  When in doubt, call
 * getLocalEntityQuestionnaireRequirements() first to determine the country.
 */
export async function brokerWithdrawApply(req: TravelRuleBrokerWithdrawRequest): Promise<BrokerWithdrawResponse> {
  const payload: Record<string, any> = {
    address: req.address,
    coin: req.coin.toUpperCase(),
    amount: Number(req.amount),
    withdrawOrderId: String(req.withdrawOrderId),
    questionnaire: typeof req.questionnaire === 'string' ? req.questionnaire : JSON.stringify(req.questionnaire || {}),
    originatorPii: JSON.stringify(req.originatorPii || {}),
  };
  if (req.addressTag) payload.addressTag = req.addressTag;
  if (req.network) payload.network = req.network;
  if (req.addressName) payload.addressName = encodeURIComponent(req.addressName).replace(/%20/g, '%2520');
  if (typeof req.transactionFeeFlag === 'boolean') payload.transactionFeeFlag = String(req.transactionFeeFlag);
  if (typeof req.walletType === 'number') payload.walletType = String(req.walletType);
  if (typeof req.recvWindow === 'number') payload.recvWindow = String(req.recvWindow);
  return binanceSignedPost('/sapi/v1/localentity/broker/withdraw/apply', payload);
}

export async function sellAssetForUsdt(asset: string, amountBase: number) {
  const normalizedAsset = (asset || '').toUpperCase();
  if (!normalizedAsset) throw new Error('Asset symbol is required');
  if (normalizedAsset === 'USDT') throw new Error('Cannot sell USDT for USDT');

  const symbol = `${normalizedAsset}USDT`;
  const params = {
    symbol,
    side: 'SELL',
    type: 'MARKET',
    quantity: amountBase.toString(),
  } as Record<string, any>;

  const order = await binanceRequestPost('/api/v3/order', params);
  if (order?.code) {
    throw new Error(`Binance sell order failed: ${order.msg || 'Unknown error'}`);
  }

  const quoteReceived = parseFloat(
    order.cummulativeQuoteQty ||
    order.fills?.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty || 0) * parseFloat(fill.price || 0), 0) ||
    '0'
  );
  const executedQty = parseFloat(
    order.executedQty ||
    order.fills?.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty || 0), 0) ||
    '0'
  );

  return {
    ok: true,
    provider: 'binance',
    asset: normalizedAsset,
    amount_sold: amountBase,
    executed_qty: executedQty,
    executedQty,
    usdt_received: quoteReceived,
    fills: order.fills || [],
    status: order.status || 'FILLED',
    order_id: order.orderId?.toString() || order.id?.toString() || undefined,
    mock: Boolean(order?.mock),
    raw: order,
  };
}

export default {
  buyAssetWithUsd,
  sellAssetForUsdt,
  withdrawAsset,
  getLocalEntityCountryList,
  getLocalEntityQuestionnaireRequirements,
  travelRuleWithdrawApply,
  brokerWithdrawApply,
  getSpotBalances,
  getLatestPrice,
  isSymbolTradable,
};

