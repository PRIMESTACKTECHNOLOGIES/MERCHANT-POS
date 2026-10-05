import crypto from 'crypto';

export function signPayload(secretKey: string, payload: string): string {
  return crypto.createHmac('sha512', secretKey).update(payload, 'utf8').digest('hex');
}

export function verifySignature(secretKey: string, payload: string, signature: string): boolean {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = Buffer.from(signPayload(secretKey, payload), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

