import { db } from '../../config/db';
import { vaultEngine } from './vault.service';
import { appendVaultAudit } from './audit.service';

export type ReconciliationStatus = 'OK' | 'MISMATCH';

export interface VaultReconciliation {
  currency: string;
  vaultBalance: number;
  merchantLiabilities: number;
  pendingSettlement: number;
  pendingPayouts: number;
  reserve: number;
  adjustments: number;
  expected: number;
  reconStatus: ReconciliationStatus;
  difference: number;
}

export async function reconcileVault(currency = 'EUR'): Promise<VaultReconciliation> {
  const normalizedCurrency = currency.toUpperCase();
  const [vaultBalance, merchants, settlements, payouts, reserve, adjustments] = await Promise.all([
    vaultEngine.getVaultBalance(normalizedCurrency),
    db.query('SELECT COALESCE(SUM(balance), 0) AS total FROM merchant_wallets WHERE currency = ?', [normalizedCurrency]),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM batch_settlement WHERE currency = ? AND status = 'PENDING'`, [normalizedCurrency]),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payout_instructions WHERE currency = ? AND status IN ('QUEUED', 'PROCESSING')`, [normalizedCurrency]),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM vault_reserve WHERE currency = ? AND status = 'ACTIVE'`, [normalizedCurrency]),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM vault_ledger WHERE currency = ? AND type = 'ADJUSTMENT' AND status = 'COMPLETED'`, [normalizedCurrency]),
  ]);

  const result = {
    currency: normalizedCurrency,
    vaultBalance,
    merchantLiabilities: Number(merchants.rows?.[0]?.total || 0),
    pendingSettlement: Number(settlements.rows?.[0]?.total || 0),
    pendingPayouts: Number(payouts.rows?.[0]?.total || 0),
    reserve: Number(reserve.rows?.[0]?.total || 0),
    adjustments: Number(adjustments.rows?.[0]?.total || 0),
  };
  const expected = result.merchantLiabilities + result.pendingSettlement + result.pendingPayouts + result.reserve + result.adjustments;
  const difference = result.vaultBalance - expected;
  const output: VaultReconciliation = {
    ...result,
    expected,
    difference,
    reconStatus: (Math.abs(difference) < 0.01 ? 'OK' : 'MISMATCH') as ReconciliationStatus,
  };
  await appendVaultAudit({
    actor: 'system',
    event: 'RECON_CHECK',
    currency: normalizedCurrency,
    before: {},
    after: output,
  });
  return output;
}

export async function logVaultReconciliation(reconciliation: VaultReconciliation): Promise<void> {
  await db.query(
    `INSERT INTO vault_reconciliation_log
      (ts, currency, status, vault_balance, expected, difference,
       merchant_liabilities, pending_settlement, pending_payouts, reserve, adjustments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      reconciliation.currency,
      reconciliation.reconStatus,
      reconciliation.vaultBalance,
      reconciliation.expected,
      reconciliation.difference,
      reconciliation.merchantLiabilities,
      reconciliation.pendingSettlement,
      reconciliation.pendingPayouts,
      reconciliation.reserve,
      reconciliation.adjustments,
    ]
  );
}
