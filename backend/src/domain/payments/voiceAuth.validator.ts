/**
 * Voice Authorization Validator — Protocol 101.1
 *
 * Acquirer-grade validation logic.  No external API is called.
 * Validation passes ONLY when funds are already in the inbound ledger
 * (inbound_funds_101 table) AND all six rules pass.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Rule 1 — Auth code format: 4–6 digits (issuer voice-auth standard)
 * Rule 2 — Auth code not reused (idempotency / anti-double-spend)
 * Rule 3 — Auth code matches a registered inbound fund row
 * Rule 4 — PAN matches what the inbound registration recorded
 * Rule 5 — Amount matches the inbound registration (exact, in minor units)
 * Rule 6 — Auth code not expired (configurable window, default 48 h)
 * ──────────────────────────────────────────────────────────────────────────
 */

import { db } from '../../config/db';

export interface VoiceAuthValidateInput {
  /** 4–6 digit verbal code given by issuer over the phone */
  authCode: string;
  /** PAN (full or last-4 are both accepted — we mask-compare) */
  pan: string;
  /** Requested amount in minor units (e.g. 10000 = 100.00) */
  amountMinor: number;
  /** ISO-4217 currency, e.g. "USD" */
  currency: string;
  /** Merchant ID (must match the inbound registration) */
  merchantId: string;
}

export interface VoiceAuthValidateResult {
  valid: boolean;
  reason: string;
  /** The inbound fund registration row when valid === true */
  inboundId?: string;
  inboundAmount?: number;
  inboundCurrency?: string;
}

/** How long (ms) a voice-auth code stays valid after it was registered */
const EXPIRY_WINDOW_MS =
  Number(process.env.VOICE_AUTH_EXPIRY_HOURS || 48) * 60 * 60 * 1000;

export async function validateVoiceAuth(
  input: VoiceAuthValidateInput,
): Promise<VoiceAuthValidateResult> {
  const { authCode, pan, amountMinor, currency, merchantId } = input;

  // ── Rule 1 — Format ────────────────────────────────────────────────────
  const codeClean = String(authCode || '').trim();
  if (!/^[0-9]{4,6}$/.test(codeClean)) {
    return { valid: false, reason: 'INVALID_AUTH_CODE_FORMAT' };
  }

  // ── Rule 5 — Amount sanity ─────────────────────────────────────────────
  const minor = Number(amountMinor);
  if (!Number.isFinite(minor) || minor <= 0) {
    return { valid: false, reason: 'INVALID_AMOUNT' };
  }
  if (!/^[A-Z]{3}$/.test(String(currency || '').toUpperCase().trim())) {
    return { valid: false, reason: 'INVALID_CURRENCY' };
  }
  const ccy = currency.toUpperCase().trim();

  // ── Derive masked PAN for comparison ──────────────────────────────────
  const panClean = String(pan || '').replace(/\s/g, '');
  if (!panClean) return { valid: false, reason: 'PAN_REQUIRED' };
  const panLast4 = panClean.slice(-4);
  if (!/^\d{4}$/.test(panLast4)) return { valid: false, reason: 'PAN_INVALID' };

  // ── Look up inbound registration ───────────────────────────────────────
  const res = await db.query(
    `SELECT * FROM inbound_funds_101
     WHERE auth_code = ? AND merchant_id = ?
     ORDER BY registered_at DESC LIMIT 1`,
    [codeClean, merchantId],
  );
  const rec = res.rows[0] as any;

  // ── Rule 3 — Auth code must exist ─────────────────────────────────────
  if (!rec) {
    return { valid: false, reason: 'AUTH_CODE_NOT_REGISTERED' };
  }

  // ── Rule 2 — Not already consumed ──────────────────────────────────────
  if (rec.status === 'CONSUMED') {
    return { valid: false, reason: 'AUTH_CODE_ALREADY_USED' };
  }
  if (rec.status === 'EXPIRED') {
    return { valid: false, reason: 'AUTH_CODE_EXPIRED' };
  }
  if (rec.status !== 'ACTIVE') {
    return { valid: false, reason: `AUTH_CODE_NOT_ACTIVE:${rec.status}` };
  }

  // ── Rule 6 — Expiry window ────────────────────────────────────────────
  const registeredAt = new Date(rec.registered_at).getTime();
  if (Date.now() - registeredAt > EXPIRY_WINDOW_MS) {
    // Mark expired in the DB so subsequent calls are fast
    await db.query(
      `UPDATE inbound_funds_101 SET status = 'EXPIRED', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), rec.id],
    );
    return { valid: false, reason: 'AUTH_CODE_EXPIRED' };
  }

  // ── Rule 4 — PAN (last-4) must match ──────────────────────────────────
  const recPanLast4 = String(rec.pan_last4 || '');
  if (recPanLast4 && recPanLast4 !== panLast4) {
    return { valid: false, reason: 'PAN_MISMATCH' };
  }

  // ── Rule 5 — Amount must match (minor units) ──────────────────────────
  const recAmountMinor = Number(rec.amount_minor);
  if (recAmountMinor !== minor) {
    return {
      valid: false,
      reason: `AMOUNT_MISMATCH:expected=${recAmountMinor},got=${minor}`,
    };
  }

  // ── Currency match ─────────────────────────────────────────────────────
  if (String(rec.currency || '').toUpperCase() !== ccy) {
    return {
      valid: false,
      reason: `CURRENCY_MISMATCH:expected=${rec.currency},got=${ccy}`,
    };
  }

  // ── All rules passed ───────────────────────────────────────────────────
  return {
    valid: true,
    reason: 'VOICE_AUTH_VALID',
    inboundId: String(rec.id),
    inboundAmount: recAmountMinor,
    inboundCurrency: String(rec.currency).toUpperCase(),
  };
}
