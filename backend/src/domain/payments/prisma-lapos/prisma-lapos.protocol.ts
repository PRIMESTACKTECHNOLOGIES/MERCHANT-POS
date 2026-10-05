/**
 * PRISMA / LaPos Integrated Visa POS — Serial Protocol Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the complete wire format described in:
 *   "Technical and Functional Specifications — Integrated Visa POS Protocol"
 *   (PRISMA Payment Methods / LaPos Network Business Management, rev 1.09)
 *
 * Packet structure:
 *   STX(0x02) + COMMAND(3 bytes ASCII) + LENGTH(2 bytes LE hex) + FIELDS + ETX(0x03) + XOR_CRC(1 byte)
 *
 * Link layer handshake (RS232 / TCP):
 *   Box sends ENQ (0x05) → POS responds ACK (0x06)
 *   Box sends packet → POS responds ACK (0x06) then response packet
 *   Box responds ACK (0x06) to confirm receipt
 *
 * All field lengths are in bytes (ASCII characters).
 * XOR CRC covers STX through ETX inclusive (excludes the STX byte per spec example).
 *
 * Commands (Annex 2):
 *   TES — Connection test           VEN — Sale
 *   ANV — Sale cancellation         DEV — Return (refund)
 *   AND — Return cancellation       CIE — Closure (end-of-day batch close)
 *   ULT — Last transaction data     ULC — Last closing data
 *   IMT — Reprint last transaction  IMC — Reprint last closing
 *   TAR — Obtain card table         PLA — Obtain plan table
 *
 * Response code 00 = approved (all commands).
 */

// ── Control bytes ─────────────────────────────────────────────────────────────
export const STX = 0x02;
export const ETX = 0x03;
export const ENQ = 0x05;
export const ACK = 0x06;
export const NAK = 0x15;

// ── Command names ─────────────────────────────────────────────────────────────
export const CMD = {
  TEST:            'TES',
  SALE:            'VEN',
  SALE_CANCEL:     'ANV',
  RETURN:          'DEV',
  RETURN_CANCEL:   'AND',
  CLOSE:           'CIE',
  LAST_TXN:        'ULT',
  LAST_CLOSE:      'ULC',
  REPRINT_TXN:     'IMT',
  REPRINT_CLOSE:   'IMC',
  CARD_TABLE:      'TAR',
  PLAN_TABLE:      'PLA',
} as const;

export type CommandName = typeof CMD[keyof typeof CMD];

// ── General / specific response codes (Annex 1 + 3) ──────────────────────────
export const RESPONSE_CODES: Record<string, string> = {
  '00': 'Approved',
  '01': 'Records pending — more to fetch',
  '08': 'Approved (request identification)',
  '11': 'Approved',
  '85': 'Approved — lot not found',
  '88': 'Approved — call client',
  '102': 'Ticket not found',
  '103': 'Plan code not found',
  '104': 'Registration index not found',
  '201': 'Transaction cancelled by user',
  '202': 'Card swiped does not match requested',
  '203': 'Card swiped is not valid',
  '204': 'Card expired',
  '205': 'Original transaction does not exist',
  '206': 'No transactions in batch',
  '301': 'POS could not communicate with host',
  '302': 'POS could not print ticket',
  '901': 'Non-existent command',
  '902': 'Invalid parameter length',
  '903': 'Invalid parameter format',
  '909': 'General operation error',
  // Host response codes (Annex 3)
  '04': 'Capture card — denied',
  '05': 'Denied',
  '12': 'Invalid transaction',
  '13': 'Invalid amount',
  '14': 'Invalid card',
  '30': 'Format error',
  '38': 'PIN attempts exceeded',
  '43': 'Capture card',
  '51': 'Insufficient funds',
  '54': 'Expired card',
  '55': 'Incorrect PIN',
  '57': 'Transaction not permitted',
  '91': 'Issuer offline',
  '96': 'System error',
};

export function describeResponseCode(code: string): string {
  return RESPONSE_CODES[String(code)] || `Unknown code ${code}`;
}

export function isApproved(responseCode: string): boolean {
  return ['00', '08', '11', '85', '88'].includes(String(responseCode).trim());
}

// ── XOR CRC calculation ───────────────────────────────────────────────────────
/**
 * XOR of all bytes from (but NOT including) STX up to and including ETX.
 * Per spec: "XOR SUM COMPLETE PACKAGE WITHOUT STX"
 */
export function calculateXorCrc(packet: Buffer): number {
  // packet = STX + CMD(3) + LEN(2) + FIELDS + ETX
  // XOR from index 1 (first byte after STX) through last byte (ETX)
  let crc = 0;
  for (let i = 1; i < packet.length; i++) {
    crc ^= packet[i];
  }
  return crc;
}

// ── Packet builder ────────────────────────────────────────────────────────────
/**
 * Build a complete framed packet:
 *   STX + CMD(3) + LEN_HI + LEN_LO + FIELDS... + ETX + XOR_CRC
 *
 * LENGTH is 2 bytes little-endian hex of the fields byte-length.
 * Example: 104 bytes → 0x68, 0x00
 */
export function buildPacket(command: CommandName, fields: string): Buffer {
  const cmdBytes  = Buffer.from(command, 'ascii'); // 3 bytes
  const fieldsBuf = Buffer.from(fields, 'ascii');
  const len       = fieldsBuf.length;

  // Length: 2 bytes, low byte first (little-endian)
  const lenLo = len & 0xFF;
  const lenHi = (len >> 8) & 0xFF;

  // Pre-XOR packet: STX + CMD + LEN_LO + LEN_HI + FIELDS + ETX
  const inner = Buffer.concat([
    Buffer.from([STX]),
    cmdBytes,
    Buffer.from([lenLo, lenHi]),
    fieldsBuf,
    Buffer.from([ETX]),
  ]);

  const crc = calculateXorCrc(inner);
  return Buffer.concat([inner, Buffer.from([crc])]);
}

/** Build an empty-fields packet (e.g. TES, CIE, IMT, IMC) */
export function buildEmptyPacket(command: CommandName): Buffer {
  return buildPacket(command, '');
}

// ── Packet parser ─────────────────────────────────────────────────────────────
export interface ParsedResponse {
  command:      CommandName;
  responseCode: string;   // positions 0-1 of fields
  fields:       string;   // raw field string
  crcValid:     boolean;
  approved:     boolean;
  message:      string;
}

/**
 * Parse a response packet received from the POS.
 * Format: ACK(0x06) + STX(0x02) + CMD(3) + LEN(2) + FIELDS + ETX(0x03) + XOR_CRC
 * The ACK at the front is consumed before calling this.
 */
export function parseResponsePacket(raw: Buffer): ParsedResponse {
  // Strip leading ACK bytes if present
  let offset = 0;
  while (offset < raw.length && raw[offset] === ACK) offset++;

  if (raw.length < offset + 7) {
    throw new Error(`PRISMA response too short (${raw.length} bytes)`);
  }

  if (raw[offset] !== STX) {
    throw new Error(`PRISMA response missing STX (got 0x${raw[offset].toString(16).padStart(2,'0')})`);
  }

  const cmdStr   = raw.slice(offset + 1, offset + 4).toString('ascii') as CommandName;
  const lenLo    = raw[offset + 4];
  const lenHi    = raw[offset + 5];
  const fieldLen = lenLo | (lenHi << 8);

  const fieldsStart = offset + 6;
  const fieldsEnd   = fieldsStart + fieldLen;

  if (raw.length < fieldsEnd + 2) {
    throw new Error(`PRISMA response truncated — expected ${fieldsEnd + 2} bytes, got ${raw.length}`);
  }

  const etxPos  = fieldsEnd;
  const crcPos  = fieldsEnd + 1;
  const fields  = raw.slice(fieldsStart, fieldsEnd).toString('ascii');

  if (raw[etxPos] !== ETX) {
    throw new Error(`PRISMA response missing ETX at position ${etxPos}`);
  }

  // Verify CRC: XOR of bytes from STX+1 through ETX
  const packetForCrc = raw.slice(offset, crcPos);
  const expectedCrc  = calculateXorCrc(packetForCrc);
  const receivedCrc  = raw[crcPos];
  const crcValid     = expectedCrc === receivedCrc;

  // Response code = first 2 characters of fields
  const responseCode = fields.slice(0, 2).trim();

  return {
    command: cmdStr,
    responseCode,
    fields,
    crcValid,
    approved: isApproved(responseCode),
    message: describeResponseCode(responseCode),
  };
}

// ── Field padding helpers ─────────────────────────────────────────────────────
/** Numeric field: right-aligned, zero-padded to `len` */
export function numField(value: string | number, len: number): string {
  return String(value ?? '').padStart(len, '0').slice(0, len);
}

/** Alpha field: left-aligned, space-padded to `len` */
export function alphaField(value: string, len: number): string {
  return String(value ?? '').padEnd(len, ' ').slice(0, len);
}

/**
 * Amount field: 12 digits, last 2 are decimals.
 * e.g. 100.50 ARS → "000000010050"
 */
export function amountField(amount: number): string {
  const minor = Math.round(amount * 100);
  return String(minor).padStart(12, '0').slice(0, 12);
}

// ── Command field builders ────────────────────────────────────────────────────
// All based on the field specifications from the PRISMA Technical Spec rev 1.09

/**
 * VEN (Sale) — 104 bytes input
 * Pos  Len  Format  Description
 *  0   12   N       Amount (last 2 = decimals)
 * 12   12   N       Invoice number (zero-padded)
 * 24    2   N       Installment count (right-aligned, zero-padded)
 * 26    3   N       Card code (right-aligned, zero-padded)  e.g. "0VI" "0MC"
 * 29    1   N       Plan code (right-aligned, zero-padded)
 * 30   12   N       Tip amount (last 2 = decimals)
 * 42   15   A       Commerce code (left-aligned, space-padded)
 * 57   23   A       Commerce name (left-aligned, space-padded)
 * 80   23   A       Commerce tax ID / CUIT (left-aligned, space-padded)
 * 103   1   N       Online mode: '1' = online, '0' = offline
 */
export interface VenInput {
  amount:        number;       // major units e.g. 100.50
  invoiceNumber: string;
  installments:  number;       // 1 = single payment
  cardCode:      string;       // 'VI', 'MC', 'VVI', etc.
  planCode:      string;       // '0' = default
  tipAmount?:    number;
  commerceCode?: string;
  commerceName?: string;
  commerceTaxId?: string;
  online?:       boolean;
}

export function buildVenFields(input: VenInput): string {
  return [
    amountField(input.amount),
    numField(input.invoiceNumber, 12),
    numField(input.installments, 2),
    numField(input.cardCode, 3),
    numField(input.planCode, 1),
    amountField(input.tipAmount ?? 0),
    alphaField(input.commerceCode  ?? '', 15),
    alphaField(input.commerceName  ?? '', 23),
    alphaField(input.commerceTaxId ?? '', 23),
    input.online === false ? '0' : '1',
  ].join('');
}

/**
 * ANV (Sale Cancellation) — 10 bytes input
 * Pos  Len  Format  Description
 *  0    7   N       Coupon number of original transaction
 *  7    3   N       Card code
 */
export interface AnvInput {
  couponNumber: string;
  cardCode:     string;
}

export function buildAnvFields(input: AnvInput): string {
  return numField(input.couponNumber, 7) + numField(input.cardCode, 3);
}

/**
 * DEV (Return / Refund) — 109 bytes input
 * Pos  Len  Format  Description
 *  0   12   N       Amount
 * 12    3   N       Card code
 * 15    1   N       Plan code
 * 16    2   N       Installment count
 * 18    7   N       Original coupon number
 * 25   10   A       Original transaction date (DD/MM/YYYY)
 * 35   12   N       Invoice number
 * 47   15   A       Commerce code
 * 62   23   A       Commerce name
 * 85   23   A       Commerce tax ID
 * 108   1   N       Online mode
 */
export interface DevInput {
  amount:             number;
  cardCode:           string;
  planCode:           string;
  installments:       number;
  originalCoupon:     string;
  originalDate:       string;   // DD/MM/YYYY
  invoiceNumber:      string;
  commerceCode?:      string;
  commerceName?:      string;
  commerceTaxId?:     string;
  online?:            boolean;
}

export function buildDevFields(input: DevInput): string {
  return [
    amountField(input.amount),
    numField(input.cardCode, 3),
    numField(input.planCode, 1),
    numField(input.installments, 2),
    numField(input.originalCoupon, 7),
    alphaField(input.originalDate, 10),
    numField(input.invoiceNumber, 12),
    alphaField(input.commerceCode  ?? '', 15),
    alphaField(input.commerceName  ?? '', 23),
    alphaField(input.commerceTaxId ?? '', 23),
    input.online === false ? '0' : '1',
  ].join('');
}

/**
 * AND (Return Cancellation) — 10 bytes input
 * Same layout as ANV
 */
export interface AndInput {
  couponNumber: string;
  cardCode:     string;
}

export function buildAndFields(input: AndInput): string {
  return numField(input.couponNumber, 7) + numField(input.cardCode, 3);
}

/**
 * ULC (Last Closing Data) — 4 bytes input
 * Pos  Len  Format  Description
 *  0    4   N       Record index (starting from 0, right-aligned, zero-padded)
 */
export function buildUlcFields(index: number): string {
  return numField(index, 4);
}

/**
 * TAR (Card Table) — 4 bytes input
 */
export function buildTarFields(index: number): string {
  return numField(index, 4);
}

/**
 * PLA (Plan Table) — 4 bytes input
 */
export function buildPlaFields(index: number): string {
  return numField(index, 4);
}

// ── Response field parsers ────────────────────────────────────────────────────
export interface VenResponse {
  responseCode:    string;
  responseMessage: string;
  authCode:        string;   // 6 chars
  couponNumber:    string;   // 7 chars
  batchNumber:     string;   // 3 chars
  clientName:      string;   // 26 chars
  cardLast4:       string;   // 4 chars
  cardFirst6:      string;   // 6 chars
  txnDate:         string;   // 10 chars DD/MM/YYYY
  txnTime:         string;   // 8 chars HH:MM:SS
  terminalId:      string;   // 8 chars
  approved:        boolean;
}

/** Parse VEN / ANV / DEV / AND response fields (same layout: 104+ bytes) */
export function parseVenResponse(fields: string): VenResponse {
  return {
    responseCode:    fields.slice(0, 2).trim(),
    responseMessage: fields.slice(2, 34).trim(),
    authCode:        fields.slice(34, 40).trim(),
    couponNumber:    fields.slice(40, 47).trim(),
    batchNumber:     fields.slice(47, 50).trim(),
    clientName:      fields.slice(50, 76).trim(),
    cardLast4:       fields.slice(76, 80).trim(),
    cardFirst6:      fields.slice(80, 86).trim(),
    txnDate:         fields.slice(86, 96).trim(),
    txnTime:         fields.slice(96, 104).trim(),
    terminalId:      fields.slice(104).trim(),
    approved:        isApproved(fields.slice(0, 2).trim()),
  };
}

export interface CieResponse {
  responseCode: string;
  date:         string;
  time:         string;
  terminalId:   string;
  approved:     boolean;
}

export function parseCieResponse(fields: string): CieResponse {
  return {
    responseCode: fields.slice(0, 2).trim(),
    date:         fields.slice(2, 12).trim(),
    time:         fields.slice(12, 20).trim(),
    terminalId:   fields.slice(20).trim(),
    approved:     isApproved(fields.slice(0, 2).trim()),
  };
}

export interface UltResponse {
  txnType:         string;   // '1'=Sale,'2'=Cancel,'3'=Return,'4'=ReturnCancel
  responseCode:    string;
  responseMessage: string;
  authCode:        string;
  couponNumber:    string;
  batchNumber:     string;
  clientName:      string;
  cardFirst6:      string;
  cardLast4:       string;
  txnDate:         string;
  txnTime:         string;
  terminalId:      string;
  approved:        boolean;
}

export function parseUltResponse(fields: string): UltResponse {
  return {
    txnType:         fields.slice(0, 1).trim(),
    responseCode:    fields.slice(1, 3).trim(),
    responseMessage: fields.slice(3, 35).trim(),
    authCode:        fields.slice(35, 41).trim(),
    couponNumber:    fields.slice(41, 48).trim(),
    batchNumber:     fields.slice(48, 51).trim(),
    clientName:      fields.slice(51, 77).trim(),
    cardFirst6:      fields.slice(77, 83).trim(),
    cardLast4:       fields.slice(83, 87).trim(),
    txnDate:         fields.slice(87, 97).trim(),
    txnTime:         fields.slice(97, 105).trim(),
    terminalId:      fields.slice(105).trim(),
    approved:        isApproved(fields.slice(1, 3).trim()),
  };
}

export interface TarResponse {
  recordIndex:     string;
  processorCode:   string;
  cardCode:        string;
  cardName:        string;
  maxInstallments: string;
  terminalId:      string;
  hasMore:         boolean;   // true when response starts with ..TAR001 (not last record)
}

export function parseTarResponse(fields: string, responseCode: string): TarResponse {
  return {
    recordIndex:     fields.slice(0, 4).trim(),
    processorCode:   fields.slice(4, 7).trim(),
    cardCode:        fields.slice(7, 10).trim(),
    cardName:        fields.slice(10, 26).trim(),
    maxInstallments: fields.slice(26, 28).trim(),
    terminalId:      fields.slice(28).trim(),
    hasMore:         responseCode === '01',
  };
}

export interface PlaResponse {
  recordIndex: string;
  cardCode:    string;
  planCode:    string;
  planName:    string;
  terminalId:  string;
  hasMore:     boolean;
}

export function parsePlaResponse(fields: string, responseCode: string): PlaResponse {
  return {
    recordIndex: fields.slice(0, 4).trim(),
    cardCode:    fields.slice(4, 7).trim(),
    planCode:    fields.slice(7, 9).trim(),
    planName:    fields.slice(9, 23).trim(),
    terminalId:  fields.slice(23).trim(),
    hasMore:     responseCode === '01',
  };
}
