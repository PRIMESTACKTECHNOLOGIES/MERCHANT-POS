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
        t.pan,
        t.amount,
        t.status,
        t.terminal_id,
        t.created_at,
        t.auth_at as approved_at
      FROM pos2013_transactions t
      LEFT JOIN reconciliation_discrepancies rd ON t.id = rd.offline_txn_id
      WHERE t.merchant_id = ?
        AND t.status IN ('approved', 'pending')
        AND t.id NOT IN (
          SELECT transaction_id FROM transaction_settlements
          WHERE status IN ('SETTLED', 'REVERSED')
        )
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
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM pos2013_transactions
       WHERE merchant_id = ? AND status IN ('approved', 'pending')
         ${terminalId ? 'AND terminal_id = ?' : ''}
         AND id NOT IN (
           SELECT transaction_id FROM transaction_settlements
           WHERE status IN ('SETTLED', 'REVERSED')
         )`,
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
// UNPROCESSED TRANSACTIONS SUMMARY
// Returns the $46k+ sitting in pos2013_transactions that has never been
// credited to any merchant wallet (no processed batch, no wallet credit).
// ─────────────────────────────────────────────────────────────────────────────

export interface UnprocessedSummary {
  totalTransactions: number;
  totalAmountUSD: number;
  byCurrency: { currency: string; count: number; totalUSD: number }[];
  oldestTransactionAt: string | null;
  newestTransactionAt: string | null;
}

export async function getUnprocessedSummary(merchantId?: string): Promise<UnprocessedSummary> {
  // Transactions that were never credited to a merchant wallet:
  // - batch status != PROCESSED  OR no batch row at all
  // - AND transaction not in any settled merchant_pos_settlement
  const whereClause = merchantId ? `WHERE t.merchant_id = ?` : '';
  const params: any[] = merchantId ? [merchantId] : [];

  const byCurrency = await db.query(
    `SELECT
       t.currency,
       COUNT(*) as count,
       ROUND(SUM(t.amount_minor) / 100.0, 2) as total_usd
     FROM pos2013_transactions t
     LEFT JOIN pos2013_batches b ON b.batch_id = t.batch_id
       AND b.merchant_id = t.merchant_id
     ${whereClause}
     AND (b.status IS NULL OR b.status != 'PROCESSED')
     GROUP BY t.currency
     ORDER BY total_usd DESC`,
    params
  );

  const totals = await db.query(
    `SELECT
       COUNT(*) as count,
       ROUND(SUM(t.amount_minor) / 100.0, 2) as total_usd,
       MIN(t.created_at) as oldest,
       MAX(t.created_at) as newest
     FROM pos2013_transactions t
     LEFT JOIN pos2013_batches b ON b.batch_id = t.batch_id
       AND b.merchant_id = t.merchant_id
     ${whereClause}
     AND (b.status IS NULL OR b.status != 'PROCESSED')`,
    params
  );

  const row = totals.rows[0] as any;
  return {
    totalTransactions: Number(row?.count || 0),
    totalAmountUSD: Number(row?.total_usd || 0),
    byCurrency: (byCurrency.rows || []).map((r: any) => ({
      currency: r.currency,
      count: Number(r.count),
      totalUSD: Number(r.total_usd),
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
  throw new Error(
    'LIVE_PROCESSOR_REQUIRED: dashboard batch settlement is disabled. Upload a signed Protocol 201.3 batch so each transaction is authorized and captured by the live processor before wallet settlement.'
  );

  const { v4: uuidv4 } = await import('uuid');

  // 1. Get all unprocessed transactions for this merchant
  const txnRes = await db.query(
    `SELECT t.id, t.amount_minor, t.currency, t.batch_id
     FROM pos2013_transactions t
     LEFT JOIN pos2013_batches b ON b.batch_id = t.batch_id
       AND b.merchant_id = t.merchant_id
     WHERE t.merchant_id = ?
       AND (b.status IS NULL OR b.status != 'PROCESSED')`,
    [merchantId]
  );

  const transactions = txnRes.rows as any[];
  if (transactions.length === 0) {
    return {
      success: false,
      merchantId,
      transactionsProcessed: 0,
      totalAmountCredited: 0,
      currency: 'USD',
      settlementCode: '',
      walletBalanceAfter: 0,
      cryptoCredited: 0,
      message: 'No unprocessed transactions found.',
    };
  }

  // 2. Sum all amounts (treat all as USD equivalent)
  const totalMinor = transactions.reduce((s: number, t: any) => s + Number(t.amount_minor || 0), 0);
  const totalUSD = totalMinor / 100;
  const settlementCode = `SETTLE-${Date.now()}`;
  const now = new Date().toISOString();

  // 3. Credit merchant wallet (virtual USD)
  const walletRes = await db.query(
    'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?',
    [merchantId, 'USD']
  );
  let wallet = walletRes.rows[0] as any;
  if (!wallet) {
    const wid = uuidv4();
    await db.query(
      'INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, ?)',
      [wid, merchantId, 'USD']
    );
    wallet = (await db.query('SELECT * FROM merchant_wallets WHERE id = ?', [wid])).rows[0] as any;
  }

  await db.query(
    'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
    [totalUSD, now, wallet.id]
  );

  await db.query(
    `INSERT INTO merchant_wallet_transactions
     (id, wallet_id, type, amount, currency, source, reference, description)
     VALUES (?, ?, 'credit', ?, 'USD', 'batch_settlement', ?, ?)`,
    [uuidv4(), wallet.id, totalUSD, settlementCode,
     `Batch settlement: ${transactions.length} transactions processed`]
  );

  // 4. Auto-credit USDT crypto balance (1:1 USD = USDT)
  const cryptoRes = await db.query(
    'SELECT * FROM customer_crypto_wallets WHERE customer_id = ? AND crypto_coin = ?',
    [merchantId, 'USDT']
  );
  if (cryptoRes.rows.length > 0) {
    await db.query(
      'UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND crypto_coin = ?',
      [totalUSD, merchantId, 'USDT']
    );
  } else {
    await db.query(
      'INSERT INTO customer_crypto_wallets (id, customer_id, crypto_coin, balance, status) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), merchantId, 'USDT', totalUSD, 'active']
    );
  }

  // 5. Mark transactions SYNCED
  const txnIds = transactions.map((t: any) => t.id);
  for (const id of txnIds) {
    await db.query(
      `UPDATE pos2013_transactions SET status = 'SYNCED', auth_code = ? WHERE id = ?`,
      [settlementCode, id]
    );
  }

  // 6. Mark all related batches PROCESSED
  const batchIds = [...new Set(transactions.map((t: any) => t.batch_id).filter(Boolean))];
  for (const bid of batchIds) {
    await db.query(
      `UPDATE pos2013_batches SET status = 'PROCESSED', settlement_code = ?, processed_at = ?, updated_at = ?
       WHERE batch_id = ? AND merchant_id = ?`,
      [settlementCode, now, now, bid, merchantId]
    );
  }

  // 7. Record merchant_pos_settlements as settled
  await db.query(
    `UPDATE merchant_pos_settlements SET status = 'settled', settled_at = ?, updated_at = ?
     WHERE merchant_id = ? AND status = 'unsettled'`,
    [now, now, merchantId]
  );

  const walletAfter = (await db.query(
    'SELECT balance FROM merchant_wallets WHERE id = ?', [wallet.id]
  )).rows[0] as any;

  return {
    success: true,
    merchantId,
    transactionsProcessed: transactions.length,
    totalAmountCredited: totalUSD,
    currency: 'USD',
    settlementCode,
    walletBalanceAfter: Number(walletAfter?.balance || totalUSD),
    cryptoCredited: totalUSD,
    message: `${transactions.length} transactions totalling $${totalUSD.toFixed(2)} credited to merchant wallet and USDT balance.`,
  };
}
