import {
  MTI,
  PROCESSING_CODE_DE3,
  RESPONSE_CODE_DE39,
  POS_ENTRY_MODE_DE22,
  POS_CONDITION_CODE_DE25,
  FUNCTION_CODE_DE70,
  CARD_ACCEPTOR_BIZ_CODE_DE18,
  REASON_CODE_DE33_RC,
  SETTLEMENT_CODE,
  isApprovalResponse,
  isReversalMti,
  dualMessageResponseMti,
  type MtiValue,
  type ProcessingCode,
  type ResponseCode,
  type PosEntryMode,
  type PosConditionCode,
} from '../domain/payments/acquirer/iso8583.constants';
import { P2013, type ProtocolCode } from '../domain/pos2013/protocol-2013-codes';

export type TransactionLifecycleStage =
  | 'INITIATED'
  | 'CARD_PRESENTED'
  | 'EMV_KERNEL_START'
  | 'RISK_PREFLIGHT'
  | 'HOTLIST_CHECK'
  | 'VELOCITY_CHECK'
  | 'FLOOR_LIMIT_CHECK'
  | 'ONLINE_AUTH_REQUESTED'
  | 'ACQUIRER_SENT'
  | 'ACQUIRER_RESPONDED'
  | 'AUTH_APPROVED'
  | 'AUTH_DECLINED'
  | 'AUTH_HOLD_PLACED'
  | 'REVERSAL_ATTEMPTED'
  | 'REVERSAL_COMPLETED'
  | 'CAPTURE_INITIATED'
  | 'CAPTURE_SENT'
  | 'CAPTURE_RESPONDED'
  | 'CAPTURED_SETTLED'
  | 'MERCHANT_CREDITED'
  | 'CUSTOMER_CREDITED'
  | 'BATCH_BUILT'
  | 'BATCH_CLOSED'
  | 'BATCH_UPLOADED'
  | 'BATCH_RECONCILED'
  | 'CLEARING_FILE_GENERATED'
  | 'CLEARING_FILE_SUBMITTED'
  | 'SETTLEMENT_COMPLETED'
  | 'FUNDS_CONFIRMED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'VOIDED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED';

export type ProcessingProcedureId =
  | 'PROC-DUAL-AUTH-1011'
  | 'PROC-DUAL-AUTH-1016'
  | 'PROC-DUAL-CAPTURE-2013'
  | 'PROC-SINGLE-FIN-100'
  | 'PROC-REVERSAL-400'
  | 'PROC-REVERSAL-420'
  | 'PROC-PREAUTH-0030'
  | 'PROC-PREAUTH-COMPLETION'
  | 'PROC-PREAUTH-CANCEL'
  | 'PROC-REFUND-2000'
  | 'PROC-VOID-SALE'
  | 'PROC-VOID-REFUND'
  | 'PROC-BATCH-SETTLE-201'
  | 'PROC-RECON-CLOSE-302'
  | 'PROC-NETWORK-ECHO-800'
  | 'PROC-KEY-EXCHANGE-101'
  | 'PROC-QUICPASS-PURCHASE'
  | 'PROC-QUICPASS-PREAUTH'
  | 'PROC-QUICPASS-REFUND'
  | 'PROC-CLEARING-MSRCUSTOMER-1410'
  | 'PROC-CLEARING-ICCUSTOMER-1430';

export interface ProcessingStep {
  order: number;
  name: string;
  p2013Code?: ProtocolCode;
  required?: boolean;
  timeoutMs?: number;
  iso?: {
    mti?: MtiValue;
    processingCode?: ProcessingCode;
    posEntryMode?: PosEntryMode;
    posConditionCode?: PosConditionCode;
    requiredFields?: number[];
    responseCodeSuccess?: ResponseCode[];
  };
  description: string;
  errorStage?: TransactionLifecycleStage;
}

export interface ProcessingProcedure {
  id: ProcessingProcedureId;
  name: string;
  brandScope: ('VISA' | 'MASTERCARD' | 'UNIONPAY' | 'AMEX' | 'DISCOVER' | 'JCB' | 'DINERS' | 'ALL')[];
  protocol: ('101.1' | '101.6' | '201.3' | '100.0' | 'QPS' | 'CLEARING')[];
  lifecycleStart: TransactionLifecycleStage;
  lifecycleEnd: TransactionLifecycleStage;
  steps: ProcessingStep[];
  dualMessage: boolean;
  requiresCapture?: boolean;
  reversalOnFailure: boolean;
  autoReverseSeconds?: number;
  description: string;
  references: {
    mastercardTRIC?: string[];
    visaADVT?: string[];
    unionpayQPS?: string[];
  };
}

const _STEPS_DUAL_AUTH_1011: ProcessingStep[] = [
  { order: 1, name: 'Initiate Sale', p2013Code: P2013.POS_SALE_STARTED, required: true, description: 'POS Sale initiated, terminal ready for card', iso: { processingCode: PROCESSING_CODE_DE3.SALE_GOODS_SERVICES, posEntryMode: POS_ENTRY_MODE_DE22.MAGSTRIPE_MANUAL_KEYED } },
  { order: 2, name: 'Risk Preflight', p2013Code: P2013.RISK_FLOOR_LIMIT_CHECK_STARTED, required: true, description: 'Validate amount, merchant, terminal status', errorStage: 'RISK_PREFLIGHT' },
  { order: 3, name: 'Hotlist Check', p2013Code: P2013.RISK_HOTLIST_CHECK_STARTED, required: true, description: 'Card hotlist/velocity/fraud check', errorStage: 'HOTLIST_CHECK' },
  { order: 4, name: 'Velocity Check', p2013Code: P2013.RISK_VELOCITY_CHECK_STARTED, required: true, description: 'Velocity thresholds per card/merchant/terminal', errorStage: 'VELOCITY_CHECK' },
  { order: 5, name: 'Floor Limit Check', p2013Code: P2013.RISK_FLOOR_LIMIT_CHECK_STARTED, required: true, description: 'Exceeds floor -> force online', errorStage: 'FLOOR_LIMIT_CHECK' },
  { order: 6, name: 'MTI 0100 Auth Request', required: true, timeoutMs: 30_000, description: 'ISO8583:1993 MTI 0100 Authorization request to acquirer', iso: { mti: MTI.DUAL_AUTH_REQUEST, processingCode: PROCESSING_CODE_DE3.SALE_GOODS_SERVICES, posEntryMode: POS_ENTRY_MODE_DE22.MAGSTRIPE_CUSTOMER_PRESENT, posConditionCode: POS_CONDITION_CODE_DE25.NORMAL, requiredFields: [2, 3, 4, 7, 11, 14, 22, 23, 25, 37, 41, 42, 49], responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED, RESPONSE_CODE_DE39.APPROVED_HONOR, RESPONSE_CODE_DE39.PARTIAL_APPROVAL, RESPONSE_CODE_DE39.APPROVED_VIP] }, errorStage: 'ACQUIRER_SENT' },
  { order: 7, name: 'Validate Acquirer RC', required: true, description: 'Check response code 39 in 0110 response', errorStage: 'ACQUIRER_RESPONDED' },
  { order: 8, name: 'Place Auth Hold', p2013Code: P2013.POS_SALE_APPROVED, required: true, description: 'Debit customer open-to-buy, record issuer auth hold', iso: { responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, errorStage: 'AUTH_HOLD_PLACED' },
  { order: 9, name: 'Store STAN/RRN/ARC', required: true, description: 'Persist STAN (DE11), RRN (DE37), Approval Code (DE38), Auth ID' },
];

const _STEPS_DUAL_AUTH_1016: ProcessingStep[] = [
  { order: 1, name: 'Initiate EMV Sale', p2013Code: P2013.POS_SALE_STARTED, required: true, description: 'POS Sale start, chip or contactless EMV flow' },
  { order: 2, name: 'EMV Kernel Select AID', p2013Code: P2013.NFC_AID_SELECT_STARTED, required: true, description: 'Select application; PPSE for contactless; PSE for contact', errorStage: 'EMV_KERNEL_START' },
  { order: 3, name: 'EMV GPO / Read Records', p2013Code: P2013.NFC_GPO_STARTED, required: true, description: 'Get Processing Options + Read Application Records' },
  { order: 4, name: 'EMV ODA / CVM', p2013Code: P2013.EMV_CONTACT_STARTED, required: true, description: 'Offline Data Authentication + Cardholder Verification Method', errorStage: 'EMV_KERNEL_START' },
  { order: 5, name: 'EMV TVR/TSI Risk', p2013Code: P2013.EMV_CONTACT_STARTED, required: true, description: 'TVR + TAC combine; decision offline/online/decline' },
  { order: 6, name: 'Risk Preflight + Hotlist', required: true, description: 'Floor, hotlist, velocity, duplicate STAN checks' },
  { order: 7, name: 'MTI 0100 EMV Auth Request', required: true, timeoutMs: 45_000, description: '0100 with DE55 (EMV TLV), DE22 chip entry, DE23 card seq', iso: { mti: MTI.DUAL_AUTH_REQUEST, processingCode: PROCESSING_CODE_DE3.SALE_GOODS_SERVICES, posEntryMode: POS_ENTRY_MODE_DE22.CHIP_CONTACT_CUSTOMER_PRESENT, posConditionCode: POS_CONDITION_CODE_DE25.EMV_OFFLINE_APPROVED, requiredFields: [2, 3, 4, 11, 14, 22, 23, 25, 35, 55, 41, 42, 49], responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED, RESPONSE_CODE_DE39.PARTIAL_APPROVAL, RESPONSE_CODE_DE39.OFFLINE_APPROVED] }, errorStage: 'ONLINE_AUTH_REQUESTED' },
  { order: 8, name: 'ARQC/ARPC Verify', p2013Code: P2013.EMV_CONTACT_APPROVED, required: true, description: 'Validate ARQC from chip; generate ARPC + Issuer Auth Tag in DE55', errorStage: 'ACQUIRER_RESPONDED' },
  { order: 9, name: 'Issue 2nd GENERATE AC if TC', required: false, description: 'Terminal script processing + Second Gen AC TC/AAC decision' },
  { order: 10, name: 'Place Auth Hold', p2013Code: P2013.POS_SALE_APPROVED, required: true, description: 'Record auth hold, available balance reduced', errorStage: 'AUTH_HOLD_PLACED' },
];

const _STEPS_CAPTURE_2013: ProcessingStep[] = [
  { order: 1, name: 'Capture Initiated', p2013Code: P2013.BATCH_BUILD_STARTED, required: true, description: 'Initiate capture/settlement for prior auth' },
  { order: 2, name: 'Lookup Auth Reference', required: true, description: 'Verify auth_ref exists, not already captured/reversed/expired', errorStage: 'FAILED' },
  { order: 3, name: 'Auth Expiry Check', required: true, description: 'Authorization expiration window (typically 7 days sale, 30 days preauth)' },
  { order: 4, name: 'MTI 0200 Capture Request', required: true, timeoutMs: 45_000, description: '0200 Financial capture referencing original 0100 auth via DE38/DE61', iso: { mti: MTI.DUAL_FINANCIAL_REQUEST, processingCode: PROCESSING_CODE_DE3.SALE_GOODS_SERVICES, posEntryMode: POS_ENTRY_MODE_DE22.MAGSTRIPE_CUSTOMER_PRESENT, posConditionCode: POS_CONDITION_CODE_DE25.NORMAL, requiredFields: [3, 4, 11, 37, 38, 41, 42, 49], responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED, RESPONSE_CODE_DE39.APPROVED_HONOR] }, errorStage: 'CAPTURE_SENT' },
  { order: 5, name: 'Validate 0210 Response', required: true, description: 'Check RC 00; retrieve retrieval ref and trace id' },
  { order: 6, name: 'Mark Auth Captured', p2013Code: P2013.BATCH_UPLOAD_SUCCESS, required: true, description: 'Update card_authorizations -> CAPTURED', errorStage: 'CAPTURE_RESPONDED' },
  { order: 7, name: 'Atomic Credit Wallet', required: true, description: 'DB TX: insert card_settlements + credit merchant/customer wallet' },
  { order: 8, name: 'Append to Open Batch', p2013Code: P2013.BATCH_BUILD_SUCCESS, required: true, description: 'Add to batch_transactions + running totals' },
];

const _STEPS_REVERSAL_FULL: ProcessingStep[] = [
  { order: 1, name: 'Reversal Initiated', required: true, description: 'Trigger: timeout, user cancel, card removed, post-auth failure' },
  { order: 2, name: 'DE33 Reason Code Map', required: true, description: 'Map local reason to ISO DE33 Reversal Reason Code' },
  { order: 3, name: 'MTI 0400 Full Reversal', required: true, timeoutMs: 45_000, description: '0400 Reversal Advice (Full). Repeat 0420 after NAK / no response.', iso: { mti: MTI.REVERSAL_FULL_ADVICE, processingCode: PROCESSING_CODE_DE3.VOID_SALE, posConditionCode: POS_CONDITION_CODE_DE25.REVERSAL_CUSTOMER_NOT_PRESENT, requiredFields: [3, 4, 11, 33, 37, 38, 41, 42, 49], responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED, RESPONSE_CODE_DE39.MASTERCARD_ADVICE_ACK] }, errorStage: 'REVERSAL_ATTEMPTED' },
  { order: 4, name: '0410 Advice ACK Check', required: true, description: 'Issuer/switch ACK; SAF queue if no ACK' },
  { order: 5, name: 'Release Auth Hold', required: true, description: 'DB: remove issuer_auth_holds + restore open-to-buy' },
];

const _STEPS_PREAUTH: ProcessingStep[] = [
  { order: 1, name: 'Preauth Initiated', p2013Code: P2013.POS_PREAUTH_STARTED, required: true, description: 'Hotel/Auto-Rental preauth, amount may be estimated', iso: { processingCode: PROCESSING_CODE_DE3.PRE_AUTHORIZATION } },
  { order: 2, name: '0100 Preauth Request', required: true, timeoutMs: 45_000, description: 'Processing code 003000 / F03 starts from 20', iso: { mti: MTI.DUAL_AUTH_REQUEST, processingCode: PROCESSING_CODE_DE3.PRE_AUTHORIZATION, posConditionCode: POS_CONDITION_CODE_DE25.PRE_AUTHORIZATION, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, errorStage: 'ONLINE_AUTH_REQUESTED' },
  { order: 3, name: 'Hold Extended Window', p2013Code: P2013.POS_PREAUTH_APPROVED, required: true, description: '30 day hold window for preauth vs 7 day sale' },
];

const _STEPS_PREAUTH_COMPLETION: ProcessingStep[] = [
  { order: 1, name: 'Preauth Completion Init', required: true, description: 'Finalize confirmed amount post-service rendered', iso: { processingCode: PROCESSING_CODE_DE3.PRE_AUTH_COMPLETION } },
  { order: 2, name: '0220 Completion Advice', required: true, timeoutMs: 45_000, description: '0220/0200 Completion referencing original preauth', iso: { mti: MTI.DUAL_FINANCIAL_ADVICE, processingCode: PROCESSING_CODE_DE3.PRE_AUTH_COMPLETION, posConditionCode: POS_CONDITION_CODE_DE25.PRE_AUTH_COMPLETION, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, errorStage: 'CAPTURE_SENT' },
  { order: 3, name: 'Wallet Credit + Close', required: true, description: 'Atomic settlement' },
];

const _STEPS_REFUND: ProcessingStep[] = [
  { order: 1, name: 'Refund Initiated', required: true, description: 'Merchant-initiated credit back to cardholder', iso: { processingCode: PROCESSING_CODE_DE3.MERCHANT_CREDIT_REFUND } },
  { order: 2, name: 'MTI 0200 Refund', required: true, timeoutMs: 45_000, description: 'Processing code 20xxxx; opposite financial direction', iso: { mti: MTI.DUAL_FINANCIAL_REQUEST, processingCode: PROCESSING_CODE_DE3.MERCHANT_CREDIT_REFUND, posConditionCode: POS_CONDITION_CODE_DE25.VOID_RETURN, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, errorStage: 'CAPTURE_SENT' },
  { order: 3, name: 'Debit Merchant Wallet', required: true, description: 'Reverse prior merchant credit' },
];

const _STEPS_BATCH_SETTLE_201: ProcessingStep[] = [
  { order: 1, name: 'Batch Build Initiated', p2013Code: P2013.BATCH_BUILD_STARTED, required: true, description: 'Close open batch, aggregate net totals by card type' },
  { order: 2, name: 'Batch Close', p2013Code: P2013.BATCH_CLOSE_STARTED, required: true, description: 'Freeze batch, compute gross debit/credit count + amounts, batch hash' },
  { order: 3, name: 'DE70 Function Code 201 Upload', required: true, timeoutMs: 120_000, description: '0500/0600 Network Mgmt DE70=201 Batch Settlement Upload', iso: { mti: MTI.NETWORK_MANAGEMENT_REQUEST, posConditionCode: POS_CONDITION_CODE_DE25.END_OF_DAY, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, errorStage: 'BATCH_UPLOADED' },
  { order: 4, name: 'Batch Reconcile', p2013Code: P2013.BATCH_RECONCILE_STARTED, required: true, description: 'Host response totals vs local totals. Count + amount, net difference = 0' },
  { order: 5, name: '0500 DE70=302 Recon Close', required: true, description: 'Daily reconciliation close mark batch settled', iso: { mti: MTI.RECONCILIATION_REQUEST, posConditionCode: POS_CONDITION_CODE_DE25.END_OF_DAY } },
];

const _STEPS_QUICPASS_PURCHASE: ProcessingStep[] = [
  { order: 1, name: 'QPS Card Tap', required: true, description: 'UnionPay QuickPass: AID A000000333010105/06/07' },
  { order: 2, name: 'PPSE / AID Select', required: true, description: 'PPSE 2PAY.SYS.DDF01 contactless directory' },
  { order: 3, name: 'GPO + Read', required: true, description: 'AFL read + DE55 populate' },
  { order: 4, name: 'QPS Limit Branch', required: true, description: '<= QPS limit + < CVM limit: offline ODA TC; > QPS limit: online ARQC; >= CVM: CDCVM or PIN' },
  { order: 5, name: 'Offline ODA TC -> Store Forward', p2013Code: P2013.EMV_OFFLINE_APPROVAL_SUCCESS, required: false, description: 'HK/MO offline only; SAF upload 0220 next online' },
  { order: 6, name: 'Online ARQC MTI 0100', required: true, description: '0100 with DE55 QuickPass; DE22 = 075 contactless QPS entry', iso: { mti: MTI.DUAL_AUTH_REQUEST, posEntryMode: POS_ENTRY_MODE_DE22.CHIP_CONTACTLESS_QUICPASS, posConditionCode: POS_CONDITION_CODE_DE25.CONTACTLESS_QPS } },
  { order: 7, name: 'ARPC / TC Finalize', required: true, description: 'Post-online Generate AC 2nd' },
];

const _STEPS_CLEARING_1410: ProcessingStep[] = [
  { order: 1, name: 'Open Clearing Window', required: true, description: 'Mastercard Dual Message Clearing MTI 1410 (Customer generated MSR)' },
  { order: 2, name: 'Build 1280-byte Records', required: true, description: 'Fixed-format debit detail records per transaction' },
  { order: 3, name: 'Header + Trailer TOTALS', required: true, description: 'File header (01) + detail (10-50) + trailer (90)' },
  { order: 4, name: 'Sign / MAC File', required: true, description: 'Trailer batch hash + record count check' },
  { order: 5, name: 'Submit to Scheme', required: true, description: 'Upload via SFTP / MQ / Connect:Direct' },
];

export const PROCESSING_PROCEDURES: Record<ProcessingProcedureId, ProcessingProcedure> = Object.freeze({
  'PROC-DUAL-AUTH-1011': {
    id: 'PROC-DUAL-AUTH-1011',
    name: 'Dual Message Authorization (Voice/Manual 101.1)',
    brandScope: ['ALL'],
    protocol: ['101.1'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'AUTH_HOLD_PLACED',
    steps: _STEPS_DUAL_AUTH_1011,
    dualMessage: true,
    requiresCapture: true,
    reversalOnFailure: true,
    autoReverseSeconds: 180,
    description: 'Manual keyed / voice auth 101.1 - Dual message 0100/0110, later captured via 0200/201.3',
    references: { mastercardTRIC: ['0400001', '0400002', '0400003'], visaADVT: ['TC01'] },
  },
  'PROC-DUAL-AUTH-1016': {
    id: 'PROC-DUAL-AUTH-1016',
    name: 'Dual Message Online EMV Chip Auth 101.6',
    brandScope: ['ALL'],
    protocol: ['101.6'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'AUTH_HOLD_PLACED',
    steps: _STEPS_DUAL_AUTH_1016,
    dualMessage: true,
    requiresCapture: true,
    reversalOnFailure: true,
    autoReverseSeconds: 300,
    description: 'Online EMV chip (contact) 101.6 - ARQC/ARPC exchange + DE55 TLV, captured later',
    references: { mastercardTRIC: ['0450001', '0450002'], visaADVT: ['TC01', 'TC30', 'TC34'] },
  },
  'PROC-DUAL-CAPTURE-2013': {
    id: 'PROC-DUAL-CAPTURE-2013',
    name: 'Dual Message Capture / Settlement 201.3',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'CAPTURE_INITIATED',
    lifecycleEnd: 'BATCH_BUILT',
    steps: _STEPS_CAPTURE_2013,
    dualMessage: true,
    reversalOnFailure: false,
    description: '201.3 Capture batch / financial presentment of previously authorized transactions',
    references: { mastercardTRIC: ['1410001', '1410002', '1420001'], visaADVT: ['TCxx'] },
  },
  'PROC-SINGLE-FIN-100': {
    id: 'PROC-SINGLE-FIN-100',
    name: 'Single Message Financial (MTI 0200 combined auth+presentment)',
    brandScope: ['MASTERCARD', 'VISA'],
    protocol: ['100.0'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'MERCHANT_CREDITED',
    steps: _STEPS_DUAL_AUTH_1016.map(s => ({
      ...s,
      iso: s.iso ? {
        ...s.iso,
        mti: s.iso.mti && /0100|0110/.test(s.iso.mti) ? MTI.SINGLE_FINANCIAL_REQUEST : s.iso.mti
      } : undefined
    })),
    dualMessage: false,
    reversalOnFailure: true,
    autoReverseSeconds: 300,
    description: 'Single-message: auth+financial capture in one 0200, immediate settlement to merchant',
    references: { mastercardTRIC: ['3000001', '3000002', '3000003'] },
  },
  'PROC-REVERSAL-400': {
    id: 'PROC-REVERSAL-400',
    name: 'Full Reversal Advice MTI 0400',
    brandScope: ['ALL'],
    protocol: ['101.1', '101.6', '201.3'],
    lifecycleStart: 'REVERSAL_ATTEMPTED',
    lifecycleEnd: 'REVERSAL_COMPLETED',
    steps: _STEPS_REVERSAL_FULL,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'MTI 0400 full reversal advice of a prior 0100 auth or 0200 capture. SAF retry until 0410 ACK.',
    references: { mastercardTRIC: ['0400001-R', '3000001-R'] },
  },
  'PROC-REVERSAL-420': {
    id: 'PROC-REVERSAL-420',
    name: 'Partial Reversal Advice MTI 0420',
    brandScope: ['ALL'],
    protocol: ['101.1', '101.6', '201.3'],
    lifecycleStart: 'REVERSAL_ATTEMPTED',
    lifecycleEnd: 'REVERSAL_COMPLETED',
    steps: _STEPS_REVERSAL_FULL.map(s => s.iso?.mti === MTI.REVERSAL_FULL_ADVICE ? { ...s, iso: { ...s.iso, mti: MTI.REVERSAL_PARTIAL_ADVICE } } : s),
    dualMessage: true,
    reversalOnFailure: false,
    description: 'MTI 0420 partial amount reversal (e.g., cashback reduced, post-auth partial)',
    references: { mastercardTRIC: ['0400001-PR'] },
  },
  'PROC-PREAUTH-0030': {
    id: 'PROC-PREAUTH-0030',
    name: 'Pre-Authorization 003000 (0100)',
    brandScope: ['ALL'],
    protocol: ['101.1', '101.6', 'QPS'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'AUTH_HOLD_PLACED',
    steps: _STEPS_PREAUTH,
    dualMessage: true,
    requiresCapture: true,
    reversalOnFailure: true,
    autoReverseSeconds: 60,
    description: 'Preauthorization hold (hotels, auto rental). Extended auth validity window.',
    references: { unionpayQPS: ['AIS_QPS_PPA'], visaADVT: ['TC16'] },
  },
  'PROC-PREAUTH-COMPLETION': {
    id: 'PROC-PREAUTH-COMPLETION',
    name: 'Pre-Authorization Completion (0220 Advice / 0200)',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'CAPTURE_INITIATED',
    lifecycleEnd: 'MERCHANT_CREDITED',
    steps: _STEPS_PREAUTH_COMPLETION,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'Finalize preauthorization with actual confirmed amount',
    references: { unionpayQPS: ['AIS_QPS_ACR', 'AIS_QPS_ACRA'] },
  },
  'PROC-PREAUTH-CANCEL': {
    id: 'PROC-PREAUTH-CANCEL',
    name: 'Pre-Authorization Cancellation',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'REVERSAL_ATTEMPTED',
    lifecycleEnd: 'REVERSAL_COMPLETED',
    steps: _STEPS_REVERSAL_FULL,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'Cancel preauth 003090 processing code; QPS AIS_QPS_PNP',
    references: { unionpayQPS: ['AIS_QPS_PNP'] },
  },
  'PROC-REFUND-2000': {
    id: 'PROC-REFUND-2000',
    name: 'Merchant Credit / Refund (DE3 20xxxx)',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'CAPTURED_SETTLED',
    steps: _STEPS_REFUND,
    dualMessage: true,
    reversalOnFailure: true,
    description: 'Credit cardholder, debit merchant. Processing Code 200000. QPS AIS_QPS_CTH.',
    references: { unionpayQPS: ['AIS_QPS_CTH'], mastercardTRIC: ['0400002-REF'] },
  },
  'PROC-VOID-SALE': {
    id: 'PROC-VOID-SALE',
    name: 'Void Prior Sale / Same-Day Reversal',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'REVERSAL_ATTEMPTED',
    lifecycleEnd: 'VOIDED',
    steps: _STEPS_REVERSAL_FULL.map(s => ({ ...s, iso: { ...s.iso, processingCode: PROCESSING_CODE_DE3.VOID_SALE, posConditionCode: POS_CONDITION_CODE_DE25.VOID_SALE } })),
    dualMessage: true,
    reversalOnFailure: false,
    description: 'Same-day void before batch close. After batch close use REFUND/2000.',
    references: { mastercardTRIC: ['0400002-V'] },
  },
  'PROC-VOID-REFUND': {
    id: 'PROC-VOID-REFUND',
    name: 'Void Prior Refund',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'REVERSAL_ATTEMPTED',
    lifecycleEnd: 'VOIDED',
    steps: _STEPS_REVERSAL_FULL.map(s => ({ ...s, iso: { ...s.iso, processingCode: PROCESSING_CODE_DE3.VOID_REFUND, posConditionCode: POS_CONDITION_CODE_DE25.VOID_RETURN } })),
    dualMessage: true,
    reversalOnFailure: false,
    description: 'Same-day void of a refund credit.',
    references: { mastercardTRIC: ['0400002-VR'] },
  },
  'PROC-BATCH-SETTLE-201': {
    id: 'PROC-BATCH-SETTLE-201',
    name: 'Network Batch Settlement Upload DE70=201',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'BATCH_BUILT',
    lifecycleEnd: 'BATCH_RECONCILED',
    steps: _STEPS_BATCH_SETTLE_201,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'End-of-day batch settlement. DE70 Function code 201 batch upload; 202 batch end.',
    references: { mastercardTRIC: ['1410004'] },
  },
  'PROC-RECON-CLOSE-302': {
    id: 'PROC-RECON-CLOSE-302',
    name: 'Daily Reconciliation Close DE70=302',
    brandScope: ['ALL'],
    protocol: ['201.3'],
    lifecycleStart: 'BATCH_CLOSED',
    lifecycleEnd: 'SETTLEMENT_COMPLETED',
    steps: _STEPS_BATCH_SETTLE_201.slice(2, 6),
    dualMessage: true,
    reversalOnFailure: false,
    description: 'DE70=302 reconciliation close; 303 reopen, 301 inquiry',
    references: {},
  },
  'PROC-NETWORK-ECHO-800': {
    id: 'PROC-NETWORK-ECHO-800',
    name: 'Network Management Echo Test DE70=301',
    brandScope: ['ALL'],
    protocol: ['QPS', '101.1', '101.6', '201.3'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'COMPLETED',
    steps: [
      { order: 1, name: '0800 Echo Test', required: true, timeoutMs: 10_000, iso: { mti: MTI.NETWORK_MANAGEMENT_REQUEST, posConditionCode: POS_CONDITION_CODE_DE25.LOGON, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, description: 'DE70=301 Echo / Comm test; 001 logon; 002 logoff' },
    ],
    dualMessage: false,
    reversalOnFailure: false,
    description: 'ISO8583 0800 Network Mgmt (logon, echo, key change, cutover, param download)',
    references: { unionpayQPS: ['AIS_QPS_ECHO'] },
  },
  'PROC-KEY-EXCHANGE-101': {
    id: 'PROC-KEY-EXCHANGE-101',
    name: 'Key Change / Download DE70=101',
    brandScope: ['ALL'],
    protocol: ['101.1', '101.6', '201.3'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'COMPLETED',
    steps: [
      { order: 1, name: '0800 Key Change', required: true, timeoutMs: 15_000, iso: { mti: MTI.NETWORK_MANAGEMENT_REQUEST, responseCodeSuccess: [RESPONSE_CODE_DE39.APPROVED] }, description: 'DE70=101 Master/Session key exchange; 503 CA public keys; 504 CLR' },
    ],
    dualMessage: false,
    reversalOnFailure: false,
    description: 'Key exchange / AID / CAPK download procedures',
    references: {},
  },
  'PROC-QUICPASS-PURCHASE': {
    id: 'PROC-QUICPASS-PURCHASE',
    name: 'UnionPay QuickPass Purchase Online / Offline ODA',
    brandScope: ['UNIONPAY'],
    protocol: ['QPS'],
    lifecycleStart: 'CARD_PRESENTED',
    lifecycleEnd: 'MERCHANT_CREDITED',
    steps: _STEPS_QUICPASS_PURCHASE,
    dualMessage: false,
    reversalOnFailure: true,
    description: 'UnionPay QuickPass: 3-tier limit decision (QPS, CVM, Online). AIS_QPS_PUR.',
    references: { unionpayQPS: ['AIS_QPS_PUR', 'AIS_QPS_SET', 'AIS_QPS_AUC'] },
  },
  'PROC-QUICPASS-PREAUTH': {
    id: 'PROC-QUICPASS-PREAUTH',
    name: 'UnionPay QuickPass Pre-Authorization',
    brandScope: ['UNIONPAY'],
    protocol: ['QPS'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'AUTH_HOLD_PLACED',
    steps: _STEPS_PREAUTH,
    dualMessage: true,
    requiresCapture: true,
    reversalOnFailure: true,
    description: 'QPS preauth PPA + completion ACR + cancel PNP',
    references: { unionpayQPS: ['AIS_QPS_PPA', 'AIS_QPS_ACR', 'AIS_QPS_PCR', 'AIS_QPS_PNP'] },
  },
  'PROC-QUICPASS-REFUND': {
    id: 'PROC-QUICPASS-REFUND',
    name: 'UnionPay QuickPass Refund & Settlement',
    brandScope: ['UNIONPAY'],
    protocol: ['QPS'],
    lifecycleStart: 'INITIATED',
    lifecycleEnd: 'CAPTURED_SETTLED',
    steps: _STEPS_REFUND,
    dualMessage: true,
    reversalOnFailure: true,
    description: 'QPS AIS_QPS_CTH refund + AIS_QPS_SET settlement',
    references: { unionpayQPS: ['AIS_QPS_CTH', 'AIS_QPS_SET', 'AID_QPS_SET'] },
  },
  'PROC-CLEARING-MSRCUSTOMER-1410': {
    id: 'PROC-CLEARING-MSRCUSTOMER-1410',
    name: 'Mastercard Dual Message Clearing - Customer MSR MTI 1410',
    brandScope: ['MASTERCARD'],
    protocol: ['CLEARING'],
    lifecycleStart: 'CLEARING_FILE_GENERATED',
    lifecycleEnd: 'CLEARING_FILE_SUBMITTED',
    steps: _STEPS_CLEARING_1410,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'MTI 1410 Customer-generated file; 1420 Mastercard-generated; 1430 ICC; 1440 ICC Scheme',
    references: { mastercardTRIC: ['1410001', '1410002', '1410003', '1420001', '1430001', '1440001'] },
  },
  'PROC-CLEARING-ICCUSTOMER-1430': {
    id: 'PROC-CLEARING-ICCUSTOMER-1430',
    name: 'Mastercard Dual ICC Customer Clearing MTI 1430',
    brandScope: ['MASTERCARD'],
    protocol: ['CLEARING'],
    lifecycleStart: 'CLEARING_FILE_GENERATED',
    lifecycleEnd: 'CLEARING_FILE_SUBMITTED',
    steps: _STEPS_CLEARING_1410,
    dualMessage: true,
    reversalOnFailure: false,
    description: 'ICC (chip) customer clearing file 1430 / scheme 1440',
    references: { mastercardTRIC: ['1430001', '1430002', '1440001'] },
  },
});

export function getProcedure(id: ProcessingProcedureId): ProcessingProcedure {
  return PROCESSING_PROCEDURES[id];
}

export function listProceduresForProtocol(protocol: '101.1' | '101.6' | '201.3' | '100.0' | 'QPS' | 'CLEARING'): ProcessingProcedure[] {
  return Object.values(PROCESSING_PROCEDURES).filter(p => p.protocol.includes(protocol));
}

export function validateProcedureStep(proc: ProcessingProcedure, stepIndex: number, stage: TransactionLifecycleStage): boolean {
  const step = proc.steps[stepIndex];
  if (!step) return false;
  if (!step.required) return true;
  return stage === proc.steps[stepIndex].errorStage || stage === proc.lifecycleEnd;
}

export {
  MTI,
  PROCESSING_CODE_DE3 as PROCESSING_CODES,
  RESPONSE_CODE_DE39 as RESPONSE_CODES,
  POS_ENTRY_MODE_DE22 as POS_ENTRY_MODES,
  POS_CONDITION_CODE_DE25 as POS_CONDITION_CODES,
  FUNCTION_CODE_DE70 as FUNCTION_CODES,
  REASON_CODE_DE33_RC as REASON_CODES,
  CARD_ACCEPTOR_BIZ_CODE_DE18 as MCC_CODES,
  SETTLEMENT_CODE as SETTLEMENT_CODES,
  isApprovalResponse,
  isReversalMti,
  dualMessageResponseMti,
};
