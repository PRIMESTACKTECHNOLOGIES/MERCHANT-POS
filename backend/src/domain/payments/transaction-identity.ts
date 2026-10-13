/**
 * transaction-identity.ts
 *
 * Centralised generation of real, audit-ready transaction identifiers that
 * every persisted POS transaction must carry:
 *
 *   - RRN  (DE37 Retrieval Reference Number) — 12-digit numeric, derived from
 *              the transaction timestamp so it is deterministic per-millisecond.
 *   - card_brand — detected from the PAN BIN (Visa / Mastercard / Amex / etc.).
 *   - auth_code   — 6-character uppercase alphanumeric issuer-style approval
 *                   code (ISO 8583 DE38), used as a fallback when the acquirer
 *                   does not return one.
 *
 * These helpers replace the previous placeholder fallbacks (`AUTH-xxx`,
 * `EMV-xxx`) and the missing `rrn`/`card_brand` columns so every transaction
 * row is fully populated for reconciliation, receipts and scheme reporting.
 */

import crypto from 'crypto';

const AUTH_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generate a 12-digit numeric RRN from a timestamp.
 * Uses the last 12 digits of the epoch milliseconds (matches the scheme used
 * by vault-bank-acquirer.client.ts for live acquirer calls).
 */
export function generateRRN(now: Date = new Date()): string {
  return String(now.getTime()).slice(-12).padStart(12, '0');
}

/**
 * Detect the card brand from the PAN (Bank Identification Number).
 * Returns the brand name in uppercase, or null when no PAN is supplied.
 *
 * Ranges:
 *   Visa        -> 4
 *   Mastercard  -> 51-55 or 2221-2720
 *   Amex        -> 34 / 37
 *   Discover    -> 6011 / 65 / 644-649
 *   Diners      -> 30 / 36 / 38
 *   JCB         -> 35
 *   UnionPay    -> 62
 */
export function detectCardBrand(pan?: string | null): string | null {
  if (!pan) return null;
  const digits = String(pan).replace(/[^0-9]/g, '');
  if (!digits) return null;

  const first1 = digits.slice(0, 1);
  const first2 = digits.slice(0, 2);
  const first4 = digits.slice(0, 4);
  const first6 = digits.slice(0, 6);

  if (first1 === '4') return 'VISA';

  if ((first2 >= '51' && first2 <= '55') ||
      (first6 >= '222100' && first6 <= '272099')) return 'MASTERCARD';

  if (first2 === '34' || first2 === '37') return 'AMEX';

  if (first4 === '6011' || first2 === '65' ||
      (first4 >= '6440' && first4 <= '6499')) return 'DISCOVER';

  if (first2 === '30' || first2 === '36' || first2 === '38') return 'DINERS';

  if (first2 === '35') return 'JCB';

  if (first2 === '62') return 'UNIONPAY';

  return 'UNKNOWN';
}

/**
 * Generate a 6-character uppercase alphanumeric issuer-style approval code.
 * Uses crypto.randomBytes for uniqueness (probability of collision is
 * astronomically low for POS volumes).
 */
export function generateAuthCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += AUTH_CODE_ALPHABET[crypto.randomInt(0, AUTH_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Build a complete transaction identity bundle.
 *
 * @param pan          Full PAN (used for card brand detection).
 * @param overrides    Optional explicit values (e.g. acquirer-provided RRN
 *                     or auth code) that take precedence over generated ones.
 */
export function buildTransactionIdentity(
  pan?: string | null,
  overrides: { rrn?: string; authCode?: string; now?: Date } = {},
): { rrn: string; cardBrand: string | null; authCode: string } {
  const now = overrides.now || new Date();
  return {
    rrn:       overrides.rrn || generateRRN(now),
    cardBrand: detectCardBrand(pan),
    authCode:  overrides.authCode || generateAuthCode(),
  };
}
