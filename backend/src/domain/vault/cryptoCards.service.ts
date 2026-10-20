/**
 * Crypto Cards Service — two real receiving cards
 * ─────────────────────────────────────────────────────────────────────────────
 *   usdt-trc20 — USDT on TRON              (TRC-20)
 *   btc        — Bitcoin (native SegWit)   (BIP-84 bc1q…)
 *
 * Every number returned here is read from the public chain (TronGrid for TRON,
 * mempool.space for Bitcoin). Every send is signed locally and broadcast to the
 * chain. Nothing on this path is simulated, cached-from-a-fixture or faked.
 *
 * Config (.env):
 *   VAULT_USDT_TRON_ADDRESS / VAULT_USDT_TRON_CONTRACT / TRON_API_KEY / TRON_FULL_NODE
 *   VAULT_BTC_ADDRESS / VAULT_BTC_WIF / VAULT_BTC_ESPLORA
 */

import axios from 'axios';

const TRON_FULL_NODE   = (process.env.TRON_FULL_NODE || 'https://api.trongrid.io').replace(/\/+$/, '');
const TRON_API_KEY     = (process.env.TRON_API_KEY || '').trim();
const TRON_CONTRACT    = (process.env.VAULT_USDT_TRON_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').trim();
const TRON_ADDRESS     = (process.env.VAULT_USDT_TRON_ADDRESS || process.env.TRON_WALLET_ADDRESS || '').trim();

const BTC_ADDRESS      = (process.env.VAULT_BTC_ADDRESS || '').trim();
const BTC_WIF          = (process.env.VAULT_BTC_WIF || '').trim();
const BTC_DERIV_PATH   = (process.env.VAULT_BTC_DERIVATION_PATH || "m/84'/0'/0'/0/0").trim();
const BTC_ESPLORA      = (process.env.VAULT_BTC_ESPLORA || 'https://mempool.space/api').replace(/\/+$/, '');

const TRON_USDT_DECIMALS = 6;
const BTC_SATS_PER_BTC   = 100_000_000;

const tronHeaders = TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {};

// ── Card catalog ─────────────────────────────────────────────────────────────

export type CryptoSymbol = 'USDT' | 'BTC';
export type CryptoNetwork = 'tron' | 'bitcoin';

export interface CryptoCardDef {
  id: string;
  symbol: CryptoSymbol;
  name: string;
  network: CryptoNetwork;
  networkLabel: string;
  address: string;
  contract?: string;
  decimals: number;
  /** Native coin on the same chain, used for network fees. */
  gasSymbol: string;
  explorerTx: (txid: string) => string;
  explorerAddress: (addr: string) => string;
  configured: boolean;
  unavailableReason?: string;
}

export const CRYPTO_CARDS: CryptoCardDef[] = [
  {
    id: 'usdt-trc20',
    symbol: 'USDT',
    name: 'USDT — TRON',
    network: 'tron',
    networkLabel: 'TRON (TRC-20)',
    address: TRON_ADDRESS,
    contract: TRON_CONTRACT,
    decimals: TRON_USDT_DECIMALS,
    gasSymbol: 'TRX',
    explorerTx: (txid) => `https://tronscan.org/#/transaction/${txid}`,
    explorerAddress: (addr) => `https://tronscan.org/#/address/${addr}`,
    configured: Boolean(TRON_ADDRESS),
    unavailableReason: TRON_ADDRESS ? undefined : 'Set VAULT_USDT_TRON_ADDRESS on this server.',
  },
  {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    network: 'bitcoin',
    networkLabel: 'Bitcoin',
    address: BTC_ADDRESS,
    decimals: 8,
    gasSymbol: 'BTC',
    explorerTx: (txid) => `https://mempool.space/tx/${txid}`,
    explorerAddress: (addr) => `https://mempool.space/address/${addr}`,
    configured: Boolean(BTC_ADDRESS),
    unavailableReason: BTC_ADDRESS ? undefined : 'Set VAULT_BTC_ADDRESS on this server.',
  },
];

export function findCryptoCard(id: string): CryptoCardDef | undefined {
  const key = String(id || '').toLowerCase();
  const alias: Record<string, string> = {
    usdt: 'usdt-trc20', usdt_tron: 'usdt-trc20', tron: 'usdt-trc20', trc20: 'usdt-trc20',
    bitcoin: 'btc', btc_mainnet: 'btc', 'btc-bitcoin': 'btc',
  };
  const target = alias[key] || key;
  return CRYPTO_CARDS.find((c) => c.id === target);
}

// ── Live fiat / FX rates ─────────────────────────────────────────────────────

interface RateCache { at: number; usd: Record<string, number>; fx: Record<string, number>; }
let rateCache: RateCache | null = null;
const RATE_TTL_MS = 60_000;

/** USD price for each tracked symbol + USD→fiat FX table. Cached for 60s. */
export async function getRates(): Promise<{ usd: Record<string, number>; fx: Record<string, number> }> {
  if (rateCache && Date.now() - rateCache.at < RATE_TTL_MS) {
    return { usd: rateCache.usd, fx: rateCache.fx };
  }

  const usd: Record<string, number> = { USDT: 1, BTC: 0 };
  const fx: Record<string, number> = { USD: 1 };

  // BTC/USD — Binance public ticker first, CoinGecko as fallback.
  try {
    const r = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol: 'BTCUSDT' }, timeout: 8000,
    });
    const p = Number(r.data?.price);
    if (Number.isFinite(p) && p > 0) usd.BTC = p;
  } catch { /* fall through */ }

  if (!usd.BTC) {
    try {
      const r = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'bitcoin,tether', vs_currencies: 'usd' }, timeout: 8000,
      });
      if (Number(r.data?.bitcoin?.usd) > 0) usd.BTC = Number(r.data.bitcoin.usd);
      if (Number(r.data?.tether?.usd) > 0) usd.USDT = Number(r.data.tether.usd);
    } catch { /* fall through */ }
  }

  // USD → fiat FX table.
  try {
    const r = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    const rates = r.data?.rates || {};
    for (const c of ['USD', 'EUR', 'GBP', 'AED', 'INR', 'SAR', 'CAD', 'AUD', 'CHF', 'JPY']) {
      const v = Number(rates[c]);
      if (Number.isFinite(v) && v > 0) fx[c] = v;
    }
  } catch { /* keep USD only */ }

  rateCache = { at: Date.now(), usd, fx };
  return { usd, fx };
}

// ── Live balances ────────────────────────────────────────────────────────────

export interface CardBalance {
  crypto: number;
  symbol: CryptoSymbol;
  decimals: number;
  /** Native gas balance (TRX for the TRON card, BTC for the Bitcoin card). */
  gas: number;
  gasSymbol: string;
  address: string;
  blockHeight?: number;
  checkedAt: string;
}

/** TRON: USDT TRC-20 balance via a constant contract call, plus the TRX gas balance. */
async function tronBalance(def: CryptoCardDef): Promise<CardBalance> {
  const param = tronAddressToHexParam(def.address);

  const [usdtRes, acctRes] = await Promise.all([
    axios.post(
      `${TRON_FULL_NODE}/wallet/triggerconstantcontract`,
      {
        owner_address: def.address,
        contract_address: def.contract,
        function_selector: 'balanceOf(address)',
        parameter: param,
        visible: true,
      },
      { headers: tronHeaders, timeout: 12_000 },
    ),
    axios.get(`${TRON_FULL_NODE}/v1/accounts/${def.address}`, {
      headers: tronHeaders, timeout: 12_000,
    }).catch(() => ({ data: { data: [] } })),
  ]);

  const raw = usdtRes.data?.constant_result?.[0];
  if (!raw) {
    throw new Error(usdtRes.data?.result?.message
      ? Buffer.from(usdtRes.data.result.message, 'hex').toString()
      : 'TronGrid did not return a USDT balance');
  }
  const crypto = Number(BigInt('0x' + raw)) / 10 ** TRON_USDT_DECIMALS;

  const acct = acctRes.data?.data?.[0] || {};
  const gas = Number(acct.balance || 0) / 1_000_000;

  return {
    crypto, symbol: 'USDT', decimals: TRON_USDT_DECIMALS,
    gas, gasSymbol: 'TRX', address: def.address,
    checkedAt: new Date().toISOString(),
  };
}

/** Bitcoin: confirmed + mempool balance in sats → BTC. */
async function btcBalance(def: CryptoCardDef): Promise<CardBalance> {
  const [addrRes, tipRes] = await Promise.all([
    axios.get(`${BTC_ESPLORA}/address/${def.address}`, { timeout: 12_000 }),
    axios.get(`${BTC_ESPLORA}/blocks/tip/height`, { timeout: 12_000 }).catch(() => ({ data: 0 })),
  ]);

  const chain = addrRes.data?.chain_stats || {};
  const mem = addrRes.data?.mempool_stats || {};
  const sats =
    Number(chain.funded_txo_sum || 0) - Number(chain.spent_txo_sum || 0) +
    Number(mem.funded_txo_sum || 0) - Number(mem.spent_txo_sum || 0);

  const crypto = sats / BTC_SATS_PER_BTC;
  return {
    crypto, symbol: 'BTC', decimals: 8,
    gas: crypto, gasSymbol: 'BTC', address: def.address,
    blockHeight: Number(tipRes.data) || undefined,
    checkedAt: new Date().toISOString(),
  };
}

export async function getCardBalance(def: CryptoCardDef): Promise<CardBalance> {
  if (!def.configured) throw new Error(def.unavailableReason || 'Card is not configured');
  return def.network === 'tron' ? tronBalance(def) : btcBalance(def);
}

// ── Live transactions (the Receive column) ───────────────────────────────────

export interface CryptoTransaction {
  txid: string;
  direction: 'in' | 'out';
  amount: number;
  symbol: CryptoSymbol;
  confirmations: number;
  timestamp: number;
  counterparty: string;
  status: 'confirmed' | 'pending' | 'failed';
  explorerUrl: string;
}

async function tronTransactions(def: CryptoCardDef, limit: number): Promise<CryptoTransaction[]> {
  const res = await axios.get(`${TRON_FULL_NODE}/v1/accounts/${def.address}/transactions/trc20`, {
    headers: tronHeaders,
    params: { limit, contract_address: def.contract },
    timeout: 12_000,
  });

  const rows: any[] = res.data?.data || [];
  return rows.map((t) => {
    const incoming = String(t.to) === def.address;
    const decimals = Number(t.token_info?.decimals ?? TRON_USDT_DECIMALS);
    return {
      txid: String(t.transaction_id),
      direction: incoming ? 'in' : 'out' as 'in' | 'out',
      amount: Number(t.value) / 10 ** decimals,
      symbol: (t.token_info?.symbol || 'USDT').toUpperCase() as CryptoSymbol,
      confirmations: t.block_timestamp ? 1 : 0,
      timestamp: Number(t.block_timestamp || 0),
      counterparty: incoming ? String(t.from) : String(t.to),
      status: 'confirmed' as const,
      explorerUrl: def.explorerTx(String(t.transaction_id)),
    };
  });
}

async function btcTransactions(def: CryptoCardDef, limit: number): Promise<CryptoTransaction[]> {
  const [txRes, tipRes] = await Promise.all([
    axios.get(`${BTC_ESPLORA}/address/${def.address}/txs`, { timeout: 12_000 }),
    axios.get(`${BTC_ESPLORA}/blocks/tip/height`, { timeout: 12_000 }).catch(() => ({ data: 0 })),
  ]);

  const tip = Number(tipRes.data) || 0;
  const txs: any[] = (txRes.data || []).slice(0, limit);

  return txs.map((tx) => {
    let received = 0;
    let sent = 0;
    let counterparty = '';
    for (const vout of tx.vout || []) {
      if (vout.scriptpubkey_address === def.address) received += Number(vout.value || 0);
      else if (!counterparty && vout.scriptpubkey_address) counterparty = vout.scriptpubkey_address;
    }
    for (const vin of tx.vin || []) {
      const prev = vin.prevout || {};
      if (prev.scriptpubkey_address === def.address) sent += Number(prev.value || 0);
      if (prev.scriptpubkey_address && prev.scriptpubkey_address !== def.address) {
        counterparty = prev.scriptpubkey_address;
      }
    }
    const net = received - sent;
    const confirmed = Boolean(tx.status?.confirmed);
    const confs = confirmed ? Math.max(0, tip - Number(tx.status.block_height || tip) + 1) : 0;

    return {
      txid: String(tx.txid),
      direction: (net >= 0 ? 'in' : 'out') as 'in' | 'out',
      amount: Math.abs(net) / BTC_SATS_PER_BTC,
      symbol: 'BTC' as CryptoSymbol,
      confirmations: confs,
      timestamp: Number(tx.status?.block_time ? tx.status.block_time * 1000 : Date.now()),
      counterparty,
      status: (confirmed ? 'confirmed' : 'pending') as 'confirmed' | 'pending',
      explorerUrl: def.explorerTx(String(tx.txid)),
    };
  });
}

export async function getCardTransactions(def: CryptoCardDef, limit = 25): Promise<CryptoTransaction[]> {
  if (!def.configured) throw new Error(def.unavailableReason || 'Card is not configured');
  return def.network === 'tron' ? tronTransactions(def, limit) : btcTransactions(def, limit);
}

// ── Address helpers ──────────────────────────────────────────────────────────

/** base58 Tron address → 32-byte left-padded hex parameter for a contract call. */
function tronAddressToHexParam(base58: string): string {
  const mod = require('bs58');
  const bs58 = mod?.default ?? mod;
  const decoded = Buffer.from(bs58.decode(base58));
  return decoded.slice(1, 21).toString('hex').padStart(64, '0');
}

export function isValidTronAddress(addr: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(addr || ''));
}

export function isValidBtcAddress(addr: string): boolean {
  const a = String(addr || '');
  if (/^(bc1)[02-9ac-hj-np-z]{11,71}$/i.test(a)) return true;      // bech32 / bech32m
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return true;    // P2PKH / P2SH
  return false;
}

// ── Send (real on-chain broadcast) ───────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  txid?: string;
  explorerUrl?: string;
  amount: number;
  symbol: CryptoSymbol;
  to: string;
  fee?: number;
  feeSymbol?: string;
  balanceAfter?: number;
  error?: string;
}

/** USDT TRC-20 — signed with TronWeb and broadcast to the TRON network. */
async function sendTron(def: CryptoCardDef, to: string, amount: number): Promise<SendResult> {
  const privateKey = (process.env.VAULT_USDT_TRON_PRIVATE_KEY || process.env.TRON_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    return { ok: false, amount, symbol: 'USDT', to, error: 'VAULT_USDT_TRON_PRIVATE_KEY is not set — cannot sign.' };
  }
  if (!isValidTronAddress(to)) {
    return { ok: false, amount, symbol: 'USDT', to, error: 'Recipient is not a valid TRON address (T…, 34 chars).' };
  }

  const balance = await tronBalance(def);
  if (balance.crypto < amount) {
    return {
      ok: false, amount, symbol: 'USDT', to,
      error: `Insufficient USDT. Card holds ${balance.crypto} USDT, tried to send ${amount}.`,
    };
  }
  if (balance.gas <= 0) {
    return { ok: false, amount, symbol: 'USDT', to, error: 'The TRON wallet has no TRX to pay the network fee.' };
  }

  const TronWeb = require('tronweb');
  const tronWeb = new TronWeb({
    fullHost: TRON_FULL_NODE,
    headers: tronHeaders,
    privateKey,
  });

  const units = Math.floor(amount * 10 ** TRON_USDT_DECIMALS);
  const contract = await tronWeb.contract().at(def.contract as string);
  const txid: string = await contract
    .transfer(to, units)
    .send({ feeLimit: 100_000_000, callValue: 0, shouldPollResponse: true });

  const after = await tronBalance(def);
  return {
    ok: true, txid, explorerUrl: def.explorerTx(txid),
    amount, symbol: 'USDT', to,
    fee: 0, feeSymbol: 'TRX', balanceAfter: after.crypto,
  };
}

/** Bitcoin — builds a real P2WPKH transaction, signs it locally and broadcasts it. */
async function sendBitcoin(def: CryptoCardDef, to: string, amount: number): Promise<SendResult> {
  if (!BTC_WIF) {
    return { ok: false, amount, symbol: 'BTC', to, error: 'VAULT_BTC_WIF is not set — cannot sign.' };
  }
  if (!isValidBtcAddress(to)) {
    return { ok: false, amount, symbol: 'BTC', to, error: 'Recipient is not a valid Bitcoin address.' };
  }

  const bitcoin = require('bitcoinjs-lib');
  const ecpairMod = require('ecpair');
  const ECPairFactory = ecpairMod.ECPairFactory || ecpairMod.default || ecpairMod;
  const ECPair = ECPairFactory(require('tiny-secp256k1'));
  const network = bitcoin.networks.bitcoin;

  const keyPair = ECPair.fromWIF(BTC_WIF, network);
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network });

  const [utxoRes, feeRes] = await Promise.all([
    axios.get(`${BTC_ESPLORA}/address/${def.address}/utxo`, { timeout: 12_000 }),
    axios.get(`${BTC_ESPLORA}/fee-estimates`, { timeout: 12_000 }).catch(() => ({ data: {} })),
  ]);

  const utxos: any[] = (utxoRes.data || []).filter((u: any) => u.status?.confirmed);
  if (utxos.length === 0) {
    return { ok: false, amount, symbol: 'BTC', to, error: 'No confirmed Bitcoin UTXOs on this card — nothing to spend.' };
  }

  const totalSats = utxos.reduce((s, u) => s + Number(u.value || 0), 0);
  const sendSats = Math.round(amount * BTC_SATS_PER_BTC);

  const fees = feeRes.data || {};
  const feeRate = Math.max(1, Math.ceil(Number(fees['3'] || fees['2'] || fees['1'] || 5)));
  const dustLimit = 294;

  const buildFor = (nIn: number, nOut: number) => {
    const vBytes = 11 + nIn * 68 + nOut * 31;
    return Math.ceil(vBytes * feeRate);
  };

  let selected: any[] = [];
  let feeSats = 0;
  let changeSats = 0;
  for (const u of utxos) {
    selected.push(u);
    const inSum = selected.reduce((s, x) => s + Number(x.value || 0), 0);
    // Try 2 outputs (recipient + change), fall back to 1 output (sweep).
    const fee2 = buildFor(selected.length, 2);
    if (inSum - sendSats - fee2 > dustLimit) {
      feeSats = fee2;
      changeSats = inSum - sendSats - fee2;
      break;
    }
    const fee1 = buildFor(selected.length, 1);
    if (inSum - sendSats - fee1 >= 0 && inSum - sendSats - fee1 <= dustLimit) {
      feeSats = inSum - sendSats;
      changeSats = 0;
      break;
    }
  }

  if (sendSats > totalSats || feeSats === 0) {
    return {
      ok: false, amount, symbol: 'BTC', to,
      error: `Insufficient BTC. Card holds ${totalSats / BTC_SATS_PER_BTC} BTC; sending ${amount} BTC needs about ${(sendSats + buildFor(utxos.length, 2)) / BTC_SATS_PER_BTC} BTC with fees.`,
    };
  }

  const psbt = new bitcoin.Psbt({ network });
  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: p2wpkh.output as Buffer, value: Number(u.value) },
    });
  }
  psbt.addOutput({ address: to, value: sendSats });
  if (changeSats > dustLimit) psbt.addOutput({ address: def.address, value: changeSats });

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();

  const broadcast = await axios.post(`${BTC_ESPLORA}/tx`, txHex, {
    headers: { 'Content-Type': 'text/plain' }, timeout: 20_000,
  });
  const txid = String(broadcast.data || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    return { ok: false, amount, symbol: 'BTC', to, error: `Broadcast was rejected: ${txid || 'empty response'}` };
  }

  return {
    ok: true, txid, explorerUrl: def.explorerTx(txid),
    amount, symbol: 'BTC', to,
    fee: feeSats / BTC_SATS_PER_BTC, feeSymbol: 'BTC',
    balanceAfter: (totalSats - sendSats - feeSats) / BTC_SATS_PER_BTC,
  };
}

export async function sendCrypto(def: CryptoCardDef, to: string, amount: number): Promise<SendResult> {
  if (!def.configured) return { ok: false, amount, symbol: def.symbol, to, error: def.unavailableReason || 'Card is not configured' };
  if (!(amount > 0)) return { ok: false, amount, symbol: def.symbol, to, error: 'Amount must be greater than zero.' };
  try {
    return def.network === 'tron' ? await sendTron(def, to, amount) : await sendBitcoin(def, to, amount);
  } catch (err: any) {
    const detail = err?.response?.data?.Error || err?.response?.data?.message || err?.message || 'Send failed';
    return { ok: false, amount, symbol: def.symbol, to, error: String(detail) };
  }
}

// ── Receive verification (crediting a card from an incoming txid) ────────────

export interface IncomingCheck {
  ok: boolean;
  txid: string;
  amount: number;
  symbol: CryptoSymbol;
  from: string;
  to: string;
  timestamp: number;
  error?: string;
}

/** Look up an incoming transfer on-chain and confirm the amount and recipient. */
export async function verifyIncoming(def: CryptoCardDef, txid: string, expected: number): Promise<IncomingCheck> {
  const base: IncomingCheck = { ok: false, txid, amount: 0, symbol: def.symbol, from: '', to: def.address, timestamp: 0 };
  const tolerance = def.symbol === 'USDT' ? 0.05 : 0.00000001;

  try {
    if (def.network === 'tron') {
      const res = await axios.get(`${TRON_FULL_NODE}/v1/transactions/${txid}`, {
        headers: tronHeaders, timeout: 12_000,
      });
      const tx = res.data?.data?.[0];
      if (!tx) return { ...base, error: 'Transaction not found on TRON.' };
      if ((tx.contractRet || '').toUpperCase() !== 'SUCCESS') {
        return { ...base, error: `Transaction did not succeed (contractRet=${tx.contractRet}).` };
      }
      const contract = (tx.raw_data?.contract || [])[0];
      const value = contract?.parameter?.value || {};
      if (value.contract_address !== def.contract) {
        return { ...base, error: 'That transaction is not a USDT TRC-20 transfer.' };
      }
      const toAddr = value.to_address || '';
      if (toAddr && toAddr !== def.address) {
        return { ...base, error: 'That transfer was not sent to this card’s TRON address.' };
      }
      const amount = Number(value.amount || 0) / 10 ** TRON_USDT_DECIMALS;
      if (Math.abs(amount - expected) > tolerance) {
        return { ...base, amount, error: `On-chain amount ${amount} USDT does not match ${expected} USDT.` };
      }
      return {
        ok: true, txid, amount, symbol: 'USDT',
        from: value.owner_address || '', to: def.address,
        timestamp: Number(tx.block_timestamp || 0),
      };
    }

    // Bitcoin
    const res = await axios.get(`${BTC_ESPLORA}/tx/${txid}`, { timeout: 12_000 });
    const tx = res.data;
    const received = (tx?.vout || []).filter((v: any) => v.scriptpubkey_address === def.address);
    if (received.length === 0) {
      return { ...base, error: 'That transaction has no output paying this card’s Bitcoin address.' };
    }
    const amountSats = received.reduce((s: number, v: any) => s + Number(v.value || 0), 0);
    const amount = amountSats / BTC_SATS_PER_BTC;
    if (Math.abs(amount - expected) > tolerance) {
      return { ...base, amount, error: `On-chain amount ${amount} BTC does not match ${expected} BTC.` };
    }
    return {
      ok: true, txid, amount, symbol: 'BTC',
      from: (tx?.vin?.[0]?.prevout?.scriptpubkey_address) || '', to: def.address,
      timestamp: Number(tx?.status?.block_time ? tx.status.block_time * 1000 : 0),
    };
  } catch (err: any) {
    const status = err?.response?.status;
    return { ...base, error: status === 404 ? 'Transaction not found on-chain.' : (err?.message || 'Lookup failed') };
  }
}
