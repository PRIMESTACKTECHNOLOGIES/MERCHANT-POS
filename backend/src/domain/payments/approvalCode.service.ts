/**
 * Approval Code Service — 101.1 Voice Auth
 * ─────────────────────────────────────────────────────────────────────────────
 * Cryptographic HMAC-SHA256 based approval code generation and validation.
 * Used for Protocol 101.1 (Voice Authorization) transactions.
 */

import crypto from 'crypto';

/**
 * Get or generate the issuer secret from environment.
 * Falls back to a default dev secret if ISSUER_SECRET_KEY is not set.
 */
export function getIssuerSecret(): string {
  return process.env.ISSUER_SECRET_KEY || 'PRIMESTACK-ISSUER-SECRET-2026-CHANGE-IN-PROD';
}

/**
 * Generate a STAN (System Trace Audit Number) — 6-digit numeric string
 * padded with leading zeros.
 */
export function generateSTAN(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, '0');
}

/**
 * Generate a cryptographic approval code for 101.1 voice auth.
 * HMAC-SHA256 over "PAN_LAST4|AMOUNT_MINOR|STAN|DATETIME",
 * returns first 8 hex characters in uppercase.
 */
export function generateApprovalCode(input: {
  panLast4: string;
  amountMinor: number;
  stan: string;
  datetimeIso: string;
  issuerSecret: string;
}): string {
  const { panLast4, amountMinor, stan, datetimeIso, issuerSecret } = input;
  const payload = `${panLast4}|${amountMinor}|${stan}|${datetimeIso}`;
  const hmac = crypto.createHmac('sha256', issuerSecret);
  hmac.update(payload, 'utf8');
  return hmac.digest('hex').substring(0, 8).toUpperCase();
}

/**
 * Validate an approval code at settlement time.
 * Recomputes the expected code and compares via constant-time comparison.
 */
export function validateApprovalCode(input: {
  panLast4: string;
  amountMinor: number;
  stan: string;
  datetimeIso: string;
  issuerSecret: string;
  approvalCode: string;
}): boolean {
  const { approvalCode, ...rest } = input;
  const expected = generateApprovalCode(rest);
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(expected.padEnd(64), 'utf8');
  const b = Buffer.from(approvalCode.toUpperCase().padEnd(64), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
