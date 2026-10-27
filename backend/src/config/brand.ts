export const POS_BRAND_NAME = process.env.POS_BRAND_NAME?.trim() || 'PRIME';
export const VAULT_DISPLAY_NAME = process.env.VAULT_DISPLAY_NAME?.trim() || 'ICICI';
export const POS_PROTOCOL_VERSION = '201.3';

export function transactionChannel(authMode?: string, batchId?: string): 'ONLINE' | 'OFFLINE' {
  const mode = String(authMode || '').toUpperCase();
  return mode.includes('OFFLINE') || String(batchId || '').toUpperCase().startsWith('OFFLINE-')
    ? 'OFFLINE'
    : 'ONLINE';
}

export type BrandScheme = 'VISA' | 'MASTERCARD' | 'UNIONPAY' | 'AMEX' | 'DISCOVER' | 'JCB' | 'DINERS';
export type ProductType = 'DEBIT' | 'CREDIT' | 'PREPAID' | 'QUASI_CREDIT' | 'COMMERCIAL';
export type CvmType = 'PLAINTEXT_PIN' | 'ENCRYPTED_PIN' | 'SIGNATURE' | 'CDCVM' | 'NO_CVM' | 'PIN_SIGNATURE' | 'ONLINE_PIN';

export interface BrandAid {
  aid: string;
  label: string;
  scheme: BrandScheme;
  product: ProductType;
  contactless: boolean;
  priority?: number;
  qps?: boolean;
  oda?: boolean;
  vlp?: boolean;
}

export interface BrandParameters {
  scheme: BrandScheme;
  displayName: string;
  aids: BrandAid[];
  applicationCurrencyCode: string;
  applicationCurrencyExponent: number;
  countryCode: string;
  merchantCategoryCode: string;
  defaultCvmList: CvmType[];
  cvmLimitContactless: number;
  qpsLimitContactless: number;
  contactlessFloorLimit: number;
  contactFloorLimit: number;
  defaultTacProfile: string;
  requireCvvOnContact: boolean;
  requirePinOnContact: boolean;
  fallbackToMsrAllowed: boolean;
  tokenSupport: boolean;
  cvn: number;
  issuerCodeIndex: number;
  atcAcquirerCheck: boolean;
}

const VISA_AIDS: BrandAid[] = [
  { aid: 'A0000000031010', label: 'VISA CREDIT', scheme: 'VISA', product: 'CREDIT', contactless: false, priority: 1 },
  { aid: 'A0000000032010', label: 'VISA DEBIT', scheme: 'VISA', product: 'DEBIT', contactless: false, priority: 2 },
  { aid: 'A0000000032020', label: 'VISA ELECTRON', scheme: 'VISA', product: 'DEBIT', contactless: false, priority: 3 },
  { aid: 'A0000000032030', label: 'VISA V-PAY', scheme: 'VISA', product: 'DEBIT', contactless: false, priority: 4 },
  { aid: 'A0000000038010', label: 'VISA PAYWAVE MSD', scheme: 'VISA', product: 'CREDIT', contactless: true, priority: 5 },
  { aid: 'A0000000039010', label: 'VISA PAYWAVE VSDC CVN10', scheme: 'VISA', product: 'CREDIT', contactless: true, qps: false, vlp: true, priority: 6 },
  { aid: 'A0000000039020', label: 'VISA PAYWAVE VSDC CVN17', scheme: 'VISA', product: 'DEBIT', contactless: true, qps: false, vlp: true, priority: 7 },
];

const MASTERCARD_AIDS: BrandAid[] = [
  { aid: 'A0000000041010', label: 'MASTERCARD CREDIT', scheme: 'MASTERCARD', product: 'CREDIT', contactless: false, priority: 1 },
  { aid: 'A0000000042010', label: 'MASTERCARD DEBIT', scheme: 'MASTERCARD', product: 'DEBIT', contactless: false, priority: 2 },
  { aid: 'A0000000043010', label: 'MAESTRO', scheme: 'MASTERCARD', product: 'DEBIT', contactless: false, priority: 3 },
  { aid: 'A0000000044010', label: 'MASTERCARD PREPAID', scheme: 'MASTERCARD', product: 'PREPAID', contactless: false, priority: 4 },
  { aid: 'A0000000046000', label: 'MASTERCARD PAYPASS MSD', scheme: 'MASTERCARD', product: 'CREDIT', contactless: true, priority: 5 },
  { aid: 'A0000000047000', label: 'MASTERCARD PAYPASS M/CHIP', scheme: 'MASTERCARD', product: 'CREDIT', contactless: true, priority: 6 },
  { aid: 'A0000000048000', label: 'MASTERCARD MOBILE PAYPASS', scheme: 'MASTERCARD', product: 'CREDIT', contactless: true, priority: 7 },
  { aid: 'A0000000049000', label: 'MASTERCARD UCAF', scheme: 'MASTERCARD', product: 'CREDIT', contactless: false, priority: 8 },
];

const UNIONPAY_AIDS: BrandAid[] = [
  { aid: 'A000000333010101', label: 'UNIONPAY CREDIT', scheme: 'UNIONPAY', product: 'CREDIT', contactless: false, priority: 1 },
  { aid: 'A000000333010102', label: 'UNIONPAY DEBIT', scheme: 'UNIONPAY', product: 'DEBIT', contactless: false, priority: 2 },
  { aid: 'A000000333010103', label: 'UNIONPAY PREPAID', scheme: 'UNIONPAY', product: 'PREPAID', contactless: false, priority: 3 },
  { aid: 'A000000333010104', label: 'UNIONPAY QUASI-CREDIT', scheme: 'UNIONPAY', product: 'QUASI_CREDIT', contactless: false, priority: 4 },
  { aid: 'A000000333010105', label: 'UNIONPAY QUICPASS', scheme: 'UNIONPAY', product: 'DEBIT', contactless: true, qps: true, oda: true, priority: 5 },
  { aid: 'A000000333010106', label: 'UNIONPAY QUICPASS CREDIT', scheme: 'UNIONPAY', product: 'CREDIT', contactless: true, qps: true, oda: true, priority: 6 },
  { aid: 'A000000333010107', label: 'UNIONPAY QUICPASS QCREDIT', scheme: 'UNIONPAY', product: 'QUASI_CREDIT', contactless: true, qps: true, oda: true, priority: 7 },
  { aid: 'A000000333010201', label: 'UNIONPAY ELECTRONIC CASH', scheme: 'UNIONPAY', product: 'PREPAID', contactless: true, priority: 8 },
];

const AMEX_AIDS: BrandAid[] = [
  { aid: 'A00000002501', label: 'AMERICAN EXPRESS', scheme: 'AMEX', product: 'CREDIT', contactless: false, priority: 1 },
  { aid: 'A0000000250101', label: 'AMEX EXPRESSPAY', scheme: 'AMEX', product: 'CREDIT', contactless: true, priority: 2 },
];

export const BRAND_AIDS: BrandAid[] = [
  ...VISA_AIDS,
  ...MASTERCARD_AIDS,
  ...UNIONPAY_AIDS,
  ...AMEX_AIDS,
];

export const PPSE_FCI = Object.freeze({
  directoryEntryTemplate: '61',
  applicationDedicatedFileName: '4F',
  applicationLabel: '50',
  priorityIndicator: '87',
  sfi: '88',
});

export function findAidByHex(aidHex: string): BrandAid | undefined {
  const search = String(aidHex || '').replace(/\s/g, '').toUpperCase();
  return BRAND_AIDS.find(a =>
    a.aid.toUpperCase() === search || search.startsWith(a.aid.toUpperCase())
  );
}

export function listContactAids(): BrandAid[] {
  return BRAND_AIDS.filter(a => !a.contactless).sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

export function listContactlessAids(): BrandAid[] {
  return BRAND_AIDS.filter(a => a.contactless).sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

export const BRAND_PARAMETERS: Record<BrandScheme, BrandParameters> = Object.freeze({
  VISA: {
    scheme: 'VISA',
    displayName: 'Visa',
    aids: VISA_AIDS,
    applicationCurrencyCode: '0840',
    applicationCurrencyExponent: 2,
    countryCode: '0840',
    merchantCategoryCode: '5311',
    defaultCvmList: ['ENCRYPTED_PIN', 'SIGNATURE', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'VISA',
    requireCvvOnContact: false,
    requirePinOnContact: true,
    fallbackToMsrAllowed: true,
    tokenSupport: true,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  MASTERCARD: {
    scheme: 'MASTERCARD',
    displayName: 'Mastercard',
    aids: MASTERCARD_AIDS,
    applicationCurrencyCode: '0840',
    applicationCurrencyExponent: 2,
    countryCode: '0840',
    merchantCategoryCode: '5311',
    defaultCvmList: ['ENCRYPTED_PIN', 'SIGNATURE', 'CDCVM', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'MASTERCARD',
    requireCvvOnContact: false,
    requirePinOnContact: true,
    fallbackToMsrAllowed: true,
    tokenSupport: true,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  UNIONPAY: {
    scheme: 'UNIONPAY',
    displayName: 'UnionPay',
    aids: UNIONPAY_AIDS,
    applicationCurrencyCode: '0156',
    applicationCurrencyExponent: 2,
    countryCode: '0156',
    merchantCategoryCode: '5311',
    defaultCvmList: ['PLAINTEXT_PIN', 'ENCRYPTED_PIN', 'SIGNATURE', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 300_00,
    contactlessFloorLimit: 300_00,
    contactFloorLimit: 10_000_00,
    defaultTacProfile: 'UNIONPAY',
    requireCvvOnContact: false,
    requirePinOnContact: true,
    fallbackToMsrAllowed: true,
    tokenSupport: false,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  AMEX: {
    scheme: 'AMEX',
    displayName: 'American Express',
    aids: AMEX_AIDS,
    applicationCurrencyCode: '0840',
    applicationCurrencyExponent: 2,
    countryCode: '0840',
    merchantCategoryCode: '5311',
    defaultCvmList: ['SIGNATURE', 'ENCRYPTED_PIN', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'DEFAULT',
    requireCvvOnContact: true,
    requirePinOnContact: false,
    fallbackToMsrAllowed: true,
    tokenSupport: false,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  DISCOVER: {
    scheme: 'DISCOVER',
    displayName: 'Discover',
    aids: [],
    applicationCurrencyCode: '0840',
    applicationCurrencyExponent: 2,
    countryCode: '0840',
    merchantCategoryCode: '5311',
    defaultCvmList: ['ENCRYPTED_PIN', 'SIGNATURE', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'DEFAULT',
    requireCvvOnContact: true,
    requirePinOnContact: false,
    fallbackToMsrAllowed: true,
    tokenSupport: false,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  JCB: {
    scheme: 'JCB',
    displayName: 'JCB',
    aids: [],
    applicationCurrencyCode: '0392',
    applicationCurrencyExponent: 0,
    countryCode: '0392',
    merchantCategoryCode: '5311',
    defaultCvmList: ['ENCRYPTED_PIN', 'SIGNATURE', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'DEFAULT',
    requireCvvOnContact: true,
    requirePinOnContact: false,
    fallbackToMsrAllowed: true,
    tokenSupport: false,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
  DINERS: {
    scheme: 'DINERS',
    displayName: 'Diners Club',
    aids: [],
    applicationCurrencyCode: '0840',
    applicationCurrencyExponent: 2,
    countryCode: '0840',
    merchantCategoryCode: '5311',
    defaultCvmList: ['SIGNATURE', 'ENCRYPTED_PIN', 'NO_CVM'],
    cvmLimitContactless: 9999_00,
    qpsLimitContactless: 200_00,
    contactlessFloorLimit: 200_00,
    contactFloorLimit: 5_000_00,
    defaultTacProfile: 'DEFAULT',
    requireCvvOnContact: true,
    requirePinOnContact: false,
    fallbackToMsrAllowed: true,
    tokenSupport: false,
    cvn: 10,
    issuerCodeIndex: 0,
    atcAcquirerCheck: true,
  },
});

export function getBrandParams(scheme: BrandScheme | string): BrandParameters {
  const s = String(scheme || '').toUpperCase() as BrandScheme;
  return BRAND_PARAMETERS[s] || BRAND_PARAMETERS.VISA;
}
