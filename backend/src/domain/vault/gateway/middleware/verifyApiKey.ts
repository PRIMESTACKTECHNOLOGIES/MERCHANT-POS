import { Request, Response, NextFunction } from 'express';
import { db } from '../../../../config/db';

export async function verifyVaultApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = req.header('x-api-key');
  const apiKey = rawKey?.trim();
  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const result = await db.query(
    `SELECT api_key, secret_key FROM vault_api_keys WHERE api_key = ? AND active = 1 LIMIT 1`,
    [apiKey],
  );
  if (!result.rows.length) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  (req as any).vaultKey = result.rows[0];
  await db.query('UPDATE vault_api_keys SET last_used_at = ? WHERE api_key = ?', [
    new Date().toISOString(),
    apiKey,
  ]);
  next();
}

