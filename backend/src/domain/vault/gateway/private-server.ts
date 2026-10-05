import express from 'express';
import http from 'http';
import vaultGatewayRouter from './vault-gateway.router';

export function startVaultPrivateServer() {
  const port = Number(process.env.VAULT_BANK_PORT || 9001);
  const host = (process.env.VAULT_BANK_BIND_HOST || '127.0.0.1').trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid VAULT_BANK_PORT: ${process.env.VAULT_BANK_PORT}`);
  }
  if (!host) throw new Error('VAULT_BANK_BIND_HOST must not be empty');

  const gateway = express();
  gateway.disable('x-powered-by');
  gateway.use(express.json({ limit: '1mb' }));
  gateway.get('/health', (_req, res) => res.json({ status: 'ok', service: 'vault-bank', port: port }));
  gateway.use('/api/vault', vaultGatewayRouter);
  gateway.use('/api/vault-bank', vaultGatewayRouter);

  const server = http.createServer(gateway);
  server.listen(port, host, () => {
    console.log(`Private Vault Bank API running at http://${host}:${port}`);
  });
  return server;
}
