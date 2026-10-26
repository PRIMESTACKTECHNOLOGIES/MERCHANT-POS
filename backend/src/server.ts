import dotenv from "dotenv";
dotenv.config({ path: require('path').join(__dirname, '..', '.env') });

import fs from "fs";
import path from "path";
import http from "http";
import { app } from "./app";
import { initTables } from "./domain/setup/init_tables";
import { initWsServer } from "./realtime/wsServer";
import { startDeferredBroadcastWorker, stopDeferredBroadcastWorker } from "./workers/deferredBroadcast.worker";
import { flushDbAsync, db } from "./config/db";
import { startVaultReconciliationWorker, stopVaultReconciliationWorker } from "./workers/vaultReconciliation.worker";
import { startVaultLiquidityWorker, stopVaultLiquidityWorker } from "./workers/vaultLiquidity.worker";
import { ensureOperatorCards } from "./domain/vault/cardBalance.service";
import { customerAuthService } from "./domain/customerauth/customer-auth.service";

const PORT = parseInt(
  (process.env.PORT_OVERRIDE || process.env.PORT || '7000').toString(),
  10,
);

// Ensure the SQLite data directory exists — use same path logic as db.ts
const dbPath = process.env.DATABASE_PATH?.trim()
  ? path.resolve(process.env.DATABASE_PATH.trim())
  : path.join(__dirname, '..', 'data', 'database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
console.log('[server] DB path:', dbPath);

const start = async () => {
  await initTables();

  // Repair the wallet-to-bank payout table. `CREATE TABLE IF NOT EXISTS` cannot add
  // columns to a database whose `bank_payouts` was created from an older shape, and
  // the payout path writes fee / net_amount / merchant_id / provider / provider_ref —
  // without them the endpoint answers 500 "no column named fee".
  for (const _bpCol of [
    `ALTER TABLE bank_payouts ADD COLUMN fee REAL DEFAULT 0.00`,
    `ALTER TABLE bank_payouts ADD COLUMN net_amount REAL`,
    `ALTER TABLE bank_payouts ADD COLUMN merchant_id TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN note TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN provider TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN provider_ref TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN scheduled_at TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN completed_at TEXT`,
    `ALTER TABLE bank_payouts ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`,
  ]) {
    try { await db.query(_bpCol); } catch (_e) { /* column already present */ }
  }

  // Issue a portal PIN to every customer that does not have one yet.
  try {
    const issued = await customerAuthService.ensureAllCustomerPins();
    if (issued > 0) console.log(`[Auth] Issued portal PINs to ${issued} customer(s)`);
  } catch (e: any) {
    console.error('[Auth] ensureAllCustomerPins failed:', e?.message || e);
  }
  // Ensure operator card balance rows exist as ZERO-balance rows only.
  // Nothing is ever seeded — real money arrives only via a verified rail.
  try {
    await ensureOperatorCards();
  } catch (e: any) {
    console.error('[server] ensureOperatorCards failed:', e?.message || e);
  }
  const server = http.createServer(app);
  initWsServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log("Server running on port", PORT);
  });

  // ── Keep-alive ping: prevents Render free tier from sleeping ─────────────
  // Pings own /health endpoint every 14 minutes (Render sleeps after 15 min)
  const SELF_URL = process.env.RENDER_EXTERNAL_URL?.trim()
    || process.env.BACKEND_URL?.trim()
    || `http://localhost:${PORT}`;
  if (process.env.NODE_ENV === 'production') {
    setInterval(async () => {
      try {
        const https = await import('https');
        const http2 = await import('http');
        const url = new URL(`${SELF_URL}/health`);
        const client = url.protocol === 'https:' ? https : http2;
        client.get(url.toString(), (res) => {
          console.log(`[KeepAlive] ping ${SELF_URL}/health → ${res.statusCode}`);
        }).on('error', () => {});
      } catch { /* non-fatal */ }
    }, 14 * 60 * 1000); // every 14 minutes
    console.log(`[KeepAlive] Self-ping enabled → ${SELF_URL}/health every 14 min`);
  }
  // Start deferred broadcast retry daemon
  startDeferredBroadcastWorker();
  startVaultReconciliationWorker();
  startVaultLiquidityWorker();

  // Graceful shutdown
  const shutdown = async () => {
    stopDeferredBroadcastWorker();
    stopVaultReconciliationWorker();
    stopVaultLiquidityWorker();
    await flushDbAsync();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

start();
