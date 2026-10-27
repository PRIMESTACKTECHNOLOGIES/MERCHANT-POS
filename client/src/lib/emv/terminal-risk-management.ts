/**
 * Terminal Risk Management — EMV Book 4 §6.3
 *
 * Evaluates whether an offline transaction should proceed or be forced online
 * based on floor limits, random selection, and merchant/terminal policy.
 */

import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface TerminalLimits {
  floorLimit: number;              // e.g. 5000 = 50.00 in minor units
  randomOnlinePercentage: number;  // 0–100
  forceOnline: boolean;            // merchant override
  allowOffline: boolean;           // terminal capability
}

export interface TerminalRiskResult {
  proceed: boolean;
  requiresOnline: boolean;
  reason?: string;
  exceedsFloorLimit?: boolean;
  randomOnlineSelected?: boolean;
  merchantForcedOnline?: boolean;
}

export class TerminalRiskManagement {
  private limits: TerminalLimits;

  constructor(limits: TerminalLimits = {
    floorLimit: 5000,
    randomOnlinePercentage: 10,
    forceOnline: false,
    allowOffline: true
  }) {
    this.limits = limits;
  }

  evaluate(cardData: string, amount: number): TerminalRiskResult {
    try {
      // 1. Merchant forced online
      if (this.limits.forceOnline) {
        return {
          proceed: true,
          requiresOnline: true,
          merchantForcedOnline: true,
          reason: 'Merchant forced transaction online'
        };
      }

      // 2. Terminal does not allow offline
      if (!this.limits.allowOffline) {
        return {
          proceed: true,
          requiresOnline: true,
          reason: 'Terminal does not allow offline transactions'
        };
      }

      // 3. Floor limit check
      if (amount > this.limits.floorLimit) {
        return {
          proceed: true,
          requiresOnline: true,
          exceedsFloorLimit: true,
          reason: 'Transaction exceeds floor limit'
        };
      }

      // 4. Random online selection
      const randomValue = Math.floor(Math.random() * 100);
      if (randomValue < this.limits.randomOnlinePercentage) {
        return {
          proceed: true,
          requiresOnline: true,
          randomOnlineSelected: true,
          reason: 'Random online selection triggered'
        };
      }

      // 5. Default: offline allowed
      return {
        proceed: true,
        requiresOnline: false,
        reason: 'Terminal risk checks passed'
      };

    } catch (err) {
      return {
        proceed: true,
        requiresOnline: true,
        reason: 'Terminal risk error — forcing online'
      };
    }
  }

  updateLimits(newLimits: Partial<TerminalLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
  }

  getLimits(): TerminalLimits {
    return { ...this.limits };
  }
}
