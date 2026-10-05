import { db } from "../../config/db";
import { v4 as uuidv4 } from 'uuid';
import { walletsService } from "../wallets/wallets.service";
import {
  createLedgerEntry,
  validateTransition,
  persistLedgerEntry,
  ensureLedgerFiatSchema,
  getFxRate,
  type TransactionState,
  type LedgerEntry,
} from "../ledger/ledger.service";
import { P2013, explain, type ProtocolCode } from '../pos2013/protocol-2013-codes';

export type PosStatus = 'APPROVED' | 'DECLINED' | 'PENDING' | 'UNKNOWN';
export type LedgerBalanceStatus = 'DEBITED' | 'CREDITED' | 'NONE';
export type GatewayStatus = 'APPROVED' | 'DECLINED' | 'PENDING' | 'UNKNOWN';
export type BankStatus = 'APPROVED' | 'DECLINED' | 'PENDING' | 'UNKNOWN';
export type SettlementStatus = 'SENT' | 'RECEIVED' | 'MISSING' | 'UNKNOWN';

export type PayoutStatus = 'PAID' | 'PENDING' | 'FAILED' | 'MISSING' | 'UNKNOWN';

export interface TransactionSnapshot {
  txnId: string;
  localTxnId: string;
  rrn: string;
  stan: string;
  authCode: string;
  isoResponseCode: string;
  protocolCode: string;
  amountMinor: number;
  amountFloat: number;
  currency: string;
  merchantId: string;
  terminalId: string;
  walletRef: string;
  walletType: 'MERCHANT' | 'CUSTOMER' | 'NONE';
  customerId: string;
  entryMode: string;
  emvCryptogramType: string;
  posStatus: PosStatus;
  ledgerStatus: LedgerBalanceStatus;
  ledgerEntries: LedgerEntry[];
  gatewayStatus: GatewayStatus;
  bankStatus: BankStatus;
  settlementStatus: SettlementStatus;
  payoutStatus: PayoutStatus;
  txnTimestamp: string;
  createdAt: string;
}
export type MismatchType =
  | 'A_BANK_APPROVED_NO_LEDGER'
  | 'B_LEDGER_DEBITED_BANK_DECLINED'
  | 'C_POS_APPROVED_NO_GATEWAY_BANK'
  | 'D_SETTLEMENT_SENT_NO_PAYOUT'
  | 'E_GATEWAY_APPROVED_NO_WALLET_CREDIT'
  | 'F_LEDGER_DEBITED_NO_SETTLEMENT'
  | 'G_SETTLEMENT_MATCH_BANK_MISMATCH'
  | 'NONE';

export type RecoveryType =
  | 'CREDIT_WALLET'
  | 'REVERSE_LEDGER'
  | 'REMOVE_PHANTOM'
  | 'REISSUE_PAYOUT'
  | 'RETRY_CAPTURE'
  | 'RECOVER_SETTLEMENT'
  | 'NONE';

export interface MismatchClassification {
  mismatchType: MismatchType;
  recoveryType: RecoveryType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  shortCode: string;
  description: string;
  routing: 'MERCHANT_WALLET' | 'CUSTOMER_WALLET' | 'BANK_PAYOUT' | 'NONE';
  amountMinor: number;
  currency: string;
  detectedAt: string;
}

export interface RecoveryAudit {
  id: string;
  txnId: string;
  snapshotId: string;
  mismatchType: MismatchType;
  recoveryType: RecoveryType;
  severity: string;
  status: 'PENDING' | 'APPLIED' | 'APPLIED_OK' | 'REVIEW_REQUIRED' | 'FAILED';
  amountMinor: number;
  currency: string;
  merchantId: string;
  customerId: string;
  walletRef: string;
  routingTarget: string;
  description: string;
  ledgerCorrectionId: string;
  walletOperationId: string;
  payoutId: string;
  operatorNotes: string;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScanReport {
  scanId: string;
  merchantId: string;
  scannedCount: number;
  mismatchesCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalExposureMinor: number;
  totalExposureCurrency: string;
  mismatches: Array<{ snapshot: TransactionSnapshot; classification: MismatchClassification }>;
  startedAt: string;
  completedAt: string;
}

export const STATUS_NORMALIZERS = {
  toPosStatus: (s: any): PosStatus => {
    const v = String(s || 'UNKNOWN').toUpperCase().trim();
    if (/^(APPROVED|SYNCED|AUTHORIZED|CAPTURED|SETTLED|SUCCESS|PAID|COMPLETED)$/.test(v)) return 'APPROVED';
    if (/^(DECLINED|REVERSED|REFUNDED|FAILED|VOID)$/.test(v)) return 'DECLINED';
    if (/^(PENDING|PROCESSING|HELD)$/.test(v)) return 'PENDING';
    return 'UNKNOWN';
  },
  toLedgerStatus: (creditsMinor: number, debitsMinor: number): LedgerBalanceStatus => {
    const net = creditsMinor - debitsMinor;
    if (creditsMinor > 0 && Math.abs(net) < 5) return 'CREDITED';
    if (debitsMinor > 0 && creditsMinor === 0) return 'DEBITED';
    if (creditsMinor === 0 && debitsMinor === 0) return 'NONE';
    if (net > 0) return 'CREDITED';
    if (net < 0) return 'DEBITED';
    return 'NONE';
  },
  toGatewayStatus: (s: any): GatewayStatus => {
    const v = String(s || 'UNKNOWN').toUpperCase().trim();
    if (/^(APPROVED|AUTHORIZED|CAPTURED|SUCCESS|PAID|COMPLETED|PROCESSED)$/.test(v)) return 'APPROVED';
    if (/^(DECLINED|FAILED|REJECTED|REFUSED)$/.test(v)) return 'DECLINED';
    if (/^(PENDING|PROCESSING|SUBMITTED)$/.test(v)) return 'PENDING';
    return 'UNKNOWN';
  },
  toBankStatus: (isoResp: any, meta: any): BankStatus => {
    const iso = String(isoResp || '').trim();
    if (iso === '00' || iso === '000') return 'APPROVED';
    if (/^(05|14|51|54|57|58|61|62|63|65|91|92)$/.test(iso)) return 'DECLINED';
    if (/PENDING/.test(String(meta || '').toUpperCase())) return 'PENDING';
    return 'UNKNOWN';
  },
  toSettlementStatus: (s: any): SettlementStatus => {
    const v = String(s || 'UNKNOWN').toUpperCase().trim();
    if (/^(SENT|UPLOADED|SUBMITTED|BATCHED)$/.test(v)) return 'SENT';
    if (/^(RECEIVED|ACKED|CONFIRMED|PROCESSED)$/.test(v)) return 'RECEIVED';
    if (/^(MISSING|NOT_FOUND|NO_RECORD)$/.test(v)) return 'MISSING';
    return 'UNKNOWN';
  },
  toPayoutStatus: (s: any): PayoutStatus => {
    const v = String(s || 'UNKNOWN').toUpperCase().trim();
    if (/^(PAID|COMPLETED|SUCCESS|PROCESSED)$/.test(v)) return 'PAID';
    if (/^(PENDING|QUEUED|SCHEDULED)$/.test(v)) return 'PENDING';
    if (/^(FAILED|REJECTED|RETURNED)$/.test(v)) return 'FAILED';
    if (/^(MISSING|NO_RECORD)$/.test(v)) return 'MISSING';
    return 'UNKNOWN';
  },
};

export async function ensureRecoverySchema(query: (text: string, params?: any[]) => Promise<any> = db.query.bind(db)): Promise<void> {
  await ensureLedgerFiatSchema(query);
  const alters = [
    `ALTER TABLE pos2013_transactions ADD COLUMN iso_response_code TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN wallet_ref TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN protocol_code TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN customer_id TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN meta TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN gateway_status TEXT DEFAULT 'UNKNOWN'`,
    `ALTER TABLE pos2013_transactions ADD COLUMN bank_status TEXT DEFAULT 'UNKNOWN'`,
    `ALTER TABLE pos2013_transactions ADD COLUMN settlement_status TEXT DEFAULT 'UNKNOWN'`,
    `ALTER TABLE pos2013_transactions ADD COLUMN payout_status TEXT DEFAULT 'UNKNOWN'`,
    `ALTER TABLE pos2013_transactions ADD COLUMN recovery_status TEXT DEFAULT 'NONE'`,
    `ALTER TABLE pos2013_transactions ADD COLUMN last_scan_id TEXT`,
    `ALTER TABLE pos2013_transactions ADD COLUMN last_scanned_at TEXT`,
  ];
  for (const sql of alters) { try { await query(sql); } catch { /* ignore existing */ } }
  try {
    await query(`CREATE TABLE IF NOT EXISTS recovery_audits (
      id TEXT PRIMARY KEY,
      txn_id TEXT NOT NULL,
      snapshot_id TEXT,
      mismatch_type TEXT NOT NULL,
      recovery_type TEXT NOT NULL,
      severity TEXT DEFAULT 'MEDIUM',
      status TEXT DEFAULT 'PENDING',
      amount_minor INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      merchant_id TEXT,
      customer_id TEXT,
      wallet_ref TEXT,
      routing_target TEXT,
      description TEXT,
      ledger_correction_id TEXT,
      wallet_operation_id TEXT,
      payout_id TEXT,
      operator_notes TEXT,
      applied_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch { /* ignore */ }
  try {
    await query(`CREATE INDEX IF NOT EXISTS idx_recovery_txn ON recovery_audits(txn_id)`);
  } catch { /* ignore */ }
  try {
    await query(`CREATE TABLE IF NOT EXISTS recovery_scans (
      id TEXT PRIMARY KEY,
      merchant_id TEXT,
      scanned_count INTEGER DEFAULT 0,
      mismatches_count INTEGER DEFAULT 0,
      critical_count INTEGER DEFAULT 0,
      high_count INTEGER DEFAULT 0,
      medium_count INTEGER DEFAULT 0,
      low_count INTEGER DEFAULT 0,
      total_exposure_minor INTEGER DEFAULT 0,
      total_exposure_currency TEXT DEFAULT 'USD',
      summary_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch { /* ignore */ }
}

export function detectRecoveryAction(tx: TransactionSnapshot): RecoveryType | null {
  if (tx.bankStatus === 'APPROVED' && tx.ledgerStatus === 'NONE') return 'CREDIT_WALLET';
  if (tx.ledgerStatus === 'DEBITED' && tx.bankStatus === 'DECLINED') return 'REVERSE_LEDGER';
  if (tx.posStatus === 'APPROVED' && tx.gatewayStatus === 'UNKNOWN' && tx.bankStatus === 'UNKNOWN') return 'REMOVE_PHANTOM';
  if (tx.gatewayStatus === 'APPROVED' && tx.ledgerStatus !== 'CREDITED') return 'CREDIT_WALLET';
  if (tx.ledgerStatus === 'DEBITED' && tx.settlementStatus === 'UNKNOWN') return 'RECOVER_SETTLEMENT';
  if (tx.settlementStatus === 'SENT' && tx.payoutStatus === 'MISSING') return 'REISSUE_PAYOUT';
  return null;
}

export function classifyMismatch(tx: TransactionSnapshot): MismatchClassification {
  const now = new Date().toISOString();
  const amt = Number(tx.amountMinor || 0);
  const ccy = tx.currency || 'USD';
  const t: Omit<MismatchClassification, 'mismatchType' | 'recoveryType' | 'severity' | 'shortCode' | 'description' | 'routing'> = {
    amountMinor: amt,
    currency: ccy,
    detectedAt: now,
  };
  if (tx.bankStatus === 'APPROVED' && tx.ledgerStatus === 'NONE') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'A_BANK_APPROVED_NO_LEDGER', recoveryType: 'CREDIT_WALLET', severity: 'CRITICAL', shortCode: 'A', description: 'Bank approved (ISO 00), no ledger CREDIT entry — STUCK FUNDS recovery', routing };
  }
  if (tx.ledgerStatus === 'DEBITED' && tx.bankStatus === 'DECLINED') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'B_LEDGER_DEBITED_BANK_DECLINED', recoveryType: 'REVERSE_LEDGER', severity: 'CRITICAL', shortCode: 'B', description: 'Wallet was debited but card processor declined (Type B phantom debit reversal)', routing };
  }
  if (tx.posStatus === 'APPROVED' && tx.gatewayStatus === 'UNKNOWN' && tx.bankStatus === 'UNKNOWN') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'C_POS_APPROVED_NO_GATEWAY_BANK', recoveryType: 'REMOVE_PHANTOM', severity: 'HIGH', shortCode: 'C', description: 'POS APPROVED orphan with no gateway/bank record — remove phantom credit', routing };
  }
  if (tx.gatewayStatus === 'APPROVED' && tx.ledgerStatus !== 'CREDITED') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'E_GATEWAY_APPROVED_NO_WALLET_CREDIT', recoveryType: 'CREDIT_WALLET', severity: 'CRITICAL', shortCode: 'E', description: 'Processor approved but wallet not credited — apply ledger correction credit', routing };
  }
  if (tx.settlementStatus === 'SENT' && tx.payoutStatus === 'MISSING') {
    return { ...t, mismatchType: 'D_SETTLEMENT_SENT_NO_PAYOUT', recoveryType: 'REISSUE_PAYOUT', severity: 'HIGH', shortCode: 'D', description: 'Settlement batch reported SENT to bank but payout record MISSING — reissue or manual', routing: 'BANK_PAYOUT' };
  }
  if (tx.ledgerStatus === 'DEBITED' && tx.settlementStatus === 'UNKNOWN') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'F_LEDGER_DEBITED_NO_SETTLEMENT', recoveryType: 'RECOVER_SETTLEMENT', severity: 'MEDIUM', shortCode: 'F', description: 'Customer/merchant wallet debited but no settlement batch created yet', routing };
  }
  if (tx.posStatus === 'APPROVED' && tx.ledgerStatus === 'NONE') {
    const routing: MismatchClassification['routing'] = tx.customerId ? 'CUSTOMER_WALLET' : 'MERCHANT_WALLET';
    return { ...t, mismatchType: 'C_POS_APPROVED_NO_GATEWAY_BANK', recoveryType: 'REMOVE_PHANTOM', severity: 'MEDIUM', shortCode: 'C*', description: 'POS APPROVED but no ledger at all — orphan / phantom removal', routing };
  }
  return { ...t, mismatchType: 'NONE', recoveryType: 'NONE', severity: 'INFO', shortCode: '-', description: 'All layers aligned — no recovery action required', routing: 'NONE' };
}

export class RecoveryEngineService {

  async buildTransactionSnapshot(
    txnRow: any,
    opts: { defaultFiat?: string } = {}
  ): Promise<TransactionSnapshot> {
    const row = txnRow || {};
    const amountMinor = Number(row.amount_minor ?? 0);
    const ccy = String(row.currency || 'USD').toUpperCase();
    const txnId = String(row.id || '');
    const merchantId = String(row.merchant_id || '');
    const customerId = String(row.customer_id || '');
    const walletRef = String(row.wallet_ref || '');
    const stan = String(row.stan || '').trim();
    const rrn = String(row.rrn || '').trim();
    const authCode = String(row.auth_code || '').trim();

    let creditsMinor = 0;
    let debitsMinor = 0;
    const ledgerEntries: LedgerEntry[] = [];
    try {
      const lRes = await db.query(
        `SELECT id, transaction_id AS transactionId, type, amount,
                COALESCE(amount_minor, CAST(ROUND(amount * 100) AS INTEGER)) AS amountMinor,
                currency, status, description, created_at AS createdAt,
                COALESCE(fx_rate_to_fiat, NULL) AS fxRateToFiat,
                COALESCE(fiat_currency, ?) AS fiatCurrency,
                wallet_ref AS walletRef
         FROM ledger_entries
         WHERE (transaction_id = ? OR wallet_ref = ? OR reference_id = ?)
         ORDER BY created_at ASC, id ASC`,
        [opts?.defaultFiat || 'USD', txnId, walletRef || txnId, txnId]
      );
      for (const r of (lRes.rows || []) as any[]) {
        const minor = Number(r.amountMinor ?? Math.round(Number(r.amount || 0) * 100));
        if (String(r.type || '').toLowerCase() === 'credit') creditsMinor += minor;
        else debitsMinor += minor;
        ledgerEntries.push({ ...r, amount: Number(r.amount || 0), amountMinor: minor });
      }
    } catch { /* ignore */ }

    const meta: any = (() => { try { return JSON.parse(row.meta || '{}'); } catch { return {}; } })();
    const isoResponseCode = String(row.iso_response_code || meta?.isoResponseCode || meta?.iso_code || '').trim();
    const protocolCode = String(row.protocol_code || meta?.protocolCode || meta?.p2013_code || '').trim();

    let walletType: TransactionSnapshot['walletType'] = 'NONE';
    if (walletRef) {
      try {
        const mw = await db.query(`SELECT id FROM merchant_wallets WHERE id = ? LIMIT 1`, [walletRef]);
        if ((mw.rows?.length || 0) > 0) walletType = 'MERCHANT';
        else {
          const cw = await db.query(`SELECT id FROM customer_wallets WHERE id = ? LIMIT 1`, [walletRef]);
          if ((cw.rows?.length || 0) > 0) walletType = 'CUSTOMER';
        }
      } catch { /* ignore */ }
    } else if (customerId) {
      walletType = 'CUSTOMER';
    } else if (merchantId) {
      walletType = 'MERCHANT';
    }

    const emvCryptogramType = String(meta?.cryptogramType || meta?.emv_type || row.entry_mode || '').toUpperCase();

    return {
      txnId,
      localTxnId: String(row.local_txn_id || txnId),
      rrn,
      stan,
      authCode,
      isoResponseCode,
      protocolCode,
      amountMinor,
      amountFloat: amountMinor / 100,
      currency: ccy,
      merchantId,
      terminalId: String(row.terminal_id || ''),
      walletRef,
      walletType,
      customerId,
      entryMode: String(row.entry_mode || meta?.entryMode || '').toUpperCase(),
      emvCryptogramType,
      posStatus: STATUS_NORMALIZERS.toPosStatus(row.status),
      ledgerStatus: STATUS_NORMALIZERS.toLedgerStatus(creditsMinor, debitsMinor),
      ledgerEntries,
      gatewayStatus: STATUS_NORMALIZERS.toGatewayStatus(row.gateway_status || meta?.gatewayStatus || meta?.processorStatus),
      bankStatus: STATUS_NORMALIZERS.toBankStatus(isoResponseCode, row.bank_status || meta?.bankStatus),
      settlementStatus: STATUS_NORMALIZERS.toSettlementStatus(row.settlement_status || meta?.settlementStatus),
      payoutStatus: STATUS_NORMALIZERS.toPayoutStatus(row.payout_status || meta?.payoutStatus),
      txnTimestamp: String(row.txn_timestamp || row.created_at || ''),
      createdAt: String(row.created_at || ''),
    };
  }

  async scanMismatches(params: {
    merchantId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    onlyMismatches?: boolean;
  } = {}): Promise<ScanReport> {
    const startedAt = new Date().toISOString();
    const scanId = `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await ensureRecoverySchema();

    const placeholders: any[] = [];
    let sql = `
      SELECT
        t.id, t.merchant_id, t.terminal_id, t.batch_id, t.local_txn_id, t.stan, t.rrn,
        t.auth_code, t.iso_response_code, t.protocol_code, t.amount_minor, t.currency,
        t.pan_masked, t.status, t.entry_mode, t.txn_timestamp, t.created_at, t.meta,
        t.wallet_ref, t.customer_id, t.gateway_status, t.bank_status,
        t.settlement_status, t.payout_status, t.recovery_status
      FROM pos2013_transactions t
      WHERE 1=1
    `;
    if (params.merchantId) { sql += ` AND t.merchant_id = ?`; placeholders.push(params.merchantId); }
    if (params.startDate) { sql += ` AND t.txn_timestamp >= ?`; placeholders.push(params.startDate); }
    if (params.endDate) { sql += ` AND t.txn_timestamp <= ?`; placeholders.push(params.endDate); }
    sql += ` ORDER BY t.txn_timestamp DESC, t.created_at DESC`;
    if (params.limit && params.limit > 0) { sql += ` LIMIT ?`; placeholders.push(params.limit); }

    const rows = (await db.query(sql, placeholders)).rows || [];
    const mismatches: ScanReport['mismatches'] = [];
    const defaultFiat = params.merchantId ? (await this._inferMerchantDefaultFiat(params.merchantId)) : 'USD';

    for (const row of rows) {
      const snap = await this.buildTransactionSnapshot(row, { defaultFiat });
      const classification = classifyMismatch(snap);
      if (classification.mismatchType === 'NONE' && params.onlyMismatches !== false ? false : classification.mismatchType !== 'NONE') {
        mismatches.push({ snapshot: snap, classification });
      } else if (params.onlyMismatches === false) {
        mismatches.push({ snapshot: snap, classification });
      }
      if (snap.txnId) {
        try {
          await db.query(
            `UPDATE pos2013_transactions SET last_scan_id = ?, last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [scanId, snap.txnId]
          );
        } catch { /* ignore */ }
      }
      try {
        await db.query(
          `INSERT OR IGNORE INTO recovery_audits
            (id, txn_id, snapshot_id, mismatch_type, recovery_type, severity, status,
             amount_minor, currency, merchant_id, customer_id, wallet_ref, routing_target, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
          [
            `aud_${scanId.slice(-8)}_${snap.txnId.slice(-12)}`,
            snap.txnId,
            `snap_${scanId}_${snap.txnId}`,
            classification.mismatchType,
            classification.recoveryType,
            classification.severity,
            classification.recoveryType === 'NONE' ? 'NONE' : 'PENDING',
            classification.amountMinor,
            classification.currency,
            snap.merchantId,
            snap.customerId,
            snap.walletRef,
            classification.routing,
            classification.description,
          ]
        );
      } catch { /* ignore */ }
    }

    const criticalCount = mismatches.filter(m => m.classification.severity === 'CRITICAL').length;
    const highCount = mismatches.filter(m => m.classification.severity === 'HIGH').length;
    const mediumCount = mismatches.filter(m => m.classification.severity === 'MEDIUM').length;
    const lowCount = mismatches.filter(m => m.classification.severity === 'LOW' || m.classification.severity === 'INFO').length;

    let totalExposureMinor = 0;
    const exposureCcy = defaultFiat || 'USD';
    for (const m of mismatches) {
      if (m.classification.recoveryType === 'NONE') continue;
      const rate = getFxRate(m.snapshot.currency || 'USD', exposureCcy);
      totalExposureMinor += Math.round(Number(m.classification.amountMinor || 0) * rate);
    }

    const completedAt = new Date().toISOString();
    try {
      await db.query(
        `INSERT INTO recovery_scans
          (id, merchant_id, scanned_count, mismatches_count, critical_count, high_count, medium_count, low_count,
           total_exposure_minor, total_exposure_currency, summary_json, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId,
          params.merchantId || null,
          rows.length,
          mismatches.length,
          criticalCount,
          highCount,
          mediumCount,
          lowCount,
          totalExposureMinor,
          exposureCcy,
          JSON.stringify({ params }),
          startedAt,
          completedAt,
        ]
      );
    } catch { /* ignore */ }

    return {
      scanId,
      merchantId: params.merchantId || '',
      scannedCount: rows.length,
      mismatchesCount: mismatches.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      totalExposureMinor,
      totalExposureCurrency: exposureCcy,
      mismatches,
      startedAt,
      completedAt,
    };
  }

  async applyRecoveryAction(params: {
    auditId?: string;
    txnId?: string;
    recoveryType?: RecoveryType;
    operatorNotes?: string;
    force?: boolean;
  }): Promise<{ success: boolean; status: RecoveryAudit['status']; audit: Partial<RecoveryAudit>; action: RecoveryType; }> {
    await ensureRecoverySchema();
    const { auditId, txnId, operatorNotes, force = false } = params;
    let auditRow: any = null;
    if (auditId) {
      const r = await db.query(`SELECT * FROM recovery_audits WHERE id = ? LIMIT 1`, [auditId]);
      auditRow = r.rows?.[0] || null;
    } else if (txnId) {
      const r = await db.query(`SELECT * FROM recovery_audits WHERE txn_id = ? ORDER BY created_at DESC LIMIT 1`, [txnId]);
      auditRow = r.rows?.[0] || null;
    }
    if (!auditRow) {
      throw new Error(`No recovery audit record found for auditId=${auditId || '-'} txnId=${txnId || '-'}`);
    }
    if (!force && String(auditRow.status || '').toUpperCase() === 'APPLIED_OK') {
      return { success: true, status: 'APPLIED_OK', audit: auditRow, action: String(auditRow.recovery_type) as RecoveryType };
    }

    let row: any = null;
    try {
      const r = await db.query(`SELECT * FROM pos2013_transactions WHERE id = ? LIMIT 1`, [auditRow.txn_id]);
      row = r.rows?.[0] || null;
    } catch { /* ignore */ }
    if (!row) row = {};
    const defaultFiat = auditRow.merchant_id ? (await this._inferMerchantDefaultFiat(String(auditRow.merchant_id))) : 'USD';
    const snap = await this.buildTransactionSnapshot(row, { defaultFiat });
    const classification = classifyMismatch(snap);
    const recovery: RecoveryType = (params.recoveryType || String(auditRow.recovery_type || classification.recoveryType || 'NONE')) as RecoveryType;

    const now = new Date().toISOString();
    const result: Partial<RecoveryAudit> & { id?: string } = { id: auditRow.id };
    let status: RecoveryAudit['status'] = 'PENDING';
    let ledgerCorrectionId: string | null = null;
    let walletOperationId: string | null = null;
    let payoutId: string | null = null;
    const amountFloat = Number(auditRow.amount_minor || 0) / 100;
    const ccy = String(auditRow.currency || snap.currency || 'USD');

    try {
      switch (recovery) {
        case 'CREDIT_WALLET': {
          const refTx = String(auditRow.ledger_correction_id || `RECOVERY-CREDIT-${auditRow.id || auditRow.txn_id}`).toUpperCase();
          const refForDb = refTx;
          try {
            const entry = createLedgerEntry(
              refTx,
              'credit',
              amountFloat,
              ccy,
              'CAPTURED',
              `[RECOVERY-${classification.shortCode}] ${classification.description} — txn=${auditRow.txn_id} RRN=${snap.rrn || '-'} AUTH=${snap.authCode || '-'}`,
              String(auditRow.merchant_id || snap.merchantId || 'UNKNOWN'),
              'manual',
              String(auditRow.wallet_ref || '').trim() || undefined,
              undefined,
              refForDb
            );
            validateTransition('PENDING', 'CAPTURED');
            await persistLedgerEntry(entry, db.query.bind(db));
            ledgerCorrectionId = entry.id;
          } catch (leErr: any) {
            console.warn(`[Recovery] Ledger correction creation skipped: ${leErr?.message || leErr}`);
          }
          if (snap.walletType === 'MERCHANT' || (!snap.customerId && snap.merchantId)) {
            try {
              const res = await walletsService.creditMerchantWallet(
                String(auditRow.merchant_id || snap.merchantId),
                amountFloat,
                'recovery_credit',
                refForDb,
                ccy
              );
              walletOperationId = (res as any)?.transactionId || (res as any)?.id || null;
            } catch (err: any) {
              console.warn(`[Recovery] merchant wallet credit skipped (may already exist): ${err?.message || err}`);
              walletOperationId = `dup:${refForDb}`;
            }
          } else if (snap.walletType === 'CUSTOMER' || snap.customerId) {
            try {
              const res = await walletsService.topupWallet(
                String(auditRow.customer_id || snap.customerId),
                amountFloat,
                'recovery_credit',
                refForDb,
                ccy
              );
              walletOperationId = (res as any)?.transactionId || (res as any)?.id || null;
            } catch (err: any) {
              console.warn(`[Recovery] customer wallet credit skipped (may already exist): ${err?.message || err}`);
              walletOperationId = `dup:${refForDb}`;
            }
          }
          status = 'APPLIED_OK';
          break;
        }
        case 'REVERSE_LEDGER': {
          const refTx = `RECOVERY-REVERSE-${auditRow.id || auditRow.txn_id}`.toUpperCase();
          try {
            const entry = createLedgerEntry(
              refTx,
              'credit',
              amountFloat,
              ccy,
              'REVERSED',
              `[RECOVERY-${classification.shortCode}] Type B reversal — phantom debit reversal txn=${auditRow.txn_id} RRN=${snap.rrn || '-'}`,
              String(auditRow.merchant_id || snap.merchantId || 'UNKNOWN'),
              'manual',
              String(auditRow.wallet_ref || '').trim() || undefined,
              undefined,
              refTx
            );
            try { validateTransition('PENDING', 'REVERSED'); } catch { /* ignore */ }
            await persistLedgerEntry(entry, db.query.bind(db));
            ledgerCorrectionId = entry.id;
          } catch (leErr: any) {
            console.warn(`[Recovery] reversal ledger entry skipped: ${leErr?.message || leErr}`);
          }
          if (snap.walletType === 'MERCHANT' || (!snap.customerId && snap.merchantId)) {
            try {
              const res = await walletsService.creditMerchantWallet(
                String(auditRow.merchant_id || snap.merchantId),
                amountFloat,
                'recovery_reversal',
                refTx,
                ccy
              );
              walletOperationId = (res as any)?.transactionId || (res as any)?.id || null;
            } catch (err: any) {
              console.warn(`[Recovery] merchant reversal credit skipped: ${err?.message || err}`);
              walletOperationId = `dup:${refTx}`;
            }
          } else if (snap.walletType === 'CUSTOMER' || snap.customerId) {
            try {
              const res = await walletsService.topupWallet(
                String(auditRow.customer_id || snap.customerId),
                amountFloat,
                'recovery_reversal',
                refTx,
                ccy
              );
              walletOperationId = (res as any)?.transactionId || (res as any)?.id || null;
            } catch (err: any) {
              console.warn(`[Recovery] customer reversal credit skipped: ${err?.message || err}`);
              walletOperationId = `dup:${refTx}`;
            }
          }
          try {
            await db.query(`UPDATE pos2013_transactions SET status = 'REVERSED', recovery_status = 'REVERSED' WHERE id = ?`, [auditRow.txn_id]);
          } catch { /* ignore */ }
          status = 'APPLIED_OK';
          break;
        }
        case 'REMOVE_PHANTOM': {
          try {
            await db.query(`UPDATE pos2013_transactions SET status = 'ORPHAN', recovery_status = 'ORPHAN_REMOVED' WHERE id = ?`, [auditRow.txn_id]);
          } catch (e: any) {
            console.warn(`[Recovery] orphan status update failed: ${e?.message || e}`);
          }
          status = 'APPLIED_OK';
          break;
        }
        case 'RECOVER_SETTLEMENT':
        case 'REISSUE_PAYOUT': {
          try {
            const pid = `recover-${uuidv4().slice(0, 12)}`;
            await db.query(
              `INSERT INTO bank_payouts (id, merchant_id, customer_id, amount, currency, fee, net_amount, status, reference, created_at, scheduled_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, 'PENDING', ?, ?, datetime('now', '+1 day'))`,
              [
                pid,
                auditRow.merchant_id || snap.merchantId || null,
                auditRow.customer_id || snap.customerId || null,
                amountFloat,
                ccy,
                amountFloat,
                pid.toUpperCase(),
                now,
              ]
            );
            payoutId = pid;
            status = 'REVIEW_REQUIRED';
          } catch (e: any) {
            console.warn(`[Recovery] payout bootstrap failed: ${e?.message || e}`);
            status = 'FAILED';
          }
          break;
        }
        case 'RETRY_CAPTURE': {
          status = 'REVIEW_REQUIRED';
          break;
        }
        case 'NONE':
        default: {
          status = 'FAILED';
          break;
        }
      }
    } catch (e: any) {
      console.error(`[Recovery Engine] apply failed for audit=${auditRow.id}: ${e?.message || e}`);
      status = 'FAILED';
    }

    try {
      await db.query(
        `UPDATE recovery_audits SET
           status = ?,
           ledger_correction_id = COALESCE(?, ledger_correction_id),
           wallet_operation_id = COALESCE(?, wallet_operation_id),
           payout_id = COALESCE(?, payout_id),
           operator_notes = COALESCE(?, operator_notes),
           applied_at = CASE WHEN ? = 'APPLIED_OK' OR ? = 'REVIEW_REQUIRED' THEN COALESCE(applied_at, ?) ELSE applied_at END,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          status,
          ledgerCorrectionId,
          walletOperationId,
          payoutId,
          operatorNotes || null,
          status,
          status,
          now,
          auditRow.id,
        ]
      );
    } catch { /* ignore */ }

    try {
      const p2013Code: ProtocolCode =
        status === 'APPLIED_OK' ? P2013.SETTLEMENT_RECONCILED :
        status === 'REVIEW_REQUIRED' ? P2013.SETTLEMENT_RECONCILE_STARTED :
        P2013.SETTLEMENT_RECONCILE_FAILED;
      const logMsg = `[Recovery | ${classification.shortCode}] ${recovery} ${status} txn=${auditRow.txn_id} amt=${amountFloat.toFixed(2)} ${ccy}`;
      console.log(`[P2013 | ${p2013Code}] ${logMsg} ${explain(p2013Code)}`);
    } catch { /* ignore */ }

    return {
      success: status === 'APPLIED_OK' || status === 'REVIEW_REQUIRED',
      status,
      audit: {
        ...result,
        id: auditRow.id,
        txnId: auditRow.txn_id,
        mismatchType: auditRow.mismatch_type,
        recoveryType: recovery,
        severity: auditRow.severity,
        ledgerCorrectionId: ledgerCorrectionId || auditRow.ledger_correction_id,
        walletOperationId: walletOperationId || auditRow.wallet_operation_id,
        payoutId: payoutId || auditRow.payout_id,
        appliedAt: (status === 'APPLIED_OK' || status === 'REVIEW_REQUIRED') ? now : auditRow.applied_at,
        description: classification.description,
      },
      action: recovery,
    };
  }

  async listRecoveryAudits(params: {
    merchantId?: string;
    txnId?: string;
    status?: RecoveryAudit['status'];
    mismatchType?: MismatchType;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ audits: RecoveryAudit[]; total: number; limit: number; offset: number }> {
    await ensureRecoverySchema();
    const placeholders: any[] = [];
    let where = `WHERE 1=1`;
    if (params.merchantId) { where += ` AND merchant_id = ?`; placeholders.push(params.merchantId); }
    if (params.txnId) { where += ` AND txn_id = ?`; placeholders.push(params.txnId); }
    if (params.status) { where += ` AND status = ?`; placeholders.push(params.status); }
    if (params.mismatchType) { where += ` AND mismatch_type = ?`; placeholders.push(params.mismatchType); }
    const lim = Math.min(Math.max(Number(params.limit || 50), 1), 500);
    const off = Math.max(Number(params.offset || 0), 0);
    const rows = (await db.query(`SELECT * FROM recovery_audits ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...placeholders, lim, off])).rows || [];
    const totalRow = (await db.query(`SELECT COUNT(*) AS total FROM recovery_audits ${where}`, placeholders)).rows?.[0] || { total: 0 };
    const audits: RecoveryAudit[] = rows.map((r: any) => ({
      id: r.id,
      txnId: r.txn_id,
      snapshotId: r.snapshot_id,
      mismatchType: r.mismatch_type,
      recoveryType: r.recovery_type,
      severity: r.severity,
      status: r.status,
      amountMinor: Number(r.amount_minor || 0),
      currency: r.currency,
      merchantId: r.merchant_id,
      customerId: r.customer_id,
      walletRef: r.wallet_ref,
      routingTarget: r.routing_target,
      description: r.description,
      ledgerCorrectionId: r.ledger_correction_id,
      walletOperationId: r.wallet_operation_id,
      payoutId: r.payout_id,
      operatorNotes: r.operator_notes,
      appliedAt: r.applied_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return { audits, total: Number(totalRow.total || 0), limit: lim, offset: off };
  }

  private async _inferMerchantDefaultFiat(merchantId: string): Promise<string> {
    try {
      const r = await db.query(
        `SELECT currency FROM merchant_wallets WHERE merchant_id = ? ORDER BY
           CASE WHEN currency = 'AED' THEN 0 WHEN currency = 'USD' THEN 1 ELSE 2 END,
           CAST(balance AS REAL) DESC LIMIT 1`,
        [merchantId]
      );
      if (r.rows?.[0]?.currency) return String(r.rows[0].currency).toUpperCase();
    } catch { /* ignore */ }
    return 'USD';
  }

  async cronSweep(merchantId?: string): Promise<{ applied: number; pending: number; totalExposureMinor: number; scan: ScanReport }> {
    const scan = await this.scanMismatches({ merchantId, onlyMismatches: true });
    let applied = 0;
    let pending = 0;
    for (const m of scan.mismatches) {
      if (m.classification.recoveryType === 'NONE') { continue; }
      const r = await this.listRecoveryAudits({ txnId: m.snapshot.txnId, limit: 1 });
      const audit = r.audits[0];
      if (!audit) { pending++; continue; }
      if (audit.status === 'APPLIED_OK' || audit.status === 'APPLIED') { continue; }
      if (audit.status === 'PENDING') {
        const autoApplicable: RecoveryType[] = ['CREDIT_WALLET', 'REVERSE_LEDGER', 'REMOVE_PHANTOM'];
        if (autoApplicable.includes(audit.recoveryType as RecoveryType)) {
          const res = await this.applyRecoveryAction({ auditId: audit.id });
          if (res.success) applied++;
          else pending++;
        } else {
          pending++;
        }
      }
    }
    return { applied, pending, totalExposureMinor: scan.totalExposureMinor, scan };
  }
}

export const recoveryEngineService = new RecoveryEngineService();
