/**
 * Crypto Cards Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/vault/crypto
 *
 *   GET  /cards                    — the two crypto cards, live crypto + fiat balance
 *   GET  /cards/:id/transactions   — real on-chain transactions (Receive column)
 *   POST /cards/:id/send           — real on-chain withdrawal
 *   GET  /rates                    — live crypto prices and USD→fiat table
 *
 * All routes require authentication. Balances and transaction ids are read
 * straight from the chain; sends are signed locally and broadcast.
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import {
  CRYPTO_CARDS,
  findCryptoCard,
  getCardBalance,
  getCardTransactions,
  getRates,
  sendCrypto,
  verifyIncoming,
  type CryptoCardDef,
} from './cryptoCards.service';

const router = Router();
router.use(authenticateToken);

const SUPPORTED_FIAT = new Set(['USD', 'EUR', 'GBP', 'AED', 'INR', 'SAR', 'CAD', 'AUD', 'CHF', 'JPY']);

function fiatCurrency(req: Request): string {
  const c = String(req.query.fiat || req.query.currency || 'USD').toUpperCase();
  return SUPPORTED_FIAT.has(c) ? c : 'USD';
}

/** Shape one card for the client, including the live crypto + fiat balance. */
async function presentCard(def: CryptoCardDef, fiat: string, usd: Record<string, number>, fx: Record<string, number>) {
  const price = Number(usd[def.symbol] || (def.symbol === 'USDT' ? 1 : 0));
  const fxRate = Number(fx[fiat] || 1);

  const card: Record<string, unknown> = {
    id: def.id,
    symbol: def.symbol,
    name: def.name,
    network: def.network,
    networkLabel: def.networkLabel,
    address: def.address,
    contract: def.contract || null,
    decimals: def.decimals,
    configured: def.configured,
    unavailableReason: def.unavailableReason || null,
    priceUsd: price,
    fiatCurrency: fiat,
    explorer: { tx: def.explorerTx('{txid}'), address: def.explorerAddress(def.address) },
  };

  if (!def.configured) {
    card.balance = null;
    card.error = def.unavailableReason || 'Card is not configured';
    return card;
  }

  try {
    const bal = await getCardBalance(def);
    card.balance = {
      crypto: bal.crypto,
      symbol: bal.symbol,
      fiat: bal.crypto * price * fxRate,
      currency: fiat,
      priceUsd: price,
      priceFiat: price * fxRate,
    };
    card.gas = { amount: bal.gas, symbol: bal.gasSymbol };
    card.checkedAt = bal.checkedAt;
  } catch (err: any) {
    card.balance = null;
    card.error = err?.response?.data?.Error || err?.message || 'Balance lookup failed';
  }

  return card;
}

// ── GET /api/vault/crypto/rates ──────────────────────────────────────────────
router.get('/rates', async (_req: Request, res: Response) => {
  try {
    const { usd, fx } = await getRates();
    return res.json({ ok: true, usd, fx, at: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Rate lookup failed' });
  }
});

// ── GET /api/vault/crypto/cards ──────────────────────────────────────────────
router.get('/cards', async (req: Request, res: Response) => {
  const fiat = fiatCurrency(req);
  try {
    const { usd, fx } = await getRates();
    const cards = await Promise.all(CRYPTO_CARDS.map((c) => presentCard(c, fiat, usd, fx)));
    return res.json({
      ok: true,
      count: cards.length,
      fiat,
      usd,
      fx,
      at: new Date().toISOString(),
      cards,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Card lookup failed' });
  }
});

// ── GET /api/vault/crypto/cards/:id/transactions ─────────────────────────────
router.get('/cards/:id/transactions', async (req: Request, res: Response) => {
  const def = findCryptoCard(req.params.id);
  if (!def) return res.status(404).json({ ok: false, error: `Unknown crypto card "${req.params.id}"` });

  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
  try {
    const transactions = await getCardTransactions(def, limit);
    return res.json({
      ok: true,
      cardId: def.id,
      symbol: def.symbol,
      address: def.address,
      explorer: def.explorerAddress(def.address),
      count: transactions.length,
      transactions,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.response?.data?.Error || err?.message || 'Transaction lookup failed' });
  }
});

// ── POST /api/vault/crypto/cards/:id/send ────────────────────────────────────
/**
 * Body: { to: string, amount: number, confirm: true }
 * Signs locally and broadcasts to the chain. `confirm` guards against an
 * accidental spend — no request is broadcast without it.
 */
router.post('/cards/:id/send', async (req: Request, res: Response) => {
  const def = findCryptoCard(req.params.id);
  if (!def) return res.status(404).json({ ok: false, error: `Unknown crypto card "${req.params.id}"` });

  const { to, amount, confirm } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ ok: false, error: 'Set confirm:true to broadcast a real on-chain transfer.' });
  }
  if (!to || !amount) {
    return res.status(400).json({ ok: false, error: 'to and amount are required' });
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
  }

  try {
    const result = await sendCrypto(def, String(to).trim(), value);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Send failed' });
  }
});

// ── POST /api/vault/crypto/cards/:id/verify-receipt ──────────────────────────
/**
 * Body: { txid: string, amount: number }
 * Confirms an incoming transfer on-chain (real txid, real amount, real recipient)
 * before the operator credits a card. Read-only — never moves funds.
 */
router.post('/cards/:id/verify-receipt', async (req: Request, res: Response) => {
  const def = findCryptoCard(req.params.id);
  if (!def) return res.status(404).json({ ok: false, error: `Unknown crypto card "${req.params.id}"` });

  const { txid, amount } = req.body || {};
  if (!txid || amount === undefined) {
    return res.status(400).json({ ok: false, error: 'txid and amount are required' });
  }
  try {
    const check = await verifyIncoming(def, String(txid).trim(), Number(amount));
    return res.status(check.ok ? 200 : 400).json(check);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Verification failed' });
  }
});

export const cryptoCardsRouter = router;
