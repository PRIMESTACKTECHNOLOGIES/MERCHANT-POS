import crypto from 'crypto';

/**
 * Protocol 101.1 — verbal authorization codes.
 *
 * The issuing bank derives a 6-digit code from the card, the amount, the merchant
 * and the UTC day the code is issued for. The POS never holds the issuing secret:
 * it either asks the bank to verify the code (VOICE_AUTH_VERIFY_URL) or, as an
 * offline fallback, verifies locally with a shared secret
 * (VOICE_AUTH_HMAC_SECRET).
 *
 * The vault bank owns issuance and uses this module with
 * VAULT_BANK_VOICE_AUTH_SECRET, so the algorithm cannot drift between the issuer
 * and the verifier.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VoiceAuthCodeInput {
  pan: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
}

/** UTC day bucket — a code is valid for the day of issue and the following day. */
export function voiceAuthBucket(at: Date): string {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

function voiceAuthMaterial(input: VoiceAuthCodeInput, bucket: string): string {
  return [
    String(input.pan || '').replace(/\s/g, '').slice(-4),
    Number(input.amountMinor),
    String(input.currency || 'USD').toUpperCase(),
    String(input.merchantId || ''),
    bucket,
  ].join('|');
}

export function deriveVoiceAuthCode(input: VoiceAuthCodeInput, secret: string, at: Date = new Date()): string {
  if (!secret) throw new Error('A voice auth code secret is required to derive a code');
  const digest = crypto.createHmac('sha256', secret).update(voiceAuthMaterial(input, voiceAuthBucket(at))).digest();
  return String(digest.readUIntBE(0, 3) % 1000000).padStart(6, '0');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

/** Accepts the code when it matches the current or the previous UTC day bucket. */
export function verifyVoiceAuthCode(input: VoiceAuthCodeInput & { code: string }, secret: string, at: Date = new Date()): boolean {
  if (!secret) return false;
  return [
    deriveVoiceAuthCode(input, secret, at),
    deriveVoiceAuthCode(input, secret, new Date(at.getTime() - DAY_MS)),
  ].some((candidate) => safeEqual(candidate, input.code));
}
