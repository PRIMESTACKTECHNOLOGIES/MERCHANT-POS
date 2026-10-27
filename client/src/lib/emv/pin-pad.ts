/**
 * PIN Pad Module — Offline PIN, Enciphered PIN, Online PIN
 *
 * Unified PIN pad interface for POS terminals:
 *   - ISO 9564-1 Format 0 (ISO-0) PIN block formatting
 *   - AES-CBC enciphered PIN (for DDA/CDA terminals)
 *   - Device-specific PIN capture UI abstraction
 *
 * EMV Book 3 §6.5.6 VERIFY command uses these PIN blocks.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PinResult {
  success: boolean;
  pinBlock?: Uint8Array;
  encryptedPinBlock?: Uint8Array;
  pinLength?: number;
  reason?: string;
}

export interface PinPadInterface {
  /** Capture PIN from the cardholder (device-specific UI) */
  requestPIN(prompt: string): Promise<PinResult>;
  /** Encrypt a PIN block for enciphered PIN verification */
  encryptPIN(pan: string, pin: string): Promise<Uint8Array>;
  /** Cancel an in-progress PIN entry */
  cancel(): void;
}

// ── PIN Pad ────────────────────────────────────────────────────────────────────

export class PinPad implements PinPadInterface {
  private cancelled = false;

  async requestPIN(prompt: string): Promise<PinResult> {
    this.cancelled = false;

    // ── Device-specific PIN pad UI ──────────────────────────────────────
    // Replace with your POS SDK call:
    //
    //   const pin = await DeviceSDK.pinpad.capture(prompt);
    //
    // For now, uses the input.pinEntered from the EMV transaction flow.
    // When a real PIN pad is connected, swap this with the SDK call above.
    // ─────────────────────────────────────────────────────────────────────

    if (this.cancelled) {
      return { success: false, reason: 'PIN entry cancelled' };
    }

    // Simulated PIN for development — replaced by real device SDK
    const pin = '1234';

    if (!pin || pin.length < 4 || pin.length > 12) {
      return { success: false, reason: 'Invalid PIN length (4–12 digits required)' };
    }

    if (!/^\d+$/.test(pin)) {
      return { success: false, reason: 'PIN must contain only digits' };
    }

    const pinBlock = this.formatISO0(pin);
    return { success: true, pinBlock, pinLength: pin.length };
  }

  /**
   * Encrypt a PIN block using AES-CBC for enciphered PIN verification.
   *
   * EMV Book 3 §6.5.6 — P2 = 0x88 for enciphered PIN.
   * The encrypted block is sent to the card via VERIFY APDU.
   *
   * In production, replace with your terminal's hardware security module (HSM)
   * or PIN encryption device (PED) call.
   */
  async encryptPIN(pan: string, pin: string): Promise<Uint8Array> {
    const pinBlock = this.formatISO0(pin);

    // ── Device-specific encryption ──────────────────────────────────────
    // Replace with your POS HSM/PED:
    //
    //   return await DeviceSDK.crypto.encryptPINBlock(pinBlock, pan);
    //
    // Simulated AES-CBC encryption using Web Crypto API:
    // ─────────────────────────────────────────────────────────────────────

    const keyMaterial = new Uint8Array(32); // Zero key for simulation
    const key = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-CBC' },
      false,
      ['encrypt']
    );

    const iv = new Uint8Array(16); // Zero IV for simulation
    const padded = this.padToBlockSize(pinBlock, 16);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      padded as BufferSource
    );

    return new Uint8Array(encrypted);
  }

  /** Cancel an in-progress PIN entry */
  cancel(): void {
    this.cancelled = true;
  }

  // ── ISO 9564-1 Format 0 PIN Block ──────────────────────────────────────────

  /**
   * Format a PIN as ISO 9564-1 Format 0 (ISO-0) PIN block.
   *
   * Block 1: 0 | PIN_length | PIN_digits (padded with F)
   * Block 2: 0000 | PAN_rightmost_12_digits_excluding_check
   *
   * PIN Block = Block 1 XOR Block 2
   *
   * @param pin  PIN digits as string (4–12 digits)
   * @returns    8-byte PIN block
   */
  formatISO0(pin: string): Uint8Array {
    const digits = pin.replace(/\D/g, '').slice(0, 12);
    const pinLen = digits.length;

    // PIN field: 0x N L D D D D ... (N=0, L=pin length, D=BCD digits, pad F)
    const pinField = '0' + pinLen.toString(16) + digits.padEnd(14, 'F');

    // Build 8-byte array from hex
    const block1 = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      block1[i] = parseInt(pinField.substr(i * 2, 2), 16);
    }

    return block1;
  }

  /**
   * Format full ISO-0 PIN block with PAN XOR (for real card verification).
   *
   * @param pin  PIN digits
   * @param pan  Full PAN (16 digits)
   * @returns    8-byte XORed PIN block ready for VERIFY APDU
   */
  formatISO0WithPAN(pin: string, pan: string): Uint8Array {
    const cleanPAN = pan.replace(/\D/g, '');
    const panRight12 = cleanPAN.slice(-13, -1); // 12 rightmost digits, excluding check digit

    // Block 1: PIN field
    const block1 = this.formatISO0(pin);

    // Block 2: 0000 + PAN rightmost 12
    const panField = '0000' + panRight12;
    const block2 = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      block2[i] = parseInt(panField.substr(i * 2, 2), 16);
    }

    // XOR block1 and block2
    const result = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      result[i] = block1[i] ^ block2[i];
    }

    return result;
  }

  /** Pad data to AES block size (16 bytes) */
  private padToBlockSize(data: Uint8Array, blockSize: number): Uint8Array {
    if (data.length >= blockSize) return data;
    const padded = new Uint8Array(blockSize);
    padded.set(data);
    // PKCS#7-style padding
    const padLen = blockSize - data.length;
    for (let i = data.length; i < blockSize; i++) {
      padded[i] = padLen;
    }
    return padded;
  }
}
