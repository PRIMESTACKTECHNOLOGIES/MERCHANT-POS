/**
 * Gateway Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/vault/gateways
 *
 * Public (no auth, RAW body — signature verification needs the untouched bytes):
 *   POST /:gatewayId/webhook        — gateway calls this when a payment settles
 *
 * Authenticated (JWT):
 *   GET  /options                   — every gateway + whether this server can use it
 *   POST /charges                   — create a charge and get a hosted checkout link
 *   GET  /charges?cardId=           — recent charges for a card
 *   POST /charges/:id/settle        — re-check with the gateway and credit if paid
 *
 * The webhook NEVER credits on its own: it only triggers a server-side
 * verification against the gateway's API (see gateway.service.ts).
 */

import { Router, type Request, type Response } from 'express';
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.middleware';
import {
  listGatewayOptions,
  createGatewayCharge,
  listGatewayCharges,
  settleGatewayCharge,
  handleGatewayWebhook,
} from './gateway.service';

// ═══════════════════════════════════════════════════════════════════════════
// Webhook router — raw body, no JWT
// ═══════════════════════════════════════════════════════════════════════════
export const gatewayWebhookRouter = Router();

/**
 * Only the webhook sub-path gets a raw body. Every other path is left untouched
 * so the application's normal JSON parser can handle it further down the stack.
 */
export const gatewayRawBodyParser = (req: Request, res: Response, next: any) => {
  if (/\/webhook\/?$/.test(req.path)) {
    return express.raw({ type: () => true, limit: '1mb' })(req, res, next);
  }
  return next();
};

gatewayWebhookRouter.post('/:gatewayId/webhook', async (req: Request, res: Response) => {
  try {
    const gatewayId = String(req.params.gatewayId).toLowerCase();
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await handleGatewayWebhook(gatewayId, raw, req.headers as Record<string, any>);

    // Gateways retry on anything that is not a 2xx, so a rejected webhook that
    // we have deliberately refused (bad signature/unknown charge) answers 200
    // with ok:false to stop the retry storm, while real errors answer 500.
    console.warn(`[GatewayWebhook] ${gatewayId} ok=${result.ok} reason=${result.reason || '-'} ${result.message || ''}`);
    return res.json({ ok: result.ok, reason: result.reason, credited: result.credited ?? false });
  } catch (err: any) {
    console.error('[GatewayWebhook]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Authenticated router
// ═══════════════════════════════════════════════════════════════════════════
export const gatewayRouter = Router();
gatewayRouter.use(authenticateToken);

function handleErr(res: Response, err: any) {
  const msg = err?.message || 'Internal error';
  // GatewayError carries a message meant to be read by the operator.
  const isClientError = err?.name === 'GatewayError';
  if (!isClientError) console.error('[Gateway]', msg);
  return res.status(isClientError ? 400 : 500).json({ ok: false, error: msg });
}

gatewayRouter.get('/options', (_req: Request, res: Response) => {
  const options = listGatewayOptions();
  return res.json({
    ok: true,
    count: options.length,
    availableCount: options.filter((o) => o.available).length,
    options,
  });
});

gatewayRouter.post('/charges', async (req: Request, res: Response) => {
  try {
    const { gatewayId, cardId, currency, amount, email } = req.body || {};
    if (!gatewayId || !cardId || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'gatewayId, cardId, currency and amount are required' });
    }
    const charge = await createGatewayCharge({
      gatewayId: String(gatewayId).toLowerCase(),
      cardId: String(cardId),
      currency: String(currency),
      amount: Number(amount),
      email: email ? String(email) : undefined,
    });
    return res.json({ ok: true, charge });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

gatewayRouter.get('/charges', async (req: Request, res: Response) => {
  try {
    const cardId = req.query.cardId ? String(req.query.cardId) : undefined;
    const limit = Math.min(Number(req.query.limit || 25) || 25, 100);
    const charges = await listGatewayCharges(cardId, limit);
    return res.json({ ok: true, charges, count: charges.length });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

gatewayRouter.post('/charges/:id/settle', async (req: Request, res: Response) => {
  try {
    const result = await settleGatewayCharge(String(req.params.id));
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});
