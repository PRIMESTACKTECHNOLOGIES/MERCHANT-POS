/**
 * Protocol 201.3 — 6‑Digit Code System  (CLIENT copy, mirrors backend pos2013/protocol-2013-codes.ts)
 * AA BB CC where:
 *   AA = System Family   (10=POS Kernel, 11=EMV Engine, 12=NFC, 13=Wallet, 15=Settlement, 18=Gateway…)
 *   BB = Module per family
 *   CC = Action / Status
 */

export const P2013 = {
  // ─── POS Kernel (10) ────────────────────────────────────────────────────
  POS_SALE_STARTED:         '100101',
  POS_SALE_SUCCESS:         '100102',
  POS_SALE_FAILED:          '100103',
  POS_SALE_REVERSED:        '100104',
  POS_SALE_APPROVED:        '100108',
  POS_REFUND_STARTED:       '100201',
  POS_REFUND_SUCCESS:       '100202',
  POS_REFUND_FAILED:        '100203',
  POS_VOID_STARTED:         '100301',
  POS_VOID_SUCCESS:         '100302',
  POS_VOID_FAILED:          '100303',
  POS_PREAUTH_STARTED:      '100401',
  POS_PREAUTH_SUCCESS:      '100402',
  POS_PREAUTH_FAILED:       '100403',
  POS_PREAUTH_APPROVED:     '100408',

  // ─── EMV Engine (11) ────────────────────────────────────────────────────
  EMV_CONTACT_STARTED:      '110101',
  EMV_CONTACT_APPROVED:     '110108',
  EMV_CONTACT_DECLINED:     '110107',
  EMV_CONTACT_FAILED:       '110103',
  EMV_CONTACTLESS_STARTED:  '110201',
  EMV_CONTACTLESS_APPROVED: '110208',
  EMV_CONTACTLESS_DECLINED: '110207',
  EMV_OFFLINE_APPROVAL_SUCCESS: '110302',
  EMV_OFFLINE_APPROVAL_FAILED:  '110303',
  EMV_OFFLINE_SYNC_REQUIRED:    '110309',
  EMV_OFFLINE_SYNC_COMPLETED:   '110310',

  // ─── NFC / Contactless (12) ─────────────────────────────────────────────
  NFC_PPSE_SELECT_STARTED:  '120101',
  NFC_PPSE_SELECT_SUCCESS:  '120102',
  NFC_AID_SELECT_STARTED:   '120201',
  NFC_AID_SELECT_SUCCESS:   '120202',
  NFC_GPO_STARTED:          '120301',
  NFC_GPO_SUCCESS:          '120302',

  // ─── Wallet Engine (13) ─────────────────────────────────────────────────
  WALLET_DEBIT_STARTED:     '130101',
  WALLET_DEBIT_SUCCESS:     '130102',
  WALLET_DEBIT_FAILED:      '130103',
  WALLET_DEBIT_REVERSED:    '130104',
  WALLET_DEBIT_ADJUSTED:    '130105',
  WALLET_CREDIT_STARTED:    '130201',
  WALLET_CREDIT_SUCCESS:    '130202',
  WALLET_CREDIT_FAILED:     '130203',
  WALLET_CREDIT_CREDITED:   '130211',

  // ─── Settlement Engine (15) ─────────────────────────────────────────────
  BATCH_BUILD_STARTED:      '150101',
  BATCH_BUILD_SUCCESS:      '150102',
  BATCH_BUILD_FAILED:       '150103',
  BATCH_CLOSE_STARTED:      '150201',
  BATCH_CLOSE_SUCCESS:      '150202',
  BATCH_UPLOAD_STARTED:     '150301',
  BATCH_UPLOAD_SUCCESS:     '150302',
  BATCH_UPLOAD_FAILED:      '150303',
  BATCH_RECONCILE_STARTED:  '150401',
  BATCH_RECONCILE_SUCCESS:  '150402',
  BATCH_RECONCILE_FAILED:   '150403',
  SETTLEMENT_RECONCILE_STARTED: '150501',
  SETTLEMENT_RECONCILED:    '150502',
  SETTLEMENT_RECONCILE_FAILED: '150503',

  // ─── Payout Engine (16) ─────────────────────────────────────────────────
  PAYOUT_WISE_STARTED:      '160101',
  PAYOUT_WISE_SUCCESS:      '160102',
  PAYOUT_WISE_FAILED:       '160103',
  PAYOUT_BANK_WIRE_STARTED: '160201',
  PAYOUT_BANK_WIRE_SUCCESS: '160202',
  PAYOUT_CRYPTO_STARTED:    '160301',
  PAYOUT_CRYPTO_SUCCESS:    '160302',

  // ─── Reconciliation Engine (17) ─────────────────────────────────────────
  RECONCILIATION_STARTED:       '170001',
  RECONCILIATION_COMPLETED:     '170002',
  RECONCILIATION_FAILED:        '170003',
  RECONCILIATION_REPORTED:      '170008',
  RECON_DUPLICATE_DETECT_STARTED: '170101',
  RECON_DUPLICATE_DETECT_SUCCESS: '170102',
  RECON_DISCREPANCY_FIX_STARTED:  '170201',
  RECON_DISCREPANCY_FIX_SUCCESS:  '170202',
  RECON_REVERSAL_STARTED:         '170301',
  RECON_REVERSAL_SUCCESS:         '170302',

  // ─── Gateway Integrations (18) ──────────────────────────────────────────
  GATEWAY_PROCESSOR_LOOKUP_STARTED:  '180101',
  GATEWAY_PROCESSOR_LOOKUP_SUCCESS:  '180102',
  GATEWAY_PROCESSOR_LOOKUP_FAILED:   '180103',
  GATEWAY_PROCESSOR_CAPTURE_STARTED: '180201',
  GATEWAY_PROCESSOR_CAPTURE_SUCCESS: '180202',
  GATEWAY_PROCESSOR_CAPTURE_FAILED:  '180203',
};

const _buildReverse: Record<string, string> = {};
for (const [k, v] of Object.entries(P2013)) _buildReverse[String(v)] = k.replace(/_/g, ' ');

export function explain2013(code: string): string {
  return _buildReverse[String(code)] || `UNKNOWN_${code}`;
}

export type ProtocolEvent = {
  code: string;
  at: string;
  ref?: string;
  amountMinor?: number;
  currency?: string;
  message?: string;
};

const MAX_BUFFER = 500;
let buffer: ProtocolEvent[] = [];

export function recordProtocolEvent(ev: ProtocolEvent) {
  buffer.push(ev);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  try {
    localStorage.setItem('p2013_events', JSON.stringify(buffer.slice(-MAX_BUFFER)));
  } catch { /* private mode */ }
}

export function getProtocolEvents(): ProtocolEvent[] {
  try {
    const raw = localStorage.getItem('p2013_events');
    if (raw) buffer = JSON.parse(raw);
  } catch { buffer = []; }
  return buffer.slice();
}

export function nowISO() { return new Date().toISOString(); }
