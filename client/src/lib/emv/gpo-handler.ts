/**
 * GPO Handler — GET PROCESSING OPTIONS
 *
 * Implements EMV Book 3 §6.5.8:
 *   1. Parse PDOL from FCI Proprietary Template (tag 9F38)
 *   2. Build Command Template (tag 83) with PDOL-related data
 *   3. Send GPO APDU: 80 A8 00 00 [Lc] 83 [data] 00
 *   4. Parse response:
 *      - Format 1 (tag 80): AIP (2 bytes) + AFL (remaining)
 *      - Format 2 (tag 77): nested tag 82 (AIP) + tag 94 (AFL)
 *
 * Returns AIP + AFL for downstream READ RECORD and risk management.
 */

import type { CardInterface, APDUResponse } from './pos-apdu-bridge';
import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface GPOResult {
  /** Application Interchange Profile (tag 82) — hex */
  aip: string;
  /** Application File Locator (tag 94) — hex */
  afl: string;
  /** Raw GPO response data */
  raw: Uint8Array;
}

export interface PDOLItem {
  /** Tag identifier (e.g. '9F02', '5F2A') */
  tag: string;
  /** Length in bytes */
  length: number;
}

export class GPOHandler {
  private card: CardInterface;

  constructor(card: CardInterface) {
    this.card = card;
  }

  /**
   * Execute GET PROCESSING OPTIONS.
   *
   * @param fciHex          FCI data from SELECT response (hex) — contains PDOL (tag 9F38)
   * @param terminalDataHex Terminal data TLV (hex) — used to fill PDOL fields
   * @returns               AIP + AFL from GPO response
   */
  async process(fciHex: string, terminalDataHex: string): Promise<GPOResult> {
    // 1. Parse PDOL from FCI
    const pdol = this.parsePDOL(fciHex);

    // 2. Build PDOL-related data (Command Template tag 83)
    const pdolData = this.buildPDOLData(pdol, terminalDataHex);

    // 3. Send GPO APDU
    const resp = await this.sendGPO(pdolData);

    if (resp.sw1 !== 0x90 || resp.sw2 !== 0x00) {
      throw new Error(`GPO failed: SW1=${resp.sw1.toString(16)} SW2=${resp.sw2.toString(16)}`);
    }

    // 4. Parse response to extract AIP + AFL
    return this.parseGPOResponse(resp.data);
  }

  /**
   * Parse PDOL (Processing Options Data Object List) from FCI.
   *
   * PDOL (tag 9F38) format: sequence of [tag (1-2 bytes)] [length (1 byte)]
   *
   * Common PDOL tags:
   *   9F02 — Amount Authorized (6 bytes)
   *   9F03 — Amount Other (6 bytes)
   *   9F1A — Terminal Country Code (2 bytes)
   *   95   — Terminal Verification Results (5 bytes)
   *   5F2A — Transaction Currency Code (2 bytes)
   *   9A   — Transaction Date (3 bytes)
   *   9C   — Transaction Type (1 byte)
   *   9F37 — Unpredictable Number (4 bytes)
   */
  parsePDOL(fciHex: string): PDOLItem[] {
    const tags = TLVParser.parseTLV(fciHex);
    const pdolValue = TLVParser.getTagValue(tags, '9F38');

    if (!pdolValue) return [];

    const pdolBytes = this.hexToBytes(pdolValue);
    const items: PDOLItem[] = [];
    let i = 0;

    while (i < pdolBytes.length) {
      // Determine tag length (1 or 2 bytes)
      let tagLen = 1;
      if ((pdolBytes[i] & 0x1F) === 0x1F) {
        tagLen = 2; // Multi-byte tag
      }

      if (i + tagLen >= pdolBytes.length) break;

      const tagHex = tagLen === 2
        ? pdolBytes[i].toString(16).padStart(2, '0') + pdolBytes[i + 1].toString(16).padStart(2, '0')
        : pdolBytes[i].toString(16).padStart(2, '0');

      const length = pdolBytes[i + tagLen];
      items.push({ tag: tagHex.toUpperCase(), length });

      i += tagLen + 1;
    }

    return items;
  }

  /**
   * Build PDOL-related data (Command Template, tag 83).
   *
   * Fills each PDOL field with matching terminal data, or zeroes if not available.
   */
  buildPDOLData(pdol: PDOLItem[], terminalDataHex: string): Uint8Array {
    const terminalTags = TLVParser.parseTLV(terminalDataHex);

    const dataParts: Uint8Array[] = [];

    for (const item of pdol) {
      const tagValue = TLVParser.getTagValue(terminalTags, item.tag);

      if (tagValue) {
        const valueBytes = this.hexToBytes(tagValue);
        // Pad or truncate to expected length
        const padded = new Uint8Array(item.length);
        padded.set(valueBytes.slice(0, item.length));
        dataParts.push(padded);
      } else {
        // Fill with zeroes for missing data
        dataParts.push(new Uint8Array(item.length));
      }
    }

    // Concatenate all data parts
    const totalLen = dataParts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of dataParts) {
      result.set(part, offset);
      offset += part.length;
    }

    return result;
  }

  /**
   * Send GPO APDU: 80 A8 00 00 [Lc] 83 [data] 00
   */
  private async sendGPO(pdolData: Uint8Array): Promise<APDUResponse> {
    // Wrap PDOL data in Command Template (tag 83)
    const cmdTemplate = new Uint8Array(2 + pdolData.length);
    cmdTemplate[0] = 0x83;
    cmdTemplate[1] = pdolData.length;
    cmdTemplate.set(pdolData, 2);

    // Build GPO APDU
    const apdu = new Uint8Array(5 + cmdTemplate.length + 1);
    apdu[0] = 0x80;   // CLA (proprietary)
    apdu[1] = 0xA8;   // INS = GET PROCESSING OPTIONS
    apdu[2] = 0x00;   // P1
    apdu[3] = 0x00;   // P2
    apdu[4] = cmdTemplate.length;  // Lc
    apdu.set(cmdTemplate, 5);      // Data
    apdu[5 + cmdTemplate.length] = 0x00;  // Le

    return this.card.transmit(apdu);
  }

  /**
   * Parse GPO response to extract AIP and AFL.
   *
   * Format 1 (tag 80): Response Message Template Format 1
   *   Bytes 0-1: AIP
   *   Bytes 2+: AFL
   *
   * Format 2 (tag 77): Response Message Template Format 2
   *   Tag 82: AIP
   *   Tag 94: AFL
   */
  private parseGPOResponse(data: Uint8Array): GPOResult {
    const hex = this.bytesToHex(data);
    const tags = TLVParser.parseTLV(hex);

    // Format 2: tag 82 (AIP) + tag 94 (AFL)
    const aipTag = TLVParser.getTagValue(tags, '82');
    const aflTag = TLVParser.getTagValue(tags, '94');

    if (aipTag && aflTag) {
      return {
        aip: aipTag,
        afl: aflTag,
        raw: data
      };
    }

    // Format 1: tag 80 = AIP (2 bytes) + AFL (remaining)
    const fmt1 = TLVParser.getTagValue(tags, '80');
    if (fmt1 && fmt1.length >= 4) {
      const aip = fmt1.substring(0, 4);     // First 2 bytes = AIP
      const afl = fmt1.substring(4);         // Rest = AFL
      return {
        aip,
        afl,
        raw: data
      };
    }

    throw new Error('GPO response format not recognized');
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return arr;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
}
