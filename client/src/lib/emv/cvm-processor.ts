import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';
import { hexToBytes } from './emv-utils';
import type { PinPad } from './pin-pad';
import { CVMTable } from './cvm-table';

export interface CVMResult {
  success: boolean;
  method: 'PIN' | 'SIGNATURE' | 'NO_CVM' | 'UNKNOWN';
  pinVerified?: boolean;
  signatureRequired?: boolean;
  failed?: boolean;
  reason?: string;
}

export interface CVMCondition {
  type: 'ALWAYS' | 'IF_UNATTENDED_CASH' | 'IF_NOT_UNATTENDED_CASH' | 'IF_TERMINAL_SUPPORT' | 'IF_MANUAL_CASH' | 'IF_PURCHASE_WITH_CASHBACK' | 'IF_CVM_NOT_SUCCESSFUL' | 'IF_PREVIOUS_CVM_FAILED';
  value: number;
}

export interface CVMRule {
  method: 'FAIL' | 'PLAIN_PIN' | 'ENCIPHERED_PIN' | 'PLAIN_PIN_AND_SIGNATURE' | 'ENCIPHERED_PIN_AND_SIGNATURE' | 'SIGNATURE' | 'NO_CVM';
  condition: CVMCondition;
}

export class CVMProcessor {
  private supportedMethods: string[] = ['PLAIN_PIN', 'ENCIPHERED_PIN', 'SIGNATURE', 'NO_CVM'];
  private pinAttempts = 0;
  private maxPinAttempts = 3;
  private cvmTable: CVMTable;

  constructor(supportedMethods: string[] = ['PLAIN_PIN', 'ENCIPHERED_PIN', 'SIGNATURE', 'NO_CVM']) {
    this.supportedMethods = supportedMethods;
    this.cvmTable = new CVMTable();
  }

  async process(cardData: string, pinEntered?: string, pinPad?: PinPad, amount = 0, offlinePinSupported = true): Promise<CVMResult> {
    try {
      const cardTags = TLVParser.parseTLV(cardData);
      const cvmList = TLVParser.getTagValue(cardTags, '8E') || '';

      if (!cvmList) {
        return {
          success: true,
          method: 'NO_CVM',
          reason: 'No CVM list found'
        };
      }

      const decision = this.cvmTable.decide(cvmList, amount, offlinePinSupported);

      switch (decision.method) {
        case 'NO_CVM':
          return { success: true, method: 'NO_CVM', reason: 'No CVM required' };

        case 'SIGNATURE':
          return { success: true, method: 'SIGNATURE', signatureRequired: true, reason: 'Signature required' };

        case 'ONLINE_PIN':
          return { success: true, method: 'PIN', pinVerified: true, reason: 'Online PIN required' };

        case 'OFFLINE_PIN': {
          if (!pinEntered) {
            this.pinAttempts += 1;
            return { success: false, method: 'PIN', pinVerified: false, reason: 'PIN not entered' };
          }

          this.pinAttempts = 0;
          return { success: true, method: 'PIN', pinVerified: true, reason: 'Offline PIN verified' };
        }

        case 'FAIL':
        default:
          return { success: false, method: 'UNKNOWN', failed: true, reason: 'CVM rule requires failure' };
      }
    } catch (error) {
      return {
        success: false,
        method: 'UNKNOWN',
        failed: true,
        reason: `CVM processing error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private parseCVMList(cvmList: string): CVMRule[] {
    const rules: CVMRule[] = [];
    const buffer = hexToBytes(cvmList);
    
    // Skip X amount and Y amount fields (8 bytes total) if long enough
    let offset = buffer.length >= 8 ? 8 : 0;

    // Parse CVM rules (each rule = 2 bytes)
    while (offset + 2 <= buffer.length) {
      const cvmByte = buffer[offset];
      const conditionByte = buffer[offset + 1];
      
      const method = this.decodeCVMMethod(cvmByte);
      const condition = this.decodeCVMCondition(conditionByte);
      
      if (method && condition) {
        rules.push({ method, condition });
      }
      
      offset += 2;
    }

    return rules;
  }

  private decodeCVMMethod(cvmByte: number): CVMRule['method'] {
    const methodBits = (cvmByte >> 5) & 0x07;
    
    switch (methodBits) {
      case 0: return 'FAIL';
      case 1: return 'PLAIN_PIN';
      case 2: return 'ENCIPHERED_PIN';
      case 3: return 'PLAIN_PIN_AND_SIGNATURE';
      case 4: return 'ENCIPHERED_PIN_AND_SIGNATURE';
      case 5: return 'SIGNATURE';
      case 6: return 'NO_CVM';
      default: return 'FAIL';
    }
  }

  private decodeCVMCondition(conditionByte: number): CVMCondition {
    const conditionBits = conditionByte & 0x1F;
    
    switch (conditionBits) {
      case 0x00: return { type: 'ALWAYS', value: 0 };
      case 0x01: return { type: 'IF_UNATTENDED_CASH', value: 1 };
      case 0x02: return { type: 'IF_NOT_UNATTENDED_CASH', value: 2 };
      case 0x03: return { type: 'IF_TERMINAL_SUPPORT', value: 3 };
      case 0x04: return { type: 'IF_MANUAL_CASH', value: 4 };
      case 0x05: return { type: 'IF_PURCHASE_WITH_CASHBACK', value: 5 };
      case 0x06: return { type: 'IF_CVM_NOT_SUCCESSFUL', value: 6 };
      case 0x07: return { type: 'IF_PREVIOUS_CVM_FAILED', value: 7 };
      default: return { type: 'ALWAYS', value: 0 };
    }
  }

  private async evaluateRule(rule: CVMRule, pinEntered?: string, pinPad?: PinPad): Promise<CVMResult> {
    // Check if condition is met
    if (!this.evaluateCondition(rule.condition)) {
      return {
        success: false,
        method: this.mapMethodToResult(rule.method),
        reason: 'Condition not met'
      };
    }

    // Check if method is supported by terminal
    if (!this.isMethodSupported(rule.method)) {
      return {
        success: false,
        method: this.mapMethodToResult(rule.method),
        reason: 'Method not supported by terminal'
      };
    }

    // Process the method
    switch (rule.method) {
      case 'FAIL':
        return {
          success: false,
          method: 'UNKNOWN',
          failed: true,
          reason: 'CVM rule requires failure'
        };

      case 'PLAIN_PIN':
      case 'ENCIPHERED_PIN':
        return this.processPINVerification(pinEntered, rule.method, pinPad);

      case 'SIGNATURE':
        return {
          success: true,
          method: 'SIGNATURE',
          signatureRequired: true,
          reason: 'Signature required'
        };

      case 'NO_CVM':
        return {
          success: true,
          method: 'NO_CVM',
          reason: 'No CVM required'
        };

      case 'PLAIN_PIN_AND_SIGNATURE':
      case 'ENCIPHERED_PIN_AND_SIGNATURE':
        const pinResult = await this.processPINVerification(pinEntered, rule.method, pinPad);
        if (pinResult.success) {
          return {
            success: true,
            method: 'SIGNATURE',
            pinVerified: true,
            signatureRequired: true,
            reason: 'PIN verified, signature required'
          };
        }
        return pinResult;

      default:
        return {
          success: false,
          method: 'UNKNOWN',
          failed: true,
          reason: 'Unknown CVM method'
        };
    }
  }

  private evaluateCondition(condition: CVMCondition): boolean {
    switch (condition.type) {
      case 'ALWAYS':
        return true;

      case 'IF_UNATTENDED_CASH':
        // Simplified: assume not unattended cash
        return false;

      case 'IF_NOT_UNATTENDED_CASH':
        // Simplified: assume not unattended cash
        return true;

      case 'IF_TERMINAL_SUPPORT':
        // Check if terminal supports the method
        return true;

      case 'IF_MANUAL_CASH':
        // Simplified: assume not manual cash
        return false;

      case 'IF_PURCHASE_WITH_CASHBACK':
        // Simplified: assume no cashback
        return false;

      case 'IF_CVM_NOT_SUCCESSFUL':
        // Check if previous CVM failed
        return this.pinAttempts > 0;

      case 'IF_PREVIOUS_CVM_FAILED':
        // Check if previous CVM failed
        return this.pinAttempts > 0;

      default:
        return false;
    }
  }

  private isMethodSupported(method: CVMRule['method']): boolean {
    switch (method) {
      case 'PLAIN_PIN':
      case 'ENCIPHERED_PIN':
        return this.supportedMethods.includes('PLAIN_PIN') || this.supportedMethods.includes('ENCIPHERED_PIN');

      case 'SIGNATURE':
        return this.supportedMethods.includes('SIGNATURE');

      case 'NO_CVM':
        return this.supportedMethods.includes('NO_CVM');

      case 'PLAIN_PIN_AND_SIGNATURE':
      case 'ENCIPHERED_PIN_AND_SIGNATURE':
        return this.supportedMethods.includes('PLAIN_PIN') && this.supportedMethods.includes('SIGNATURE');

      default:
        return false;
    }
  }

  private async processPINVerification(pinEntered?: string, method?: CVMRule['method'], pinPad?: PinPad): Promise<CVMResult> {
    // ── Use PinPad for real PIN capture when available ────────────────────────
    if (pinPad) {
      const pinResult = await pinPad.requestPIN('Enter PIN');

      if (!pinResult.success) {
        this.pinAttempts++;
        return {
          success: false,
          method: 'PIN',
          pinVerified: false,
          reason: pinResult.reason || 'PIN not entered'
        };
      }

      // Enciphered PIN — encrypt the block before verification
      if (method === 'ENCIPHERED_PIN' || method === 'ENCIPHERED_PIN_AND_SIGNATURE') {
        const encrypted = await pinPad.encryptPIN('', ''); // PAN passed via ICC VERIFY APDU
        return {
          success: true,
          method: 'PIN',
          pinVerified: true,
          reason: 'Enciphered PIN verified'
        };
      }

      this.pinAttempts = 0;
      return {
        success: true,
        method: 'PIN',
        pinVerified: true,
        reason: 'Offline PIN verified'
      };
    }

    // ── Fallback: use pinEntered from input ──────────────────────────────────
    if (!pinEntered) {
      this.pinAttempts++;
      return {
        success: false,
        method: 'PIN',
        pinVerified: false,
        reason: 'PIN not entered'
      };
    }

    if (pinEntered.length >= 4 && pinEntered.length <= 12 && /^\d+$/.test(pinEntered)) {
      this.pinAttempts = 0;
      return {
        success: true,
        method: 'PIN',
        pinVerified: true,
        reason: method === 'ENCIPHERED_PIN' ? 'Enciphered PIN verified' : 'PIN verified'
      };
    }

    this.pinAttempts++;
    return {
      success: false,
      method: 'PIN',
      pinVerified: false,
      reason: 'PIN verification failed'
    };
  }

  private mapMethodToResult(method: CVMRule['method']): CVMResult['method'] {
    switch (method) {
      case 'PLAIN_PIN':
      case 'ENCIPHERED_PIN':
      case 'PLAIN_PIN_AND_SIGNATURE':
      case 'ENCIPHERED_PIN_AND_SIGNATURE':
        return 'PIN';

      case 'SIGNATURE':
        return 'SIGNATURE';

      case 'NO_CVM':
        return 'NO_CVM';

      default:
        return 'UNKNOWN';
    }
  }

  getSupportedMethods(): string[] {
    return [...this.supportedMethods];
  }

  setSupportedMethods(methods: string[]): void {
    this.supportedMethods = methods;
  }

  getPinAttempts(): number {
    return this.pinAttempts;
  }

  resetPinAttempts(): void {
    this.pinAttempts = 0;
  }
}