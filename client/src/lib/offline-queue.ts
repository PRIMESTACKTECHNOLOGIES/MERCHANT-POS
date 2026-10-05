/**
 * offline-queue.ts
 * ────────────────
 * Persistent offline operation queue using localStorage.
 * When the device is offline, operations are queued here.
 * When back online, they are replayed in order.
 *
 * Supports:
 *  - wallet_debit       (POS payment from wallet)
 *  - wallet_transfer    (wallet to wallet)
 *  - pos_transaction    (EMV card transaction)
 */

import { loadSecureQueue, saveSecureQueue } from './offline/secure-storage';
import { createSignedQueueItem } from './offline/signed-queue';
import { rememberIdempotencyKey } from './offline/idempotency';

export type OfflineOpType =
  | 'wallet_debit'
  | 'wallet_transfer'
  | 'pos_transaction'
  | 'wallet_topup_card';

export interface OfflineOpPayloads {
  wallet_debit: {
    customerId: string;
    amount: number;
    source?: string;
  };
  wallet_transfer: {
    senderCustomerId: string;
    receiverCustomerId: string;
    amount: number;
    note?: string;
  };
  pos_transaction: Record<string, unknown>;
  wallet_topup_card: {
    customerId: string;
    amount: number;
    cardNumber: string;
    panMasked: string;
    expiry: string;
    cvv: string;
    emvData?: unknown;
  };
}

interface OfflineOpBase {
  id:         string;
  createdAt:  string;
  attempts:   number;
  synced:     boolean;
  error?:     string;
  signature?: string;
  signedAt?:  string;
}

export type OfflineOp = {
  [T in OfflineOpType]: OfflineOpBase & {
    type: T;
    payload: OfflineOpPayloads[T];
  };
}[OfflineOpType];

export type OfflineOpFor<T extends OfflineOpType> = OfflineOpBase & {
  type: T;
  payload: OfflineOpPayloads[T];
};

const KEY = 'pos_offline_ops';

function load(): OfflineOp[] {
  try {
    const queue = loadSecureQueue<OfflineOp[]>(KEY);
    if (queue) return queue;
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch { return []; }
}

function save(ops: OfflineOp[]) {
  saveSecureQueue(KEY, ops);
  localStorage.setItem(KEY, JSON.stringify(ops));
}

/** Enqueue an offline operation */
export function enqueue<T extends OfflineOpType>(type: T, payload: OfflineOpPayloads[T]): OfflineOpFor<T> {
  const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const op: OfflineOpFor<T> = {
    id:        opId,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts:  0,
    synced:    false,
  };
  const signed = createSignedQueueItem(type, { ...payload, opId });
  if (!rememberIdempotencyKey(signed.id)) {
    throw new Error('Duplicate offline operation detected');
  }
  op.signature = signed.signature;
  op.signedAt = signed.createdAt;
  const ops = load();
  ops.push(op as OfflineOp);
  save(ops);
  console.log(`[OfflineQueue] Queued ${type}:`, payload);
  return op;
}

/** Get all pending (un-synced) ops */
export function getPending(): OfflineOp[] {
  return load().filter(op => !op.synced);
}

/** Get all ops (for display) */
export function getAll(): OfflineOp[] {
  return load();
}

/** Mark an op as synced */
export function markSynced(id: string) {
  const ops = load();
  const op = ops.find(o => o.id === id);
  if (op) { op.synced = true; save(ops); }
}

/** Mark an op as failed */
export function markFailed(id: string, error: string) {
  const ops = load();
  const op = ops.find(o => o.id === id);
  if (op) { op.attempts++; op.error = error; save(ops); }
}

/** Count pending ops */
export function pendingCount(): number {
  return getPending().length;
}

/** Clear all synced ops */
export function clearSynced() {
  save(load().filter(op => !op.synced));
}

// ── Offline wallet ledger (local balance cache) ────────────────────────────────
// Stores last known balance per customer so the UI works offline.

const LEDGER_KEY = 'pos_offline_ledger';

interface LedgerEntry {
  customerId: string;
  balance:    number;
  currency:   string;
  updatedAt:  string;
}

function loadLedger(): LedgerEntry[] {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); }
  catch { return []; }
}

/** Cache the last known wallet balance */
export function cacheBalance(customerId: string, balance: number, currency: string) {
  const ledger = loadLedger().filter(e => e.customerId !== customerId);
  ledger.push({ customerId, balance, currency, updatedAt: new Date().toISOString() });
  localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

/** Get cached balance (used when offline) */
export function getCachedBalance(customerId: string): { balance: number; currency: string } | null {
  const entry = loadLedger().find(e => e.customerId === customerId);
  return entry ? { balance: entry.balance, currency: entry.currency } : null;
}

/** Apply a local debit/credit to cached balance (optimistic update) */
export function applyLocalBalance(customerId: string, delta: number) {
  const ledger = loadLedger();
  const entry = ledger.find(e => e.customerId === customerId);
  if (entry) {
    entry.balance = Math.max(0, entry.balance + delta);
    entry.updatedAt = new Date().toISOString();
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  }
}
