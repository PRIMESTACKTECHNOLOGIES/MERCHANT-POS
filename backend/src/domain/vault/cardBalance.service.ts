/**
 * Card Balance Service — Persistent Vault Card Balances
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the in-memory `cardAccounts` object in vault-bank-settlement.js
 * with a SQLite-backed balance that survives restarts.
 *
 * Tables:
 *   vault_card_balances    — one row per cardId/currency, holds real balance
 *   vault_card_txns        — append-only ledger of every credit and debit
 *
 * A card balance is REAL money — it was funded through one of the 6 top-up
 * channels in cardTopup.service.ts. Each credit entry carries a providerRef
 * that links to the originating external transaction so auditors can trace
 * every cent back to a real bank/crypto movement.
 *
 * Used by:
 *   cardTopup.service.ts  — credits card on successful real-fund top-up
 *   vault-bank-settlement.js  — debits card on POS transaction approval
 *   cardTopup.router.ts   — balance inquiry + history endpoints
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

// ── Table bootstrap ───────────────────────────────────────────────────────────
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_card_balances (
      id           TEXT PRIMARY KEY,
      card_id      TEXT NOT NULL,
      currency     TEXT NOT NULL,
      balance      REAL NOT NULL DEFAULT 0,
      reserved     REAL NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      UNIQUE(card_id, currency)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_card_txns (
      id               TEXT PRIMARY KEY,
      card_id          TEXT NOT NULL,
      currency         TEXT NOT NULL,
      type             TEXT NOT NULL,   -- CREDIT | DEBIT | RESERVE | RELEASE
      amount           REAL NOT NULL,   -- always positive; sign determined by type
      balance_after    REAL NOT NULL,
      channel          TEXT,            -- bank_wire | wise | crypto | transak | cash | card_to_card | pos_debit
      provider_ref     TEXT,            -- external transaction ID from real fund source
      external_ref     TEXT,            -- our reference (wire ref, tx hash, etc.)
      note             TEXT,
      created_at       TEXT NOT NULL
    )
  `);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CardBalance {
  cardId:    string;
  currency:  string;
  balance:   number;  // spendable (balance - reserved)
  total:     number;  // gross balance
  reserved:  number;  // held for pending transactions
}

export interface CardTxn {
  id:           string;
  cardId:       string;
  currency:     string;
  type:         'CREDIT' | 'DEBIT' | 'RESERVE' | 'RELEASE';
  amount:       number;
  balanceAfter: number;
  channel?:     string;
  providerRef?: string;
  externalRef?: string;
  note?:        string;
  createdAt:    string;
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Get current balance for a card.
 * Returns zero balance object if card has never been loaded.
 */
export async function getCardBalance(cardId: string, currency: string): Promise<CardBalance> {
  await ensureTables();
  const ccy = currency.toUpperCase();
  const row = (await db.query(
    'SELECT balance, reserved FROM vault_card_balances WHERE card_id = ? AND currency = ? LIMIT 1',
    [cardId, ccy]
  )).rows[0] as any;

  const total    = Number(row?.balance  ?? 0);
  const reserved = Number(row?.reserved ?? 0);
  return {
    cardId,
    currency: ccy,
    total,
    reserved,
    balance: Math.max(0, total - reserved),
  };
}

/**
 * Credit a card with real funds.
 * Called by cardTopup.service.ts after a real-fund deposit is confirmed.
 *
 * @param cardId      e.g. 'usd', 'eur', or custom card ID
 * @param currency    ISO currency code
 * @param amount      amount in major units (e.g. 100.00)
 * @param channel     funding channel (bank_wire | wise | crypto | transak | cash | card_to_card)
 * @param providerRef external reference from the funding provider
 * @param externalRef our reference (wire ref, tx hash, etc.)
 * @param note        optional note
 */
export async function creditCard(
  cardId:      string,
  currency:    string,
  amount:      number,
  channel:     string,
  providerRef: string,
  externalRef: string,
  note?:       string,
): Promise<CardTxn> {
  await ensureTables();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Credit amount must be positive');

  const ccy = currency.toUpperCase();
  const now = new Date().toISOString();

  await db.query('BEGIN IMMEDIATE');
  try {
    // Upsert balance row
    await db.query(`
      INSERT INTO vault_card_balances (id, card_id, currency, balance, reserved, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(card_id, currency) DO UPDATE SET
        balance    = balance + excluded.balance,
        updated_at = excluded.updated_at
    `, [uuidv4(), cardId, ccy, amount, now, now]);

    const balRow = (await db.query(
      'SELECT balance FROM vault_card_balances WHERE card_id = ? AND currency = ? LIMIT 1',
      [cardId, ccy]
    )).rows[0] as any;
    const balanceAfter = Number(balRow?.balance ?? amount);

    const txnId = uuidv4();
    await db.query(`
      INSERT INTO vault_card_txns
        (id, card_id, currency, type, amount, balance_after, channel, provider_ref, external_ref, note, created_at)
      VALUES (?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?, ?, ?)
    `, [txnId, cardId, ccy, amount, balanceAfter, channel, providerRef, externalRef, note ?? null, now]);

    await db.query('COMMIT');

    console.log(`[CardBalance] ✅ CREDIT ${ccy} ${amount.toFixed(2)} → card=${cardId} | channel=${channel} | ref=${providerRef} | balance_after=${balanceAfter.toFixed(2)}`);

    return {
      id: txnId, cardId, currency: ccy, type: 'CREDIT',
      amount, balanceAfter, channel, providerRef, externalRef, note,
      createdAt: now,
    };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* preserve */ }
    throw err;
  }
}

/**
 * Debit a card — called when a POS transaction is approved.
 * Fails atomically if insufficient balance.
 *
 * @param cardId    card to debit
 * @param currency  ISO currency code
 * @param amount    amount in major units
 * @param providerRef  POS transaction reference / auth code
 * @param note      optional note
 */
export async function debitCard(
  cardId:      string,
  currency:    string,
  amount:      number,
  providerRef: string,
  note?:       string,
): Promise<CardTxn> {
  await ensureTables();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Debit amount must be positive');

  const ccy = currency.toUpperCase();
  const now = new Date().toISOString();

  await db.query('BEGIN IMMEDIATE');
  try {
    const balRow = (await db.query(
      'SELECT balance, reserved FROM vault_card_balances WHERE card_id = ? AND currency = ? LIMIT 1',
      [cardId, ccy]
    )).rows[0] as any;

    if (!balRow) throw Object.assign(new Error(`Card ${cardId} has no ${ccy} balance — load funds first`), { code: 'NO_CARD_BALANCE' });

    const total    = Number(balRow.balance);
    const reserved = Number(balRow.reserved ?? 0);
    const available = total - reserved;

    if (available < amount) {
      throw Object.assign(
        new Error(`Insufficient card balance: available=${available.toFixed(2)} ${ccy}, required=${amount.toFixed(2)} ${ccy}`),
        { code: 'INSUFFICIENT_CARD_BALANCE', available, required: amount, currency: ccy }
      );
    }

    const newBalance = total - amount;
    await db.query(
      'UPDATE vault_card_balances SET balance = ?, updated_at = ? WHERE card_id = ? AND currency = ?',
      [newBalance, now, cardId, ccy]
    );

    const txnId = uuidv4();
    await db.query(`
      INSERT INTO vault_card_txns
        (id, card_id, currency, type, amount, balance_after, channel, provider_ref, note, created_at)
      VALUES (?, ?, ?, 'DEBIT', ?, ?, 'pos_debit', ?, ?, ?)
    `, [txnId, cardId, ccy, amount, newBalance, providerRef, note ?? null, now]);

    await db.query('COMMIT');

    console.log(`[CardBalance] 💳 DEBIT ${ccy} ${amount.toFixed(2)} ← card=${cardId} | auth=${providerRef} | balance_after=${newBalance.toFixed(2)}`);

    return {
      id: txnId, cardId, currency: ccy, type: 'DEBIT',
      amount, balanceAfter: newBalance, channel: 'pos_debit', providerRef, note,
      createdAt: now,
    };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* preserve */ }
    throw err;
  }
}

/**
 * Get full transaction history for a card.
 */
export async function getCardHistory(
  cardId:   string,
  currency?: string,
  limit     = 100,
): Promise<CardTxn[]> {
  await ensureTables();
  const rows = currency
    ? (await db.query(
        'SELECT * FROM vault_card_txns WHERE card_id = ? AND currency = ? ORDER BY created_at DESC LIMIT ?',
        [cardId, currency.toUpperCase(), limit]
      )).rows
    : (await db.query(
        'SELECT * FROM vault_card_txns WHERE card_id = ? ORDER BY created_at DESC LIMIT ?',
        [cardId, limit]
      )).rows;

  return (rows as any[]).map(r => ({
    id:           r.id,
    cardId:       r.card_id,
    currency:     r.currency,
    type:         r.type,
    amount:       Number(r.amount),
    balanceAfter: Number(r.balance_after),
    channel:      r.channel ?? undefined,
    providerRef:  r.provider_ref ?? undefined,
    externalRef:  r.external_ref ?? undefined,
    note:         r.note ?? undefined,
    createdAt:    r.created_at,
  }));
}

/**
 * List all card balances.
 */
export async function listAllCardBalances(): Promise<CardBalance[]> {
  await ensureTables();
  const rows = (await db.query('SELECT * FROM vault_card_balances ORDER BY card_id, currency')).rows;
  return (rows as any[]).map(r => ({
    cardId:   r.card_id,
    currency: r.currency,
    total:    Number(r.balance),
    reserved: Number(r.reserved ?? 0),
    balance:  Math.max(0, Number(r.balance) - Number(r.reserved ?? 0)),
  }));
}

/**
 * Export current balances as a plain JS object compatible with
 * vault-bank-settlement.js cardAccounts format:
 *   { "CARD-USD-AJI": { currency: "USD", balance: 10000 }, ... }
 * Balance is in MINOR units (cents) for the settlement server.
 */
export async function exportCardAccountsForSettlement(): Promise<Record<string, { currency: string; balance: number }>> {
  await ensureTables();
  const rows = (await db.query('SELECT * FROM vault_card_balances')).rows;
  const result: Record<string, { currency: string; balance: number }> = {};
  for (const row of rows as any[]) {
    result[String(row.card_id)] = {
      currency: String(row.currency),
      balance:  Math.round(Number(row.balance) * 100), // major → minor units
    };
  }
  return result;
}
