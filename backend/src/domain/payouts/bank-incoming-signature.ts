import crypto from 'crypto';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MIN_SECRET_BYTES = 32;

export function verifyBankIncomingSignature(input: {
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: Buffer;
  nowMs?: number;
}): boolean {
  const { secret, timestamp, signature, rawBody } = input;
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES || !/^\d{10}$/.test(timestamp)) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs((input.nowMs ?? Date.now()) - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
