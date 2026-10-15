/**
 * ISO 8583 Message Type Identifier (MTI) catalog.
 *
 * Source: ISO 8583 MTI / data-element reference captured in
 * NEW IMPLEMENTS/fa56ec0f1a8b5c55.pdf.
 *
 * The MTI is four digits:
 *   position 1 → ISO 8583 version
 *   position 2 → message class
 *   position 3 → message function
 *   position 4 → message origin
 */

export type Iso8583Version =
  | '1987'
  | '1993'
  | '2003';

export type Iso8583Class =
  | 'AUTHORIZATION'
  | 'FINANCIAL'
  | 'FILE_UPDATE'
  | 'REVERSAL'
  | 'RECONCILIATION'
  | 'ADMINISTRATIVE'
  | 'FEE_COLLECTION'
  | 'NETWORK_MANAGEMENT'
  | 'UNKNOWN';

export type Iso8583Function =
  | 'REQUEST'
  | 'REQUEST_RESPONSE'
  | 'ADVICE'
  | 'ADVICE_RESPONSE'
  | 'NOTIFICATION'
  | 'INSTRUCTION'
  | 'UNKNOWN';

export type Iso8583Origin = 'ACQUIRER' | 'ACQUIRER_REPEAT' | 'ISSUER' | 'ISSUER_REPEAT' | 'OTHER';

export interface MtiDescription {
  mti: string;
  version: Iso8583Version;
  messageClass: Iso8583Class;
  fn: Iso8583Function;
  origin: Iso8583Origin;
  meaning: string;
}

const VERSION_BY_DIGIT: Record<string, Iso8583Version> = {
  '0': '1987',
  '1': '1993',
  '2': '2003',
};

const CLASS_BY_DIGIT: Record<string, Iso8583Class> = {
  '1': 'AUTHORIZATION',
  '2': 'FINANCIAL',
  '3': 'FILE_UPDATE',
  '4': 'REVERSAL',
  '5': 'RECONCILIATION',
  '6': 'ADMINISTRATIVE',
  '7': 'FEE_COLLECTION',
  '8': 'NETWORK_MANAGEMENT',
  '9': 'UNKNOWN',
};

const FUNCTION_BY_DIGIT: Record<string, Iso8583Function> = {
  '0': 'REQUEST',
  '1': 'REQUEST_RESPONSE',
  '2': 'ADVICE',
  '3': 'ADVICE_RESPONSE',
  '4': 'NOTIFICATION',
  '5': 'INSTRUCTION',
  '8': 'INSTRUCTION',
  '9': 'NOTIFICATION',
};

const ORIGIN_BY_DIGIT: Record<string, Iso8583Origin> = {
  '0': 'ACQUIRER',
  '1': 'ACQUIRER_REPEAT',
  '2': 'ISSUER',
  '3': 'ISSUER_REPEAT',
  '4': 'OTHER',
  '5': 'OTHER',
};

/** Catalog of MTIs used by the processor and its scheme hosts. */
export const MTI_CATALOG: Readonly<Record<string, string>> = {
  '0100': 'Authorization Request',
  '0110': 'Authorization Request Response',
  '0120': 'Authorization Advice',
  '0121': 'Authorization Advice Repeat',
  '0130': 'Authorization Advice Response',
  '0200': 'Acquirer Financial Request',
  '0210': 'Issuer Financial Request Response',
  '0220': 'Acquirer Financial Advice',
  '0221': 'Acquirer Financial Advice Repeat',
  '0230': 'Issuer Financial Advice Response',
  '0320': 'Batch Upload / File Update Advice',
  '0330': 'Batch Upload / File Update Advice Response',
  '0400': 'Acquirer Reversal Request',
  '0410': 'Issuer Reversal Request Response',
  '0420': 'Acquirer Reversal Advice',
  '0421': 'Acquirer Reversal Advice Repeat',
  '0430': 'Issuer Reversal Advice Response',
  '0500': 'Batch Settlement Request',
  '0510': 'Batch Settlement Request Response',
  '0520': 'Batch Settlement Advice',
  '0530': 'Batch Settlement Advice Response',
  '0800': 'Network Management Request',
  '0810': 'Network Management Response',
  '0820': 'Network Management Advice',
  '0830': 'Network Management Advice Response',
};

const MTI_PATTERN = /^\d{4}$/;

/** Parse an MTI into its standard components. Throws on a malformed MTI. */
export function parseMti(mti: string): MtiDescription {
  const value = String(mti || '').trim();
  if (!MTI_PATTERN.test(value)) {
    throw new Error('MTI_MUST_BE_4_DIGITS');
  }

  return {
    mti: value,
    version: VERSION_BY_DIGIT[value[0]] || '1987',
    messageClass: (CLASS_BY_DIGIT[value[1]] as Iso8583Class) || 'UNKNOWN',
    fn: (FUNCTION_BY_DIGIT[value[2]] as Iso8583Function) || 'UNKNOWN',
    origin: (ORIGIN_BY_DIGIT[value[3]] as Iso8583Origin) || 'OTHER',
    meaning: MTI_CATALOG[value] || 'Unknown message type',
  };
}

/** Human-readable description of an MTI, falling back to component parsing. */
export function describeMti(mti: string): string {
  try {
    return parseMti(mti).meaning;
  } catch {
    return 'Invalid MTI';
  }
}

/** True when the MTI denotes a response message (function digit 1 or 3). */
export function isResponseMti(mti: string): boolean {
  const fn = String(mti || '')[2];
  return fn === '1' || fn === '3';
}

/** True when the MTI denotes an advice message (function digit 2). */
export function isAdviceMti(mti: string): boolean {
  return String(mti || '')[2] === '2';
}

/** Build the matching response MTI for a request/advice MTI. */
export function responseMtiFor(mti: string): string {
  const value = String(mti || '').trim();
  if (!MTI_PATTERN.test(value)) throw new Error('MTI_MUST_BE_4_DIGITS');
  const fn = value[2];
  const responseFunction = fn === '0' ? '1' : fn === '2' ? '3' : fn;
  return `${value.slice(0, 2)}${responseFunction}${value[3]}`;
}
