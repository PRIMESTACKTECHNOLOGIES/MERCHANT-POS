/**
 * Card Top-Up Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/card-topup
 *
 * Public (no auth):
 *   POST /webhook/transak          — Transak webhook (HMAC-verified internally)
 *
 * Authenticated (JWT required):
 *   GET  /balance/:cardId          — current card balance
 *   GET  /balance                  — all card balances
 *   GET  /history/:cardId          — transaction history
 *
 * Top-up endpoints (JWT required):
 *   POST /bank-wire                — Channel 1: SWIFT / SEPA / ACH wire
 *   POST /wise                     — Channel 2: Wise incoming transfer
 *   POST /crypto                   — Channel 3: USDT on-chain (TRC-20/BEP-20/ERC-20)
 *   POST /transak                  — Channel 4: Transak on-ramp (manual confirm)
 *   POST /cash                     — Channel 5: Cash deposit (operator-confirmed)
 *   POST /card-to-card             — Channel 6: Card-to-card transfer
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import {
  topupViaBankWire,
  topupViaWise,
  topupViaCrypto,
  topupViaTransak,
  topupViaCash,
  topupViaCardToCard,
  handleTransakTopupWebhook,
} from './cardTopup.service';
import {
  getCardBalance,
  getCardHistory,
  listAllCardBalances,
} from './cardBalance.service';

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────
function handleErr(res: Response, err: any) {
  console.error('[CardTopup]', err?.message || err);
  return res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — Transak webhook (no JWT — HMAC verified in service)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/webhook/transak', async (req: Request, res: Response) => {
  try {
    const signature = String(req.headers['x-transak-signature'] || req.headers['webhook-signature'] || '');
    await handleTransakTopupWebhook(req.body, signature);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'INVALID_SIGNATURE') return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
    return handleErr(res, err);
  }
});

// ── All routes below require authentication ──────────────────────────────────
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE & HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/card-topup/balance
 * Returns all vault card balances.
 */
router.get('/balance', async (_req: Request, res: Response) => {
  try {
    const balances = await listAllCardBalances();
    return res.json({ ok: true, balances, count: balances.length });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * GET /api/card-topup/balance/:cardId?currency=USD
 * Returns balance for a specific card.
 */
router.get('/balance/:cardId', async (req: Request, res: Response) => {
  try {
    const { cardId } = req.params;
    const currency = String(req.query.currency || 'USD').toUpperCase();
    const balance = await getCardBalance(cardId, currency);
    return res.json({ ok: true, ...balance });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * GET /api/card-topup/history/:cardId?currency=USD&limit=50
 * Returns transaction history for a card.
 */
router.get('/history/:cardId', async (req: Request, res: Response) => {
  try {
    const { cardId } = req.params;
    const currency = req.query.currency ? String(req.query.currency).toUpperCase() : undefined;
    const limit    = Math.min(Number(req.query.limit || 100), 500);
    const history  = await getCardHistory(cardId, currency, limit);
    return res.json({ ok: true, cardId, count: history.length, history });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 1 — BANK WIRE (SWIFT / SEPA / ACH)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/bank-wire
 * Body: {
 *   cardId, currency, amount,
 *   wireReference, senderName, senderBank,
 *   transferType: 'SWIFT'|'SEPA'|'ACH'|'FEDWIRE'|'FASTER_PAYMENTS'|'RTGS',
 *   operatorCode, note?
 * }
 */
router.post('/bank-wire', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, wireReference, senderName, senderBank,
            transferType, operatorCode, note } = req.body || {};

    if (!cardId || !currency || !amount || !wireReference || !senderName || !transferType || !operatorCode) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount, wireReference, senderName, transferType and operatorCode are required' });
    }

    const result = await topupViaBankWire({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      wireReference: String(wireReference), senderName: String(senderName),
      senderBank: String(senderBank || ''), transferType: String(transferType).toUpperCase() as any,
      operatorCode: String(operatorCode), note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 2 — WISE
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/wise
 * Body: { cardId, currency, amount, transferId, note? }
 */
router.post('/wise', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, transferId, note } = req.body || {};

    if (!cardId || !currency || !amount || !transferId) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount and transferId are required' });
    }

    const result = await topupViaWise({
      cardId: String(cardId), currency: String(currency),
      amount: Number(amount), transferId: String(transferId),
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 3 — CRYPTO (USDT on-chain)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/crypto
 * Body: { cardId, currency, amount, txHash, network: 'tron'|'bsc'|'ethereum'|'polygon', note? }
 */
router.post('/crypto', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, txHash, network, note } = req.body || {};
    const validNetworks = ['tron', 'bsc', 'ethereum', 'polygon'];

    if (!cardId || !currency || !amount || !txHash || !validNetworks.includes(String(network))) {
      return res.status(400).json({ ok: false, error: `cardId, currency, amount, txHash and network (${validNetworks.join('|')}) are required` });
    }

    const result = await topupViaCrypto({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      txHash: String(txHash), network: String(network) as any,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 4 — TRANSAK (manual confirm)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/transak
 * Body: { cardId, currency, amount, orderId, note? }
 */
router.post('/transak', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, orderId, note } = req.body || {};

    if (!cardId || !currency || !amount || !orderId) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount and orderId are required' });
    }

    const result = await topupViaTransak({
      cardId: String(cardId), currency: String(currency),
      amount: Number(amount), orderId: String(orderId),
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 5 — CASH DEPOSIT
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/cash
 * Body: { cardId, currency, amount, depositRef, operatorId, operatorCode, location?, note? }
 */
router.post('/cash', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, depositRef, operatorId, operatorCode, location, note } = req.body || {};

    if (!cardId || !currency || !amount || !depositRef || !operatorId || !operatorCode) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount, depositRef, operatorId and operatorCode are required' });
    }

    const result = await topupViaCash({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      depositRef: String(depositRef), operatorId: String(operatorId),
      operatorCode: String(operatorCode), location: location ? String(location) : undefined,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 6 — CARD TO CARD
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/card-to-card
 * Body: { sourceCardId, destCardId, currency, amount, sourceRef, operatorCode?, note? }
 * Use sourceCardId='EXTERNAL' for loading from an external confirmed card.
 */
router.post('/card-to-card', async (req: Request, res: Response) => {
  try {
    const { sourceCardId, destCardId, currency, amount, sourceRef, operatorCode, note } = req.body || {};

    if (!sourceCardId || !destCardId || !currency || !amount || !sourceRef) {
      return res.status(400).json({ ok: false, error: 'sourceCardId, destCardId, currency, amount and sourceRef are required' });
    }
    if (String(sourceCardId) === String(destCardId)) {
      return res.status(400).json({ ok: false, error: 'sourceCardId and destCardId must be different' });
    }

    const result = await topupViaCardToCard({
      sourceCardId: String(sourceCardId), destCardId: String(destCardId),
      currency: String(currency), amount: Number(amount),
      sourceRef: String(sourceRef),
      operatorCode: operatorCode ? String(operatorCode) : undefined,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

export { router as cardTopupRouter };
