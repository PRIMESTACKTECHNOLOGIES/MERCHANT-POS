/**
 * MT103 SWIFT Wire Router
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/payout/mt103/generate        — generate + store MT103 for a payout
 * GET  /api/payout/mt103/:merchantId     — list all MT103s for merchant
 * GET  /api/payout/mt103/download/:id    — download raw MT103 text file
 * POST /api/payout/mt103/:id/mark-sent   — mark MT103 as SENT
 * POST /api/payout/mt103/generate-from-balance — generate MT103 from merchant wallet balance
 */

import { Router } from 'express';
import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { generateMt103, buildMt103FromPayout } from './mt103.service';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

// ── Ensure mt103_payouts table exists ─────────────────────────────────────────
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mt103_payouts (
      id                TEXT PRIMARY KEY,
      merchant_id       TEXT NOT NULL,
      payout_id         TEXT,
      uetr              TEXT NOT NULL,
      internal_reference TEXT NOT NULL,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      value_date        TEXT NOT NULL,
      sender_bic        TEXT,
      sender_account    TEXT,
      sender_name       TEXT,
      beneficiary_bic   TEXT,
      beneficiary_account TEXT,
      beneficiary_name  TEXT,
      remittance_info   TEXT,
      charge_bearer     TEXT DEFAULT 'SHA',
      mt103_message     TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'DRAFT',
      sent_at           TEXT,
      confirmed_at      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ── POST /api/payout/mt103/generate ───────────────────────────────────────────
// Generate MT103 from a merchant payout record
router.post('/generate', authenticateToken, async (req, res) => {
  await ensureTable();
  const {
    merchantId, payoutId, amount, currency,
    bankAccount, remittanceInfo,
    // optional overrides
    senderBic, senderAccount, senderName, senderAddressLines,
    beneficiaryBic, beneficiaryAccount, beneficiaryName, beneficiaryAddressLines,
    chargeBearer,
    internalReference,
    valueDate,
    uetr,
  } = req.body || {};

  if (!merchantId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'merchantId and amount are required' });
  }

  try {
    // Resolve bank account if not provided
    let resolvedBank = bankAccount;
    if (!resolvedBank && payoutId) {
      const pRes = await db.query(
        `SELECT bank_account FROM merchant_payouts WHERE id = ? LIMIT 1`, [payoutId]
      );
      if (pRes.rows.length > 0) {
        try { resolvedBank = JSON.parse(pRes.rows[0].bank_account || '{}'); } catch { resolvedBank = {}; }
      }
    }
    if (!resolvedBank) {
      const baRes = await db.query(
        `SELECT * FROM bank_accounts WHERE merchant_id = ? AND is_default = 1 LIMIT 1`, [merchantId]
      );
      resolvedBank = baRes.rows[0] || {};
    }

    // Build payout params (allow overrides from body)
    const mt103Input = buildMt103FromPayout({
      payoutId:       payoutId || uuidv4(),
      amount:         Number(amount),
      currency:       String(currency || 'USD').toUpperCase(),
      bankAccount:    resolvedBank,
      merchantId,
      remittanceInfo,
    });

    // Apply any body overrides
    if (senderBic)              mt103Input.senderBic          = senderBic;
    if (senderAccount)          mt103Input.senderAccount      = senderAccount;
    if (senderName)             mt103Input.senderName         = senderName;
    if (senderAddressLines)     mt103Input.senderAddressLines = senderAddressLines;
    if (beneficiaryBic)         mt103Input.beneficiaryBic     = beneficiaryBic;
    if (beneficiaryAccount)     mt103Input.beneficiaryAccount = beneficiaryAccount;
    if (beneficiaryName)        mt103Input.beneficiaryName    = beneficiaryName;
    if (beneficiaryAddressLines) mt103Input.beneficiaryAddressLines = beneficiaryAddressLines;
    if (chargeBearer)           mt103Input.chargeBearer       = chargeBearer;
    if (internalReference)      mt103Input.internalReference  = String(internalReference).slice(0, 16).toUpperCase();
    if (valueDate)              mt103Input.valueDate          = String(valueDate);
    if (uetr)                   mt103Input.uetr              = String(uetr).toUpperCase();

    const result = generateMt103(mt103Input);
    const id = uuidv4();

    await db.query(`
      INSERT INTO mt103_payouts
        (id, merchant_id, payout_id, uetr, internal_reference, amount, currency,
         value_date, sender_bic, sender_account, sender_name,
         beneficiary_bic, beneficiary_account, beneficiary_name,
         remittance_info, charge_bearer, mt103_message, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',datetime('now'))
    `, [
      id, merchantId, payoutId || null, result.uetr,
      result.reference, result.amount, result.currency,
      result.valueDate,
      mt103Input.senderBic, mt103Input.senderAccount, mt103Input.senderName,
      mt103Input.beneficiaryBic, mt103Input.beneficiaryAccount, mt103Input.beneficiaryName,
      mt103Input.remittanceInfo || null,
      mt103Input.chargeBearer || 'SHA',
      result.message,
    ]);

    console.log(`[MT103] Generated ${result.reference} | UETR: ${result.uetr} | ${result.currency} ${result.amount}`);

    return res.json({
      ok: true,
      id,
      uetr:       result.uetr,
      reference:  result.reference,
      amount:     result.amount,
      currency:   result.currency,
      value_date: result.valueDate,
      status:     'DRAFT',
      message_preview: result.message.slice(0, 200) + '...',
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/payout/mt103/generate-from-balance ──────────────────────────────
// One-click: generate MT103 for full (or specified) merchant wallet balance
router.post('/generate-from-balance', authenticateToken, async (req, res) => {
  await ensureTable();
  const { merchantId = 'MRC-1001', currency = 'USD', amount: bodyAmount, remittanceInfo } = req.body || {};

  try {
    // Get merchant wallet balance
    const walletRes = await db.query(
      `SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
      [merchantId, String(currency).toUpperCase()]
    );
    const walletBalance = Number(walletRes.rows[0]?.balance || 0);
    const amount = bodyAmount ? Number(bodyAmount) : walletBalance;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: `No ${currency} balance available in merchant wallet` });
    }

    // Get default bank account
    const baRes = await db.query(
      `SELECT * FROM bank_accounts WHERE merchant_id = ? AND is_default = 1 LIMIT 1`,
      [merchantId]
    );
    const bankAccount = baRes.rows[0] || {};

    const mt103Input = buildMt103FromPayout({
      payoutId:    uuidv4(),
      amount,
      currency:    String(currency).toUpperCase(),
      bankAccount,
      merchantId,
      remittanceInfo: remittanceInfo || `POS 201.3 SETTLEMENT ${merchantId} ${new Date().toISOString().slice(0,10)}`,
    });

    const result = generateMt103(mt103Input);
    const id = uuidv4();

    await db.query(`
      INSERT INTO mt103_payouts
        (id, merchant_id, payout_id, uetr, internal_reference, amount, currency,
         value_date, sender_bic, sender_account, sender_name,
         beneficiary_bic, beneficiary_account, beneficiary_name,
         remittance_info, charge_bearer, mt103_message, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',datetime('now'))
    `, [
      id, merchantId, null, result.uetr,
      result.reference, result.amount, result.currency,
      result.valueDate,
      mt103Input.senderBic, mt103Input.senderAccount, mt103Input.senderName,
      mt103Input.beneficiaryBic, mt103Input.beneficiaryAccount, mt103Input.beneficiaryName,
      mt103Input.remittanceInfo || null,
      mt103Input.chargeBearer || 'SHA',
      result.message,
    ]);

    return res.json({
      ok: true,
      id,
      uetr:          result.uetr,
      reference:     result.reference,
      amount:        result.amount,
      currency:      result.currency,
      value_date:    result.valueDate,
      wallet_balance: walletBalance,
      status:        'DRAFT',
      message_preview: result.message.slice(0, 300) + '\n...',
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/payout/mt103/:merchantId ─────────────────────────────────────────
// List all MT103s for a merchant
router.get('/:merchantId', authenticateToken, async (req, res) => {
  await ensureTable();
  const { merchantId } = req.params as any;
  const limit = parseInt(req.query.limit as string) || 50;
  try {
    const rows = await db.query(
      `SELECT id, uetr, internal_reference, amount, currency, value_date,
              beneficiary_name, beneficiary_account, beneficiary_bic,
              status, sent_at, confirmed_at, created_at
       FROM mt103_payouts
       WHERE merchant_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [merchantId, limit]
    );
    return res.json({
      ok: true,
      merchant_id: merchantId,
      count: rows.rows.length,
      mt103s: rows.rows,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/payout/mt103/download/:id ────────────────────────────────────────
// Download raw MT103 text file
router.get('/download/:id', authenticateToken, async (req, res) => {
  await ensureTable();
  const { id } = req.params as any;
  try {
    const row = await db.query(
      `SELECT * FROM mt103_payouts WHERE id = ? LIMIT 1`, [id]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'MT103 not found' });
    const mt = row.rows[0] as any;
    const filename = `MT103-${mt.internal_reference}-${mt.value_date}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(mt.mt103_message);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/payout/mt103/:id/mark-sent ──────────────────────────────────────
// Mark MT103 as SENT (after uploading to bank)
router.post('/:id/mark-sent', authenticateToken, async (req, res) => {
  await ensureTable();
  const { id } = req.params as any;
  const { confirmed_ref } = req.body || {};
  try {
    await db.query(
      `UPDATE mt103_payouts SET status = 'SENT', sent_at = datetime('now') WHERE id = ?`, [id]
    );
    if (confirmed_ref) {
      await db.query(
        `UPDATE mt103_payouts SET status = 'CONFIRMED', confirmed_at = datetime('now') WHERE id = ?`, [id]
      );
    }
    return res.json({ ok: true, id, status: confirmed_ref ? 'CONFIRMED' : 'SENT' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export { router as mt103Router };
