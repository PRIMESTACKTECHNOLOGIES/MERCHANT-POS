import express from 'express';
import fs from 'fs';
import https from 'https';
import path from 'path';
import vaultGatewayRouter from './vault-gateway.router';

function requiredPath(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!fs.existsSync(value)) {
    throw new Error(`Vault mTLS is enabled but ${name} was not found: ${value}`);
  }
  return value;
}

export function startVaultMtlsServer() {
  const certDir = process.env.VAULT_MTLS_CERT_DIR?.trim() || path.join(process.cwd(), 'certs');
  const options: https.ServerOptions = {
    key: fs.readFileSync(requiredPath('VAULT_MTLS_KEY_PATH', path.join(certDir, 'vault-server.key'))),
    cert: fs.readFileSync(requiredPath('VAULT_MTLS_CERT_PATH', path.join(certDir, 'vault-server.crt'))),
    ca: fs.readFileSync(requiredPath('VAULT_MTLS_CA_PATH', path.join(certDir, 'ca.crt'))),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  };
  const gateway = express();
  gateway.disable('x-powered-by');
  gateway.use(express.json({ limit: '1mb' }));
  gateway.use('/api/vault', vaultGatewayRouter);
  gateway.use('/api/vault-bank', vaultGatewayRouter);

  const port = Number(process.env.VAULT_MTLS_PORT || 9443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid VAULT_MTLS_PORT: ${process.env.VAULT_MTLS_PORT}`);
  }
  const server = https.createServer(options, gateway);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Vault Bank API Gateway (mTLS) running on port ${port}`);
  });
  return server;
}
