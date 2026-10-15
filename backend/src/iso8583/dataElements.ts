/**
 * ISO 8583 data-element (DE) catalog.
 *
 * Source: NEW IMPLEMENTS/fa56ec0f1a8b5c55.pdf — "ISO-defined data elements"
 * table (MTI meanings + DE number / type / usage).
 *
 * This is the reference catalog of the ISO-defined data elements, including a
 * PCI sensitivity classification per element. It is deliberately separate from
 * `domain/payments/acquirer/iso8583.profile.ts`, which is the *wire* profile
 * the processor actually packs/unpacks. The catalog answers "what is DE-39 and
 * may it be logged?", not "how many bytes do I put on the socket?".
 */

import { maskPan } from '../utils/pciSensitiveData';

export type IsoFieldType = 'N' | 'AN' | 'ANS' | 'NS' | 'Z' | 'B';
export type IsoFieldVariable = 'FIXED' | 'LLVAR' | 'LLLVAR';

/**
 * PCI classification of a data element.
 *  - `PAN`       — primary account number, must be masked when displayed/stored.
 *  - `SAD`       — sensitive authentication data (track data, PIN block); PCI DSS
 *                  forbids storing it after authorization.
 *  - `SENSITIVE` — not cardholder data itself, but internal (keys, MACs, balances)
 *                  and must not be exposed to logs, receipts or list views.
 *  - `NONE`      — safe to display.
 */
export type IsoFieldSensitivity = 'PAN' | 'SAD' | 'SENSITIVE' | 'NONE';

export interface IsoDataElement {
  /** DE number (1-128). */
  field: number;
  /** ISO-defined element name. */
  name: string;
  /** Data format. */
  type: IsoFieldType;
  /** Maximum length in digits/characters (byte length for `B`). */
  length: number;
  /** FIXED, LLVAR or LLLVAR. */
  variable: IsoFieldVariable;
  /** ISO-defined usage, summarised from the source table. */
  usage: string;
  /** PCI sensitivity classification. */
  sensitivity: IsoFieldSensitivity;
}

function de(
  field: number,
  name: string,
  type: IsoFieldType,
  length: number,
  variable: IsoFieldVariable,
  usage: string,
  sensitivity: IsoFieldSensitivity = 'NONE',
): IsoDataElement {
  return { field, name, type, length, variable, usage, sensitivity };
}

const FIXED: IsoFieldVariable = 'FIXED';
const LLVAR: IsoFieldVariable = 'LLVAR';
const LLLVAR: IsoFieldVariable = 'LLLVAR';

const RESERVED_ISO = 'Reserved for ISO use';
const RESERVED_NATIONAL = 'Reserved for national use';
const RESERVED_PRIVATE = 'Reserved for private use';

function range(
  from: number,
  to: number,
  usage: string,
  variable: IsoFieldVariable = LLLVAR,
  length = 999,
): IsoDataElement[] {
  const out: IsoDataElement[] = [];
  for (let field = from; field <= to; field += 1) {
    out.push(de(field, `Reserved (${usage})`, 'ANS', length, variable, usage));
  }
  return out;
}

/** Full ISO 8583 data-element catalog, DE 1-128. */
export const ISO_DATA_ELEMENTS: ReadonlyArray<IsoDataElement> = [
  de(1, 'Bitmap', 'B', 16, FIXED, 'Bit map (b 16 if secondary present, b 192 if tertiary present)'),
  de(2, 'Primary account number (PAN)', 'N', 19, LLVAR, 'Primary account number (PAN)', 'PAN'),
  de(3, 'Processing code', 'N', 6, FIXED, 'Processing code'),
  de(4, 'Amount, transaction', 'N', 12, FIXED, 'Amount, transaction'),
  de(5, 'Amount, settlement', 'N', 12, FIXED, 'Amount, settlement'),
  de(6, 'Amount, cardholder billing', 'N', 12, FIXED, 'Amount, cardholder billing'),
  de(7, 'Transmission date and time', 'N', 10, FIXED, 'Transmission date and time'),
  de(8, 'Amount, cardholder billing fee', 'N', 9, FIXED, 'Amount, cardholder billing fee'),
  de(9, 'Conversion rate, settlement', 'N', 8, FIXED, 'Conversion rate, settlement'),
  de(10, 'Conversion rate, cardholder billing', 'N', 8, FIXED, 'Conversion rate, cardholder billing'),
  de(11, 'System trace audit number (STAN)', 'N', 6, FIXED, 'System trace audit number'),
  de(12, 'Time, local transaction', 'N', 6, FIXED, 'Time, local transaction (HHmmss)'),
  de(13, 'Date, local transaction', 'N', 4, FIXED, 'Date, local transaction (MMDD)'),
  de(14, 'Date, expiration', 'N', 4, FIXED, 'Date, expiration'),
  de(15, 'Date, settlement', 'N', 4, FIXED, 'Date, settlement'),
  de(16, 'Date, conversion', 'N', 4, FIXED, 'Date, conversion'),
  de(17, 'Date, capture', 'N', 4, FIXED, 'Date, capture'),
  de(18, 'Merchant type', 'N', 4, FIXED, 'Merchant type (MCC)'),
  de(19, 'Acquiring institution country code', 'N', 3, FIXED, 'Acquiring institution country code'),
  de(20, 'PAN extended, country code', 'N', 3, FIXED, 'PAN extended, country code'),
  de(21, 'Forwarding institution country code', 'N', 3, FIXED, 'Forwarding institution, country code'),
  de(22, 'Point of service entry mode', 'N', 3, FIXED, 'Point of service entry mode'),
  de(23, 'Application PAN sequence number', 'N', 3, FIXED, 'Application PAN sequence number'),
  de(24, 'Function code', 'N', 3, FIXED, 'Function code (ISO 8583:1987 only; ISO network international identifier in 1993)'),
  de(25, 'Point of service condition code', 'N', 2, FIXED, 'Point of service condition code'),
  de(26, 'Point of service capture code', 'N', 2, FIXED, 'Point of service capture code'),
  de(27, 'Authorizing identification response length', 'N', 1, FIXED, 'Authorizing identification response length'),
  de(28, 'Amount, transaction fee', 'N', 9, FIXED, 'Amount, transaction fee'),
  de(29, 'Amount, settlement fee', 'N', 9, FIXED, 'Amount, settlement fee'),
  de(30, 'Amount, transaction processing fee', 'N', 9, FIXED, 'Amount, transaction processing fee'),
  de(31, 'Amount, settlement processing fee', 'N', 9, FIXED, 'Amount, settlement processing fee'),
  de(32, 'Acquiring institution identification code', 'N', 11, LLVAR, 'Acquiring institution identification code'),
  de(33, 'Forwarding institution identification code', 'N', 11, LLVAR, 'Forwarding institution identification code'),
  de(34, 'Primary account number, extended', 'NS', 28, LLVAR, 'Primary account number, extended', 'PAN'),
  de(35, 'Track 2 data', 'Z', 37, LLVAR, 'Track 2 data', 'SAD'),
  de(36, 'Track 3 data', 'N', 104, LLLVAR, 'Track 3 data', 'SAD'),
  de(37, 'Retrieval reference number', 'AN', 12, FIXED, 'Retrieval reference number'),
  de(38, 'Authorization identification response', 'AN', 6, FIXED, 'Authorization identification response'),
  de(39, 'Response code', 'AN', 2, FIXED, 'Response code'),
  de(40, 'Service restriction code', 'AN', 3, FIXED, 'Service restriction code'),
  de(41, 'Card acceptor terminal identification', 'ANS', 8, FIXED, 'Card acceptor terminal identification'),
  de(42, 'Card acceptor identification code', 'ANS', 15, FIXED, 'Card acceptor identification code'),
  de(43, 'Card acceptor name / location', 'ANS', 40, FIXED, 'Card acceptor name / location (1-23 address, 24-36 city, 37-38 state, 39-40 country)'),
  de(44, 'Additional response data', 'AN', 25, LLVAR, 'Additional response data'),
  de(45, 'Track 1 data', 'ANS', 76, LLVAR, 'Track 1 data', 'SAD'),
  de(46, 'Additional data — ISO', 'AN', 999, LLLVAR, 'Additional data — ISO'),
  de(47, 'Additional data — national', 'AN', 999, LLLVAR, 'Additional data — national'),
  de(48, 'Additional data — private', 'AN', 999, LLLVAR, 'Additional data — private', 'SENSITIVE'),
  de(49, 'Currency code, transaction', 'AN', 3, FIXED, 'Currency code, transaction'),
  de(50, 'Currency code, settlement', 'AN', 3, FIXED, 'Currency code, settlement'),
  de(51, 'Currency code, cardholder billing', 'AN', 3, FIXED, 'Currency code, cardholder billing'),
  de(52, 'Personal identification number (PIN) data', 'B', 8, FIXED, 'Personal identification number data (encrypted PIN block)', 'SAD'),
  de(53, 'Security related control information', 'B', 48, FIXED, 'Security related control information (key/session data)', 'SENSITIVE'),
  de(54, 'Additional amounts', 'AN', 120, LLLVAR, 'Additional amounts', 'SENSITIVE'),
  de(55, 'ICC data (EMV)', 'B', 999, LLLVAR, 'Integrated circuit card data / EMV DE55', 'SAD'),
  de(56, 'Reserved (ISO)', 'AN', 999, LLLVAR, RESERVED_ISO),
  de(57, 'Reserved (ISO)', 'AN', 999, LLLVAR, RESERVED_ISO),
  de(58, 'Reserved (ISO)', 'AN', 999, LLLVAR, RESERVED_ISO),
  de(59, 'Reserved (ISO)', 'AN', 999, LLLVAR, RESERVED_ISO),
  de(60, 'Reserved (ISO)', 'AN', 999, LLLVAR, RESERVED_ISO),
  de(61, 'Reserved (private)', 'AN', 999, LLLVAR, RESERVED_PRIVATE),
  de(62, 'Reserved (private)', 'AN', 999, LLLVAR, RESERVED_PRIVATE),
  de(63, 'Reserved (private)', 'AN', 999, LLLVAR, RESERVED_PRIVATE),
  de(64, 'Message authentication code (MAC)', 'B', 8, FIXED, 'Message authentication code (primary bitmap)', 'SENSITIVE'),
  de(65, 'Bitmap, extended', 'B', 8, FIXED, 'Bit map, extended'),
  de(66, 'Settlement code', 'N', 1, FIXED, 'Settlement code'),
  de(67, 'Extended payment code', 'N', 2, FIXED, 'Extended payment code'),
  de(68, 'Receiving institution country code', 'N', 3, FIXED, 'Receiving institution country code'),
  de(69, 'Settlement institution country code', 'N', 3, FIXED, 'Settlement institution country code'),
  de(70, 'Network management information code', 'N', 3, FIXED, 'Network management information code'),
  de(71, 'Message number', 'N', 4, FIXED, 'Message number'),
  de(72, 'Message number, last', 'N', 4, FIXED, 'Message number, last'),
  de(73, 'Date, action', 'N', 6, FIXED, 'Date, action (YYMMDD)'),
  de(74, 'Credits, number', 'N', 10, FIXED, 'Credits, number'),
  de(75, 'Credits, reversal number', 'N', 10, FIXED, 'Credits, reversal number'),
  de(76, 'Debits, number', 'N', 10, FIXED, 'Debits, number'),
  de(77, 'Debits, reversal number', 'N', 10, FIXED, 'Debits, reversal number'),
  de(78, 'Transfer number', 'N', 10, FIXED, 'Transfer number'),
  de(79, 'Transfer, reversal number', 'N', 10, FIXED, 'Transfer, reversal number'),
  de(80, 'Inquiries number', 'N', 10, FIXED, 'Inquiries number'),
  de(81, 'Authorizations, number', 'N', 10, FIXED, 'Authorizations, number'),
  de(82, 'Credits, processing fee amount', 'N', 12, FIXED, 'Credits, processing fee amount'),
  de(83, 'Credits, transaction fee amount', 'N', 12, FIXED, 'Credits, transaction fee amount'),
  de(84, 'Debits, processing fee amount', 'N', 12, FIXED, 'Debits, processing fee amount'),
  de(85, 'Debits, transaction fee amount', 'N', 12, FIXED, 'Debits, transaction fee amount'),
  de(86, 'Credits, amount', 'N', 16, FIXED, 'Credits, amount'),
  de(87, 'Credits, reversal amount', 'N', 16, FIXED, 'Credits, reversal amount'),
  de(88, 'Debits, amount', 'N', 16, FIXED, 'Debits, amount'),
  de(89, 'Debits, reversal amount', 'N', 16, FIXED, 'Debits, reversal amount'),
  de(90, 'Original data elements', 'N', 42, FIXED, 'Original data elements'),
  de(91, 'File update code', 'AN', 1, FIXED, 'File update code'),
  de(92, 'File security code', 'AN', 2, FIXED, 'File security code'),
  de(93, 'Response indicator', 'AN', 5, FIXED, 'Response indicator'),
  de(94, 'Service indicator', 'AN', 7, FIXED, 'Service indicator'),
  de(95, 'Replacement amounts', 'AN', 42, FIXED, 'Replacement amounts'),
  de(96, 'Message security code', 'B', 8, FIXED, 'Message security code', 'SENSITIVE'),
  de(97, 'Amount, net settlement', 'N', 16, FIXED, 'Amount, net settlement'),
  de(98, 'Payee', 'ANS', 25, FIXED, 'Payee'),
  de(99, 'Settlement institution identification code', 'N', 11, LLVAR, 'Settlement institution identification code'),
  de(100, 'Receiving institution identification code', 'N', 11, LLVAR, 'Receiving institution identification code'),
  de(101, 'File name', 'ANS', 17, LLVAR, 'File name'),
  de(102, 'Account identification 1', 'ANS', 28, LLVAR, 'Account identification 1'),
  de(103, 'Account identification 2', 'ANS', 28, LLVAR, 'Account identification 2'),
  de(104, 'Transaction description', 'ANS', 100, LLLVAR, 'Transaction description'),
  ...range(105, 111, RESERVED_ISO),
  ...range(112, 119, RESERVED_NATIONAL),
  ...range(120, 127, RESERVED_PRIVATE),
  de(128, 'Message authentication code, extended', 'B', 8, FIXED, 'Message authentication code (secondary bitmap)', 'SENSITIVE'),
];

const BY_FIELD = new Map<number, IsoDataElement>(ISO_DATA_ELEMENTS.map((entry) => [entry.field, entry]));

/** Look up a data element by its DE number. */
export function getDataElement(field: number): IsoDataElement | null {
  return BY_FIELD.get(Number(field)) || null;
}

/** Human-readable description, e.g. `DE39 Response code (AN, 2, FIXED)`. */
export function describeDataElement(field: number): string {
  const entry = getDataElement(field);
  if (!entry) return `DE${field} <unknown>`;
  const variable = entry.variable === 'FIXED' ? '' : ` ${entry.variable}`;
  return `DE${field} ${entry.name} (${entry.type}, ${entry.length}${variable})`;
}

/**
 * Data elements that carry sensitive authentication data or the PAN, i.e. the
 * elements that must be masked or dropped before logging, persisting or
 * displaying a message.
 */
export function sensitiveDataElements(): IsoDataElement[] {
  return ISO_DATA_ELEMENTS.filter((entry) => entry.sensitivity === 'PAN' || entry.sensitivity === 'SAD');
}

/** True when the data element is PAN or sensitive authentication data. */
export function isSensitiveDataElement(field: number): boolean {
  const entry = getDataElement(field);
  return !!entry && (entry.sensitivity === 'PAN' || entry.sensitivity === 'SAD');
}

export type IsoMessageFields = Record<number | string, string | Buffer | undefined>;

export interface RedactedMessageFields {
  /** Redacted element values keyed by DE number. */
  fields: Record<number, string>;
  /** DE numbers that were masked or dropped. */
  redacted: number[];
}

/**
 * Produce a log-safe copy of message fields:
 *  - PAN (DE2/DE34) is masked, keeping the first 6 and last 4 digits;
 *  - sensitive authentication data (DE35/DE36/DE45 tracks, DE52 PIN block,
 *    DE55 EMV/ICC data) is dropped entirely — PCI DSS forbids storing SAD in
 *    any form, including a placeholder that implies its presence;
 *  - every other sensitive element (MACs, key/session data, balances) is
 *    replaced with `[REDACTED]`.
 *
 * Dropped and redacted DE numbers are reported in `redacted` so an audit trail
 * can record that a field was present without retaining its value.
 */
export function redactMessageFields(fields: IsoMessageFields): RedactedMessageFields {
  const output: Record<number, string> = {};
  const redacted: number[] = [];

  for (const [key, raw] of Object.entries(fields || {})) {
    const field = Number(key);
    if (!Number.isFinite(field) || raw === undefined) continue;

    const entry = getDataElement(field);
    if (!entry || entry.sensitivity === 'NONE') {
      output[field] = Buffer.isBuffer(raw) ? raw.toString('hex') : String(raw);
      continue;
    }

    redacted.push(field);

    if (entry.sensitivity === 'PAN') {
      // DE2 is `N LLVAR` and DE34 is `NS LLVAR`, which tolerates spaces, dashes
      // and its `*` separator/pad. Normalise to digits before masking so the
      // retained first-6 / last-4 are real PAN digits.
      const text = Buffer.isBuffer(raw) ? raw.toString('ascii') : String(raw);
      output[field] = maskPan(text.replace(/\D/g, ''));
      continue;
    }

    if (entry.sensitivity === 'SAD') {
      // PCI DSS: SAD must not be stored or displayed in ANY form. Drop the
      // element from the output entirely rather than writing `[REDACTED]`.
      continue;
    }

    // Internal security data (MACs, key/session info, balances) may be
    // represented, but never reproduced.
    output[field] = '[REDACTED]';
  }

  return { fields: output, redacted };
}
