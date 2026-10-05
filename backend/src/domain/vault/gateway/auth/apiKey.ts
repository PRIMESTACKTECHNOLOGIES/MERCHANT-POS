import crypto from 'crypto';

export function generateVaultApiKey(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function generateVaultSecretKey(): string {
  return crypto.randomBytes(64).toString('hex');
}

