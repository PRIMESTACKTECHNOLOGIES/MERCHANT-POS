import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

type AccountType = 'merchant' | 'customer' | 'internal';
type EntrySource = 'card_settlement' | 'bank_transfer' | 'adjustment' | 'payout';

function positiveAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('amount must be positive'), { code: 'VALIDATION_ERROR' });
  return amount;
}

function currency(value: unknown): string {
  const result = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw Object.assign(new Error('currency must be a three-letter ISO code'), { code: 'VALIDATION_ERROR' });
  return result;
}

function source(value: unknown): EntrySource {
  const result = String(value || '').trim() as EntrySource;
  if (!['card_settlement', 'bank_transfer', 'adjustment'].includes(result)) {
    throw Object.assign(new Error('source must be card_settlement, bank_transfer, or adjustment'), { code: 'VALIDATION_ERROR' });
  }
  return result;
}

async function account(id: string): Promise<any> {
  const result = await db.query('SELECT * FROM vault_accounts WHERE id = ? LIMIT 1', [id]);
  if (!result.rows?.[0]) throw Object.assign(new Error(`Vault account ${id} not found`), { code: 'ACCOUNT_NOT_FOUND' });
  return result.rows[0];
}

async function event(accountId: string, eventType: string, amount: number, ccy: string, reference: string, payoutId?: string) {
  await db.query(
    `INSERT INTO vault_events (id, account_id, payout_id, event_type, amount, currency, reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), accountId, payoutId || null, eventType, amount, ccy, reference, new Date().toISOString()],
  );
}

async function postEntry(input: {
  accountId: string;
  counterAccountId?: string | null;
  direction: 'credit' | 'debit';
  amount: number;
  currency: string;
  source: EntrySource;
  reference: string;
  groupId: string;
  metadata?: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO vault_entries
      (id, group_id, account_id, counter_account_id, direction, amount, currency, source, reference, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(), input.groupId, input.accountId, input.counterAccountId || null,
      input.direction, input.amount, input.currency, input.source, input.reference,
      JSON.stringify(input.metadata || {}), new Date().toISOString(),
    ],
  );
}

export async function createVaultAccount(input: {
  ownerId: string;
  type: AccountType;
  currency: string;
  bankName?: string;
  iban?: string;
  bic?: string;
}) {
  const ccy = currency(input.currency);
  if (!input.ownerId?.trim()) throw Object.assign(new Error('ownerId is required'), { code: 'VALIDATION_ERROR' });
  if (!['merchant', 'customer', 'internal'].includes(input.type)) {
    throw Object.assign(new Error('type must be merchant, customer, or internal'), { code: 'VALIDATION_ERROR' });
  }
  const id = `VA-${uuidv4()}`;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO vault_accounts
      (id, owner_id, type, status, bank_name, bic, iban, currency, balance, available_balance, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, 0, 0, ?, ?)`,
    [id, input.ownerId.trim(), input.type, input.bankName || 'Vault Settlement Bank', input.bic || null, input.iban || null, ccy, now, now],
  );
  return (await account(id));
}

export async function creditVaultAccount(input: {
  accountId: string;
  amount: number;
  currency: string;
  source: Exclude<EntrySource, 'payout'>;
  reference: string;
  holdType?: 'available' | 'pending_settlement' | 'risk_hold';
  metadata?: Record<string, unknown>;
}) {
  const amount = positiveAmount(input.amount);
  const ccy = currency(input.currency);
  const entrySource = source(input.source);
  const target = await account(input.accountId);
  if (target.status !== 'ACTIVE') throw Object.assign(new Error('Vault account is not active'), { code: 'INVALID_STATE' });
  if (String(target.currency).toUpperCase() !== ccy) throw Object.assign(new Error('Currency mismatch'), { code: 'VALIDATION_ERROR' });
  const clearingId = `VA-CLEARING-${ccy}`;
  const groupId = uuidv4();
  const now = new Date().toISOString();
  const holdType = input.holdType || 'available';
  const available = holdType === 'available' ? amount : 0;
  const pending = holdType === 'pending_settlement' ? amount : 0;
  const risk = holdType === 'risk_hold' ? amount : 0;

  await db.query('BEGIN IMMEDIATE');
  try {
    await postEntry({ accountId: input.accountId, counterAccountId: clearingId, direction: 'credit', amount, currency: ccy, source: entrySource, reference: input.reference, groupId, metadata: input.metadata });
    await postEntry({ accountId: clearingId, counterAccountId: input.accountId, direction: 'debit', amount, currency: ccy, source: entrySource, reference: input.reference, groupId, metadata: input.metadata });
    await db.query(
      `UPDATE vault_accounts
       SET balance = balance + ?, available_balance = available_balance + ?,
           pending_settlement = pending_settlement + ?, risk_hold = risk_hold + ?, updated_at = ?
       WHERE id = ?`,
      [amount, available, pending, risk, now, input.accountId],
    );
    await event(input.accountId, holdType === 'available' ? 'funds_received' : 'funds_held', amount, ccy, input.reference);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }

  return { accountId: input.accountId, amount, currency: ccy, reference: input.reference, holdType, status: 'POSTED' };
}

export async function listControlledAccounts(ownerId?: string, ccy?: string) {
  const params: string[] = [];
  const values: string[] = [];
  if (ownerId) { params.push('owner_id = ?'); values.push(ownerId); }
  if (ccy) { params.push('currency = ?'); values.push(currency(ccy)); }
  const result = await db.query(
    `SELECT id, owner_id, type, status, bank_name, bic, iban, currency,
            balance, available_balance, pending_settlement, risk_hold,
            payout_in_progress, last_reconciled, created_at, updated_at
       FROM vault_accounts
      ${params.length ? `WHERE ${params.join(' AND ')}` : ''}
      ORDER BY created_at ASC`,
    values,
  );
  return result.rows || [];
}

export async function getControlledReconciliation(accountId: string) {
  const target = await account(accountId);
  const entries = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS net_entries,
       COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits,
       COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS debits,
       COUNT(*) AS entry_count
     FROM vault_entries
     WHERE account_id = ? AND status = 'POSTED'`,
    [accountId],
  );
  const row = entries.rows?.[0] || {};
  const ledgerBalance = Number(row.net_entries || 0);
  const storedBalance = Number(target.balance || 0);
  return {
    accountId,
    currency: target.currency,
    storedBalance,
    ledgerBalance,
    difference: storedBalance - ledgerBalance,
    balanced: Math.abs(storedBalance - ledgerBalance) < 0.000001,
    credits: Number(row.credits || 0),
    debits: Number(row.debits || 0),
    entryCount: Number(row.entry_count || 0),
    holds: {
      pendingSettlement: Number(target.pending_settlement || 0),
      riskHold: Number(target.risk_hold || 0),
      payoutInProgress: Number(target.payout_in_progress || 0),
      available: Number(target.available_balance || 0),
    },
  };
}

export async function listControlledEntries(accountId: string, limit = 100) {
  await account(accountId);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await db.query(
    `SELECT * FROM vault_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [accountId],
  );
  return result.rows || [];
}

export async function listControlledEvents(accountId: string, limit = 100) {
  await account(accountId);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await db.query(
    `SELECT * FROM vault_events WHERE account_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [accountId],
  );
  return result.rows || [];
}

export async function createVaultPayout(input: {
  fromAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  beneficiary: Record<string, unknown>;
  channel?: 'MT103' | 'SEPA' | 'ACH' | 'RTGS' | 'WIRE';
}) {
  const amount = positiveAmount(input.amount);
  const ccy = currency(input.currency);
  const source = await account(input.fromAccountId);
  if (source.status !== 'ACTIVE') throw Object.assign(new Error('Vault account is not active'), { code: 'INVALID_STATE' });
  if (String(source.currency).toUpperCase() !== ccy) throw Object.assign(new Error('Currency mismatch'), { code: 'VALIDATION_ERROR' });
  if (Number(source.available_balance) < amount) throw Object.assign(new Error(`Insufficient available ${ccy} balance`), { code: 'NO_FUNDS' });
  if (!input.reference?.trim()) throw Object.assign(new Error('reference is required'), { code: 'VALIDATION_ERROR' });
  const maxPayout = Number(process.env.VAULT_MAX_PAYOUT_AMOUNT || 0);
  if (maxPayout > 0 && amount > maxPayout) throw Object.assign(new Error(`Payout exceeds configured maximum of ${maxPayout} ${ccy}`), { code: 'PAYOUT_LIMIT' });
  const id = `VP-${uuidv4()}`;
  const now = new Date().toISOString();
  const instruction = { channel: input.channel || 'WIRE', ...input.beneficiary };

  await db.query('BEGIN IMMEDIATE');
  try {
    await db.query(
      `UPDATE vault_accounts
       SET available_balance = available_balance - ?, payout_in_progress = payout_in_progress + ?, updated_at = ?
       WHERE id = ? AND available_balance >= ?`,
      [amount, amount, now, input.fromAccountId, amount],
    );
    const changed = await db.query('SELECT changes() AS count');
    if (Number(changed.rows?.[0]?.count || 0) !== 1) throw Object.assign(new Error(`Insufficient available ${ccy} balance`), { code: 'NO_FUNDS' });
    await db.query(
      `INSERT INTO vault_payout_requests
       (id, from_account_id, beneficiary_snapshot, amount, currency, reference, status, bank_instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [id, input.fromAccountId, JSON.stringify(input.beneficiary), amount, ccy, input.reference.trim(), JSON.stringify(instruction), now, now],
    );
    await event(input.fromAccountId, 'payout_requested', amount, ccy, input.reference, id);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
  return { id, status: 'PENDING', fromAccountId: input.fromAccountId, amount, currency: ccy, reference: input.reference, bankInstruction: instruction };
}

export async function failVaultPayout(id: string, errorMessage: string) {
  const result = await db.query('SELECT * FROM vault_payout_requests WHERE id = ? LIMIT 1', [id]);
  const payout = result.rows?.[0];
  if (!payout) throw Object.assign(new Error('Payout not found'), { code: 'NOT_FOUND' });
  if (payout.status !== 'PENDING') throw Object.assign(new Error(`Payout is already ${payout.status}`), { code: 'INVALID_STATE' });
  const now = new Date().toISOString();
  await db.query('BEGIN IMMEDIATE');
  try {
    await db.query(
      `UPDATE vault_accounts
       SET available_balance = available_balance + ?, payout_in_progress = payout_in_progress - ?, updated_at = ?
       WHERE id = ?`,
      [Number(payout.amount), Number(payout.amount), now, payout.from_account_id],
    );
    await db.query(
      `UPDATE vault_payout_requests SET status = 'FAILED', error_message = ?, updated_at = ? WHERE id = ?`,
      [errorMessage || 'Bank payout failed', now, id],
    );
    await event(payout.from_account_id, 'payout_failed', Number(payout.amount), payout.currency, payout.reference, id);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
  return (await db.query('SELECT * FROM vault_payout_requests WHERE id = ?', [id])).rows[0];
}

export async function confirmVaultPayout(id: string, externalReference: string) {
  const result = await db.query('SELECT * FROM vault_payout_requests WHERE id = ? LIMIT 1', [id]);
  const payout = result.rows?.[0];
  if (!payout) throw Object.assign(new Error('Payout not found'), { code: 'NOT_FOUND' });
  if (payout.status !== 'PENDING') throw Object.assign(new Error(`Payout is already ${payout.status}`), { code: 'INVALID_STATE' });
  const now = new Date().toISOString();
  const groupId = uuidv4();
  await db.query('BEGIN IMMEDIATE');
  try {
    await postEntry({ accountId: payout.from_account_id, counterAccountId: `VA-OUTGOING-${payout.currency}`, direction: 'debit', amount: Number(payout.amount), currency: payout.currency, source: 'payout', reference: payout.reference, groupId, metadata: { payoutId: id, externalReference } });
    await postEntry({ accountId: `VA-OUTGOING-${payout.currency}`, counterAccountId: payout.from_account_id, direction: 'credit', amount: Number(payout.amount), currency: payout.currency, source: 'payout', reference: payout.reference, groupId, metadata: { payoutId: id, externalReference } });
    await db.query(
      `UPDATE vault_accounts SET balance = balance - ?, payout_in_progress = payout_in_progress - ?, updated_at = ? WHERE id = ?`,
      [Number(payout.amount), Number(payout.amount), now, payout.from_account_id],
    );
    await db.query(
      `UPDATE vault_payout_requests SET status = 'COMPLETED', external_reference = ?, confirmed_at = ?, updated_at = ? WHERE id = ?`,
      [externalReference, now, now, id],
    );
    await event(payout.from_account_id, 'payout_sent', Number(payout.amount), payout.currency, payout.reference, id);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
  return (await db.query('SELECT * FROM vault_payout_requests WHERE id = ?', [id])).rows[0];
}
