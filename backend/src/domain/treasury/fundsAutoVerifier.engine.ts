/**
 * FUNDS AUTO VERIFIER ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatically verifies inbound funds against the configured provider.
 *
 * When PROVIDER_ENDPOINT_URL / PROVIDER_API_KEY / PROVIDER_SECRET_KEY are set,
 * EVERY candidate registration is sent to the provider's /funds/verify endpoint
 * as a real signed HTTP call. Nothing is ever marked VERIFIED unless the
 * provider confirms it and the amount + currency match.
 *
 * When the provider is not configured, the engine stops immediately with
 * PROVIDER_NOT_CONFIGURED — it does not guess, and it does not mark funds as
 * verified locally.
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import {
  providerClient,
  ProviderNotConfiguredError,
  ProviderCallFailedError,
} from './provider.client';

export type FundVerifierRunStatus =
  | 'RUNNING'
  | 'COMPLETE'
  | 'COMPLETE_WITH_ERRORS'
  | 'FAILED';

export interface FundCandidate {
  id: string;
  authorizationCode: string;
  protocol: string;
  amount: number;
  currency: string;
  beneficiaryName: string | null;
  beneficiaryAccount: string | null;
  senderBic: string | null;
  receiverBic: string | null;
  uetr: string | null;
  depositCode: string | null;
  merchantId: string | null;
  customerId: string | null;
  fundVerificationStatus: string;
  settlementStatus: string;
}

export interface FundVerificationOutcome {
  registrationId: string;
  authorizationCode: string;
  status: 'VERIFIED' | 'MISMATCH' | 'FAILED' | 'SKIPPED';
  reason: string;
  verifiedAmount?: number;
  verifiedCurrency?: string;
  externalReference?: string | null;
}

export interface FundVerifierRunResult {
  runId: string;
  status: FundVerifierRunStatus;
  scanned: number;
  verified: number;
  failed: number;
  skipped: number;
  providerCalled: number;
  providerEndpoint: string | null;
  startedAt: string;
  completedAt: string;
  outcomes: FundVerificationOutcome[];
}

const SETTLEMENT_TERMINAL = new Set(['CAPTURED', 'VERIFIED_READY_FOR_CAPTURE']);

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return ['true', 'verified', 'settled', 'good', 'ok', 'success'].includes(value.trim().toLowerCase());
  return false;
}

export class FundsAutoVerifierEngine {
  async listCandidates(limit = 200, authorizationCode?: string): Promise<FundCandidate[]> {
    await ensureTreasuryTables();
    const params: unknown[] = [];
    let where = `WHERE fund_verification_status IN ('UNVERIFIED', 'PENDING_EXTERNAL', 'VERIFICATION_FAILED')`;
    if (authorizationCode) {
      where += ` AND UPPER(authorization_code) = ?`;
      params.push(String(authorizationCode).trim().toUpperCase());
    }
    params.push(limit);
    const res = await db.query(
      `SELECT * FROM inbound_transaction_registrations
       ${where}
       ORDER BY created_at ASC
       LIMIT ?`,
      params,
    );
    return (res.rows || [])
      .filter((row: any) => !SETTLEMENT_TERMINAL.has(String(row.settlement_status || '').toUpperCase()))
      .map((row: any) => ({
        id: row.id,
        authorizationCode: row.authorization_code,
        protocol: row.protocol || '101.1',
        amount: Number(row.amount),
        currency: String(row.currency || 'USD').toUpperCase(),
        beneficiaryName: row.beneficiary_name || null,
        beneficiaryAccount: row.beneficiary_account || null,
        senderBic: row.sender_bic || null,
        receiverBic: row.receiver_bic || null,
        uetr: row.uetr || null,
        depositCode: row.deposit_code || null,
        merchantId: row.merchant_id || null,
        customerId: row.customer_id || null,
        fundVerificationStatus: row.fund_verification_status,
        settlementStatus: row.settlement_status,
      }));
  }

  private async recordRun(params: {
    id: string;
    engine: string;
    status: FundVerifierRunStatus;
    startedAt: string;
    completedAt?: string | null;
    scanned?: number;
    verified?: number;
    failed?: number;
    skipped?: number;
    providerCalled?: number;
    providerEndpoint?: string | null;
    error?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const existing = await db.query('SELECT id FROM treasury_engine_runs WHERE id = ? LIMIT 1', [params.id]);
    if (existing.rows?.length) {
      await db.query(
        `UPDATE treasury_engine_runs
           SET status = ?, completed_at = ?, scanned = ?, verified = ?, failed = ?,
               skipped = ?, provider_called = ?, provider_endpoint = ?, error = ?, meta_json = ?
         WHERE id = ?`,
        [
          params.status,
          params.completedAt ?? null,
          params.scanned ?? 0,
          params.verified ?? 0,
          params.failed ?? 0,
          params.skipped ?? 0,
          params.providerCalled ?? 0,
          params.providerEndpoint ?? null,
          params.error ?? null,
          params.meta ? JSON.stringify(params.meta) : null,
          params.id,
        ],
      );
      return;
    }
    await db.query(
      `INSERT INTO treasury_engine_runs
        (id, engine, status, started_at, completed_at, scanned, verified, failed, skipped,
         provider_called, provider_endpoint, error, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.engine,
        params.status,
        params.startedAt,
        params.completedAt ?? null,
        params.scanned ?? 0,
        params.verified ?? 0,
        params.failed ?? 0,
        params.skipped ?? 0,
        params.providerCalled ?? 0,
        params.providerEndpoint ?? null,
        params.error ?? null,
        params.meta ? JSON.stringify(params.meta) : null,
      ],
    );
  }

  private async audit(params: {
    registrationId: string;
    resultStatus: 'VERIFIED' | 'FAILED' | 'PENDING';
    reason: string;
    request: unknown;
    response: unknown;
    verifiedAmount?: number;
    verifiedCurrency?: string;
    externalReference?: string | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO fund_verification_audits
        (id, registration_id, provider, verification_method, request_payload, response_payload,
         result_status, result_reason, verified_amount, verified_currency, external_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        params.registrationId,
        'TREASURY_PROVIDER',
        'API_CALL',
        JSON.stringify(params.request ?? {}),
        params.response === undefined || params.response === null ? null : JSON.stringify(params.response),
        params.resultStatus,
        params.reason,
        params.verifiedAmount ?? null,
        params.verifiedCurrency ?? null,
        params.externalReference ?? null,
        new Date().toISOString(),
      ],
    );
  }

  async runForCandidate(candidate: FundCandidate): Promise<FundVerificationOutcome> {
    const payload = {
      registrationId: candidate.id,
      authorizationCode: candidate.authorizationCode,
      protocol: candidate.protocol,
      uetr: candidate.uetr,
      amount: candidate.amount,
      currency: candidate.currency,
      beneficiaryName: candidate.beneficiaryName,
      beneficiaryAccount: candidate.beneficiaryAccount,
      senderBic: candidate.senderBic,
      receiverBic: candidate.receiverBic,
      depositCode: candidate.depositCode,
      merchantId: candidate.merchantId,
      customerId: candidate.customerId,
      requestedAt: new Date().toISOString(),
    };

    let call;
    try {
      call = await providerClient.verifyFunds(payload, `fundverify:${candidate.id}`);
    } catch (error: any) {
      const reason = error instanceof ProviderNotConfiguredError
        ? error.message
        : `Provider call failed: ${error?.message || 'unknown error'}`;
      await this.audit({
        registrationId: candidate.id,
        resultStatus: 'FAILED',
        reason,
        request: payload,
        response: error instanceof ProviderCallFailedError ? error.responseBody ?? null : null,
      });
      await db.query(
        `UPDATE inbound_transaction_registrations
           SET fund_verification_status = 'PENDING_EXTERNAL', updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), candidate.id],
      );
      return {
        registrationId: candidate.id,
        authorizationCode: candidate.authorizationCode,
        status: 'FAILED',
        reason,
      };
    }

    const data: any = call.data || {};
    const verified =
      data.verified === true ||
      String(data.status || '').toUpperCase() === 'VERIFIED' ||
      String(data.settlement_status || '').toUpperCase() === 'SETTLED' ||
      String(data.funds_status || '').toUpperCase() === 'GOOD' ||
      truthyFlag(data.confirmed);

    if (!verified) {
      const reason = data.message || data.reason || 'Provider did not confirm the funds';
      await this.audit({
        registrationId: candidate.id,
        resultStatus: 'FAILED',
        reason,
        request: payload,
        response: data,
        externalReference: data.reference || call.requestId,
      });
      await db.query(
        `UPDATE inbound_transaction_registrations
           SET fund_verification_status = 'VERIFICATION_FAILED',
               settlement_status = 'VERIFICATION_FAILED',
               updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), candidate.id],
      );
      return {
        registrationId: candidate.id,
        authorizationCode: candidate.authorizationCode,
        status: 'MISMATCH',
        reason,
        externalReference: data.reference || call.requestId,
      };
    }

    const verifiedAmount = Number(
      data.amount ?? data.available_amount ?? data.settled_amount ?? data.verifiedAmount ?? candidate.amount,
    );
    const verifiedCurrency = String(
      data.currency ?? data.verifiedCurrency ?? candidate.currency,
    ).toUpperCase();
    const externalReference = data.reference || data.transaction_ref || data.uetr || data.confirmation_id || call.requestId || null;

    const amountMatches =
      Number.isFinite(verifiedAmount) && Math.abs(verifiedAmount - candidate.amount) < 0.01;
    const currencyMatches = verifiedCurrency === candidate.currency;

    if (!amountMatches || !currencyMatches) {
      const reason =
        `Verification mismatch: expected ${candidate.currency} ${candidate.amount.toFixed(2)}, ` +
        `provider returned ${verifiedCurrency} ${Number.isFinite(verifiedAmount) ? verifiedAmount.toFixed(2) : 'n/a'}`;
      await this.audit({
        registrationId: candidate.id,
        resultStatus: 'FAILED',
        reason,
        request: payload,
        response: data,
        verifiedAmount: Number.isFinite(verifiedAmount) ? verifiedAmount : undefined,
        verifiedCurrency,
        externalReference,
      });
      await db.query(
        `UPDATE inbound_transaction_registrations
           SET fund_verification_status = 'VERIFICATION_FAILED',
               settlement_status = 'VERIFICATION_FAILED',
               updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), candidate.id],
      );
      return {
        registrationId: candidate.id,
        authorizationCode: candidate.authorizationCode,
        status: 'MISMATCH',
        reason,
        verifiedAmount,
        verifiedCurrency,
        externalReference,
      };
    }

    const now = new Date().toISOString();
    await this.audit({
      registrationId: candidate.id,
      resultStatus: 'VERIFIED',
      reason: data.message || 'Provider confirmed funds and amount/currency match',
      request: payload,
      response: data,
      verifiedAmount,
      verifiedCurrency,
      externalReference,
    });
    await db.query(
      `UPDATE inbound_transaction_registrations
         SET fund_verification_status = 'VERIFIED',
             settlement_status = 'VERIFIED_READY_FOR_CAPTURE',
             verification_provider = 'TREASURY_PROVIDER',
             verification_reference = ?,
             verified_at = ?,
             updated_at = ?
       WHERE id = ?`,
      [externalReference, now, now, candidate.id],
    );
    return {
      registrationId: candidate.id,
      authorizationCode: candidate.authorizationCode,
      status: 'VERIFIED',
      reason: 'Verified against provider',
      verifiedAmount,
      verifiedCurrency,
      externalReference,
    };
  }

  async run(options: { limit?: number; authorizationCode?: string; initiatedBy?: string } = {}): Promise<FundVerifierRunResult> {
    await ensureTreasuryTables();
    const runId = uuidv4();
    const startedAt = new Date().toISOString();

    // Fail-closed: refuse to run (and record why) when the provider is not wired.
    let endpoint: string | null = null;
    try {
      const cfg = providerClient.assertConfigured();
      endpoint = cfg.endpointUrl;
    } catch (error: any) {
      await this.recordRun({
        id: runId,
        engine: 'funds_auto_verifier',
        status: 'FAILED',
        startedAt,
        completedAt: new Date().toISOString(),
        error: error?.message || 'PROVIDER_NOT_CONFIGURED',
        meta: { missing: error?.missing || [], initiatedBy: options.initiatedBy || 'system' },
      });
      throw error;
    }

    await this.recordRun({
      id: runId,
      engine: 'funds_auto_verifier',
      status: 'RUNNING',
      startedAt,
      providerEndpoint: endpoint,
      meta: { initiatedBy: options.initiatedBy || 'system' },
    });

    const candidates = await this.listCandidates(options.limit ?? 200, options.authorizationCode);
    const outcomes: FundVerificationOutcome[] = [];
    let verified = 0;
    let failed = 0;
    let skipped = 0;
    let providerCalled = 0;

    for (const candidate of candidates) {
      try {
        const outcome = await this.runForCandidate(candidate);
        providerCalled += 1;
        outcomes.push(outcome);
        if (outcome.status === 'VERIFIED') verified += 1;
        else if (outcome.status === 'SKIPPED') skipped += 1;
        else failed += 1;
      } catch (error: any) {
        failed += 1;
        outcomes.push({
          registrationId: candidate.id,
          authorizationCode: candidate.authorizationCode,
          status: 'FAILED',
          reason: error?.message || 'unexpected error',
        });
      }
    }

    const completedAt = new Date().toISOString();
    const status: FundVerifierRunStatus = failed > 0 ? 'COMPLETE_WITH_ERRORS' : 'COMPLETE';
    await this.recordRun({
      id: runId,
      engine: 'funds_auto_verifier',
      status,
      startedAt,
      completedAt,
      scanned: candidates.length,
      verified,
      failed,
      skipped,
      providerCalled,
      providerEndpoint: endpoint,
      meta: { initiatedBy: options.initiatedBy || 'system', outcomes },
    });

    return {
      runId,
      status,
      scanned: candidates.length,
      verified,
      failed,
      skipped,
      providerCalled,
      providerEndpoint: endpoint,
      startedAt,
      completedAt,
      outcomes,
    };
  }

  async getStatus() {
    await ensureTreasuryTables();
    const counts = await db.query(
      `SELECT fund_verification_status AS status, COUNT(*) AS cnt
         FROM inbound_transaction_registrations
        GROUP BY fund_verification_status`,
    );
    const lastRun = await db.query(
      `SELECT * FROM treasury_engine_runs WHERE engine = 'funds_auto_verifier' ORDER BY started_at DESC LIMIT 1`,
    );
    return {
      provider: providerClient.status(),
      registrationCounts: (counts.rows || []).map((row: any) => ({ status: row.status, count: Number(row.cnt) })),
      lastRun: lastRun.rows?.[0]
        ? {
            ...lastRun.rows[0],
            meta_json: undefined,
          }
        : null,
    };
  }
}

export const fundsAutoVerifierEngine = new FundsAutoVerifierEngine();

  async registerCandidate(input: {
    authorizationCode: string;
    protocol?: string;
    amount: number;
    currency: string;
    beneficiaryName?: string;
    beneficiaryAccount?: string;
    senderBic?: string;
    receiverBic?: string;
    uetr?: string;
    depositCode?: string;
    merchantId?: string;
    customerId?: string;
  }) {
    await ensureTreasuryTables();
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const now = new Date().toISOString();

    // Check for duplicate
    const existing = await db.query(
      `SELECT id FROM inbound_transaction_registrations WHERE authorization_code = ? LIMIT 1`,
      [input.authorizationCode],
    );
    if (existing.rows?.length) {
      return { id: existing.rows[0].id as string, duplicate: true };
    }

    await db.query(
      `INSERT INTO inbound_transaction_registrations
         (id, authorization_code, protocol, amount_minor, currency,
          beneficiary_name, beneficiary_account, sender_bic, receiver_bic,
          uetr, deposit_code, merchant_id, customer_id,
          fund_verification_status, settlement_status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING','PENDING_VERIFICATION',?,?)`,
      [
        id,
        input.authorizationCode,
        input.protocol || '201.3',
        Math.round(input.amount * 100),  // store in minor units (cents)
        input.currency.toUpperCase(),
        input.beneficiaryName || null,
        input.beneficiaryAccount || null,
        input.senderBic || null,
        input.receiverBic || null,
        input.uetr || null,
        input.depositCode || null,
        input.merchantId || null,
        input.customerId || null,
        now,
        now,
      ],
    );

    return { id, duplicate: false };
  }
