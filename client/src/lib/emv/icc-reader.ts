/**
 * ICC Reader — Safe contact chip card APDU wrapper
 *
 * Wraps POSAPDUBridge with error-resilient APDU transmission:
 *   - ready flag prevents operations before open()
 *   - sendAPDU returns error response instead of throwing
 *   - getBridge() exposes the underlying CardInterface for RecordReader
 *
 * High-level EMV commands (SELECT, GPO, READ RECORD, VERIFY, GENERATE AC)
 * are available for direct card interaction when needed.
 */

import { POSAPDUBridge, buildAPDU, type APDUResponse } from './pos-apdu-bridge';

export class ICCReader {
  private bridge: POSAPDUBridge;
  private ready = false;

  constructor() {
    this.bridge = new POSAPDUBridge();
  }

  /** Open connection to the ICC slot */
  async open(): Promise<void> {
    try {
      await this.bridge.connect();
      this.ready = true;
    } catch (err) {
      this.ready = false;
      throw new Error('ICC reader failed to open');
    }
  }

  /** Close connection to the ICC slot */
  async close(): Promise<void> {
    try {
      await this.bridge.disconnect();
      this.ready = false;
    } catch {
      // ignore disconnect errors
    }
  }

  /** Check if reader is ready for APDU exchange */
  isReady(): boolean {
    return this.ready;
  }

  /** Check if underlying bridge is connected */
  isConnected(): boolean {
    return this.bridge.isConnected();
  }

  /** Access the underlying POSAPDUBridge (implements CardInterface for RecordReader) */
  getBridge(): POSAPDUBridge {
    return this.bridge;
  }

  /** Send raw APDU hex string — returns error response on failure instead of throwing */
  async sendAPDU(hex: string): Promise<APDUResponse> {
    if (!this.ready) {
      throw new Error('ICC reader not ready');
    }

    const apdu = this.hexToBytes(hex);

    try {
      return await this.bridge.transmit(apdu);
    } catch (err) {
      return {
        data: new Uint8Array([]),
        sw1: 0x6F,
        sw2: 0x00
      };
    }
  }

  // ── EMV Contact Commands ────────────────────────────────────────────────────

  /**
   * SELECT — EMV Book 1 §11.3
   * Select an application by AID.
   */
  async selectApplication(aidHex: string, first = true): Promise<APDUResponse> {
    const aid = this.hexToBytes(aidHex);
    const apdu = buildAPDU({
      cla: 0x00,
      ins: 0xA4,
      p1: first ? 0x04 : 0x05,
      p2: 0x00,
      data: aid,
      le: 0x00,
    });
    return this.safeTransmit(apdu);
  }

  /**
   * GET PROCESSING OPTIONS — EMV Book 3 §6.5.8
   * Initiates application processing after SELECT.
   */
  async getProcessingOptions(pdolData: Uint8Array): Promise<APDUResponse> {
    const apdu = buildAPDU({
      cla: 0x80,
      ins: 0xA8,
      p1: 0x00,
      p2: 0x00,
      data: pdolData,
      le: 0x00,
    });
    return this.safeTransmit(apdu);
  }

  /**
   * READ RECORD — EMV Book 1 §11.2
   * Read a record from a specific SFI.
   */
  async readRecord(sfi: number, recordNum: number): Promise<APDUResponse> {
    const apdu = buildAPDU({
      cla: 0x00,
      ins: 0xB2,
      p1: recordNum,
      p2: (sfi << 3) | 0x04,
      le: 0x00,
    });
    return this.safeTransmit(apdu);
  }

  /**
   * VERIFY — EMV Book 3 §6.5.6
   * Cardholder verification (PIN).
   */
  async verifyPIN(pin: string, encrypted = false): Promise<APDUResponse> {
    const pinBytes = new Uint8Array(8);
    const digits = pin.replace(/\D/g, '').slice(0, 12);
    const pinLen = digits.length;

    pinBytes[0] = 0x20 | pinLen;
    for (let i = 0; i < 7; i++) {
      const hi = i * 2 < pinLen ? parseInt(digits[i * 2], 16) : 0xF;
      const lo = i * 2 + 1 < pinLen ? parseInt(digits[i * 2 + 1], 16) : 0xF;
      pinBytes[1 + i] = (hi << 4) | lo;
    }

    const apdu = buildAPDU({
      cla: 0x00,
      ins: 0x20,
      p1: 0x00,
      p2: encrypted ? 0x88 : 0x80,
      data: pinBytes,
    });
    return this.safeTransmit(apdu);
  }

  /**
   * GENERATE AC — EMV Book 3 §6.5.9
   * Request transaction cryptogram (TC/AAC/ARQC).
   */
  async generateAC(type: 'TC' | 'AAC' | 'ARQC', cdol2: Uint8Array): Promise<APDUResponse> {
    const p1 = type === 'TC' ? 0x40 : 0x00;
    const apdu = buildAPDU({
      cla: 0x80,
      ins: 0xAE,
      p1,
      p2: 0x00,
      data: cdol2,
      le: 0x00,
    });
    return this.safeTransmit(apdu);
  }

  /**
   * INTERNAL AUTHENTICATE — EMV Book 1 §11.4
   * For DDA/CDA dynamic data authentication.
   */
  async internalAuthenticate(ddolData: Uint8Array): Promise<APDUResponse> {
    const apdu = buildAPDU({
      cla: 0x00,
      ins: 0x88,
      p1: 0x00,
      p2: 0x00,
      data: ddolData,
      le: 0x00,
    });
    return this.safeTransmit(apdu);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Safe transmit — returns error response on failure instead of throwing */
  private async safeTransmit(apdu: Uint8Array): Promise<APDUResponse> {
    if (!this.ready) {
      return { data: new Uint8Array([]), sw1: 0x6F, sw2: 0x00 };
    }
    try {
      return await this.bridge.transmit(apdu);
    } catch {
      return { data: new Uint8Array([]), sw1: 0x6F, sw2: 0x00 };
    }
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return arr;
  }
}
