export enum PosProtocol {
  POS_101_1 = 'POS_101_1',
  POS_101_6 = 'POS_101_6',
  POS_201_3 = 'POS_201_3',
}

export type PosProtocolVersion = '101.1' | '101.6' | '201.3';

export interface PosProtocolConfig {
  version: PosProtocolVersion;
  minAmountMinor: number;
  maxAmountMinor: number;
  requiresPin: boolean;
  requiresCvv: boolean;
  settlementMode: 'BRIDGE_USDT' | 'DIRECT_LEDGER' | 'EXTERNAL_ACQUIRER';
  mode: 'MANUAL_VOICE' | 'ONLINE_EMV_CHIP' | 'CAPTURE_BATCH_SETTLEMENT';
  dualMessage: boolean;
  requiresCapture: boolean;
  mtiRequest: string;
  mtiResponse: string;
  processingCode: string;
  posEntryModeDefault: string;
  posConditionDefault: string;
  authorizationValidityHours: number;
  reversalWindowSeconds: number;
  contact: boolean;
  contactless: boolean;
  fallbackToMsrAllowed: boolean;
  offlineAuthAllowed: boolean;
  supportedBrands: string[];
  procedureId: string;
  merchantCreditImmediate: boolean;
  customerCreditImmediate: boolean;
  emvField55Required: boolean;
  track2Required: boolean;
  panRequired: boolean;
}

export const pos1011Config: PosProtocolConfig = Object.freeze({
  version: '101.1',
  minAmountMinor: 5_00,
  maxAmountMinor: 500_000_000_00,
  requiresPin: true,
  requiresCvv: false,
  settlementMode: 'EXTERNAL_ACQUIRER',
  mode: 'MANUAL_VOICE',
  dualMessage: true,
  requiresCapture: true,
  mtiRequest: '0100',
  mtiResponse: '0110',
  processingCode: '000000',
  posEntryModeDefault: '011',
  posConditionDefault: '00',
  authorizationValidityHours: 24 * 7,
  reversalWindowSeconds: 180,
  contact: true,
  contactless: false,
  fallbackToMsrAllowed: true,
  offlineAuthAllowed: false,
  supportedBrands: ['VISA', 'MASTERCARD', 'UNIONPAY', 'AMEX', 'DISCOVER', 'JCB', 'DINERS'],
  procedureId: 'PROC-DUAL-AUTH-1011',
  merchantCreditImmediate: false,
  customerCreditImmediate: false,
  emvField55Required: false,
  track2Required: false,
  panRequired: true,
});

export const pos1016Config: PosProtocolConfig = Object.freeze({
  version: '101.6',
  minAmountMinor: 5_00,
  maxAmountMinor: 500_000_000_00,
  requiresPin: true,
  requiresCvv: false,
  settlementMode: 'EXTERNAL_ACQUIRER',
  mode: 'ONLINE_EMV_CHIP',
  dualMessage: true,
  requiresCapture: true,
  mtiRequest: '0100',
  mtiResponse: '0110',
  processingCode: '000000',
  posEntryModeDefault: '052',
  posConditionDefault: '00',
  authorizationValidityHours: 24 * 7,
  reversalWindowSeconds: 300,
  contact: true,
  contactless: true,
  fallbackToMsrAllowed: true,
  offlineAuthAllowed: false,
  supportedBrands: ['VISA', 'MASTERCARD', 'UNIONPAY', 'AMEX', 'DISCOVER', 'JCB', 'DINERS'],
  procedureId: 'PROC-DUAL-AUTH-1016',
  merchantCreditImmediate: false,
  customerCreditImmediate: false,
  emvField55Required: true,
  track2Required: false,
  panRequired: false,
});

export const pos2013Config: PosProtocolConfig = Object.freeze({
  version: '201.3',
  minAmountMinor: 0,
  maxAmountMinor: 1_000_000_000_00,
  requiresPin: false,
  requiresCvv: false,
  settlementMode: 'EXTERNAL_ACQUIRER',
  mode: 'CAPTURE_BATCH_SETTLEMENT',
  dualMessage: true,
  requiresCapture: false,
  mtiRequest: '0200',
  mtiResponse: '0210',
  processingCode: '000000',
  posEntryModeDefault: '012',
  posConditionDefault: '00',
  authorizationValidityHours: 0,
  reversalWindowSeconds: 0,
  contact: true,
  contactless: true,
  fallbackToMsrAllowed: true,
  offlineAuthAllowed: false,
  supportedBrands: ['VISA', 'MASTERCARD', 'UNIONPAY', 'AMEX', 'DISCOVER', 'JCB', 'DINERS'],
  procedureId: 'PROC-DUAL-CAPTURE-2013',
  merchantCreditImmediate: true,
  customerCreditImmediate: true,
  emvField55Required: false,
  track2Required: false,
  panRequired: false,
});

export const PROTOCOL_CONFIG_BY_VERSION: Record<PosProtocolVersion, PosProtocolConfig> = Object.freeze({
  '101.1': pos1011Config,
  '101.6': pos1016Config,
  '201.3': pos2013Config,
});

export function getProtocolConfig(version: PosProtocolVersion | string): PosProtocolConfig {
  const v = String(version || '101.1') as PosProtocolVersion;
  return PROTOCOL_CONFIG_BY_VERSION[v] || PROTOCOL_CONFIG_BY_VERSION['101.1'];
}

export function protocolVersionFromEnum(protocol: PosProtocol): PosProtocolVersion {
  switch (protocol) {
    case PosProtocol.POS_101_1: return '101.1';
    case PosProtocol.POS_101_6: return '101.6';
    case PosProtocol.POS_201_3: return '201.3';
  }
}
