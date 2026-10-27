import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface ApplicationTemplate {
  aid: string;
  priority: number;
  kernelId: string;
  version: string;
  name: string;
  applicationLabel: string;
  applicationPreferredName: string;
}

export class ApplicationSelector {
  private static readonly KERNEL_AIDS = {
    'A0000000031010': 'Visa',
    'A0000000041010': 'Mastercard',
    'A0000000043060': 'Maestro',
    'A0000000046000': 'Cirrus',
    'A0000000651010': 'JCB',
    'A0000002771010': 'Interac',
    'A0000005241010': 'Amex',
    'A00000002501': 'Amex',
    'A000000025010801': 'Amex'
  };

  static selectApplication(cardData: string, terminalAIDs: string[]): ApplicationTemplate | null {
    const tags = TLVParser.parseTLV(cardData);
    
    // Look for FCI (File Control Information) template
    const fciTemplate = TLVParser.getTagValue(tags, '6F');
    if (!fciTemplate) {
      throw new Error('No FCI template found');
    }

    const fciTags = TLVParser.parseTLV(fciTemplate);
    
    // Look for application list
    const applicationList = TLVParser.getTagValue(fciTags, '70');
    if (!applicationList) {
      throw new Error('No application list found');
    }

    const appListTags = TLVParser.parseTLV(applicationList);
    const applications = this.parseApplications(appListTags);

    // Filter by terminal supported AIDs
    const supportedApps = applications.filter(app => 
      terminalAIDs.some(termAID => app.aid.startsWith(termAID))
    );

    if (supportedApps.length === 0) {
      throw new Error('No supported applications found');
    }

    // Sort by priority (lower number = higher priority)
    supportedApps.sort((a, b) => a.priority - b.priority);

    return supportedApps[0];
  }

  private static parseApplications(tags: EMVTag[]): ApplicationTemplate[] {
    const applications: ApplicationTemplate[] = [];

    for (const tag of tags) {
      if (tag.tag === '61') { // Application template
        const appTags = TLVParser.parseTLV(tag.value);
        const app = this.parseApplicationTemplate(appTags);
        if (app) {
          applications.push(app);
        }
      }
    }

    return applications;
  }

  private static parseApplicationTemplate(tags: EMVTag[]): ApplicationTemplate | null {
    const aid = TLVParser.getTagValue(tags, '4F');
    if (!aid) return null;

    const priorityHex = TLVParser.getTagValue(tags, '87');
    const priority = priorityHex ? parseInt(priorityHex, 16) : 999;

    const kernelId = TLVParser.getTagValue(tags, '9F2A') || '';
    const version = TLVParser.getTagValue(tags, '9F08') || '0000';
    const name = TLVParser.getTagValue(tags, '50') || '';
    const applicationLabel = TLVParser.getTagValue(tags, '9F12') || '';
    const applicationPreferredName = TLVParser.getTagValue(tags, '9F11') || '';

    return {
      aid: aid.toUpperCase(),
      priority,
      kernelId,
      version,
      name: this.hexToAscii(name),
      applicationLabel: this.hexToAscii(applicationLabel),
      applicationPreferredName: this.hexToAscii(applicationPreferredName)
    };
  }

  static getKernelType(aid: string): string {
    for (const [kernelAID, kernelName] of Object.entries(this.KERNEL_AIDS)) {
      if (aid.startsWith(kernelAID)) {
        return kernelName;
      }
    }
    return 'Unknown';
  }

  static isSupportedKernel(aid: string): boolean {
    return Object.keys(this.KERNEL_AIDS).some(kernelAID => aid.startsWith(kernelAID));
  }

  private static hexToAscii(hex: string): string {
    if (!hex || hex.length % 2 !== 0) return '';
    
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const charCode = parseInt(hex.substr(i, 2), 16);
      if (charCode >= 32 && charCode <= 126) {
        result += String.fromCharCode(charCode);
      }
    }
    return result;
  }

  static getApplicationDataFromCard(cardData: string, selectedAID: string): {
    pdol: string | null;
    afl: string | null;
    issuerCodeTable: string | null;
    applicationName: string | null;
  } {
    const tags = TLVParser.parseTLV(cardData);
    
    // Look for application data
    const appData = TLVParser.getTagValue(tags, '70');
    if (!appData) {
      throw new Error('No application data found');
    }

    const appTags = TLVParser.parseTLV(appData);

    return {
      pdol: TLVParser.getTagValue(appTags, '9F38'),
      afl: TLVParser.getTagValue(appTags, '94'),
      issuerCodeTable: TLVParser.getTagValue(appTags, '9F11'),
      applicationName: TLVParser.getTagValue(appTags, '50')
    };
  }
}