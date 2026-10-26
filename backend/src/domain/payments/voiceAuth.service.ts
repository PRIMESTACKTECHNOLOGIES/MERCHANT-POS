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
