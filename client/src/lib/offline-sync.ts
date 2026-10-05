/**
 * offline-sync.ts
 * ───────────────
 * Replays all queued offline operations when connectivity returns.
 * Called automatically on window 'online' event and on page load.
 */

import {
  getPending, markSynced, markFailed, clearSynced, cacheBalance,
  type OfflineOp
} from './offline-queue';
import { verifySignedQueueItem } from './offline/signed-queue';
import {
  debitWallet, walletTransfer, topupWalletWithCard,
  getWalletBalance
} from './api';

export interface SyncResult {
  synced:  number;
  failed:  number;
  errors:  string[];
}

let syncing = false;

/**
 * Replay all pending offline operations in order.
 * Returns summary of what was synced vs failed.
 */
export async function replayOfflineOps(): Promise<SyncResult> {
  if (syncing) return { synced: 0, failed: 0, errors: [] };
  syncing = true;

  const pending = getPending();
  if (pending.length === 0) {
    syncing = false;
    return { synced: 0, failed: 0, errors: [] };
  }

  console.log(`[OfflineSync] Replaying ${pending.length} queued operation(s)...`);

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const op of pending) {
    try {
      const signedItem = {
        id: op.id,
        type: op.type,
        payload: op.payload,
        signature: op.signature || '',
        createdAt: op.signedAt || op.createdAt,
      };
      if (!verifySignedQueueItem(signedItem)) {
        throw new Error('Offline queue signature mismatch');
      }
      await replayOp(op);
      markSynced(op.id);
      synced++;
      console.log(`[OfflineSync] ✅ ${op.type} synced (${op.id})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      markFailed(op.id, msg);
      failed++;
      errors.push(`${op.type}: ${msg}`);
      console.warn(`[OfflineSync] ❌ ${op.type} failed: ${msg}`);
    }
  }

  // Refresh cached balances for all affected customers
  const customerIds = [...new Set(pending
    .flatMap(op => {
      const customerId = 'customerId' in op.payload ? op.payload.customerId : undefined;
      return typeof customerId === 'string' ? [customerId] : [];
    })
  )];

  for (const customerId of customerIds) {
    try {
      const bal = await getWalletBalance(customerId);
      cacheBalance(customerId, Number(bal.balance), bal.currency);
    } catch {
      // Leave the queue intact if this best-effort cleanup cannot run.
    }
  }

  clearSynced();
  syncing = false;

  console.log(`[OfflineSync] Done — synced: ${synced}, failed: ${failed}`);
  return { synced, failed, errors };
}

async function replayOp(op: OfflineOp): Promise<void> {
  switch (op.type) {
    case 'wallet_debit':
      {
      const p = op.payload;
      await debitWallet(p.customerId, p.amount, p.source || 'offline_pos');
      break;
      }

    case 'wallet_transfer':
      {
      const p = op.payload;
      await walletTransfer(p.senderCustomerId, p.receiverCustomerId, p.amount, p.note);
      break;
      }

    case 'wallet_topup_card':
      {
      const p = op.payload;
      await topupWalletWithCard(
        p.customerId,
        p.amount,
        p.cardNumber,
        p.panMasked,
        p.expiry,
        p.cvv,
        p.emvData
      );
      break;
      }

    case 'pos_transaction':
      // POS transactions are synced via the Protocol 201.3 batch — handled by syncEMVTransactions()
      // Nothing to do here; just mark as synced
      break;

    default:
      throw new Error(`Unknown op type: ${String((op as { type: unknown }).type)}`);
  }
}

/**
 * Register auto-sync on window.online event.
 * Call this once at app startup.
 */
export function registerAutoSync(onComplete?: (result: SyncResult) => void) {
  window.addEventListener('online', async () => {
    console.log('[OfflineSync] Back online — starting sync...');
    const result = await replayOfflineOps();
    if (onComplete) onComplete(result);
  });

  // Also try syncing on page load (in case there are stale ops)
  if (navigator.onLine) {
    replayOfflineOps().then(result => {
      if (result.synced > 0 && onComplete) onComplete(result);
    });
  }
}
