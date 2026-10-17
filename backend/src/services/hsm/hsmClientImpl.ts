/**
 * HSM adapters.
 *
 * `SoftwareHsmClient` performs the real EMV key schedule in process
 * (IMK → UDK → session key → ISO 9797-1 Alg 3 retail MAC) via
 * issuer/issuerCrypto.ts. It is the default provider so that no deployment can
 * silently accept a forged cryptogram, and it fails closed when the issuer
 * master key is absent or the CDOL1 data is not supplied.
 *
 * Production deployments should still move the key into hardware:
 * Thales: use payShield 9000/10000 command set
 * Utimaco: use CryptoServer SDK
 */

import { HsmClient, ArqcValidationRequest, ArqcValidationResponse } from './hsmClient';
import { SoftwareEmvIssuerCrypto } from '../../issuer/issuerCrypto';

export class SoftwareHsmClient implements HsmClient {
  async validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse> {
    // Fail closed: an 8-byte ARQC is only meaningful if it can be recomputed
    // from the card's UDK over the exact bytes the card MAC'd. Anything else
    // would be "accept whatever the terminal says".
    if (!process.env.EMV_ISSUER_MASTER_KEY_HEX) {
      return { valid: false, arc: '05', scripts: [] };
    }
    if (req.arqc.length !== 8 || !req.cdol1Hex) {
      return { valid: false, arc: '05', scripts: [] };
    }
    const atcHex = Number(req.atc).toString(16).padStart(4, '0').toUpperCase();
    try {
      SoftwareEmvIssuerCrypto.fromEnvironment().validate({
        pan: req.pan,
        atc: atcHex,
        cdol1Hex: req.cdol1Hex,
        arqc: req.arqc.toString('hex').toUpperCase(),
      });
    } catch {
      return { valid: false, arc: '05', scripts: [] };
    }
    return { valid: true, arc: '00', scripts: [] };
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
  const vendor = (process.env.HSM_VENDOR || 'software').toLowerCase();
  switch (vendor) {
    case 'thales':   return new ThalesHsmClient();
    case 'utimaco':  return new UtimacoHsmClient();
    default:         return new SoftwareHsmClient();
  }
}
