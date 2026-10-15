import crypto from 'crypto';

/**
 * TR-31 interoperable secure key-exchange key blocks (ANSI X9 TR-31) and
 * key-check-value (KCV) utilities.
 *
 * Source: NEW IMPLEMENTS/000.pdf — "Key Blocks Frequently Asked Questions"
 * (Mastercard, 31 Aug 2022). The document requires (PCI PIN Standard
 * requirement 18-3) that encrypted symmetric keys are stored and conveyed in
 * key blocks and that key usage is cryptographically bound to the key.
 *
 * ── Header layout (16 ASCII bytes, version A/B/C/D) ──────────────────────
 *   offset  size  field
 *   0       1     Version ID                  ('A' | 'B' | 'C' | 'D')
 *   1       4     Key Block Length            decimal ASCII, whole block
 *   5       2     Key Usage                   (e.g. 'P0', 'M0', 'D0', 'K1')
 *   7       1     Algorithm                   (see ALGORITHM_* below)
 *   8       1     Mode of Use                  (see MODE_OF_USE_* below)
 *   9       2     Key Version Number          decimal ASCII
 *   11      1     Exportability               ('E' | 'N')
 *   12      1     Number of Optional Blocks   decimal ASCII
 *   13      3     Reserved                    '000'
 *
 * Layout cross-checked against published TR-31 sample blocks of the form
 *   B0080B0TX00E0000…  →  B | 0080 | B0 | T | X | 00 | E | 0 | 000
 *
 * NOTE: block MAC computation is intentionally not implemented here — it
 * depends on the exact "key block MAC algorithm" indicator of the target
 * version and must be validated against an HSM before use. Use
 * `verifyKeyBlockIntegrity()` only as a length/structure check.
 */

export type Tr31Version = 'A' | 'B' | 'C' | 'D';

/** Algorithm indicator (header offset 7). */
export const TR31_ALGORITHM = {
  AES128: 'A',
  AES192: 'B',
  AES256: 'C',
  TDES_2KEY: 'T',
  TDES_3KEY: 'U',
  TDES_DERIVATION: 'X',
  AES_DERIVATION: 'Y',
} as const;

/** Mode-of-use indicator (header offset 8). */
export const TR31_MODE_OF_USE = {
  BOTH: 'B',
  DECRYPT_ONLY: 'D',
  ENCRYPT_ONLY: 'E',
  GENERATE: 'G',
  NO_RESTRICTIONS: 'N',
  SIGNATURE: 'S',
  VERIFY: 'V',
  DERIVE: 'X',
} as const;

/** Exportability indicator (header offset 11). */
export const TR31_EXPORTABILITY = { EXPORTABLE: 'E', NON_EXPORTABLE: 'N' } as const;

export interface Tr31OptionalBlock {
  /** 2-character block identifier, e.g. 'KC' (Key Check Value). */
  id: string;
  /** Raw block payload (ASCII). */
  data: string;
}

export interface Tr31Header {
  versionId: Tr31Version;
  keyBlockLength: number;
  keyUsage: string;
  algorithm: string;
  modeOfUse: string;
  keyVersionNumber: string;
  exportability: string;
  optionalBlocks: Tr31OptionalBlock[];
  reserved: string;
}

export interface Tr31Parsed extends Tr31Header {
  /** Whole block, uppercase ASCII. */
  block: string;
  /** Encrypted key material (between header/optional blocks and the MAC). */
  keyDataHex: string;
  /** Block MAC (trailing 8 or 16 bytes), hex. Empty for version 'A'/'C'. */
  macHex: string;
}

export const TR31_HEADER_LENGTH = 16;

const HEADER_PATTERN = /^[ABCD]/;

function algorithmUsesAes(algorithm: string): boolean {
  return algorithm === TR31_ALGORITHM.AES128
    || algorithm === TR31_ALGORITHM.AES192
    || algorithm === TR31_ALGORITHM.AES256
    || algorithm === TR31_ALGORITHM.AES_DERIVATION;
}

function aesCipherName(key: Buffer): string {
  switch (key.length) {
    case 16: return 'aes-128-ecb';
    case 24: return 'aes-192-ecb';
    case 32: return 'aes-256-ecb';
    default: throw new Error('AES_KEY_LENGTH_INVALID');
  }
}

function expandTwoKey3Des(key: Buffer): Buffer {
  if (key.length === 24) return key;
  if (key.length === 16) return Buffer.concat([key, key.subarray(0, 8)]);
  throw new Error('TDES_KEY_MUST_BE_16_OR_24_BYTES');
}

function ecbEncrypt(key: Buffer, data: Buffer): Buffer {
  const cipher = crypto.createCipheriv('des-ede3-ecb', expandTwoKey3Des(key), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function ecbDecrypt(key: Buffer, data: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('des-ede3-ecb', expandTwoKey3Des(key), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function aesEcbEncrypt(key: Buffer, data: Buffer): Buffer {
  const cipher = crypto.createCipheriv(aesCipherName(key), key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesEcbDecrypt(key: Buffer, data: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(aesCipherName(key), key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * ANSI X9.24 Key Check Value: encrypt a block of zeroes and keep the leftmost
 * three bytes (6 hex characters).
 */
export function computeKcv(key: Buffer): string {
  if (key.length === 8 || key.length === 16 || key.length === 24) {
    const zeros = Buffer.alloc(8);
    return ecbEncrypt(key, zeros).subarray(0, 3).toString('hex').toUpperCase();
  }
  const zeros = Buffer.alloc(16);
  return aesEcbEncrypt(key, zeros).subarray(0, 3).toString('hex').toUpperCase();
}

/** Constant-time KCV comparison. */
export function verifyKcv(key: Buffer, expectedKcv: string): boolean {
  const expected = String(expectedKcv || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(expected)) return false;
  const actual = Buffer.from(computeKcv(key), 'hex');
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

/** Force odd parity on each byte of a DES/TDES key (ANSI X9.24 requirement). */
export function applyKeyParity(key: Buffer): Buffer {
  const out = Buffer.from(key);
  for (let i = 0; i < out.length; i += 1) {
    let byte = out[i] & 0xfe;
    let ones = 0;
    for (let bit = 1; bit < 8; bit += 1) {
      if (byte & (1 << bit)) ones += 1;
    }
    if (ones % 2 === 0) byte |= 0x01;
    out[i] = byte;
  }
  return out;
}

// ── AES Key Wrap, RFC 3394 ────────────────────────────────────────────────

const AES_KW_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');

/** RFC 3394 AES Key Wrap. `plaintext` must be a multiple of 8 bytes. */
export function aesKeyWrap(kek: Buffer, plaintext: Buffer): Buffer {
  if (plaintext.length % 8 !== 0 || plaintext.length < 16) {
    throw new Error('AES_KW_PLAINTEXT_MUST_BE_MULTIPLE_OF_8_MIN_16');
  }
  const n = plaintext.length / 8;
  const blocks = [];
  for (let i = 0; i < n; i += 1) {
    blocks.push(Buffer.from(plaintext.subarray(i * 8, i * 8 + 8)));
  }
  let a = Buffer.from(AES_KW_IV);
  for (let j = 0; j < 6; j += 1) {
    for (let i = 1; i <= n; i += 1) {
      const b = aesEcbEncrypt(kek, Buffer.concat([a, blocks[i - 1]]));
      a = Buffer.from(b.subarray(0, 8));
      const t = n * j + i;
      for (let k = 0; k < 8; k += 1) {
        a[7 - k] ^= (t >>> (8 * k)) & 0xff;
      }
      blocks[i - 1] = Buffer.from(b.subarray(8, 16));
    }
  }
  return Buffer.concat([a, ...blocks]);
}

/** RFC 3394 AES Key Unwrap. */
export function aesKeyUnwrap(kek: Buffer, wrapped: Buffer): Buffer {
  if (wrapped.length % 8 !== 0 || wrapped.length < 24) {
    throw new Error('AES_KW_CIPHERTEXT_MUST_BE_MULTIPLE_OF_8_MIN_24');
  }
  const n = wrapped.length / 8 - 1;
  let a = Buffer.from(wrapped.subarray(0, 8));
  const blocks = [];
  for (let i = 0; i < n; i += 1) {
    blocks.push(Buffer.from(wrapped.subarray((i + 1) * 8, (i + 2) * 8)));
  }
  for (let j = 5; j >= 0; j -= 1) {
    for (let i = n; i >= 1; i -= 1) {
      const t = n * j + i;
      const aXor = Buffer.from(a);
      for (let k = 0; k < 8; k += 1) {
        aXor[7 - k] ^= (t >>> (8 * k)) & 0xff;
      }
      const b = aesEcbDecrypt(kek, Buffer.concat([aXor, blocks[i - 1]]));
      a = Buffer.from(b.subarray(0, 8));
      blocks[i - 1] = Buffer.from(b.subarray(8, 16));
    }
  }
  if (!crypto.timingSafeEqual(a, AES_KW_IV)) {
    throw new Error('AES_KW_INTEGRITY_CHECK_FAILED');
  }
  return Buffer.concat(blocks);
}

// ── Header parse / build ─────────────────────────────────────────────────

function parseOptionalBlocks(text: string, count: number): { blocks: Tr31OptionalBlock[]; offset: number } {
  const blocks: Tr31OptionalBlock[] = [];
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > text.length) throw new Error('TR31_OPTIONAL_BLOCK_TRUNCATED');
    const id = text.slice(offset, offset + 2);
    const length = Number(text.slice(offset + 2, offset + 4));
    if (!Number.isInteger(length) || length < 0) throw new Error('TR31_OPTIONAL_BLOCK_LENGTH_INVALID');
    const data = text.slice(offset + 4, offset + 4 + length);
    if (data.length !== length) throw new Error('TR31_OPTIONAL_BLOCK_TRUNCATED');
    blocks.push({ id, data });
    offset += 4 + length;
  }
  return { blocks, offset };
}

/**
 * Parse a TR-31 key block. Validates the declared key-block length and the
 * number of optional blocks; throws when the block is malformed.
 */
export function parseTr31KeyBlock(block: string): Tr31Parsed {
  const text = String(block || '').replace(/\s+/g, '').toUpperCase();
  if (text.length < TR31_HEADER_LENGTH + 8) throw new Error('TR31_BLOCK_TOO_SHORT');
  if (!HEADER_PATTERN.test(text)) throw new Error('TR31_VERSION_ID_INVALID');

  const versionId = text[0] as Tr31Version;
  const keyBlockLength = Number(text.slice(1, 5));
  if (!Number.isInteger(keyBlockLength) || keyBlockLength !== text.length) {
    throw new Error('TR31_KEY_BLOCK_LENGTH_MISMATCH');
  }

  const keyUsage = text.slice(5, 7);
  const algorithm = text[7];
  const modeOfUse = text[8];
  const keyVersionNumber = text.slice(9, 11);
  const exportability = text[11];
  const optionalBlockCount = Number(text[12]);
  const reserved = text.slice(13, 16);
  if (!Number.isInteger(optionalBlockCount) || optionalBlockCount < 0) {
    throw new Error('TR31_OPTIONAL_BLOCK_COUNT_INVALID');
  }

  const body = text.slice(TR31_HEADER_LENGTH);
  const { blocks, offset } = parseOptionalBlocks(body, optionalBlockCount);

  // Version 'A'/'C' carry no block MAC; 'B'/'D' append an 8-byte MAC.
  const macLengthBytes = (versionId === 'B' || versionId === 'D') ? 8 : 0;
  const keyData = body.slice(offset, body.length - macLengthBytes * 2);
  const mac = macLengthBytes ? body.slice(body.length - macLengthBytes * 2) : '';
  if (keyData.length === 0) throw new Error('TR31_KEY_DATA_MISSING');

  return {
    versionId,
    keyBlockLength,
    keyUsage,
    algorithm,
    modeOfUse,
    keyVersionNumber,
    exportability,
    optionalBlocks: blocks,
    reserved,
    block: text,
    keyDataHex: keyData,
    macHex: mac,
  };
}

export interface Tr31BuildOptions {
  versionId?: Tr31Version;
  keyUsage: string;
  algorithm: string;
  modeOfUse: string;
  keyVersionNumber?: string;
  exportability?: string;
  optionalBlocks?: Tr31OptionalBlock[];
}

/**
 * Assemble a TR-31 block from a header and already-wrapped key data.
 * `wrappedKeyData` must be uppercase hex (the encrypted key plus any MAC).
 */
export function buildTr31KeyBlock(options: Tr31BuildOptions, wrappedKeyData: string): string {
  const wrapped = String(wrappedKeyData || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(wrapped) || wrapped.length % 2 !== 0) {
    throw new Error('TR31_WRAPPED_KEY_DATA_MUST_BE_EVEN_HEX');
  }
  const optionalBlocks = options.optionalBlocks || [];
  const serializedBlocks = optionalBlocks
    .map((b) => `${b.id}${String(b.data.length).padStart(2, '0')}${b.data}`)
    .join('');
  const totalLength = TR31_HEADER_LENGTH + serializedBlocks.length + wrapped.length;
  if (totalLength > 9999) throw new Error('TR31_BLOCK_TOO_LARGE');

  const versionId = options.versionId || 'B';
  const header = [
    versionId,
    String(totalLength).padStart(4, '0'),
    options.keyUsage,
    options.algorithm,
    options.modeOfUse,
    String(options.keyVersionNumber || '00').padStart(2, '0').slice(0, 2),
    options.exportability || TR31_EXPORTABILITY.EXPORTABLE,
    String(optionalBlocks.length),
    '000',
  ].join('');

  if (header.length !== TR31_HEADER_LENGTH) throw new Error('TR31_HEADER_ASSEMBLY_FAILED');
  return header + serializedBlocks + wrapped;
}

/**
 * Unwrap TR-31 key material with a Key Block Protection Key (KBPK).
 * AES algorithms use RFC 3394 AES Key Wrap; TDES algorithms use 3DES-ECB.
 */
export function unwrapTr31KeyData(parsed: Tr31Parsed, kek: Buffer): Buffer {
  const keyData = Buffer.from(parsed.keyDataHex, 'hex');
  if (algorithmUsesAes(parsed.algorithm)) {
    return aesKeyUnwrap(kek, keyData);
  }
  return ecbDecrypt(kek, keyData);
}

/** Wrap raw key material into TR-31 key data with a KBPK. */
export function wrapTr31KeyData(algorithm: string, kek: Buffer, key: Buffer): string {
  const wrapped = algorithmUsesAes(algorithm) ? aesKeyWrap(kek, key) : ecbEncrypt(kek, key);
  return wrapped.toString('hex').toUpperCase();
}

/**
 * Structural integrity check (length + optional blocks + hex sanity).
 * This is NOT a MAC verification — see the module header note.
 */
export function verifyKeyBlockIntegrity(block: string): { valid: boolean; reason?: string } {
  try {
    const parsed = parseTr31KeyBlock(block);
    if (parsed.keyDataHex.length % 2 !== 0) return { valid: false, reason: 'KEY_DATA_ODD_HEX' };
    return { valid: true };
  } catch (error: any) {
    return { valid: false, reason: error?.message || 'TR31_PARSE_FAILED' };
  }
}
