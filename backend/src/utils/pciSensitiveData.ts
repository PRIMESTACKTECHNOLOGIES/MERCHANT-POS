/**
 * PCI-DSS sensitive authentication data (SAD) guard.
 *
 * Source: NEW IMPLEMENTS/credential.pdf — "Navigating PCI DSS: Location of
 * Cardholder Data and Sensitive Authentication Data".
 *
 * Sensitive Authentication Data = full magnetic-stripe (track) data, the card
 * validation code (CVV/CVC/CVV2), and PIN / PIN-block data. PCI DSS forbids
 * storing SAD after authorization, and requires PAN to be masked wherever it
 * is displayed. These helpers detect, redact and mask that data so it never
 * reaches logs, receipts or list views.
 */

/** PAN: 13–19 digits, optionally separated by spaces or dashes. */
const PAN_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;

/** Track 2: PAN followed by the '=' or 'D' data separator. */
const TRACK2_PATTERN = /\b\d{13,19}[=D][0-9A-Za-z<>.:;^=]{1,60}/g;

/** Track 1: '%' [format code] PAN '^' … */
const TRACK1_PATTERN = /%?[A-Z]?\d{13,19}\^[A-Za-z0-9 ./'-]{0,60}\^?/g;

function digitsOnly(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Mask a PAN, keeping the first 6 and last 4 digits visible as PCI DSS allows
 * for display purposes. Shorter values are fully masked.
 */
export function maskPan(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length < 13) {
    return digits.replace(/./g, '*');
  }
  const first = digits.slice(0, 6);
  const last = digits.slice(-4);
  const masked = '*'.repeat(Math.max(0, digits.length - 10));
  return `${first}${masked}${last}`;
}

/** True when the text contains a full magnetic-stripe (track 1 or track 2). */
export function containsTrackData(value: string): boolean {
  const text = String(value || '');
  return TRACK2_PATTERN.test(text) || TRACK1_PATTERN.test(text);
}

/**
 * True when the text contains sensitive authentication data: track data, a
 * bare PAN, a card validation code, or a PIN.
 *
 * `TRACK2_PATTERN`/`TRACK1_PATTERN` use the `g` flag and therefore keep
 * `lastIndex`; reset it before re-testing.
 */
export function containsSad(value: string): boolean {
  const text = String(value || '');
  TRACK1_PATTERN.lastIndex = 0;
  TRACK2_PATTERN.lastIndex = 0;
  if (TRACK1_PATTERN.test(text) || TRACK2_PATTERN.test(text)) return true;
  PAN_PATTERN.lastIndex = 0;
  if (PAN_PATTERN.test(text)) return true;
  if (/\b(?:cvv2?|cvc2?|cid|cav2?|csc)\b\s*[:=]?\s*\d{3,4}\b/i.test(text)) return true;
  if (/\b(?:pin|pinblock|pin block)\b\s*[:=]?\s*[0-9A-Fa-f]{4,32}\b/i.test(text)) return true;
  return false;
}

/** Replace all PANs, track data and validation codes in `value` with masks. */
export function redactSensitive(value: string): string {
  let text = String(value || '');
  text = text.replace(TRACK2_PATTERN, (match) => `[TRACK2:${maskPan(match)}]`);
  text = text.replace(TRACK1_PATTERN, (match) => `[TRACK1:${maskPan(match)}]`);
  text = text.replace(PAN_PATTERN, (match) => maskPan(match));
  text = text.replace(
    /\b((?:cvv2?|cvc2?|cid|cav2?|csc)\b\s*[:=]?\s*)\d{3,4}\b/gi,
    (_match, prefix) => `${prefix}***`,
  );
  return text;
}

/** Redact every string field of a plain object (shallow, non-mutating). */
export function redactObjectSensitive<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    output[key] = typeof value === 'string' ? redactSensitive(value) : value;
  }
  return output as T;
}

/**
 * Throw when `value` still contains sensitive authentication data.
 * Use at write boundaries (log sinks, DB inserts, API responses) to enforce
 * PCI DSS "do not store SAD" by construction.
 */
export function assertNoSad(value: string, context = 'value'): void {
  if (containsTrackData(value)) {
    throw new Error(`PCI_SAD_DETECTED:${context}`);
  }
}
