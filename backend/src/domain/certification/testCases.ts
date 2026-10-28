export type TestFramework = 'MASTERCARD_TRIC' | 'VISA_ADVT' | 'UNIONPAY_QPS' | 'PRIMESTACK_SMOKE';
export type TestDomain = 'MSR' | 'ICC' | 'CONTACTLESS' | 'CNP' | 'ECOMMERCE' | 'REVERSAL' | 'ADVICE' | 'RECON' | 'CLEARING' | 'PRODUCT_SERVICES';
export type TestResult = 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED' | 'NA';

export interface CertificationTestCase {
  id: string;
  framework: TestFramework;
  domain: TestDomain;
  title: string;
  objective: string;
  cardId?: string;
  protocol?: '101.1' | '101.6' | '201.3' | 'QPS';
  mti?: string;
  processingCode?: string;
  expectedRc?: string;
  posEntryMode?: string;
  merchantCategory?: string;
  amountMinor?: number;
  currency?: string;
  preconditions: string[];
  steps: { order: number; action: string; isoFields?: Record<string, string> }[];
  expectedResults: string[];
  requiredFields?: number[];
  responseFields?: number[];
  references?: {
    tricTable?: string;
    advtTest?: string;
    qpsTest?: string;
  };
  brandScope?: ('VISA' | 'MASTERCARD' | 'UNIONPAY' | 'AMEX' | 'DISCOVER' | 'JCB' | 'DINERS')[];
  risk?: 'NORMAL' | 'HIGH' | 'MANDATORY';
  internalProcedure?: string;
}

const _step = (order: number, action: string, isoFields?: Record<string, string>) => ({ order, action, isoFields });

const rawTestCases: CertificationTestCase[] = [
  {
    id: 'MC-0400001-01',
    framework: 'MASTERCARD_TRIC',
    domain: 'MSR',
    title: 'ATM MSR Base Authorization Request + Reversal',
    objective: 'Validate 0100/0110 base authorization for ATM MSR + 0400 full reversal',
    cardId: 'MC-TRIC01',
    protocol: '101.1',
    mti: '0100',
    processingCode: '010000',
    expectedRc: '00',
    posEntryMode: '014',
    merchantCategory: '6011',
    amountMinor: 100_00,
    currency: 'USD',
    risk: 'MANDATORY',
    brandScope: ['MASTERCARD'],
    internalProcedure: 'PROC-DUAL-AUTH-1011',
    references: { tricTable: '0400001' },
    preconditions: [
      'Issuer account is active and funded',
      'Terminal ID configured for ATM class',
      'Acquirer link online and echo test (0800/DE70=301) successful',
    ],
    steps: [
      _step(1, 'Swipe MSR test card MC-TRIC01 on ATM terminal', { DE3: '010000', DE22: '014' }),
      _step(2, 'Encrypt PIN online using session working key', { DE52: '<PINBLOCK_ANSI98>' }),
      _step(3, 'Send 0100 Authorization Request', {
        DE2: '5100000000000007', DE3: '010000', DE4: '000000010000',
        DE7: '<MMDDhhmmss>', DE11: '<STAN>', DE12: '<hhmmss>', DE13: '<MMDD>',
        DE14: '2512', DE18: '6011', DE22: '014', DE25: '04', DE35: '5100000000000007=2512101...',
        DE41: 'ATM00001', DE42: 'MC0000000000001', DE43: 'MASTERCARD TEST ATM      NEW YORK       US',
        DE49: '840', DE52: '<PIN_BLOCK>', DE61: '10100000000000000000',
      }),
      _step(4, 'Receive 0110 Response RC=00', { DE38: '<APPROVAL_CODE>', DE39: '00' }),
      _step(5, 'Within 180s timeout trigger 0400 Full Reversal', {
        MTI: '0400', DE33: '1003', DE37: '<RRN_FROM_0110>',
      }),
      _step(6, 'Receive 0410 ACK RC=10', {}),
    ],
    expectedResults: [
      '0110 RC DE39 = 00',
      'DE37 RRN populated on response',
      'DE38 Approval Code 6 alphanumeric',
      'DE54 Amounts Additional if currency mismatch',
      'Auth hold placed on issuer_accounts available',
      '0410 Reversal ACK RC=00 or 10',
      'Available balance restored after 0410',
    ],
    requiredFields: [2, 3, 4, 7, 11, 12, 13, 14, 18, 22, 25, 35, 41, 42, 43, 49],
  },

  {
    id: 'MC-0400002-01',
    framework: 'MASTERCARD_TRIC',
    domain: 'MSR',
    title: 'POS CP MSR Authorization + Advice',
    objective: 'POS Cardholder Present MSR (DE22=012) + 0120 Advice if no response',
    cardId: 'MC-TRIC01',
    protocol: '101.1',
    mti: '0100',
    processingCode: '000000',
    expectedRc: '00',
    posEntryMode: '012',
    merchantCategory: '5311',
    amountMinor: 100_00,
    currency: 'USD',
    risk: 'MANDATORY',
    brandScope: ['MASTERCARD'],
    internalProcedure: 'PROC-DUAL-AUTH-1011',
    references: { tricTable: '0400002' },
    preconditions: ['Terminal configured for CP retail'],
    steps: [
      _step(1, 'Swipe card, manual signature CVM'),
      _step(2, 'Send 0100 DE22=012 / DE25=00'),
      _step(3, '0110 RC=00 received'),
      _step(4, 'If no response within timeout send 0120 Advice'),
    ],
    expectedResults: [
      '0110 RC=00 with DE38 approval code',
      '0130 Advice RC=10 acknowledged',
    ],
  },

  {
    id: 'MC-0400003-01',
    framework: 'MASTERCARD_TRIC',
    domain: 'CNP',
    title: 'POS CNP Authorization (Mail/Telephone/Ecommerce)',
    objective: 'Validate 0100 Card-Not-Present with AVS/CVC2',
    cardId: 'MC-TRIC01',
    protocol: '101.1',
    mti: '0100',
    processingCode: '000000',
    expectedRc: '00',
    posEntryMode: '019',
    merchantCategory: '5311',
    risk: 'HIGH',
    brandScope: ['MASTERCARD'],
    references: { tricTable: '0400003' },
    preconditions: ['Terminal merchant supports CNP'],
    steps: [
      _step(1, 'Keyed entry PAN + Expiry + AVS + CVC2', {}),
      _step(2, 'Send 0100 DE22=019 / ecommerce flag set', { DE60: '00000000300', DE62: '<AVS+CVV2>' }),
    ],
    expectedResults: ['0110 RC=00 approved; AVS result DE60; CVC2 result DE61'],
  },

  {
    id: 'VISA-TC01-EMV',
    framework: 'VISA_ADVT',
    domain: 'ICC',
    title: 'VSDC Contact Chip Online Approved Transaction',
    objective: 'Validate full VSDC contact chip EMV transaction resulting in online approval with TC',
    cardId: 'VSDC-QPC01',
    protocol: '101.6',
    mti: '0100',
    processingCode: '000000',
    expectedRc: '00',
    posEntryMode: '052',
    merchantCategory: '5311',
    amountMinor: 500_00,
    currency: 'USD',
    risk: 'MANDATORY',
    brandScope: ['VISA'],
    internalProcedure: 'PROC-DUAL-AUTH-1016',
    references: { advtTest: 'TC01' },
    preconditions: [
      'Terminal loaded with Visa CA public key index 07/0B/0E',
      'TAC VISA VSDC denial/online/default configured',
      'TVR initially zeroed',
    ],
    steps: [
      _step(1, 'Insert VSDC-QPC01 card into contact reader'),
      _step(2, 'PSE/Application Select A0000000031010 via SELECT'),
      _step(3, 'Get Processing Options (GPO) using CDOL1 data'),
      _step(4, 'READ RECORD per AFL entries, populate DE55 ICC TLV'),
      _step(5, 'ODA DDA/SDA/CDA validate Signed Static/Applic Dynamic Data'),
      _step(6, 'CVM: Enciphered PIN online (if supported)'),
      _step(7, 'Terminal Action Analysis: TAC+TVR -> GO ONLINE ARQC'),
      _step(8, 'Send 0100 to acquirer with DE55 containing ARQC'),
      _step(9, 'Receive 0110 RC=00 with Issuer Auth Data Tag 91 + ARPC'),
      _step(10, '2nd GENERATE AC with Issuer Auth data -> Transaction Certificate TC'),
    ],
    expectedResults: [
      'ARQC validated by issuer cryptogram',
      'DE39 RC=00 on 0110',
      'Tag 91 ARPC Issuer Auth Data in DE55 response',
      'Second Gen AC returns TC (not AAC)',
      'TVR DDA Fail bit NOT set',
      'Approval Code DE38 returned and printed on receipt',
    ],
    requiredFields: [2, 3, 4, 11, 14, 22, 23, 25, 35, 41, 42, 49, 55],
  },

  {
    id: 'VISA-TC30-ARQC',
    framework: 'VISA_ADVT',
    domain: 'ICC',
    title: 'Online Card Authentication Cryptogram Validation',
    objective: 'Issuer/switch validates ARQC from online chip request (TC03 wording)',
    cardId: 'VSDC-QPC01',
    protocol: '101.6',
    risk: 'MANDATORY',
    brandScope: ['VISA'],
    references: { advtTest: 'TC30' },
    preconditions: ['UDK/MDK loaded for card PAN in HSM'],
    steps: [
      _step(1, 'Extract DE55 ARQC Tag 9F26 from 0100 request'),
      _step(2, 'HSM Validate ARQC against DE4 amount, DE49 currency, UN (9F36), ATC (9F36)'),
    ],
    expectedResults: [
      'ARQC check returns VALID',
      'If invalid, return 0110 RC=Z1 or decline',
    ],
  },

  {
    id: 'VISA-TC34-FALLBACK',
    framework: 'VISA_ADVT',
    domain: 'ICC',
    title: 'MSR Fallback From Chip Decline (not allowed unless criteria met)',
    objective: 'Terminals NOT fall back to MSR for chip cards unless chip failure criteria',
    cardId: 'VSDC-QPC02',
    protocol: '101.1',
    risk: 'MANDATORY',
    brandScope: ['VISA'],
    references: { advtTest: 'TC34' },
    preconditions: ['Terminal with chip capability enabled'],
    steps: [
      _step(1, 'Present chip card to MSR slot only'),
      _step(2, 'Terminal prompts INSERT CHIP not swipe (correct)'),
      _step(3, 'Only after 3 failed chip reads allow fallback DE22=057'),
    ],
    expectedResults: [
      'Forced chip prompt before swipe fallback allowed',
      'If fallback, DE22=057 chip fallback MSR entry mode',
      'Fallback indicator DE55 tag present on 0100 message',
    ],
  },

  {
    id: 'UPI-AIS-QPS-PUR-01',
    framework: 'UNIONPAY_QPS',
    domain: 'CONTACTLESS',
    title: 'QPS Online Below QPS Limit + Above CVM',
    objective: 'QuickPass Purchase > CVM limit < QPS limit: go online ARQC',
    cardId: 'QPS-QPC1',
    protocol: 'QPS',
    expectedRc: '00',
    posEntryMode: '075',
    merchantCategory: '5311',
    risk: 'MANDATORY',
    brandScope: ['UNIONPAY'],
    internalProcedure: 'PROC-QUICPASS-PURCHASE',
    references: { qpsTest: 'AIS_QPS_PUR' },
    preconditions: [
      'Terminal PPSE 2PAY.SYS.DDF01 directory configured',
      'AID A000000333010105 in kernel list',
      'Reader CVM Required Limit = 300.00 USD / RMB equivalent',
      'QPS Contactless Floor Limit = 300.00',
    ],
    steps: [
      _step(1, 'Tap QPC1 card. Terminal does PPSE SELECT then AID SELECT'),
      _step(2, 'AID=A000000333010105 QuickPass (Debit)', {}),
      _step(3, 'Amount 500.00 (above CVM, below QPS floor). Require PIN/CDCVM'),
      _step(4, 'CVM performed: Enciphered PIN online'),
      _step(5, 'Go online, DE22=075 + DE55 QPS with ARQC Tag 9F26'),
      _step(6, '0110 RC=00 with ARPC Tag 91, 2nd Generate AC = TC'),
    ],
    expectedResults: [
      'ARQC generated not offline TC',
      '0110 RC=00 approved',
      'Issuer authentication tag 91 present in 0110 DE55',
      'Final TC generated after online approval',
    ],
    requiredFields: [2, 3, 4, 11, 14, 22, 23, 25, 41, 42, 49, 55],
  },

  {
    id: 'UPI-AIS-QPS-ODA-01',
    framework: 'UNIONPAY_QPS',
    domain: 'CONTACTLESS',
    title: 'QPS ODA Offline Approved (HK/MO region only)',
    objective: 'QuickPass Offline Data Authentication pass + within QPS limit -> offline TC',
    cardId: 'QPS-QPC19',
    protocol: 'QPS',
    expectedRc: 'Y3',
    risk: 'NORMAL',
    brandScope: ['UNIONPAY'],
    internalProcedure: 'PROC-QUICPASS-PURCHASE',
    references: { qpsTest: 'AIS_FQPS_SET' },
    preconditions: ['Terminal HK/MO regional flag for offline QPS enabled'],
    steps: [
      _step(1, 'Tap QPC19 amount 200.00 < QPS 300'),
      _step(2, 'ODA CDA/DDA valid, TVR ODA FAIL clear'),
      _step(3, 'Offline TAC combined -> approve offline TC'),
      _step(4, 'Store transaction in SAF store-and-forward queue'),
      _step(5, 'Next online window upload 0220 Financial Advice batch'),
    ],
    expectedResults: [
      'Offline approved no host round trip',
      'SAF entry created with TC cryptogram',
      '0220 batch upload accepted RC=00',
    ],
  },

  {
    id: 'UPI-AIS-QPS-PPA-01',
    framework: 'UNIONPAY_QPS',
    domain: 'CONTACTLESS',
    title: 'QuickPass Pre-Authorization + Completion',
    objective: 'QPS Pre-auth 003000 + Completion 004000 + Cancel 003090',
    cardId: 'QPS-QPC1',
    protocol: 'QPS',
    risk: 'HIGH',
    brandScope: ['UNIONPAY'],
    internalProcedure: 'PROC-PREAUTH-0030',
    references: { qpsTest: 'AIS_QPS_PPA AIS_QPS_ACR AIS_QPS_PNP' },
    preconditions: ['Merchant supports preauth (MCC hotels 7011 / auto 75XX)'],
    steps: [
      _step(1, 'Preauth 0100 DE3=003000 amount 500.00', {}),
      _step(2, '0110 RC=00 approved, hold 30 day window'),
      _step(3, 'Completion 0200 DE3=004000 amount 485.00 referencing preauth DE38'),
      _step(4, 'Or: Cancel preauth 0400 DE3=003090 / AIS_QPS_PNP cancel workflow'),
    ],
    expectedResults: ['Preauth hold placed, completion clears; cancel releases'],
  },

  {
    id: 'UPI-AIS-QPS-BIN81-01',
    framework: 'UNIONPAY_QPS',
    domain: 'CONTACTLESS',
    title: 'UnionPay 81 BIN Test Cards QuickPass Acceptance',
    objective: 'Accept new UPI 81 BIN cards across all AID/Product combos',
    cardId: 'QPS-QPC20',
    protocol: 'QPS',
    risk: 'MANDATORY',
    brandScope: ['UNIONPAY'],
    references: { qpsTest: 'AIS_QPS_BIN81' },
    preconditions: ['Kernel 81 BIN AID routing table latest'],
    steps: [
      _step(1, 'QPC20 (81 BIN debit)', {}),
      _step(2, 'QPC21 (81 BIN credit)', {}),
      _step(3, 'QPC22 (81 BIN quasi-credit)', {}),
    ],
    expectedResults: ['All 81 BIN cards route correctly; no unknown AID declines'],
  },

  {
    id: 'VISA-0800-ECHO-301',
    framework: 'PRIMESTACK_SMOKE',
    domain: 'RECON',
    title: 'Network Management Echo Test',
    objective: '0800 DE70=301 echo, DE11 STAN echo-back, RC=00',
    protocol: '101.1',
    mti: '0800',
    expectedRc: '00',
    risk: 'MANDATORY',
    brandScope: ['VISA', 'MASTERCARD', 'UNIONPAY', 'AMEX', 'DISCOVER', 'JCB', 'DINERS'],
    internalProcedure: 'PROC-NETWORK-ECHO-800',
    preconditions: ['Link established'],
    steps: [_step(1, '0800 DE70=301')],
    expectedResults: ['0810 RC=00, DE11 echoed'],
  },

  {
    id: 'MC-3000001-SINGLE-FIN',
    framework: 'MASTERCARD_TRIC',
    domain: 'MSR',
    title: 'Single Message 0200 Financial Combined Auth+Presentment ATM',
    objective: 'Single-message (0200/0210) immediate settlement vs dual 0100+0200',
    cardId: 'MC-TRIC02',
    mti: '0200',
    processingCode: '010000',
    expectedRc: '00',
    posEntryMode: '014',
    risk: 'NORMAL',
    brandScope: ['MASTERCARD'],
    internalProcedure: 'PROC-SINGLE-FIN-100',
    references: { tricTable: '3000001' },
    preconditions: ['Single message merchant class configured'],
    steps: [
      _step(1, 'ATM 0200 with full financial fields'),
      _step(2, '0210 RC=00, DE38 approval code + immediate balance impact'),
    ],
    expectedResults: [
      'DE39 RC=00 on 0210',
      'Settlement posted immediately no separate 201.3',
      'Wallet credit atomic within 0210 processing',
    ],
  },

  {
    id: 'MC-1410001-CLEAR',
    framework: 'MASTERCARD_TRIC',
    domain: 'CLEARING',
    title: 'Customer MSR Dual Message Clearing File MTI 1410',
    objective: 'Customer-generated clearing file; 1280 byte records; header+detail+trailer',
    protocol: '201.3',
    risk: 'NORMAL',
    brandScope: ['MASTERCARD'],
    internalProcedure: 'PROC-CLEARING-MSRCUSTOMER-1410',
    references: { tricTable: '1410001 1410002 1410003' },
    preconditions: ['Batch closed, all captures reconciled'],
    steps: [
      _step(1, 'Open file with Record 01 File Header (1280b)'),
      _step(2, 'Record 10/20/30/40 per transaction type in 1410 format'),
      _step(3, 'Record 90 File Trailer: count + debit/credit hash totals'),
      _step(4, 'Sign / MAC; submit via SFTP/Connect:Direct/MQ'),
    ],
    expectedResults: [
      'All captured 201.3 transactions present in 1410 file',
      'Hash totals match batch totals exactly',
    ],
  },
];

export const CERTIFICATION_TEST_CASES: readonly CertificationTestCase[] = Object.freeze(rawTestCases);

export function listTestCaseIdsByFramework(framework: TestFramework): string[] {
  return CERTIFICATION_TEST_CASES.filter(t => t.framework === framework).map(t => t.id);
}

export function getTestCase(id: string): CertificationTestCase | undefined {
  return CERTIFICATION_TEST_CASES.find(t => t.id === id);
}

export function listMandatory(): CertificationTestCase[] {
  return CERTIFICATION_TEST_CASES.filter(t => t.risk === 'MANDATORY') as CertificationTestCase[];
}

export {
  PROCESSING_PROCEDURES,
  getProcedure,
  listProceduresForProtocol,
} from '../../pos/processingProcedures';
