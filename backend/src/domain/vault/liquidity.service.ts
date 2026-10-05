import { db } from '../../config/db';
import { vaultEngine } from './vault.service';
import { appendVaultAudit } from './audit.service';
import { calculateVaultLiquidity, type VaultLiquidity } from './liquidity-calculator';

export type { LiquidityStatus, VaultLiquidity } from './liquidity-calculator';

export async function getVaultLiquidity(currency = 'EUR'): Promise<VaultLiquidity> {
  const normalizedCurrency = currency.toUpperCase();
  const [vaultBalance, reserve, payouts] = await Promise.all([
    vaultEngine.getVaultBalance(normalizedCurrency),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM vault_reserve WHERE currency = ? AND status = 'ACTIVE'`, [normalizedCurrency]),
    db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payout_instructions WHERE currency = ? AND status IN ('QUEUED', 'PROCESSING')`, [normalizedCurrency]),
  ]);
  const output = calculateVaultLiquidity({
    currency: normalizedCurrency,
    vaultBalance: Number(vaultBalance),
    reserve: Number(reserve.rows?.[0]?.total || 0),
    pendingPayouts: Number(payouts.rows?.[0]?.total || 0),
  });
  await appendVaultAudit({
    actor: 'system',
    event: 'LIQUIDITY_CHECK',
    currency: normalizedCurrency,
    before: {},
    after: output,
  });
  return output;
}

export async function logVaultLiquidity(liquidity: VaultLiquidity): Promise<void> {
  await db.query(
    `INSERT INTO vault_liquidity_log
      (ts, currency, vault_balance, reserve, pending_payouts, risk_buffer, liquidity, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      liquidity.currency,
      liquidity.vaultBalance,
      liquidity.reserve,
      liquidity.pendingPayouts,
      liquidity.riskBuffer,
      liquidity.liquidity,
      liquidity.status,
    ]
  );
}

export async function listVaultLiquidityLog(currency = 'EUR') {
  const result = await db.query(
    `SELECT ts, currency, vault_balance AS vaultBalance, reserve,
            pending_payouts AS pendingPayouts, risk_buffer AS riskBuffer,
            liquidity, status
       FROM vault_liquidity_log
      WHERE currency = ?
      ORDER BY ts DESC
      LIMIT 100`,
    [currency.toUpperCase()]
  );
  return (result.rows || []).map((row: any) => ({
    ...row,
    vaultBalance: Number(row.vaultBalance),
    reserve: Number(row.reserve),
    pendingPayouts: Number(row.pendingPayouts),
    riskBuffer: Number(row.riskBuffer),
    liquidity: Number(row.liquidity),
  }));
}
