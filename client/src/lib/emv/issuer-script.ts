/**
 * Issuer Script Processor — Tag 71 / Tag 72
 *
 * Processes issuer authorization response scripts after online ARQC:
 *   - Tag 71: Issuer Script Template 1 (executed before second GENERATE AC)
 *   - Tag 72: Issuer Script Template 2 (executed after second GENERATE AC)
 *
 * Each script template contains one or more BER-TLV encoded APDU commands
 * wrapped in tag 86 (Issuer Script Command). The processor extracts these
 * APDUs and transmits them to the card sequentially.
 *
 * EMV Book 3 §6.5.10 — Issuer Script Processing
 * EMV Book 3 §6.5.11 — Issuer Authentication
 *
 * Common issuer script commands:
 *   - GENERATE AC (second AC after online)
 *   - PUT DATA (update card records)
 *   - UPDATE RECORD
 *   - WRITE RECORD
 *   - INTERNAL AUTHENTICATE
 */

import type { CardInterface } from './pos-apdu-bridge';
import type { APDUResponse } from './pos-apdu-bridge';
import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface ScriptResult {
  /** Overall success — all scripts executed without error */
  success: boolean;
  /** At least one script was applied */
  applied: boolean;
  /** Individual APDU results */
  commands: ScriptCommandResult[];
  /** Error messages for failed scripts */
  errors: string[];
}

export interface ScriptCommandResult {
  /** Which template this command came from: 71 or 72 */
  template: '71' | '72';
  /** CLA byte */
  cla: number;
  /** INS byte */
  ins: number;
  /** P1 parameter */
  p1: number;
  /** P2 parameter */
  p2: number;
  /** SW1 from card */
  sw1: number;
  /** SW2 from card */
  sw2: number;
  /** Whether this command succeeded (90 00) */
  success: boolean;
}

export interface IssuerAuthResult {
  /** Issuer Authentication Data (tag 91) */
  authData?: string;
  /** Whether issuer authentication succeeded */
  authenticated: boolean;
}

export class IssuerScriptProcessor {
  private card: CardInterface;

  constructor(card: CardInterface) {
    this.card = card;
  }

  /**
   * Process issuer response containing scripts (tags 71, 72) and
   * issuer authentication data (tag 91).
   *
   * Flow:
   *   1. Extract Issuer Authentication Data (tag 91) → EXTERNAL AUTHENTICATE
   *   2. Process Script Template 1 (tag 71) → execute before 2nd GENERATE AC
   *   3. Process Script Template 2 (tag 72) → execute after 2nd GENERATE AC
   *
   * @param issuerResponseHex  Issuer response TLV (hex) — from online authorization
   * @returns                  Combined script execution results
   */
  async process(issuerResponseHex: string): Promise<ScriptResult> {
    const tags = TLVParser.parseTLV(issuerResponseHex);

    const script71 = TLVParser.getTagValue(tags, '71'); // Script Template 1
    const script72 = TLVParser.getTagValue(tags, '72'); // Script Template 2

    const commands: ScriptCommandResult[] = [];
    const errors: string[] = [];
    let applied = false;

    // Process Script Template 1 (tag 71) — before second GENERATE AC
    if (script71) {
      const results = await this.applyScript(script71, '71');
      commands.push(...results);

      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        errors.push(`SCRIPT_71_FAILED: ${failed.length} command(s) failed`);
      } else {
        applied = true;
      }
    }

    // Process Script Template 2 (tag 72) — after second GENERATE AC
    if (script72) {
      const results = await this.applyScript(script72, '72');
      commands.push(...results);

      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        errors.push(`SCRIPT_72_FAILED: ${failed.length} command(s) failed`);
      } else {
        applied = true;
      }
    }

    return {
      success: errors.length === 0,
      applied,
      commands,
      errors
    };
  }

  /**
   * Process issuer authentication data (tag 91).
   *
   * Sends EXTERNAL AUTHENTICATE APDU to the card:
   *   00 82 00 00 [Lc] [Issuer Auth Data]
   *
   * EMV Book 3 §6.5.11 — Issuer Authentication
   *
   * @param issuerResponseHex  Issuer response TLV (hex)
   * @returns                  Authentication result
   */
  async processIssuerAuthentication(issuerResponseHex: string): Promise<IssuerAuthResult> {
    const tags = TLVParser.parseTLV(issuerResponseHex);
    const authData = TLVParser.getTagValue(tags, '91'); // Issuer Authentication Data

    if (!authData) {
      return { authenticated: false };
    }

    try {
      const authBytes = this.hexToBytes(authData);

      // Build EXTERNAL AUTHENTICATE APDU
      const apdu = new Uint8Array(5 + authBytes.length);
      apdu[0] = 0x00;   // CLA
      apdu[1] = 0x82;   // INS = EXTERNAL AUTHENTICATE
      apdu[2] = 0x00;   // P1
      apdu[3] = 0x00;   // P2
      apdu[4] = authBytes.length;  // Lc
      apdu.set(authBytes, 5);      // Data

      const resp = await this.card.transmit(apdu);

      return {
        authData,
        authenticated: resp.sw1 === 0x90 && resp.sw2 === 0x00
      };
    } catch {
      return { authData, authenticated: false };
    }
  }

  /**
   * Full issuer response processing:
   *   1. Issuer Authentication (tag 91 → EXTERNAL AUTHENTICATE)
   *   2. Script Template 1 (tag 71 → before 2nd AC)
   *   3. Script Template 2 (tag 72 → after 2nd AC)
   *
   * @param issuerResponseHex  Full issuer response TLV (hex)
   * @returns                  Authentication + script results
   */
  async processFullResponse(issuerResponseHex: string): Promise<{
    auth: IssuerAuthResult;
    scripts: ScriptResult;
  }> {
    const auth = await this.processIssuerAuthentication(issuerResponseHex);
    const scripts = await this.process(issuerResponseHex);

    return { auth, scripts };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Parse and execute all APDU commands within a script template.
   *
   * Script templates contain BER-TLV encoded commands:
   *   Tag 86 (Issuer Script Command) wraps raw APDU command bytes
   *
   * Each tag 86 value is a complete APDU:
   *   CLA INS P1 P2 [Lc Data] [Le]
   */
  private async applyScript(
    scriptHex: string,
    template: '71' | '72'
  ): Promise<ScriptCommandResult[]> {
    const results: ScriptCommandResult[] = [];

    try {
      // Parse script template to find tag 86 (Issuer Script Command)
      const tags = TLVParser.parseTLV(scriptHex);
      const commands = tags.filter(t => t.tag === '86');

      // If no tag 86 found, try parsing as raw APDU sequence
      if (commands.length === 0) {
        return this.executeRawAPDUs(scriptHex, template);
      }

      // Execute each script command
      for (const cmd of commands) {
        const result = await this.executeAPDU(cmd.value, template);
        results.push(result);
      }
    } catch {
      // Fallback: try raw APDU parsing
      const rawResults = await this.executeRawAPDUs(scriptHex, template);
      results.push(...rawResults);
    }

    return results;
  }

  /**
   * Execute a single APDU from hex string.
   */
  private async executeAPDU(apduHex: string, template: '71' | '72'): Promise<ScriptCommandResult> {
    const bytes = this.hexToBytes(apduHex);

    if (bytes.length < 4) {
      return {
        template,
        cla: 0, ins: 0, p1: 0, p2: 0,
        sw1: 0x6F, sw2: 0x00,
        success: false
      };
    }

    const cla = bytes[0];
    const ins = bytes[1];
    const p1 = bytes[2];
    const p2 = bytes[3];

    // Build APDU — handle Lc/Data/Le
    let apdu: Uint8Array;
    if (bytes.length > 5) {
      // Has Lc and data
      apdu = bytes;
    } else if (bytes.length === 5) {
      // Has Le only
      apdu = bytes;
    } else {
      // Case 1: CLA INS P1 P2 only
      apdu = bytes;
    }

    let resp: APDUResponse;
    try {
      resp = await this.card.transmit(apdu);
    } catch {
      resp = { data: new Uint8Array([]), sw1: 0x6F, sw2: 0x00 };
    }

    return {
      template,
      cla, ins, p1, p2,
      sw1: resp.sw1,
      sw2: resp.sw2,
      success: resp.sw1 === 0x90 && resp.sw2 === 0x00
    };
  }

  /**
   * Execute raw APDU sequence (when no tag 86 wrapper found).
   * Parses sequential APDUs from hex string.
   */
  private async executeRawAPDUs(hex: string, template: '71' | '72'): Promise<ScriptCommandResult[]> {
    const results: ScriptCommandResult[] = [];
    const bytes = this.hexToBytes(hex);

    let i = 0;
    while (i + 4 <= bytes.length) {
      const cla = bytes[i];
      const ins = bytes[i + 1];
      const p1 = bytes[i + 2];
      const p2 = bytes[i + 3];

      let apduEnd = i + 4;

      // Check for Lc
      if (i + 4 < bytes.length) {
        const lc = bytes[i + 4];
        if (lc > 0 && i + 5 + lc <= bytes.length) {
          apduEnd = i + 5 + lc;
          // Check for Le
          if (apduEnd < bytes.length) {
            apduEnd++; // Include Le
          }
        } else if (lc === 0 && i + 5 <= bytes.length) {
          apduEnd = i + 5; // Le = 0
        }
      }

      const apdu = bytes.slice(i, apduEnd);
      const apduHex = this.bytesToHex(apdu);
      const result = await this.executeAPDU(apduHex, template);
      results.push(result);

      i = apduEnd;
      if (apduEnd <= i + 4) break; // Prevent infinite loop
    }

    return results;
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
