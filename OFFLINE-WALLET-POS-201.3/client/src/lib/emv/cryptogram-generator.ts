import crypto from 'crypto';
import { TLVParser, EMVTag } from './tlv-parser';

export interface CryptogramResult {
  cryptogram: string;
  decision: 'TC' | 'AAC' | 'ARQC';
  reason: string;
  cryptogramInformationData?: string;
  applicationTransactionCounter?: string;
}

export interface CryptogramInput {
  cardData: string;
  terminalData: string;
  transactionData: {
    amount: number;
    currencyCode: string;
    terminalCountryCode: string;
    transactionType: string;
    terminalType: string;
    transactionDate: string;
    transactionTime: string;
    unpredictableNumber: string;
  };
  decision: 'TC' | 'AAC' | 'ARQC';
  reason: string;
}

export class CryptogramGenerator {
  private static readonly MASTER_KEY_DERIVATION_CONSTANT = '00000000000000000000000000000000';

  generateCryptogram(input: CryptogramInput): CryptogramResult {
    try {
      const cardTags = TLVParser.parseTLV(input.cardData);
      const terminalTags = TLVParser.parseTLV(input.terminalData);

      // Get required data for cryptogram generation
      const pan = TLVParser.getTagValue(cardTags, '5A');
      const panSequence = TLVParser.getTagValue(cardTags, '5F34');
      const atc = TLVParser.getTagValue(cardTags, '9F36');
      const issuerApplicationData = TLVParser.getTagValue(cardTags, '9F10');

      if (!pan || !atc) {
        return {
          cryptogram: '0000000000000000',
          decision: input.decision,
          reason: `Missing required data: ${!pan ? 'PAN ' : ''}${!atc ? 'ATC ' : ''}`,
          cryptogramInformationData: '00',
          applicationTransactionCounter: '0000'
        };
      }

      // Generate the data to be signed
      const dataToSign = this.buildDataToSign(input, cardTags, terminalTags);
      
      // Generate the cryptogram
      const cryptogram = this.computeCryptogram(dataToSign, input.decision, cardTags, terminalTags);

      // Generate Cryptogram Information Data (CID)
      const cid = this.generateCID(input.decision, cardTags, terminalTags);

      return {
        cryptogram,
        decision: input.decision,
        reason: input.reason,
        cryptogramInformationData: cid,
        applicationTransactionCounter: atc
      };
    } catch (error) {
      return {
        cryptogram: '0000000000000000',
        decision: 'AAC',
        reason: `Cryptogram generation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cryptogramInformationData: '00',
        applicationTransactionCounter: '0000'
      };
    }
  }

  private buildDataToSign(
    input: CryptogramInput,
    cardTags: EMVTag[],
    terminalTags: EMVTag[]
  ): string {
    let data = '';

    // Add amount
    const amount = input.transactionData.amount.toString(16).padStart(12, '0');
    data += amount;

    // Add other amount
    const otherAmount = TLVParser.getTagValue(cardTags, '9F03') || '000000000000';
    data += otherAmount;

    // Add terminal country code
    data += input.transactionData.terminalCountryCode;

    // Add terminal verification results (TVR)
    const tvr = TLVParser.getTagValue(terminalTags, '95') || '0000000000';
    data += tvr;

    // Add transaction currency code
    data += input.transactionData.currencyCode;

    // Add transaction date
    data += input.transactionData.transactionDate;

    // Add transaction type
    data += input.transactionData.transactionType;

    // Add unpredictable number
    data += input.transactionData.unpredictableNumber;

    // Add application interchange profile (AIP)
    const aip = TLVParser.getTagValue(cardTags, '82') || '0000';
    data += aip;

    // Add application transaction counter (ATC)
    const atc = TLVParser.getTagValue(cardTags, '9F36');
    if (atc) data += atc;

    // Add card verification results (CVR) from issuer application data
    const issuerAppData = TLVParser.getTagValue(cardTags, '9F10');
    if (issuerAppData && issuerAppData.length >= 6) {
      // Extract CVR (usually bytes 3-6 of issuer application data)
      const cvr = issuerAppData.substr(4, 8);
      data += cvr;
    }

    return data;
  }

  private computeCryptogram(
    dataToSign: string,
    decision: 'TC' | 'AAC' | 'ARQC',
    cardTags: EMVTag[],
    terminalTags: EMVTag[]
  ): string {
    // In a real implementation, this would:
    // 1. Derive the session key from the master key
    // 2. Use the appropriate algorithm (DES, 3DES, AES)
    // 3. Generate the MAC/cryptogram

    // For simulation, we'll create a hash of the data
    const hash = crypto.createHash('sha256').update(dataToSign + decision).digest('hex');
    
    // Return first 16 characters (8 bytes) as the cryptogram
    return hash.substr(0, 16).toUpperCase();
  }

  private generateCID(decision: 'TC' | 'AAC' | 'ARQC', cardTags: EMVTag[], terminalTags: EMVTag[]): string {
    let cid = 0x00;

    // Set decision bits
    switch (decision) {
      case 'TC':
        cid |= 0x00; // 00 = Transaction approved
        break;
      case 'AAC':
        cid |= 0x40; // 01 = Transaction declined
        break;
      case 'ARQC':
        cid |= 0x80; // 10 = Online authorization required
        break;
    }

    // Set advice required bit (bit 5) - for ARQC decisions
    if (decision === 'ARQC') {
      cid |= 0x20;
    }

    // Set reason/advice code (bits 4-1)
    // In a real implementation, this would be based on the specific reason
    switch (decision) {
      case 'TC':
        cid |= 0x01; // Reason code 1
        break;
      case 'AAC':
        cid |= 0x02; // Reason code 2
        break;
      case 'ARQC':
        cid |= 0x03; // Reason code 3
        break;
    }

    return cid.toString(16).padStart(2, '0').toUpperCase();
  }

  generateOfflineCryptogram(
    cardData: string,
    terminalData: string,
    transactionData: {
      amount: number;
      currencyCode: string;
      terminalCountryCode: string;
      transactionType: string;
      terminalType: string;
      transactionDate: string;
      transactionTime: string;
      unpredictableNumber: string;
    },
    decision: 'TC' | 'AAC' | 'ARQC',
    reason: string
  ): CryptogramResult {
    return this.generateCryptogram({
      cardData,
      terminalData,
      transactionData,
      decision,
      reason
    });
  }

  generateTC(cardData: string, terminalData: string, transactionData: any, reason: string): CryptogramResult {
    return this.generateOfflineCryptogram(cardData, terminalData, transactionData, 'TC', reason);
  }

  generateAAC(cardData: string, terminalData: string, transactionData: any, reason: string): CryptogramResult {
    return this.generateOfflineCryptogram(cardData, terminalData, transactionData, 'AAC', reason);
  }

  generateARQC(cardData: string, terminalData: string, transactionData: any, reason: string): CryptogramResult {
    return this.generateOfflineCryptogram(cardData, terminalData, transactionData, 'ARQC', reason);
  }

  private deriveSessionKey(masterKey: string, atc: string): string {
    // In a real implementation, this would derive a session key
    // using the master key and ATC according to EMV specifications
    
    // For simulation, we'll create a simple derivation
    const derivationData = masterKey + atc;
    return crypto.createHash('sha256').update(derivationData).digest('hex').substr(0, 32);
  }

  private computeMAC(data: string, key: string): string {
    // In a real implementation, this would compute a MAC using
    // the appropriate algorithm (DES, 3DES, AES, etc.)
    
    // For simulation, we'll create a simple MAC
    const macData = key + data;
    return crypto.createHash('sha256').update(macData).digest('hex').substr(0, 16);
  }
}