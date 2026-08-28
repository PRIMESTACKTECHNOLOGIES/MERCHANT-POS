import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface TerminalRiskResult {
  proceed: boolean;
  reason?: string;
  requiresOnline: boolean;
  floorLimitExceeded: boolean;
  randomSelection: boolean;
  velocityCheckFailed: boolean;
}

export interface TerminalLimits {
  floorLimit: number;
  randomSelectionPercentage: number;
  cumulativeOfflineLimit: number;
  consecutiveOfflineLimit: number;
}

export class TerminalRiskManagement {
  private limits: TerminalLimits;
  private transactionHistory: Array<{
    amount: number;
    timestamp: Date;
    online: boolean;
  }> = [];

  constructor(limits: TerminalLimits = {
    floorLimit: Number.MAX_SAFE_INTEGER,
    randomSelectionPercentage: 0,
    cumulativeOfflineLimit: Number.MAX_SAFE_INTEGER,
    consecutiveOfflineLimit: Number.MAX_SAFE_INTEGER
  }) {
    this.limits = limits;
  }

  checkTransaction(cardData: string, amount: number): TerminalRiskResult {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      
      // Check floor limit
      const floorLimitCheck = this.checkFloorLimit(amount);
      if (floorLimitCheck.exceeded) {
        return {
          proceed: false,
          reason: 'Floor limit exceeded',
          requiresOnline: true,
          floorLimitExceeded: true,
          randomSelection: false,
          velocityCheckFailed: false
        };
      }

      // Check random selection
      const randomSelection = this.performRandomSelection();
      if (randomSelection.selected) {
        return {
          proceed: true,
          reason: 'Random selection for online',
          requiresOnline: true,
          floorLimitExceeded: false,
          randomSelection: true,
          velocityCheckFailed: false
        };
      }

      // Check velocity limits
      const velocityCheck = this.checkVelocityLimits(amount);
      if (velocityCheck.failed) {
        return {
          proceed: false,
          reason: velocityCheck.reason,
          requiresOnline: true,
          floorLimitExceeded: false,
          randomSelection: false,
          velocityCheckFailed: true
        };
      }

      // Check card-specific limits
      const cardCheck = this.checkCardLimits(cardTags, amount);
      if (cardCheck.requiresOnline) {
        return {
          proceed: cardCheck.proceed,
          reason: cardCheck.reason,
          requiresOnline: true,
          floorLimitExceeded: false,
          randomSelection: false,
          velocityCheckFailed: false
        };
      }

      // All checks passed - allow offline transaction
      return {
        proceed: true,
        reason: 'Offline transaction approved',
        requiresOnline: false,
        floorLimitExceeded: false,
        randomSelection: false,
        velocityCheckFailed: false
      };
    } catch (error) {
      return {
        proceed: false,
        reason: `Risk check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        requiresOnline: true,
        floorLimitExceeded: false,
        randomSelection: false,
        velocityCheckFailed: false
      };
    }
  }

  private checkFloorLimit(amount: number): { exceeded: boolean } {
    return {
      exceeded: amount > this.limits.floorLimit
    };
  }

  private performRandomSelection(): { selected: boolean } {
    const random = Math.random() * 100;
    return {
      selected: random < this.limits.randomSelectionPercentage
    };
  }

  private checkVelocityLimits(amount: number): { failed: boolean; reason?: string } {
    const now = new Date();
    const recentTransactions = this.transactionHistory.filter(
      txn => now.getTime() - txn.timestamp.getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    // Check cumulative offline limit
    const cumulativeOfflineAmount = recentTransactions
      .filter(txn => !txn.online)
      .reduce((sum, txn) => sum + txn.amount, 0);

    if (cumulativeOfflineAmount + amount > this.limits.cumulativeOfflineLimit) {
      return {
        failed: true,
        reason: 'Cumulative offline limit exceeded'
      };
    }

    // Check consecutive offline limit
    const recentOfflineCount = recentTransactions
      .slice(-this.limits.consecutiveOfflineLimit)
      .filter(txn => !txn.online).length;

    if (recentOfflineCount >= this.limits.consecutiveOfflineLimit) {
      return {
        failed: true,
        reason: 'Consecutive offline limit exceeded'
      };
    }

    return { failed: false };
  }

  private checkCardLimits(cardTags: EMVTag[], amount: number): { proceed: boolean; requiresOnline: boolean; reason?: string } {
    // Check application interchange profile
    const aip = TLVParser.getTagValue(cardTags, '82');
    if (aip) {
      const aipBytes = Buffer.from(aip, 'hex');
      const offlineAllowed = (aipBytes[0] & 0x08) !== 0;
      
      if (!offlineAllowed) {
        return {
          proceed: true,
          requiresOnline: true,
          reason: 'Card does not allow offline transactions'
        };
      }
    }

    // Check application usage control
    const auc = TLVParser.getTagValue(cardTags, '9F07');
    if (auc) {
      const aucBytes = Buffer.from(auc, 'hex');
      const domesticOfflineAllowed = (aucBytes[0] & 0x80) !== 0;
      const internationalOfflineAllowed = (aucBytes[0] & 0x40) !== 0;
      
      if (!domesticOfflineAllowed && !internationalOfflineAllowed) {
        return {
          proceed: true,
          requiresOnline: true,
          reason: 'Application usage control prohibits offline'
        };
      }
    }

    // Check issuer action codes
    const iacDenial = TLVParser.getTagValue(cardTags, '9F0E');
    const iacOnline = TLVParser.getTagValue(cardTags, '9F0F');
    const iacDefault = TLVParser.getTagValue(cardTags, '9F0D');

    if (iacDenial || iacOnline || iacDefault) {
      // Parse IACs and check if transaction should go online
      const shouldGoOnline = this.checkIACs(iacDenial, iacOnline, iacDefault, amount);
      if (shouldGoOnline) {
        return {
          proceed: true,
          requiresOnline: true,
          reason: 'Issuer action codes require online'
        };
      }
    }

    return {
      proceed: true,
      requiresOnline: false
    };
  }

  private checkIACs(iacDenial: string | undefined, iacOnline: string | undefined, iacDefault: string | undefined, amount: number): boolean {
    // Simplified IAC checking
    // In a real implementation, this would parse the IAC bytes
    // and check against terminal and transaction data
    
    if (iacOnline && amount > 0) {
      return true; // Simplified: if IAC-Online exists, go online
    }

    return false;
  }

  recordTransaction(amount: number, online: boolean): void {
    this.transactionHistory.push({
      amount,
      timestamp: new Date(),
      online
    });

    // Keep only recent transactions (last 30 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    this.transactionHistory = this.transactionHistory.filter(
      txn => txn.timestamp > cutoffDate
    );
  }

  getTransactionHistory(): Array<{
    amount: number;
    timestamp: Date;
    online: boolean;
  }> {
    return [...this.transactionHistory];
  }

  updateLimits(newLimits: Partial<TerminalLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
  }

  getLimits(): TerminalLimits {
    return { ...this.limits };
  }
}
