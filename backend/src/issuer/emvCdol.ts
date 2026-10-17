/**
 * emvCdol.ts — Primestack EMV application profile.
 *
 * The EMV contract between a card and its issuer is byte-exact:
 *
 *   1. The card publishes PDOL (9F38) in its FCI and CDOL1 (8C) / CDOL2 (8D)
 *      inside its records.
 *   2. The terminal fills those DOLs with transaction data and sends the
 *      resulting byte string inside GET PROCESSING OPTIONS / GENERATE AC.
 *   3. The card MACs exactly those bytes to produce the ARQC.
 *   4. The issuer therefore has to rebuild the *identical* byte string from the
 *      tags it receives in Field 55 (DE55) — any divergence yields a cryptogram
 *      mismatch, and any length error yields status word 6700 from a real card.
 *
 * This module is the single source of truth for the profile so the card side
 * (Android HCE applet), the generator and the issuer validator can never drift.
 *
 * MAINTENANCE: changing any DOL or the AIP below is a card-profile change and
 * must be applied to the Android applet in the same release.
 */

/** PDOL advertised in the ADF FCI, tag 9F38. 14 bytes of data requested. */
export const PDOL_HEX = '9F37049F02069F1A025F2A02';

/** CDOL1 advertised in the card records, tag 8C. 39 bytes of data requested. */
export const CDOL1_HEX =
  '9F02' + '06' +
  '9F03' + '06' +
  '9F1A' + '02' +
  '95'   + '05' +
  '5F2A' + '02' +
  '9A'   + '03' +
  '9C'   + '01' +
  '9F37' + '04' +
  '9F36' + '02' +
  '9F10' + '08';

/** CDOL2 advertised in the card records, tag 8D. 27 bytes of data requested.
 *  91 is Issuer Authentication Data (ARPC ‖ ARC) — this is how the ARPC from
 *  the online response reaches the card for verification. */
export const CDOL2_HEX =
  '9F10' + '08' +
  '9F26' + '08' +
  '9F27' + '01' +
  '9F36' + '02' +
  '91'   + '08';

/**
 * AIP advertised in GPO (tag 82).
 *   0x1C = 0001 1100 → cardholder verification + terminal risk management +
 *   issuer authentication.
 * Offline data authentication (SDA/DDA/CDA) is deliberately NOT advertised:
 * a Primestack card carries no certification-authority key pair, so claiming
 * it would make the terminal request authentication data the card cannot
 * produce. Set 0x40/0x20/0x02 here only once real CA keys are provisioned.
 */
export const AIP_HEX = '1C00';

/** AFL advertised in GPO (tag 94). SFI 1 record 1, SFI 2 record 1. */
export const AFL_HEX = '08' + '01' + '01' + '00' + '10' + '01' + '01' + '00';

/** ISO 4217 numeric currency → the 2-byte BCD form used by tag 5F2A. */
export function currencyToBcd(currency: string): string {
  const numeric = String(currency || '').replace(/\D/g, '');
  if (numeric.length !== 3) throw new Error('EMV_CURRENCY_NUMERIC_INVALID');
  return `0${numeric}`.toUpperCase();
}

/** 2-byte BCD currency (5F2A) → ISO 4217 numeric string, e.g. "0840" → "840". */
export function bcdToCurrency(bcdHex: string): string {
  const hex = normalizeHex(bcdHex, 'CURRENCY');
  if (hex.length !== 4) throw new Error('EMV_CURRENCY_BCD_INVALID');
  return hex.slice(1);
}

function normalizeHex(value: string, name: string): string {
  const hex = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9A-F]+$/.test(hex)) {
    throw new Error(`EMV_${name}_MUST_BE_HEX`);
  }
  return hex;
}

/**
 * Encode an amount in minor units as 6-byte BCD (n12).
 * 1000 → "000000001000" → 0000000001000 as nibbles → 00 00 00 01 00 00.
 *
 * Note: encoding the *decimal string* as raw hex (a common shortcut) produces
 * 00 00 00 00 10 00 for the same amount, i.e. a different number. That mistake
 * makes 9F02 disagree with DE4, so this function exists to prevent it.
 */
export function encodeBcdAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('EMV_AMOUNT_INVALID');
  }
  const digits = String(amountMinor).padStart(12, '0');
  if (digits.length > 12) throw new Error('EMV_AMOUNT_OVERFLOW');
  let out = '';
  for (let i = 0; i < 12; i += 2) {
    const byte = (Number(digits[i]) << 4) | Number(digits[i + 1]);
    out += byte.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/** Decode 6-byte BCD (n12) back to an amount in minor units. */
export function decodeBcdAmount(hex: string): number {
  const value = normalizeHex(hex, 'AMOUNT');
  if (value.length !== 12) throw new Error('EMV_AMOUNT_BCD_LENGTH');
  let digits = '';
  for (let i = 0; i < 12; i += 2) {
    const high = parseInt(value[i], 16);
    const low = parseInt(value[i + 1], 16);
    if (high > 9 || low > 9) throw new Error('EMV_AMOUNT_NOT_BCD');
    digits += String(high) + String(low);
  }
  return Number(digits);
}

export interface DolEntry {
  tag: string;
  /** DOL lengths are always expressed in bytes, including for numeric formats
   *  (n12 is written as 06). */
  byteLength: number;
}

/** Parse a DOL (9F38 / 8C / 8D) into its ordered entries. */
export function parseDol(dolHex: string): DolEntry[] {
  const hex = normalizeHex(dolHex, 'DOL');
  const entries: DolEntry[] = [];
  let offset = 0;

  while (offset < hex.length) {
    let tag = hex.slice(offset, offset + 2);
    offset += 2;
    if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
      if (offset + 2 > hex.length) throw new Error('EMV_DOL_TRUNCATED_TAG');
      tag += hex.slice(offset, offset + 2);
      offset += 2;
    }
    if (offset + 2 > hex.length) throw new Error('EMV_DOL_TRUNCATED_LENGTH');
    const byteLength = parseInt(hex.slice(offset, offset + 2), 16);
    offset += 2;
    entries.push({ tag, byteLength });
  }

  return entries;
}

export type DolValues = Record<string, string | undefined>;

/**
 * Fill a DOL with values in the order the card requested.
 *
 * `values` maps a tag to its hex value; a missing or short entry is zero-padded
 * and a long one is truncated, because a real card rejects any length mismatch
 * with 6700. Use `validateDolValues` first when you need to know about gaps.
 */
export function buildDolData(dolHex: string, values: DolValues): string {
  const parts: string[] = [];
  for (const { tag, byteLength } of parseDol(dolHex)) {
    const raw = (values[tag] || '').replace(/\s+/g, '').toUpperCase();
    const padded = raw.length >= byteLength * 2
      ? raw.slice(0, byteLength * 2)
      : raw + '0'.repeat(byteLength * 2 - raw.length);
    parts.push(padded);
  }
  return parts.join('');
}

/** Tags present in the DOL that `values` cannot supply — surfaced so the caller
 *  can fail loudly instead of MACing a zero-filled field. */
export function missingDolTags(dolHex: string, values: DolValues): string[] {
  return parseDol(dolHex)
    .filter(({ tag }) => !values[tag])
    .map(({ tag }) => tag);
}

/**
 * Best-effort human-readable summary of a DOL. Used in diagnostics only —
 * never for authorization decisions.
 */
export function describeDol(dolHex: string): string {
  return parseDol(dolHex).map(({ tag, byteLength }) => `${tag}(${byteLength})`).join(' ');
}

/** The Field 55 tags that take part in the CDOL1 MAC, as parsed from DE55. */
export interface Field55CdolTags {
  amount?: Buffer;               // 9F02
  currency?: Buffer;             // 5F2A
  tvr?: Buffer;                  // 95
  termCountry?: Buffer;          // 9F1A
  txnDate?: Buffer;              // 9A
  txnType?: Buffer;              // 9C
  unpredictableNumber?: Buffer;  // 9F37
  atc?: Buffer;                  // 9F36
  iad?: Buffer;                  // 9F10
  '9F03'?: Buffer;               // amount, other
}

/**
 * Rebuild the CDOL1 byte string from a parsed Field 55 block.
 *
 * Both the issuer validator (vault cards) and the HSM adapter must feed the MAC
 * the *same* bytes the card signed, so they share this one mapping instead of
 * each composing CDOL1 themselves.
 */
export function cdol1FromField55(tags: Field55CdolTags): { cdol1Hex: string; missing: string[] } {
  const hexOf = (value?: Buffer) => (value ? value.toString('hex').toUpperCase() : undefined);
  const values: DolValues = {
    '9F02': hexOf(tags.amount),
    '9F03': hexOf(tags['9F03']) || '000000000000',
    '9F1A': hexOf(tags.termCountry) || '0840',
    '95':   hexOf(tags.tvr),
    '5F2A': hexOf(tags.currency),
    '9A':   hexOf(tags.txnDate),
    '9C':   hexOf(tags.txnType),
    '9F37': hexOf(tags.unpredictableNumber),
    '9F36': hexOf(tags.atc),
    '9F10': hexOf(tags.iad),
  };
  return { cdol1Hex: buildDolData(CDOL1_HEX, values), missing: missingDolTags(CDOL1_HEX, values) };
}
