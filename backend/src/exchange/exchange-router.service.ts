import {
  ExchangeProvider,
  ExchangeProviderId,
  BuyAssetResult,
  SellAssetResult,
  WithdrawAssetResult,
  WithdrawOptions,
  GetPriceResult,
} from './exchange-provider.interface';

import {
  buyAssetWithUsd as binanceBuy,
  sellAssetForUsdt as binanceSell,
  withdrawAsset as binanceWithdraw,
} from './binance.service';
import {
  sendUsdt as tronSendUsdt,
  getHotWalletAddress as tronGetAddress,
  getHotWalletTrxBalance,
  getHotWalletUsdtBalance,
  prepareCustomerOriginTransfer as tronPrepareCustomerOrigin,
  submitCustomerSignedTransfer as tronSubmitSignedTransfer,
} from './tronweb.service';

let kucoinBuyFn: any = null;
let kucoinSellFn: any = null;
let kucoinWithdrawFn: any = null;
let kucoinIsConfiguredFn: any = null;
let kucoinGetPriceFn: any = null;

let transakBuyFn: any = null;
let transakSellFn: any = null;
let transakIsConfiguredFn: any = null;
let transakGetPriceFn: any = null;

let bscSendFn: any = null;
let bscIsConfiguredFn: any = null;
let polygonSendFn: any = null;
let polygonIsConfiguredFn: any = null;

async function loadKuCoin() {
  if (kucoinBuyFn) return;
  try {
    const mod = await import('./kucoin.service');
    kucoinBuyFn = mod.buyAssetWithUsd;
    kucoinSellFn = mod.sellAssetForUsdt;
    kucoinWithdrawFn = mod.withdrawAsset;
    kucoinIsConfiguredFn = mod.isConfigured;
    kucoinGetPriceFn = mod.getPrice;
  } catch {
    kucoinBuyFn = null;
  }
}

async function loadBsc() {
  if (bscSendFn) return;
  try {
    const mod = await import('./bscweb.service');
    bscSendFn = mod.sendUsdt;
    bscIsConfiguredFn = mod.isConfigured;
  } catch {
    bscSendFn = null;
  }
}

async function loadPolygon() {
  if (polygonSendFn) return;
  try {
    const mod = await import('./polygonweb.service');
    polygonSendFn = mod.sendUsdt;
    polygonIsConfiguredFn = mod.isConfigured;
  } catch {
    polygonSendFn = null;
  }
}

async function loadTransak() {
  if (transakBuyFn) return;
  try {
    const mod = await import('./transak.service');
    transakBuyFn = mod.buyAssetWithUsd;
    transakSellFn = mod.sellAssetForUsdt;
    transakIsConfiguredFn = mod.isConfigured;
    transakGetPriceFn = mod.getPrice;
  } catch {
    transakBuyFn = null;
  }
}

export function getProviderPriority(): ExchangeProviderId[] {
  const raw = (process.env.EXCHANGE_PROVIDER_PRIORITY || process.env.CRYPTO_PROVIDER_PRIORITY || '')
    .split(',')
    .map((s) => s.trim() as ExchangeProviderId)
    .filter((s) => !!s);
  if (raw.length > 0) return raw;
  const primary = (process.env.CRYPTO_PROVIDER || '').toLowerCase().trim() as ExchangeProviderId;
  if (primary && ['transak', 'kucoin', 'binance', 'tronweb', 'bscweb', 'polygonweb'].includes(primary)) {
    return [primary, 'tronweb', 'bscweb', 'polygonweb', 'binance'].filter(
      (v, i, a) => a.indexOf(v) === i
    ) as ExchangeProviderId[];
  }
  return ['transak', 'tronweb', 'bscweb', 'polygonweb', 'kucoin', 'binance'];
}

export function networkToNormalized(network: string): string {
  return String(network || '').toUpperCase().trim();
}

export function isTronNetwork(network: string): boolean {
  return ['TRX', 'TRC20', 'TRON'].includes(networkToNormalized(network));
}

export function isBscNetwork(network: string): boolean {
  return ['BSC', 'BEP20', 'BSC_BEP20', 'BINANCE_SMART_CHAIN'].includes(networkToNormalized(network));
}

export function isPolygonNetwork(network: string): boolean {
  return ['POLYGON', 'MATIC', 'ERC20_POLYGON', 'POLYGON_ERC20'].includes(networkToNormalized(network));
}

export function isEvmAddress(address: string): boolean {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function isTronAddress(address: string): boolean {
  return typeof address === 'string' && address.trim().startsWith('T') && address.trim().length >= 34;
}

export async function detectDirectRailForDestination(
  address: string,
  network?: string
): Promise<'tronweb' | 'bscweb' | 'polygonweb' | null> {
  const net = networkToNormalized(network || '');
  if (isTronNetwork(net)) return 'tronweb';
  if (isBscNetwork(net)) return 'bscweb';
  if (isPolygonNetwork(net)) return 'polygonweb';
  if (isTronAddress(address)) return 'tronweb';
  if (isEvmAddress(address)) {
    await loadBsc();
    await loadPolygon();
    if (bscIsConfiguredFn && bscIsConfiguredFn()) return 'bscweb';
    if (polygonIsConfiguredFn && polygonIsConfiguredFn()) return 'polygonweb';
    return 'bscweb';
  }
  return null;
}

export async function getBestPrice(coin: string): Promise<GetPriceResult> {
  const priority = getProviderPriority();
  const errors: string[] = [];
  for (const pid of priority) {
    try {
      if (pid === 'transak') {
        await loadTransak();
        if (transakGetPriceFn && transakIsConfiguredFn && transakIsConfiguredFn()) {
          try {
            const res = await transakGetPriceFn(coin);
            if (res && res.priceUsd > 0) return res;
          } catch (e: any) { errors.push(`transak:${e?.message}`); }
        }
      } else if (pid === 'binance') {
        try {
          const symbol = coin === 'USDT' ? 'BTCUSDT' : `${coin.toUpperCase()}USDT`;
          const apiKey = process.env.BINANCE_API_KEY?.trim();
          if (apiKey && !apiKey.includes('your_')) {
            const axios = (await import('axios')).default;
            const baseUrl = process.env.BINANCE_BASE_URL?.trim() || 'https://api.binance.com';
            const res = await axios.get(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`, { timeout: 4000 });
            const price = parseFloat(res.data?.price ?? '0');
            if (price > 0) {
              return {
                priceUsd: coin === 'USDT' ? 1.0 : price,
                provider: 'binance',
                symbol: coin.toUpperCase(),
                timestamp: Date.now(),
              };
            }
          }
        } catch (e: any) { errors.push(`binance:${e?.message}`); }
      } else if (pid === 'kucoin') {
        await loadKuCoin();
        if (kucoinGetPriceFn && kucoinIsConfiguredFn && kucoinIsConfiguredFn()) {
          try {
            const res = await kucoinGetPriceFn(coin);
            if (res && res.priceUsd > 0) return res;
          } catch (e: any) { errors.push(`kucoin:${e?.message}`); }
        }
      }
    } catch { /* skip */ }
  }
  try {
    const coinMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', SOL: 'solana',
      DOGE: 'dogecoin', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano',
      AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink',
      TRX: 'tron',
    };
    const id = coinMap[coin.toUpperCase()];
    if (id) {
      const axios = (await import('axios')).default;
      const res = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      const price = res.data?.[id]?.usd;
      if (price) return { priceUsd: price, provider: 'coingecko', symbol: coin.toUpperCase(), timestamp: Date.now() };
    }
  } catch { /* ignore */ }
  throw new Error(`LIVE_PRICE_UNAVAILABLE: no live price provider returned a price for ${coin.toUpperCase()}.`);
}

export async function buyAssetBestEffort(asset: string, amountUsd: number): Promise<BuyAssetResult> {
  const priority = getProviderPriority();
  const errors: string[] = [];
  for (const pid of priority) {
    try {
      if (pid === 'transak') {
        await loadTransak();
        if (transakBuyFn && transakIsConfiguredFn && transakIsConfiguredFn()) {
          try {
            const order = await transakBuyFn(asset, amountUsd);
            if (order && order.ok) return order;
            if (order && order.status === 'WIDGET_REQUIRED') return order;
          } catch (e: any) { errors.push(`transak:${e?.message}`); }
        }
      } else if (pid === 'binance') {
        try {
          const order = await binanceBuy(asset, amountUsd);
          if (order) {
            return {
              ok: true,
              provider: 'binance',
              asset: order.asset,
              amount_usd: Number(order.amount_usd),
              executed_qty: Number(order.executedQty),
              executedQty: Number(order.executedQty),
              fills: order.fills,
              status: order.status,
              order_id: order.order_id,
              raw: order.raw,
            };
          }
        } catch (e: any) { errors.push(`binance:${e?.message}`); }
      } else if (pid === 'kucoin') {
        await loadKuCoin();
        if (kucoinBuyFn && kucoinIsConfiguredFn && kucoinIsConfiguredFn()) {
          try {
            const order = await kucoinBuyFn(asset, amountUsd);
            if (order) return order;
          } catch (e: any) { errors.push(`kucoin:${e?.message}`); }
        }
      }
    } catch { /* continue */ }
  }

  throw Object.assign(new Error(
    `NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED. Tried providers: [${priority.join(', ')}]. Errors: [${errors.join(' | ')}]`
  ), { exchange_errors: errors, status: 'NO_LIVE_PROVIDER', blocked: true });
}

export async function sellAssetBestEffort(asset: string, amountBase: number): Promise<SellAssetResult> {
  const priority = getProviderPriority();
  const errors: string[] = [];
  for (const pid of priority) {
    try {
      if (pid === 'transak') {
        await loadTransak();
        if (transakSellFn && transakIsConfiguredFn && transakIsConfiguredFn()) {
          try {
            const order = await transakSellFn(asset, amountBase);
            if (order && order.ok) return order;
            if (order && order.status === 'WIDGET_REQUIRED') return order;
          } catch (e: any) { errors.push(`transak:${e?.message}`); }
        }
      } else if (pid === 'binance') {
        try {
          const order = await binanceSell(asset, amountBase);
          if (order) {
            return {
              ok: true,
              provider: 'binance',
              asset: order.asset,
              amount_sold: Number(order.amount_sold),
              executed_qty: Number(order.executedQty),
              executedQty: Number(order.executedQty),
              usdt_received: Number(order.usdt_received),
              fills: order.fills,
              status: order.status,
              order_id: order.order_id,
              raw: order.raw,
            };
          }
        } catch (e: any) { errors.push(`binance:${e?.message}`); }
      } else if (pid === 'kucoin') {
        await loadKuCoin();
        if (kucoinSellFn && kucoinIsConfiguredFn && kucoinIsConfiguredFn()) {
          try {
            const order = await kucoinSellFn(asset, amountBase);
            if (order && order.ok) return order;
          } catch (e: any) { errors.push(`kucoin:${e?.message}`); }
        }
      }
    } catch { /* continue */ }
  }
  throw Object.assign(new Error(
    `NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED: sell blocked for ${asset.toUpperCase()}. Errors: [${errors.join(' | ')}]`
  ), { exchange_errors: errors, status: 'NO_LIVE_PROVIDER', blocked: true });
}

/**
 * Send USDT directly via a direct blockchain rail.
 * 0 exchange, 0 KYC, 0 Travel Rule — direct hot-wallet or treasury-wallet broadcast.
 *
 * RAIL SELECTION (who signs the on-chain tx / pays the USDT):
 *  • rail = tronweb / bscweb / polygonweb → auto or forced sender
 *      → senderMode = 'hot'        → HOT wallet signs (holds only gas; typically defers)
 *      → senderMode = 'treasury'   → TREASURY wallet signs (holds real USDT for settlement)
 *      → senderMode = undefined/'auto' → TREASURY FIRST if configured & has USDT; else HOT (may defer)
 *
 * This removes the USDT float requirement from the hot wallet entirely.
 * Hot wallet = gas ONLY (TRX/BNB/MATIC).  Treasury wallet = settlement USDT source.
 */
export async function directRailWithdraw(
  rail: 'tronweb' | 'bscweb' | 'polygonweb',
  asset: string,
  address: string,
  amount: number,
  opts?: { senderMode?: 'hot' | 'treasury' | 'auto' }
): Promise<WithdrawAssetResult & {
  deferred?: boolean;
  status?: 'broadcast' | 'deferred';
  note?: string;
  raw?: any;
}> {
  const assetUpper = String(asset).toUpperCase();
  const senderMode = opts?.senderMode ?? 'auto';

  if (assetUpper !== 'USDT') {
    throw new Error(`Direct ${rail} rail only supports USDT. For ${assetUpper} use an exchange provider.`);
  }

  const useTreasury =
    senderMode === 'treasury' ? true :
    senderMode === 'hot'      ? false :
                                'auto' as const;

  if (rail === 'tronweb') {
    const tron = (tronSendUsdt as any);
    const result = await tron(address, amount, { useTreasury }) as {
      txId?: string; deferred?: boolean; status?: 'broadcast' | 'deferred'; note?: string;
      senderRole?: 'hot' | 'treasury'; from?: string; network: 'tron';
    };
    const isDeferred = !!result.deferred;
    const providerTag = result.senderRole === 'treasury' ? 'tronweb-treasury' : 'tronweb';
    return {
      ok: true,
      provider: providerTag,
      txId: result.txId,
      accepted: true,
      deferred: isDeferred,
      status: result.status,
      note: result.note,
      txUrl: result.txId ? `https://tronscan.org/#/transaction/${result.txId}` : undefined,
      raw: result,
    };
  }
  if (rail === 'bscweb') {
    await loadBsc();
    if (!bscSendFn || !bscIsConfiguredFn || !bscIsConfiguredFn()) {
      throw new Error('BSC BEP-20 rail is not configured. Set BSC_PRIVATE_KEY in .env.');
    }
    const result = await (bscSendFn as any)(address, amount, { useTreasury });
    const isDeferred = !!result.deferred;
    const providerTag = result.senderRole === 'treasury' ? 'bscweb-treasury' : 'bscweb';
    return {
      ok: true,
      provider: providerTag,
      txId: result.txId,
      accepted: true,
      deferred: isDeferred,
      status: result.status,
      note: result.note,
      txUrl: result.txId ? `https://bscscan.com/tx/${result.txId}` : undefined,
      raw: result,
    };
  }
  if (rail === 'polygonweb') {
    await loadPolygon();
    if (!polygonSendFn || !polygonIsConfiguredFn || !polygonIsConfiguredFn()) {
      throw new Error('Polygon rail is not configured. Set POLYGON_PRIVATE_KEY in .env.');
    }
    const result = await (polygonSendFn as any)(address, amount, { useTreasury });
    const isDeferred = !!result.deferred;
    const providerTag = result.senderRole === 'treasury' ? 'polygonweb-treasury' : 'polygonweb';
    return {
      ok: true,
      provider: providerTag,
      txId: result.txId,
      accepted: true,
      deferred: isDeferred,
      status: result.status,
      note: result.note,
      txUrl: result.txId ? `https://polygonscan.com/tx/${result.txId}` : undefined,
      raw: result,
    };
  }
  throw new Error(`Unknown direct rail: ${rail}`);
}

export async function exchangeWithdrawBestEffort(
  asset: string,
  address: string,
  network: string,
  amount: number,
  opts?: WithdrawOptions
): Promise<{ result: WithdrawAssetResult; providerUsed: ExchangeProviderId | 'binance_broker' | 'manual'; lastError?: string }> {
  const priority = getProviderPriority().filter(p => ['kucoin', 'binance'].includes(p));
  const errors: string[] = [];
  for (const pid of priority) {
    try {
      if (pid === 'binance') {
        try {
          const resp = await binanceWithdraw(asset, address, opts?.networkOverride || network, amount, opts || {});
          return {
            result: {
              ok: true,
              provider: 'binance',
              id: resp?.id,
              trId: resp?.trId,
              withdrawId: resp?.withdrawId,
              accepted: resp?.accepted !== false,
              info: resp?.info,
              raw: resp,
            },
            providerUsed: 'binance',
          };
        } catch (e: any) { errors.push(`binance:${e?.message || String(e)}`); }
      } else if (pid === 'kucoin') {
        await loadKuCoin();
        if (kucoinWithdrawFn && kucoinIsConfiguredFn && kucoinIsConfiguredFn()) {
          try {
            const resp = await kucoinWithdrawFn(asset, address, opts?.networkOverride || network, amount, opts || {});
            return { result: resp, providerUsed: resp.provider };
          } catch (e: any) { errors.push(`kucoin:${e?.message || String(e)}`); }
        }
      }
    } catch { /* continue */ }
  }
  const lastError = errors.length > 0 ? errors.join(' | ') : 'No exchange provider configured for withdrawal.';
  return {
    result: {
      ok: false,
      provider: 'manual',
      accepted: false,
      info: lastError,
      raw: { errors },
    },
    providerUsed: 'manual',
    lastError,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-PAYS-ORIGIN RAIL (0 USDT on any operator wallet — EVER)
//
//  • On-chain USDT sender = CUSTOMER'S EXTERNAL WALLET (their own T-address).
//  • Customer signs offline. We never see their private key.
//  • We ONLY relay their pre-signed transaction.
//  • Operator holds $0 USDT at any step. Hot wallet involvement = 0 USDT.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an unsigned TRC-20 USDT transfer for the CUSTOMER'S OWN wallet to sign.
 * SENDER = theirOriginAddress (their external TronLink/Klever address).
 * RECIPIENT = destExternalAddress (where they want it to go, can be same as origin).
 *
 * Operator USDT exposure = ZERO. Hot wallet USDT = ZERO. Gas sponsorship optional.
 */
export async function prepareCustomerOriginTrc20Transfer(
  customerOriginAddress: string,
  destExternalAddress: string,
  amountUsdt: number
) {
  return tronPrepareCustomerOrigin(customerOriginAddress, destExternalAddress, amountUsdt);
}

/**
 * Broadcast a pre-signed customer-origin transfer (signed on customer's device with their key).
 * Operator never holds USDT. Success means tx is on mempool / chain.
 */
export async function relayCustomerSignedTransfer(signedTx: any) {
  return tronSubmitSignedTransfer(signedTx);
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTION B: ATOMIC NETTING — 0 USDT on operator, 1 on-chain tx.
//
// Problem: Customer A wants to WITHDRAW N USDT to external.
//          We have $0 USDT on hot or treasury.
// Workaround: If Customer B is DEPOSITING >= N USDT from external in the same
//             epoch (24h window), settle A↔B P2P:
//               • B sends N USDT from B_ext → A_ext directly on-chain.
//               • Internal SQL:  debit A.internal   by N USDT
//               • Internal SQL:  credit B.internal  by N USDT
//             Net result:
//               • A got their external payout (real USDT sent from B_ext).
//               • B got their internal credit (they were going to deposit anyway).
//               • Operator touched $0 USDT.  1 tx.  1 gas fee.
//
// This function only matches pending entries. Actual broadcast uses the
// customer-origin relay (B signs a pre-signed transfer → A_ext, operator relays).
// ─────────────────────────────────────────────────────────────────────────────
export interface NettingMatchInput {
  withdraw_customer_id: string;
  withdraw_dest_address: string;       // T-address of A's external payout destination
  withdraw_amount_usdt: number;
  deposit_candidate: {
    deposit_customer_id: string;
    deposit_origin_address: string;    // T-address of B — B will sign the origin transfer
    deposit_amount_usdt: number;       // should be >= withdraw_amount (excess goes to B internal)
  };
}

export interface NettingMatchResult {
  ok: boolean;
  match: boolean;
  net_withdraw_amount_usdt: number;
  deposit_remainder_usdt: number;
  unsignedTxForDepositCustomerToSign: any | null;
  customerOriginParams: {
    customerOriginAddress: string;   // B's wallet (the depositor)
    destExternalAddress: string;     // A's wallet (the withdrawer dest)
    amountUsdt: number;              // min(Withdraw, Deposit)
  } | null;
  note: string;
}

/**
 * Match a withdraw against an in-flight deposit → produce an unsigned customer-origin
 * transfer for the DEPOSITOR (B) to sign & send to the WITHDRAWER (A).
 *
 * Netting guarantees:
 *   • operator $0 USDT exposure forever
 *   • 1 on-chain tx (B_ext → A_ext)
 *   • 2 internal ledger offsets (not executed here; caller debits/credits)
 */
export function proposeAtomicNettingPair(input: NettingMatchInput): NettingMatchResult {
  const wAmt = Number(input.withdraw_amount_usdt || 0);
  const dAmt = Number(input.deposit_candidate.deposit_amount_usdt || 0);
  if (wAmt <= 0 || dAmt <= 0) return { ok: false, match: false, net_withdraw_amount_usdt: 0, deposit_remainder_usdt: dAmt, unsignedTxForDepositCustomerToSign: null, customerOriginParams: null, note: 'Invalid amounts.' };
  const net = Math.min(wAmt, dAmt);
  const remainder = dAmt - net;
  return {
    ok: true,
    match: true,
    net_withdraw_amount_usdt: net,
    deposit_remainder_usdt: remainder,
    customerOriginParams: {
      customerOriginAddress: input.deposit_candidate.deposit_origin_address,
      destExternalAddress: input.withdraw_dest_address,
      amountUsdt: net,
    },
    unsignedTxForDepositCustomerToSign: null,  // populated async by caller via prepareCustomerOriginTrc20Transfer()
    note:
      `Atomic netting match: depositor ${input.deposit_candidate.deposit_customer_id} (${input.deposit_candidate.deposit_origin_address}) sends ${net} USDT on-chain directly to withdrawer ${input.withdraw_customer_id} (${input.withdraw_dest_address}). ` +
      `Net internal movements: debit withdrawer ${net} USDT, credit depositor ${net} USDT${remainder > 0 ? `, depositor remainder ${remainder} USDT credited manually.` : '.'} ` +
      `Operator USDT exposure at any step = 0.`,
  };
}

export const exchangeRouter = {
  getProviderPriority,
  getBestPrice,
  buyAssetBestEffort,
  sellAssetBestEffort,
  directRailWithdraw,
  exchangeWithdrawBestEffort,
  detectDirectRailForDestination,
  isTronNetwork,
  isBscNetwork,
  isPolygonNetwork,
  isTronAddress,
  isEvmAddress,
};

export default exchangeRouter;
