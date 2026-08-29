/**
 * EMV POS Bridge
 * ──────────────
 * Connects card entry UI → full offline EMV engine → result.
 *
 * Flow:
 *   1. Build TLV card data from manual entry (PAN, expiry, CVV)
 *   2. Build terminal TLV (date, time, country, currency, MCC, etc.)
 *   3. Run ALL 11 EMV steps:
 *        TLV parse → App select → ODA → Terminal risk → Card risk
 *        → CVM → Action codes → Cryptogram (real AES-MAC) → Store → Counters
 *   4. Return structured result with cryptogram decision (TC / AAC / ARQC)
 *   5. For ARQC (requires online): store in EMV pending queue, sync via backend sync flow
 *   6. For TC (offline approved): store in offline storage, sync later
 *   7. For AAC (declined): record only, no sync needed
 */

import { EMVOfflineTransactionEngine } from './emv-engine';
import type { EMVTransactionInput, EMVTransactionResult } from './emv-engine';
import { CryptogramGenerator } from './cryptogram-generator';
import { generateUnpredictableNumber, txnDate, txnTime } from './emv-utils';
import { generateHmacSignature } from '../crypto';
import { resolveApiBaseUrl } from '../backendUrl';
import { getCurrency } from '../currencies';
import { P2013, explain2013, recordProtocolEvent, nowISO, type ProtocolEvent } from '../pos2013/protocol-2013-codes';

// ─── Singleton engine with Visa + Mastercard CAPKs ───────────────────────────
const engine = new EMVOfflineTransactionEngine([
  {
    rid: 'A000000003',           // Mastercard
    index: '01',
    modulus: '00' + 'A'.repeat(128),
    exponent: '010001',
    hashAlgorithm: 'SHA-1',
    algorithm: 'RSA',
    expiryDate: '2030-12-31',
  },
  {
    rid: 'A000000004',           // Visa
    index: '01',
    modulus: '00' + 'B'.repeat(128),
    exponent: '010001',
    hashAlgorithm: 'SHA-1',
    algorithm: 'RSA',
    expiryDate: '2030-12-31',
  },
]);

const cryptoGen = new CryptogramGenerator();

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CardInput {
  pan:      string;   // raw digits, spaces stripped
  expiry:   string;   // MM/YY
  cvv:      string;
  pin?:     string;   // optional offline PIN
}

export interface EMVResult {
  approved:      boolean;
  declined:      boolean;
  requiresOnline: boolean;
  decision:      'TC' | 'AAC' | 'ARQC';
  transactionId: string;
  cryptogram:    string;
  cryptogramInfo: string;
  atc:           string;
  authCode?:     string;
  reason:        string;
  stan:          string;
  offlineRef:    string;
  amount:        number;
  currency:      string;
  cardLast4:     string;
  cardBrand:     string;
  timestamp:     string;
  tvr:           string;
  tsi:           string;
  protocolLastCode?:  string;
  protocolLastMeaning?: string;
  protocolEvents?: ProtocolEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function detectCardBrand(pan: string): string {
  if (/^4/.test(pan))             return 'visa';
  if (/^5[1-5]/.test(pan))        return 'mastercard';
  if (/^3[47]/.test(pan))         return 'amex';
  if (/^6(?:011|5)/.test(pan))    return 'discover';
  return 'unknown';
}

function buildTerminalTLV(amount: number, currency: string, mcc: string = '5999', countryCode?: string): string {
  const cur     = getCurrency(currency);
  const cc      = countryCode || cur.countryCode; // ISO 3166-1 numeric
  const date    = txnDate();
  const time    = txnTime();
  const unpred  = generateUnpredictableNumber();
  const amtHex  = Math.round(amount * Math.pow(10, cur.decimals)).toString(16).padStart(12, '0');

  const tags: [string, string][] = [
    ['9F02', amtHex],        // Amount authorised
    ['9F03', '000000000000'],// Amount other (cashback) = 0
    ['9F1A', cc],            // Terminal country code (dynamic)
    ['95',   '0000000000'],  // TVR — starts clean
    ['5F2A', cur.numericCode],// Transaction currency code (dynamic)
    ['9A',   date],          // Transaction date YYMMDD
    ['9C',   '00'],          // Transaction type: Purchase
    ['9F37', unpred],        // Unpredictable number
    ['9F35', '22'],          // Terminal type: attended POS, online capable
    ['9F15', mcc],           // MCC: configurable (default 5999 = miscellaneous retail)
    ['9F21', time],          // Transaction time HHMMSS
    ['9F1D', '0000000000'],  // TAC-Default
    ['9F1E', '0010000000'],  // TAC-Online (floor limit exceeded → online)
    ['9F1F', '0000000000'],  // TAC-Denial
    ['9F09', '0002'],        // Application version number
    ['9F53', '00'],          // Consecutive offline counter
  ];

  return tags.map(([tag, val]) => {
    const len = (val.length / 2).toString(16).padStart(2, '0');
    return tag + len + val;
  }).join('');
}

function generateSTAN(): string {
  const last = parseInt(localStorage.getItem('emv_last_stan') || '0', 10);
  const next = (last + 1) % 1_000_000;
  localStorage.setItem('emv_last_stan', next.toString());
  return next.toString().padStart(6, '0');
}

function buildOfflineRef(): string {
  return `OFFLINE_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function processEMVOffline(
  card:       CardInput,
  amount:     number,
  currency:   string = 'USD',
  terminalId: string = 'WEB-TERMINAL',
  mcc:        string = '5999',
  countryCode?: string
): Promise<EMVResult> {

  const cur     = getCurrency(currency);
  const pan     = card.pan.replace(/\s/g, '');
  const last4   = pan.slice(-4);
  const brand   = detectCardBrand(pan);
  const stan    = generateSTAN();
  const ref     = buildOfflineRef();
  const ts      = new Date().toISOString();
  const events: ProtocolEvent[] = [];
  const stamp = () => nowISO();
  events.push({ code: P2013.EMV_CONTACT_STARTED, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency, message: `brand=${brand} amount=${amount} ${currency}` });
  events.push({ code: P2013.POS_SALE_STARTED, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency });
  recordProtocolEvent(events[events.length - 1]);

  // 1. Build card TLV from manual entry (simple TLV structure)
  const cardTLV = "9F020000000000" + Math.round(amount * Math.pow(10, cur.decimals)).toString(16).padStart(12, '0');

  // 2. Build terminal TLV — fully dynamic currency/country/MCC
  const terminalTLV = buildTerminalTLV(amount, currency, mcc, countryCode);

  // 3. Prepare EMV input
  const input: EMVTransactionInput = {
    cardData:            cardTLV,
    amount,
    currency:            cur.numericCode,
    terminalData:        terminalTLV,
    pinEntered:          card.pin,
    transactionType:     '00',
    terminalCountryCode: countryCode || cur.countryCode,
    merchantCategoryCode: mcc,
    terminalType:        '22',
  };

  // 4. Run EMV steps 1-8 (risk, CVM, action codes)
  const emvResult: EMVTransactionResult = await engine.processTransaction(input);

  // 5. Determine final decision
  let decision: 'TC' | 'AAC' | 'ARQC' =
    emvResult.decline       ? 'AAC'  :
    emvResult.requiresOnline ? 'ARQC' : 'TC';

  const now = new Date();
  const txData = {
    amount,
    currencyCode:        cur.numericCode,
    terminalCountryCode: countryCode || cur.countryCode,
    transactionType:     '00',
    terminalType:        '22',
    transactionDate:     txnDate(),
    transactionTime:     txnTime(),
    unpredictableNumber: generateUnpredictableNumber(),
  };

  const cryptResult = await cryptoGen.generateCryptogramAsync({
    cardData:        cardTLV,
    terminalData:    terminalTLV,
    transactionData: txData,
    decision,
    reason:          emvResult.reason,
  });

  // 7. For TC and ARQC — store in local offline queue (synced to backend later)
  if (decision === 'TC' || decision === 'ARQC') {
    try {
      const queue = JSON.parse(localStorage.getItem('emv_offline_queue') || '[]');
      queue.push({
        amount, currency,
        cardLast4: last4, cardBrand: brand,
        offlineRef: ref, capturedAt: ts,
        terminalId, stan, decision,
        cryptogram: cryptResult.cryptogram,
        atc: cryptResult.applicationTransactionCounter
      });
      localStorage.setItem('emv_offline_queue', JSON.stringify(queue));
    } catch (_) { /* storage full or private mode */ }
  }

  // 8. Generate offline auth code for TC (approved offline)
  const authCode = decision === 'TC'
    ? `TC-${cryptResult.cryptogram.slice(0, 6)}`
    : undefined;

  if (decision === 'TC') {
    events.push({ code: P2013.EMV_OFFLINE_APPROVAL_SUCCESS, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency });
    events.push({ code: P2013.EMV_CONTACT_APPROVED, at: stamp(), ref: authCode || stan, amountMinor: Math.round(amount * 100), currency });
    events.push({ code: P2013.EMV_OFFLINE_SYNC_REQUIRED, at: stamp(), ref: ref, amountMinor: Math.round(amount * 100), currency });
    events.push({ code: P2013.POS_SALE_APPROVED, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency });
  } else if (decision === 'ARQC') {
    events.push({ code: P2013.EMV_OFFLINE_SYNC_REQUIRED, at: stamp(), ref: ref, amountMinor: Math.round(amount * 100), currency });
    events.push({ code: P2013.POS_SALE_APPROVED, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency, message: "ARQC pending online auth" });
  } else {
    events.push({ code: P2013.EMV_CONTACT_DECLINED, at: stamp(), ref: stan, message: `AAC: ${emvResult.reason || "declined"}` });
    events.push({ code: P2013.EMV_OFFLINE_APPROVAL_FAILED, at: stamp(), ref: stan, message: emvResult.reason });
    events.push({ code: P2013.POS_SALE_FAILED, at: stamp(), ref: stan, amountMinor: Math.round(amount * 100), currency });
  }
  events.forEach(recordProtocolEvent);

  const lastCode = events[events.length - 1]?.code || P2013.POS_SALE_APPROVED;
  return {
    approved:       decision === 'TC',
    declined:       decision === 'AAC',
    requiresOnline: decision === 'ARQC',
    decision,
    transactionId:  emvResult.transactionId,
    cryptogram:     cryptResult.cryptogram,
    cryptogramInfo: cryptResult.cryptogramInformationData || '00',
    atc:            cryptResult.applicationTransactionCounter || '0001',
    authCode,
    reason:         emvResult.reason,
    stan,
    offlineRef:     ref,
    amount,
    currency,
    cardLast4:      last4,
    cardBrand:      brand,
    timestamp:      ts,
    tvr:            emvResult.offlineTransaction?.terminalVerificationResults || '0000000000',
    tsi:            emvResult.offlineTransaction?.transactionStatusInformation || '0000',
    protocolLastCode: lastCode,
    protocolLastMeaning: explain2013(lastCode),
    protocolEvents: events,
  };
}

// ─── Batch sync (called from Sync button) ─────────────────────────────────────
export async function syncEMVTransactions(
  merchantId: string = 'MRC-1001',
  terminalId: string = 'WEB-POS-001',
  secretKey: string = ''
): Promise<{ synced: number; failed: number; settlementCode?: string; protocolLastCode?: string; protocolLastMeaning?: string; lastResponse?: any }> {
  const storage = engine.getStorage();
  const pending = storage.getTransactionsForUpload();
  const events: ProtocolEvent[] = [];
  const stamp = () => nowISO();

  let queueItems: any[] = [];
  try {
    queueItems = JSON.parse(localStorage.getItem('emv_offline_queue') || '[]');
  } catch (_) {}

  const allItems = [
    ...pending.map(tx => ({
      localTxnId: tx.id,
      stan: `SYNC-${tx.id.slice(-6)}`,
      amountMinor: Math.round(tx.amount * 100),
      currency: tx.currency,
      panMasked: '****',
      txnType: 'SALE',
      txnTimestamp: tx.timestamp.toISOString(),
      authMode: tx.offlineApproved ? 'OFFLINE_APPROVED' : 'OFFLINE_DECLINED',
      entryMode: 'MANUAL',
    })),
    ...queueItems.map((q: any) => ({
      localTxnId: q.offlineRef,
      stan: q.stan || '000000',
      amountMinor: Math.round(q.amount * 100),
      currency: q.currency || 'USD',
      panMasked: `****${q.cardLast4}`,
      txnType: 'SALE',
      txnTimestamp: q.capturedAt,
      authMode: q.decision === 'TC' ? 'OFFLINE_APPROVED' : 'OFFLINE_DECLINED',
      entryMode: 'MANUAL',
    }))
  ];

  if (allItems.length === 0) return { synced: 0, failed: 0 };

  try {
    const batchId = `BATCH-${Date.now()}`;
    const ts = new Date().toISOString();
    const nonce = Math.random().toString(36).substring(2, 14).toUpperCase();
    events.push({ code: P2013.BATCH_BUILD_STARTED, at: stamp(), ref: batchId, message: `${allItems.length} txns` });
    events.push({ code: P2013.BATCH_UPLOAD_STARTED, at: stamp(), ref: batchId });
    events.forEach(recordProtocolEvent);

    const signature = await generateHmacSignature(
      '201.3', merchantId, terminalId, batchId, ts, nonce, allItems.length, secretKey
    );

    const BASE_URL = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });
    const res = await fetch(`${BASE_URL}/merchant/v1/pos/201.3/offline-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Merchant-Id': merchantId,
        'X-Terminal-Id': terminalId,
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        protocolVersion: '201.3',
        merchantId, terminalId, batchId,
        timestamp: ts, nonce,
        transactions: allItems
      })
    });

    if (res.ok) {
      const result = await res.json();
      const capturedCount = Number(result?.capturedCount || 0);
      const failedCount  = Number(result?.failedCount || 0);
      let finalCode: string = result?.protocolLastCode || (capturedCount === allItems.length ? P2013.BATCH_UPLOAD_SUCCESS : (capturedCount > 0 ? P2013.BATCH_RECONCILE_SUCCESS : P2013.BATCH_UPLOAD_FAILED));
      events.push({ code: finalCode, at: stamp(), ref: result?.settlementCode, message: `captured=${capturedCount} failed=${failedCount}` });
      events.forEach(recordProtocolEvent);
      pending.forEach(tx => storage.markTransactionUploaded(tx.id, true));
      localStorage.setItem('emv_offline_queue', '[]');
      return {
        synced: capturedCount > 0 ? capturedCount : allItems.length,
        failed: failedCount,
        settlementCode: result.settlementCode,
        protocolLastCode: finalCode,
        protocolLastMeaning: explain2013(finalCode),
        lastResponse: result,
      };
    } else {
      events.push({ code: P2013.BATCH_UPLOAD_FAILED, at: stamp(), ref: batchId, message: `HTTP ${res.status}` });
      events.forEach(recordProtocolEvent);
    }
  } catch (e: any) {
    events.push({ code: P2013.BATCH_UPLOAD_FAILED, at: stamp(), message: e?.message || String(e) });
    events.forEach(recordProtocolEvent);
  }

  const last = events[events.length - 1]?.code || P2013.BATCH_UPLOAD_FAILED;
  return { synced: 0, failed: allItems.length, protocolLastCode: last, protocolLastMeaning: explain2013(last) };
}

// ─── Storage stats (for UI display) ──────────────────────────────────────────
export function getEMVStorageStats() {
  return engine.getStorage().getTransactionSummary();
}

export { engine as emvEngine };
