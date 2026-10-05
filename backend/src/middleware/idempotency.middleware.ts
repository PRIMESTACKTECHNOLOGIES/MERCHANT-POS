import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { db } from '../config/db';

export interface IdempotencyRecord {
  idempotency_key: string;
  request_hash: string;
  payout_id: string;
  response_snapshot?: string;
}

function hashBody(rawBody: Buffer | string | object): string {
  let str: string;
  if (Buffer.isBuffer(rawBody)) str = rawBody.toString('utf8');
  else if (typeof rawBody === 'string') str = rawBody;
  else str = JSON.stringify(rawBody || {});
  return createHash('sha256').update(str).digest('hex');
}

async function lookupKey(key: string): Promise<IdempotencyRecord | null> {
  try {
    const r = await db.query(
      `SELECT idempotency_key, request_hash, payout_id, response_snapshot
         FROM payout_idempotency WHERE idempotency_key = ? LIMIT 1`,
      [key]
    );
    return r?.rows?.[0] || null;
  } catch (_) { return null; }
}

async function storeKey(rec: IdempotencyRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO payout_idempotency (idempotency_key, request_hash, payout_id, response_snapshot)
       VALUES (?,?,?,?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
      [rec.idempotency_key, rec.request_hash, rec.payout_id, rec.response_snapshot || null]
    );
  } catch (_) { /* table may not exist yet — best effort */ }
}

export function payoutIdempotency(options: {
  require?: boolean;
} = {}) {
  const requireKey = options.require ?? false;

  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = (req.headers['idempotency-key'] as string)
      || (req.headers['x-idempotency-key'] as string)
      || (req.headers['x-request-id'] as string)
      || null;

    if (!rawKey) {
      if (requireKey) {
        return res.status(400).json({
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required for this request',
        });
      }
      (req as any).idempotency = { enabled: false };
      return next();
    }

    const key = String(rawKey).trim().slice(0, 255);
    if (!key) {
      return res.status(400).json({
        error: 'IDEMPOTENCY_KEY_EMPTY',
        message: 'Idempotency-Key header value is empty',
      });
    }

    const requestHash = hashBody(req.body);
    (req as any).idempotency = {
      enabled: true,
      key,
      requestHash,
      stored: null as IdempotencyRecord | null,
      store: async (payoutId: string, responseSnapshot?: any) => {
        await storeKey({
          idempotency_key: key,
          request_hash: requestHash,
          payout_id: payoutId,
          response_snapshot: responseSnapshot ? JSON.stringify(responseSnapshot) : undefined,
        });
      },
    };

    const existing = await lookupKey(key);
    if (!existing) {
      return next();
    }

    (req as any).idempotency.stored = existing;

    if (existing.request_hash !== requestHash) {
      return res.status(409).json({
        error: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency-Key reused with a different request payload',
        code: 'IDEMPOTENCY_CONFLICT',
        details: {
          provided_request_hash: requestHash,
          stored_request_hash: existing.request_hash,
        },
      });
    }

    try {
      if (existing.response_snapshot) {
        const snap = JSON.parse(existing.response_snapshot);
        res.setHeader('X-Idempotency-Replayed', 'true');
        return res.status(snap.status || 200).json(snap.body || snap);
      }
    } catch (_) { /* fall through to standard response */ }

    res.setHeader('X-Idempotency-Replayed', 'true');
    return res.status(200).json({
      ok: true,
      idempotent_replay: true,
      payout_id: existing.payout_id,
      idempotency_key: key,
    });
  };
}

export default payoutIdempotency;
