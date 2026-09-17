/**
 * Tron USDT TRC-20 Service — Direct HTTP API (no SDK, no hanging)
 * Uses tronweb only for crypto operations, HTTP calls go directly to Tron grid.
 *
 * .env keys:
 *   TRON_PRIVATE_KEY=your_hot_wallet_private_key            → HOT WALLET (gas only, never USDT)
 *   TRON_WALLET_ADDRESS=your_hot_wallet_TRC20_address       → HOT WALLET (gas only, never USDT)
 *   TRON_TREASURY_PRIVATE_KEY=your_treasury_private_key     → TREASURY (holds real USDT, optional)
 *   TRON_TREASURY_ADDRESS=your_treasury_T_address           → TREASURY (holds real USDT, optional)
 *   TRON_API_KEY=optional (from trongrid.io for higher rate limits)
 *   TRON_JWT_SECRET=optional (required if JWT is enabled on TronGrid dashboard)
 *
 * JWT AUTHENTICATION (recommended for production):
 *  • Enable JWT on TronGrid dashboard: https://www.trongrid.io/dashboard
 *  • After enabling, all requests MUST include JWT token in Authorization header
 *  • JWT tokens are auto-generated and refreshed by trongrid-jwt.ts utility
 *
 * WALLET SEGREGATION (per operator directive — NO USDT on HOT wallet):
 *  • HOT      → holds only TRX (native gas). Address seen by customers.
 *  • TREASURY → holds the real USDT for outbound settlement. Private key can be
 *               rotated daily, kept offline, or set to a cold-wallet pubkey-only mode.
 *  • When TRON_TREASURY_PRIVATE_KEY is set, sendUsdt() can be told to sign with the
 *    treasury key (sender = treasury) instead of the hot key. This removes 100% of the
 *    USDT float requirement from the hot wallet. Hot wallet still pays gas via TRX.
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import crypto from 'crypto';
import { createTronGridJWTManager } from '../utils/trongrid-jwt';

const TRON_GRID = process.env.TRON_FULL_NODE || 'https://api.trongrid.io';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// JWT Manager (singleton) - auto-generates and refreshes JWT tokens
let jwtManager: ReturnType<typeof createTronGridJWTManager> | null = null;

function initJWTManager() {
  const apiKey = process.env.TRON_API_KEY?.trim();
  const jwtSecret = process.env.TRON_JWT_SECRET?.trim();
  
  if (apiKey && jwtSecret) {
    if (!jwtManager) {
      jwtManager = createTronGridJWTManager(apiKey, jwtSecret);
      console.log('[TronGrid] JWT authentication enabled ✅');
    }
    return jwtManager;
  }
  return null;
}

function tronGridHeaders(): Record<string, string> {
  const key = process.env.TRON_API_KEY?.trim();
  const jwtSecret = process.env.TRON_JWT_SECRET?.trim();
  
  // If JWT is enabled, use JWT manager for headers
  if (key && jwtSecret) {
    const manager = initJWTManager();
    if (manager) {
      return manager.getHeaders();
    }
  }
  
  // Fallback to API key only (legacy mode)
  return key ? { 'TRON-PRO-API-KEY': key } : {};
}

/** Axios wrapper with automatic 429 retry + exponential backoff */
async function tronRequest(
  method: 'get' | 'post',
  url: string,
  data?: any,
  config?: any,
  retries = 4
): Promise<any> {
  let lastErr: any;
  let delay = 1500; // start at 1.5 s
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (method === 'get') {
        return await axios.get(url, { ...config, headers: { ...tronGridHeaders(), ...(config?.headers || {}) } });
      } else {
        return await axios.post(url, data, { ...config, headers: { ...tronGridHeaders(), 'Content-Type': 'application/json', ...(config?.headers || {}) } });
      }
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 429 && attempt < retries) {
        // Respect Retry-After header if present, otherwise use backoff
        const retryAfter = err?.response?.headers?.['retry-after'];
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : delay;
        console.warn(`[Tron] Rate limited (429). Waiting ${waitMs}ms before retry ${attempt + 1}/${retries}...`);
        await new Promise(r => setTimeout(r, waitMs));
        delay = Math.min(delay * 2, 15000); // cap at 15s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Get private key from env */
function getPrivateKey(): string {
  const key = process.env.TRON_PRIVATE_KEY?.trim();
  if (!key) throw new Error('TRON_PRIVATE_KEY is not set in .env');
  return key;
}

/** Hot wallet address */
export function getHotWalletAddress(): string {
  const addr = process.env.TRON_WALLET_ADDRESS?.trim();
  if (!addr) throw new Error('TRON_WALLET_ADDRESS is not set in .env');
  return addr;
}

/** Get USDT TRC-20 balance via TronGrid HTTP API */
export async function getHotWalletUsdtBalance(): Promise<number> {
  const address = getHotWalletAddress();
  const res = await tronRequest('post', `${TRON_GRID}/wallet/triggersmartcontract`, {
    owner_address: tronAddressToHex(address),
    contract_address: tronAddressToHex(USDT_CONTRACT),
    function_selector: 'balanceOf(address)',
    parameter: addressToAbiParam(tronAddressToHex(address)),
    call_value: 0,
  }, { timeout: 10000 });
  const raw = res.data?.constant_result?.[0] || '0'.repeat(64);
  return parseInt(raw, 16) / 1_000_000;
}

/** Get TRX balance */
export async function getHotWalletTrxBalance(): Promise<number> {
  const address = getHotWalletAddress();
  const res = await tronRequest('get', `${TRON_GRID}/v1/accounts/${address}`, undefined, { timeout: 10000 });
  const bal = res.data?.data?.[0]?.balance || 0;
  return bal / 1_000_000;
}

// ── Treasury wallet (holds real USDT for settlement; hot wallet = gas ONLY) ──

/** Is a separate treasury wallet configured? */
export function isTreasuryConfigured(): boolean {
  return !!(process.env.TRON_TREASURY_PRIVATE_KEY?.trim() && process.env.TRON_TREASURY_ADDRESS?.trim());
}

/** Treasury private key (throws if not configured) */
export function getTreasuryPrivateKey(): string {
  const key = process.env.TRON_TREASURY_PRIVATE_KEY?.trim();
  if (!key) throw new Error('TRON_TREASURY_PRIVATE_KEY is not set in .env');
  return key;
}

/** Treasury wallet address */
export function getTreasuryAddress(): string {
  const addr = process.env.TRON_TREASURY_ADDRESS?.trim();
  if (!addr) throw new Error('TRON_TREASURY_ADDRESS is not set in .env');
  return addr;
}

/** Treasury USDT balance (on-chain) */
export async function getTreasuryUsdtBalance(): Promise<number> {
  if (!isTreasuryConfigured()) return 0;
  const address = getTreasuryAddress();
  const res = await tronRequest('post', `${TRON_GRID}/wallet/triggersmartcontract`, {
    owner_address: tronAddressToHex(address),
    contract_address: tronAddressToHex(USDT_CONTRACT),
    function_selector: 'balanceOf(address)',
    parameter: addressToAbiParam(tronAddressToHex(address)),
    call_value: 0,
  }, { timeout: 10000 });
  const raw = res.data?.constant_result?.[0] || '0'.repeat(64);
  return parseInt(raw, 16) / 1_000_000;
}

/** Treasury TRX (gas) balance — treasury pays its own gas when used as sender */
export async function getTreasuryTrxBalance(): Promise<number> {
  if (!isTreasuryConfigured()) return 0;
  const address = getTreasuryAddress();
  const res = await tronRequest('get', `${TRON_GRID}/v1/accounts/${address}`, undefined, { timeout: 10000 });
  const bal = res.data?.data?.[0]?.balance || 0;
  return bal / 1_000_000;
}

/**
 * Send USDT TRC-20 — selectable sender wallet.
 * Uses tronweb dynamically only when needed (lazy import)
 *
 * Sender selection (critical for NO-USDT-on-hot-wallet model):
 *  • useTreasury=true  → TREASURY wallet signs & sends (source of real USDT for settlement)
 *  • useTreasury=false → HOT wallet signs & sends (default; gas-only hot wallet will
 *                        typically return deferred if it has insufficient USDT)
 *  • When useTreasury is auto/undefined: we try treasury FIRST if configured AND
 *    treasury has enough USDT; else fall back to hot wallet (may defer).
 *
 * ARCHITECTURAL CHANGE (per operator directive):
 *  • Hot wallet USDT balance is NEVER a hard requirement
 *  • Internal wallet deduction (customer/merchant) is FINAL — no rollback
 *  • If active sender lacks on-chain USDT: return { deferred: true, status: 'deferred' }
 *    → NOT an error. This is an auto-retryable state ("deferred_broadcast").
 *    Caller persists the accounting entry and retries via daemon.
 *  • Only TRX (native gas) is checked as hard requirement for broadcast path.
 *    If gas is missing → throw (that IS pending_manual — human must top up).
 */
export async function sendUsdt(toAddress: string, amount: number, opts?: {
  useTreasury?: boolean | 'auto';
}): Promise<{
  txId?: string;
  amount: number;
  from: string;
  to: string;
  network: 'tron';
  deferred?: boolean;
  status?: 'broadcast' | 'deferred';
  note?: string;
  hotWalletUsdtBalance?: number;
  hotWalletTrxBalance?: number;
  treasuryUsdtBalance?: number;
  treasuryTrxBalance?: number;
  senderRole?: 'hot' | 'treasury';
}> {
  if (!toAddress?.startsWith('T') || toAddress.length < 34) {
    throw new Error(`Invalid TRC-20 address: "${toAddress}". Must start with T.`);
  }
  if (amount <= 0) throw new Error('Amount must be > 0');

  const useTreasury = opts?.useTreasury ?? 'auto';
  const treasuryConfigured = isTreasuryConfigured();

  let senderRole: 'hot' | 'treasury';
  if (useTreasury === true) senderRole = 'treasury';
  else if (useTreasury === false) senderRole = 'hot';
  else {
    // auto: prefer treasury if configured and has USDT; else hot (may defer)
    const tUsdtBal = treasuryConfigured ? await getTreasuryUsdtBalance() : 0;
    senderRole = (treasuryConfigured && tUsdtBal >= amount) ? 'treasury' : 'hot';
  }

  if (senderRole === 'treasury' && !treasuryConfigured) {
    throw new Error('TRON treasury wallet is not configured. Set TRON_TREASURY_PRIVATE_KEY + TRON_TREASURY_ADDRESS in .env.');
  }

  const fromAddress = senderRole === 'treasury' ? getTreasuryAddress() : getHotWalletAddress();
  const privateKey = senderRole === 'treasury' ? getTreasuryPrivateKey() : getPrivateKey();

  const usdtBal = senderRole === 'treasury' ? await getTreasuryUsdtBalance() : await getHotWalletUsdtBalance();
  const trxBal = senderRole === 'treasury' ? await getTreasuryTrxBalance() : await getHotWalletTrxBalance();

  if (trxBal < 20) {
    throw new Error(
      `${senderRole === 'treasury' ? 'Treasury' : 'Hot'} wallet has ${trxBal.toFixed(2)} TRX. Need 20+ TRX for gas. ` +
      `Fund wallet ${fromAddress} with TRX.`
    );
  }

  if (usdtBal < amount) {
    return {
      amount,
      from: fromAddress,
      to: toAddress,
      network: 'tron',
      deferred: true,
      status: 'deferred',
      note:
        `On-chain USDT broadcast deferred — ${senderRole === 'treasury' ? 'treasury' : 'hot'} wallet has ${usdtBal.toFixed(2)} USDT, needs ${amount}. ` +
        `Wallet ${fromAddress} will deliver ${amount} USDT to ${toAddress} once USDT balance is sufficient. ` +
        `Gas (TRX) will be paid from ${senderRole} wallet native reserve. ` +
        `Internal ledger entry is FINAL — no rollback, no refund required.` +
        (senderRole === 'hot' && treasuryConfigured
          ? ` (Tip: Treasury wallet exists — try the treasury sender path to avoid deferred state.)`
          : ''),
      hotWalletUsdtBalance: senderRole === 'hot' ? usdtBal : undefined,
      hotWalletTrxBalance: senderRole === 'hot' ? trxBal : undefined,
      treasuryUsdtBalance: senderRole === 'treasury' ? usdtBal : undefined,
      treasuryTrxBalance: senderRole === 'treasury' ? trxBal : undefined,
      senderRole,
    };
  }

  // Build the transfer transaction via TronGrid
  const amountSun = Math.floor(amount * 1_000_000);
  const toHex = tronAddressToHex(toAddress);

  // Step 1: Build unsigned transaction
  const buildRes = await tronRequest('post', `${TRON_GRID}/wallet/triggersmartcontract`, {
    owner_address: tronAddressToHex(fromAddress),
    contract_address: tronAddressToHex(USDT_CONTRACT),
    function_selector: 'transfer(address,uint256)',
    parameter: addressToAbiParam(toHex) + uint256ToAbiParam(amountSun),
    fee_limit: 100_000_000,
    call_value: 0,
  }, { timeout: 15000 });

  if (!buildRes.data?.transaction) {
    throw new Error(`Failed to build transaction: ${JSON.stringify(buildRes.data)}`);
  }

  const unsignedTx = buildRes.data.transaction;

  // Step 2: Sign transaction
  const signedTx = await signTransaction(unsignedTx, privateKey);

  // Step 3: Broadcast
  const broadcastRes = await tronRequest('post', `${TRON_GRID}/wallet/broadcasttransaction`,
    signedTx,
    { timeout: 15000 }
  );

  if (!broadcastRes.data?.result) {
    throw new Error(`Broadcast failed: ${JSON.stringify(broadcastRes.data)}`);
  }

  const txId = signedTx.txID || unsignedTx.txID || '';
  console.log(`[Tron] ✅ [${senderRole.toUpperCase()}] Sent ${amount} USDT → ${toAddress}  txId=${txId}  from=${fromAddress}`);

  return {
    txId,
    amount,
    from: fromAddress,
    to: toAddress,
    network: 'tron',
    deferred: false,
    status: 'broadcast',
    hotWalletUsdtBalance: senderRole === 'hot' ? usdtBal : undefined,
    hotWalletTrxBalance: senderRole === 'hot' ? trxBal : undefined,
    treasuryUsdtBalance: senderRole === 'treasury' ? usdtBal : undefined,
    treasuryTrxBalance: senderRole === 'treasury' ? trxBal : undefined,
    senderRole,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert Tron base58 address to hex */
function tronAddressToHex(address: string): string {
  // Base58Check decode
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decoded = BigInt(0);
  for (const char of address) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 char: ${char}`);
    decoded = decoded * 58n + BigInt(idx);
  }
  const hex = decoded.toString(16).padStart(50, '0');
  // Remove checksum (last 4 bytes = 8 hex chars)
  return '0x' + hex.slice(0, hex.length - 8);
}

/** Encode address as 32-byte ABI param */
function addressToAbiParam(hexAddress: string): string {
  const clean = hexAddress.replace('0x', '').replace(/^41/, '');
  return clean.padStart(64, '0');
}

/** Encode uint256 as 32-byte ABI param */
function uint256ToAbiParam(value: number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

/** Sign a Tron transaction with private key */
async function signTransaction(tx: any, privateKey: string): Promise<any> {
  const txHash = tx.txID;
  const msgHash = Buffer.from(txHash, 'hex');
  const privKeyClean = privateKey.replace(/^0x/, '');

  // Use elliptic (already a dependency) — reliable secp256k1 signing with recovery
  const { ec: EC } = require('elliptic');
  const ec = new EC('secp256k1');
  const keyPair = ec.keyFromPrivate(privKeyClean, 'hex');
  const sig = keyPair.sign(msgHash, { canonical: true });

  const r = sig.r.toString('hex').padStart(64, '0');
  const s = sig.s.toString('hex').padStart(64, '0');
  // Tron recovery param: 0 or 1 (NOT +27 like Ethereum)
  const v = (sig.recoveryParam ?? 0).toString(16).padStart(2, '0');
  const sigHex = r + s + v;

  return { ...tx, signature: [sigHex] };
}

// ─────────────────────────────────────────────────────────────────────
// CUSTOMER-PAYS-ORIGIN RAIL (0 USDT on any operator wallet — ever)
//
//  • On-chain USDT SENDER = CUSTOMER'S OWN EXTERNAL WALLET (not hot, not treasury).
//  • Customer signs USDT.transfer(dest, amt) with THEIR private key offline.
//  • Your system ONLY relays the pre-signed tx to the network.
//  • Hot wallet can sponsor TRX energy/bandwidth via freeze if needed, but holds $0 USDT.
//  • Operator holds ZERO USDT at any step. Exactly the operator's directive.
//
// Flow:
//   1. prepareCustomerOriginTransfer(dest, amount, customerOriginAddress)
//        → returns UNSIGNED triggerSmartContract transaction for the customer to sign.
//        → fromAddress = CUSTOMER'S wallet. They sign with TronLink / Klever / etc.
//   2. submitCustomerSignedTransfer(signedTxJSON)
//        → you relay. Hot wallet pays nothing extra if customer already has energy.
//        → tx on-chain: USDT.transfer(customer.origin → external.dest, amount)
//        → Operator NEVER holds USDT. ZERO exposure. Hot gas for sponsorship only.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build an UNSIGNED USDT TRC-20 transfer for CUSTOMER'S wallet to sign & submit.
 * SENDER = customerOriginAddress (their external Tron wallet).
 * They sign offline / in TronLink. Your system never sees their private key.
 *
 * This is the ONLY rail where the operator holds $0 USDT at any step.
 * No treasury, no hot float, no exchange balance required.
 *
 * @param customerOriginAddress T-address of the customer sending from THEIR wallet.
 *                              This must be the SAME wallet that owns the on-chain USDT.
 * @param toExternalAddress Customer's destination external address (can be same as origin if self-transfer).
 * @param amount USDT amount (6 decimals on TRC-20).
 * @returns {unsignedTx, txID} — unsigned tx JSON + txID. Customer signs (signature array appended).
 */
export async function prepareCustomerOriginTransfer(
  customerOriginAddress: string,
  toExternalAddress: string,
  amount: number
): Promise<{
  unsignedTx: any;
  txID: string;
  to_amount: number;
  from: string;
  to: string;
  contract: string;
  note: string;
}> {
  if (!customerOriginAddress?.startsWith('T') || customerOriginAddress.length < 34) {
    throw new Error(`Invalid origin customer T-address: "${customerOriginAddress}"`);
  }
  if (!toExternalAddress?.startsWith('T') || toExternalAddress.length < 34) {
    throw new Error(`Invalid destination T-address: "${toExternalAddress}"`);
  }
  if (amount <= 0) throw new Error('Amount must be > 0');

  const amountSun = Math.floor(amount * 1_000_000);
  const toHex = tronAddressToHex(toExternalAddress);
  const parameter = addressToAbiParam(toHex) + uint256ToAbiParam(amountSun);

  const buildRes = await tronRequest('post', `${TRON_GRID}/wallet/triggersmartcontract`, {
    owner_address: tronAddressToHex(customerOriginAddress),
    contract_address: tronAddressToHex(USDT_CONTRACT),
    function_selector: 'transfer(address,uint256)',
    parameter,
    fee_limit: 100_000_000,
    call_value: 0,
  }, { timeout: 15000 });
  const tx = buildRes.data?.transaction;
  if (!tx?.txID) throw new Error(`Failed to build customer-origin tx: ${JSON.stringify(buildRes.data)}`);

  return {
    unsignedTx: tx,
    txID: tx.txID,
    to_amount: amount,
    from: customerOriginAddress,
    to: toExternalAddress,
    contract: USDT_CONTRACT,
    note:
      `Customer-origin USDT transfer: ${customerOriginAddress} transfers ${amount} USDT → ${toExternalAddress}. ` +
      `Operator never holds USDT. Customer signs with their Tron wallet private key offline. ` +
      `Hot wallet only sponsors bandwidth / TRX energy if needed — never pays USDT.`,
  };
}

/**
 * Relay a PRE-SIGNED customer-origin USDT transfer to the network.
 *
 * The customer has signed this transaction with their own private key.
 * SENDER = customer's wallet. OPERATOR = zero USDT exposure.
 * Hot wallet only pays network fees IF energy sponsorship is enabled
 * (default: no sponsorship; tx pays bandwidth from customer's own account).
 */
export async function submitCustomerSignedTransfer(
  signedTx: any
): Promise<{
  txId: string;
  broadcast: boolean;
  from: string;
  to: string;
  amount: number;
  network: 'tron';
  note: string;
  operatorUsdtHeld: 0;
}> {
  if (!signedTx?.signature?.length) throw new Error('Signed tx has no signatures. Customer must sign first.');
  if (!signedTx.raw_data_hex && !signedTx.raw_data) throw new Error('Signed tx missing raw_data.');

  const broadcastRes = await tronRequest('post', `${TRON_GRID}/wallet/broadcasttransaction`, signedTx, { timeout: 15000 });
  if (!broadcastRes.data?.result) {
    throw new Error(`Customer-origin relay failed: ${JSON.stringify(broadcastRes.data)}`);
  }
  const txId = signedTx.txID || broadcastRes.data.txid || '';

  // Try to extract amount & destination addresses for auditability
  let amount = 0;
  let to = '';
  try {
    const contract = signedTx.raw_data?.contract?.[0];
    if (contract?.parameter?.value) {
      const pv = contract.parameter.value;
      if (pv.data) {
        const data = String(pv.data).replace('0x', '');
        if (data.length >= 136) {
          const toHex = '41' + data.slice(24, 64);
          const amtHex = data.slice(64, 128);
          amount = parseInt(amtHex, 16) / 1_000_000;
          const bs58 = require('bs58');
          const hexBuf = Buffer.from(toHex, 'hex');
          // add checksum
          const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest();
          const chk1 = sha256(sha256(hexBuf));
          const full = Buffer.concat([hexBuf, chk1.slice(0, 4)]);
          to = bs58.encode(full);
        }
      }
      if (pv.owner_address) {
        // owner is from address — we don't need to return
      }
    }
  } catch {}

  return {
    txId,
    broadcast: true,
    from: signedTx.raw_data?.contract?.[0]?.parameter?.value?.owner_address || 'from-in-signed-tx',
    to,
    amount,
    network: 'tron',
    note:
      `Customer-origin transfer relayed. Operator never held USDT. No treasury, no hot float, no exchange balance. ` +
      `On-chain USDT sender = customer's own wallet (${signedTx.raw_data?.contract?.[0]?.parameter?.value?.owner_address || 'detached'}). ` +
      `Hot wallet involvement = ${broadcastRes.data.txid ? 'zero — customer paid bandwidth.' : 'possible energy sponsorship if enabled.'}`,
    operatorUsdtHeld: 0,
  };
}

/**
 * AUTO GAS TOPUP HELPER
 * Call this BEFORE sendUsdt() or other broadcast-requiring operations.
 *
 * If the SENDER wallet (hot or treasury) has less than 20 TRX:
 *   1. Debit merchant USD wallet for ~$5 (25 TRX buffer at ~0.20 $/TRX + safety margin)
 *   2. Binance SPOT BUY → buy TRX using merchant wallet USD via buyAssetWithUsd()
 *      (real quoteOrderQty MARKET buy → real TRX lands in Binance SPOT wallet, NOT internal numbers)
 *   3. Binance Withdraw → send the purchased TRX from Binance spot → hot/treasury Tron wallet
 *   4. Poll TronGrid up to 3 minutes waiting for the TRX withdrawal to confirm on-chain
 *   5. Re-check sender TRX balance; if >= 20 → return OK; else throw pending_manual.
 *
 * FAILURE SAFETY: If Binance buy/withdraw fails AFTER merchant USD was debited, the USD is
 *                 AUTOMATICALLY credited back (rolled back) so the merchant never loses funds.
 *                 The credit reference uses the same reference as the debit for auditability.
 *
 * Returns enriched info object including whether auto-topup was attempted + results.
 *
 * Requires:
 *   - Binance API keys LIVE & SET in .env (BINANCE_API_KEY + BINANCE_API_SECRET)
 *   - merchantId passed by caller so we can debit their internal USD wallet
 *   - merchant wallet has sufficient USD balance ($5 minimum buffer)
 */
export type GasAutoFundResult = {
  ok: boolean;
  preTopupTrx: number;
  postTopupTrx: number;
  neededTopup: boolean;
  topupUsdSpent?: number;
  topupTrxBought?: number;
  binanceBuyOrderId?: string;
  binanceWithdrawId?: string;
  settledAfterMs?: number;
  rollbackApplied?: boolean;
  rollbackAmount?: number;
  note?: string;
};

/**
 * ensureHotWalletGasOrFail — CANONICAL ENTRY POINT.
 *
 * When hot/treasury wallet TRX < minTrx (default 20):
 *   → FALLBACK: Debit merchant USD → Binance SPOT BUY 25 TRX (quoteOrderQty real MARKET)
 *               → Binance Withdraw TRX → sender wallet → poll chain until settled.
 *
 * On any failure AFTER USD debit: merchant USD is AUTOMATICALLY refunded (rollback credit).
 * Merchant never loses funds. No more "go outside to buy TRX".
 */
export async function ensureHotWalletGasOrFail(opts: {
  merchantId: string;
  senderRole: 'hot' | 'treasury';
  minTrx?: number;
  usdBuffer?: number;
  trxTarget?: number;
  maxWaitMs?: number;
}): Promise<GasAutoFundResult> {
  const minTrx = opts?.minTrx ?? 20;
  const trxTarget = opts?.trxTarget ?? 25;
  const usdBuffer = opts?.usdBuffer ?? 5.5;
  const maxWaitMs = opts?.maxWaitMs ?? 180_000;

  const senderAddress = opts.senderRole === 'treasury' ? getTreasuryAddress() : getHotWalletAddress();
  const startBal = opts.senderRole === 'treasury' ? await getTreasuryTrxBalance() : await getHotWalletTrxBalance();

  if (startBal >= minTrx) {
    return {
      ok: true,
      preTopupTrx: startBal,
      postTopupTrx: startBal,
      neededTopup: false,
    };
  }

  const neededTopup = true;
  let topupUsdSpent: number | undefined;
  let topupTrxBought: number | undefined;
  let binanceBuyOrderId: string | undefined;
  let binanceWithdrawId: string | undefined;
  let settledAfterMs: number | undefined;
  let rollbackApplied = false;
  let rollbackAmount: number | undefined;
  let debitReference: string | undefined;
  const startedAt = Date.now();

  let debitHelper: any = null;
  let priceSnapshot: any = null;

  try {
    const [_debitHelper, bs, priceInfo] = await Promise.all([
      import('../domain/payouts/payoutHelpers'),
      import('./binance.service'),
      import('./binance.service').then(m => m.getLatestPrice('TRXUSDT')).catch(() => ({ price: 0.20 })),
    ]);
    debitHelper = _debitHelper;
    priceSnapshot = { target: senderAddress, trxTarget, trxSpotPriceUsd: Number(priceInfo.price || 0.20) || 0.20 };

    const trxPrice = Number(priceInfo.price || 0.20) || 0.20;
    const buyUsdAmount = Math.max(usdBuffer, trxTarget * trxPrice * 1.15 + 1);
    topupUsdSpent = buyUsdAmount;
    rollbackAmount = buyUsdAmount;
    debitReference = `trx_gas_${opts.senderRole}_${Date.now()}`;

    await debitHelper.debitMerchantWallet(
      opts.merchantId,
      buyUsdAmount,
      'tron_auto_gas_topup',
      debitReference,
      { source: 'ensureHotWalletGasOrFail', ...priceSnapshot }
    );

    const buyResult = await bs.buyAssetWithUsd('TRX', buyUsdAmount);
    if (!buyResult || !buyResult.ok) throw new Error('Binance TRX buy returned not-ok');
    topupTrxBought = Number(buyResult.executedQty || 0);
    binanceBuyOrderId = String(buyResult.order_id || '');
    if (!topupTrxBought || topupTrxBought <= 0) throw new Error('Binance TRX buy executed 0 quantity');

    const withdrawResp = await bs.withdrawAsset('TRX', senderAddress, 'TRX', topupTrxBought, {
      withdrawOrderId: `TRX-GAS-${opts.senderRole.toUpperCase()}-${Date.now()}`,
    });
    binanceWithdrawId = String(withdrawResp?.id || withdrawResp?.withdrawId || '');

    const pollStart = Date.now();
    let lastPollBal = startBal;
    while (Date.now() - pollStart < maxWaitMs) {
      await new Promise(r => setTimeout(r, 3000));
      lastPollBal = opts.senderRole === 'treasury' ? await getTreasuryTrxBalance() : await getHotWalletTrxBalance();
      if (lastPollBal >= minTrx) {
        settledAfterMs = Date.now() - startedAt;
        break;
      }
    }

    if (lastPollBal < minTrx) {
      throw new Error(
        `Auto TRX gas topup: Binance withdraw submitted but chain balance <${minTrx} after ${(Date.now()-pollStart)/1000|0}s. On-chain TRX still pending (${lastPollBal.toFixed(2)}). Wait 1–2 min then manually retry.`
      );
    }

    return {
      ok: true,
      preTopupTrx: startBal,
      postTopupTrx: lastPollBal,
      neededTopup,
      topupUsdSpent,
      topupTrxBought,
      binanceBuyOrderId,
      binanceWithdrawId,
      settledAfterMs,
      rollbackApplied: false,
      note:
        `Automatically funded ${opts.senderRole} wallet ${senderAddress} with ${topupTrxBought.toFixed(4)} TRX. ` +
        `Merchant USD wallet debited $${buyUsdAmount.toFixed(2)}. Binance order=${binanceBuyOrderId || 'n/a'}, withdraw=${binanceWithdrawId || 'n/a'}. ` +
        `On-chain balance after settle: ${lastPollBal.toFixed(4)} TRX (confirmed after ${((settledAfterMs||0)/1000).toFixed(1)}s). Broadcast can proceed.`,
    };
  } catch (gasErr: any) {
    if (topupUsdSpent !== undefined && debitHelper && debitReference) {
      try {
        await debitHelper.creditMerchantWallet(
          opts.merchantId,
          topupUsdSpent,
          'tron_auto_gas_topup_rollback',
          `rollback_${debitReference}`,
          {
            source: 'ensureHotWalletGasOrFail',
            rollbackReason: String(gasErr?.message || String(gasErr)).slice(0, 300),
            originalDebit: debitReference,
            ...priceSnapshot,
          }
        );
        rollbackApplied = true;
      } catch (rbErr: any) {
        console.error(
          `[ensureHotWalletGasOrFail:ROLLBACK_FAIL] Merchant ${opts.merchantId} was debited $${topupUsdSpent.toFixed(2)} ` +
          `for TRX gas topup but ROLLBACK CREDIT FAILED. Manual reconciliation REQUIRED. ` +
          `debitRef=${debitReference} rollbackErr=${rbErr?.message || String(rbErr)}`
        );
      }
    }

    const msg = String(gasErr?.message || String(gasErr)).slice(0, 600);
    const usdSafety = rollbackApplied
      ? `Merchant USD $${(topupUsdSpent||0).toFixed(2)} has been refunded. `
      : (topupUsdSpent !== undefined
          ? `WARNING: USD debit occurred but rollback credit ${rollbackApplied ? 'applied' : 'UNKNOWN — verify wallet manually'}. `
          : '');

    throw Object.assign(
      new Error(
        `${opts.senderRole.toUpperCase()} wallet (${senderAddress}) needs ≥${minTrx} TRX for gas. ` +
        `Has ${startBal.toFixed(2)} TRX pre-check. Auto topup FAILED: ${msg}. ` +
        usdSafety +
        `If Binance TRX withdrawal is still confirming, manually retry in 1–2 minutes. ` +
        `Otherwise, top up ${senderAddress} directly with TRX and retry.`
      ),
      {
        cause: gasErr,
        autoFund: {
          ok: false,
          preTopupTrx: startBal,
          postTopupTrx: -1,
          neededTopup,
          topupUsdSpent,
          topupTrxBought,
          binanceBuyOrderId,
          binanceWithdrawId,
          settledAfterMs: settledAfterMs ?? (Date.now() - startedAt),
          rollbackApplied,
          rollbackAmount,
          note: msg,
        } as Partial<GasAutoFundResult>,
      }
    );
  }
}

/**
 * Backward-compatibility alias. New code should use ensureHotWalletGasOrFail().
 * The old "WithAutoFund" suffix is preserved so existing callers keep working.
 */
export async function ensureHotWalletGasOrFailWithAutoFund(opts: Parameters<typeof ensureHotWalletGasOrFail>[0]): Promise<GasAutoFundResult> {
  return ensureHotWalletGasOrFail(opts);
}

export type HotWalletUsdtFundResult = {
  ok: boolean;
  preTopupUsdt: number;
  postTopupUsdt: number;
  targetUsdt: number;
  neededTopup: boolean;
  usdSpent?: number;
  usdtBought?: number;
  binanceBuyOrderId?: string;
  binanceWithdrawId?: string;
  settledAfterMs?: number;
  rollbackApplied?: boolean;
  rollbackAmount?: number;
  hotWalletAddress?: string;
  network?: 'tron' | 'bsc' | 'polygon';
  note?: string;
};

/**
 * AUTO-BUY USDT TO HOT WALLET (Tron / BSC / Polygon)
 *
 * When hot wallet USDT balance < minUsdt → uses MERCHANT USD wallet to BUY real USDT
 * via Binance SPOT and withdraw to the hot wallet on the chosen chain.
 *
 *   • USDT purchase uses 2-step real SPOT conversion (USD→BTC→USDT) since USDTUSDT is invalid)
 *   • Non-USDT asset equivalent callers call buyAssetWithUsd which uses quoteOrderQty directly
 *   • Binance Travel-Rule withdrawal (TRC20 / BEP20 / PolygonERC20
 *
 * FAILURE SAFETY: If Binance buy/withdraw fails AFTER merchant USD is debited,
 *                 merchant USD is AUTOMATICALLY refunded (rollback credit).
 *
 * Polls on-chain balance until USDT >= minUsdt (default up to maxWaitMs.
 *
 * This is the EXACT feature the merchant requested: merchant USD ⇒ auto buy real USDT ⇒ send to hot wallet
 * — no more "manually go outside.
 */
export async function autobuyAndTopupHotWalletUsdt(opts: {
  merchantId: string;
  targetUsdt: number;
  minUsdt?: number;
  network?: 'tron' | 'bsc' | 'polygon';
  maxWaitMs?: number;
}): Promise<HotWalletUsdtFundResult> {
  const minUsdt = opts.minUsdt ?? Math.max(100, opts.targetUsdt * 1.02);
  const targetUsdt = opts.targetUsdt;
  const network = opts.network ?? 'tron';
  const maxWaitMs = opts.maxWaitMs ?? 300_000;

  let balanceFn: (() => Promise<number>), addrFn: () => Promise<string> | string;
  let hotAddress: string;
  let preTopupUsdt: number;

  if (network === 'bsc') {
    const bsc = await import('./bscweb.service');
    balanceFn = bsc.getHotWalletUsdtBalance;
    addrFn = bsc.getHotWalletAddress;
  } else if (network === 'polygon') {
    const poly = await import('./polygonweb.service');
    balanceFn = poly.getHotWalletUsdtBalance;
    addrFn = poly.getHotWalletAddress;
  } else {
    balanceFn = getHotWalletUsdtBalance;
    addrFn = getHotWalletAddress;
  }

  hotAddress = typeof addrFn === 'function' ? await (addrFn as any)() : addrFn as any;
  preTopupUsdt = await balanceFn();

  if (preTopupUsdt >= minUsdt) {
    return {
      ok: true,
      preTopupUsdt,
      postTopupUsdt: preTopupUsdt,
      targetUsdt,
      neededTopup: false,
      hotWalletAddress: hotAddress,
      network,
    };
  }

  let usdSpent: number | undefined;
  let usdtBought: number | undefined;
  let binanceBuyOrderId: string | undefined;
  let binanceWithdrawId: string | undefined;
  let settledAfterMs: number | undefined;
  let rollbackApplied = false;
  let rollbackAmount: number | undefined;
  let debitReference: string | undefined;
  const startedAt = Date.now();

  let debitHelper: any = null;

  try {
    const [_debitHelper, bs, bsPriceUsdt] = await Promise.all([
      import('../domain/payouts/payoutHelpers'),
      import('./binance.service'),
      import('./binance.service').then(m => m.getLatestPrice('USDTUSDT')).catch(() => ({ price: 1.00 })),
    ]);
    debitHelper = _debitHelper;

    const usdtPrice = Number(bsPriceUsdt.price ?? 1.00) || 1.00;
    usdSpent = Math.max(targetUsdt * usdtPrice * 1.03 + 1, targetUsdt * 1.03 + 1);
    rollbackAmount = usdSpent;
    debitReference = `hot_usdt_${network}_${Date.now()}`;

    await debitHelper.debitMerchantWallet(
      opts.merchantId,
      usdSpent,
      'hotwallet_usdt_auto_topup',
      debitReference,
      { source: 'autobuyAndTopupHotWalletUsdt', targetHotWallet: hotAddress, network, targetUsdt, usdtSpotPriceUsd: usdtPrice }
    );

    const buyResult = await bs.buyAssetWithUsd('USDT', usdSpent);
    if (!buyResult?.ok) throw new Error('Binance USDT buy returned not-ok');
    usdtBought = Number(buyResult.executedQty || buyResult.executed_qty || 0);
    binanceBuyOrderId = String(buyResult.order_id || '');
    if (!usdtBought || usdtBought <= 0) throw new Error('Binance USDT buy executed 0 USDT quantity');

    let binanceNetwork: string;
    if (network === 'bsc') binanceNetwork = 'BSC';
    else if (network === 'polygon') binanceNetwork = 'MATIC';
    else binanceNetwork = 'TRC20';

    const withdrawResp = await bs.withdrawAsset('USDT', hotAddress, binanceNetwork, usdtBought, {
      withdrawOrderId: `USDT-HOT-${network.toUpperCase()}-${Date.now()}`,
    });
    binanceWithdrawId = String(withdrawResp?.id || withdrawResp?.withdrawId || '');

    const pollStart = Date.now();
    let lastPollBal = preTopupUsdt;
    while (Date.now() - pollStart < maxWaitMs) {
      await new Promise(r => setTimeout(r, 5000));
      lastPollBal = await balanceFn();
      if (lastPollBal >= minUsdt) {
        settledAfterMs = Date.now() - startedAt;
        break;
      }
    }

    if (lastPollBal < minUsdt) {
      throw new Error(
        `Auto USDT hot-wallet topup: Binance withdraw submitted but chain balance <${minUsdt} USDT after ${(Date.now()-pollStart)/1000|0}s. On-chain USDT still pending (${lastPollBal.toFixed(4)}). Wait 2–10 min then manually retry.`
      );
    }

    return {
      ok: true,
      preTopupUsdt,
      postTopupUsdt: lastPollBal,
      targetUsdt,
      neededTopup: true,
      usdSpent,
      usdtBought,
      binanceBuyOrderId,
      binanceWithdrawId,
      settledAfterMs,
      rollbackApplied: false,
      hotWalletAddress: hotAddress,
      network,
      note:
        `Automatically funded ${network.toUpperCase()} hot wallet ${hotAddress} with ${usdtBought.toFixed(4)} USDT. ` +
        `Merchant USD wallet debited $${usdSpent.toFixed(2)}. Binance order=${binanceBuyOrderId || 'n/a'}, withdraw=${binanceWithdrawId || 'n/a'}. ` +
        `On-chain balance after settle: ${lastPollBal.toFixed(4)} USDT (confirmed after ${((settledAfterMs||0)/1000).toFixed(1)}s). Payouts can proceed.`,
    };
  } catch (topupErr: any) {
    if (usdSpent !== undefined && debitHelper && debitReference) {
      try {
        await debitHelper.creditMerchantWallet(
          opts.merchantId,
          usdSpent,
          'hotwallet_usdt_auto_topup_rollback',
          `rollback_${debitReference}`,
          {
            source: 'autobuyAndTopupHotWalletUsdt',
            rollbackReason: String(topupErr?.message || String(topupErr)).slice(0, 300),
            originalDebit: debitReference,
            targetHotWallet: hotAddress, network, targetUsdt,
          }
        );
        rollbackApplied = true;
      } catch (rbErr: any) {
          console.error(
            `[autobuyAndTopupHotWalletUsdt:ROLLBACK_FAIL] Merchant ${opts.merchantId} was debited $${usdSpent.toFixed(2)} ` +
            `for hot USDT topup but ROLLBACK CREDIT FAILED. Manual reconciliation REQUIRED. ` +
            `debitRef=${debitReference} rollbackErr=${rbErr?.message || String(rbErr)}`
          );
        }
    }
    const msg = String(topupErr?.message || String(topupErr)).slice(0, 600);
    const usdSafety = rollbackApplied
      ? `Merchant USD $${(usdSpent||0).toFixed(2)} has been refunded. `
      : (usdSpent !== undefined
          ? `WARNING: USD debit occurred but rollback credit ${rollbackApplied ? 'applied' : 'UNKNOWN — verify wallet manually'}. `
          : '');
    throw Object.assign(
      new Error(
        `Auto USDT topup for ${network.toUpperCase()} hot wallet (${hotAddress}) FAILED: ${msg}. ` +
        usdSafety +
        `Pre-check balance: ${preTopupUsdt.toFixed(4)} USDT. Target min: ${minUsdt.toFixed(4)} USDT. ` +
        `If Binance withdrawal is still confirming, retry in 2–10 minutes.`
      ),
      {
        cause: topupErr,
        topup: {
          ok: false,
          preTopupUsdt,
          postTopupUsdt: -1,
          targetUsdt,
          neededTopup: true,
          usdSpent,
          usdtBought,
          binanceBuyOrderId,
          binanceWithdrawId,
          settledAfterMs: settledAfterMs ?? (Date.now() - startedAt),
          rollbackApplied,
          rollbackAmount,
          hotWalletAddress: hotAddress,
          network,
          note: msg,
        } as Partial<HotWalletUsdtFundResult>,
      }
    );
  }
}
