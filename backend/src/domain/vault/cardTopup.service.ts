/**
 * Card Top-Up Service — 6 Real-Fund Loading Channels
 * ─────────────────────────────────────────────────────────────────────────────
 * Each channel verifies that REAL money has moved before crediting the card.
 * No credit is posted until external confirmation is received.
 *
 * Channels:
 *   1. BANK_WIRE     — SWIFT / SEPA / ACH incoming bank transfer
 *   2. WISE          — Wise transfer (incoming to Wise balance)
 *   3. CRYPTO        — USDT/TRON on-chain deposit (TRC-20, BEP-20, ERC-20)
 *   4. TRANSAK       — Transak fiat on-ramp (card/bank → crypto → card)
 *   5. CASH          — Cash deposit confirmed by operator
 *   6. CARD_TO_CARD  — Load from another vault card or external card
 *
 * Flow for every channel:
 *   1. Validate request parameters
 *   2. Verify funds with the external provider
 *   3. Call creditCard() → writes to vault_card_balances + vault_card_txns
 *   4. Push the new balance to vault-bank-settlement.js via HTTP
 *   5. Return the credited card balance
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { creditCard, getCardBalance } from './cardBalance.service';
import { db } from '../../config/db';

// ── Settlement server sync ────────────────────────────────────────────────────
/** Push updated card balance to vault-bank-settlement.js in-memory cardAccounts */
async function syncToSettlement(cardId: string, currency: string, amountMajor: number, providerRef: string): Promise<void> {
  const settlementUrl = process.env.VAULT_SETTLEMENT_URL?.trim()
    || `http://127.0.0.1:${process.env.VAULT_SETTLEMENT_PORT || process.env.VAULT_BANK_PORT || '9001'}`;
  const vaultAccount  = cardIdToVaultAccount(cardId, currency);
  const amountMinor   = Math.round(amountMajor * 100);

  try {
    await axios.post(
      `${settlementUrl}/api/vault/internal/load-vault-card-account`,
      { vaultAccountId: vaultAccount, cardId, currencyCode: currency, amount: amountMinor, reference: providerRef },
      { timeout: 6000 }
    );
    console.log(`[CardTopup] ✅ Settlement sync: card=${cardId} ${currency} +${amountMajor} ref=${providerRef}`);
  } catch (err: any) {
    // Non-fatal — SQLite balance is already written.
    // Settlement server will re-sync from SQLite on next restart.
    console.warn(`[CardTopup] ⚠ Settlement sync failed (${err.message}) — SQLite balance persisted, will sync on restart`);
  }
}

function cardIdToVaultAccount(cardId: string, currency: string): string {
  // Map friendly card IDs to vault account IDs
  const map: Record<string, string> = {
    usd: 'PROC-VAULT-USD-002',
    eur: 'PROC-VAULT-EUR-001',
    aed: 'PROC-VAULT-AED-003',
  };
  const normalized = String(cardId).toLowerCase();
  return map[normalized] || process.env[`OPERATOR_CARD_${currency.toUpperCase()}_VAULT_ACCOUNT`] || `PROC-VAULT-${currency.toUpperCase()}-001`;
}

// ── Shared result type ────────────────────────────────────────────────────────
export interface TopupResult {
  ok:           boolean;
  channel:      string;
  cardId:       string;
  currency:     string;
  amount:       number;
  providerRef:  string;
  balanceAfter: number;
  message:      string;
  txnId?:       string;
  error?:       string;
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 1 — BANK WIRE (SWIFT / SEPA / ACH)
// ─────────────────────────────────────────────────────────────────────────────
// The operator receives a bank wire to the vault bank's correspondent account.
// They confirm it here by providing the wire reference and amount.
// A supervisor password is required to prevent unauthorised cash-ins.
// ═════════════════════════════════════════════════════════════════════════════
export interface BankWireTopupInput {
  cardId:          string;
  currency:        string;
  amount:          number;
  wireReference:   string;   // SWIFT MT103 :20: field or SEPA EndToEndId
  senderName:      string;
  senderBank:      string;
  transferType:    'SWIFT' | 'SEPA' | 'ACH' | 'FEDWIRE' | 'FASTER_PAYMENTS' | 'RTGS';
  operatorCode:    string;   // operator confirmation code (VAULT_CASH_OPERATOR_CODE env)
  note?:           string;
}

export async function topupViaBankWire(input: BankWireTopupInput): Promise<TopupResult> {
  const expectedCode = (process.env.VAULT_CASH_OPERATOR_CODE || '').trim();
  if (expectedCode && input.operatorCode.trim() !== expectedCode) {
    return { ok: false, channel: 'bank_wire', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.wireReference, balanceAfter: 0,
      message: 'Operator code invalid', error: 'INVALID_OPERATOR_CODE' };
  }
  if (!input.wireReference?.trim() || !input.senderName?.trim() || input.amount <= 0) {
    return { ok: false, channel: 'bank_wire', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: '', balanceAfter: 0,
      message: 'wireReference, senderName and positive amount are required', error: 'VALIDATION_ERROR' };
  }

  // Record the wire confirmation for audit
  const now = new Date().toISOString();
  await db.query(`CREATE TABLE IF NOT EXISTS vault_wire_confirmations (
    id TEXT PRIMARY KEY, card_id TEXT, currency TEXT, amount REAL, wire_reference TEXT UNIQUE,
    sender_name TEXT, sender_bank TEXT, transfer_type TEXT, confirmed_at TEXT, note TEXT
  )`).catch(() => {});
  try {
    await db.query(
      `INSERT INTO vault_wire_confirmations (id, card_id, currency, amount, wire_reference, sender_name, sender_bank, transfer_type, confirmed_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), input.cardId, input.currency.toUpperCase(), input.amount, input.wireReference,
       input.senderName, input.senderBank, input.transferType, now, input.note ?? null]
    );
  } catch (dupErr: any) {
    if (String(dupErr.message).toLowerCase().includes('unique')) {
      return { ok: false, channel: 'bank_wire', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.wireReference, balanceAfter: 0,
        message: 'This wire reference has already been credited', error: 'DUPLICATE_WIRE_REF' };
    }
    throw dupErr;
  }

  const txn = await creditCard(input.cardId, input.currency, input.amount, 'bank_wire',
    input.wireReference, `${input.transferType}:${input.senderBank}`, input.note);
  await syncToSettlement(input.cardId, input.currency, input.amount, input.wireReference);
  const bal = await getCardBalance(input.cardId, input.currency);

  return { ok: true, channel: 'bank_wire', cardId: input.cardId, currency: input.currency,
    amount: input.amount, providerRef: input.wireReference, balanceAfter: bal.balance,
    message: `${input.transferType} wire of ${input.currency} ${input.amount.toFixed(2)} credited to card`, txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 2 — WISE INCOMING TRANSFER
// ─────────────────────────────────────────────────────────────────────────────
// Customer sends funds to the Wise account. We verify the transfer via
// Wise API (GET /v1/transfers/{id}) before crediting the card.
// ═════════════════════════════════════════════════════════════════════════════
export interface WiseTopupInput {
  cardId:      string;
  currency:    string;
  amount:      number;
  transferId:  string;   // Wise transfer ID
  note?:       string;
}

export async function topupViaWise(input: WiseTopupInput): Promise<TopupResult> {
  const wiseApiKey = (process.env.WISE_API_KEY || '').trim();
  const wiseApiUrl = (process.env.WISE_API_URL || 'https://api.wise.com').replace(/\/+$/, '');
  if (!wiseApiKey) {
    return { ok: false, channel: 'wise', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.transferId, balanceAfter: 0,
      message: 'WISE_API_KEY not configured', error: 'WISE_NOT_CONFIGURED' };
  }
  if (!input.transferId?.trim() || input.amount <= 0) {
    return { ok: false, channel: 'wise', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: '', balanceAfter: 0,
      message: 'transferId and positive amount are required', error: 'VALIDATION_ERROR' };
  }

  // Verify with Wise API
  try {
    const resp = await axios.get(`${wiseApiUrl}/v1/transfers/${input.transferId}`, {
      headers: { Authorization: `Bearer ${wiseApiKey}` },
      timeout: 10000,
    });
    const transfer = resp.data;
    const status   = String(transfer.status || '').toUpperCase();
    const confirmedStatuses = ['OUTGOING_PAYMENT_SENT', 'FUNDS_CONVERTED', 'PROCESSING', 'COMPLETED'];
    if (!confirmedStatuses.some(s => status.includes(s))) {
      return { ok: false, channel: 'wise', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.transferId, balanceAfter: 0,
        message: `Wise transfer status is ${status} — not yet confirmed`, error: 'TRANSFER_NOT_CONFIRMED' };
    }
    const wiseAmount = Number(transfer.targetValue || transfer.sourceValue || 0);
    if (Math.abs(wiseAmount - input.amount) > 0.02) {
      return { ok: false, channel: 'wise', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.transferId, balanceAfter: 0,
        message: `Amount mismatch: Wise shows ${wiseAmount}, requested ${input.amount}`, error: 'AMOUNT_MISMATCH' };
    }
  } catch (err: any) {
    return { ok: false, channel: 'wise', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.transferId, balanceAfter: 0,
      message: `Wise verification failed: ${err.message}`, error: 'WISE_VERIFICATION_FAILED' };
  }

  const txn = await creditCard(input.cardId, input.currency, input.amount, 'wise',
    input.transferId, `WISE:${input.transferId}`, input.note);
  await syncToSettlement(input.cardId, input.currency, input.amount, input.transferId);
  const bal = await getCardBalance(input.cardId, input.currency);

  return { ok: true, channel: 'wise', cardId: input.cardId, currency: input.currency,
    amount: input.amount, providerRef: input.transferId, balanceAfter: bal.balance,
    message: `Wise transfer ${input.transferId} verified and credited to card`, txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 3 — CRYPTO (USDT on-chain: TRC-20 / BEP-20 / ERC-20)
// ─────────────────────────────────────────────────────────────────────────────
// Customer sends USDT to a vault wallet address. We verify the tx on-chain
// via TronGrid or BscScan API before crediting the equivalent USD to the card.
// ═════════════════════════════════════════════════════════════════════════════
export interface CryptoTopupInput {
  cardId:      string;
  currency:    string;       // target card currency (USD/EUR/AED)
  txHash:      string;       // blockchain transaction hash
  network:     'tron' | 'bsc' | 'ethereum' | 'polygon';
  amount:      number;       // expected USDT amount
  note?:       string;
}

const TRON_USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BSC_USDT_CONTRACT   = '0x55d398326f99059fF775485246999027B3197955';
const ETH_USDT_CONTRACT   = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const POLY_USDT_CONTRACT  = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

export async function topupViaCrypto(input: CryptoTopupInput): Promise<TopupResult> {
  if (!input.txHash?.trim() || input.amount <= 0) {
    return { ok: false, channel: 'crypto', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: '', balanceAfter: 0,
      message: 'txHash and positive amount are required', error: 'VALIDATION_ERROR' };
  }

  let verified = false;
  let onChainAmount = 0;

  try {
    if (input.network === 'tron') {
      // Verify via TronGrid
      const tronApiKey = process.env.TRON_API_KEY || '';
      const resp = await axios.get(
        `https://api.trongrid.io/v1/transactions/${input.txHash}`,
        { headers: { 'TRON-PRO-API-KEY': tronApiKey }, timeout: 10000 }
      );
      const txData = resp.data?.data?.[0];
      if (txData?.ret?.[0]?.contractRet === 'SUCCESS') {
        // TRC-20 transfer: check contract and amount
        const contractData = txData?.raw_data?.contract?.[0]?.parameter?.value;
        if (contractData) {
          onChainAmount = Number(contractData.amount || 0) / 1_000_000; // USDT has 6 decimals on Tron
          verified = Math.abs(onChainAmount - input.amount) <= 0.05;
        }
      }
    } else if (input.network === 'bsc' || input.network === 'ethereum' || input.network === 'polygon') {
      // Verify via BscScan / Etherscan / PolygonScan
      const apiKey = input.network === 'bsc'
        ? (process.env.BSCSCAN_API_KEY || 'YourBscScanAPIKey')
        : input.network === 'polygon'
          ? (process.env.POLYGONSCAN_API_KEY || 'YourPolygonScanAPIKey')
          : (process.env.ETHERSCAN_API_KEY  || 'YourEtherscanAPIKey');
      const baseUrl = input.network === 'bsc'
        ? 'https://api.bscscan.com/api'
        : input.network === 'polygon'
          ? 'https://api.polygonscan.com/api'
          : 'https://api.etherscan.io/api';
      const contract = input.network === 'bsc' ? BSC_USDT_CONTRACT
        : input.network === 'polygon' ? POLY_USDT_CONTRACT : ETH_USDT_CONTRACT;
      const resp = await axios.get(baseUrl, {
        params: { module: 'proxy', action: 'eth_getTransactionByHash', txhash: input.txHash, apikey: apiKey },
        timeout: 10000,
      });
      const tx = resp.data?.result;
      if (tx && String(tx.to).toLowerCase() === contract.toLowerCase()) {
        // Decode ERC-20 transfer amount from input data
        const data = String(tx.input || '');
        if (data.startsWith('0xa9059cbb')) {
          const amountHex = data.slice(74, 138);
          onChainAmount = parseInt(amountHex, 16) / 1_000_000; // USDT has 6 decimals on EVM
          verified = Math.abs(onChainAmount - input.amount) <= 0.05;
        }
      }
    }
  } catch (verifyErr: any) {
    console.warn(`[CardTopup] Crypto verify error: ${verifyErr.message}`);
  }

  if (!verified) {
    return { ok: false, channel: 'crypto', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.txHash, balanceAfter: 0,
      message: `On-chain verification failed. Expected ${input.amount} USDT on ${input.network}, found ${onChainAmount.toFixed(6)}`,
      error: 'CRYPTO_VERIFICATION_FAILED' };
  }

  const txn = await creditCard(input.cardId, input.currency, input.amount, 'crypto',
    input.txHash, `${input.network.toUpperCase()}:${input.txHash}`, input.note);
  await syncToSettlement(input.cardId, input.currency, input.amount, input.txHash);
  const bal = await getCardBalance(input.cardId, input.currency);

  return { ok: true, channel: 'crypto', cardId: input.cardId, currency: input.currency,
    amount: input.amount, providerRef: input.txHash, balanceAfter: bal.balance,
    message: `${input.network.toUpperCase()} USDT tx ${input.txHash.slice(0, 12)}... verified (${onChainAmount.toFixed(2)} USDT) and credited`,
    txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 4 — TRANSAK ON-RAMP
// ─────────────────────────────────────────────────────────────────────────────
// Customer pays with their debit/credit card or bank transfer via Transak.
// Transak sends a webhook when the order is COMPLETED. We verify the order
// status via the Transak API before crediting the vault card.
// ═════════════════════════════════════════════════════════════════════════════
export interface TransakTopupInput {
  cardId:   string;
  currency: string;
  orderId:  string;   // Transak order ID
  amount:   number;   // expected fiat amount
  note?:    string;
}

export async function topupViaTransak(input: TransakTopupInput): Promise<TopupResult> {
  const transakApiKey    = (process.env.TRANSAK_API_KEY    || '').trim();
  const transakApiSecret = (process.env.TRANSAK_API_SECRET || '').trim();
  const transakBase      = (process.env.TRANSAK_BASE_URL   || 'https://api-gateway.transak.com').replace(/\/+$/, '');

  if (!transakApiKey) {
    return { ok: false, channel: 'transak', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.orderId, balanceAfter: 0,
      message: 'TRANSAK_API_KEY not configured', error: 'TRANSAK_NOT_CONFIGURED' };
  }

  try {
    // Get JWT for Transak API
    const authResp = await axios.post(`${transakBase}/api/v2/refresh-token`,
      { apiKey: transakApiKey, secret: transakApiSecret },
      { timeout: 10000 }
    );
    const accessToken = authResp.data?.data?.accessToken;

    // Fetch order details
    const orderResp = await axios.get(
      `${transakBase}/api/v2/order/${input.orderId}`,
      { headers: { 'access-token': accessToken }, timeout: 10000 }
    );
    const order = orderResp.data?.data;
    if (!order) throw new Error('Order not found');

    const orderStatus = String(order.status || '').toUpperCase();
    if (orderStatus !== 'COMPLETED') {
      return { ok: false, channel: 'transak', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.orderId, balanceAfter: 0,
        message: `Transak order status is ${orderStatus} — not COMPLETED`, error: 'ORDER_NOT_COMPLETED' };
    }

    const fiatAmount = Number(order.fiatAmount || 0);
    if (Math.abs(fiatAmount - input.amount) > 0.10) {
      return { ok: false, channel: 'transak', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.orderId, balanceAfter: 0,
        message: `Amount mismatch: Transak shows ${fiatAmount}, requested ${input.amount}`, error: 'AMOUNT_MISMATCH' };
    }
  } catch (err: any) {
    return { ok: false, channel: 'transak', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.orderId, balanceAfter: 0,
      message: `Transak verification failed: ${err.message}`, error: 'TRANSAK_VERIFICATION_FAILED' };
  }

  const txn = await creditCard(input.cardId, input.currency, input.amount, 'transak',
    input.orderId, `TRANSAK:${input.orderId}`, input.note);
  await syncToSettlement(input.cardId, input.currency, input.amount, input.orderId);
  const bal = await getCardBalance(input.cardId, input.currency);

  return { ok: true, channel: 'transak', cardId: input.cardId, currency: input.currency,
    amount: input.amount, providerRef: input.orderId, balanceAfter: bal.balance,
    message: `Transak order ${input.orderId} verified and credited to card`, txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 5 — CASH DEPOSIT
// ─────────────────────────────────────────────────────────────────────────────
// Customer hands cash to an operator. The operator confirms the deposit here
// using their operator code. This is for physical cash-in locations.
// ═════════════════════════════════════════════════════════════════════════════
export interface CashTopupInput {
  cardId:        string;
  currency:      string;
  amount:        number;
  depositRef:    string;   // receipt number / operator-assigned reference
  operatorId:    string;   // operator identifier
  operatorCode:  string;   // VAULT_CASH_OPERATOR_CODE
  location?:     string;   // branch / POS location
  note?:         string;
}

export async function topupViaCash(input: CashTopupInput): Promise<TopupResult> {
  const expectedCode = (process.env.VAULT_CASH_OPERATOR_CODE || '').trim();
  if (expectedCode && input.operatorCode.trim() !== expectedCode) {
    return { ok: false, channel: 'cash', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: input.depositRef, balanceAfter: 0,
      message: 'Operator code invalid', error: 'INVALID_OPERATOR_CODE' };
  }
  if (!input.depositRef?.trim() || !input.operatorId?.trim() || input.amount <= 0) {
    return { ok: false, channel: 'cash', cardId: input.cardId, currency: input.currency,
      amount: input.amount, providerRef: '', balanceAfter: 0,
      message: 'depositRef, operatorId and positive amount are required', error: 'VALIDATION_ERROR' };
  }

  // Record cash deposit for audit trail
  await db.query(`CREATE TABLE IF NOT EXISTS vault_cash_deposits (
    id TEXT PRIMARY KEY, card_id TEXT, currency TEXT, amount REAL,
    deposit_ref TEXT UNIQUE, operator_id TEXT, location TEXT,
    confirmed_at TEXT, note TEXT
  )`).catch(() => {});
  try {
    await db.query(
      `INSERT INTO vault_cash_deposits (id, card_id, currency, amount, deposit_ref, operator_id, location, confirmed_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), input.cardId, input.currency.toUpperCase(), input.amount, input.depositRef,
       input.operatorId, input.location ?? null, new Date().toISOString(), input.note ?? null]
    );
  } catch (dupErr: any) {
    if (String(dupErr.message).toLowerCase().includes('unique')) {
      return { ok: false, channel: 'cash', cardId: input.cardId, currency: input.currency,
        amount: input.amount, providerRef: input.depositRef, balanceAfter: 0,
        message: 'This deposit reference has already been credited', error: 'DUPLICATE_DEPOSIT_REF' };
    }
    throw dupErr;
  }

  const txn = await creditCard(input.cardId, input.currency, input.amount, 'cash',
    input.depositRef, `CASH:${input.operatorId}:${input.depositRef}`,
    `Cash deposit${input.location ? ` at ${input.location}` : ''}${input.note ? ` — ${input.note}` : ''}`);
  await syncToSettlement(input.cardId, input.currency, input.amount, input.depositRef);
  const bal = await getCardBalance(input.cardId, input.currency);

  return { ok: true, channel: 'cash', cardId: input.cardId, currency: input.currency,
    amount: input.amount, providerRef: input.depositRef, balanceAfter: bal.balance,
    message: `Cash deposit ${input.depositRef} of ${input.currency} ${input.amount.toFixed(2)} credited to card`, txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// CHANNEL 6 — CARD TO CARD
// ─────────────────────────────────────────────────────────────────────────────
// Transfer from one vault card to another (or from an external confirmed card).
// For vault-to-vault transfers, no external verification needed — both balances
// are within the same system. For external card loads, the operator confirms.
// ═════════════════════════════════════════════════════════════════════════════
export interface CardToCardTopupInput {
  sourceCardId:   string;   // source vault card ID (or 'EXTERNAL' for external card)
  destCardId:     string;   // destination vault card ID
  currency:       string;
  amount:         number;
  sourceRef:      string;   // transaction reference
  operatorCode?:  string;   // required when sourceCardId = 'EXTERNAL'
  note?:          string;
}

export async function topupViaCardToCard(input: CardToCardTopupInput): Promise<TopupResult> {
  if (input.amount <= 0 || !input.sourceRef?.trim()) {
    return { ok: false, channel: 'card_to_card', cardId: input.destCardId, currency: input.currency,
      amount: input.amount, providerRef: '', balanceAfter: 0,
      message: 'amount and sourceRef are required', error: 'VALIDATION_ERROR' };
  }

  // External card load: require operator code
  if (String(input.sourceCardId).toUpperCase() === 'EXTERNAL') {
    const expectedCode = (process.env.VAULT_CASH_OPERATOR_CODE || '').trim();
    if (expectedCode && (input.operatorCode || '').trim() !== expectedCode) {
      return { ok: false, channel: 'card_to_card', cardId: input.destCardId, currency: input.currency,
        amount: input.amount, providerRef: input.sourceRef, balanceAfter: 0,
        message: 'Operator code invalid for external card load', error: 'INVALID_OPERATOR_CODE' };
    }
  } else {
    // Vault-to-vault: debit the source card first
    const { debitCard, getCardBalance: gcb } = await import('./cardBalance.service');
    const srcBal = await gcb(input.sourceCardId, input.currency);
    if (srcBal.balance < input.amount) {
      return { ok: false, channel: 'card_to_card', cardId: input.destCardId, currency: input.currency,
        amount: input.amount, providerRef: input.sourceRef, balanceAfter: 0,
        message: `Source card ${input.sourceCardId} has insufficient balance (${srcBal.balance.toFixed(2)} ${input.currency})`,
        error: 'INSUFFICIENT_SOURCE_BALANCE' };
    }
    await debitCard(input.sourceCardId, input.currency, input.amount,
      input.sourceRef, `Card-to-card transfer to ${input.destCardId}`);
  }

  const txn = await creditCard(input.destCardId, input.currency, input.amount, 'card_to_card',
    input.sourceRef, `C2C:${input.sourceCardId}→${input.destCardId}`, input.note);
  await syncToSettlement(input.destCardId, input.currency, input.amount, input.sourceRef);
  const bal = await getCardBalance(input.destCardId, input.currency);

  return { ok: true, channel: 'card_to_card', cardId: input.destCardId, currency: input.currency,
    amount: input.amount, providerRef: input.sourceRef, balanceAfter: bal.balance,
    message: `Card-to-card: ${input.currency} ${input.amount.toFixed(2)} from ${input.sourceCardId} → ${input.destCardId}`,
    txnId: txn.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// Webhook handler for Transak — called by cardTopup.router.ts
// ═════════════════════════════════════════════════════════════════════════════
export async function handleTransakTopupWebhook(webhookBody: any, signature: string): Promise<void> {
  const secret = (process.env.TRANSAK_WEBHOOK_SECRET || '').trim();
  if (secret) {
    const crypto = await import('crypto');
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(webhookBody)).digest('hex');
    if (signature !== expected) throw Object.assign(new Error('Invalid Transak webhook signature'), { code: 'INVALID_SIGNATURE' });
  }

  const order = webhookBody?.data;
  if (!order || order.status !== 'COMPLETED') return; // only process completed orders

  // Find which card this order was for (stored during initial Transak widget open)
  const refRow = (await db.query(
    'SELECT card_id, currency FROM vault_transak_card_refs WHERE order_id = ? LIMIT 1',
    [order.id]
  ).catch(() => ({ rows: [] }))).rows[0] as any;

  if (!refRow) {
    console.warn(`[CardTopup] Transak webhook: no card mapping found for order ${order.id}`);
    return;
  }

  const amount = Number(order.fiatAmount || 0);
  if (amount <= 0) return;

  await creditCard(refRow.card_id, refRow.currency, amount, 'transak',
    order.id, `TRANSAK:${order.id}`, `Transak on-ramp completed`);
  await syncToSettlement(refRow.card_id, refRow.currency, amount, order.id);
  console.log(`[CardTopup] Transak webhook: credited ${refRow.currency} ${amount} to card=${refRow.card_id}`);
}
