import { getVaultLiquidity, logVaultLiquidity } from '../domain/vault/liquidity.service';

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const liquidity = await getVaultLiquidity(process.env.VAULT_LIQUIDITY_CURRENCY || 'EUR');
    await logVaultLiquidity(liquidity);
    console.log(`[VaultLiquidity] ${liquidity.currency} ${liquidity.status}: liquidity=${liquidity.liquidity}`);
  } catch (error) {
    console.error('[VaultLiquidity] Check failed:', error);
  }
}

export function startVaultLiquidityWorker(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => { void tick(); }, 5 * 60 * 1000);
}

export function stopVaultLiquidityWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
