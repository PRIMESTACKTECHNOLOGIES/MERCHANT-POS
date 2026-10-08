/**
 * Transak VBA Router
 * Mounted at: /api/wallets/vba
 *
 * POST /create          — create a virtual bank account for a customer
 * GET  /status/:vbaId   — check VBA status
 * POST /webhook         — Transak webhook (HMAC-verified)
 * GET  /list/:customerId — list VBAs for a customer
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { createVba, getVbaStatus, handleVbaWebhook } from './transakVba.service';
import { db } from '../../config/db';

const router = Router();

// ── Webhook (public — HMAC verified internally) ───────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = String(
      req.headers['x-transak-signature'] ||
      req.headers['webhook-signature'] ||
      req.headers['x-signature'] || ''
    );
    const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
    await handleVbaWebhook(rawBody, signature, req.body);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'INVALID_SIGNATURE') return res.status(401).json({ ok: false, error: 'Invalid signature' });
    console.error('[VBA webhook]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── All below require JWT ─────────────────────────────────────────────────────
router.use(authenticateToken);

/**
 * POST /api/wallets/vba/create
 * Body: {
 *   customerId, merchantId,
 *   fiatCurrency: 'GBP'|'EUR'|'USD',
 *   paymentMethod: 'gbp_bank_transfer'|'sepa_bank_transfer',
 *   cryptoCurrency: 'USDT',
 *   walletAddress: '0x...',
 *   network: 'ethereum'|'tron'|'polygon',
 *   userIp (optional — defaults to request IP)
 * }
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const {
      customerId, merchantId, fiatCurrency, paymentMethod,
      cryptoCurrency, walletAddress, network, memoTag,
    } = req.body || {};

    if (!customerId || !fiatCurrency || !paymentMethod || !walletAddress || !network) {
      return res.status(400).json({
        ok: false,
        error: 'customerId, fiatCurrency, paymentMethod, walletAddress and network are required',
      });
    }

    const userIp = String(
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      '1.1.1.1'
    ).split(',')[0].trim();

    const result = await createVba({
      customerId:    String(customerId),
      merchantId:    String(merchantId || 'MRC-1001'),
      fiatCurrency:  String(fiatCurrency).toUpperCase(),
      paymentMethod: String(paymentMethod),
      cryptoCurrency: String(cryptoCurrency || 'USDT').toUpperCase(),
      walletAddress: String(walletAddress),
      network:       String(network),
      userIp,
      memoTag:       memoTag ? String(memoTag) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/wallets/vba/status/:vbaId
 */
router.get('/status/:vbaId', async (req: Request, res: Response) => {
  try {
    const result = await getVbaStatus(req.params.vbaId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/wallets/vba/list/:customerId
 */
router.get('/list/:customerId', async (req: Request, res: Response) => {
  try {
    const rows = (await db.query(
      `SELECT vba_id, fiat_currency, payment_method, crypto_currency, status, created_at
       FROM transak_vba_accounts WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
      [req.params.customerId]
    ).catch(() => ({ rows: [] }))).rows;
    return res.json({ ok: true, vbas: rows, count: rows.length });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export { router as transakVbaRouter };
