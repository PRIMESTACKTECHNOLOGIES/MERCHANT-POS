/**
 * Dummy HSM Client — replace internals with your vendor's SDK.
 * Thales: use payShield 9000/10000 command set
 * Utimaco: use CryptoServer SDK
 * Atalla: use AT900 command set
 */

import { HsmClient, ArqcValidationRequest, ArqcValidationResponse } from './hsmClient';
import crypto from 'crypto';

export class DummyHsmClient implements HsmClient {
  async validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse> {
    // Software ARQC validation using HMAC-SHA256 as a stand-in for real HSM
    // In production: send req to HSM over TCP/IP or PKCS#11 and receive ARC
    const key    = Buffer.from(process.env.ISSUER_SECRET_KEY || 'PRIMESTACK-ISSUER-KEY-9f3a2b1c8d4e5f6a', 'utf8');
    const data   = Buffer.concat([
      Buffer.from(req.pan),
      Buffer.from(req.expiry),
      req.arqc,
      Buffer.from(req.atc.toString(16).padStart(4, '0'), 'hex'),
      req.unpredictableNumber,
    ]);
    const expected = crypto.createHmac('sha256', key).update(data).digest().slice(0, 8);
    // Accept if ARQC is non-zero (real HSM would do full 3DES/AES derivation)
    const valid  = req.arqc.length === 8 && req.arqc.some(b => b !== 0);
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
