/**
 * PRISMA / LaPos POS — REST API Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/prisma-pos
 *
 * All endpoints require JWT (authenticateToken middleware) except /health.
 *
 * Endpoints:
 *   GET  /health          — TES connection test (no auth)
 *   POST /sale            — VEN: process a real card sale
 *   POST /cancel-sale     — ANV: void a sale by coupon number
 *   POST /refund          — DEV: return funds to cardholder
 *   POST /cancel-refund   — AND: cancel a refund
 *   POST /close           — CIE: end-of-day batch closure
 *   GET  /last-transaction— ULT: last transaction data
 *   GET  /last-close      — ULC: last closure summary
 *   POST /reprint-txn     — IMT: reprint last transaction receipt
 *   POST /reprint-close   — IMC: reprint last closure receipt
 *   GET  /cards           — TAR: list all supported card types
 *   GET  /plans           — PLA: list all payment plans
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../../middleware/auth.middleware';
import { prismaLaposService } from './prisma-lapos.service';

const router = Router();

// ── Health / connection test (public) ─────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.testConnection();
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err: any) {
    return res.status(503).json({ ok: false, message: err.message || 'PRISMA POS unreachable' });
  }
});

// ── All other routes require authentication ───────────────────────────────────
router.use(authenticateToken);

// ── POST /sale ────────────────────────────────────────────────────────────────
/**
 * Body:
 *   amount        number   required  — major units e.g. 100.50
 *   invoiceNumber string   optional  — padded to 12 digits internally
 *   installments  number   optional  — default 1
 *   cardCode      string   optional  — 'VI','MC','EL','VVI' — default 'VI'
 *   planCode      string   optional  — default '0'
 *   tipAmount     number   optional  — default 0
 *   customerId    string   optional  — link to internal customer wallet
 *   merchantId    string   optional  — override merchant ID
 *   online        boolean  optional  — default true
 */
router.post('/sale', async (req: Request, res: Response) => {
  try {
    const { amount, invoiceNumber, installments, cardCode, planCode,
            tipAmount, customerId, merchantId, online } = req.body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ ok: false, error: 'amount is required and must be positive' });
    }

    const result = await prismaLaposService.sale({
      amount:        Number(amount),
      invoiceNumber: invoiceNumber ? String(invoiceNumber) : undefined,
      installments:  installments  ? Number(installments)  : undefined,
      cardCode:      cardCode      ? String(cardCode)      : undefined,
      planCode:      planCode      ? String(planCode)      : undefined,
      tipAmount:     tipAmount     ? Number(tipAmount)     : undefined,
      customerId:    customerId    ? String(customerId)    : undefined,
      merchantId:    merchantId    ? String(merchantId)    : undefined,
      online:        online !== false,
    });

    return res.status(result.approved ? 200 : 402).json(result);
  } catch (err: any) {
    console.error('[PRISMA /sale]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cancel-sale ─────────────────────────────────────────────────────────
/**
 * Body:
 *   couponNumber  string  required — coupon number of the original sale
 *   cardCode      string  required — card code used in original sale
 */
router.post('/cancel-sale', async (req: Request, res: Response) => {
  try {
    const { couponNumber, cardCode } = req.body || {};
    if (!couponNumber || !cardCode) {
      return res.status(400).json({ ok: false, error: 'couponNumber and cardCode are required' });
    }
    const result = await prismaLaposService.cancelSale({
      couponNumber: String(couponNumber),
      cardCode:     String(cardCode),
    });
    return res.status(result.approved ? 200 : 402).json(result);
  } catch (err: any) {
    console.error('[PRISMA /cancel-sale]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /refund ──────────────────────────────────────────────────────────────
/**
 * Body:
 *   amount          number  required
 *   cardCode        string  required
 *   planCode        string  optional — default '0'
 *   installments    number  optional — default 1
 *   originalCoupon  string  required — coupon from original sale
 *   originalDate    string  required — DD/MM/YYYY
 *   invoiceNumber   string  optional
 *   online          boolean optional — default true
 */
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { amount, cardCode, planCode, installments, originalCoupon,
            originalDate, invoiceNumber, online } = req.body || {};

    if (!amount || !cardCode || !originalCoupon || !originalDate) {
      return res.status(400).json({
        ok: false,
        error: 'amount, cardCode, originalCoupon, and originalDate are required',
      });
    }

    const result = await prismaLaposService.refund({
      amount:         Number(amount),
      cardCode:       String(cardCode),
      planCode:       planCode      ? String(planCode)     : '0',
      installments:   installments  ? Number(installments) : 1,
      originalCoupon: String(originalCoupon),
      originalDate:   String(originalDate),
      invoiceNumber:  invoiceNumber ? String(invoiceNumber) : String(Date.now()).slice(-12),
      online:         online !== false,
    });

    return res.status(result.approved ? 200 : 402).json(result);
  } catch (err: any) {
    console.error('[PRISMA /refund]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cancel-refund ───────────────────────────────────────────────────────
router.post('/cancel-refund', async (req: Request, res: Response) => {
  try {
    const { couponNumber, cardCode } = req.body || {};
    if (!couponNumber || !cardCode) {
      return res.status(400).json({ ok: false, error: 'couponNumber and cardCode are required' });
    }
    const result = await prismaLaposService.cancelRefund({
      couponNumber: String(couponNumber),
      cardCode:     String(cardCode),
    });
    return res.status(result.approved ? 200 : 402).json(result);
  } catch (err: any) {
    console.error('[PRISMA /cancel-refund]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /close ───────────────────────────────────────────────────────────────
router.post('/close', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.close();
    return res.status(result.approved ? 200 : 500).json(result);
  } catch (err: any) {
    console.error('[PRISMA /close]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /last-transaction ─────────────────────────────────────────────────────
router.get('/last-transaction', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.lastTransaction();
    return res.json(result);
  } catch (err: any) {
    console.error('[PRISMA /last-transaction]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /last-close ───────────────────────────────────────────────────────────
router.get('/last-close', async (req: Request, res: Response) => {
  try {
    const index = req.query.index ? Number(req.query.index) : 0;
    const result = await prismaLaposService.lastClose(index);
    return res.json(result);
  } catch (err: any) {
    console.error('[PRISMA /last-close]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /reprint-txn ─────────────────────────────────────────────────────────
router.post('/reprint-txn', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.reprintLastTransaction();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /reprint-close ───────────────────────────────────────────────────────
router.post('/reprint-close', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.reprintLastClose();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cards ────────────────────────────────────────────────────────────────
router.get('/cards', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.cardTable();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /plans ────────────────────────────────────────────────────────────────
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const result = await prismaLaposService.planTable();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export { router as prismaLaposRouter };
