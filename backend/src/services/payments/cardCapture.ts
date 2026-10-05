/**
 * Card Capture Service (Protocol 201.3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the acquirer to capture a previously authorized transaction,
 * then credits the selected customer wallet and records the settlement.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { isAcquirerConfigured, acquirerConfig } from '../../config/acquirer';
import { getAcquirerClient } from '../acquirer/HttpAcquirerClient';
import { walletsService } from '../../domain/wallets/wallets.service';

export interface CardCaptureParams {
  merchantId:    string;
  customerId:    string;
  terminalId?:   string;
  amount:        number;
  currency?:     string;
  authRef:       string;          // from cardAuthorization result
  transactionId?: string;         // internal ID from cardAuthorization
  stan?:         string;
  batchId?:      string;
}

export interface CardCaptureResult {
  success:       boolean;
  captureRef:    string;
  responseCode:  string;
  amount:        number;
  currency:      string;
  settlementId:  string;
  message?:      string;
}

export async function captureCardTransaction(
  params: CardCaptureParams
): Promise<CardCaptureResult> {

  const ccy         = String(params.currency || 'USD').toUpperCase().trim();
  const amountMinor = Math.round(params.amount * 100);
  const stan        = params.stan || String(Date.now()).slice(-6);
  const terminalId  = params.terminalId || 'WEB-TERMINAL';

  if (!params.merchantId?.trim() || !params.customerId?.trim() || !params.authRef?.trim()
    || !Number.isFinite(params.amount) || params.amount <= 0
    || !/^[A-Z]{3}$/.test(ccy) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Invalid merchant, authorization, amount, or currency');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_settlements (
      id              TEXT PRIMARY KEY,
      merchant_id     TEXT NOT NULL,
      customer_id     TEXT NOT NULL,
      auth_ref        TEXT NOT NULL,
      capture_ref     TEXT NOT NULL,
      amount          REAL NOT NULL,
      currency        TEXT NOT NULL,
      protocol        TEXT NOT NULL DEFAULT '201.3',
      batch_id        TEXT,
      response_code   TEXT,
      status          TEXT NOT NULL DEFAULT 'SETTLED',
      acquirer_raw    TEXT,
      created_at      TEXT NOT NULL
    )
  `);
  const settlementColumns = await db.query('PRAGMA table_info(card_settlements)');
  if (!settlementColumns.rows.some((column: any) => column.name === 'customer_id')) {
    await db.query('ALTER TABLE card_settlements ADD COLUMN customer_id TEXT');
  }

  const prior = await db.query(
    `SELECT * FROM card_settlements
      WHERE merchant_id = ? AND auth_ref = ?
      ORDER BY created_at DESC LIMIT 1`,
    [params.merchantId, params.authRef],
  );
  if (prior.rows?.length) {
    const row = prior.rows[0];
    if (Number(row.amount) !== params.amount || String(row.currency).toUpperCase() !== ccy) {
      throw new Error('Authorization was already captured for a different amount or currency');
    }
    return {
      success: true,
      captureRef: String(row.capture_ref),
      responseCode: String(row.response_code || '00'),
      amount: Number(row.amount),
      currency: String(row.currency),
      settlementId: String(row.id),
      message: 'Duplicate capture request replayed from stored settlement',
    };
  }

  if (!isAcquirerConfigured()) {
    throw new Error(
      'Real acquirer is not configured. Set ACQUIRER_HOST in backend/.env to enable live card capture.'
    );
  }

  // ── Call acquirer capture ────────────────────────────────────────────────────
  const client   = getAcquirerClient();
  const capRes   = await client.capture({
    merchantAccount: acquirerConfig.merchantId,
    amountMinor,
    currency:        ccy,
    authRef:         params.authRef,
    protocol:        '201.3',
    stan,
    terminalId,
  });

  if (!capRes.success) {
    throw new Error(
      `Capture failed: RC=${capRes.responseCode} — ${capRes.message || 'Declined by acquirer'}`
    );
  }

  const captureRef  = capRes.captureRef || `CAP-${uuidv4().slice(0, 8).toUpperCase()}`;
  const settlementId = uuidv4();
  const now          = new Date().toISOString();

  // ── Persist settlement and customer wallet credit atomically ────────────────
  try {
    const wallet = await walletsService.getOrCreateWallet(params.customerId, ccy);
    await db.query('BEGIN IMMEDIATE');
    await db.query(
      `INSERT INTO card_settlements
        (id, merchant_id, customer_id, auth_ref, capture_ref, amount, currency, protocol, batch_id, response_code, acquirer_raw, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        settlementId, params.merchantId, params.customerId, params.authRef, captureRef, params.amount, ccy,
        '201.3', params.batchId || null, capRes.responseCode, JSON.stringify(capRes.raw || {}), now,
      ],
    );
    await db.query(
      'UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
      [params.amount, now, wallet.id]
    );
    await db.query(`
      INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, currency, source, reference, description, created_at)
      VALUES (?, ?, 'credit', ?, ?, 'card_capture', ?, ?, ?)
    `, [
      uuidv4(), wallet.id,
      params.amount, ccy,
      captureRef,
      `Provider-captured POS funds — Protocol 201.3 | Auth: ${params.authRef}`,
      now,
    ]);
    await db.query('COMMIT');
  } catch (walletErr: any) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    console.error('[cardCapture] Customer wallet credit failed:', walletErr.message);
    throw new Error(`Card capture succeeded at the acquirer, but customer wallet credit failed: ${walletErr.message}`);
  }

  // ── Update authorization record ──────────────────────────────────────────────
  if (params.transactionId) {
    try {
      await db.query(
        `UPDATE card_authorizations SET status = 'CAPTURED', captured_at = ? WHERE id = ?`,
        [now, params.transactionId]
      );
    } catch { /* ignore */ }
  }

  console.log(`[Acquirer] Capture 201.3 | ${ccy} ${params.amount} | RC=${capRes.responseCode} | CaptureRef=${captureRef} | Customer=${params.customerId}`);

  return {
    success:      true,
    captureRef,
    responseCode: capRes.responseCode,
    amount:       params.amount,
    currency:     ccy,
    settlementId,
    message:      capRes.message,
  };
}
