/**
 * Card Authorization Service (101.1 / 101.6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the real acquirer, stores the authorization in the DB,
 * and returns a structured result for the POS to record.
 *
 * Protocol 101.1 = manual/voice auth (card + expiry, no CVV required)
 * Protocol 101.6 = online EMV chip auth (card + expiry + EMV field 55)
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { isAcquirerConfigured, acquirerConfig } from '../../config/acquirer';
import { getAcquirerClient } from '../acquirer/HttpAcquirerClient';

export interface CardAuthorizationParams {
  merchantId:      string;
  terminalId?:     string;
  amount:          number;     // decimal, e.g. 25.00
  currency?:       string;
  protocol:        '101.1' | '101.6';
  cardNumber?:     string;     // 101.1: full PAN; 101.6: masked or omit
  expiry?:         string;     // MMYY
  cvv?:            string | null;
  emvField55?:     string;     // hex — 101.6 only
  stan?:           string;
  customerId?:     string;
}

export interface CardAuthorizationResult {
  success:       boolean;
  transactionId: string;
  authRef:       string;
  approvalCode:  string;
  responseCode:  string;
  amount:        number;
  currency:      string;
  protocol:      string;
  message?:      string;
}

export async function authorizeCardTransaction(
  params: CardAuthorizationParams
): Promise<CardAuthorizationResult> {

  const ccy        = String(params.currency || 'USD').toUpperCase().trim();
  const amountMinor = Math.round(params.amount * 100);
  const terminalId = params.terminalId || 'WEB-TERMINAL';
  const stan       = params.stan || String(Date.now()).slice(-6);

  if (!params.merchantId?.trim() || !Number.isFinite(params.amount) || params.amount <= 0
    || !/^[A-Z]{3}$/.test(ccy) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Invalid merchant, amount, or currency');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_authorizations (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      terminal_id TEXT,
      customer_id TEXT,
      amount REAL NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      protocol TEXT NOT NULL,
      stan TEXT,
      auth_ref TEXT NOT NULL,
      approval_code TEXT,
      response_code TEXT,
      pan_masked TEXT,
      expiry TEXT,
      status TEXT NOT NULL DEFAULT 'AUTHORIZED',
      captured_at TEXT,
      reversed_at TEXT,
      acquirer_raw TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const duplicate = await db.query(
    `SELECT * FROM card_authorizations
      WHERE merchant_id = ? AND terminal_id = ? AND stan = ?
        AND amount_minor = ? AND currency = ? AND created_at >= datetime('now', '-15 minutes')
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.merchantId, terminalId, stan, amountMinor, ccy],
  );
  if (duplicate.rows?.length) {
    const row = duplicate.rows[0];
    return {
      success: row.status === 'AUTHORIZED',
      transactionId: String(row.id),
      authRef: String(row.auth_ref),
      approvalCode: String(row.approval_code || ''),
      responseCode: String(row.response_code || (row.status === 'AUTHORIZED' ? '00' : '96')),
      amount: Number(row.amount),
      currency: String(row.currency),
      protocol: String(row.protocol),
      message: 'Duplicate authorization request replayed from stored response',
    };
  }

  const txnId      = uuidv4();

  // ── Check acquirer is configured ────────────────────────────────────────────
  if (!isAcquirerConfigured()) {
    throw new Error(
      'Real acquirer is not configured. Set ACQUIRER_HOST in backend/.env to enable live card authorization.'
    );
  }

  // ── Call acquirer ────────────────────────────────────────────────────────────
  const client  = getAcquirerClient();
  const authRes = await client.authorize({
    merchantAccount: acquirerConfig.merchantId,
    amountMinor,
    currency:        ccy,
    protocol:        params.protocol,
    cardNumber:      params.cardNumber,
    expiry:          params.expiry,
    cvv:             params.cvv,
    emvField55:      params.emvField55,
    stan,
    terminalId:      params.terminalId || 'WEB-TERMINAL',
    posEntryMode:    params.protocol === '101.1' ? '01' : params.emvField55 ? '05' : '01',
  });

  if (!authRes.success) {
    throw new Error(
      `Authorization failed: RC=${authRes.responseCode} — ${authRes.message || 'Declined by acquirer'}`
    );
  }

  if (!authRes.authRef || !authRes.approvalCode) {
    throw new Error('Acquirer did not provide the authorization reference and customer authorization code');
  }

  const authRef = authRes.authRef;
  const approvalCode = authRes.approvalCode;

  // ── Store authorization in DB ─────────────────────────────────────────────
  const now = new Date().toISOString();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS card_authorizations (
        id               TEXT PRIMARY KEY,
        merchant_id      TEXT NOT NULL,
        terminal_id      TEXT,
        customer_id      TEXT,
        amount           REAL NOT NULL,
        amount_minor     INTEGER NOT NULL,
        currency         TEXT NOT NULL,
        protocol         TEXT NOT NULL,
        stan             TEXT,
        auth_ref         TEXT NOT NULL,
        approval_code    TEXT,
        response_code    TEXT,
        pan_masked       TEXT,
        expiry           TEXT,
        status           TEXT NOT NULL DEFAULT 'AUTHORIZED',
        captured_at      TEXT,
        reversed_at      TEXT,
        acquirer_raw     TEXT,
        created_at       TEXT NOT NULL
      )
    `);

    const panMasked = params.cardNumber
      ? `****${String(params.cardNumber).replace(/\s/g, '').slice(-4)}`
      : '****';

    await db.query(`
      INSERT INTO card_authorizations
        (id, merchant_id, terminal_id, customer_id, amount, amount_minor,
         currency, protocol, stan, auth_ref, approval_code, response_code,
         pan_masked, expiry, status, acquirer_raw, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'AUTHORIZED',?,?)
    `, [
      txnId,
      params.merchantId,
      terminalId,
      params.customerId || null,
      params.amount,
      amountMinor,
      ccy,
      params.protocol,
      stan,
      authRef,
      approvalCode,
      authRes.responseCode,
      panMasked,
      params.expiry || null,
      JSON.stringify(authRes.raw || {}),
      now,
    ]);
  } catch (dbErr: any) {
    console.error('[cardAuthorization] DB store failed:', dbErr.message);
    throw new Error('Authorization succeeded upstream but could not be recorded locally');
  }

  console.log(`[Acquirer] ✅ Auth ${params.protocol} | ${ccy} ${params.amount} | RC=${authRes.responseCode} | Ref=${authRef}`);

  return {
    success:       true,
    transactionId: txnId,
    authRef,
    approvalCode,
    responseCode:  authRes.responseCode,
    amount:        params.amount,
    currency:      ccy,
    protocol:      params.protocol,
    message:       authRes.message,
  };
}
