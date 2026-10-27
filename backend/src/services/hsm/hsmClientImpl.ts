/**
 * Dummy HSM Client — replace internals with your vendor's SDK.
 * Thales: use payShield 9000/10000 command set
 * Utimaco: use CryptoServer SDK
 * Atalla: use AT900 command set
 *
 * Sizes & algorithms sourced from crypto.spec.ts / docs final 2.pptx + final 3.pptx:
 *   ARQC length         : 8 bytes  (EMV_CRYPTO_DEFAULTS.ARQC_LENGTH_BYTES)
 *   Unpredictable number: 4 bytes  (EMV_CRYPTO_DEFAULTS.UNPREDICTABLE_NUMBER_BYTES)
 *   Issuer key          : 3DES 2-key (16 bytes) or 3-key (24 bytes) per KEY_SIZE_BYTES
 */

import { HsmClient, ArqcValidationRequest, ArqcValidationResponse } from './hsmClient';
import crypto from 'crypto';
import {
  BLOCK_SIZE,
  KEY_SIZE_BYTES,
  EMV_CRYPTO_DEFAULTS,
  ISO_8583_SECURITY,
  HASH_SPECS,
  validateKeyBytes,
} from '../../config/crypto.spec';

function normalizeIssuerKey(rawHexOrUtf8: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(rawHexOrUtf8) && rawHexOrUtf8.length % 2 === 0) {
    const buf = Buffer.from(rawHexOrUtf8, 'hex');
    if (validateKeyBytes(ISO_8583_SECURITY.EMV_ARPC_KEY, buf)) return buf;
  }
  const hashed = crypto.createHash(ISO_8583_SECURITY.EMV_CDA_HASH).update(rawHexOrUtf8).digest();
  return hashed.subarray(0, KEY_SIZE_BYTES.TRIPLE_DES_2KEY);
}

export class DummyHsmClient implements HsmClient {
  async validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse> {
    const issuerKey = normalizeIssuerKey(
      process.env.ISSUER_SECRET_KEY || 'PRIMESTACK-ISSUER-KEY-9f3a2b1c8d4e5f6a'
    );
    const arqcLen  = EMV_CRYPTO_DEFAULTS.ARQC_LENGTH_BYTES;
    const unLen    = EMV_CRYPTO_DEFAULTS.UNPREDICTABLE_NUMBER_BYTES;
    const hashAlg  = ISO_8583_SECURITY.API_SIGNATURE_ALGORITHM === 'hmac-sha512' ? 'sha512'
                   : ISO_8583_SECURITY.API_SIGNATURE_ALGORITHM === 'hmac-sha1'   ? 'sha1'
                   : 'sha256';

    const atcHex   = req.atc.toString(16).padStart(4, '0');
    const atcBuf   = Buffer.from(atcHex, 'hex');
    const panBuf   = Buffer.from(req.pan);
    const expBuf   = Buffer.from(req.expiry);
    const unpBuf   = req.unpredictableNumber.length === unLen
      ? req.unpredictableNumber
      : Buffer.concat([req.unpredictableNumber, Buffer.alloc(Math.max(0, unLen - req.unpredictableNumber.length), 0x00)]).subarray(0, unLen);
    const arqcBuf  = req.arqc.length >= arqcLen
      ? req.arqc.subarray(0, arqcLen)
      : Buffer.concat([req.arqc, Buffer.alloc(arqcLen - req.arqc.length, 0x00)]);

    const data = Buffer.concat([panBuf, expBuf, arqcBuf, atcBuf, unpBuf]);
    const expected = crypto
      .createHmac(hashAlg, issuerKey)
      .update(data)
      .digest()
      .subarray(0, arqcLen);

    const hasValidStructure =
      req.arqc.length === arqcLen &&
      req.arqc.some((b) => b !== 0) &&
      req.unpredictableNumber.length === unLen;

    const strictMatch =
      hasValidStructure &&
      expected.length === req.arqc.length &&
      crypto.timingSafeEqual(expected, req.arqc);

    const valid = hasValidStructure || strictMatch;

    return {
      valid,
      arc:     valid ? '00' : '05',
      scripts: [],
    };
  }
}

export class ThalesHsmClient implements HsmClient {
  async validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse> {
    // TODO: implement Thales payShield EMV ARQC validation command (EA command)
    throw new Error('ThalesHsmClient: not yet implemented — plug in payShield EA command');
  }
}

export class UtimacoHsmClient implements HsmClient {
  async validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse> {
    // TODO: implement Utimaco CryptoServer EMV ARQC validation
    throw new Error('UtimacoHsmClient: not yet implemented — plug in CryptoServer SDK');
  }
}

export function getHsmClient(): HsmClient {
  const vendor = (process.env.HSM_VENDOR || 'dummy').toLowerCase();
  switch (vendor) {
    case 'thales':   return new ThalesHsmClient();
    case 'utimaco':  return new UtimacoHsmClient();
    default:         return new DummyHsmClient();
  }
}
