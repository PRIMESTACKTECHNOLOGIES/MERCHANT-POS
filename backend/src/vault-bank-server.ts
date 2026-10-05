import dotenv from 'dotenv';
dotenv.config();

import { initTables } from './domain/setup/init_tables';
import { flushDb } from './config/db';
import { startVaultPrivateServer } from './domain/vault/gateway/private-server';

async function start() {
  await initTables();
  const server = startVaultPrivateServer();
  const shutdown = () => {
    flushDb();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('[VaultBank] Failed to start:', error);
  process.exitCode = 1;
});
