import crypto from 'crypto';
import { TLVParser, EMVTag } from './tlv-parser';

export interface AuthenticationResult {
  success: boolean;
  method: 'SDA' | 'DDA' | 'CDA';
  error?: string;
  signature?: string;
  certificate?: string;
}

export interface CAPK {
  rid: string;
  index: string;
  modulus: string;
  exponent: string;
  hashAlgorithm: string;
  algorithm: string;
  expiryDate: string;
}

export class OfflineDataAuthentication {
  private capks: CAPK[] = [];

  constructor(capks: CAPK[] = []) {
    this.capks = capks;
  }

  authenticate(cardData: string, terminalData: string): AuthenticationResult {
    const cardTags = TLVParser.parseTLV(cardData);
    
    // Check authentication method from AIP
    const aip = TLVParser.getTagValue(cardTags, '82');
    if (!aip) {
      return { success: false, method: 'SDA', error: 'AIP not found' };
    }

    const aipBytes = Buffer.from(aip, 'hex');
    const supportsSDA = (aipBytes[0] & 0x40) !== 0;
    const supportsDDA = (aipBytes[0] & 0x20) !== 0;
    const supportsCDA = (aipBytes[0] & 0x80) !== 0;

    // Try CDA first if supported
    if (supportsCDA) {
      return this.performCDA(cardData, terminalData);
    }

    // Try DDA if supported
    if (supportsDDA) {
      return this.performDDA(cardData, terminalData);
    }

    // Fall back to SDA
    if (supportsSDA) {
      return this.performSDA(cardData);
    }

    return { success: false, method: 'SDA', error: 'No supported authentication method' };
  }

  private performSDA(cardData: string): AuthenticationResult {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      
      // Get signed static application data (SSAD)
      const ssad = TLVParser.getTagValue(cardTags, '93');
      if (!ssad) {
        return { success: false, method: 'SDA', error: 'SSAD not found' };
      }

      // Get issuer public key certificate
      const issuerCert = TLVParser.getTagValue(cardTags, '90');
      if (!issuerCert) {
        return { success: false, method: 'SDA', error: 'Issuer certificate not found' };
      }

      // Get CA public key
      const rid = TLVParser.getTagValue(cardTags, '9F06');
      const capki = TLVParser.getTagValue(cardTags, '8F');
      
      if (!rid || !capki) {
        return { success: false, method: 'SDA', error: 'RID or CAPKI not found' };
      }

      const capk = this.findCAPK(rid, capki);
      if (!capk) {
        return { success: false, method: 'SDA', error: 'CAPK not found' };
      }

      // Verify issuer certificate
      const issuerCertVerified = this.verifyCertificate(issuerCert, capk);
      if (!issuerCertVerified) {
        return { success: false, method: 'SDA', error: 'Issuer certificate verification failed' };
      }

      // Extract issuer public key from certificate
      const issuerPublicKey = this.extractPublicKeyFromCertificate(issuerCert);
      
      // Verify SSAD using issuer public key
      const ssadVerified = this.verifySignature(ssad, this.buildStaticDataToSign(cardTags), issuerPublicKey);
      
      return {
        success: ssadVerified,
        method: 'SDA',
        error: ssadVerified ? undefined : 'SSAD verification failed',
        signature: ssad,
        certificate: issuerCert
      };
    } catch (error) {
      return {
        success: false,
        method: 'SDA',
        error: `SDA failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private performDDA(cardData: string, terminalData: string): AuthenticationResult {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      
      // Get ICC public key certificate
      const iccCert = TLVParser.getTagValue(cardTags, '9F46');
      if (!iccCert) {
        return { success: false, method: 'DDA', error: 'ICC certificate not found' };
      }

      // Get CA public key
      const rid = TLVParser.getTagValue(cardTags, '9F06');
      const capki = TLVParser.getTagValue(cardTags, '8F');
      
      if (!rid || !capki) {
        return { success: false, method: 'DDA', error: 'RID or CAPKI not found' };
      }

      const capk = this.findCAPK(rid, capki);
      if (!capk) {
        return { success: false, method: 'DDA', error: 'CAPK not found' };
      }

      // Verify ICC certificate
      const iccCertVerified = this.verifyCertificate(iccCert, capk);
      if (!iccCertVerified) {
        return { success: false, method: 'DDA', error: 'ICC certificate verification failed' };
      }

      // Extract ICC public key from certificate
      const iccPublicKey = this.extractPublicKeyFromCertificate(iccCert);
      
      // Generate unpredictable number
      const unpredictableNumber = crypto.randomBytes(4).toString('hex');
      
      // Build dynamic data to sign
      const dynamicData = this.buildDynamicDataToSign(cardTags, terminalData, unpredictableNumber);
      
      // Get dynamic signature from card (would be done via APDU in real implementation)
      const dynamicSignature = TLVParser.getTagValue(cardTags, '9F4B');
      if (!dynamicSignature) {
        return { success: false, method: 'DDA', error: 'Dynamic signature not found' };
      }

      // Verify dynamic signature
      const signatureVerified = this.verifySignature(dynamicSignature, dynamicData, iccPublicKey);
      
      return {
        success: signatureVerified,
        method: 'DDA',
        error: signatureVerified ? undefined : 'Dynamic signature verification failed',
        signature: dynamicSignature,
        certificate: iccCert
      };
    } catch (error) {
      return {
        success: false,
        method: 'DDA',
        error: `DDA failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private performCDA(cardData: string, terminalData: string): AuthenticationResult {
    try {
      // CDA combines DDA with transaction data
      const ddaResult = this.performDDA(cardData, terminalData);
      
      if (!ddaResult.success) {
        return ddaResult;
      }

      // Additional CDA-specific verification would go here
      // This includes verifying the transaction cryptogram
      
      return {
        ...ddaResult,
        method: 'CDA'
      };
    } catch (error) {
      return {
        success: false,
        method: 'CDA',
        error: `CDA failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private findCAPK(rid: string, index: string): CAPK | null {
    return this.capks.find(capk => 
      capk.rid.toUpperCase() === rid.toUpperCase() && 
      capk.index.toUpperCase() === index.toUpperCase()
    ) || null;
  }

  private verifyCertificate(cert: string, capk: CAPK): boolean {
    try {
      // In a real implementation, this would verify the certificate signature
      // against the CA public key
      
      // For now, we'll simulate verification
      const certBuffer = Buffer.from(cert, 'hex');
      const certHash = crypto.createHash('sha1').update(certBuffer).digest('hex');
      
      // Simulate certificate validation
      return certHash.length > 0 && certBuffer.length > 0;
    } catch (error) {
      return false;
    }
  }

  private extractPublicKeyFromCertificate(cert: string): { modulus: string; exponent: string } {
    // In a real implementation, this would extract the public key
    // from the certificate structure
    
    // For simulation, we'll use dummy values
    return {
      modulus: '00' + cert.substr(0, 128),
      exponent: '010001'
    };
  }

  private verifySignature(signature: string, data: string, publicKey: { modulus: string; exponent: string }): boolean {
    try {
      // In a real implementation, this would verify the signature
      // using the public key and appropriate algorithm
      
      // For simulation, we'll check basic format
      return signature.length > 0 && data.length > 0 && publicKey.modulus.length > 0;
    } catch (error) {
      return false;
    }
  }

  private buildStaticDataToSign(cardTags: EMVTag[]): string {
    // Build static data for SDA verification
    // This would include application data, PAN, expiry, etc.
    const relevantTags = ['5A', '5F24', '5F34', '9F06', '9F07'];
    let data = '';
    
    for (const tag of relevantTags) {
      const value = TLVParser.getTagValue(cardTags, tag);
      if (value) {
        data += TLVParser.buildTLV(tag, value);
      }
    }
    
    return data;
  }

  private buildDynamicDataToSign(cardTags: EMVTag[], terminalData: string, unpredictableNumber: string): string {
    // Build dynamic data for DDA verification
    const relevantTags = ['9F02', '9F03', '9F1A', '95', '5F2A', '9A', '9F37', '9F4E'];
    let data = unpredictableNumber;
    
    for (const tag of relevantTags) {
      const value = TLVParser.getTagValue(cardTags, tag);
      if (value) {
        data += TLVParser.buildTLV(tag, value);
      }
    }
    
    return data;
  }

  addCAPK(capk: CAPK): void {
    this.capks.push(capk);
  }

  getCAPKs(): CAPK[] {
    return [...this.capks];
  }
}