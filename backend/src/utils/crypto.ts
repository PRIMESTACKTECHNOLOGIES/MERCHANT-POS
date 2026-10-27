import crypto from "crypto";
import {
  ISO_8583_SECURITY,
  CIPHER_SPECS,
  IV_SIZE_BYTES,
  KEY_SIZE_BYTES,
  HASH_SPECS,
  RANDOMNESS_REQUIREMENTS,
} from "../config/crypto.spec";

const keySource = process.env.CARD_ENC_KEY || Buffer.alloc(KEY_SIZE_BYTES.AES_256, 0xAB).toString("hex");
let ENC_KEY: Buffer;
if (keySource.length === KEY_SIZE_BYTES.AES_256 * 2 && /^[A-Fa-f0-9]+$/.test(keySource)) {
  ENC_KEY = Buffer.from(keySource, "hex");
} else {
  const rawKey = Buffer.from(keySource, "utf8");
  if (rawKey.length < KEY_SIZE_BYTES.AES_256) {
    ENC_KEY = crypto.createHash("sha256").update(rawKey).digest();
  } else {
    ENC_KEY = rawKey.subarray(0, KEY_SIZE_BYTES.AES_256);
  }
}

if (ENC_KEY.length !== KEY_SIZE_BYTES.AES_256) {
  throw new Error(`CARD_ENC_KEY must resolve to ${KEY_SIZE_BYTES.AES_256} bytes for AES-256`);
}

const PAN_CIPHER: keyof typeof CIPHER_SPECS = ISO_8583_SECURITY.PAN_ENCRYPTION;

export function encryptPan(pan: string): Buffer {
  const spec = CIPHER_SPECS[PAN_CIPHER];
  if (PAN_CIPHER === 'AES-256-GCM') {
    const nonce = crypto.randomBytes(IV_SIZE_BYTES.AES_GCM);
    const cipher = crypto.createCipheriv(spec.nodeCryptoName, ENC_KEY, nonce);
    const ciphertext = Buffer.concat([cipher.update(pan, "utf8"), cipher.final()]);
    const tag = (cipher as crypto.CipherGCM).getAuthTag();
    return Buffer.concat([nonce, tag, ciphertext]);
  }
  const iv = crypto.randomBytes(spec.ivBytes);
  const cipher = crypto.createCipheriv(spec.nodeCryptoName, ENC_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(pan, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext]);
}

export function decryptPan(encrypted: Buffer): string {
  const spec = CIPHER_SPECS[PAN_CIPHER];
  if (PAN_CIPHER === 'AES-256-GCM') {
    const minLen = IV_SIZE_BYTES.AES_GCM + 16 + 1;
    if (encrypted.length <= minLen) throw new Error("Invalid encrypted PAN (GCM too short)");
    const nonce = encrypted.subarray(0, IV_SIZE_BYTES.AES_GCM);
    const tag = encrypted.subarray(IV_SIZE_BYTES.AES_GCM, IV_SIZE_BYTES.AES_GCM + 16);
    const ciphertext = encrypted.subarray(IV_SIZE_BYTES.AES_GCM + 16);
    const decipher = crypto.createDecipheriv(spec.nodeCryptoName, ENC_KEY, nonce) as crypto.DecipherGCM;
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
  if (encrypted.length <= spec.ivBytes) {
    throw new Error("Invalid encrypted PAN (too short)");
  }
  const iv = encrypted.subarray(0, spec.ivBytes);
  const ciphertext = encrypted.subarray(spec.ivBytes);
  const decipher = crypto.createDecipheriv(spec.nodeCryptoName, ENC_KEY, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function hashCvv(cvv: string): string {
  const alg = ISO_8583_SECURITY.AUDIT_LOG_HASH;
  return crypto.createHash(alg).update(cvv, "utf8").digest("hex");
}

export function generateUnpredictableNumber(): Buffer {
  return crypto.randomBytes(RANDOMNESS_REQUIREMENTS.UNPREDICTABLE_NUMBER_BYTES);
}

export function generateSessionNonce(): Buffer {
  return crypto.randomBytes(RANDOMNESS_REQUIREMENTS.SESSION_ID_BYTES);
}

export function generateHmacKey256(): Buffer {
  return crypto.randomBytes(KEY_SIZE_BYTES.HMAC_SHA256);
}

export function generate3DesKey(keyType: '2key' | '3key' = '2key'): Buffer {
  const len = keyType === '3key' ? KEY_SIZE_BYTES.TRIPLE_DES_3KEY : KEY_SIZE_BYTES.TRIPLE_DES_2KEY;
  return crypto.randomBytes(len);
}

export function macRetail3Des(key: Buffer, data: Buffer): Buffer {
  if (key.length !== KEY_SIZE_BYTES.TRIPLE_DES_2KEY && key.length !== KEY_SIZE_BYTES.TRIPLE_DES_3KEY) {
    throw new Error(`Retail MAC 3DES key must be 16 or 24 bytes, got ${key.length}`);
  }
  const blockBytes = 8;
  const paddedLen = Math.ceil((data.length + 1) / blockBytes) * blockBytes;
  const padded = Buffer.alloc(paddedLen);
  data.copy(padded);
  padded[data.length] = 0x80;
  const fullKey = key.length === 16 ? Buffer.concat([key, key.subarray(0, 8)]) : key;
  const kLeft = fullKey.subarray(0, 8);
  let state = Buffer.alloc(blockBytes);
  for (let off = 0; off < padded.length; off += blockBytes) {
    const chunk = padded.subarray(off, off + blockBytes);
    const xored = Buffer.from(state.map((b, i) => b ^ chunk[i]));
    const c = crypto.createCipheriv("des-ede3-ecb", Buffer.concat([kLeft, kLeft, kLeft]), null);
    c.setAutoPadding(false);
    state = Buffer.concat([c.update(xored), c.final()]);
  }
  const d = crypto.createDecipheriv("des-ede3-ecb", fullKey, null);
  d.setAutoPadding(false);
  const decrypted = Buffer.concat([d.update(state), d.final()]);
  const c2 = crypto.createCipheriv("des-ede3-ecb", Buffer.concat([kLeft, kLeft, kLeft]), null);
  c2.setAutoPadding(false);
  const result = Buffer.concat([c2.update(decrypted), c2.final()]);
  return result.subarray(0, 8);
}

export const CRYPTO_CONSTANTS = {
  hashSha256Bytes: HASH_SPECS.sha256.bytes,
  hashSha512Bytes: HASH_SPECS.sha512.bytes,
  aes256BlockBytes: CIPHER_SPECS["AES-256-CBC"].blockBytes,
  desBlockBytes: CIPHER_SPECS["DES-ECB"].blockBytes,
  tripleDes2KeyBytes: KEY_SIZE_BYTES.TRIPLE_DES_2KEY,
  tripleDes3KeyBytes: KEY_SIZE_BYTES.TRIPLE_DES_3KEY,
};
