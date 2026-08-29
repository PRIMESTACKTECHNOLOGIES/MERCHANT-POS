/**
 * Protocol 201.3 — 6‑Digit Code System
 * Structure: AA BB CC  (1 000 000 unique operations)
 *   AA = System Family   (01–99)
 *   BB = Module          (01–99, per family)
 *   CC = Action / Status (01–99)
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. SYSTEM FAMILIES  (AA)
// ────────────────────────────────────────────────────────────────────────────
export enum SystemFamily {
  POS_KERNEL             = 10,
  EMV_ENGINE             = 11,
  NFC_CONTACTLESS        = 12,
  WALLET_ENGINE          = 13,
  LEDGER_ENGINE          = 14,
  SETTLEMENT_ENGINE      = 15,
  PAYOUT_ENGINE          = 16,
  RECONCILIATION_ENGINE  = 17,
  GATEWAY_INTEGRATIONS   = 18,
  RISK_FRAUD             = 19,
  MERCHANT_MANAGEMENT    = 20,
  USER_MANAGEMENT        = 21,
  DEVICE_MANAGEMENT      = 22,
}

// ────────────────────────────────────────────────────────────────────────────
// 2. MODULES  (BB)   — keyed per SystemFamily
// ────────────────────────────────────────────────────────────────────────────
export enum PosKernelModule {          // 10
  SALE       = 1,
  REFUND     = 2,
  VOID       = 3,
  PRE_AUTH   = 4,
  COMPLETION = 5,
}
export enum EmvEngineModule {           // 11
  EMV_CONTACT        = 1,
  EMV_CONTACTLESS    = 2,
  OFFLINE_APPROVALS  = 3,
  SCRIPT_PROCESSING  = 4,
}
export enum NfcModule {                 // 12
  PPSE_SELECT = 1,
  AID_SELECT  = 2,
  GPO         = 3,
  READ_RECORD = 4,
}
export enum WalletEngineModule {        // 13
  DEBIT    = 1,
  CREDIT   = 2,
  FREEZE   = 3,
  UNFREEZE = 4,
  ADJUST   = 5,
}
export enum LedgerEngineModule {        // 14
  ENTRY_CREATE = 1,
  ENTRY_POST   = 2,
  RECONCILE    = 3,
  CLOSE_BOOK   = 4,
}
export enum SettlementEngineModule {    // 15
  BATCH_BUILD     = 1,
  BATCH_CLOSE     = 2,
  BATCH_UPLOAD    = 3,
  BATCH_RECONCILE = 4,
}
export enum PayoutEngineModule {        // 16
  WISE_BANK      = 1,
  BANK_WIRE      = 2,
  CRYPTO_ONCHAIN = 3,
  CARD_PAYOUT    = 4,
}
export enum ReconciliationEngineModule {// 17
  DUPLICATE_DETECT = 1,
  DISCREPANCY_FIX  = 2,
  REVERSAL         = 3,
  ADJUSTMENT       = 4,
}
export enum GatewayIntegrationsModule { // 18
  PROCESSOR_LOOKUP  = 1,
  PROCESSOR_CAPTURE = 2,
  TRANSAK_CRYPTO    = 3,
  BINANCE_CRYPTO    = 4,
}
export enum RiskFraudModule {           // 19
  FLOOR_LIMIT        = 1,
  HOTLIST_CHECK      = 2,
  VELOCITY_CHECK     = 3,
  OFFLINE_RISK       = 4,
  FORCE_ONLINE_CHECK = 5,
}
export enum MerchantManagementModule {  // 20
  ONBOARD       = 1,
  SETTINGS_SYNC = 2,
  BANK_ACCOUNT  = 3,
  BUSINESS_INFO = 4,
}
export enum UserManagementModule {      // 21
  LOGIN     = 1,
  LOGOUT    = 2,
  PROVISION = 3,
  REVOKE    = 4,
}
export enum DeviceManagementModule {    // 22
  REGISTER     = 1,
  PAIR         = 2,
  HEARTBEAT    = 3,
  DECOMMISSION = 4,
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ACTIONS / STATUSES  (CC)
// ────────────────────────────────────────────────────────────────────────────
export enum ActionCode {
  STARTED         = 1,
  SUCCESS         = 2,
  FAILED          = 3,
  REVERSED        = 4,
  PENDING         = 5,
  TIMEOUT         = 6,
  DECLINED        = 7,
  APPROVED        = 8,
  SYNC_REQUIRED   = 9,
  SYNC_COMPLETED  = 10,
  CREDITED        = 11,
}

// ────────────────────────────────────────────────────────────────────────────
// 4. CANONICAL PROTOCOL CODES — AA BB CC
//    Format: `${AA.toString().padStart(2,'0')}${BB.toString().padStart(2,'0')}${CC.toString().padStart(2,'0')}`
// ────────────────────────────────────────────────────────────────────────────
export type ProtocolCode =
  // POS Kernel (10)
  | '100101' | '100102' | '100103' | '100104' | '100108'
  // EMV Engine (11)
  | '110101' | '110108' | '110107' | '110303' | '110302'
  // Wallet Engine (13)
  | '130101' | '130102' | '130103' | '130104' | '130105'
  | '130201' | '130202' | '130211'
  // Settlement Engine (15)
  | '150101' | '150102' | '150103'
  | '150201' | '150202'
  | '150301' | '150302' | '150303'
  | '150401' | '150402'
  // Gateway Integrations (18)
  | '180101' | '180102' | '180103'
  | '180201' | '180202' | '180203'
  | string;

export const P2013 = {
  // ─── POS Kernel (10) ────────────────────────────────────────────────────
  POS_SALE_STARTED:           '100101' as ProtocolCode,
  POS_SALE_SUCCESS:           '100102' as ProtocolCode,
  POS_SALE_FAILED:            '100103' as ProtocolCode,
  POS_SALE_REVERSED:          '100104' as ProtocolCode,
  POS_SALE_APPROVED:          '100108' as ProtocolCode,
  POS_REFUND_STARTED:         '100201' as ProtocolCode,
  POS_REFUND_SUCCESS:         '100202' as ProtocolCode,
  POS_REFUND_FAILED:          '100203' as ProtocolCode,
  POS_VOID_STARTED:           '100301' as ProtocolCode,
  POS_VOID_SUCCESS:           '100302' as ProtocolCode,
  POS_VOID_FAILED:            '100303' as ProtocolCode,
  POS_PREAUTH_STARTED:        '100401' as ProtocolCode,
  POS_PREAUTH_SUCCESS:        '100402' as ProtocolCode,
  POS_PREAUTH_FAILED:         '100403' as ProtocolCode,
  POS_PREAUTH_APPROVED:       '100408' as ProtocolCode,

  // ─── EMV Engine (11) ────────────────────────────────────────────────────
  EMV_CONTACT_STARTED:        '110101' as ProtocolCode,
  EMV_CONTACT_APPROVED:       '110108' as ProtocolCode,
  EMV_CONTACT_DECLINED:       '110107' as ProtocolCode,
  EMV_CONTACT_FAILED:         '110103' as ProtocolCode,
  EMV_CONTACTLESS_STARTED:    '110201' as ProtocolCode,
  EMV_CONTACTLESS_APPROVED:   '110208' as ProtocolCode,
  EMV_CONTACTLESS_DECLINED:   '110207' as ProtocolCode,
  EMV_OFFLINE_APPROVAL_SUCCESS: '110302' as ProtocolCode,
  EMV_OFFLINE_APPROVAL_FAILED:  '110303' as ProtocolCode,
  EMV_OFFLINE_SYNC_REQUIRED:  '110309' as ProtocolCode,
  EMV_OFFLINE_SYNC_COMPLETED: '110310' as ProtocolCode,

  // ─── NFC / Contactless (12) ─────────────────────────────────────────────
  NFC_PPSE_SELECT_STARTED:    '120101' as ProtocolCode,
  NFC_PPSE_SELECT_SUCCESS:    '120102' as ProtocolCode,
  NFC_AID_SELECT_STARTED:     '120201' as ProtocolCode,
  NFC_AID_SELECT_SUCCESS:     '120202' as ProtocolCode,
  NFC_GPO_STARTED:            '120301' as ProtocolCode,
  NFC_GPO_SUCCESS:            '120302' as ProtocolCode,

  // ─── Wallet Engine (13) ─────────────────────────────────────────────────
  WALLET_DEBIT_STARTED:       '130101' as ProtocolCode,
  WALLET_DEBIT_SUCCESS:       '130102' as ProtocolCode,
  WALLET_DEBIT_FAILED:        '130103' as ProtocolCode,
  WALLET_DEBIT_REVERSED:      '130104' as ProtocolCode,
  WALLET_DEBIT_ADJUSTED:      '130105' as ProtocolCode,
  WALLET_CREDIT_STARTED:      '130201' as ProtocolCode,
  WALLET_CREDIT_SUCCESS:      '130202' as ProtocolCode,
  WALLET_CREDIT_FAILED:       '130203' as ProtocolCode,
  WALLET_CREDIT_CREDITED:     '130211' as ProtocolCode,
  WALLET_FREEZE_STARTED:      '130301' as ProtocolCode,
  WALLET_FREEZE_SUCCESS:      '130302' as ProtocolCode,
  WALLET_UNFREEZE_STARTED:    '130401' as ProtocolCode,
  WALLET_UNFREEZE_SUCCESS:    '130402' as ProtocolCode,
  WALLET_ADJUST_STARTED:      '130501' as ProtocolCode,
  WALLET_ADJUST_SUCCESS:      '130502' as ProtocolCode,

  // ─── Ledger Engine (14) ─────────────────────────────────────────────────
  LEDGER_ENTRY_CREATE_STARTED: '140101' as ProtocolCode,
  LEDGER_ENTRY_CREATE_SUCCESS: '140102' as ProtocolCode,
  LEDGER_ENTRY_POST_STARTED:   '140201' as ProtocolCode,
  LEDGER_ENTRY_POST_SUCCESS:   '140202' as ProtocolCode,

  // ─── Settlement Engine (15) ─────────────────────────────────────────────
  BATCH_BUILD_STARTED:        '150101' as ProtocolCode,
  BATCH_BUILD_SUCCESS:        '150102' as ProtocolCode,
  BATCH_BUILD_FAILED:         '150103' as ProtocolCode,
  BATCH_CLOSE_STARTED:        '150201' as ProtocolCode,
  BATCH_CLOSE_SUCCESS:        '150202' as ProtocolCode,
  BATCH_CLOSE_FAILED:         '150203' as ProtocolCode,
  BATCH_UPLOAD_STARTED:       '150301' as ProtocolCode,
  BATCH_UPLOAD_SUCCESS:       '150302' as ProtocolCode,
  BATCH_UPLOAD_FAILED:        '150303' as ProtocolCode,
  BATCH_RECONCILE_STARTED:    '150401' as ProtocolCode,
  BATCH_RECONCILE_SUCCESS:    '150402' as ProtocolCode,
  BATCH_RECONCILE_FAILED:     '150403' as ProtocolCode,
  SETTLEMENT_RECONCILE_STARTED: '150501' as ProtocolCode,
  SETTLEMENT_RECONCILED:      '150502' as ProtocolCode,
  SETTLEMENT_RECONCILE_FAILED: '150503' as ProtocolCode,

  // ─── Payout Engine (16) ─────────────────────────────────────────────────
  PAYOUT_WISE_STARTED:        '160101' as ProtocolCode,
  PAYOUT_WISE_SUCCESS:        '160102' as ProtocolCode,
  PAYOUT_WISE_FAILED:         '160103' as ProtocolCode,
  PAYOUT_BANK_WIRE_STARTED:   '160201' as ProtocolCode,
  PAYOUT_BANK_WIRE_SUCCESS:   '160202' as ProtocolCode,
  PAYOUT_CRYPTO_STARTED:      '160301' as ProtocolCode,
  PAYOUT_CRYPTO_SUCCESS:      '160302' as ProtocolCode,

  // ─── Reconciliation Engine (17) ─────────────────────────────────────────
  RECONCILIATION_STARTED:         '170001' as ProtocolCode,
  RECONCILIATION_COMPLETED:       '170002' as ProtocolCode,
  RECONCILIATION_FAILED:          '170003' as ProtocolCode,
  RECONCILIATION_REPORTED:        '170008' as ProtocolCode,
  RECON_DUPLICATE_DETECT_STARTED: '170101' as ProtocolCode,
  RECON_DUPLICATE_DETECT_SUCCESS: '170102' as ProtocolCode,
  RECON_DISCREPANCY_FIX_STARTED:  '170201' as ProtocolCode,
  RECON_DISCREPANCY_FIX_SUCCESS:  '170202' as ProtocolCode,
  RECON_REVERSAL_STARTED:         '170301' as ProtocolCode,
  RECON_REVERSAL_SUCCESS:         '170302' as ProtocolCode,

  // ─── Gateway Integrations (18) ──────────────────────────────────────────
  GATEWAY_PROCESSOR_LOOKUP_STARTED:  '180101' as ProtocolCode,
  GATEWAY_PROCESSOR_LOOKUP_SUCCESS:  '180102' as ProtocolCode,
  GATEWAY_PROCESSOR_LOOKUP_FAILED:   '180103' as ProtocolCode,
  GATEWAY_PROCESSOR_CAPTURE_STARTED: '180201' as ProtocolCode,
  GATEWAY_PROCESSOR_CAPTURE_SUCCESS: '180202' as ProtocolCode,
  GATEWAY_PROCESSOR_CAPTURE_FAILED:  '180203' as ProtocolCode,
  GATEWAY_TRANSAK_STARTED:           '180301' as ProtocolCode,
  GATEWAY_TRANSAK_SUCCESS:           '180302' as ProtocolCode,
  GATEWAY_BINANCE_STARTED:           '180401' as ProtocolCode,
  GATEWAY_BINANCE_SUCCESS:           '180402' as ProtocolCode,

  // ─── Risk / Fraud (19) ──────────────────────────────────────────────────
  RISK_FLOOR_LIMIT_CHECK_STARTED:    '190101' as ProtocolCode,
  RISK_FLOOR_LIMIT_EXCEEDED:         '190109' as ProtocolCode,
  RISK_HOTLIST_CHECK_STARTED:        '190201' as ProtocolCode,
  RISK_HOTLIST_HIT_DECLINED:         '190207' as ProtocolCode,
  RISK_VELOCITY_CHECK_STARTED:       '190301' as ProtocolCode,
  RISK_VELOCITY_BREACH_DECLINED:     '190307' as ProtocolCode,
  RISK_OFFLINE_APPROVED:             '190408' as ProtocolCode,
  RISK_FORCE_ONLINE_REQUIRED:        '190509' as ProtocolCode,

  // ─── Merchant Management (20) ────────────────────────────────────────────
  MERCHANT_ONBOARD_STARTED:     '200101' as ProtocolCode,
  MERCHANT_ONBOARD_SUCCESS:     '200102' as ProtocolCode,
  MERCHANT_SETTINGS_SYNCED:     '200202' as ProtocolCode,
  MERCHANT_BANK_ACCOUNT_ADDED:  '200302' as ProtocolCode,
  MERCHANT_BUSINESS_INFO_UPDATED: '200402' as ProtocolCode,

  // ─── User Management (21) ────────────────────────────────────────────────
  USER_LOGIN_STARTED:           '210101' as ProtocolCode,
  USER_LOGIN_SUCCESS:           '210102' as ProtocolCode,
  USER_LOGIN_FAILED:            '210103' as ProtocolCode,
  USER_LOGOUT_SUCCESS:          '210202' as ProtocolCode,

  // ─── Device Management (22) ──────────────────────────────────────────────
  DEVICE_REGISTER_STARTED:      '220101' as ProtocolCode,
  DEVICE_REGISTER_SUCCESS:      '220102' as ProtocolCode,
  DEVICE_PAIR_SUCCESS:          '220202' as ProtocolCode,
  DEVICE_HEARTBEAT_OK:          '220302' as ProtocolCode,
  DEVICE_DECOMMISSIONED:        '220402' as ProtocolCode,
};

// ────────────────────────────────────────────────────────────────────────────
// 5. Reverse lookup: code → human‑readable meaning
// ────────────────────────────────────────────────────────────────────────────
const _buildLookup = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(P2013)) {
    out[String(v)] = k.replace(/_/g, ' ');
  }
  return out;
};
export const P2013_MEANING: Record<string, string> = _buildLookup();

export function explain(code: ProtocolCode | string): string {
  return P2013_MEANING[String(code)] || `UNKNOWN_${code}`;
}

export function buildCode(
  family: SystemFamily | number,
  moduleBB: number,
  actionCC: ActionCode | number
): ProtocolCode {
  const aa = Number(family).toString().padStart(2, '0');
  const bb = Number(moduleBB).toString().padStart(2, '0');
  const cc = Number(actionCC).toString().padStart(2, '0');
  return `${aa}${bb}${cc}` as ProtocolCode;
}

export interface ProtocolEvent {
  code: ProtocolCode;
  at: string;
  ref?: string;
  amountMinor?: number;
  currency?: string;
  message?: string;
}
