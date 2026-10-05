export type LiquidityStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface VaultLiquidity {
  currency: string;
  vaultBalance: number;
  reserve: number;
  pendingPayouts: number;
  riskBuffer: number;
  liquidity: number;
  status: LiquidityStatus;
}

export function calculateVaultLiquidity(input: {
  currency: string;
  vaultBalance: number;
  reserve: number;
  pendingPayouts: number;
}): VaultLiquidity {
  const currency = input.currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Currency must be a three-letter ISO code');
  }
  for (const [name, value] of Object.entries({
    vaultBalance: input.vaultBalance,
    reserve: input.reserve,
    pendingPayouts: input.pendingPayouts,
  })) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  }
  if (input.reserve < 0 || input.pendingPayouts < 0) {
    throw new Error('Reserve and pending payouts must not be negative');
  }

  const riskBuffer = Math.max(input.vaultBalance, 0) * 0.1;
  const liquidity = input.vaultBalance - input.reserve - input.pendingPayouts - riskBuffer;
  const status: LiquidityStatus = liquidity < 0
    ? 'CRITICAL'
    : liquidity < input.vaultBalance * 0.05
      ? 'WARNING'
      : 'HEALTHY';

  return {
    currency,
    vaultBalance: input.vaultBalance,
    reserve: input.reserve,
    pendingPayouts: input.pendingPayouts,
    riskBuffer,
    liquidity,
    status,
  };
}
