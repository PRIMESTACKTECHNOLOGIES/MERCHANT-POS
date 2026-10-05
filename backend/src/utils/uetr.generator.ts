import crypto from 'crypto';

export function generateUetr(): string {
  return crypto.randomUUID().toUpperCase();
}
