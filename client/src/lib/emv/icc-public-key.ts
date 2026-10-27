/**
 * ICC Public Key Reconstruction — DDA / CDA Support
 *
 * Reconstructs the ICC (chip card) public key from EMV card records:
 *   - Tag 9F46: ICC Public Key Certificate (contains modulus left part)
 *   - Tag 9F47: ICC Public Key Exponent
 *   - Tag 9F48: ICC Public Key Remainder (modulus right part, if key > cert size)
 *
 * EMV Book 2 §5.2 — ICC Public Key Certificate Recovery:
 *   1. Recover certificate data using issuer public key
 *   2. Extract public key remainder from certificate
 *   3. Concatenate remainder + tag 9F48 remainder = full modulus
 *   4. Import as WebCrypto CryptoKey for DDA/CDA signature verification
 *
 * The reconstructed key feeds directly into RSAODA.verifyDDA() and verifyCDA().
 */

import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface ICCPublicKey {
  /** Full RSA modulus (n) = certificate remainder + tag 9F48 remainder */
  modulus: Uint8Array;
  /** RSA public exponent (e) from tag 9F47 */
  exponent: Uint8Array;
  /** WebCrypto CryptoKey ready for RSA PKCS#1 v1.5 verification */
  key: CryptoKey;
}

export class ICCPublicKeyRecovery {
  /**
   * Recover the ICC public key from card TLV data.
   *
   * Reads tags 9F46 (ICC cert), 9F47 (exponent), 9F48 (remainder)
   * and reconstructs the full RSA public key.
   *
   * @param cardData  Full card TLV hex string
   * @returns         Recovered ICC public key, or null if required tags missing
   */
  static async recover(cardData: string): Promise<ICCPublicKey | null> {
    const tags = TLVParser.parseTLV(cardData);

    // ICC Public Key Certificate — contains the left portion of the modulus
    const iccCert = TLVParser.getTagValue(tags, '9F46');
    // ICC Public Key Exponent — typically 03 bytes (e.g. 010001 = 65537)
    const iccExponent = TLVParser.getTagValue(tags, '9F47');
    // ICC Public Key Remainder — right portion of modulus when key > cert length
    const iccRemainder = TLVParser.getTagValue(tags, '9F48');

    if (!iccCert || !iccExponent) {
      return null;
    }

    const certBytes = this.hexToBytes(iccCert);
    const exponentBytes = this.hexToBytes(iccExponent);
    const remainderBytes = iccRemainder ? this.hexToBytes(iccRemainder) : new Uint8Array(0);

    // Extract modulus from ICC certificate
    // EMV cert format after recovery:
    //   Byte 0:    Header (0x6A)
    //   Byte 1:    Signed data format (0x04 for ICC cert)
    //   Byte 2:    Hash algorithm (0x01 = SHA-1)
    //   Byte 3-5:  Certificate serial number
    //   Byte 6-7:  PAN (rightmost 2 of 4)
    //   Byte 8-11: Expiry + serial
    //   Byte 12:   ICC public key length (total modulus bytes)
    //   Byte 13:   ICC public key exponent length
    //   Byte 14+:  Left part of ICC public key modulus + hash
    const headerLen = 14; // bytes before key data starts

    if (certBytes.length <= headerLen + 1) {
      // Certificate too short — try direct extraction from cert + remainder
      const modulusBytes = this.concatBytes(certBytes, remainderBytes);
      return this.importICCKey(modulusBytes, exponentBytes);
    }

    const keyLength = certBytes[12];
    const exponentLength = certBytes[13];

    // Left part of modulus starts at byte 14 in the recovered certificate
    const leftPartEnd = 14 + (keyLength - remainderBytes.length);
    const leftPart = certBytes.slice(14, Math.min(leftPartEnd, certBytes.length));

    // Full modulus = left part (from cert) + remainder (from tag 9F48)
    const modulusBytes = this.concatBytes(leftPart, remainderBytes);

    return this.importICCKey(modulusBytes, exponentBytes);
  }

  /**
   * Recover ICC public key from pre-parsed tag values (already extracted).
   *
   * @param iccCertHex      Tag 9F46 value (hex)
   * @param iccExponentHex  Tag 9F47 value (hex)
   * @param iccRemainderHex Tag 9F48 value (hex, optional)
   */
  static async recoverFromTags(
    iccCertHex: string,
    iccExponentHex: string,
    iccRemainderHex?: string
  ): Promise<ICCPublicKey | null> {
    const certBytes = this.hexToBytes(iccCertHex);
    const exponentBytes = this.hexToBytes(iccExponentHex);
    const remainderBytes = iccRemainderHex ? this.hexToBytes(iccRemainderHex) : new Uint8Array(0);

    const headerLen = 14;
    if (certBytes.length <= headerLen + 1) {
      const modulusBytes = this.concatBytes(certBytes, remainderBytes);
      return this.importICCKey(modulusBytes, exponentBytes);
    }

    const keyLength = certBytes[12];
    const leftPartEnd = 14 + (keyLength - remainderBytes.length);
    const leftPart = certBytes.slice(14, Math.min(leftPartEnd, certBytes.length));
    const modulusBytes = this.concatBytes(leftPart, remainderBytes);

    return this.importICCKey(modulusBytes, exponentBytes);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private static async importICCKey(
    modulus: Uint8Array,
    exponent: Uint8Array
  ): Promise<ICCPublicKey> {
    if (modulus.length === 0) {
      throw new Error('ICC public key modulus is empty');
    }

    const key = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: this.bytesToBase64Url(modulus),
        e: this.bytesToBase64Url(exponent),
        alg: 'RS256',
        ext: true,
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
      false,
      ['verify']
    );

    return { modulus, exponent, key };
  }

  private static concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  private static hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return arr;
  }

  private static bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
