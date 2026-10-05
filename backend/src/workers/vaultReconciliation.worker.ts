import { reconcileVault, logVaultReconciliation } from '../domain/vault/reconciliation.service';

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDate = '';

async function runIfDue(): Promise<void> {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (now.getHours() !== 2 || now.getMinutes() !== 0 || lastRunDate === date) return;
  lastRunDate = date;
  try {
    const result = await reconcileVault(process.env.VAULT_RECONCILIATION_CURRENCY || 'EUR');
    await logVaultReconciliation(result);
    console.log(`[VaultReconciliation] ${result.currency} ${result.reconStatus}: difference=${result.difference}`);
  } catch (error) {
    lastRunDate = '';
    console.error('[VaultReconciliation] Daily reconciliation failed:', error);
  }
}

export function startVaultReconciliationWorker(): void {
  if (timer) return;
  void runIfDue();
  timer = setInterval(() => { void runIfDue(); }, 60_000);
}

export function stopVaultReconciliationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
