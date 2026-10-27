import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';
import { hexToBytes } from './emv-utils';
import { RSAODA, type CAPK as RSA_CAPK, type ODAResult } from './rsa-oda';
import { ICCPublicKeyRecovery } from './icc-public-key';
import { OdaErrorCode, odaErrorReason } from './odaErrorCodes';

export interface AuthenticationResult {
  success: boolean;
  method: 'SDA' | 'DDA' | 'CDA';
  error?: string;
  signature?: string;
  certificate?: string;
  errorCode?: OdaErrorCode;
}

export interface CAPK extends RSA_CAPK {
  hashAlgorithm: string;
  algorithm: string;
  expiryDate: string;
}

export class OfflineDataAuthentication {
  private capks: CAPK[] = [];
  private rsa: RSAODA;

  constructor(capks: CAPK[] = []) {
    this.capks = capks;
    this.rsa = new RSAODA(capks);
  }

  async authenticate(cardData: string, terminalData: string): Promise<AuthenticationResult> {
    const cardTags = TLVParser.parseTLV(cardData);

    const aip = TLVParser.getTagValue(cardTags, '82');
    if (!aip) {
      return {
        success: false,
        method: 'SDA',
        errorCode: OdaErrorCode.AIP_MISSING,
        error: odaErrorReason(OdaErrorCode.AIP_MISSING),
      };
    }

    const aipBytes = hexToBytes(aip);
    const supportsSDA = (aipBytes[0] & 0x40) !== 0;
    const supportsDDA = (aipBytes[0] & 0x20) !== 0;
    const supportsCDA = (aipBytes[0] & 0x01) !== 0;

    if (!supportsSDA && !supportsDDA && !supportsCDA) {
      return {
        success: false,
        method: 'SDA',
        errorCode: OdaErrorCode.NO_AUTH_METHOD,
        error: odaErrorReason(OdaErrorCode.NO_AUTH_METHOD),
      };
    }

    if (supportsCDA) {
      return this.performCDA(cardData, terminalData);
    }

    if (supportsDDA) {
      return this.performDDA(cardData, terminalData);
    }

    if (supportsSDA) {
      return this.performSDA(cardData);
    }

    return {
      success: false,
      method: 'SDA',
      errorCode: OdaErrorCode.NO_AUTH_METHOD,
      error: odaErrorReason(OdaErrorCode.NO_AUTH_METHOD),
    };
  }

  private async performSDA(cardData: string): Promise<AuthenticationResult> {
    try {
      const cardTags = TLVParser.parseTLV(cardData);

      const ssad = TLVParser.getTagValue(cardTags, '93');
      if (!ssad) {
        return {
          success: false,
          method: 'SDA',
          errorCode: OdaErrorCode.SDA_SSAD_MISSING,
          error: odaErrorReason(OdaErrorCode.SDA_SSAD_MISSING),
        };
      }

      const issuerCert = TLVParser.getTagValue(cardTags, '90');
      if (!issuerCert) {
        return {
          success: false,
          method: 'SDA',
          errorCode: OdaErrorCode.SDA_ISSUER_CERT_MISSING,
          error: odaErrorReason(OdaErrorCode.SDA_ISSUER_CERT_MISSING),
        };
      }

      const rid = TLVParser.getTagValue(cardTags, '9F06');
      const capki = TLVParser.getTagValue(cardTags, '8F');

      if (!rid || !capki) {
        return {
          success: false,
          method: 'SDA',
          errorCode: OdaErrorCode.SDA_RID_CAPKI_MISSING,
          error: odaErrorReason(OdaErrorCode.SDA_RID_CAPKI_MISSING),
        };
      }

      const capk = this.findCAPK(rid, capki);
      if (!capk) {
        return {
          success: false,
          method: 'SDA',
          errorCode: OdaErrorCode.SDA_CAPK_NOT_FOUND,
          error: odaErrorReason(OdaErrorCode.SDA_CAPK_NOT_FOUND),
        };
      }

      const result: ODAResult = await this.rsa.verifySDA(
        hexToBytes(ssad),
        hexToBytes(issuerCert),
        capk
      );

      if (result.success) {
        return {
          success: true,
          method: 'SDA',
          signature: ssad,
          certificate: issuerCert,
        };
      }

      return {
        success: false,
        method: 'SDA',
        errorCode: OdaErrorCode.SDA_RSA_FAILED,
        error: odaErrorReason(OdaErrorCode.SDA_RSA_FAILED, result.reason),
        signature: ssad,
        certificate: issuerCert,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        method: 'SDA',
        errorCode: OdaErrorCode.SDA_EXCEPTION,
        error: odaErrorReason(OdaErrorCode.SDA_EXCEPTION, detail),
      };
    }
  }

  private async performDDA(cardData: string, terminalData: string): Promise<AuthenticationResult> {
    try {
      const cardTags = TLVParser.parseTLV(cardData);

      const iccCert = TLVParser.getTagValue(cardTags, '9F46');
      if (!iccCert) {
        return {
          success: false,
          method: 'DDA',
          errorCode: OdaErrorCode.DDA_ICC_CERT_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_CERT_MISSING),
        };
      }

      const dynamicSignature = TLVParser.getTagValue(cardTags, '9F4B');
      if (!dynamicSignature) {
        return {
          success: false,
          method: 'DDA',
          errorCode: OdaErrorCode.DDA_DYNAMIC_SIG_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_DYNAMIC_SIG_MISSING),
        };
      }

      const iccKey = await ICCPublicKeyRecovery.recover(cardData);

      if (iccKey) {
        const result: ODAResult = await this.rsa.verifyDDA(
          hexToBytes(dynamicSignature),
          hexToBytes(iccCert),
          iccKey.key
        );

        if (result.success) {
          return {
            success: true,
            method: 'DDA',
            signature: dynamicSignature,
            certificate: iccCert,
          };
        }

        return {
          success: false,
          method: 'DDA',
          errorCode: OdaErrorCode.DDA_RSA_FAILED,
          error: odaErrorReason(OdaErrorCode.DDA_RSA_FAILED, result.reason),
          signature: dynamicSignature,
          certificate: iccCert,
        };
      }

      const rid = TLVParser.getTagValue(cardTags, '9F06');
      const capki = TLVParser.getTagValue(cardTags, '8F');

      if (!rid || !capki) {
        return {
          success: false,
          method: 'DDA',
          errorCode: OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING),
        };
      }

      const capk = this.findCAPK(rid, capki);
      if (!capk) {
        return {
          success: false,
          method: 'DDA',
          errorCode: OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING),
        };
      }

      const issuerKey = await this.rsa.importCAPK(capk);
      const result: ODAResult = await this.rsa.verifyDDA(
        hexToBytes(dynamicSignature),
        hexToBytes(iccCert),
        issuerKey
      );

      if (result.success) {
        return {
          success: true,
          method: 'DDA',
          signature: dynamicSignature,
          certificate: iccCert,
        };
      }

      return {
        success: false,
        method: 'DDA',
        errorCode: OdaErrorCode.DDA_RSA_FAILED,
        error: odaErrorReason(OdaErrorCode.DDA_RSA_FAILED, result.reason),
        signature: dynamicSignature,
        certificate: iccCert,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        method: 'DDA',
        errorCode: OdaErrorCode.DDA_EXCEPTION,
        error: odaErrorReason(OdaErrorCode.DDA_EXCEPTION, detail),
      };
    }
  }

  private async performCDA(cardData: string, terminalData: string): Promise<AuthenticationResult> {
    try {
      const cardTags = TLVParser.parseTLV(cardData);

      const iccCert = TLVParser.getTagValue(cardTags, '9F46');
      if (!iccCert) {
        return {
          success: false,
          method: 'CDA',
          errorCode: OdaErrorCode.DDA_ICC_CERT_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_CERT_MISSING),
        };
      }

      const cdaSignature = TLVParser.getTagValue(cardTags, '9F4C');
      if (!cdaSignature) {
        const fallbackResult = await this.performDDA(cardData, terminalData);
        if (fallbackResult.success) {
          return { ...fallbackResult, method: 'CDA' as const };
        }
        return {
          success: false,
          method: 'CDA',
          errorCode: OdaErrorCode.CDA_SIG_MISSING_FALLBACK_DDA,
          error: odaErrorReason(OdaErrorCode.CDA_SIG_MISSING_FALLBACK_DDA),
        };
      }

      const iccKey = await ICCPublicKeyRecovery.recover(cardData);

      if (iccKey) {
        const result: ODAResult = await this.rsa.verifyCDA(
          hexToBytes(cdaSignature),
          hexToBytes(iccCert),
          iccKey.key
        );

        if (result.success) {
          return {
            success: true,
            method: 'CDA',
            signature: cdaSignature,
            certificate: iccCert,
          };
        }

        return {
          success: false,
          method: 'CDA',
          errorCode: OdaErrorCode.DDA_RSA_FAILED,
          error: odaErrorReason(OdaErrorCode.DDA_RSA_FAILED, result.reason),
          signature: cdaSignature,
          certificate: iccCert,
        };
      }

      const rid = TLVParser.getTagValue(cardTags, '9F06');
      const capki = TLVParser.getTagValue(cardTags, '8F');

      if (!rid || !capki) {
        return {
          success: false,
          method: 'CDA',
          errorCode: OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING),
        };
      }

      const capk = this.findCAPK(rid, capki);
      if (!capk) {
        return {
          success: false,
          method: 'CDA',
          errorCode: OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING,
          error: odaErrorReason(OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING),
        };
      }

      const issuerKey = await this.rsa.importCAPK(capk);
      const result: ODAResult = await this.rsa.verifyCDA(
        hexToBytes(cdaSignature),
        hexToBytes(iccCert),
        issuerKey
      );

      if (result.success) {
        return {
          success: true,
          method: 'CDA',
          signature: cdaSignature,
          certificate: iccCert,
        };
      }

      return {
        success: false,
        method: 'CDA',
        errorCode: OdaErrorCode.DDA_RSA_FAILED,
        error: odaErrorReason(OdaErrorCode.DDA_RSA_FAILED, result.reason),
        signature: cdaSignature,
        certificate: iccCert,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        method: 'CDA',
        errorCode: OdaErrorCode.CDA_EXCEPTION,
        error: odaErrorReason(OdaErrorCode.CDA_EXCEPTION, detail),
      };
    }
  }

  private findCAPK(rid: string, index: string): CAPK | null {
    return this.capks.find(capk =>
      capk.rid.toUpperCase() === rid.toUpperCase() &&
      capk.index.toUpperCase() === index.toUpperCase()
    ) || null;
  }

  getRSA(): RSAODA {
    return this.rsa;
  }

  addCAPK(capk: CAPK): void {
    this.capks.push(capk);
    this.rsa = new RSAODA(this.capks);
  }

  getCAPKs(): CAPK[] {
    return [...this.capks];
  }
}
