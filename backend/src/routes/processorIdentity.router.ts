/**
 * Terminal Identity Router — /api/processor
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles:
 *   GET  /api/processor/identity          — processor-level credentials
 *   GET  /api/processor/terminals         — all terminals with identity
 *   POST /api/processor/terminals/register — register a new terminal
 *   POST /api/processor/terminals/:id/activate — activate a terminal
 *   GET  /api/processor/terminals/:id      — single terminal identity
 *   POST /api/processor/terminals/:id/regenerate — regenerate identity
 */

import { Router } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateActivationCode(): string {
  const seg = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ACT-${seg()}-${seg()}-${seg()}-${seg()}`;
}

function generateIMEI(): string {
  const tac    = '35' + String(Math.floor(Math.random() * 900000 + 100000));
  const serial = String(Math.floor(Math.random() * 900000 + 100000));
  const base   = tac + serial;
  let sum = 0, double = false;
  for (let i = base.length - 1; i >= 0; i--) {
    let d = parseInt(base[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return base + ((10 - (sum % 10)) % 10);
}

function generateIMSI(): string {
  // MCC 310 (USA) + MNC 410 (AT&T) + 10-digit MSIN
  return '310410' + String(Math.floor(Math.random() * 9000000000 + 1000000000));
}

function getProcessorIdentity() {
  return {
    name:            process.env.PROCESSOR_NAME            || 'PRIMESTACK PAYMENT PROCESSOR',
    activationCode:  process.env.PROCESSOR_ACTIVATION_CODE || 'ACT-A27C17-F5ACC8-28765D-CD91DC',
    model:           process.env.PROCESSOR_MODEL           || 'PRIMESTACK-POS-201.3',
    version:         process.env.PROCESSOR_VERSION         || '2.1.3',
    ip:              process.env.PROCESSOR_IP               || '177.246.47.140',
    imei:            process.env.PROCESSOR_IMEI             || '353044192323970',
    imsi:            process.env.PROCESSOR_IMSI             || '310410763505944',
    apiKey:          process.env.PROCESSOR_API_KEY         || 'PSPK-58878214D6B132F04B00617DD52213F1D8CF989FB65056AF',
    keyId:           process.env.PROCESSOR_KEY_ID          || 'PRIMESTACK-B4C329F83258',
    host:            process.env.PROCESSOR_HOST            || `http://localhost:${process.env.PORT || 7000}`,
    merchantId:      process.env.PROCESSOR_MERCHANT_ID     || 'MRC-1001',
    terminalId:      process.env.PROCESSOR_TERMINAL_ID     || 'T2013-001',
    protocol:        process.env.PROCESSOR_PROTOCOL        || '201.3',
    floorLimit:      Number(process.env.PROCESSOR_FLOOR_LIMIT || 150000),
  };
}

// ── GET /api/processor/identity ──────────────────────────────────────────────
router.get('/identity', authenticateToken, (_req, res) => {
  return res.json({ ok: true, processor: getProcessorIdentity() });
});

// ── GET /api/processor/terminals ─────────────────────────────────────────────
router.get('/terminals', authenticateToken, async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, terminal_id, merchant_id, name, activation_code, model, version,
              ip_address, imei, imsi, activated, activated_at, registered_by,
              offline_enabled, floor_limit, created_at
       FROM terminals ORDER BY created_at DESC`
    );
    return res.json({ ok: true, count: rows.rows.length, terminals: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/processor/terminals/:id ─────────────────────────────────────────
router.get('/terminals/:id', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, terminal_id, merchant_id, name, activation_code, model, version,
              ip_address, imei, imsi, activated, activated_at, registered_by,
              offline_enabled, floor_limit, created_at
       FROM terminals WHERE terminal_id = ? OR id = ? LIMIT 1`,
      [req.params.id, req.params.id]
    );
    if (!rows.rows.length) return res.status(404).json({ ok: false, error: 'Terminal not found' });
    return res.json({ ok: true, terminal: rows.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/processor/terminals/register ────────────────────────────────────
router.post('/terminals/register', authenticateToken, async (req, res) => {
  try {
    const { terminalId, merchantId, name, model, version, ipAddress, imei, imsi } = req.body || {};
    if (!terminalId || !merchantId) {
      return res.status(400).json({ ok: false, error: 'terminalId and merchantId are required' });
    }
    const existing = await db.query('SELECT id FROM terminals WHERE terminal_id = ?', [terminalId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: `Terminal ${terminalId} already registered` });
    }

    const activationCode = generateActivationCode();
    const termImei       = imei  || generateIMEI();
    const termImsi       = imsi  || generateIMSI();
    const now            = new Date().toISOString();
    const id             = uuidv4();

    await db.query(
      `INSERT INTO terminals
        (id, terminal_id, merchant_id, name, terminal_secret,
         offline_enabled, floor_limit,
         activation_code, model, version, ip_address, imei, imsi,
         activated, activated_at, registered_by, created_at, updated_at)
       VALUES (?,?,?,?,?,1,150000,?,?,?,?,?,?,1,?,?,?,?)`,
      [
        id, terminalId, merchantId,
        name || `Terminal ${terminalId}`,
        `secret_${terminalId.toLowerCase()}`,
        activationCode,
        model   || process.env.PROCESSOR_MODEL   || 'PRIMESTACK-POS-201.3',
        version || process.env.PROCESSOR_VERSION || '2.1.3',
        ipAddress || process.env.PROCESSOR_IP    || '177.246.47.140',
        termImei, termImsi,
        now, 'admin', now, now,
      ]
    );

    return res.status(201).json({
      ok: true,
      terminal: {
        id, terminalId, merchantId,
        activationCode, model: model || 'PRIMESTACK-POS-201.3',
        version: version || '2.1.3',
        ipAddress: ipAddress || '177.246.47.140',
        imei: termImei, imsi: termImsi,
        activated: true, activatedAt: now,
        offlineEnabled: true, floorLimit: 150000,
      },
      message: `Terminal ${terminalId} registered and activated`,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/processor/terminals/:id/activate ───────────────────────────────
router.post('/terminals/:id/activate', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM terminals WHERE terminal_id = ? OR id = ? LIMIT 1',
      [req.params.id, req.params.id]
    );
    if (!rows.rows.length) return res.status(404).json({ ok: false, error: 'Terminal not found' });
    const t   = rows.rows[0] as any;
    const now = new Date().toISOString();
    const activationCode = t.activation_code || generateActivationCode();
    const imei = t.imei || generateIMEI();
    const imsi = t.imsi || generateIMSI();
    await db.query(
      `UPDATE terminals SET activation_code=?, model=?, version=?, ip_address=?, imei=?, imsi=?,
       activated=1, activated_at=?, updated_at=? WHERE id=?`,
      [
        activationCode,
        t.model   || process.env.PROCESSOR_MODEL   || 'PRIMESTACK-POS-201.3',
        t.version || process.env.PROCESSOR_VERSION || '2.1.3',
        t.ip_address || req.body?.ipAddress || process.env.PROCESSOR_IP || '177.246.47.140',
        imei, imsi, now, now, t.id,
      ]
    );
    return res.json({ ok: true, terminalId: t.terminal_id, activationCode, imei, imsi, activatedAt: now });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/processor/terminals/:id/regenerate ─────────────────────────────
router.post('/terminals/:id/regenerate', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM terminals WHERE terminal_id = ? OR id = ? LIMIT 1',
      [req.params.id, req.params.id]
    );
    if (!rows.rows.length) return res.status(404).json({ ok: false, error: 'Terminal not found' });
    const t   = rows.rows[0] as any;
    const now = new Date().toISOString();
    const activationCode = generateActivationCode();
    const imei           = generateIMEI();
    const imsi           = generateIMSI();
    await db.query(
      `UPDATE terminals SET activation_code=?, imei=?, imsi=?, activated_at=?, updated_at=? WHERE id=?`,
      [activationCode, imei, imsi, now, now, t.id]
    );
    return res.json({
      ok: true, terminalId: t.terminal_id,
      newActivationCode: activationCode, newImei: imei, newImsi: imsi,
      regeneratedAt: now, message: 'Identity regenerated — update device with new credentials',
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;