import crypto from 'crypto';
import { ISO_8583_SECURITY, HASH_SPECS } from '../../config/crypto.spec';

export function signPayload(payload: unknown, secret: string, algorithm?: 'sha256' | 'sha512' | 'sha1' | 'md5'): string {
  const alg = algorithm || (ISO_8583_SECURITY.API_SIGNATURE_ALGORITHM.replace('hmac-', '') as 'sha256');
  return crypto
    .createHmac(alg, secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function signWebhook(payload: unknown, secret: string): string {
  const alg = ISO_8583_SECURITY.WEBHOOK_SIGNATURE_ALGORITHM.replace('hmac-', '') as 'sha512';
  return crypto
    .createHmac(alg, secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function hashAuditRecord(data: string | Buffer): string {
  const alg = ISO_8583_SECURITY.AUDIT_LOG_HASH;
  return crypto
    .createHash(alg)
    .update(data)
    .digest('hex');
}

export function verifySignature(payload: unknown, secret: string, signature: string): boolean {
  const expected = signPayload(payload, secret);
  if (!expected || !signature) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

export const SIGNING_SPEC = {
  apiHashBytes: HASH_SPECS.sha256.bytes,
  webhookHashBytes: HASH_SPECS.sha512.bytes,
  auditHashAlgorithm: ISO_8583_SECURITY.AUDIT_LOG_HASH,
  jwtSignatureAlgorithm: ISO_8583_SECURITY.JWT_SIGNATURE_ALGORITHM,
};
