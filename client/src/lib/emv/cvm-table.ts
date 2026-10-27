import { TLVParser } from './tlv-parser';

export type CVMMethod = 'NO_CVM' | 'OFFLINE_PIN' | 'ONLINE_PIN' | 'SIGNATURE' | 'FAIL';

export interface CVMDecision {
  method: CVMMethod;
  ruleIndex: number;
}

export class CVMTable {
  parseCVMList(cvmHex: string): number[] {
    const bytes = this.hexToBytes(cvmHex);
    const rules: number[] = [];

    let offset = bytes.length >= 8 ? 8 : 0;

    for (; offset + 1 < bytes.length; offset += 2) {
      const method = bytes[offset];
      const condition = bytes[offset + 1];
      rules.push((method << 8) | condition);
    }

    return rules;
  }

  decide(cvmHex: string, amount: number, isOfflineCapable: boolean): CVMDecision {
    const rules = this.parseCVMList(cvmHex);

    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      const method = (rule >> 8) & 0xFF;
      const condition = rule & 0xFF;

      if (!this.conditionMet(condition, amount)) continue;

      const cvm = this.mapMethod(method, isOfflineCapable);
      if (cvm !== 'FAIL') {
        return { method: cvm, ruleIndex: i };
      }
    }

    return { method: 'FAIL', ruleIndex: -1 };
  }

  private conditionMet(condition: number, amount: number): boolean {
    switch (condition) {
      case 0x00:
        return true;
      case 0x01:
        return amount > 0;
      case 0x02:
        return amount > 5000;
      case 0x03:
        return amount <= 5000;
      default:
        return true;
    }
  }

  private mapMethod(method: number, offlineCapable: boolean): CVMMethod {
    switch (method) {
      case 0x00:
        return 'NO_CVM';
      case 0x01:
        return offlineCapable ? 'OFFLINE_PIN' : 'FAIL';
      case 0x02:
        return 'ONLINE_PIN';
      case 0x03:
        return 'SIGNATURE';
      case 0x04:
        return 'NO_CVM';
      default:
        return 'FAIL';
    }
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return arr;
  }
}
