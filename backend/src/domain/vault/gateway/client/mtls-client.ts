import fs from 'fs';
import https from 'https';
import path from 'path';

export interface VaultMtlsRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface VaultMtlsResponse<T = unknown> {
  statusCode: number;
  body: T;
}

function requiredPath(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!fs.existsSync(value)) {
    throw new Error(`Vault mTLS client requires ${name}: ${value}`);
  }
  return value;
}

export function requestVaultBank<T = unknown>(
  options: VaultMtlsRequestOptions,
): Promise<VaultMtlsResponse<T>> {
  const apiKey = process.env.VAULT_BANK_API_KEY?.trim();
  const secretKey = process.env.VAULT_BANK_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) {
    throw new Error('VAULT_BANK_API_KEY and VAULT_BANK_SECRET_KEY are required');
  }

  const certDir = process.env.VAULT_MTLS_CERT_DIR?.trim() || path.join(process.cwd(), 'certs');
  const body = options.body === undefined ? {} : options.body;
  const payload = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = `${timestamp}-${Math.random().toString(36).slice(2)}`;
  const crypto = require('crypto') as typeof import('crypto');
  const signature = crypto
    .createHmac('sha512', secretKey)
    .update(`${timestamp}.${nonce}.${payload}`, 'utf8')
    .digest('hex');
  const baseUrl = new URL(process.env.VAULT_MTLS_URL?.trim() || 'https://localhost:9443');

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: baseUrl.hostname,
      port: baseUrl.port || 443,
      path: `${options.path}${baseUrl.search}`,
      method: options.method,
      key: fs.readFileSync(requiredPath('VAULT_MTLS_CLIENT_KEY_PATH', path.join(certDir, 'client.key'))),
      cert: fs.readFileSync(requiredPath('VAULT_MTLS_CLIENT_CERT_PATH', path.join(certDir, 'client.crt'))),
      ca: fs.readFileSync(requiredPath('VAULT_MTLS_CA_PATH', path.join(certDir, 'ca.crt'))),
      servername: baseUrl.hostname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Api-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed: T;
        try {
          parsed = JSON.parse(raw) as T;
        } catch {
          reject(new Error(`Vault bank returned non-JSON response (${response.statusCode})`));
          return;
        }
        resolve({ statusCode: response.statusCode || 0, body: parsed });
      });
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

