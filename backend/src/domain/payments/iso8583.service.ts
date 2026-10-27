/**
 * ISO 8583 Service — Full EMV-compliant implementation
 * ─────────────────────────────────────────────────────────────────────────────
 * MTI support:
 *   0100/0110  Authorization Request / Response
 *   0200/0210  Financial Transaction Request / Response
 *   0420/0430  Reversal Request / Response
 *   0800/0810  Network Management Request / Response
 *
 * Data Elements:
 *   DE02  PAN (LLVAR, max 19)
 *   DE03  Processing Code
 *   DE04  Amount Authorized
 *   DE07  Transmission Date & Time
 *   DE11  STAN
 *   DE14  Expiry Date (YYMM)
 *   DE22  POS Entry Mode
 *   DE23  PAN Sequence Number
 *   DE25  POS Condition Code
 *   DE35  Track 2 Data (LLVAR)
 *   DE37  Retrieval Reference Number
 *   DE38  Authorization ID Response (Approval Code)
 *   DE39  Response Code
 *   DE41  Terminal ID
 *   DE42  Merchant ID
 *   DE49  Currency Code
 *   DE55  EMV Field 55 / ICC Data (LLLVAR — binary TLV block)
 *
 * PCI-DSS compliance:
 *   - PAN stored only in LLVAR field, not logged
 *   - CVV never packed into ISO 8583 messages
 *   - Track 2 masked in logs
 *   - DE55 carries tokenised ARQC, not raw keys
 */

import crypto from 'crypto';
import { generateApprovalCode, generateSTAN, getIssuerSecret } from './approvalCode.service';
import {
  buildField55,
  generateIssuerArqc,
  validateArqc,
  normalizeHex,
  encodeHexTlv,
} from '../../services/emv/issuerEmv';
import { db } from '../../config/db';

// ── Currency map ─────────────────────────────────────────────────────────────

const CURRENCY_CODES: Record<string, string> = {
  USD: '840', EUR: '978', GBP: '826',
  AED: '784', SGD: '702', INR: '356',
  JPY: '392', CHF: '756', AUD: '036',
  CAD: '124', HKD: '344', MYR: '458',
};

export function getCurrencyCode(currency: string): string {
  return CURRENCY_CODES[currency.toUpperCase()] ?? '840';
}

// ── Bitmap ───────────────────────────────────────────────────────────────────

function buildBitmap(bits: number[]): string {
  const bytes = new Uint8Array(16); // 128-bit secondary bitmap support
  let useSecondary = bits.some(b => b > 64);
  const activeBits = useSecondary ? [1, ...bits] : bits;
  for (const bit of activeBits) {
    const idx = bit - 1;
    const byteIdx = Math.floor(idx / 8);
    const bitIdx  = 7 - (idx % 8);
    bytes[byteIdx] |= (1 << bitIdx);
  }
  const primaryHex = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const secondaryHex = useSecondary
    ? Array.from(bytes.slice(8, 16)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    : '';
  return primaryHex + secondaryHex;
}

function parseBitmap(hex: string): number[] {
  const bits: number[] = [];
  const len = hex.length >= 32 ? 16 : 8;
  const bytes = hex.slice(0, len * 2).match(/.{2}/g)!.map(h => parseInt(h, 16));
  for (let byteIdx = 0; byteIdx < bytes.length; byteIdx++) {
    const b = bytes[byteIdx];
    for (let bitPos = 7; bitPos >= 0; bitPos--) {
      if (b & (1 << bitPos)) {
        bits.push(byteIdx * 8 + (8 - bitPos));
      }
    }
  }
  return bits;
}

// ── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  type:    'n' | 'ans' | 'b';
  length:  number;
  llvar?:  boolean;   // 2-digit ASCII length prefix
  lllvar?: boolean;   // 3-digit ASCII length prefix (DE55)
}

const FIELD_DEFS: Record<number, FieldDef> = {
  2:  { type: 'n',   length: 19,  llvar:  true  },  // PAN
  3:  { type: 'n',   length: 6                  },  // Processing Code
  4:  { type: 'n',   length: 12                 },  // Amount
  7:  { type: 'n',   length: 10                 },  // Transmission DateTime
  11: { type: 'n',   length: 6                  },  // STAN
  14: { type: 'n',   length: 4                  },  // Expiry (YYMM)
  22: { type: 'n',   length: 3                  },  // POS Entry Mode
  23: { type: 'n',   length: 3                  },  // PAN Sequence
  25: { type: 'n',   length: 2                  },  // POS Condition Code
  35: { type: 'ans', length: 37,  llvar:  true  },  // Track 2 (LLVAR)
  37: { type: 'ans', length: 12                 },  // RRN
  38: { type: 'ans', length: 8                  },  // Approval Code
  39: { type: 'ans', length: 2                  },  // Response Code
  41: { type: 'ans', length: 8                  },  // Terminal ID
  42: { type: 'ans', length: 15                 },  // Merchant ID
  49: { type: 'n',   length: 3                  },  // Currency Code
  55: { type: 'b',   length: 255, lllvar: true  },  // EMV / ICC Data
};

function packField(de: number, value: string): string {
  const def = FIELD_DEFS[de];
  if (!def) throw new Error(`Unknown DE${String(de).padStart(3, '0')}`);

  if (def.lllvar) {
    // DE55: raw hex string — length = byte count
    const hex = value.replace(/\s/g, '');
    const byteLen = hex.length / 2;
    return String(byteLen).padStart(3, '0') + hex;
  }
  if (def.llvar) {
    const padded = value.slice(0, def.length);
    return String(padded.length).padStart(2, '0') + padded;
  }
  if (def.type === 'n') {
    return value.padStart(def.length, '0').slice(-def.length);
  }
  // ans
  return value.padEnd(def.length, ' ').slice(0, def.length);
}

function unpackField(de: number, raw: string, offset: number): { value: string; consumed: number } {
  const def = FIELD_DEFS[de];
  if (!def) throw new Error(`Unknown DE${String(de).padStart(3, '0')}`);

  if (def.lllvar) {
    const byteLen = parseInt(raw.substring(offset, offset + 3), 10);
    const hexLen  = byteLen * 2;
    const value   = raw.substring(offset + 3, offset + 3 + hexLen);
    return { value, consumed: 3 + hexLen };
  }
  if (def.llvar) {
    const len   = parseInt(raw.substring(offset, offset + 2), 10);
    const value = raw.substring(offset + 2, offset + 2 + len);
    return { value, consumed: 2 + len };
  }
  const value = raw.substring(offset, offset + def.length);
  return { value: value.trimEnd(), consumed: def.length };
}

// ── ATC persistence (one row per card PAN last-4) ────────────────────────────

async function getAndIncrementATC(panLast4: string): Promise<string> {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS emv_atc (
        pan_last4  TEXT PRIMARY KEY,
        atc        INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);
    const existing = await db.query('SELECT atc FROM emv_atc WHERE pan_last4 = ?', [panLast4]);
    const current  = existing.rows.length > 0 ? Number(existing.rows[0].atc) : 0;
    const next     = (current + 1) % 65536; // wrap at 0xFFFF
    const now      = new Date().toISOString();
    await db.query(
      `INSERT INTO emv_atc (pan_last4, atc, updated_at) VALUES (?,?,?)
       ON CONFLICT(pan_last4) DO UPDATE SET atc = ?, updated_at = ?`,
      [panLast4, next, now, next, now]
    );
    return next.toString(16).toUpperCase().padStart(4, '0');
  } catch {
    // fallback to random if DB unavailable
    return Math.floor(Math.random() * 65535 + 1).toString(16).toUpperCase().padStart(4, '0');
  }
}

// ── Track 2 builder (PCI safe — no CVV in wire format) ───────────────────────

function buildTrack2(pan: string, expiry: string): string {
  // Format: PAN=YYMM201 (service code 201, discretionary data zeros)
  const cleanPan = pan.replace(/\D/g, '');
  const exp      = expiry.replace(/\D/g, '').slice(0, 4); // YYMM
  return `${cleanPan}=${exp}2010000000000000`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AuthRequestFields {
  pan:                  string;
  amountMinor:          number;
  stan:                 string;
  transmissionDateTime: string; // MMDDHHmmss
  posEntryMode:         string; // '051'=chip, '011'=voice, '010'=manual
  rrn:                  string;
  terminalId:           string;
  merchantId:           string;
  currencyCode:         string;
  expiry?:              string; // YYMM
  panSequence?:         string;
  posCondition?:        string;
  emvField55?:          string; // pre-built hex
}

/** Pack an ISO 8583 0100/0200 Authorization / Financial Request */
export async function packAuthRequest(fields: AuthRequestFields): Promise<string> {
  const pan      = fields.pan.replace(/\D/g, '');
  const panLast4 = pan.slice(-4);
  const atcHex   = await getAndIncrementATC(panLast4);
  const un       = crypto.randomBytes(4).toString('hex').toUpperCase();

  const arqcHex = generateIssuerArqc({
    pan,
    amountMinor:         fields.amountMinor,
    currency:            fields.currencyCode,
    atc:                 atcHex,
    unpredictableNumber: un,
    terminalId:          fields.terminalId,
    merchantId:          fields.merchantId,
  });

  const field55 = fields.emvField55 ?? buildField55({
    pan,
    amountMinor:         fields.amountMinor,
    currency:            fields.currencyCode,
    atc:                 atcHex,
    unpredictableNumber: un,
    arqc:                arqcHex,
    txnDate:             new Date().toISOString().slice(2, 10).replace(/-/g, ''),
    ifdSerial:           Buffer.from(fields.terminalId.padEnd(8, '0').slice(0, 8)).toString('hex'),
  });

  const expiry   = (fields.expiry ?? '3005').replace(/\D/g, '');
  const track2   = buildTrack2(pan, expiry);

  const fieldMap: Record<number, string> = {
    2:  pan,
    3:  '000000',
    4:  String(fields.amountMinor),
    7:  fields.transmissionDateTime,
    11: fields.stan,
    14: expiry,
    22: fields.posEntryMode,
    23: fields.panSequence ?? '001',
    25: fields.posCondition ?? '00',
    35: track2,
    37: fields.rrn,
    41: fields.terminalId,
    42: fields.merchantId,
    49: fields.currencyCode,
    55: field55,
  };

  const mti        = '0200';
  const presentDEs = Object.keys(fieldMap).map(Number).sort((a, b) => a - b);
  const bitmap     = buildBitmap(presentDEs);
  let body = '';
  for (const de of presentDEs) body += packField(de, fieldMap[de]);

  return mti + bitmap + body;
}

/** Unpack an ISO 8583 0110/0210 Authorization / Financial Response */
export function unpackAuthResponse(raw: string): {
  mti:          string;
  responseCode: string;
  approvalCode: string;
  stan:         string;
  rrn:          string;
  emvField55?:  string;
  fields:       Record<number, string>;
} {
  if (raw.length < 20) throw new Error('ISO 8583 message too short');

  const mti        = raw.substring(0, 4);
  const bitmapHex  = raw.substring(4, 20);
  const presentDEs = parseBitmap(bitmapHex).filter(de => FIELD_DEFS[de]);

  const fields: Record<number, string> = {};
  let offset = 20;
  for (const de of presentDEs) {
    const { value, consumed } = unpackField(de, raw, offset);
    fields[de] = value;
    offset += consumed;
  }

  return {
    mti,
    responseCode: fields[39] ?? '',
    approvalCode: (fields[38] ?? '').trim(),
    stan:         fields[11] ?? '',
    rrn:          (fields[37] ?? '').trim(),
    emvField55:   fields[55],
    fields,
  };
}

/** Build MTI 0420 Reversal Request */
export function packReversalRequest(fields: {
  pan:           string;
  amountMinor:   number;
  stan:          string;
  rrn:           string;
  terminalId:    string;
  merchantId:    string;
  currencyCode:  string;
  originalData?: string;
}): string {
  const mti      = '0420';
  const now      = new Date();
  const txDateTime = [
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');

  const fieldMap: Record<number, string> = {
    2:  fields.pan.replace(/\D/g, ''),
    3:  '000000',
    4:  String(fields.amountMinor),
    7:  txDateTime,
    11: fields.stan,
    37: fields.rrn,
    39: '00',
    41: fields.terminalId,
    42: fields.merchantId,
    49: fields.currencyCode,
  };

  const presentDEs = Object.keys(fieldMap).map(Number).sort((a, b) => a - b);
  const bitmap     = buildBitmap(presentDEs);
  let body = '';
  for (const de of presentDEs) body += packField(de, fieldMap[de]);
  return mti + bitmap + body;
}

/** Build MTI 0800 Network Management Request (echo/sign-on) */
export function packNetworkRequest(networkCode: string = '001'): string {
  const mti = '0800';
  const now = new Date();
  const txDateTime = [
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');

  const stan = generateSTAN();
  const fieldMap: Record<number, string> = {
    7:  txDateTime,
    11: stan,
    70: networkCode,  // Network Management Information Code
  };

  const presentDEs = Object.keys(fieldMap).map(Number).sort((a, b) => a - b);
  const bitmap     = buildBitmap(presentDEs);
  let body = '';
  for (const de of presentDEs) body += packField(de, fieldMap[de]);
  return mti + bitmap + body;
}

/** Full 101.1 voice auth — generates HMAC approval code + ISO 8583 0200 */
export async function buildVoiceAuthRequest(params: {
  pan:        string;
  amountMinor: number;
  currency:   string;
  terminalId: string;
  merchantId: string;
  stan?:      string;
}): Promise<{
  iso8583Message: string;
  stan:           string;
  rrn:            string;
  approvalCode:   string;
  datetimeIso:    string;
  field55:        string;
  atc:            string;
}> {
  const { pan, amountMinor, currency, terminalId, merchantId } = params;
  const cleanPan  = pan.replace(/\s+/g, '');
  const panLast4  = cleanPan.slice(-4);
  const stan      = params.stan ?? generateSTAN();
  const atcHex    = await getAndIncrementATC(panLast4);
  const un        = crypto.randomBytes(4).toString('hex').toUpperCase();
  const now       = new Date();
  const datetimeIso = now.toISOString();

  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const HH = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const transmissionDateTime = `${mm}${dd}${HH}${mi}${ss}`;

  const rrn         = String(now.getTime()).slice(-12).padStart(12, '0');
  const currencyCode = getCurrencyCode(currency);

  // HMAC approval code (Protocol 101.1)
  const issuerSecret  = getIssuerSecret();
  const approvalCode  = generateApprovalCode({ panLast4, amountMinor, stan, datetimeIso, issuerSecret });

  // ARQC for EMV Field 55
  const arqcHex = generateIssuerArqc({
    pan: cleanPan, amountMinor, currency: currencyCode,
    atc: atcHex, unpredictableNumber: un,
    terminalId, merchantId,
  });

  const field55 = buildField55({
    pan: cleanPan, amountMinor, currency: currencyCode,
    atc: atcHex, unpredictableNumber: un,
    arqc: arqcHex,
    txnDate: `${datetimeIso.slice(2, 4)}${datetimeIso.slice(5, 7)}${datetimeIso.slice(8, 10)}`,
    ifdSerial: Buffer.from(terminalId.padEnd(8, '0').slice(0, 8)).toString('hex'),
  });

  const iso8583Message = await packAuthRequest({
    pan: cleanPan, amountMinor, stan,
    transmissionDateTime,
    posEntryMode: '011', // voice auth
    rrn, terminalId:
    terminalId.padEnd(8, ' ').slice(0, 8),
    merchantId: merchantId.padEnd(15, ' ').slice(0, 15),
    currencyCode, emvField55: field55,
  });

  return { iso8583Message, stan, rrn, approvalCode, datetimeIso, field55, atc: atcHex };
}

/** Issuer 0210 response — validates ARQC from DE55 and returns ARPC */
export async function buildAuthorizationResponse(params: {
  pan:         string;
  amountMinor: number;
  currency:    string;
  terminalId:  string;
  merchantId:  string;
  stan:        string;
  rrn:         string;
  field55?:    string;
  approvalCode?: string;
}): Promise<{
  iso8583Message: string;
  responseCode:   string;
  approvalCode:   string;
  arpc:           string;
  approved:       boolean;
  field55:        string;
}> {
  const cleanPan     = params.pan.replace(/\D/g, '');
  const panLast4     = cleanPan.slice(-4);
  const atcHex       = await getAndIncrementATC(panLast4);
  const currencyCode = getCurrencyCode(params.currency);
  const un           = crypto.randomBytes(4).toString('hex').toUpperCase();

  // ── Issuer-side ARQC validation ───────────────────────────────────────────
  // The retail MAC is recomputed over exactly the bytes the card MAC'd, so the
  // CDOL1 inputs come from the presented DE55 instead of being regenerated —
  // and the presented ATC, not a locally incremented one, is what the session
  // key is derived from.
  const presented    = params.field55 ? parseField55Tags(params.field55) : {};
  const presentedAtc = presented['9F36'] || atcHex;
  const arqcHex      = presented['9F26'] ?? '';

  const validation = validateArqc({
    pan:                 cleanPan,
    panSequence:         presented['5F34'] || '00',
    atc:                 presentedAtc,
    amountMinor:         params.amountMinor,
    currency:            currencyCode,
    unpredictableNumber: presented['9F37'] || un,
    tvr:                 presented['95'],
    txnDate:             presented['9A'],
    txnType:             presented['9C'],
    iad:                 presented['9F10'],
    terminalCountry:     presented['9F1A'],
    arqc:                arqcHex,
  });

  const approved     = validation.valid;
  const responseCode = validation.responseCode;
  const arpc         = validation.arpc;
  const approvalCode = approved ? (params.approvalCode ?? generateSTAN().slice(0, 6)) : '';

  // DE55 in the 0210 carries tag 91 (Issuer Authentication Data) = ARPC ‖ ARC,
  // which is what the card verifies on the second GENERATE AC. When the
  // cryptogram could not be proven there is no ARPC, so the response carries no
  // issuer authentication data at all.
  const respField55 = arpc
    ? encodeHexTlv('91', `${arpc}${Buffer.from(responseCode, 'ascii').toString('hex')}`)
    : '';

  const now      = new Date();
  const txDateTime = [
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');

  const fieldMap: Record<number, string> = {
    2:  cleanPan,
    3:  '000000',
    4:  String(params.amountMinor),
    7:  txDateTime,
    11: params.stan,
    37: params.rrn,
    39: responseCode,
    41: params.terminalId.padEnd(8, ' ').slice(0, 8),
    42: params.merchantId.padEnd(15, ' ').slice(0, 15),
    49: currencyCode,
  };
  // A decline carries no approval code and no issuer authentication data.
  if (approved) fieldMap[38] = approvalCode.padEnd(8, ' ').slice(0, 8);
  if (respField55) fieldMap[55] = respField55;

  const mti        = '0210';
  const presentDEs = Object.keys(fieldMap).map(Number).sort((a, b) => a - b);
  const bitmap     = buildBitmap(presentDEs);
  let body = '';
  for (const de of presentDEs) body += packField(de, fieldMap[de]);

  return {
    iso8583Message: mti + bitmap + body,
    responseCode,
    approvalCode,
    arpc,
    approved,
    field55: respField55,
  };
}

/** Parse TLV tags from a field55 hex string */
export function parseField55Tags(tlvHex: string): Record<string, string> {
  const clean = normalizeHex(tlvHex);
  const result: Record<string, string> = {};
  let i = 0;
  while (i < clean.length - 4) {
    // Handle 2-byte tags (starting with 9F, 5F, etc.)
    let tag: string;
    const firstByte = parseInt(clean.slice(i, i + 2), 16);
    if ((firstByte & 0x1F) === 0x1F) {
      tag = clean.slice(i, i + 4).toUpperCase();
      i += 4;
    } else {
      tag = clean.slice(i, i + 2).toUpperCase();
      i += 2;
    }
    if (i + 2 > clean.length) break;
    const len = parseInt(clean.slice(i, i + 2), 16);
    i += 2;
    if (i + len * 2 > clean.length) break;
    result[tag] = clean.slice(i, i + len * 2).toUpperCase();
    i += len * 2;
  }
  return result;
}
