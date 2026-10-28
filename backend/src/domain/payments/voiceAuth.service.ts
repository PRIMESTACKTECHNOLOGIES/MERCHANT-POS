/**
 * Voice Authorization (Protocol 101.1) Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Real banking behavior:
 *   1. Merchant calls bank by phone
 *   2. Bank agent manually verifies: PAN, expiry, cardholder name, amount
 *   3. Bank gives a verbal 4-6 digit auth code (issuer authorization reference)
 *   4. Merchant types code into POS
 *   5. POS records transaction immediately (funds already reserved by bank)
 *   6. Settlement batch sent at end of day — bank matches auth code → settles
 *
 * CVV is NOT required for 101.1 because:
 *   - Bank agent already did manual fraud check
 *   - CVV is for online card-not-present transactions only
 *   - Voice auth is bank-to-merchant direct authorization
 *
 * Validation rules (acquirer-grade, not toy):
 *   ✓ Auth code format: 4-6 digits only
 *   ✓ Not reused (idempotency — same code cannot be used twice)
 *   ✓ Not expired (VOICE_AUTH_EXPIRY_HOURS window, default 48h)
 *   ✓ If inbound registration exists: amount + PAN + currency must match, and the
 *     registration itself must still be inside the expiry window
 *   ✓ If no registration: the code is verified server-side — see VERIFICATION MODES.
 *     An unverifiable code is REFUSED (fail closed).
 *
 * VERIFICATION MODES (Rule 4, no pre-registration):
 *   1. VOICE_AUTH_VERIFY_URL    — POST the code to the vault bank's
 *                                 POST /api/vault-bank/voice-auth/verify endpoint,
 *                                 signed with the vault gateway HMAC contract
 *                                 (VAULT_BANK_API_KEY / VAULT_BANK_SECRET_KEY)
 *   2. VOICE_AUTH_HMAC_SECRET   — offline fallback: the code must equal the
 *                                 6-digit code derived by voiceAuthCode.ts
 *   3. neither configured       — every code is declined, unless the development-only
 *                                 VOICE_AUTH_ALLOW_UNVERIFIED=true escape hatch is set
 */

import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { signPayload } from '../vault/gateway/auth/hmac';
import { safeEqual, verifyVoiceAuthCode } from './voiceAuthCode';
import { validateVoiceAuth as validateInboundVoiceAuth } from './voiceAuth.validator';

export interface VoiceAuthInput {
  authCode:    string;
  pan:         string;
  expiry:      string;
  amountMinor: number;
  currency:    string;
  merchantId:  string;
  terminalId:  string;
  customerId?: string;
  stan?:       string;
}

export interface VoiceAuthResult {
  success:    boolean;
  reason:     string;
  reasonCode: string;
  authCode:   string;
  registrationId?: string;
}

// Ensure the voice_auth_log table exists
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS voice_auth_log (
      id            TEXT PRIMARY KEY,
      auth_code     TEXT NOT NULL,
      pan_masked    TEXT NOT NULL,
      expiry        TEXT NOT NULL,
      amount_minor  INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      merchant_id   TEXT NOT NULL,
      terminal_id   TEXT NOT NULL,
      customer_id   TEXT,
      stan          TEXT,
      status        TEXT NOT NULL DEFAULT 'CAPTURED',
      settlement_id TEXT,
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      settled_at    TEXT
    )
  `).catch(() => {});
}

export async function ensureVoiceAuth101Schema() {
  await ensureTable();
}

// ── Verification configuration ───────────────────────────────────────────────
// Read per call so an operator can change them without a rebuild.
function envInt(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function voiceAuthExpiryHours(): number {
  return envInt('VOICE_AUTH_EXPIRY_HOURS', 48);
}

function voiceAuthVerifyUrl(): string {
  return (process.env.VOICE_AUTH_VERIFY_URL || '').trim();
}

function voiceAuthHmacSecret(): string {
  return (process.env.VOICE_AUTH_HMAC_SECRET || '').trim();
}

function voiceAuthAllowUnverified(): boolean {
  return (process.env.VOICE_AUTH_ALLOW_UNVERIFIED || '').trim().toLowerCase() === 'true';
}

/** SQLite timestamps are UTC without a zone marker; ISO strings carry their own. */
function parseTimestamp(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  return Date.parse(iso);
}

interface FundingServerVerdict {
  ok: boolean;
  unavailable: boolean;
  reason: string;
  reference?: string;
}

function voiceAuthVerifyApiKey(): string {
  return ((process.env.VOICE_AUTH_VERIFY_API_KEY || process.env.VAULT_BANK_API_KEY) || '').trim();
}

function voiceAuthVerifySecret(): string {
  return ((process.env.VOICE_AUTH_VERIFY_SECRET || process.env.VAULT_BANK_SECRET_KEY) || '').trim();
}

/**
 * Ask the vault bank whether this verbal code is real and unspent.
 * Speaks the vault gateway contract: x-api-key + x-timestamp + x-nonce, with
 * HMAC-SHA512 over "<timestamp>.<nonce>.<raw json body>".
 */
async function verifyWithFundingServer(code: string, input: VoiceAuthInput, panLast4: string): Promise<FundingServerVerdict> {
  const url = voiceAuthVerifyUrl();
  const apiKey = voiceAuthVerifyApiKey();
  const secret = voiceAuthVerifySecret();
  if (!apiKey || !secret) {
    return {
      ok: false,
      unavailable: true,
      reason: 'Voice auth verification needs gateway credentials — set VAULT_BANK_API_KEY / VAULT_BANK_SECRET_KEY (or VOICE_AUTH_VERIFY_API_KEY / VOICE_AUTH_VERIFY_SECRET)',
    };
  }

  const payload = JSON.stringify({
    auth_code: code,
    pan_last4: panLast4,
    expiry: String(input.expiry || ''),
    amount_minor: Number(input.amountMinor),
    currency: String(input.currency || 'USD').toUpperCase(),
    merchant_id: String(input.merchantId || ''),
    terminal_id: String(input.terminalId || ''),
    stan: input.stan ? String(input.stan) : undefined,
    request_id: uuidv4(),
  });
  const timestamp = String(Date.now());
  const nonce = uuidv4();
  const signature = signPayload(secret, `${timestamp}.${nonce}.${payload}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), envInt('VOICE_AUTH_VERIFY_TIMEOUT_MS', 8000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
      },
      body: payload,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!res.ok) {
      return { ok: false, unavailable: false, reason: `Vault bank refused the verification request (HTTP ${res.status})${body?.error ? ` — ${body.error}` : ''}` };
    }
    const approved = body?.approved === true || body?.verified === true || String(body?.status || '').toUpperCase() === 'APPROVED';
    return {
      ok: approved,
      unavailable: false,
      reference: body?.reference || body?.verification_reference || undefined,
      reason: approved ? '' : String(body?.reason || 'Vault bank did not approve this code'),
    };
  } catch (e: any) {
    const detail = e?.name === 'AbortError' ? 'request timed out' : (e?.message || 'network error');
    return { ok: false, unavailable: true, reason: `Vault bank unreachable — ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a voice auth code.
 * Returns success=true if the code can be used for this transaction.
 */
export async function validateVoiceAuth(input: VoiceAuthInput): Promise<VoiceAuthResult> {
  const { authCode, pan, expiry, amountMinor, currency, merchantId } = input;
  const code = String(authCode || '').trim();
  const panLast4 = String(pan || '').replace(/\s/g, '').slice(-4);
  const ccy = String(currency || 'USD').toUpperCase();

  // Rule 1 — Auth code must be 4-6 digits
  if (!/^[0-9]{4,6}$/.test(code)) {
    return {
      success: false,
      reason: 'Auth code must be 4 to 6 digits (bank gives this verbally)',
      reasonCode: 'INVALID_AUTH_CODE_FORMAT',
      authCode: code,
    };
  }

  // Rule 2 — Auth code must not be reused for same merchant within the expiry window
  await ensureTable();
  const reuse = await db.query(
    `SELECT id FROM voice_auth_log
     WHERE auth_code = ? AND merchant_id = ? AND status = 'CAPTURED'
     AND created_at > datetime('now', ?)
     LIMIT 1`,
    [code, merchantId, `-${voiceAuthExpiryHours()} hours`]
  ).catch(() => ({ rows: [] }));

  if (reuse.rows.length > 0) {
    return {
      success: false,
      reason: `Auth code ${code} was already used. Bank must provide a new code for each transaction.`,
      reasonCode: 'AUTH_CODE_ALREADY_USED',
      authCode: code,
    };
  }

  // Rule 3 — Check inbound registration (if customer pre-registered this auth code)
  const inbound = await db.query(
    `SELECT * FROM inbound_transaction_registrations
     WHERE UPPER(authorization_code) = UPPER(?)
       AND (merchant_id = ? OR merchant_id IS NULL)
       AND settlement_status IN ('PENDING_VERIFICATION','VERIFIED_READY_FOR_CAPTURE','PENDING_EXTERNAL')
     ORDER BY created_at DESC LIMIT 1`,
    [code, merchantId]
  ).catch(() => ({ rows: [] }));

  if (inbound.rows.length > 0) {
    const reg = inbound.rows[0] as any;

    // The registration itself expires — VOICE_AUTH_EXPIRY_HOURS from when the bank
    // registered it. An expired registration cannot authorise a new transaction.
    const registeredAt = parseTimestamp(reg.created_at);
    const expiryHours = voiceAuthExpiryHours();
    if (Number.isFinite(registeredAt) && Date.now() - registeredAt > expiryHours * 60 * 60 * 1000) {
      return {
        success: false,
        reason: `Auth code ${code} was registered ${((Date.now() - registeredAt) / 3600000).toFixed(1)}h ago — the ${expiryHours}h verification window has passed`,
        reasonCode: 'VOICE_AUTH_EXPIRED',
        authCode: code,
        registrationId: String(reg.id),
      };
    }

    const regAmount = Number(reg.amount || reg.amount_minor || 0);
    const regAmountMinor = regAmount > 1000 ? regAmount : Math.round(regAmount * 100);

    // Amount must match registration (within $0.01 tolerance)
    if (Math.abs(regAmountMinor - amountMinor) > 1) {
      return {
        success: false,
        reason: `Amount mismatch: bank authorized ${String(reg.currency || ccy).toUpperCase()} ${(regAmountMinor/100).toFixed(2)}, but charging ${ccy} ${(amountMinor/100).toFixed(2)}`,
        reasonCode: 'AMOUNT_MISMATCH',
        authCode: code,
        registrationId: String(reg.id),
      };
    }

    // Currency must match
    if (reg.currency && String(reg.currency).toUpperCase() !== ccy) {
      return {
        success: false,
        reason: `Currency mismatch: registered in ${reg.currency}, charging in ${ccy}`,
        reasonCode: 'CURRENCY_MISMATCH',
        authCode: code,
        registrationId: String(reg.id),
      };
    }

    // PAN last4 must match if registered
    if (reg.pan_masked) {
      const regLast4 = String(reg.pan_masked).slice(-4);
      if (regLast4 !== panLast4) {
        return {
          success: false,
          reason: `Card mismatch: auth code was registered for card ending ${regLast4}`,
          reasonCode: 'PAN_MISMATCH',
          authCode: code,
          registrationId: String(reg.id),
        };
      }
    }

    return {
      success: true,
      reason: `Voice auth ${code} validated against pre-registration (${reg.protocol || '101.1'})`,
      reasonCode: 'VOICE_AUTH_VALID_INBOUND',
      authCode: code,
      registrationId: String(reg.id),
    };
  }

  // Rule 4 — No pre-registration. The code must still be verified server-side:
  // either by the vault bank or by the shared-secret derivation it issued the
  // code with. An unverifiable code is refused.
  if (voiceAuthVerifyUrl()) {
    const verdict = await verifyWithFundingServer(code, input, panLast4);
    if (!verdict.ok) {
      return {
        success: false,
        reason: verdict.reason,
        reasonCode: verdict.unavailable ? 'VOICE_AUTH_VERIFY_UNAVAILABLE' : 'VOICE_AUTH_REJECTED_BY_BANK',
        authCode: code,
      };
    }
    return {
      success: true,
      reason: `Voice auth ${code} verified by the vault bank${verdict.reference ? ` (ref ${verdict.reference})` : ''}`,
      reasonCode: 'VOICE_AUTH_VERIFIED_ONLINE',
      authCode: code,
      registrationId: verdict.reference,
    };
  }

  if (voiceAuthHmacSecret()) {
    const issuedFor = { code, pan, amountMinor, currency: ccy, merchantId: String(merchantId || '') };
    if (verifyVoiceAuthCode(issuedFor, voiceAuthHmacSecret())) {
      return {
        success: true,
        reason: `Voice auth ${code} matched the code issued for this card, amount and merchant`,
        reasonCode: 'VOICE_AUTH_VERIFIED_HMAC',
        authCode: code,
      };
    }
    return {
      success: false,
      reason: `Auth code ${code} is not the code issued for this card ending ${panLast4}, amount ${(amountMinor / 100).toFixed(2)} ${ccy}, at this merchant.`,
      reasonCode: 'VOICE_AUTH_CODE_MISMATCH',
      authCode: code,
    };
  }

  if (voiceAuthAllowUnverified()) {
    console.warn(
      `[VoiceAuth] ACCEPTING UNVERIFIED 101.1 code ${code} for merchant ${merchantId} — ` +
      'VOICE_AUTH_ALLOW_UNVERIFIED=true. This must never be enabled in production.'
    );
    return {
      success: true,
      reason: `Voice auth code ${code} accepted WITHOUT verification (development mode)`,
      reasonCode: 'VOICE_AUTH_UNVERIFIED_ALLOWED',
      authCode: code,
    };
  }

  // Fail closed: no verification source is configured, so the code cannot be trusted.
  return {
    success: false,
    reason: 'Protocol 101.1 codes cannot be verified: set VOICE_AUTH_VERIFY_URL (funding server) or VOICE_AUTH_HMAC_SECRET.',
    reasonCode: 'VOICE_AUTH_NOT_VERIFIABLE',
    authCode: code,
  };
}

/**
 * Record a successful 101.1 transaction in the voice_auth_log.
 * Called after the transaction is approved and wallet credited.
 */
export async function recordVoiceAuthCapture(input: VoiceAuthInput & { settlementId?: string }) {
  await ensureTable();
  const panMasked = '****' + String(input.pan || '').replace(/\s/g, '').slice(-4);
  await db.query(
    `INSERT INTO voice_auth_log
      (id, auth_code, pan_masked, expiry, amount_minor, currency, merchant_id, terminal_id, customer_id, stan, status, settlement_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAPTURED', ?, CURRENT_TIMESTAMP)`,
    [
      uuidv4(),
      String(input.authCode).trim(),
      panMasked,
      String(input.expiry || ''),
      Number(input.amountMinor),
      String(input.currency || 'USD').toUpperCase(),
      String(input.merchantId),
      String(input.terminalId || ''),
      input.customerId || null,
      input.stan || null,
      input.settlementId || null,
    ]
  ).catch((e: any) => console.warn('[VoiceAuth] Log insert failed:', e.message));
}

/**
 * Get all pending 101.1 transactions for settlement batch
 */
export async function getVoiceAuthPendingSettlement(merchantId: string) {
  await ensureTable();
  const res = await db.query(
    `SELECT * FROM voice_auth_log
     WHERE merchant_id = ? AND status = 'CAPTURED' AND settlement_id IS NULL
     ORDER BY created_at ASC`,
    [merchantId]
  ).catch(() => ({ rows: [] }));
  return res.rows;
}

// ── Router-facing service surface ────────────────────────────────────────────
// Backs /api/voice-auth (voiceAuth1011.router.ts). Three tables are involved:
//   inbound_funds_101  — operator-registered inbound funds; a verbal code is only
//                        spendable once a matching registration exists
//   voice_auth_log     — one row per captured 101.1 transaction
//   voice_auth_events  — append-only protocol event log (INTAKE / CAPTURE / …)

/** Error carrying a machine-readable `code` the router maps to an HTTP status. */
function protocolError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/** Append a protocol event; never throws — the log must not break a capture. */
async function recordVoiceAuthEvent(input: {
  txnId: string;
  eventType: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
  authCode: string;
  status: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO voice_auth_events
       (id, txn_id, protocol_code, event_type, amount_minor, currency,
        merchant_id, auth_code, status, meta_json, created_at)
     VALUES (?, ?, '101.1', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.txnId,
      input.eventType,
      Number(input.amountMinor),
      String(input.currency).toUpperCase(),
      input.merchantId,
      input.authCode,
      input.status,
      JSON.stringify(input.meta || {}),
      new Date().toISOString(),
    ],
  ).catch((e: any) => console.warn('[VoiceAuth] event insert failed:', e.message));
}

export interface RegisterInboundFundsInput {
  authCode: string;
  amountMinor: number;
  currency: string;
  panLast4: string;
  cardholderName?: string;
  merchantId: string;
  source?: string;
  registeredBy?: string;
  notes?: string;
}

export interface VoiceAuthCaptureInput {
  authCode: string;
  pan: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
  terminalId?: string;
  stan?: string;
  cardholderName?: string;
  idempotencyKey?: string;
}

export const voiceAuthService = {
  /**
   * Register inbound funds against a verbal code so a later capture can consume it.
   * Registration is the precondition for capture: an unregistered code is refused.
   */
  async registerInboundFunds(input: RegisterInboundFundsInput) {
    const authCode = String(input.authCode || '').trim();
    const merchantId = String(input.merchantId || '').trim();
    const currency = String(input.currency || 'USD').toUpperCase().trim();
    const panLast4 = String(input.panLast4 || '').replace(/\D/g, '').slice(-4);
    const amountMinor = Math.round(Number(input.amountMinor));

    if (!/^[0-9]{4,6}$/.test(authCode)) throw protocolError('INVALID_AUTH_CODE_FORMAT', 'authCode must be 4-6 digits');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw protocolError('INVALID_AMOUNT', 'amountMinor must be a positive integer');
    if (!/^[A-Z]{3}$/.test(currency)) throw protocolError('INVALID_CURRENCY', 'currency must be a 3-letter ISO code');
    if (!/^[0-9]{4}$/.test(panLast4)) throw protocolError('INVALID_PAN_LAST4', 'panLast4 must be the card number\'s last 4 digits');
    if (!merchantId) throw protocolError('MERCHANT_ID_REQUIRED', 'merchantId is required');

    const existing = await db.query(
      `SELECT id FROM inbound_funds_101
        WHERE auth_code = ? AND merchant_id = ? AND status = 'ACTIVE'
        ORDER BY registered_at DESC LIMIT 1`,
      [authCode, merchantId],
    ).catch(() => ({ rows: [] as any[] }));
    if (existing.rows.length) {
      throw protocolError('AUTH_CODE_ALREADY_REGISTERED', `Auth code ${authCode} is already registered for merchant ${merchantId}`);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO inbound_funds_101
         (id, auth_code, amount_minor, currency, pan_last4, cardholder_name,
          merchant_id, source, registered_by, notes, status, registered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [
        id, authCode, amountMinor, currency, panLast4,
        input.cardholderName ? String(input.cardholderName) : null,
        merchantId,
        input.source ? String(input.source) : null,
        input.registeredBy ? String(input.registeredBy) : null,
        input.notes ? String(input.notes) : null,
        now, now,
      ],
    );

    await recordVoiceAuthEvent({
      txnId: id,
      eventType: 'INTAKE',
      amountMinor,
      currency,
      merchantId,
      authCode,
      status: 'ACTIVE',
      meta: { panLast4, source: input.source || null, registeredBy: input.registeredBy || null },
    });

    return {
      registrationId: id,
      authCode,
      amountMinor,
      amount: amountMinor / 100,
      currency,
      panLast4,
      status: 'ACTIVE',
      registeredAt: now,
    };
  },

  /** List inbound registrations for a merchant, optionally filtered by status. */
  async listInboundFunds(merchantId: string, status?: string) {
    const params: any[] = [String(merchantId)];
    let sql = `SELECT * FROM inbound_funds_101 WHERE merchant_id = ?`;
    if (status) {
      sql += ` AND status = ?`;
      params.push(String(status).toUpperCase());
    }
    sql += ` ORDER BY registered_at DESC LIMIT 500`;
    const res = await db.query(sql, params).catch(() => ({ rows: [] as any[] }));
    return res.rows.map((row: any) => ({
      id: row.id,
      authCode: row.auth_code,
      amountMinor: Number(row.amount_minor),
      amount: Number(row.amount_minor) / 100,
      currency: row.currency,
      panLast4: row.pan_last4,
      cardholderName: row.cardholder_name,
      merchantId: row.merchant_id,
      source: row.source,
      registeredBy: row.registered_by,
      notes: row.notes,
      status: row.status,
      captureRef: row.capture_ref,
      capturedAt: row.captured_at,
      registeredAt: row.registered_at,
      updatedAt: row.updated_at,
    }));
  },

  /**
   * POS captures against a registered verbal code. CVV is not required (101.1).
   * All six inbound-funds rules must pass; on success the registration is consumed
   * and the transaction is written to voice_auth_log.
   */
  async capture(input: VoiceAuthCaptureInput) {
    const authCode = String(input.authCode || '').trim();
    const merchantId = String(input.merchantId || '').trim();
    const currency = String(input.currency || 'USD').toUpperCase().trim();
    const amountMinor = Math.round(Number(input.amountMinor));
    const panClean = String(input.pan || '').replace(/\s/g, '');
    const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey) : undefined;

    // Idempotent replay: a repeated key returns the original decision rather than
    // a spurious "auth code already used".
    if (idempotencyKey) {
      const safeKey = idempotencyKey.replace(/["\\%_]/g, '');
      const prior = await db.query(
        `SELECT * FROM voice_auth_events
          WHERE merchant_id = ? AND event_type = 'CAPTURE' AND meta_json LIKE ?
          ORDER BY created_at DESC LIMIT 1`,
        [merchantId, `%"idempotencyKey":"${safeKey}"%`],
      ).catch(() => ({ rows: [] as any[] }));
      const row: any = prior.rows[0];
      if (row) {
        let meta: any = {};
        try { meta = row.meta_json ? JSON.parse(row.meta_json) : {}; } catch { meta = {}; }
        const approved = row.status === 'APPROVED';
        return {
          success: approved,
          status: approved ? ('APPROVED' as const) : ('DECLINED' as const),
          authCode: row.auth_code,
          reasonCode: meta.reasonCode || 'IDEMPOTENT_REPLAY',
          reason: meta.reason || 'Replayed from the original capture',
          captureRef: meta.captureRef || undefined,
          idempotent: true,
        };
      }
    }

    const verdict = await validateInboundVoiceAuth({ authCode, pan: panClean, amountMinor, currency, merchantId });
    const txnId = uuidv4();
    const now = new Date().toISOString();
    const panLast4 = panClean.slice(-4);

    if (!verdict.valid) {
      await recordVoiceAuthEvent({
        txnId,
        eventType: 'CAPTURE',
        amountMinor,
        currency,
        merchantId,
        authCode,
        status: 'DECLINED',
        meta: { reasonCode: verdict.reason, reason: verdict.reason, idempotencyKey, panLast4 },
      });
      return {
        success: false,
        status: 'DECLINED' as const,
        authCode,
        reasonCode: verdict.reason,
        reason: verdict.reason,
        idempotent: false,
      };
    }

    const captureRef = `CAP-1011-${uuidv4().slice(0, 12).toUpperCase()}`;

    await db.query(
      `UPDATE inbound_funds_101
          SET status = 'CONSUMED', capture_ref = ?, captured_at = ?, updated_at = ?
        WHERE id = ?`,
      [captureRef, now, now, verdict.inboundId],
    );

    await recordVoiceAuthCapture({
      authCode,
      pan: panClean,
      expiry: '',
      amountMinor,
      currency,
      merchantId,
      terminalId: input.terminalId ? String(input.terminalId) : '',
      stan: input.stan ? String(input.stan) : undefined,
    });

    await recordVoiceAuthEvent({
      txnId,
      eventType: 'CAPTURE',
      amountMinor,
      currency,
      merchantId,
      authCode,
      status: 'APPROVED',
      meta: {
        reasonCode: verdict.reason,
        captureRef,
        registrationId: verdict.inboundId,
        idempotencyKey,
        panLast4,
        terminalId: input.terminalId || null,
      },
    });

    return {
      success: true,
      status: 'APPROVED' as const,
      authCode,
      reasonCode: verdict.reason,
      reason: `Voice auth ${authCode} captured (${(amountMinor / 100).toFixed(2)} ${currency})`,
      captureRef,
      registrationId: verdict.inboundId,
      idempotent: false,
    };
  },

  /** List captured 101.1 transactions for a merchant, newest first. */
  async getCaptures(merchantId: string, limit = 50) {
    await ensureTable();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const res = await db.query(
      `SELECT * FROM voice_auth_log WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`,
      [String(merchantId), safeLimit],
    ).catch(() => ({ rows: [] as any[] }));
    return res.rows.map((row: any) => ({
      id: row.id,
      authCode: row.auth_code,
      panMasked: row.pan_masked,
      amountMinor: Number(row.amount_minor),
      amount: Number(row.amount_minor) / 100,
      currency: row.currency,
      merchantId: row.merchant_id,
      terminalId: row.terminal_id,
      customerId: row.customer_id,
      stan: row.stan,
      status: row.status,
      settlementId: row.settlement_id,
      createdAt: row.created_at,
      settledAt: row.settled_at,
    }));
  },

  /** Build the end-of-day settlement batch for a merchant's unsettled captures. */
  async buildSettlementBatch(merchantId: string, currency: string) {
    await ensureTable();
    const ccy = String(currency || 'USD').toUpperCase().trim();
    const pending = await db.query(
      `SELECT * FROM voice_auth_log
        WHERE merchant_id = ? AND currency = ? AND status = 'CAPTURED' AND settlement_id IS NULL
        ORDER BY created_at ASC`,
      [String(merchantId), ccy],
    ).catch(() => ({ rows: [] as any[] }));

    if (!pending.rows.length) {
      throw protocolError('NO_TRANSACTIONS', `No unsettled 101.1 captures for merchant ${merchantId} in ${ccy}`);
    }

    const batchId = uuidv4();
    const ids = pending.rows.map((r: any) => String(r.id));
    const totalMinor = pending.rows.reduce((sum: number, r: any) => sum + Number(r.amount_minor || 0), 0);
    const now = new Date().toISOString();

    await db.query('BEGIN IMMEDIATE');
    try {
      const placeholders = ids.map(() => '?').join(',');
      await db.query(
        `UPDATE voice_auth_log SET settlement_id = ?, status = 'SETTLED', settled_at = ? WHERE id IN (${placeholders})`,
        [batchId, now, ...ids],
      );
      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw e;
    }

    return {
      batchId,
      merchantId,
      currency: ccy,
      count: ids.length,
      totalMinor,
      total: totalMinor / 100,
      transactionIds: ids,
      createdAt: now,
    };
  },
};
