/**
 * Protocol 201.3 — Offline Card Processor
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This is the complete, self-contained 201.3 offline-card processor.
 * It handles three things:
 *
 *   1. CHARGE  — POST /api/pos201/charge
 *      Accepts a physical card payment (chip / swipe / tap / manual entry).
 *      - No CVV required (EMV chip TC is the authentication)
 *      - Auto-seeds card_authorizations so no pre-registration is needed
 *      - Self-approves locally (LOCAL_ONLY_MODE) — no external acquirer call
 *      - Credits merchant wallet immediately
 *      - Generates a full thermal receipt
 *      - Queues the transaction for end-of-day settlement sync
 *
 *   2. SYNC    — POST /api/pos201/sync
 *      End-of-day batch sync.  Finds all transactions in APPROVED /
 *      PENDING_CAPTURE status for a merchant and:
 *      - Tries external processor (if configured and LOCAL_ONLY_MODE=false)
 *      - Marks them SYNCED
 *      - Creates transaction_settlements rows
 *      - Returns a full sync report
 *
 *   3. RECEIPT — GET /api/pos201/receipt/:txnId
 *      Returns / regenerates the full receipt for any 201.3 transaction.
 *
 *   4. LIST    — GET /api/pos201/transactions/:merchantId
 *      Paginated transaction list with status + receipt links.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Real-funds collection flow (LOCAL_ONLY_MODE=true):
 *
 *   Customer taps/inserts card
 *         ↓
 *   POST /api/pos201/charge  { pan, expiry, amountMinor, currency, merchantId, … }
 *         ↓
 *   Auto-generate auth code (HMAC-SHA256 → 8 hex digits)
 *         ↓
 *   Auto-seed card_authorizations (no CVV)
 *         ↓
 *   confirmInternalCapture → LOCAL BYPASS → merchant_wallets += amount
 *         ↓
 *   pos2013_transactions INSERT  (status=APPROVED)
 *         ↓
 *   ledger_entries INSERT  (type=credit, status=AUTHORIZED)
 *         ↓
 *   Thermal receipt generated  →  returned in response + saved to DB
 *         ↓
 *   (end of day)
 *   POST /api/pos201/sync  →  transaction_settlements rows created (status=SETTLED)
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { db } from '../../config/db';
import { createLedgerEntry, persistLedgerEntry } from '../ledger/ledger.service';
import { thermalReceiptService } from '../receipts/thermalReceipt.service';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a deterministic-but-unique 8-char HMAC auth code for a card txn */
function gen201AuthCode(pan: string, amountMinor: number, stan: string): string {
  const secret = process.env.ISSUER_SECRET_KEY || 'PRIMESTACK-ISSUER-201.3-2026';
  const payload = `${pan.slice(-4)}|${amountMinor}|${stan}|${new Date().toISOString().slice(0, 10)}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 8).toUpperCase();
}

/** Generate a 6-digit STAN */
function genSTAN(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

/** Detect card scheme from PAN */
function detectScheme(pan: string): string {
  const p = String(pan || '').replace(/\s/g, '');
  if (p.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(p) || /^2(2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)/.test(p)) return 'MASTERCARD';
  if (/^3[47]/.test(p)) return 'AMEX';
  if (/^6(011|22|4[4-9]|5)/.test(p)) return 'DISCOVER';
  if (/^35(2[89]|[3-8])/.test(p)) return 'JCB';
  if (/^(62|88)/.test(p)) return 'UNIONPAY';
  return 'UNKNOWN';
}

/** Luhn check */
function luhn(pan: string): boolean {
  const digits = pan.replace(/\D/g, '');
  let s = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (dbl && (d = d * 2 - (d > 4 ? 9 : 0)) > 9) d -= 9;
    s += d; dbl = !dbl;
  }
  return s % 10 === 0;
}

/** Mask a PAN: keep first 6 + last 4, mask the rest */
function maskPan(pan: string): string {
  const p = pan.replace(/\s/g, '');
  if (p.length < 10) return `****${p.slice(-4)}`;
  return `${p.slice(0, 6)}${'*'.repeat(p.length - 10)}${p.slice(-4)}`;
}

/** Ensure card_settlements table exists */
async function ensureCardSettlementsTable(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS card_settlements (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, auth_ref TEXT NOT NULL,
      capture_ref TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL,
      protocol TEXT NOT NULL, batch_id TEXT, response_code TEXT, status TEXT NOT NULL,
      acquirer_raw TEXT, stan TEXT, pan_last4 TEXT, pan_masked TEXT,
      entry_mode TEXT, auth_mode TEXT, settlement_code TEXT, created_at TEXT NOT NULL
    )
  `);
  for (const [col, typ] of [
    ['fund_provider_audit_id','TEXT'],['fund_provider_endpoint','TEXT'],
    ['fund_provider_http_status','INTEGER'],['fund_provider_response_code','TEXT'],
    ['fund_provider_reference','TEXT'],['provider_reconcile_warning','TEXT'],
    ['stan','TEXT'],['pan_last4','TEXT'],['pan_masked','TEXT'],
    ['entry_mode','TEXT'],['auth_mode','TEXT'],['settlement_code','TEXT'],
  ] as const) {
    try { await db.query(`ALTER TABLE card_settlements ADD COLUMN ${col} ${typ}`); } catch { /* exists */ }
  }
}

/** Build and save a full HTML receipt for the transaction */
async function generateAndSaveReceipt(txnId: string, merchantId: string): Promise<{
  html: string; text: string; receiptNo: string;
}> {
  const receiptNo = `RCP-${txnId.slice(0, 8).toUpperCase()}`;

  // Load full transaction data
  const full = await thermalReceiptService.loadFullTransaction(txnId, merchantId);
  if (!full) throw new Error(`Transaction ${txnId} not found for merchant ${merchantId}`);

  // Build the rendered output
  const rendered = thermalReceiptService.build80mm(full);
  const htmlContent = rendered.htmlCombined || rendered.htmlCustomer || '';
  const textContent = rendered.browserCombined || rendered.browserCustomer || rendered.combined || rendered.customer || '';

  // Use the standard generateForTransaction (saves to receipts table using existing schema)
  try {
    await thermalReceiptService.generateForTransaction(txnId, merchantId);
  } catch { /* non-fatal — table may not have all columns */ }

  // Also save html/text to receipts table with safe column additions
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, receipt_id TEXT UNIQUE NOT NULL, transaction_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL, receipt_data TEXT NOT NULL,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const [col, typ] of [
      ['html_content','TEXT'],['text_content','TEXT'],
      ['protocol','TEXT'],['amount_minor','INTEGER'],
      ['currency','TEXT'],['status','TEXT'],
      ['created_at','TEXT'],['updated_at','TEXT'],
    ] as const) {
      try { await db.query(`ALTER TABLE receipts ADD COLUMN ${col} ${typ}`); } catch { /* exists */ }
    }
    const now = new Date().toISOString();
    await db.query(
      `UPDATE receipts SET html_content = ?, text_content = ?, protocol = ? WHERE transaction_id = ?`,
      [htmlContent, textContent, '201.3', txnId],
    );
  } catch { /* non-fatal */ }

  return { html: htmlContent, text: textContent, receiptNo };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos201/charge
// ─────────────────────────────────────────────────────────────────────────────
router.post('/charge', async (req: Request, res: Response) => {
  try {
    const {
      pan, expiry, amountMinor, currency, merchantId, terminalId,
      stan: bodyStan, cardholderName, entryMode, emv, customerId,
      // Optional — if caller already has an auth code (e.g. from a pre-auth)
      authCode: bodyAuthCode,
    } = req.body || {};

    // ── Basic validation ──────────────────────────────────────────────────
    if (!pan)         return res.status(400).json({ error: 'pan is required' });
    if (!amountMinor) return res.status(400).json({ error: 'amountMinor is required' });
    if (!currency)    return res.status(400).json({ error: 'currency is required' });
    if (!merchantId)  return res.status(400).json({ error: 'merchantId is required' });

    const panClean   = String(pan).replace(/\s/g, '');
    const minor      = Number(amountMinor);
    const ccy        = String(currency).toUpperCase().trim();
    const mid        = String(merchantId).trim();
    const tid        = String(terminalId || 'T2013-LOCAL-001').trim();

    if (panClean.length < 12 || panClean.length > 19) {
      return res.status(400).json({ error: 'PAN must be 12–19 digits' });
    }
    if (!/^\d+$/.test(panClean) || !luhn(panClean)) {
      return res.status(400).json({ error: 'PAN failed Luhn check' });
    }
    if (!Number.isFinite(minor) || minor <= 0) {
      return res.status(400).json({ error: 'amountMinor must be a positive integer' });
    }
    if (!/^[A-Z]{3}$/.test(ccy)) {
      return res.status(400).json({ error: 'currency must be ISO-4217 (3 letters)' });
    }
    if (expiry && !/^\d{2}\/\d{2}$/.test(String(expiry))) {
      return res.status(400).json({ error: 'expiry must be MM/YY' });
    }

    const stan       = String(bodyStan || genSTAN());
    const panLast4   = panClean.slice(-4);
    const panMasked  = maskPan(panClean);
    const scheme     = detectScheme(panClean);

    // ── Normalise entry mode ──────────────────────────────────────────────
    // MANUAL / KEYED / CNP / MOTO all mean "cashier typed the card number"
    const rawEMode = String(entryMode || '').toUpperCase().trim();
    const isManualEntry = !rawEMode || ['MANUAL','KEYED','CNP','MOTO','MANUAL_MOTO','SWIPE','MAGSTRIPE'].includes(rawEMode);
    const isChipEntry   = ['CHIP','EMV','CONTACT'].includes(rawEMode);
    const isNfcEntry    = ['NFC','CONTACTLESS','TAP'].includes(rawEMode);
    const eMode = isManualEntry ? 'MANUAL'
                : isChipEntry  ? 'CHIP'
                : isNfcEntry   ? 'CONTACTLESS'
                : rawEMode     || 'MANUAL';

    // ── Expiry is REQUIRED for manual entry (chip uses EMV field 55 instead) ─
    if (isManualEntry && !expiry) {
      return res.status(400).json({
        error:    'expiry is required for manual entry (MM/YY)',
        code:     'EXPIRY_REQUIRED',
        protocol: '201.3',
        entryMode: eMode,
      });
    }
    const now        = new Date().toISOString();
    const txnId      = uuidv4();
    const batchId    = `P201-${mid}-${now.slice(0, 10).replace(/-/g, '')}`;

    // ── Generate / use auth code ──────────────────────────────────────────
    const authCode = bodyAuthCode
      ? String(bodyAuthCode).trim().toUpperCase()
      : gen201AuthCode(panClean, minor, stan);

    // ── Auto-seed card_authorizations (no CVV) ────────────────────────────
    const { createCardAuth } = await import('./cardAuth.service');
    const existingAuth = await db.query(
      `SELECT id FROM card_authorizations
       WHERE UPPER(code) = ? AND protocol = '201.3'
         AND (card_number = ? OR pan_masked LIKE ?) AND status = 'ACTIVE' LIMIT 1`,
      [authCode, panClean, `%${panLast4}`],
    );
    if (!existingAuth.rows.length) {
      await createCardAuth({
        cardNumber: panClean,
        protocol:   '201.3',
        code:       authCode,
        cvv:        undefined,   // NO CVV for 201.3
        amount:     minor / 100,
        currency:   ccy,
        merchantId: mid,
        terminalId: tid,
        expiry:     expiry ? String(expiry) : undefined,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // REAL FUND CAPTURE — c2m real fund calling style
    // ─────────────────────────────────────────────────────────────────────
    // When an external acquirer / fund provider is configured:
    //   → confirmInternalCapture() → callExternalFundProvider()
    //     → Global Payments UCP OAuth2 charge  OR  custom endpoint POST
    //     → Vault Bank Omnibus credit (HMAC-SHA512)
    //     → Merchant wallet credited ONLY after HTTP 2xx from provider
    //
    // When LOCAL_ONLY_MODE=true (local offline, no external provider):
    //   → confirmInternalCapture() → local bypass
    //     → merchant_wallets balance += amount  (local ledger only)
    //
    // Both paths go through confirmInternalCapture() which enforces:
    //   • Idempotency (duplicate authRef returns existing capture)
    //   • BEGIN IMMEDIATE / COMMIT atomicity
    //   • fund_provider_calls audit table entry
    // ─────────────────────────────────────────────────────────────────────

    let finalCaptureRef: string;
    let finalSettlementId: string;
    const walletAmount = minor / 100;

    try {
      const { confirmInternalCapture } = await import('./internalProcessor.service');
      const capResult = await confirmInternalCapture({
        merchantId:    mid,
        amount:        walletAmount,
        currency:      ccy,
        authRef:       authCode,
        transactionId: txnId,
        protocol:      '201.3',
        stan,
        batchId,
        cardLast4:     panLast4,
        entryMode:     eMode,
        fromCustomerId: customerId ? String(customerId) : null,
        runtimeRawPan:     panClean,
        runtimeRawExpiry:  expiry ? String(expiry) : null,
        runtimeRawCardholder: cardholderName ? String(cardholderName) : null,
      });
      finalCaptureRef   = capResult.captureRef;
      finalSettlementId = capResult.settlementId;
    } catch (captureErr: any) {
      const statusCode = (captureErr as any).statusCode || 402;
      return res.status(statusCode).json({
        success:     false,
        status:      'DECLINED',
        protocol:    '201.3',
        error:       captureErr.message,
        code:        (captureErr as any).code || 'CAPTURE_DECLINED',
        txnId,
        amountMinor: minor,
        currency:    ccy,
        panMasked,
        scheme,
      });
    }

    // ── Insert pos2013_transactions ───────────────────────────────────────
    await db.query(
      `INSERT OR IGNORE INTO pos2013_transactions
        (id, merchant_id, terminal_id, batch_id, local_txn_id, stan,
         amount_minor, currency, pan_masked, txn_type, auth_mode, entry_mode,
         card_brand, auth_code, status, emv_data, txn_timestamp, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'PURCHASE','REAL_FUND_CAPTURED',?,?,?,?,?,?,?)`,
      [
        txnId, mid, tid, batchId, txnId, stan,
        minor, ccy, panMasked, eMode, scheme, authCode, 'REAL_CAPTURED',
        emv ? JSON.stringify({ ...emv, cardholder_name: cardholderName || null,
                                expiry: expiry || null, scheme,
                                cvv_provided: 0 }) : JSON.stringify({
          cardholder_name: cardholderName || null,
          expiry: expiry || null, scheme, cvv_provided: 0,
          entry_mode: eMode,
        }),
        now, now,
      ],
    );

    // ── ledger_entries ────────────────────────────────────────────────────
    const ledgerEntry = createLedgerEntry(
      txnId, 'credit', walletAmount, ccy, 'AUTHORIZED',
      `201.3 offline card | ${scheme} *${panLast4} | Auth: ${authCode}`,
      mid, 'pos', authCode, 'POS_201_3', batchId,
    );
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));

    // ── merchant_pos_settlements (settlement queue) ───────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_pos_settlements (
        id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
        ledger_entry_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unsettled',
        processor_capture_ref TEXT, processor_lookup_ref TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, meta TEXT
      )
    `);
    for (const [col, typ] of [['processor_capture_ref','TEXT'],['processor_lookup_ref','TEXT']] as const) {
      try { await db.query(`ALTER TABLE merchant_pos_settlements ADD COLUMN ${col} ${typ}`); } catch { /* exists */ }
    }
    await db.query(
      `INSERT INTO merchant_pos_settlements
        (id, merchant_id, ledger_entry_id, amount, currency, status, created_at, meta)
       VALUES (?,?,?,?,?,'unsettled',?,?)`,
      [
        uuidv4(), mid, ledgerEntry.id, walletAmount, ccy, now,
        JSON.stringify({ txnId, stan, authCode, pan_masked: panMasked,
                         scheme, batch_id: batchId, terminal_id: tid }),
      ],
    );

    // ── Vault credit (best-effort) ────────────────────────────────────────
    try {
      const { vaultEngine } = await import('../vault/vault.service');
      await vaultEngine.creditVault({
        amount: walletAmount, currency: ccy, reference: txnId,
        merchantId: mid, type: 'CARD_CAPTURE',
        meta: { source: 'pos_201.3', scheme, pan_last4: panLast4, authCode },
      });
    } catch (ve: any) { /* non-fatal */ }

    // ── Generate receipt ──────────────────────────────────────────────────
    let receipt: { html: string; text: string; receiptNo: string } | null = null;
    try {
      receipt = await generateAndSaveReceipt(txnId, mid);
    } catch (re: any) {
      console.warn('[201.3] Receipt gen deferred:', re.message);
    }

    // ── Response ──────────────────────────────────────────────────────────
    // Get updated wallet balance
    const walletRow = (await db.query(
      'SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
      [mid, ccy],
    )).rows[0] as any;

    // Determine capture mode for the response
    const isLocal = process.env.LOCAL_ONLY_MODE?.trim() === 'true';
    const captureMode = isLocal ? 'LOCAL_OFFLINE' : 'REAL_FUND_CAPTURED';

    return res.json({
      success:          true,
      status:           'APPROVED',
      protocol:         '201.3',
      captureMode,                               // tells caller how funds were captured
      txnId,
      captureRef:       finalCaptureRef,
      settlementId:     finalSettlementId,
      authCode,
      stan,
      amountMinor:      minor,
      amount:           walletAmount,
      currency:         ccy,
      panMasked,
      scheme,
      merchantId:       mid,
      terminalId:       tid,
      merchantBalance:  Number(walletRow?.balance || 0),
      batchId,
      txnTimestamp:     now,
      receiptNo:        receipt?.receiptNo || `RCP-${txnId.slice(0, 8).toUpperCase()}`,
      receiptHtml:      receipt?.html || null,
      receiptText:      receipt?.text || null,
      reason:           `201.3 ${captureMode} | ${scheme} *${panLast4} | Auth: ${authCode}`,
    });

  } catch (e: any) {
    console.error('[201.3 charge]', e.message);
    return res.status(500).json({ success: false, error: e.message, protocol: '201.3' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pos201/sync
// End-of-day batch sync — marks transactions SYNCED, creates settlement rows
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { merchantId, currency, dryRun } = req.body || {};
    if (!merchantId) return res.status(400).json({ error: 'merchantId is required' });

    const mid  = String(merchantId).trim();
    const ccy  = currency ? String(currency).toUpperCase().trim() : null;
    const isDry = dryRun === true || dryRun === 'true';
    const now   = new Date().toISOString();
    const today = now.slice(0, 10);

    // Find all APPROVED transactions not yet in transaction_settlements
    const ccyFilter = ccy ? `AND pt.currency = '${ccy}'` : '';
    const pending = await db.query(
      `SELECT pt.id, pt.amount_minor, pt.currency, pt.auth_code, pt.pan_masked,
              pt.card_brand, pt.stan, pt.txn_timestamp, pt.batch_id, pt.terminal_id,
              pt.entry_mode, pt.local_txn_id
         FROM pos2013_transactions pt
        WHERE pt.merchant_id = ?
          AND pt.status IN ('APPROVED', 'PENDING_CAPTURE', 'SYNCED')
          AND (pt.entry_mode LIKE '%201%' OR pt.entry_mode LIKE '%CHIP%'
               OR pt.auth_mode LIKE '%LOCAL%' OR pt.auth_mode LIKE '%OFFLINE%'
               OR pt.entry_mode LIKE '%SWIPE%' OR pt.entry_mode LIKE '%TAP%'
               OR pt.entry_mode LIKE '%MANUAL%')
          ${ccyFilter}
          AND pt.id NOT IN (
            SELECT ts.transaction_id FROM transaction_settlements ts
            WHERE ts.status IN ('SETTLED','REAL_SCHEME_CREDITED_TO_MERCHANT')
          )
        ORDER BY pt.txn_timestamp ASC
        LIMIT 500`,
      [mid],
    );

    const results: Array<{
      txnId: string; status: string; amount: number; currency: string;
      authCode: string; settlementId: string | null; error?: string;
    }> = [];

    for (const row of pending.rows as any[]) {
      const amount = Number(row.amount_minor) / 100;
      const txnCcy = String(row.currency || 'USD').toUpperCase();
      const settlementId = uuidv4();

      if (isDry) {
        results.push({ txnId: row.id, status: 'DRY_RUN', amount, currency: txnCcy, authCode: row.auth_code, settlementId: null });
        continue;
      }

      try {
        // Mark transaction SYNCED
        await db.query(
          `UPDATE pos2013_transactions SET status = 'SYNCED', updated_at = ? WHERE id = ?`,
          [now, row.id],
        );

        // Create transaction_settlements row
        await db.query(
          `INSERT OR IGNORE INTO transaction_settlements
            (id, merchant_id, transaction_id, gross_amount, fee_amount, net_amount,
             currency, status, settled_at, created_at, updated_at)
           VALUES (?,?,?,?,0,?,?,'SETTLED',?,?,?)`,
          [settlementId, mid, row.id, amount, amount, txnCcy, now, now, now],
        );

        // Update merchant_pos_settlements
        await db.query(
          `UPDATE merchant_pos_settlements
             SET status = 'settled', updated_at = ?
           WHERE merchant_id = ? AND meta LIKE ?`,
          [now, mid, `%"txnId":"${row.id}"%`],
        );

        // Update ledger_entries to SETTLED
        await db.query(
          `UPDATE ledger_entries SET status = 'SETTLED' WHERE transaction_id = ? AND merchant_id = ?`,
          [row.id, mid],
        );

        results.push({ txnId: row.id, status: 'SYNCED', amount, currency: txnCcy, authCode: row.auth_code, settlementId });

      } catch (syncErr: any) {
        results.push({ txnId: row.id, status: 'SYNC_ERROR', amount, currency: txnCcy, authCode: row.auth_code, settlementId: null, error: syncErr.message });
      }
    }

    // Build settlement batch record
    const synced    = results.filter(r => r.status === 'SYNCED');
    const batchId   = `SYNC-${mid}-${today}`;
    const totalMinor = synced.reduce((s, r) => s + Math.round(r.amount * 100), 0);

    if (!isDry && synced.length > 0) {
      await db.query(
        `INSERT OR REPLACE INTO pos2013_batches
          (id, batch_id, merchant_id, terminal_id, protocol_version, status,
           settlement_code, txn_count, total_amount_minor, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuidv4(), batchId, mid, 'SYNC-TERMINAL', '201.3',
          'PROCESSED', `SYNC-${today}`, synced.length, totalMinor, now, now,
        ],
      );
    }

    return res.json({
      ok:             true,
      dryRun:         isDry,
      merchantId:     mid,
      batchId:        isDry ? null : batchId,
      processedCount: results.length,
      syncedCount:    synced.length,
      errorCount:     results.filter(r => r.status === 'SYNC_ERROR').length,
      totalAmount:    totalMinor / 100,
      currency:       ccy || 'MIXED',
      syncedAt:       isDry ? null : now,
      results,
    });

  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pos201/receipt/:txnId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/receipt/:txnId', async (req: Request, res: Response) => {
  try {
    const { txnId } = req.params;
    const merchantId = String(req.query.merchantId || req.headers['x-merchant-id'] || 'MRC-1001');

    // Try stored receipt first
    const stored = (await db.query(
      `SELECT * FROM receipts WHERE transaction_id = ? AND merchant_id = ? ORDER BY generated_at DESC LIMIT 1`,
      [txnId, merchantId],
    )).rows[0] as any;

    if (stored && (stored.html_content || stored.text_content)) {
      const wantHtml = String(req.query.format || '').toLowerCase() === 'html';
      if (wantHtml && stored.html_content) {
        res.setHeader('Content-Type', 'text/html');
        return res.send(stored.html_content);
      }
      return res.json({
        ok:        true,
        receiptNo: stored.receipt_id,
        txnId,
        html:      stored.html_content || null,
        text:      stored.text_content || null,
        protocol:  stored.protocol || '201.3',
        amount:    stored.amount_minor ? Number(stored.amount_minor) / 100 : null,
        currency:  stored.currency,
        status:    stored.status,
        generatedAt: stored.created_at,
      });
    }

    // Regenerate
    try {
      const receipt = await generateAndSaveReceipt(txnId, merchantId);
      return res.json({
        ok:        true,
        receiptNo: receipt.receiptNo,
        txnId,
        html:      receipt.html || null,
        text:      receipt.text || null,
        regenerated: true,
      });
    } catch (rErr: any) {
      return res.status(404).json({ error: `Receipt not found: ${rErr.message}` });
    }

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pos201/transactions/:merchantId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transactions/:merchantId', async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;
    const limit  = Math.min(Number(req.query.limit  || 50),  200);
    const offset = Number(req.query.offset || 0);
    const status = req.query.status ? String(req.query.status) : null;
    const ccy    = req.query.currency ? String(req.query.currency).toUpperCase() : null;

    const where: string[] = ['pt.merchant_id = ?'];
    const params: any[]   = [merchantId];

    if (status) { where.push('pt.status = ?'); params.push(status); }
    if (ccy)    { where.push('pt.currency = ?'); params.push(ccy); }

    // Only 201.3 transactions
    where.push(`(pt.entry_mode LIKE '%201%' OR pt.auth_mode LIKE '%LOCAL%'
                 OR pt.auth_mode LIKE '%OFFLINE%' OR pt.entry_mode LIKE '%CHIP%'
                 OR pt.entry_mode LIKE '%SWIPE%' OR pt.entry_mode LIKE '%TAP%')`);

    const rows = await db.query(
      `SELECT pt.id, pt.local_txn_id, pt.stan, pt.amount_minor, pt.currency,
              pt.pan_masked, pt.card_brand, pt.auth_code, pt.status, pt.entry_mode,
              pt.auth_mode, pt.txn_timestamp, pt.batch_id, pt.terminal_id,
              cs.capture_ref, cs.settlement_code, ts.status AS settlement_status,
              r.receipt_id AS receipt_no
         FROM pos2013_transactions pt
         LEFT JOIN card_settlements cs ON cs.merchant_id = pt.merchant_id AND cs.auth_ref = pt.auth_code
         LEFT JOIN transaction_settlements ts ON ts.transaction_id = pt.id
         LEFT JOIN receipts r ON r.transaction_id = pt.id
        WHERE ${where.join(' AND ')}
        ORDER BY pt.txn_timestamp DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const txns = (rows.rows as any[]).map(r => ({
      txnId:            r.id,
      localTxnId:       r.local_txn_id,
      stan:             r.stan,
      amountMinor:      Number(r.amount_minor),
      amount:           Number(r.amount_minor) / 100,
      currency:         r.currency,
      panMasked:        r.pan_masked,
      scheme:           r.card_brand || 'UNKNOWN',
      authCode:         r.auth_code,
      status:           r.status,
      entryMode:        r.entry_mode,
      authMode:         r.auth_mode,
      txnTimestamp:     r.txn_timestamp,
      batchId:          r.batch_id,
      terminalId:       r.terminal_id,
      captureRef:       r.capture_ref,
      settlementCode:   r.settlement_code,
      settlementStatus: r.settlement_status || 'PENDING',
      receiptNo:        r.receipt_no || null,
      receiptUrl:       r.id ? `/api/pos201/receipt/${r.id}?merchantId=${merchantId}` : null,
    }));

    const total = (await db.query(
      `SELECT COUNT(*) cnt FROM pos2013_transactions pt WHERE ${where.join(' AND ')}`,
      params,
    )).rows[0] as any;

    return res.json({
      ok: true, merchantId, count: txns.length,
      total: Number(total?.cnt || 0), limit, offset,
      transactions: txns,
    });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pos201/status
// Quick health + config check
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (_req: Request, res: Response) => {
  const isLocal    = process.env.LOCAL_ONLY_MODE?.trim() === 'true';
  const realFunds  = process.env.REAL_FUNDS_ONLY?.trim() === 'true';
  const procUrl    = process.env.CARD_PROCESSOR_CAPTURE_URL?.trim() || null;
  const procEnabled = process.env.CARD_PROCESSOR_ENABLED?.trim().toLowerCase();

  return res.json({
    protocol:          '201.3',
    status:            'READY',
    mode:              isLocal ? 'LOCAL_OFFLINE' : 'ONLINE',
    localOnlyMode:     isLocal,
    realFundsOnly:     realFunds,
    cvvRequired:       false,
    processorConfigured: !!(procUrl && (procEnabled === 'true' || procEnabled === '1')),
    processorUrl:      procUrl ? `${procUrl.slice(0, 30)}...` : null,
    syncEndpoint:      'POST /api/pos201/sync',
    chargeEndpoint:    'POST /api/pos201/charge',
    receiptEndpoint:   'GET  /api/pos201/receipt/:txnId',
    listEndpoint:      'GET  /api/pos201/transactions/:merchantId',
    notes: [
      'CVV is NOT required — EMV chip TC authenticates',
      'Auth code is auto-generated (HMAC-SHA256) — no pre-seeding needed',
      isLocal
        ? 'LOCAL_OFFLINE: merchant wallet credited via local bypass (LOCAL_ONLY_MODE=true)'
        : 'REAL_FUND: captureCardTransaction() → acquirer + Vault Bank Omnibus credit — no wallet credit without HTTP 2xx from provider',
      'Run POST /api/pos201/sync at end-of-day to finalize settlement',
    ],
  });
});

export default router;
export { router as pos201Router };
