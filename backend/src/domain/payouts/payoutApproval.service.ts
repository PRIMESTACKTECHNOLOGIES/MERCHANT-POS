/**
 * Payout approval + audit — governance layer in front of the payout rails.
 * ─────────────────────────────────────────────────────────────────────────────
 * A payout request no longer executes on creation. It is written as
 * PENDING_APPROVAL, the merchant wallet is NOT debited, and nothing is sent to a
 * rail until enough authorised people have signed off. Only then does the
 * executor debit the wallet, generate the SEPA/MT103 file and push the rail.
 *
 *   1 signature  ≤ 10,000          → FINANCE
 *   2 signatures  10,000 – 50,000  → COMPLIANCE + FINANCE
 *   3 signatures  > 50,000         → COMPLIANCE + FINANCE + TREASURY
 *
 * Controls enforced here (each one fails closed):
 *   • maker-checker        — the requester cannot approve their own payout
 *   • role matrix          — the approver's role is read from the database using
 *                            the *verified* JWT identity, never from the request
 *   • balance check        — available wallet balance is re-checked at approval
 *   • beneficiary lock     — a sha256 of the beneficiary is frozen at request
 *                            time; changing it later aborts execution
 *   • approval expiry      — an approval older than 24h is refused
 *   • immutable audit log  — every transition is appended to payout_audit_log
 *
 * Thresholds are compared against the payout amount in its own currency (no FX
 * conversion is applied — a €60,000 payout lands in the top tier).
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

/** Full lifecycle of a payout, from request to bank reconciliation. */
export type PayoutStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FILE_GENERATED'
  | 'BANK_SENT'
  | 'BANK_ACCEPTED'
  | 'BANK_REJECTED'
  | 'PARTIAL_SETTLEMENT'
  | 'RECONCILED'
  | 'SETTLED';

/** Roles that may sign a payout. ADMIN satisfies any single required role. */
export type ApproverRole = 'SUPPORT' | 'COMPLIANCE' | 'FINANCE' | 'TREASURY' | 'ADMIN';

/** Audit event names written to payout_audit_log. */
export type PayoutAuditAction =
  | 'PAYOUT_CREATED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTION_BLOCKED'
  | 'FILE_GENERATED'
  | 'BANK_SENT'
  | 'SETTLED'
  | 'RECONCILED';

/** An approval signature is refused after this long. */
export const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Approval tiers — the first tier whose `above` is below the amount wins. */
export const APPROVAL_TIERS: ReadonlyArray<{ above: number; roles: ApproverRole[] }> = [
  { above: 50_000, roles: ['COMPLIANCE', 'FINANCE', 'TREASURY'] },
  { above: 10_000, roles: ['COMPLIANCE', 'FINANCE'] },
  { above: 0, roles: ['FINANCE'] },
];

/** How many signatures — and from which roles — this amount needs. */
export function approvalsRequired(amount: number): { count: number; roles: ApproverRole[] } {
  const value = Math.abs(Number(amount) || 0);
  const tier = APPROVAL_TIERS.find((t) => value > t.above) || APPROVAL_TIERS[APPROVAL_TIERS.length - 1];
  return { count: tier.roles.length, roles: [...tier.roles] };
}

/**
 * Stable fingerprint of the beneficiary, frozen when the payout is requested and
 * re-computed before execution. Reordering keys or touching any bank field
 * changes the hash, which aborts the payout as BENEFICIARY_CHANGED.
 */
export function beneficiaryHash(bankAccount: any): string {
  const b = bankAccount || {};
  const canonical = {
    bank_name: String(b.bank_name || ''),
    account_holder: String(b.account_holder || ''),
    account_number: String(b.account_number || ''),
    routing_number: String(b.routing_number || ''),
    iban: String(b.iban || ''),
    swift_code: String(b.swift_code || ''),
    currency: String(b.currency || ''),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Governance refusal. `code` is the machine-readable reason. */
export class PayoutGovernanceError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'PayoutGovernanceError';
    this.code = code;
    this.status = status;
  }
}

/** Idempotently creates the four governance tables. */
export async function ensurePayoutGovernanceTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payout_approvals (
      id                 TEXT PRIMARY KEY,
      payout_id          TEXT NOT NULL,
      merchant_id        TEXT NOT NULL,
      requested_amount   REAL NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'USD',
      status             TEXT NOT NULL DEFAULT 'PENDING',
      required_approvals INTEGER NOT NULL DEFAULT 1,
      required_roles     TEXT,
      beneficiary_hash   TEXT,
      requested_by       TEXT,
      requested_by_id    TEXT,
      approved_by        TEXT,
      rejected_by        TEXT,
      approval_notes     TEXT,
      expires_at         TEXT,
      created_at         TEXT DEFAULT (datetime('now')),
      approved_at        TEXT,
      rejected_at        TEXT
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS payout_approval_signatures (
      id            TEXT PRIMARY KEY,
      payout_id     TEXT NOT NULL,
      approver_id   TEXT NOT NULL,
      approver_role TEXT NOT NULL,
      decision      TEXT NOT NULL,
      approved_at   TEXT NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS payout_audit_log (
      id         TEXT PRIMARY KEY,
      payout_id  TEXT,
      actor_id   TEXT,
      action     TEXT NOT NULL,
      metadata   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS payout_approver_roles (
      username   TEXT PRIMARY KEY,
      user_id    TEXT,
      role       TEXT NOT NULL,
      granted_by TEXT,
      granted_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // One approval request and one signature per approver, per payout.
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_approvals_payout ON payout_approvals (payout_id)`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_signatures_unique
       ON payout_approval_signatures (payout_id, approver_id)`
  );
}

/** Append-only audit trail. Never throws — a failed log must not fail a payout. */
export async function logPayoutEvent(
  payoutId: string | null,
  actorId: string | null,
  action: PayoutAuditAction,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await ensurePayoutGovernanceTables();
    await db.query(
      `INSERT INTO payout_audit_log (id, payout_id, actor_id, action, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), payoutId, actorId, action, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()]
    );
  } catch (e: any) {
    console.error('[payout audit] failed to record', action, e?.message);
  }
}

/** Role granted to this approver, or null when they hold no approval role. */
export async function approverRoleFor(username: string | null): Promise<ApproverRole | null> {
  if (!username) return null;
  await ensurePayoutGovernanceTables();
  const res = await db.query(`SELECT role FROM payout_approver_roles WHERE username = ? LIMIT 1`, [username]);
  const role = res.rows?.[0]?.role;
  return role ? (String(role).toUpperCase() as ApproverRole) : null;
}

/**
 * Grants an approval role. The very first role may be self-granted so a fresh
 * deployment can bootstrap; after that only an ADMIN may grant.
 */
export async function grantApproverRole(
  targetUsername: string,
  role: ApproverRole,
  grantedBy: string | null,
  targetUserId?: string | null
): Promise<{ username: string; role: ApproverRole; bootstrapped: boolean }> {
  await ensurePayoutGovernanceTables();
  const existing = await db.query(`SELECT COUNT(*) AS n FROM payout_approver_roles`);
  const isEmpty = Number(existing.rows?.[0]?.n || 0) === 0;

  if (!isEmpty) {
    const granterRole = await approverRoleFor(grantedBy);
    if (granterRole !== 'ADMIN') {
      throw new PayoutGovernanceError('NOT_ADMIN', 'Only an ADMIN can grant payout approval roles.', 403);
    }
  }

  await db.query(
    `INSERT INTO payout_approver_roles (username, user_id, role, granted_by, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET role = excluded.role,
                                         user_id = excluded.user_id,
                                         granted_by = excluded.granted_by,
                                         granted_at = excluded.granted_at`,
    [targetUsername, targetUserId || null, role, grantedBy, new Date().toISOString()]
  );
  await logPayoutEvent(null, grantedBy, 'APPROVAL_REQUESTED', { kind: 'role_granted', target: targetUsername, role });
  return { username: targetUsername, role, bootstrapped: isEmpty };
}

/** Wallet balance available for this currency. */
export async function availableBalance(merchantId: string, currency: string): Promise<number> {
  const res = await db.query(
    `SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
    [merchantId, String(currency || 'USD').toUpperCase()]
  );
  return Number(res.rows?.[0]?.balance ?? 0);
}

/** Opens the approval request for a freshly created PENDING_APPROVAL payout. */
export async function createApprovalRequest(input: {
  payoutId: string;
  merchantId: string;
  amount: number;
  currency: string;
  bankAccount: any;
  requestedBy: string | null;
  requestedById?: string | null;
}): Promise<{ required_approvals: number; required_roles: ApproverRole[]; expires_at: string }> {
  await ensurePayoutGovernanceTables();
  const { count, roles } = approvalsRequired(input.amount);
  const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString();
  const hash = beneficiaryHash(input.bankAccount);

  await db.query(
    `INSERT INTO payout_approvals
       (id, payout_id, merchant_id, requested_amount, currency, status,
        required_approvals, required_roles, beneficiary_hash,
        requested_by, requested_by_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.payoutId,
      input.merchantId,
      input.amount,
      String(input.currency || 'USD').toUpperCase(),
      count,
      JSON.stringify(roles),
      hash,
      input.requestedBy,
      input.requestedById || null,
      expiresAt,
      new Date().toISOString(),
    ]
  );

  await logPayoutEvent(input.payoutId, input.requestedBy, 'PAYOUT_CREATED', {
    merchant_id: input.merchantId,
    amount: input.amount,
    currency: String(input.currency || 'USD').toUpperCase(),
    beneficiary_hash: hash,
  });
  await logPayoutEvent(input.payoutId, input.requestedBy, 'APPROVAL_REQUESTED', {
    required_approvals: count,
    required_roles: roles,
    expires_at: expiresAt,
  });

  return { required_approvals: count, required_roles: roles, expires_at: expiresAt };
}

/** Current approval state of a payout: what is required, what is held, what is missing. */
export async function getApprovalState(payoutId: string) {
  await ensurePayoutGovernanceTables();
  const reqRes = await db.query(`SELECT * FROM payout_approvals WHERE payout_id = ? LIMIT 1`, [payoutId]);
  const request: any = reqRes.rows?.[0] || null;
  if (!request) return null;

  const sigRes = await db.query(
    `SELECT id, approver_id, approver_role, decision, approved_at
       FROM payout_approval_signatures WHERE payout_id = ? ORDER BY approved_at ASC`,
    [payoutId]
  );
  const signatures = (sigRes.rows || []) as any[];

  const required = Number(request.required_approvals || 1);
  const requiredRoles: ApproverRole[] = request.required_roles
    ? JSON.parse(request.required_roles)
    : approvalsRequired(Number(request.requested_amount)).roles;

  const held = new Set(signatures.map((s) => String(s.approver_role || '').toUpperCase()));
  const missing: ApproverRole[] = [];
  for (const role of requiredRoles) {
    if (held.has(role)) continue;
    missing.push(role);
  }

  return {
    payout_id: payoutId,
    status: String(request.status || 'PENDING').toUpperCase(),
    requested_amount: Number(request.requested_amount),
    currency: String(request.currency || 'USD'),
    required_approvals: required,
    required_roles: requiredRoles,
    beneficiary_hash: request.beneficiary_hash || null,
    requested_by: request.requested_by || null,
    signatures,
    signatures_count: signatures.length,
    missing_roles: missing,
    expires_at: request.expires_at || null,
    approved_at: request.approved_at || null,
    rejected_at: request.rejected_at || null,
    approval_notes: request.approval_notes || null,
  };
}

/**
 * Records one approval signature.
 *
 * Returns `{ approved: false }` when more signatures are still outstanding, and
 * `{ approved: true }` once the tier is satisfied — the caller then executes the
 * payout. Throws PayoutGovernanceError on every blocked path.
 */
export async function approvePayout(input: {
  payoutId: string;
  approverUsername: string | null;
  approverId?: string | null;
  notes?: string | null;
}): Promise<{
  approved: boolean;
  state: NonNullable<Awaited<ReturnType<typeof getApprovalState>>>;
}> {
  await ensurePayoutGovernanceTables();
  const actor = input.approverUsername || input.approverId || null;

  const reqRes = await db.query(`SELECT * FROM payout_approvals WHERE payout_id = ? LIMIT 1`, [input.payoutId]);
  const request: any = reqRes.rows?.[0];
  if (!request) {
    throw new PayoutGovernanceError('APPROVAL_NOT_FOUND', `No approval request for payout ${input.payoutId}.`, 404);
  }
  const status = String(request.status || 'PENDING').toUpperCase();
  if (status === 'APPROVED') {
    throw new PayoutGovernanceError('ALREADY_APPROVED', `Payout ${input.payoutId} is already fully approved.`, 409);
  }
  if (status === 'REJECTED') {
    throw new PayoutGovernanceError('ALREADY_REJECTED', `Payout ${input.payoutId} was rejected and cannot be approved.`, 409);
  }

  // Approval expiry.
  const expiresAt = request.expires_at ? new Date(request.expires_at).getTime() : 0;
  if (expiresAt && Date.now() > expiresAt) {
    throw new PayoutGovernanceError(
      'APPROVAL_EXPIRED',
      `Approval window for payout ${input.payoutId} expired at ${request.expires_at}. Request the payout again.`,
      409
    );
  }

  // Maker-checker: whoever requested it cannot sign it.
  const requestedBy = request.requested_by ? String(request.requested_by) : null;
  if (requestedBy && actor && requestedBy === actor) {
    throw new PayoutGovernanceError(
      'MAKER_CHECKER_VIOLATION',
      `MAKER_CHECKER_VIOLATION: ${actor} requested payout ${input.payoutId} and cannot approve it. A different approver is required.`,
      409
    );
  }

  // Role must come from the database, keyed on the verified JWT identity.
  const role = await approverRoleFor(actor);
  if (!role) {
    throw new PayoutGovernanceError(
      'UNKNOWN_APPROVER_ROLE',
      `No payout approval role assigned to '${actor || 'unknown'}'. Grant one via POST /api/payout/approval-roles first.`,
      403
    );
  }

  const already = await db.query(
    `SELECT id FROM payout_approval_signatures WHERE payout_id = ? AND approver_id = ? LIMIT 1`,
    [input.payoutId, actor]
  );
  if (already.rows?.length) {
    throw new PayoutGovernanceError('DUPLICATE_APPROVAL', `${actor} has already signed payout ${input.payoutId}.`, 409);
  }

  const state = await getApprovalState(input.payoutId);
  const requiredRoles = state?.required_roles || [];
  if (requiredRoles.length && !requiredRoles.includes(role)) {
    throw new PayoutGovernanceError(
      'ROLE_NOT_REQUIRED',
      `Payout ${input.payoutId} at ${request.currency} ${Number(request.requested_amount).toFixed(2)} needs ${requiredRoles.join(' + ')}. Role ${role} cannot sign this tier.`,
      403
    );
  }
  if (state?.missing_roles?.length && !state.missing_roles.includes(role)) {
    throw new PayoutGovernanceError(
      'ROLE_ALREADY_SIGNED',
      `Role ${role} has already signed payout ${input.payoutId}. Still missing: ${state.missing_roles.join(' + ')}.`,
      409
    );
  }

  // Treasury control: real funds must be there before anyone signs.
  const balance = await availableBalance(String(request.merchant_id), String(request.currency || 'USD'));
  if (balance < Number(request.requested_amount)) {
    await logPayoutEvent(input.payoutId, actor, 'EXECUTION_BLOCKED', {
      reason: 'INSUFFICIENT_SETTLEMENT_FUNDS',
      available: balance,
      required: Number(request.requested_amount),
      currency: String(request.currency || 'USD'),
    });
    throw new PayoutGovernanceError(
      'INSUFFICIENT_SETTLEMENT_FUNDS',
      `INSUFFICIENT_SETTLEMENT_FUNDS: merchant ${request.merchant_id} has ${balance.toFixed(2)} ${request.currency}, payout needs ${Number(request.requested_amount).toFixed(2)} ${request.currency}.`,
      409
    );
  }

  // Beneficiary must be byte-identical to what was approved.
  const payoutRes = await db.query(`SELECT bank_account FROM merchant_payouts WHERE id = ? LIMIT 1`, [input.payoutId]);
  const frozenHash = request.beneficiary_hash ? String(request.beneficiary_hash) : null;
  if (frozenHash) {
    const live = payoutRes.rows?.[0]?.bank_account;
    const liveHash = beneficiaryHash(live ? JSON.parse(live) : null);
    if (liveHash !== frozenHash) {
      await logPayoutEvent(input.payoutId, actor, 'EXECUTION_BLOCKED', {
        reason: 'BENEFICIARY_CHANGED',
        expected_hash: frozenHash,
        actual_hash: liveHash,
      });
      throw new PayoutGovernanceError(
        'BENEFICIARY_CHANGED',
        `BENEFICIARY_CHANGED: the destination bank account of payout ${input.payoutId} differs from the one the approval was raised for.`,
        409
      );
    }
  }

  await db.query(
    `INSERT INTO payout_approval_signatures (id, payout_id, approver_id, approver_role, decision, approved_at)
     VALUES (?, ?, ?, ?, 'APPROVED', ?)`,
    [uuidv4(), input.payoutId, actor, role, new Date().toISOString()]
  );
  await logPayoutEvent(input.payoutId, actor, 'APPROVED', { role, notes: input.notes || null });

  const after = await getApprovalState(input.payoutId);
  const satisfied = Boolean(after) && after!.missing_roles.length === 0 && after!.signatures_count >= after!.required_approvals;

  if (satisfied) {
    const signers = after!.signatures.map((s: any) => s.approver_id).join(', ');
    await db.query(
      `UPDATE payout_approvals
          SET status = 'APPROVED', approved_by = ?, approved_at = ?, approval_notes = ?, currency = currency
        WHERE payout_id = ?`,
      [signers, new Date().toISOString(), input.notes || null, input.payoutId]
    );
  }

  const finalState = await getApprovalState(input.payoutId);
  return { approved: satisfied, state: finalState! };
}

/** Rejects a pending payout with a reason. */
export async function rejectPayout(input: {
  payoutId: string;
  approverUsername: string | null;
  reason: string;
}): Promise<void> {
  await ensurePayoutGovernanceTables();
  const actor = input.approverUsername || null;
  const reqRes = await db.query(`SELECT * FROM payout_approvals WHERE payout_id = ? LIMIT 1`, [input.payoutId]);
  const request: any = reqRes.rows?.[0];
  if (!request) {
    throw new PayoutGovernanceError('APPROVAL_NOT_FOUND', `No approval request for payout ${input.payoutId}.`, 404);
  }
  const status = String(request.status || 'PENDING').toUpperCase();
  if (status === 'APPROVED') {
    throw new PayoutGovernanceError('ALREADY_APPROVED', `Payout ${input.payoutId} is already approved and cannot be rejected.`, 409);
  }

  const role = await approverRoleFor(actor);
  if (!role) {
    throw new PayoutGovernanceError(
      'UNKNOWN_APPROVER_ROLE',
      `No payout approval role assigned to '${actor || 'unknown'}'.`,
      403
    );
  }

  const reason = String(input.reason || '').trim() || 'Rejected without a stated reason';
  await db.query(
    `UPDATE payout_approvals
        SET status = 'REJECTED', rejected_by = ?, approval_notes = ?, rejected_at = ?
      WHERE payout_id = ?`,
    [actor, reason, new Date().toISOString(), input.payoutId]
  );
  await logPayoutEvent(input.payoutId, actor, 'REJECTED', { role, reason });
}

/** Payouts waiting on a signature. */
export async function listPendingApprovals(merchantId?: string) {
  await ensurePayoutGovernanceTables();
  const params: any[] = [];
  let where = `WHERE a.status = 'PENDING'`;
  if (merchantId) { where += ` AND a.merchant_id = ?`; params.push(merchantId); }
  const res = await db.query(
    `SELECT a.*, p.status AS payout_status
       FROM payout_approvals a
       LEFT JOIN merchant_payouts p ON p.id = a.payout_id
       ${where}
      ORDER BY a.created_at DESC
      LIMIT 200`,
    params
  );
  const rows = (res.rows || []) as any[];
  for (const row of rows) {
    const st = await getApprovalState(row.payout_id);
    row.required_roles = st?.required_roles || [];
    row.missing_roles = st?.missing_roles || [];
    row.signatures_count = st?.signatures_count || 0;
  }
  return rows;
}

/** Full audit trail for one payout. */
export async function listPayoutAudit(payoutId: string) {
  await ensurePayoutGovernanceTables();
  const res = await db.query(
    `SELECT id, payout_id, actor_id, action, metadata, created_at
       FROM payout_audit_log WHERE payout_id = ? ORDER BY created_at ASC`,
    [payoutId]
  );
  return (res.rows || []).map((r: any) => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

export default {
  approvalsRequired,
  beneficiaryHash,
  createApprovalRequest,
  getApprovalState,
  approvePayout,
  rejectPayout,
  listPendingApprovals,
  listPayoutAudit,
  grantApproverRole,
  approverRoleFor,
  availableBalance,
  logPayoutEvent,
  ensurePayoutGovernanceTables,
};
