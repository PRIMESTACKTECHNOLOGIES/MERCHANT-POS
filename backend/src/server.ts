import dotenv from "dotenv";
dotenv.config({ path: require('path').join(__dirname, '..', '.env') });

import fs from "fs";
import path from "path";
import http from "http";
import { app } from "./app";
import { initTables } from "./domain/setup/init_tables";
import { ensureVoiceAuth101Schema } from "./domain/payments/voiceAuth.service";
import { initWsServer } from "./realtime/wsServer";
import { startDeferredBroadcastWorker, stopDeferredBroadcastWorker } from "./workers/deferredBroadcast.worker";
import { flushDb } from "./config/db";
import { startVaultReconciliationWorker, stopVaultReconciliationWorker } from "./workers/vaultReconciliation.worker";
import { startVaultLiquidityWorker, stopVaultLiquidityWorker } from "./workers/vaultLiquidity.worker";
import { applyProviderConfigToEnv } from "./domain/treasury/providerConfig.store";
import { invoiceReceiptService } from "./domain/receipts/invoice-receipt.service";

const PORT = parseInt(process.env.PORT || '7000');

// Ensure the SQLite data directory exists (needed when DATABASE_PATH is set,
// e.g. the Render persistent disk mounted at /app/data).
const configuredDbPath = process.env.DATABASE_PATH?.trim();
const dbPath = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(__dirname, '..', 'data', 'database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const start = async () => {
  await initTables();
  await ensureVoiceAuth101Schema();
  // Load any credentials entered in the Treasury UI so they override the env.
  await applyProviderConfigToEnv();
  // Guarantee every recorded transaction (POS, wallet ledger, transfers, crypto,
  // payouts) has its own receipt document. Idempotent — safe on every boot.
  try {
    const receiptBackfill = await invoiceReceiptService.backfillExisting();
    console.log(`Receipt ledger reconciled: ${receiptBackfill.created} created, ${receiptBackfill.existing} already present`);
  } catch (e: any) {
    console.warn('Receipt ledger reconciliation failed (non-fatal):', e?.message);
  }
  const server = http.createServer(app);
  initWsServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log("Server running on port", PORT);
  });
  // Start deferred broadcast retry daemon
  startDeferredBroadcastWorker();
  startVaultReconciliationWorker();
  startVaultLiquidityWorker();

  // Graceful shutdown
  const shutdown = () => {
    stopDeferredBroadcastWorker();
    stopVaultReconciliationWorker();
    stopVaultLiquidityWorker();
    flushDb();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

start();
