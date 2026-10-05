import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../auth/rateLimit';

export function vaultRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const apiKey = (req as any).vaultKey?.api_key;
  if (!apiKey || !checkRateLimit(apiKey)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
}

