// EMV Offline Transaction Engine
// Complete device-side EMV processing for offline transactions

export { TLVParser } from './tlv-parser';
export type { EMVTag } from './tlv-parser';
export { ApplicationSelector, ApplicationTemplate } from './application-selector';
export { OfflineDataAuthentication, AuthenticationResult, CAPK } from './offline-data-authentication';
export { TerminalRiskManagement, TerminalRiskResult, TerminalLimits } from './terminal-risk-management';
export { CardRiskManagement, CardRiskResult, CardLimits } from './card-risk-management';
export { CVMProcessor, CVMResult, CVMRule } from './cvm-processor';
export { ActionCodeProcessor, ActionCodeResult } from './action-code-processor';
export { CryptogramGenerator, CryptogramResult, CryptogramInput } from './cryptogram-generator';
export { OfflineTransactionStorage, EMVTransaction, OfflineStorageConfig } from './offline-storage';
export { EMVOfflineTransactionEngine, EMVTransactionInput, EMVTransactionResult } from './emv-engine';

// Main EMV Engine instance for easy import
import { EMVOfflineTransactionEngine } from './emv-engine';

// Create a default instance with sample CAPKs
const defaultCAPKs = [
  {
    rid: 'A000000004',
    index: '01',
    modulus: '00' + 'A'.repeat(128),
    exponent: '010001',
    hashAlgorithm: 'SHA-1',
    algorithm: 'RSA',
    expiryDate: '2030-12-31'
  },
  {
    rid: 'A000000003',
    index: '01',
    modulus: '00' + 'B'.repeat(128),
    exponent: '010001',
    hashAlgorithm: 'SHA-1',
    algorithm: 'RSA',
    expiryDate: '2030-12-31'
  }
];

export const emvEngine = new EMVOfflineTransactionEngine(defaultCAPKs);
export default emvEngine;