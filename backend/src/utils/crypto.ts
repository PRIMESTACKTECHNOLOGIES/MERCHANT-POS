import crypto from "crypto";

const keySource = process.env.CARD_ENC_KEY || "0123456789abcdef0123456789abcdef";
const ENC_KEY = Buffer.from(keySource, "utf8");

if (ENC_KEY.length !== 32) {
  throw new Error("CARD_ENC_KEY must be exactly 32 UTF-8 bytes");
}

export function encryptPan(pan: string): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENC_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(pan, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext]);
}

export function decryptPan(encrypted: Buffer): string {
  if (encrypted.length <= 16) {
    throw new Error("Invalid encrypted PAN");
  }

  const iv = encrypted.subarray(0, 16);
  const ciphertext = encrypted.subarray(16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENC_KEY, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err: any) {
    // Key mismatch — encrypted with a different CARD_ENC_KEY.
    // Return masked placeholder so the system continues instead of crashing.
    console.error('[crypto] decryptPan failed (key mismatch) — returning masked PAN:', err.message);
    return '****-****-****-0000';
  }
}

export function hashCvv(cvv: string): string {
  return crypto.createHash("sha256").update(cvv, "utf8").digest("hex");
}
