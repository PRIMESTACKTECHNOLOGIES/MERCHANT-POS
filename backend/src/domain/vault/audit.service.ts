import crypto from 'crypto';
import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

export type VaultAuditEvent =
  | 'LEDGER_CREDIT' | 'LEDGER_DEBIT' | 'RESERVE_CREATE' | 'RESERVE_RELEASE'
  | 'PAYOUT_EXECUTE' | 'BATCH_SETTLE' | 'WALLET_CREDIT' | 'WALLET_DEBIT'
  | 'LIQUIDITY_CHECK' | 'RECON_CHECK';

export interface VaultAuditInput {
  actor: string;
  event: VaultAuditEvent;
  merchantId?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  before?: object;
  after?: object;
  meta?: object;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.keys(item).sort().reduce((out, key) => {
      out[key] = item[key];
      return out;
    }, {} as Record<string, unknown>);
  });
}

export async function appendVaultAudit(input: VaultAuditInput) {
  const ts = new Date().toISOString();
  const previous = await db.query(`SELECT hash FROM vault_audit_trail ORDER BY rowid DESC LIMIT 1`);
  const prevHash = previous.rows?.[0]?.hash || null;
  const payload = {
    actor: input.actor,
    event: input.event,
    merchant_id: input.merchantId || null,
    amount: input.amount ?? null,
    currency: input.currency || null,
    reference: input.reference || null,
    before: input.before || {},
    after: input.after || {},
    meta: input.meta || {},
    ts,
    prev_hash: prevHash,
  };
  const hash = crypto.createHash('sha256').update(canonical(payload)).digest('hex');
  const id = uuidv4();
  await db.query(
    `INSERT INTO vault_audit_trail
      (id, ts, actor, event, merchant_id, amount, currency, reference, before_json, after_json, meta_json, hash, prev_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ts, payload.actor, payload.event, payload.merchant_id, payload.amount,
      payload.currency, payload.reference, canonical(payload.before), canonical(payload.after),
      canonical(payload.meta), hash, prevHash,
    ]
  );
  return { id, ...payload, hash };
}

function mapAudit(row: any) {
  return {
    ...row,
    amount: row.amount == null ? null : Number(row.amount),
    before: JSON.parse(row.before_json || '{}'),
    after: JSON.parse(row.after_json || '{}'),
    meta: JSON.parse(row.meta_json || '{}'),
  };
}

export async function listVaultAudit(filters: {
  event?: string; merchantId?: string; limit?: number; offset?: number;
} = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.event) { clauses.push('event = ?'); params.push(filters.event); }
  if (filters.merchantId) { clauses.push('merchant_id = ?'); params.push(filters.merchantId); }
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const result = await db.query(
    `SELECT * FROM vault_audit_trail
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return (result.rows || []).map(mapAudit);
}

export async function getVaultAudit(id: string) {
  const result = await db.query('SELECT * FROM vault_audit_trail WHERE id = ? LIMIT 1', [id]);
  return result.rows?.[0] ? mapAudit(result.rows[0]) : null;
}

export async function verifyVaultAuditChain() {
  const result = await db.query('SELECT * FROM vault_audit_trail ORDER BY rowid ASC');
  let previousHash: string | null = null;
  for (const row of result.rows || []) {
    const payload = {
      actor: row.actor,
      event: row.event,
      merchant_id: row.merchant_id || null,
      amount: row.amount ?? null,
      currency: row.currency || null,
      reference: row.reference || null,
      before: JSON.parse(row.before_json || '{}'),
      after: JSON.parse(row.after_json || '{}'),
      meta: JSON.parse(row.meta_json || '{}'),
      ts: row.ts,
      prev_hash: previousHash,
    };
    const expectedHash = crypto.createHash('sha256').update(canonical(payload)).digest('hex');
    if (row.prev_hash !== previousHash || row.hash !== expectedHash) {
      return { status: 'BROKEN' as const, checked: result.rows.length, brokenId: row.id };
    }
    previousHash = row.hash;
  }
  return { status: 'OK' as const, checked: (result.rows || []).length, brokenId: null };
}
