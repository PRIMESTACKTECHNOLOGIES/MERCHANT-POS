import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { createLedgerEntry, persistLedgerEntry } from '../domain/ledger/ledger.service';

export type PosLedgerEvent =
  | 'POS_SALE'
  | 'ISSUER_AUTH'
  | 'BRIDGE_SETTLEMENT'
  | 'PAYOUT'
  | 'POS_1011_PIPELINE_COMPLETE'
  | 'GLOBAL_BALANCE_CHECK'
  | 'GLOBAL_SETTLEMENT';

export async function recordPosLedgerEvent(
  event: PosLedgerEvent,
  amountMinor: number,
  currency: string,
  meta: Record<string, unknown>,
  transactionId: string,
) {
  const type = event === 'PAYOUT' ? 'debit' : 'credit';
  const status = event === 'ISSUER_AUTH'
    ? 'AUTHORIZED'
    : event === 'BRIDGE_SETTLEMENT' || event === 'PAYOUT' || event === 'GLOBAL_SETTLEMENT'
      ? 'SETTLED'
      : 'PENDING';
  const entry = createLedgerEntry(
    uuidv4(),
    type,
    amountMinor / 100,
    currency,
    status,
    `POS 101.1 ${event}`,
    undefined,
    'pos',
    transactionId,
    'POS_101_1',
    event,
  );
  await persistLedgerEntry(entry, db.query.bind(db));
  await db.query(
    `INSERT INTO pos1011_events (id,tx_id,event_type,amount_minor,currency,status,meta_json,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [entry.id, transactionId, event, amountMinor, currency, status, JSON.stringify(meta), entry.createdAt],
  );
  return { ...entry, meta };
}
