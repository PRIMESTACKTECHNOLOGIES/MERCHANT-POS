/**
 * Online Authorization Module — ISO 8583 JSON Builder
 *
 * Builds online authorization requests from EMV card + terminal data,
 * and parses issuer authorization responses.
 *
 * Request includes the full EMV field block required by acquirers:
 *   - PAN, amount, currency, STAN, datetime
 *   - CID, AC, ATC, TVR, TSI, AIP, AID, IAD, UN
 *
 * Response parsing extracts:
 *   - ARC (Authorization Response Code, tag 8A)
 *   - Issuer Authentication Data (tag 91)
 *   - Issuer Scripts (tags 71 + 72)
 *
 * EMV Book 3 §6.5.9 — GENERATE AC produces ARQC for online authorization
 * EMV Book 3 §6.5.11 — Issuer Authentication Data (tag 91)
 * EMV Book 3 §6.5.10 — Issuer Script Processing (tags 71/72)
 */

import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';
import type { ACResult } from './ac-generator';

export interface OnlineAuthRequest {
  /** Primary Account Number (tag 5A) */
  pan: string;
  /** Amount Authorized (tag 9F02) — hex, 6 bytes */
  amount: string;
  /** Transaction Currency Code (tag 5F2A) — hex, 2 bytes */
  currency: string;
  /** System Trace Audit Number — 6 digits */
  stan: string;
  /** Transaction date + time — YYMMDDHHmmss */
  datetime: string;
  /** Transaction type — 00=purchase, 01=cash, etc. */
  transactionType: string;
  /** Full EMV data block for host */
  emv: EMVDataBlock;
}

export interface EMVDataBlock {
  /** Cryptogram Information Data (from AC result) */
  cid: string;
  /** Application Cryptogram (from AC result) */
  ac: string;
  /** Application Transaction Counter (tag 9F36) */
  atc: string;
  /** Terminal Verification Results (tag 95) */
  tvr: string;
  /** Transaction Status Information (tag 9B) */
  tsi: string;
  /** Application Interchange Profile (tag 82) */
  aip: string;
  /** Application Identifier (tag 4F) */
  aid: string;
  /** Issuer Application Data (tag 9F10) */
  iad: string;
  /** Unpredictable Number (tag 9F37) */
  unpredictableNumber: string;
  /** Application File Locator (tag 94) — if available */
  afl?: string;
}

export interface OnlineAuthResponse {
  /** Authorization Response Code (tag 8A) — 00=approved, 05=decline, etc. */
  arc: string;
  /** Issuer Authentication Data (tag 91) — for EXTERNAL AUTHENTICATE */
  issuerData: string;
  /** Issuer Scripts — combined tags 71 + 72 hex */
  scripts: string;
  /** Whether the transaction was approved online */
  approved: boolean;
  /** Whether issuer scripts are present */
  hasScripts: boolean;
  /** Whether issuer authentication data is present */
  hasIssuerAuth: boolean;
}

/** Common Authorization Response Codes */
export const ARC = {
  APPROVED:           '00',
  DECLINE:            '05',
  DECLINE_DO_NOT_RETRY: '59',
  TIMEOUT:            '91',
  SYSTEM_ERROR:       '96',
} as const;

export class OnlineAuth {
  /**
   * Build an online authorization request from EMV transaction data.
   *
   * @param cardTLVHex     Card data TLV (hex) — from READ RECORD merged TLV
   * @param terminalTLVHex Terminal data TLV (hex) — amount, TVR, currency, etc.
   * @param ac             AC cryptogram result from ACCryptogramGenerator
   * @param transactionType Optional transaction type (default: '00' purchase)
   * @returns              Structured online authorization request
   */
  build(
    cardTLVHex: string,
    terminalTLVHex: string,
    ac: ACResult,
    transactionType = '00'
  ): OnlineAuthRequest {
    const cardTags = TLVParser.parseTLV(cardTLVHex);
    const termTags = TLVParser.parseTLV(terminalTLVHex);

    return {
      pan: TLVParser.getTagValue(cardTags, '5A') || '',
      amount: TLVParser.getTagValue(termTags, '9F02') || '000000000000',
      currency: TLVParser.getTagValue(termTags, '5F2A') || '0840',
      stan: this.generateSTAN(),
      datetime: this.timestamp(),
      transactionType,
      emv: {
        cid: ac.cid,
        ac: ac.ac,
        atc: ac.atc,
        tvr: TLVParser.getTagValue(termTags, '95') || '',
        tsi: TLVParser.getTagValue(termTags, '9B') || '',
        aip: TLVParser.getTagValue(cardTags, '82') || '',
        aid: TLVParser.getTagValue(cardTags, '4F') || '',
        iad: ac.iad || TLVParser.getTagValue(cardTags, '9F10') || '',
        unpredictableNumber: TLVParser.getTagValue(termTags, '9F37') || '',
        afl: TLVParser.getTagValue(cardTags, '94') || undefined,
      }
    };
  }

  /**
   * Parse an issuer authorization response.
   *
   * @param respHex  Issuer response TLV (hex) — contains ARC, auth data, scripts
   * @returns        Parsed response with flags
   */
  parseResponse(respHex: string): OnlineAuthResponse {
    const tags = TLVParser.parseTLV(respHex);

    const arc = TLVParser.getTagValue(tags, '8A') || ARC.DECLINE;
    const issuerData = TLVParser.getTagValue(tags, '91') || '';
    const script71 = TLVParser.getTagValue(tags, '71') || '';
    const script72 = TLVParser.getTagValue(tags, '72') || '';
    const scripts = script71 + script72;

    return {
      arc,
      issuerData,
      scripts,
      approved: arc === ARC.APPROVED,
      hasScripts: scripts.length > 0,
      hasIssuerAuth: issuerData.length > 0,
    };
  }

  /**
   * Build a JSON payload for PrimeStack/payment processor.
   *
   * Converts the EMV authorization request into a JSON structure
   * compatible with the backend payment processor API.
   *
   * @param req      Online authorization request
   * @param merchantId  Merchant identifier
   * @param terminalId  Terminal identifier
   * @returns         JSON-serializable payload
   */
  buildPrimeStackPayload(
    req: OnlineAuthRequest,
    merchantId: string,
    terminalId: string
  ): Record<string, unknown> {
    return {
      merchantId,
      terminalId,
      pan: req.pan,
      amount: req.amount,
      currency: req.currency,
      stan: req.stan,
      datetime: req.datetime,
      transactionType: req.transactionType,
      emvData: {
        cid: req.emv.cid,
        ac: req.emv.ac,
        atc: req.emv.atc,
        tvr: req.emv.tvr,
        tsi: req.emv.tsi,
        aip: req.emv.aip,
        aid: req.emv.aid,
        iad: req.emv.iad,
        unpredictableNumber: req.emv.unpredictableNumber,
        ...(req.emv.afl ? { afl: req.emv.afl } : {}),
      },
    };
  }

  /**
   * Build an ISO 8583 message (simplified field map).
   *
   * Returns a field map suitable for ISO 8583 encoding.
   * The actual encoding (ASCII/BINARY/BCD) is handled by the
   * payment processor's ISO 8583 library.
   *
   * @param req  Online authorization request
   * @returns    ISO 8583 field map (field number → value)
   */
  buildISO8583Fields(req: OnlineAuthRequest): Map<number, string> {
    const fields = new Map<number, string>();

    // Primary bitmap fields
    fields.set(0, '0200');                                           // MTI — Authorization Request
    fields.set(2, req.pan);                                          // PAN
    fields.set(3, '000000');                                         // Processing Code — Purchase
    fields.set(4, this.padAmount(req.amount));                       // Amount Transaction
    fields.set(7, req.datetime);                                     // Transmission Date/Time
    fields.set(11, req.stan);                                        // STAN
    fields.set(12, req.datetime.substring(6));                       // Time (HHmmss)
    fields.set(13, req.datetime.substring(2, 6));                    // Date (MMDD)
    fields.set(14, '');                                              // Expiry Date — from card
    fields.set(18, '5411');                                          // MCC — Grocery
    fields.set(22, '051');                                           // POS Entry Mode — Chip
    fields.set(23, '001');                                           // Card Sequence Number
    fields.set(25, '00');                                            // POS Condition Code — Normal
    fields.set(26, '12');                                            // PIN Capture Code
    fields.set(49, req.currency);                                    // Currency Code
    fields.set(55, this.buildEMVField55(req.emv));                   // ICC System Related Data
    fields.set(95, req.emv.tvr);                                     // TVR

    return fields;
  }

  /**
   * Build ISO 8583 field 55 (ICC System Related Data).
   *
   * Concatenates EMV TLV tags into a single hex string.
   */
  private buildEMVField55(emv: EMVDataBlock): string {
    const tags: string[] = [];

    // Tag 9F26 — Application Cryptogram (AC)
    if (emv.ac) tags.push(this.buildTLV('9F26', emv.ac));
    // Tag 9F27 — Cryptogram Information Data (CID)
    if (emv.cid) tags.push(this.buildTLV('9F27', emv.cid));
    // Tag 9F36 — Application Transaction Counter (ATC)
    if (emv.atc) tags.push(this.buildTLV('9F36', emv.atc));
    // Tag 9F10 — Issuer Application Data (IAD)
    if (emv.iad) tags.push(this.buildTLV('9F10', emv.iad));
    // Tag 9F37 — Unpredictable Number
    if (emv.unpredictableNumber) tags.push(this.buildTLV('9F37', emv.unpredictableNumber));
    // Tag 82 — Application Interchange Profile (AIP)
    if (emv.aip) tags.push(this.buildTLV('82', emv.aip));
    // Tag 9F36 — ATC (already added above)
    // Tag 95 — TVR
    if (emv.tvr) tags.push(this.buildTLV('95', emv.tvr));
    // Tag 9B — TSI
    if (emv.tsi) tags.push(this.buildTLV('9B', emv.tsi));
    // Tag 9F1A — Terminal Country Code
    // Tag 5F2A — Transaction Currency Code
    // Tag 9A — Transaction Date
    // Tag 9C — Transaction Type

    return tags.join('');
  }

  private buildTLV(tag: string, value: string): string {
    const len = (value.length / 2).toString(16).padStart(2, '0');
    return tag + len + value;
  }

  private padAmount(hex: string): string {
    // Amount is 12 digits (6 bytes BCD)
    return hex.padStart(12, '0').substring(0, 12);
  }

  private generateSTAN(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private timestamp(): string {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(-2);
    const MM = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${yy}${MM}${dd}${hh}${mm}${ss}`;
  }
}
