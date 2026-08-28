import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface CardRiskResult {
  proceed: boolean;
  reason?: string;
  requiresOnline: boolean;
  decline: boolean;
  newPinRequired: boolean;
  exceededOfflineLimit: boolean;
  lastOnlineTooLong: boolean;
}

export interface CardLimits {
  lowerConsecutiveOfflineLimit: number;
  upperConsecutiveOfflineLimit: number;
  transactionOfflineLimit: number;
  cumulativeOfflineAmountLimit: number;
}

export class CardRiskManagement {
  private cardLimits: CardLimits;
  private lastOnlineDate: Date | null = null;
  private consecutiveOfflineTransactions = 0;
  private cumulativeOfflineAmount = 0;
  private cardTransactionCounter = 0;

  constructor(limits: CardLimits = {
    lowerConsecutiveOfflineLimit: 3,
    upperConsecutiveOfflineLimit: 5,
    transactionOfflineLimit: 50, // $50 per transaction
    cumulativeOfflineAmountLimit: 200 // $200 cumulative
  }) {
    this.cardLimits = limits;
  }

  checkCardRisk(cardData: string, amount: number): CardRiskResult {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      
      // Check offline counters
      const counterCheck = this.checkOfflineCounters(cardTags, amount);
      if (counterCheck.decline) {
        return counterCheck;
      }

      // Check last online date
      const lastOnlineCheck = this.checkLastOnlineDate(cardTags);
      if (lastOnlineCheck.requiresOnline) {
        return lastOnlineCheck;
      }

      // Check offline amount limits
      const amountCheck = this.checkOfflineAmountLimits(amount);
      if (amountCheck.exceededOfflineLimit) {
        return amountCheck;
      }

      // Check issuer action codes
      const iacCheck = this.checkIssuerActionCodes(cardTags, amount);
      if (iacCheck.decline || iacCheck.requiresOnline) {
        return iacCheck;
      }

      // All checks passed
      return {
        proceed: true,
        requiresOnline: false,
        decline: false,
        newPinRequired: false,
        exceededOfflineLimit: false,
        lastOnlineTooLong: false
      };
    } catch (error) {
      return {
        proceed: false,
        reason: `Card risk check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        requiresOnline: true,
        decline: false,
        newPinRequired: false,
        exceededOfflineLimit: false,
        lastOnlineTooLong: false
      };
    }
  }

  private checkOfflineCounters(cardTags: EMVTag[], amount: number): CardRiskResult {
    // Get offline counters from card
    const offlineCounter = TLVParser.getTagValue(cardTags, '9F53');
    const offlineAccumulator = TLVParser.getTagValue(cardTags, '9F5D');
    
    if (offlineCounter) {
      const counter = parseInt(offlineCounter, 16);
      
      // Check lower consecutive offline limit
      if (counter >= this.cardLimits.lowerConsecutiveOfflineLimit) {
        return {
          proceed: true,
          reason: 'Lower consecutive offline limit reached',
          requiresOnline: true,
          decline: false,
          newPinRequired: false,
          exceededOfflineLimit: false,
          lastOnlineTooLong: false
        };
      }

      // Check upper consecutive offline limit
      if (counter >= this.cardLimits.upperConsecutiveOfflineLimit) {
        return {
          proceed: false,
          reason: 'Upper consecutive offline limit exceeded',
          requiresOnline: false,
          decline: true,
          newPinRequired: false,
          exceededOfflineLimit: false,
          lastOnlineTooLong: false
        };
      }
    }

    // Check offline accumulator
    if (offlineAccumulator) {
      const accumulator = parseInt(offlineAccumulator, 16);
      
      if (accumulator >= this.cardLimits.cumulativeOfflineAmountLimit) {
        return {
          proceed: false,
          reason: 'Cumulative offline amount limit exceeded',
          requiresOnline: false,
          decline: true,
          newPinRequired: false,
          exceededOfflineLimit: true,
          lastOnlineTooLong: false
        };
      }
    }

    return {
      proceed: true,
      requiresOnline: false,
      decline: false,
      newPinRequired: false,
      exceededOfflineLimit: false,
      lastOnlineTooLong: false
    };
  }

  private checkLastOnlineDate(cardTags: EMVTag[]): CardRiskResult {
    // Get last online ATC register
    const lastOnlineATC = TLVParser.getTagValue(cardTags, '9F5A');
    
    if (lastOnlineATC) {
      const lastOnlineATCValue = parseInt(lastOnlineATC, 16);
      const currentATC = TLVParser.getTagValue(cardTags, '9F36');
      
      if (currentATC) {
        const currentATCValue = parseInt(currentATC, 16);
        const offlineTransactions = currentATCValue - lastOnlineATCValue;
        
        // If too many offline transactions since last online
        if (offlineTransactions >= this.cardLimits.upperConsecutiveOfflineLimit) {
          return {
            proceed: false,
            reason: 'Too many offline transactions since last online',
            requiresOnline: false,
            decline: true,
            newPinRequired: false,
            exceededOfflineLimit: false,
            lastOnlineTooLong: true
          };
        }

        // If approaching limit, require online
        if (offlineTransactions >= this.cardLimits.lowerConsecutiveOfflineLimit) {
          return {
            proceed: true,
            reason: 'Approaching offline limit',
            requiresOnline: true,
            decline: false,
            newPinRequired: false,
            exceededOfflineLimit: false,
            lastOnlineTooLong: false
          };
        }
      }
    }

    return {
      proceed: true,
      requiresOnline: false,
      decline: false,
      newPinRequired: false,
      exceededOfflineLimit: false,
      lastOnlineTooLong: false
    };
  }

  private checkOfflineAmountLimits(amount: number): CardRiskResult {
    // Check transaction offline limit
    if (amount > this.cardLimits.transactionOfflineLimit) {
      return {
        proceed: true,
        reason: 'Transaction amount exceeds offline limit',
        requiresOnline: true,
        decline: false,
        newPinRequired: false,
        exceededOfflineLimit: false,
        lastOnlineTooLong: false
      };
    }

    // Check cumulative offline amount
    if (this.cumulativeOfflineAmount + amount > this.cardLimits.cumulativeOfflineAmountLimit) {
      return {
        proceed: false,
        reason: 'Cumulative offline amount limit exceeded',
        requiresOnline: false,
        decline: true,
        newPinRequired: false,
        exceededOfflineLimit: true,
        lastOnlineTooLong: false
      };
    }

    return {
      proceed: true,
      requiresOnline: false,
      decline: false,
      newPinRequired: false,
      exceededOfflineLimit: false,
      lastOnlineTooLong: false
    };
  }

  private checkIssuerActionCodes(cardTags: EMVTag[], amount: number): CardRiskResult {
    // Get issuer action codes
    const iacDenial = TLVParser.getTagValue(cardTags, '9F0E');
    const iacOnline = TLVParser.getTagValue(cardTags, '9F0F');
    const iacDefault = TLVParser.getTagValue(cardTags, '9F0D');

    // Check IAC-Denial
    if (iacDenial) {
      const shouldDeny = this.evaluateIAC(iacDenial, amount, cardTags);
      if (shouldDeny) {
        return {
          proceed: false,
          reason: 'Issuer action code - denial',
          requiresOnline: false,
          decline: true,
          newPinRequired: false,
          exceededOfflineLimit: false,
          lastOnlineTooLong: false
        };
      }
    }

    // Check IAC-Online
    if (iacOnline) {
      const shouldGoOnline = this.evaluateIAC(iacOnline, amount, cardTags);
      if (shouldGoOnline) {
        return {
          proceed: true,
          reason: 'Issuer action code - online required',
          requiresOnline: true,
          decline: false,
          newPinRequired: false,
          exceededOfflineLimit: false,
          lastOnlineTooLong: false
        };
      }
    }

    // Check IAC-Default
    if (iacDefault) {
      const shouldGoOnline = this.evaluateIAC(iacDefault, amount, cardTags);
      if (shouldGoOnline) {
        return {
          proceed: true,
          reason: 'Issuer action code - default online',
          requiresOnline: true,
          decline: false,
          newPinRequired: false,
          exceededOfflineLimit: false,
          lastOnlineTooLong: false
        };
      }
    }

    return {
      proceed: true,
      requiresOnline: false,
      decline: false,
      newPinRequired: false,
      exceededOfflineLimit: false,
      lastOnlineTooLong: false
    };
  }

  private evaluateIAC(iac: string, amount: number, cardTags: EMVTag[]): boolean {
    // Simplified IAC evaluation
    // In a real implementation, this would parse the IAC bytes
    // and check against various transaction conditions
    
    try {
      const iacBytes = Buffer.from(iac, 'hex');
      
      // Check if IAC indicates online requirement
      // This is a simplified check - real implementation would be more complex
      if (iacBytes.length >= 5) {
        // Check various bits in the IAC
        const byte1 = iacBytes[0];
        const byte2 = iacBytes[1];
        const byte3 = iacBytes[2];
        const byte4 = iacBytes[3];
        const byte5 = iacBytes[4];
        
        // Example checks (simplified)
        if ((byte1 & 0x80) !== 0) return true; // Offline data authentication failed
        if ((byte1 & 0x40) !== 0) return true; // ICC data missing
        if ((byte2 & 0x80) !== 0) return true; // Card number not in application effective date
        if ((byte3 & 0x08) !== 0) return true; // Merchant forced transaction online
        if ((byte4 & 0x80) !== 0) return true; // Transaction exceeds floor limit
      }
    } catch (error) {
      // If IAC parsing fails, default to online
      return true;
    }
    
    return false;
  }

  updateCardLimits(newLimits: Partial<CardLimits>): void {
    this.cardLimits = { ...this.cardLimits, ...newLimits };
  }

  getCardLimits(): CardLimits {
    return { ...this.cardLimits };
  }

  recordOfflineTransaction(amount: number): void {
    this.consecutiveOfflineTransactions++;
    this.cumulativeOfflineAmount += amount;
  }

  resetOfflineCounters(): void {
    this.consecutiveOfflineTransactions = 0;
    this.cumulativeOfflineAmount = 0;
  }

  getOfflineStatus(): {
    consecutiveOfflineTransactions: number;
    cumulativeOfflineAmount: number;
    lastOnlineDate: Date | null;
  } {
    return {
      consecutiveOfflineTransactions: this.consecutiveOfflineTransactions,
      cumulativeOfflineAmount: this.cumulativeOfflineAmount,
      lastOnlineDate: this.lastOnlineDate
    };
  }
}