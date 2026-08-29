import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import http from "http";
import { app } from "./app";
import { initTables } from "./domain/setup/init_tables";
import { initWsServer } from "./realtime/wsServer";
import { startDeferredBroadcastWorker, stopDeferredBroadcastWorker } from "./workers/deferredBroadcast.worker";
import { flushDb } from "./config/db";
import { invoiceReceiptService } from "./domain/receipts/invoice-receipt.service";

const PORT = parseInt(process.env.PORT || '7000');

// Ensure the SQLite data directory exists (needed when DATABASE_PATH is set)
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const start = async () => {
  await initTables();
  const backfill = await invoiceReceiptService.backfillExisting();
  console.log(`[DOCUMENTS] Invoice/receipt backfill complete: ${backfill.created} created, ${backfill.existing} already present`);
  const server = http.createServer(app);
  initWsServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log("Server running on port", PORT);
  });

  // Start deferred broadcast retry daemon
  startDeferredBroadcastWorker();

  // Graceful shutdown
  const shutdown = () => {
    stopDeferredBroadcastWorker();
    flushDb();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

start();
