/**
 * Card Authorization Router — /api/card-auth
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/card-auth/match          — full protocol matching (rules + auth lookup)
 * POST /api/card-auth/validate       — validate a code (backward compat)
 * POST /api/card-auth/create         — register a new auth record
 * GET  /api/card-auth/list           — list all auth records (admin)
 * GET  /api/card-auth/lookup/:code   — look up a single auth code (admin)
 * GET  /api/card-auth/rules          — list protocol rules
 * PUT  /api/card-auth/rules/:protocol — update a protocol rule
 */

import { Router, Request, Response } from 'express';
import { matchProtocol, validateProtocol, createCardAuth } from './cardAuth.service';
import { db } from '../../config/db';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

// ── POST /api/card-auth/match — full protocol matching engine ─────────────────
// This is the main endpoint. Checks protocol rules first, then auth lookup.
// Body: { protocol, cardNumber, amount, code, cvv?, online }
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { protocol, cardNumber, amount, code, cvv, online, currency, merchantId } = req.body || {};

    if (!protocol || !cardNumber || !code || amount === undefined) {
      return res.status(400).json({ error: 'protocol, cardNumber, code, and amount are required' });
    }
    if (!['101.1', '101.6', '201.3'].includes(String(protocol))) {
      return res.status(400).json({ error: 'protocol must be 101.1, 101.6, or 201.3' });
    }

    const result = await matchProtocol({
      protocol,
      cardNumber,
      amount: Number(amount),
      code,
      cvv,
      online: Boolean(online),
      currency,
      merchantId,
    });

    if (!result.success) {
      return res.status(403).json({
        success:  false,
        protocol: result.protocol,
        authId:   result.authId,
        error:    result.reason || 'Authorization rejected',
      });
    }

    return res.json({
      success:  true,
      protocol: result.protocol,
      authId:   result.authId,
      message:  `Protocol ${result.protocol} authorization accepted. Code redeemed.`,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/card-auth/validate — backward compatible ───────────────────────
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { protocol, cardNumber, code, cvv, amount, currency, merchantId } = req.body || {};

    if (!protocol || !code) {
      return res.status(400).json({ error: 'protocol and code are required' });
    }

    const result = await validateProtocol({
      protocol,
      cardNumber: cardNumber || '',
      code,
      cvv,
      amount: amount !== undefined ? Number(amount) : undefined,
      currency,
      merchantId,
    });

    if (!result.valid) {
      return res.status(403).json({
        success: false, valid: false,
        error: result.reason || 'Invalid authorization code',
        protocol: result.protocol,
        authorizationId: result.authorizationId,
      });
    }

    return res.json({
      success: true, valid: true,
      authorizationId: result.authorizationId,
      protocol: result.protocol,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/card-auth/create ────────────────────────────────────────────────
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { cardNumber, protocol, code, cvv, amount, currency, merchantId, terminalId, customerId, expiry } = req.body || {};

    if (!cardNumber || !protocol || !code || amount === undefined) {
      return res.status(400).json({ error: 'cardNumber, protocol, code, and amount are required' });
    }
    if (!['101.1', '101.6', '201.3'].includes(String(protocol))) {
      return res.status(400).json({ error: 'protocol must be 101.1, 101.6, or 201.3' });
    }
    if (protocol === '201.3' && !cvv) {
      return res.status(400).json({ error: 'CVV is required for protocol 201.3' });
    }

    const result = await createCardAuth({ cardNumber, protocol, code, cvv, amount: Number(amount), currency, merchantId, terminalId, customerId, expiry });
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/card-auth/rules — list all protocol rules ───────────────────────
router.get('/rules', async (_req: Request, res: Response) => {
  try {
    const rows = (await db.query(
      `SELECT * FROM protocol_rules ORDER BY protocol ASC`
    )).rows;
    return res.json({ rules: rows, count: rows.length });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/card-auth/rules/:protocol — update a protocol rule ──────────────
router.put('/rules/:protocol', async (req: Request, res: Response) => {
  try {
    const proto = req.params.protocol;
    const { requires_cvv, requires_online, requires_offline, min_amount, max_amount, active } = req.body || {};

    const setClauses: string[] = [];
    const values: any[] = [];

    if (requires_cvv    !== undefined) { setClauses.push('requires_cvv = ?');    values.push(requires_cvv    ? 1 : 0); }
    if (requires_online !== undefined) { setClauses.push('requires_online = ?'); values.push(requires_online ? 1 : 0); }
    if (requires_offline !== undefined){ setClauses.push('requires_offline = ?');values.push(requires_offline? 1 : 0); }
    if (min_amount      !== undefined) { setClauses.push('min_amount = ?');      values.push(Number(min_amount)); }
    if (max_amount      !== undefined) { setClauses.push('max_amount = ?');      values.push(Number(max_amount)); }
    if (active          !== undefined) { setClauses.push('active = ?');          values.push(active ? 1 : 0); }

    if (!setClauses.length) return res.status(400).json({ error: 'No fields to update' });

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(proto);

    await db.query(`UPDATE protocol_rules SET ${setClauses.join(', ')} WHERE protocol = ?`, values);
    const updated = (await db.query(`SELECT * FROM protocol_rules WHERE protocol = ?`, [proto])).rows[0];
    return res.json({ ok: true, rule: updated });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/card-auth/list ───────────────────────────────────────────────────
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const rows = (await db.query(
      `SELECT id, card_number, pan_masked, protocol, code, cvv,
              amount, currency, status, merchant_id, customer_id, created_at
       FROM card_authorizations ORDER BY created_at DESC LIMIT 100`
    )).rows;
    const safe = rows.map((r: any) => ({ ...r, cvv: r.cvv ? '***' : null }));
    return res.json({ authorizations: safe, count: safe.length });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/card-auth/lookup/:code ──────────────────────────────────────────
router.get('/lookup/:code', async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code).trim().toUpperCase();
    const rows = (await db.query(
      `SELECT id, card_number, pan_masked, protocol, code, amount, currency, status, created_at
       FROM card_authorizations WHERE UPPER(code) = ? LIMIT 5`,
      [code]
    )).rows;
    return res.json({ found: rows.length > 0, records: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/card-auth/:id — delete a single auth code by ID ──────────────
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id).trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
    const existing = (await db.query(
      'SELECT id, code, protocol FROM card_authorizations WHERE id = ? LIMIT 1', [id]
    )).rows[0] as any;
    if (!existing) return res.status(404).json({ ok: false, error: 'Auth code not found' });
    await db.query('DELETE FROM card_authorizations WHERE id = ?', [id]);
    return res.json({ ok: true, deleted: { id, code: existing.code, protocol: existing.protocol } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /api/card-auth/all — delete ALL auth codes ────────────────────────
router.delete('/all/purge', authenticateToken, async (_req: Request, res: Response) => {
  try {
    await db.query('DELETE FROM card_authorizations');
    return res.json({ ok: true, message: 'All auth codes deleted' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export { router as cardAuthRouter };
