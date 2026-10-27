export interface PosEmvProfile {
  transactionType: 'PURCHASE' | 'CASH' | 'REFUND' | 'PREAUTH' | 'COMPLETION' | 'BALANCE';
  onlineOnly: boolean;
  pinRequired: boolean;
  cvvRequired: boolean;
  floorLimitMinor: number;
  thresholdBiasedMinor: number;
  randomTargetPct: number;
  randomMaxPct: number;
  randomFloorMinor: number;
  defaultTvcContact: string;
  defaultTvcContactless: string;
  tacDenial: string;
  tacOnline: string;
  tacDefault: string;
  contactlessCvmLimitMinor: number;
  contactlessQpsLimitMinor: number;
  contactlessVlpLimitMinor: number;
  readerCvmRequiredLimitMinor: number;
  fallbackAllowed: boolean;
  offlineApprovalAllowed: boolean;
  odaAllowed: boolean;
  qpsAllowed: boolean;
  requireTcAfterApproval: boolean;
  require2ndGenAc: boolean;
  cdol1Required: boolean;
  cdol2Required: boolean;
  ddolRequired: boolean;
  terminalCountryCode: string;
  terminalCurrencyCode: string;
  terminalCurrencyExponent: number;
  terminalType: 'ATTENDED' | 'UNATTENDED' | 'ATM' | 'ECOMMERCE' | 'MOTO';
  terminalCapabilities: string;
  additionalTerminalCapabilities: string;
  terminalRiskManagementData: string;
  merchantName: string;
  merchantCategoryCode: string;
  terminalIdentification: string;
  cardAcceptorIdentificationCode: string;
  cardAcceptorNameLocation: string;
  interfaceDeviceSerial: string;
  supportCdcvm: boolean;
  supportSignature: boolean;
  supportEncipheredPin: boolean;
  supportPlaintextPin: boolean;
  supportNoCvm: boolean;
  supportContactMsd: boolean;
  supportContactVsdc: boolean;
  supportContactlessMsd: boolean;
  supportContactlessQvsdc: boolean;
  supportContactlessMchip: boolean;
  supportContactlessQuickpass: boolean;
  languagePreference: string;
  merchantCustomData: string;
  referenceCurrencyConversion: boolean;
  dynamicCurrencyConversion: boolean;
}

const _h = (v: string, pad = 16) => String(v || '0').padStart(pad, '0').toUpperCase();
const _h6 = (v: string) => _h(v, 12);

export const pos1011EmvProfile = Object.freeze<PosEmvProfile>({
  transactionType: 'PURCHASE',
  onlineOnly: process.env.EMV_ONLINE_ONLY !== 'false',
  pinRequired: true,
  cvvRequired: false,
  floorLimitMinor: Number(process.env.EMV_FLOOR_LIMIT_MINOR) || 50_000,
  thresholdBiasedMinor: Number(process.env.EMV_FLOOR_LIMIT_MINOR) * 2 || 100_000,
  randomTargetPct: 0,
  randomMaxPct: 0,
  randomFloorMinor: 0,
  defaultTvcContact: _h6('000000000000'),
  defaultTvcContactless: _h6('000000000000'),
  tacDenial: _h6('0010E0F8A000'),
  tacOnline: _h6('0010E8F8A000'),
  tacDefault: _h6('001068000000'),
  contactlessCvmLimitMinor: Number(process.env.EMV_CONTACTLESS_CVM_LIMIT_MINOR) || 30_000,
  contactlessQpsLimitMinor: Number(process.env.EMV_QPS_LIMIT_MINOR) || 10_000,
  contactlessVlpLimitMinor: 2000_00,
  readerCvmRequiredLimitMinor: 500_00,
  fallbackAllowed: true,
  offlineApprovalAllowed: process.env.EMV_OFFLINE_APPROVAL_ALLOWED === 'true',
  odaAllowed: true,
  qpsAllowed: true,
  requireTcAfterApproval: true,
  require2ndGenAc: true,
  cdol1Required: true,
  cdol2Required: true,
  ddolRequired: true,
  terminalCountryCode: process.env.EMV_TERMINAL_COUNTRY_CODE?.trim() || '0784',
  terminalCurrencyCode: process.env.EMV_TERMINAL_CURRENCY_CODE?.trim() || '0784',
  terminalCurrencyExponent: Number(process.env.EMV_TERMINAL_CURRENCY_EXPONENT) || 2,
  terminalType: 'ATTENDED',
  terminalCapabilities: 'E0F8C8',
  additionalTerminalCapabilities: '7C00A0C001',
  terminalRiskManagementData: '000000000000',
  merchantName: process.env.POS_BRAND_NAME?.trim() || 'PRIMESTACK POS',
  merchantCategoryCode: '5311',
  terminalIdentification: process.env.TERMINAL_ID?.trim() || 'PRIM0001',
  cardAcceptorIdentificationCode: process.env.MERCHANT_ID?.trim() || 'PRIMEMERCH01',
  cardAcceptorNameLocation: (process.env.POS_BRAND_NAME?.trim() || 'PRIMESTACK') + '       DUBAI           AE',
  interfaceDeviceSerial: process.env.IFD_SERIAL?.trim() || 'IFD-000000000001',
  supportCdcvm: true,
  supportSignature: true,
  supportEncipheredPin: true,
  supportPlaintextPin: false,
  supportNoCvm: true,
  supportContactMsd: true,
  supportContactVsdc: true,
  supportContactlessMsd: true,
  supportContactlessQvsdc: true,
  supportContactlessMchip: true,
  supportContactlessQuickpass: true,
  languagePreference: 'en',
  merchantCustomData: '',
  referenceCurrencyConversion: true,
  dynamicCurrencyConversion: false,
});

export const pos1016EmvProfile: PosEmvProfile = Object.freeze({
  ...pos1011EmvProfile,
  transactionType: 'PURCHASE',
  onlineOnly: true,
  pinRequired: true,
  cvvRequired: false,
  requireTcAfterApproval: true,
  require2ndGenAc: true,
});

export const pos2013EmvProfile: PosEmvProfile = Object.freeze({
  ...pos1011EmvProfile,
  transactionType: 'PURCHASE',
  onlineOnly: true,
  pinRequired: false,
  cvvRequired: false,
  requireTcAfterApproval: false,
  require2ndGenAc: false,
});

export const qpsQuickPassEmvProfile: PosEmvProfile = Object.freeze({
  ...pos1011EmvProfile,
  transactionType: 'PURCHASE',
  terminalCountryCode: '0156',
  terminalCurrencyCode: '0156',
  tacDenial: _h6('000000000000'),
  tacOnline: _h6('000000000000'),
  tacDefault: _h6('000000000000'),
  floorLimitMinor: 10_000_00,
  contactlessCvmLimitMinor: 9999_00,
  contactlessQpsLimitMinor: 300_00,
  readerCvmRequiredLimitMinor: 300_00,
  offlineApprovalAllowed: true,
  odaAllowed: true,
  qpsAllowed: true,
  supportContactlessQuickpass: true,
});

export function getEmvProfileForProtocol(protocol: '101.1' | '101.6' | '201.3' | 'QPS' | string): PosEmvProfile {
  switch (String(protocol).toUpperCase()) {
    case '101.1': return pos1011EmvProfile;
    case '101.6': return pos1016EmvProfile;
    case '201.3': return pos2013EmvProfile;
    case 'QPS':
    case 'QUICPASS':
    case 'UNIONPAY':
      return qpsQuickPassEmvProfile;
    default: return pos1011EmvProfile;
  }
}
