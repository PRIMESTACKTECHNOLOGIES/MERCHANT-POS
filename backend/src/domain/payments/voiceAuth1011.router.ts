/**
 * Voice Authorization Router — Protocol 101.1
 *
 * All endpoints require JWT authentication (mounted after authenticateToken).
 *
 * ── Endpoints ─────────────────────────────────────────────────────────────
 *
 * POST   /api/voice-auth/inbound
 *   Register inbound funds before capture.
 *   Body: { authCode, amountMinor, currency, panLast4, merchantId,
 *           cardholderName?, source?, registeredBy?, notes? }
 *
 * GET    /api/voice-auth/inbound/:merchantId
 *   List all inbound fund registrations for a merchant.
 *   Query: ?status=ACTIVE|CONSUMED|EXPIRED
 *
 * POST   /api/voice-auth/capture
 *   POS cashier enters card + verbal auth code.  Funds are moved here.
 *   Body: { authCode, pan, amountMinor, currency, merchantId,
 *           terminalId?, stan?, cardholderName?, idempotencyKey? }
 *   Header: Idempotency-Key (optional — overrides body.idempotencyKey)
 *
 * GET    /api/voice-auth/captures/:merchantId
 *   List all captured voice-auth transactions for a merchant.
 *   Query: ?limit=50
 *
 * POST   /api/voice-auth/settle/batch
 *   Build end-of-day settlement batch for all pending VOICE_AUTH captures.
 *   Body: { merchantId, currency }
 *
 * GET    /api/voice-auth/status/:authCode/:merchantId
 *   Quick status check for a specific auth code.
 */

import { Router, Request, Response } from 'express';
import { voiceAuthService } from './voiceAuth.service';
import { db } from '../../config/db';

const router = Router();

// ── POST /inbound — register inbound funds ──────────────────────────────────
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const {
      authCode, amountMinor, currency, panLast4,
      cardholderName, merchantId, source, registeredBy, notes,
    } = req.body || {};

    if (!authCode || !amountMinor || !panLast4 || !merchantId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'authCode, amountMinor, panLast4, and merchantId are required',
        protocol: '101.1',
      });
    }

    const result = await voiceAuthService.registerInboundFunds({
      authCode: String(authCode),
      amountMinor: Number(amountMinor),
      currency: String(currency || 'USD'),
      panLast4: String(panLast4),
      cardholderName: cardholderName ? String(cardholderName) : undefined,
      merchantId: String(merchantId),
      source: source ? String(source) : undefined,
      registeredBy: registeredBy ? String(registeredBy) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    return res.status(201).json({ ok: true, ...result });
  } catch (e: any) {
    const status =
      e?.code === 'INVALID_AUTH_CODE_FORMAT' ? 400
      : e?.code === 'INVALID_AMOUNT' ? 400
      : e?.code === 'INVALID_CURRENCY' ? 400
      : e?.code === 'INVALID_PAN_LAST4' ? 400
      : e?.code === 'MERCHANT_ID_REQUIRED' ? 400
      : e?.code?.startsWith('AUTH_CODE_') ? 409
      : 500;
    return res.status(status).json({
      error: e?.code || 'INBOUND_REGISTRATION_FAILED',
      message: e?.message || 'Failed to register inbound funds',
      protocol: '101.1',
    });
  }
});

// ── GET /inbound/:merchantId — list inbound registrations ───────────────────
router.get('/inbound/:merchantId', async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const funds = await voiceAuthService.listInboundFunds(merchantId, status);
    return res.json({ ok: true, merchantId, count: funds.length, funds });
  } catch (e: any) {
    return res.status(500).json({ error: 'LIST_FAILED', message: e?.message });
  }
});

// ── POST /capture — POS terminal captures the transaction ──────────────────
router.post('/capture', async (req: Request, res: Response) => {
  try {
    const {
      authCode, pan, amountMinor, currency,
      merchantId, terminalId, stan, cardholderName, idempotencyKey,
    } = req.body || {};

    if (!authCode || !pan || !amountMinor || !merchantId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'authCode, pan, amountMinor, and merchantId are required. CVV is NOT required for 101.1 voice auth.',
        protocol: '101.1',
      });
    }

    // Allow override from header
    const idemKey = req.headers['idempotency-key']
      ? String(req.headers['idempotency-key'])
      : idempotencyKey
        ? String(idempotencyKey)
        : undefined;

    const result = await voiceAuthService.capture({
      authCode: String(authCode),
      pan: String(pan),
      amountMinor: Number(amountMinor),
      currency: String(currency || 'USD'),
      merchantId: String(merchantId),
      terminalId: terminalId ? String(terminalId) : undefined,
      stan: stan ? String(stan) : undefined,
      cardholderName: cardholderName ? String(cardholderName) : undefined,
      idempotencyKey: idemKey,
    });

    const httpStatus = result.status === 'APPROVED' ? 200 : 402;
    return res.status(httpStatus).json({ ok: result.success, ...result });
  } catch (e: any) {
    return res.status(500).json({
      error: 'CAPTURE_FAILED',
      message: e?.message || 'Voice auth capture failed',
      protocol: '101.1',
    });
  }
});

// ── GET /captures/:merchantId — list captured transactions ──────────────────
router.get('/captures/:merchantId', async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const captures = await voiceAuthService.getCaptures(merchantId, limit);
    return res.json({ ok: true, merchantId, count: captures.length, captures });
  } catch (e: any) {
    return res.status(500).json({ error: 'LIST_FAILED', message: e?.message });
  }
});

// ── POST /settle/batch — build end-of-day settlement batch ─────────────────
router.post('/settle/batch', async (req: Request, res: Response) => {
  try {
    const { merchantId, currency } = req.body || {};
    if (!merchantId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'merchantId is required',
      });
    }
    const batch = await voiceAuthService.buildSettlementBatch(
      String(merchantId),
      String(currency || 'USD'),
    );
    return res.status(201).json({ ok: true, ...batch });
  } catch (e: any) {
    const status = e?.code === 'NO_TRANSACTIONS' ? 404 : 500;
    return res.status(status).json({
      error: e?.code || 'BATCH_FAILED',
      message: e?.message || 'Settlement batch build failed',
    });
  }
});

// ── GET /status/:authCode/:merchantId — quick status check ─────────────────
router.get('/status/:authCode/:merchantId', async (req: Request, res: Response) => {
  try {
    const { authCode, merchantId } = req.params;
    const res1 = await db.query(
      `SELECT id, auth_code, amount_minor, currency, pan_last4, status,
              capture_ref, captured_at, registered_at, updated_at
         FROM inbound_funds_101
        WHERE auth_code = ? AND merchant_id = ?
        ORDER BY registered_at DESC LIMIT 1`,
      [String(authCode).trim(), merchantId],
    );
    if (!res1.rows.length) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: `Auth code ${authCode} not found for merchant ${merchantId}`,
      });
    }
    const row = res1.rows[0] as any;
    return res.json({
      ok: true,
      id: row.id,
      authCode: row.auth_code,
      amountMinor: Number(row.amount_minor),
      amount: Number(row.amount_minor) / 100,
      currency: row.currency,
      panLast4: row.pan_last4,
      status: row.status,
      captureRef: row.capture_ref,
      capturedAt: row.captured_at,
      registeredAt: row.registered_at,
      updatedAt: row.updated_at,
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'STATUS_FAILED', message: e?.message });
  }
});

// ── GET /events/:txnId — protocol event log for a transaction ───────────────
router.get('/events/:txnId', async (req: Request, res: Response) => {
  try {
    const r = await db.query(
      `SELECT id, txn_id, protocol_code, event_type, amount_minor, currency,
              merchant_id, auth_code, status, meta_json, created_at
         FROM voice_auth_events WHERE txn_id = ? ORDER BY created_at ASC`,
      [req.params.txnId],
    );
    const events = r.rows.map((row: any) => ({
      id: row.id,
      txnId: row.txn_id,
      protocolCode: row.protocol_code,
      eventType: row.event_type,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      merchantId: row.merchant_id,
      authCode: row.auth_code,
      status: row.status,
      meta: row.meta_json ? JSON.parse(row.meta_json) : {},
      createdAt: row.created_at,
    }));
    return res.json({ ok: true, count: events.length, events });
  } catch (e: any) {
    return res.status(500).json({ error: 'EVENTS_FAILED', message: e?.message });
  }
});

export default router;
export { router as voiceAuth1011Router };
