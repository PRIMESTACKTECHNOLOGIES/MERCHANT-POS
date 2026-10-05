import { Request, Response, NextFunction } from 'express';
import { db } from '../../../../config/db';
import { verifySignature } from '../auth/hmac';

export async function verifyVaultHmac(req: Request, res: Response, next: NextFunction): Promise<void> {
  const signature = req.header('x-signature')?.trim();
  const timestamp = req.header('x-timestamp')?.trim();
  const nonce = req.header('x-nonce')?.trim();
  const key = (req as any).vaultKey;

  if (!signature || !timestamp || !nonce) {
    res.status(401).json({ error: 'Missing signature, timestamp, or nonce' });
    return;
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) {
    res.status(403).json({ error: 'Expired or invalid timestamp' });
    return;
  }

  const payload = JSON.stringify(req.body ?? {});
  const signedMessage = `${timestamp}.${nonce}.${payload}`;
  if (!verifySignature(key.secret_key, signedMessage, signature)) {
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  try {
    await db.query(
      'INSERT INTO vault_api_nonces (api_key, nonce, expires_at) VALUES (?, ?, ?)',
      [key.api_key, nonce, new Date(Date.now() + 5 * 60_000).toISOString()],
    );
  } catch {
    res.status(409).json({ error: 'Replay detected' });
    return;
  }

  (req as any).vaultRequest = { timestamp, nonce };
  await db.query('DELETE FROM vault_api_nonces WHERE expires_at < ?', [new Date().toISOString()]);
  next();
}
