/**
 * Gateway Charge Service — money in from a payment gateway
 * ─────────────────────────────────────────────────────────────────────────────
 * Lifecycle of one card load:
 *
 *   1. createGatewayCharge()  → records a PENDING charge and asks the gateway
 *                               for a hosted checkout link (returns the URL).
 *   2. the payer pays on the gateway's page.
 *   3. settleGatewayCharge()  → asks the gateway API whether THAT payment really
 *                               succeeded, and credits the card only if the
 *                               gateway's own amount and currency match.
 *
 * The webhook is a trigger only; `settleGatewayCharge` is the authority and is
 * also safe to call again from the UI after the payer returns.
 *
 * Currency rule: a gateway may only collect the card's own currency. No FX is
 * guessed anywhere in this file.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../config/db';
import { creditCard, getCardBalance } from '../cardBalance.service';
import {
  getGateway,
  getDriver,
  gatewayIsConfigured,
  gatewayUnavailableReason,
  GATEWAYS,
  GatewayError,
  type GatewayDef,
} from './gateway.drivers';

// ── Table bootstrap ───────────────────────────────────────────────────────────
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gateway_charges (
      id            TEXT PRIMARY KEY,
      gateway       TEXT NOT NULL,
      card_id       TEXT NOT NULL,
      currency      TEXT NOT NULL,
      amount        REAL NOT NULL,
      reference     TEXT NOT NULL UNIQUE,
      provider_ref  TEXT,
      checkout_url  TEXT,
      payer_email   TEXT,
      status        TEXT NOT NULL DEFAULT 'PENDING',
      card_txn_id   TEXT,
      last_status   TEXT,
      last_error    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `);
}

export type GatewayChargeStatus = 'PENDING' | 'PAID' | 'CREDITED' | 'EXPIRED' | 'FAILED';

export interface GatewayCharge {
  id: string;
  gateway: string;
  cardId: string;
  currency: string;
  amount: number;
  reference: string;
  providerRef?: string;
  checkoutUrl?: string;
  status: GatewayChargeStatus;
  lastStatus?: string;
  lastError?: string;
  cardTxnId?: string;
  createdAt: string;
}

function mapCharge(r: any): GatewayCharge {
  return {
    id: r.id,
    gateway: r.gateway,
    cardId: r.card_id,
    currency: r.currency,
    amount: Number(r.amount),
    reference: r.reference,
    providerRef: r.provider_ref ?? undefined,
    checkoutUrl: r.checkout_url ?? undefined,
    status: r.status,
    lastStatus: r.last_status ?? undefined,
    lastError: r.last_error ?? undefined,
    cardTxnId: r.card_txn_id ?? undefined,
    createdAt: r.created_at,
  };
}

/** Where the payer lands after paying. Display-only redirect, never trusted for crediting. */
function publicReturnUrl(chargeId: string): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/?gateway_charge=${encodeURIComponent(chargeId)}`;
}

/** Our own reference, echoed back by every gateway. */
function makeReference(gatewayId: string): string {
  return `GW-${gatewayId.toUpperCase()}-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// ── Catalogue for the UI ──────────────────────────────────────────────────────
export interface GatewayOption {
  id: string;
  title: string;
  subtitle: string;
  currencies: string[];
  available: boolean;
  unavailableReason?: string;
}

export function listGatewayOptions(): GatewayOption[] {
  return GATEWAYS.map((g: GatewayDef) => ({
    id: g.id,
    title: g.title,
    subtitle: g.subtitle,
    currencies: g.currencies,
    available: gatewayIsConfigured(g),
    unavailableReason: gatewayUnavailableReason(g),
  }));
}

// ── 1. Create a charge + hosted checkout link ─────────────────────────────────
export async function createGatewayCharge(input: {
  gatewayId: string;
  cardId: string;
  currency: string;
  amount: number;
  email?: string;
}): Promise<GatewayCharge> {
  await ensureTables();

  const def = getGateway(input.gatewayId);
  if (!def) throw new GatewayError(input.gatewayId, 'Unknown gateway');

  const currency = String(input.currency || '').toUpperCase();
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new GatewayError(def.id, 'Enter a positive amount');

  // Currency-match-only: the gateway must be able to collect the card's own
  // currency, so nothing ever has to be converted.
  if (!def.currencies.includes(currency)) {
    throw new GatewayError(def.id, `${def.title} cannot collect ${currency}. It supports ${def.currencies.join(', ')}.`);
  }
  if (!gatewayIsConfigured(def)) {
    throw new GatewayError(def.id, gatewayUnavailableReason(def) || 'Not configured on this server');
  }

  const driver = getDriver(def.id);
  const id = uuidv4();
  const reference = makeReference(def.id);
  const now = new Date().toISOString();

  // The charge is recorded before the gateway is called, so a checkout that is
  // created but whose response is lost can still be reconciled later.
  await db.query(`
    INSERT INTO gateway_charges
      (id, gateway, card_id, currency, amount, reference, payer_email, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `, [id, def.id, input.cardId, currency, amount, reference, input.email || null, now, now]);

  try {
    const result = await driver.createCheckout({
      amount,
      currency,
      reference,
      returnUrl: publicReturnUrl(id),
      email: input.email || `card-${input.cardId}@primestack.local`,
    });

    await db.query(
      `UPDATE gateway_charges SET provider_ref = ?, checkout_url = ?, updated_at = ? WHERE id = ?`,
      [result.providerRef, result.checkoutUrl, new Date().toISOString(), id],
    );

    return {
      id, gateway: def.id, cardId: input.cardId, currency, amount, reference,
      providerRef: result.providerRef, checkoutUrl: result.checkoutUrl,
      status: 'PENDING', createdAt: now,
    };
  } catch (err: any) {
    await db.query(
      `UPDATE gateway_charges SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?`,
      [String(err?.message || err).slice(0, 500), new Date().toISOString(), id],
    );
    throw err;
  }
}

// ── 2. Settle — verify with the gateway, then credit ──────────────────────────
export interface SettleResult {
  ok: boolean;
  alreadyCredited?: boolean;
  charge: GatewayCharge;
  message: string;
  cardBalance?: number;
  error?: string;
}

export async function settleGatewayCharge(chargeId: string): Promise<SettleResult> {
  await ensureTables();

  const row = (await db.query('SELECT * FROM gateway_charges WHERE id = ? LIMIT 1', [chargeId])).rows[0] as any;
  if (!row) {
    return { ok: false, charge: null as any, message: `No gateway charge ${chargeId}`, error: 'CHARGE_NOT_FOUND' };
  }
  const charge = mapCharge(row);

  if (charge.status === 'CREDITED') {
    const bal = await getCardBalance(charge.cardId, charge.currency);
    return { ok: true, alreadyCredited: true, charge, message: `Already credited to card ${charge.cardId}`, cardBalance: bal.balance };
  }
  if (!charge.providerRef) {
    return { ok: false, charge, message: 'The gateway never returned a reference for this charge', error: 'NO_PROVIDER_REF' };
  }

  let verified;
  try {
    verified = await getDriver(charge.gateway).verify(charge.providerRef, { amount: charge.amount, currency: charge.currency });
  } catch (err: any) {
    await db.query(`UPDATE gateway_charges SET last_error = ?, updated_at = ? WHERE id = ?`,
      [String(err?.message || err).slice(0, 500), new Date().toISOString(), chargeId]);
    return { ok: false, charge, message: `Gateway verification failed: ${err?.message || err}`, error: 'VERIFY_FAILED' };
  }

  const now = new Date().toISOString();
  const recorded = String(verified.status || 'unknown');
  const fail = async (message: string, error: string): Promise<SettleResult> => {
    await db.query(`UPDATE gateway_charges SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [recorded, message.slice(0, 500), now, chargeId]);
    return { ok: false, charge: { ...charge, lastStatus: recorded, lastError: message }, message, error };
  };

  if (!verified.paid) {
    return fail(`The gateway reports this payment as "${recorded}" — not paid`, 'NOT_PAID');
  }

  // The gateway's own numbers must match what we recorded. This is what stops a
  // re-used or tampered reference from crediting an amount we never agreed to.
  const gatewayMinor = Math.round(verified.amount * 100);
  const expectedMinor = Math.round(charge.amount * 100);
  if (gatewayMinor !== expectedMinor) {
    return fail(`Amount mismatch: gateway reports ${verified.amount} ${verified.currency}, charge was ${charge.amount} ${charge.currency}`, 'AMOUNT_MISMATCH');
  }
  if (verified.currency && verified.currency !== charge.currency) {
    return fail(`Currency mismatch: gateway reports ${verified.currency}, charge was ${charge.currency}`, 'CURRENCY_MISMATCH');
  }

  // Backed and idempotent: creditCard() keys on (card_id, channel, provider_ref).
  const txn = await creditCard(
    charge.cardId, charge.currency, charge.amount, `gateway_${charge.gateway}`,
    charge.providerRef, charge.reference,
    `${getGateway(charge.gateway)?.title || charge.gateway} checkout ${charge.reference}`,
  );

  await db.query(
    `UPDATE gateway_charges SET status = 'CREDITED', card_txn_id = ?, last_status = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
    [txn.id, recorded, now, chargeId],
  );

  const bal = await getCardBalance(charge.cardId, charge.currency);
  return {
    ok: true,
    charge: { ...charge, status: 'CREDITED', cardTxnId: txn.id, lastStatus: recorded },
    message: `${getGateway(charge.gateway)?.title || charge.gateway} payment ${charge.reference} verified and credited`,
    cardBalance: bal.balance,
  };
}

// ── 3. Webhook — authenticate, then settle ────────────────────────────────────
/**
 * Our reference is echoed by every gateway we support (reference / tx_ref /
 * external_id / reference_id / client_reference_id), so one regex finds the
 * charge regardless of which gateway called us.
 */
const REFERENCE_RE = /GW-[A-Z]{2,14}-[A-F0-9]{8}/;

export async function handleGatewayWebhook(
  gatewayId: string,
  rawBody: Buffer,
  headers: Record<string, any>,
): Promise<{ ok: boolean; reason?: string; credited?: boolean; message?: string }> {
  await ensureTables();

  const def = getGateway(gatewayId);
  if (!def) return { ok: false, reason: 'UNKNOWN_GATEWAY' };
  if (!gatewayIsConfigured(def)) return { ok: false, reason: 'NOT_CONFIGURED' };

  // Signature check — rejects junk early. It is NOT the authority: even a
  // perfectly-signed payload must still pass verify() before any credit.
  const auth = getDriver(gatewayId).verifyWebhook(rawBody, headers);
  if (!auth.valid) return { ok: false, reason: 'INVALID_SIGNATURE' };

  const text = rawBody.toString('utf8');
  const ourRef = text.match(REFERENCE_RE)?.[0] || '';

  let row: any;
  if (ourRef) {
    row = (await db.query('SELECT * FROM gateway_charges WHERE reference = ? LIMIT 1', [ourRef])).rows[0];
  }
  if (!row && auth.providerRef) {
    row = (await db.query('SELECT * FROM gateway_charges WHERE provider_ref = ? LIMIT 1', [auth.providerRef])).rows[0];
  }
  if (!row) return { ok: false, reason: 'CHARGE_NOT_FOUND' };

  const result = await settleGatewayCharge(row.id);
  return {
    ok: result.ok,
    credited: result.ok && !result.alreadyCredited,
    message: result.message,
    reason: result.ok ? undefined : result.error,
  };
}

// ── Read helper for the UI ────────────────────────────────────────────────────
export async function listGatewayCharges(cardId?: string, limit = 25): Promise<GatewayCharge[]> {
  await ensureTables();
  const rows = cardId
    ? (await db.query('SELECT * FROM gateway_charges WHERE card_id = ? ORDER BY created_at DESC LIMIT ?', [cardId, limit])).rows
    : (await db.query('SELECT * FROM gateway_charges ORDER BY created_at DESC LIMIT ?', [limit])).rows;
  return (rows as any[]).map(mapCharge);
}
