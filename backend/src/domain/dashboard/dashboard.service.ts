import { db } from '../../config/db';

// ───────────────────────────────────────────────────────────────────────
// STATUS DASHBOARD SERVICE
// Real-time offline settlement status visualization
// ───────────────────────────────────────────────────────────────────────

export interface PendingTransaction {
  id: string;
  pan: string;
  amount: number;
  status: string;
  terminalId: string;
  createdAt: string;
  approvedAt?: string;
  reconciliationStatus?: string;
  settlementStatus?: string;
}

export interface SettlementStatus {
  transactionId: string;
  pan: string;
  amount: number;
  status: 'PENDING' | 'HELD' | 'SETTLED' | 'REVERSED' | 'FAILED';
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  holdReason?: string;
  settledAt?: string;
  createdAt: string;
}

export interface DashboardSummary {
  totalPending: number;
  totalPendingAmount: number;
  totalSettled: number;
  totalSettledAmount: number;
  totalHeld: number;
  totalHeldAmount: number;
  totalReversed: number;
  totalReversedAmount: number;
  totalFailed: number;
  totalFailedAmount: number;
  totalFeeAmount: number;
  reconciliationRate: number;
  settlementRate: number;
  costOfDoing: number;
}

export interface DashboardData {
  merchantId: string;
  terminalId?: string;
  summary: DashboardSummary;
  pendingTransactions: PendingTransaction[];
  recentSettlements: SettlementStatus[];
  conflictMetrics: {
    duplicatesDetected: number;
    duplicatesMerged: number;
    reversalsProcessed: number;
    failedSyncsRetried: number;
  };
  reconciledToday: number;
  failedToReconcileToday: number;
  lastUpdated: string;
}

/**
 * Get pending transactions for merchant/terminal
 * Returns transactions that haven't been settled yet
 */
export async function getPendingTransactions(
  merchantId: string,
  terminalId?: string,
  limit: number = 100
): Promise<PendingTransaction[]> {
  try {
    let query = `
      SELECT DISTINCT
        t.id,
        t.pan_masked AS pan,
        t.amount_minor / 100.0 AS amount,
        t.status,
        t.terminal_id,
        t.created_at,
        t.txn_timestamp as approved_at
      FROM pos2013_transactions t
      WHERE t.merchant_id = ?
        AND UPPER(t.status) IN ('PENDING_CAPTURE', 'CAPTURE_FAILED', 'PENDING')
    `;

    const params: any[] = [merchantId];

    if (terminalId) {
      query += ` AND t.terminal_id = ?`;
      params.push(terminalId);
    }

    query += ` ORDER BY t.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await db.query(query, params);

    const transactions: PendingTransaction[] = (result.rows || []).map((t: any) => ({
      id: t.id,
      pan: t.pan,
      amount: Number(t.amount),
      status: t.status,
      terminalId: t.terminal_id,
      createdAt: t.created_at,
      approvedAt: t.approved_at,
    }));

    console.log(
      `[Dashboard] Found ${transactions.length} pending transactions for ${merchantId}`
    );
    return transactions;
  } catch (e: any) {
    console.error('[Dashboard] Error getting pending transactions:', e);
    throw e;
  }
}

/**
 * Get recent settlement status
 * Returns transactions that have been settled recently
 */
export async function getRecentSettlements(
  merchantId: string,
  terminalId?: string,
  limit: number = 50,
  hoursBack: number = 24
): Promise<SettlementStatus[]> {
  try {
    let query = `
      SELECT
        ts.id,
        ts.transaction_id,
        ts.gross_amount,
        ts.fee_amount,
        ts.net_amount,
        ts.status,
        ts.hold_reason,
        ts.settled_at,
        ts.created_at,
        t.pan,
        t.amount,
        t.terminal_id
      FROM transaction_settlements ts
      JOIN pos2013_transactions t ON ts.transaction_id = t.id
      WHERE ts.merchant_id = ?
        AND ts.created_at >= datetime('now', '-${hoursBack} hours')
    `;

    const params: any[] = [merchantId];

    if (terminalId) {
      query += ` AND t.terminal_id = ?`;
      params.push(terminalId);
    }

    query += ` ORDER BY ts.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = await db.query(query, params);

    const settlements: SettlementStatus[] = (result.rows || []).map((s: any) => ({
      transactionId: s.transaction_id,
      pan: s.pan,
      amount: Number(s.amount),
      status: s.status,
      grossAmount: Number(s.gross_amount),
      feeAmount: Number(s.fee_amount),
      netAmount: Number(s.net_amount),
      holdReason: s.hold_reason,
      settledAt: s.settled_at,
      createdAt: s.created_at,
    }));

    console.log(
      `[Dashboard] Found ${settlements.length} recent settlements for ${merchantId}`
    );
    return settlements;
  } catch (e: any) {
    console.error('[Dashboard] Error getting recent settlements:', e);
    throw e;
  }
}

/**
 * Get dashboard summary
 * Aggregated metrics for the dashboard
 */
export async function getDashboardSummary(
  merchantId: string,
  terminalId?: string
): Promise<DashboardSummary> {
  try {
    // Pending transactions
    const pending = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount_minor), 0) / 100.0 as total
       FROM pos2013_transactions
       WHERE merchant_id = ? AND UPPER(status) IN ('PENDING_CAPTURE', 'CAPTURE_FAILED', 'PENDING')
         ${terminalId ? 'AND terminal_id = ?' : ''}
       `,
      terminalId ? [merchantId, terminalId] : [merchantId]
    );

    const pendingCount = Number((pending.rows?.[0] as any)?.count || 0);
    const pendingAmount = Number((pending.rows?.[0] as any)?.total || 0);

    // Settled transactions
    const settled = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(net_amount), 0) as total
       FROM transaction_settlements
       WHERE merchant_id = ? AND status = 'SETTLED'
         ${terminalId ? 'AND id IN (SELECT id FROM pos2013_transactions WHERE terminal_id = ?)' : ''}`,
      terminalId ? [merchantId, terminalId] : [merchantId]
    );

    const settledCount = Number((settled.rows?.[0] as any)?.count || 0);
    const settledAmount = Number((settled.rows?.[0] as any)?.total || 0);

    // Held settlements
    const held = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(net_amount), 0) as total
       FROM transaction_settlements
       WHERE merchant_id = ? AND status = 'HELD'`,
      [merchantId]
    );

    const heldCount = Number((held.rows?.[0] as any)?.count || 0);
    const heldAmount = Number((held.rows?.[0] as any)?.total || 0);

    // Reversed settlements
    const reversed = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(net_amount), 0) as total
       FROM transaction_settlements
       WHERE merchant_id = ? AND status = 'REVERSED'`,
      [merchantId]
    );

    const reversedCount = Number((reversed.rows?.[0] as any)?.count || 0);
    const reversedAmount = Number((reversed.rows?.[0] as any)?.total || 0);

    // Failed settlements
    const failed = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(net_amount), 0) as total
       FROM transaction_settlements
       WHERE merchant_id = ? AND status = 'FAILED'`,
      [merchantId]
    );

    const failedCount = Number((failed.rows?.[0] as any)?.count || 0);
    const failedAmount = Number((failed.rows?.[0] as any)?.total || 0);

    // Fee amount
    const fees = await db.query(
      `SELECT COALESCE(SUM(fee_amount), 0) as total
       FROM transaction_settlements
       WHERE merchant_id = ?`,
      [merchantId]
    );

    const feeAmount = Number((fees.rows?.[0] as any)?.total || 0);

    // Reconciliation rate
    const reconCount = await db.query(
      `SELECT COUNT(*) as count FROM reconciliation_reports
       WHERE merchant_id = ? AND created_at >= datetime('now', '-1 day')`,
      [merchantId]
    );

    const reconciledToday = Number((reconCount.rows?.[0] as any)?.count || 0);

    // Total transactions today
    const totalToday = await db.query(
      `SELECT COUNT(*) as count FROM pos2013_transactions
       WHERE merchant_id = ? AND created_at >= datetime('now', '-1 day')`,
      [merchantId]
    );

    const totalTodayCount = Number((totalToday.rows?.[0] as any)?.count || 0);
    const failedReconToday = totalTodayCount - reconciledToday;

    const summary: DashboardSummary = {
      totalPending: pendingCount,
      totalPendingAmount: pendingAmount,
      totalSettled: settledCount,
      totalSettledAmount: settledAmount,
      totalHeld: heldCount,
      totalHeldAmount: heldAmount,
      totalReversed: reversedCount,
      totalReversedAmount: reversedAmount,
      totalFailed: failedCount,
      totalFailedAmount: failedAmount,
      totalFeeAmount: feeAmount,
      reconciliationRate:
        totalTodayCount > 0 ? (reconciledToday / totalTodayCount) * 100 : 0,
      settlementRate: settledCount > 0 ? (settledCount / (settledCount + pendingCount || 1)) * 100 : 0,
      costOfDoing: pendingAmount > 0 ? (feeAmount / pendingAmount) * 100 : 0,
    };

    console.log(`[Dashboard] Summary: pending=${pendingCount}, settled=${settledCount}`);
    return summary;
  } catch (e: any) {
    console.error('[Dashboard] Error getting summary:', e);
    throw e;
  }
}

/**
 * Get conflict metrics
 */
export async function getConflictMetrics(merchantId: string): Promise<any> {
  try {
    const duplicates = await db.query(
      `SELECT COUNT(*) as count FROM conflict_resolutions
       WHERE merchant_id = ? AND conflict_type = 'DUPLICATE'`,
      [merchantId]
    );

    const reversals = await db.query(
      `SELECT COUNT(*) as count FROM settlement_reversals
       WHERE settlement_id IN (
         SELECT id FROM transaction_settlements WHERE merchant_id = ?
       )`,
      [merchantId]
    );

    const syncs = await db.query(
      `SELECT COUNT(*) as count FROM failed_syncs
       WHERE merchant_id = ? AND status = 'SUCCESS'`,
      [merchantId]
    );

    return {
      duplicatesDetected: Number((duplicates.rows?.[0] as any)?.count || 0),
      duplicatesMerged: Number((duplicates.rows?.[0] as any)?.count || 0),
      reversalsProcessed: Number((reversals.rows?.[0] as any)?.count || 0),
      failedSyncsRetried: Number((syncs.rows?.[0] as any)?.count || 0),
    };
  } catch (e: any) {
    console.error('[Dashboard] Error getting conflict metrics:', e);
    return {
      duplicatesDetected: 0,
      duplicatesMerged: 0,
      reversalsProcessed: 0,
      failedSyncsRetried: 0,
    };
  }
}

/**
 * Get complete dashboard data
 * Comprehensive real-time status snapshot
 */
export async function getDashboardData(
  merchantId: string,
  terminalId?: string
): Promise<DashboardData> {
  try {
    console.log(`[Dashboard] Generating dashboard data for ${merchantId}`);

    const [summary, pending, settlements, conflicts] = await Promise.all([
      getDashboardSummary(merchantId, terminalId),
      getPendingTransactions(merchantId, terminalId, 100),
      getRecentSettlements(merchantId, terminalId, 50, 24),
      getConflictMetrics(merchantId),
    ]);

    // Reconciliation today
    const reconToday = await db.query(
      `SELECT COUNT(*) as count FROM reconciliation_reports
       WHERE merchant_id = ? AND created_at >= datetime('now', '-1 day')`,
      [merchantId]
    );

    const reconciledToday = Number((reconToday.rows?.[0] as any)?.count || 0);

    // Transactions today
    const txnToday = await db.query(
      `SELECT COUNT(*) as count FROM pos2013_transactions
       WHERE merchant_id = ? AND created_at >= datetime('now', '-1 day')`,
      [merchantId]
    );

    const totalToday = Number((txnToday.rows?.[0] as any)?.count || 0);
    const failedToday = totalToday - reconciledToday;

    const dashboard: DashboardData = {
      merchantId,
      terminalId,
      summary,
      pendingTransactions: pending,
      recentSettlements: settlements,
      conflictMetrics: conflicts,
      reconciledToday,
      failedToReconcileToday: failedToday,
      lastUpdated: new Date().toISOString(),
    };

    console.log(`[Dashboard] Dashboard generated successfully`);
    return dashboard;
  } catch (e: any) {
    console.error('[Dashboard] Error generating dashboard data:', e);
    throw e;
  }
}

/**
 * Broadcast dashboard update via WebSocket
 * Called when significant status changes occur
 */
export async function broadcastDashboardUpdate(
  merchantId: string,
  eventType: string,
  details: any
): Promise<void> {
  try {
    // Get WebSocket server from global context
    const getWsServer = (global as any).getWsServer;
    if (!getWsServer) {
      console.warn('[Dashboard] WebSocket server not available for broadcast');
      return;
    }

    const wsServer = getWsServer();
    if (!wsServer) {
      console.warn('[Dashboard] WebSocket server not initialized');
      return;
    }

    const payload = {
      type: 'DASHBOARD_UPDATE',
      event: eventType,
      merchantId,
      timestamp: new Date().toISOString(),
      details,
    };

    console.log(`[Dashboard] Broadcasting update: event=${eventType}, merchant=${merchantId}`);

    // Broadcast to all connected clients for this merchant
    wsServer.clients.forEach((client: any) => {
      if (client.readyState === 1 && client.merchantId === merchantId) {
        try {
          client.send(JSON.stringify(payload));
        } catch (e) {
          console.error('[Dashboard] Error sending WebSocket message:', e);
        }
      }
    });
  } catch (e: any) {
    console.error('[Dashboard] Error broadcasting dashboard update:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending card captures that must not be treated as available wallet funds.
// ─────────────────────────────────────────────────────────────────────────────

export interface UnprocessedSummary {
  totalTransactions: number;
  byCurrency: { currency: string; count: number; totalAmount: number }[];
  oldestTransactionAt: string | null;
  newestTransactionAt: string | null;
}

export async function getUnprocessedSummary(merchantId?: string): Promise<UnprocessedSummary> {
  const whereClause = merchantId ? `WHERE t.merchant_id = ? AND` : `WHERE`;
  const params: any[] = merchantId ? [merchantId] : [];

  const byCurrency = await db.query(
    `SELECT
       t.currency,
       COUNT(*) as count,
       ROUND(SUM(t.amount_minor) / 100.0, 2) as total_amount
     FROM pos2013_transactions t
     ${whereClause}
       UPPER(t.status) IN ('PENDING_CAPTURE', 'CAPTURE_FAILED')
     GROUP BY t.currency
     ORDER BY total_amount DESC`,
    params
  );

  const totals = await db.query(
    `SELECT
       COUNT(*) as count,
       MIN(t.created_at) as oldest,
       MAX(t.created_at) as newest
     FROM pos2013_transactions t
     ${whereClause}
       UPPER(t.status) IN ('PENDING_CAPTURE', 'CAPTURE_FAILED')`,
    params
  );

  const row = totals.rows[0] as any;
  return {
    totalTransactions: Number(row?.count || 0),
    byCurrency: (byCurrency.rows || []).map((r: any) => ({
      currency: r.currency,
      count: Number(r.count),
      totalAmount: Number(r.total_amount),
    })),
    oldestTransactionAt: row?.oldest || null,
    newestTransactionAt: row?.newest || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS ALL UNPROCESSED TRANSACTIONS
// Credits the total unprocessed amount to the merchant wallet and marks
// all matching transactions + batches as PROCESSED.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessResult {
  success: boolean;
  merchantId: string;
  transactionsProcessed: number;
  totalAmountCredited: number;
  currency: string;
  settlementCode: string;
  walletBalanceAfter: number;
  cryptoCredited: number;
  message: string;
}

export async function processUnprocessedTransactions(merchantId: string): Promise<ProcessResult> {
  void merchantId;
  throw new Error(
    'LIVE_PROCESSOR_REQUIRED: wallet credits cannot be created by manually processing POS transactions. Wait for a confirmed processor capture or signed bank settlement.',
  );
}