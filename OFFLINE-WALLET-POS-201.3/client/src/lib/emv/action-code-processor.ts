import { TLVParser, EMVTag } from './tlv-parser';

export interface ActionCodeResult {
  decision: 'APPROVE' | 'DECLINE' | 'ONLINE';
  reason: string;
  terminalActionCode?: string;
  issuerActionCode?: string;
  byte1?: number;
  byte2?: number;
  byte3?: number;
  byte4?: number;
  byte5?: number;
}

export interface ActionCodeConfig {
  terminalDefault: string;
  terminalDenial: string;
  terminalOnline: string;
  issuerDefault: string;
  issuerDenial: string;
  issuerOnline: string;
}

export class ActionCodeProcessor {
  private config: ActionCodeConfig;

  constructor(config: Partial<ActionCodeConfig> = {}) {
    this.config = {
      terminalDefault: config.terminalDefault || '0000000000',
      terminalDenial: config.terminalDenial || '0010000000',
      terminalOnline: config.terminalOnline || '0000000000',
      issuerDefault: config.issuerDefault || '0000000000',
      issuerDenial: config.issuerDenial || '0010000000',
      issuerOnline: config.issuerOnline || '0000000000'
    };
  }

  evaluateActionCodes(
    cardData: string,
    terminalData: string,
    transactionData: {
      amount: number;
      currencyCode: string;
      terminalCountryCode: string;
      transactionType: string;
      terminalType: string;
    }
  ): ActionCodeResult {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      const terminalTags = TLVParser.parseTLV(terminalData);

      // Get issuer action codes from card
      const iacDefault = TLVParser.getTagValue(cardTags, '9F0D');
      const iacDenial = TLVParser.getTagValue(cardTags, '9F0E');
      const iacOnline = TLVParser.getTagValue(cardTags, '9F0F');

      // Get terminal action codes
      const tacDefault = TLVParser.getTagValue(terminalTags, '9F1D') || this.config.terminalDefault;
      const tacDenial = TLVParser.getTagValue(terminalTags, '9F1E') || this.config.terminalDenial;
      const tacOnline = TLVParser.getTagValue(terminalTags, '9F1F') || this.config.terminalOnline;

      // Evaluate action codes in order of priority
      // 1. Check TAC-Denial first
      const denialResult = this.evaluateActionCode(tacDenial, 'TAC-Denial', cardTags, terminalTags, transactionData);
      if (denialResult.decision === 'DECLINE') {
        return denialResult;
      }

      // 2. Check IAC-Denial
      if (iacDenial) {
        const issuerDenialResult = this.evaluateActionCode(iacDenial, 'IAC-Denial', cardTags, terminalTags, transactionData);
        if (issuerDenialResult.decision === 'DECLINE') {
          return issuerDenialResult;
        }
      }

      // 3. Check TAC-Online
      const onlineResult = this.evaluateActionCode(tacOnline, 'TAC-Online', cardTags, terminalTags, transactionData);
      if (onlineResult.decision === 'ONLINE') {
        return onlineResult;
      }

      // 4. Check IAC-Online
      if (iacOnline) {
        const issuerOnlineResult = this.evaluateActionCode(iacOnline, 'IAC-Online', cardTags, terminalTags, transactionData);
        if (issuerOnlineResult.decision === 'ONLINE') {
          return issuerOnlineResult;
        }
      }

      // 5. Check TAC-Default
      const defaultResult = this.evaluateActionCode(tacDefault, 'TAC-Default', cardTags, terminalTags, transactionData);
      if (defaultResult.decision !== 'APPROVE') {
        return defaultResult;
      }

      // 6. Check IAC-Default
      if (iacDefault) {
        const issuerDefaultResult = this.evaluateActionCode(iacDefault, 'IAC-Default', cardTags, terminalTags, transactionData);
        return issuerDefaultResult;
      }

      // Default to approve if no action codes trigger
      return {
        decision: 'APPROVE',
        reason: 'No action code conditions triggered',
        terminalActionCode: tacDefault,
        issuerActionCode: iacDefault
      };
    } catch (error) {
      return {
        decision: 'ONLINE',
        reason: `Action code evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        terminalActionCode: this.config.terminalDefault,
        issuerActionCode: this.config.issuerDefault
      };
    }
  }

  private evaluateActionCode(
    actionCode: string,
    source: string,
    cardTags: EMVTag[],
    terminalTags: EMVTag[],
    transactionData: {
      amount: number;
      currencyCode: string;
      terminalCountryCode: string;
      transactionType: string;
      terminalType: string;
    }
  ): ActionCodeResult {
    try {
      const bytes = Buffer.from(actionCode, 'hex');
      
      if (bytes.length < 5) {
        return {
          decision: 'APPROVE',
          reason: `${source} too short, defaulting to approve`,
          terminalActionCode: actionCode
        };
      }

      const byte1 = bytes[0];
      const byte2 = bytes[1];
      const byte3 = bytes[2];
      const byte4 = bytes[3];
      const byte5 = bytes[4];

      // Check each bit according to EMV specifications
      const checks = [
        ...this.checkByte1(byte1, cardTags, terminalTags, transactionData),
        ...this.checkByte2(byte2, cardTags, terminalTags, transactionData),
        ...this.checkByte3(byte3, cardTags, terminalTags, transactionData),
        ...this.checkByte4(byte4, cardTags, terminalTags, transactionData),
        ...this.checkByte5(byte5, cardTags, terminalTags, transactionData)
      ];

      // Find the most restrictive decision
      const hasDecline = checks.some(check => check.decision === 'DECLINE');
      const hasOnline = checks.some(check => check.decision === 'ONLINE');

      if (hasDecline) {
        const declineReason = checks.find(check => check.decision === 'DECLINE')?.reason || 'Unknown decline reason';
        return {
          decision: 'DECLINE',
          reason: `${source}: ${declineReason}`,
          terminalActionCode: actionCode,
          byte1,
          byte2,
          byte3,
          byte4,
          byte5
        };
      }

      if (hasOnline) {
        const onlineReason = checks.find(check => check.decision === 'ONLINE')?.reason || 'Unknown online reason';
        return {
          decision: 'ONLINE',
          reason: `${source}: ${onlineReason}`,
          terminalActionCode: actionCode,
          byte1,
          byte2,
          byte3,
          byte4,
          byte5
        };
      }

      return {
        decision: 'APPROVE',
        reason: `${source}: No action code conditions triggered`,
        terminalActionCode: actionCode,
        byte1,
        byte2,
        byte3,
        byte4,
        byte5
      };
    } catch (error) {
      return {
        decision: 'ONLINE',
        reason: `${source}: Error evaluating action code - ${error instanceof Error ? error.message : 'Unknown error'}`,
        terminalActionCode: actionCode
      };
    }
  }

  private checkByte1(byte1: number, cardTags: EMVTag[], terminalTags: EMVTag[], transactionData: any): Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> {
    const checks: Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> = [];

    // Bit 8: Offline data authentication was not performed
    if ((byte1 & 0x80) !== 0) {
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x60) !== 0) {
        checks.push({ decision: 'ONLINE', reason: 'Offline data authentication not performed' });
      }
    }

    // Bit 7: SDA failed
    if ((byte1 & 0x40) !== 0) {
      // In a real implementation, this would check if SDA failed
      // For now, we'll check if card supports SDA
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x40) !== 0) {
        checks.push({ decision: 'DECLINE', reason: 'SDA failed' });
      }
    }

    // Bit 6: ICC data missing
    if ((byte1 & 0x20) !== 0) {
      const pan = TLVParser.getTagValue(cardTags, '5A');
      if (!pan) {
        checks.push({ decision: 'DECLINE', reason: 'ICC data missing' });
      }
    }

    // Bit 5: Card appears on terminal exception file
    if ((byte1 & 0x10) !== 0) {
      // In a real implementation, this would check terminal exception file
      // For now, we'll assume it's not on the exception file
    }

    // Bit 4: DDA failed
    if ((byte1 & 0x08) !== 0) {
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x20) !== 0) {
        checks.push({ decision: 'DECLINE', reason: 'DDA failed' });
      }
    }

    // Bit 3: CDA failed
    if ((byte1 & 0x04) !== 0) {
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x80) !== 0) {
        checks.push({ decision: 'DECLINE', reason: 'CDA failed' });
      }
    }

    // Bit 2: SDA selected
    if ((byte1 & 0x02) !== 0) {
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x40) !== 0 && (Buffer.from(aip, 'hex')[0] & 0x60) === 0x40) {
        checks.push({ decision: 'ONLINE', reason: 'SDA selected' });
      }
    }

    // Bit 1: RFU

    return checks;
  }

  private checkByte2(byte2: number, cardTags: EMVTag[], terminalTags: EMVTag[], transactionData: any): Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> {
    const checks: Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> = [];

    // Bit 8: Card number not on application effective date
    if ((byte2 & 0x80) !== 0) {
      const effectiveDate = TLVParser.getTagValue(cardTags, '5F25');
      if (effectiveDate) {
        const now = new Date();
        const effective = new Date(effectiveDate.substr(0, 4) + '-' + effectiveDate.substr(4, 2) + '-' + effectiveDate.substr(6, 2));
        if (now < effective) {
          checks.push({ decision: 'DECLINE', reason: 'Card not yet effective' });
        }
      }
    }

    // Bit 7: Expired application
    if ((byte2 & 0x40) !== 0) {
      const expiryDate = TLVParser.getTagValue(cardTags, '5F24');
      if (expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate.substr(0, 4) + '-' + expiryDate.substr(4, 2) + '-' + expiryDate.substr(6, 2));
        if (now > expiry) {
          checks.push({ decision: 'DECLINE', reason: 'Application expired' });
        }
      }
    }

    // Bit 6: Application not yet effective
    if ((byte2 & 0x20) !== 0) {
      const effectiveDate = TLVParser.getTagValue(cardTags, '5F25');
      if (effectiveDate) {
        const now = new Date();
        const effective = new Date(effectiveDate.substr(0, 4) + '-' + effectiveDate.substr(4, 2) + '-' + effectiveDate.substr(6, 2));
        if (now < effective) {
          checks.push({ decision: 'DECLINE', reason: 'Application not yet effective' });
        }
      }
    }

    // Bit 5: Requested service not allowed for card product
    if ((byte2 & 0x10) !== 0) {
      // In a real implementation, this would check service restrictions
      // For now, we'll assume service is allowed
    }

    // Bit 4: New card
    if ((byte2 & 0x08) !== 0) {
      const aip = TLVParser.getTagValue(cardTags, '82');
      if (aip && (Buffer.from(aip, 'hex')[0] & 0x08) !== 0) {
        checks.push({ decision: 'ONLINE', reason: 'New card' });
      }
    }

    // Bit 3: Cardholder verification was not successful
    if ((byte2 & 0x04) !== 0) {
      // In a real implementation, this would check if CVM failed
      // For now, we'll assume CVM was successful
    }

    // Bit 2: Unrecognised CVM
    if ((byte2 & 0x02) !== 0) {
      // In a real implementation, this would check CVM list
      // For now, we'll assume CVM is recognised
    }

    // Bit 1: PIN try limit exceeded
    if ((byte2 & 0x01) !== 0) {
      // In a real implementation, this would check PIN attempts
      // For now, we'll assume PIN attempts are within limit
    }

    return checks;
  }

  private checkByte3(byte3: number, cardTags: EMVTag[], terminalTags: EMVTag[], transactionData: any): Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> {
    const checks: Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> = [];

    // Bit 8: PIN entry required and PIN pad not present or not working
    if ((byte3 & 0x80) !== 0) {
      // In a real implementation, this would check PIN pad status
      // For now, we'll assume PIN pad is present and working
    }

    // Bit 7: PIN entry required, PIN pad present, but PIN was not entered
    if ((byte3 & 0x40) !== 0) {
      // In a real implementation, this would check if PIN was entered
      // For now, we'll assume PIN was entered if required
    }

    // Bit 6: Online PIN entered
    if ((byte3 & 0x20) !== 0) {
      // In a real implementation, this would check if online PIN was entered
      // For now, we'll assume offline PIN was used
    }

    // Bit 5: Transaction exceeds floor limit
    if ((byte3 & 0x10) !== 0) {
      if (transactionData.amount > 50) { // Default floor limit
        checks.push({ decision: 'ONLINE', reason: 'Transaction exceeds floor limit' });
      }
    }

    // Bit 4: Lower consecutive offline limit exceeded
    if ((byte3 & 0x08) !== 0) {
      const atc = TLVParser.getTagValue(cardTags, '9F36');
      const lastOnlineATC = TLVParser.getTagValue(cardTags, '9F5A');
      if (atc && lastOnlineATC) {
        const offlineCount = parseInt(atc, 16) - parseInt(lastOnlineATC, 16);
        if (offlineCount >= 3) { // Default lower limit
          checks.push({ decision: 'ONLINE', reason: 'Lower consecutive offline limit exceeded' });
        }
      }
    }

    // Bit 3: Upper consecutive offline limit exceeded
    if ((byte3 & 0x04) !== 0) {
      const atc = TLVParser.getTagValue(cardTags, '9F36');
      const lastOnlineATC = TLVParser.getTagValue(cardTags, '9F5A');
      if (atc && lastOnlineATC) {
        const offlineCount = parseInt(atc, 16) - parseInt(lastOnlineATC, 16);
        if (offlineCount >= 5) { // Default upper limit
          checks.push({ decision: 'DECLINE', reason: 'Upper consecutive offline limit exceeded' });
        }
      }
    }

    // Bit 2: Transaction selected randomly for online processing
    if ((byte3 & 0x02) !== 0) {
      // In a real implementation, this would perform random selection
      // For now, we'll assume not selected
    }

    // Bit 1: Merchant forced transaction online
    if ((byte3 & 0x01) !== 0) {
      // In a real implementation, this would check merchant override
      // For now, we'll assume no override
    }

    return checks;
  }

  private checkByte4(byte4: number, cardTags: EMVTag[], terminalTags: EMVTag[], transactionData: any): Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> {
    const checks: Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> = [];

    // Bit 8: Default TDOL used
    if ((byte4 & 0x80) !== 0) {
      // In a real implementation, this would check TDOL usage
      // For now, we'll assume TDOL is not used
    }

    // Bit 7: Issuer authentication failed
    if ((byte4 & 0x40) !== 0) {
      // In a real implementation, this would check issuer authentication
      // For now, we'll assume authentication succeeded
    }

    // Bit 6: Script processing failed before final GENERATE AC
    if ((byte4 & 0x20) !== 0) {
      // In a real implementation, this would check script processing
      // For now, we'll assume scripts processed successfully
    }

    // Bit 5: Script processing failed after final GENERATE AC
    if ((byte4 & 0x10) !== 0) {
      // In a real implementation, this would check script processing
      // For now, we'll assume scripts processed successfully
    }

    // Bits 4-1: RFU

    return checks;
  }

  private checkByte5(byte5: number, cardTags: EMVTag[], terminalTags: EMVTag[], transactionData: any): Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> {
    const checks: Array<{ decision: 'APPROVE' | 'DECLINE' | 'ONLINE'; reason: string }> = [];

    // All bits are RFU in byte 5
    // Reserved for future use

    return checks;
  }

  updateConfig(newConfig: Partial<ActionCodeConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): ActionCodeConfig {
    return { ...this.config };
  }

  createDefaultActionCodes(): {
    terminalDefault: string;
    terminalDenial: string;
    terminalOnline: string;
    issuerDefault: string;
    issuerDenial: string;
    issuerOnline: string;
  } {
    return {
      terminalDefault: '0000000000',
      terminalDenial: '0010000000',
      terminalOnline: '0000000000',
      issuerDefault: '0000000000',
      issuerDenial: '0010000000',
      issuerOnline: '0000000000'
    };
  }
}