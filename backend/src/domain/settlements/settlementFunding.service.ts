import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { vaultEngine } from '../vault/vault.service';

const OMNIBUS_ACCOUNT_ID = 'VAULT_BANK_OMNIBUS';

/**
 * Ensures omnibus_accounts, vault_accounts, and vault_real_funds tables exist
 * and that a VAULT_BANK_OMNIBUS row is present for the given currency.
 */
export async function ensureSettlementFundingTables(currency: string) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS omnibus_accounts (
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT 'VAULT BANK OMNIBUS',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, currency)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_real_funds (
      id TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      confirmed_amount REAL NOT NULL,
      available_amount REAL NOT NULL,
      external_reference TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      confirmed_at TEXT NOT NULL
    )
  `);
  const now = new Date().toISOString();
  await db.query(
    `INSERT OR IGNORE INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
     VALUES (?, ?, 0.00, 'VAULT BANK OMNIBUS', ?, ?)`,
    [OMNIBUS_ACCOUNT_ID, String(currency).toUpperCase(), now, now]
  );
}

/**
 * Funds the VAULT_BANK_OMNIBUS + vault_accounts + vault_real_funds when a
 * settlement is confirmed (real money received from the acquirer/card scheme).
 *
 * Pipeline (atomic, inside caller transaction):
 *   1. Credit omnibus_accounts (VAULT_BANK_OMNIBUS) += amount
 *   2. Credit vault_accounts via vaultEngine.creditVault (type BATCH_TO_VAULT)
 *   3. Insert vault_real_funds row (confirmed real funds)
 *
 * Idempotent on `externalReference` — safe to call from retry flows.
 */
export async function fundOmnibusFromSettlement(input: {
  amount: number;
  currency: string;
  merchantId?: string | null;
  externalReference: string;
  settlementId: string;
}): Promise<void> {
  const { amount, currency, merchantId, externalReference, settlementId } = input;
  const ccy = String(currency).toUpperCase();
  const now = new Date().toISOString();

  // Idempotency: skip if already funded
  const existing = await db.query(
    `SELECT id FROM vault_real_funds WHERE external_reference = ? LIMIT 1`,
    [externalReference]
  );
  if (existing.rows?.length) return;

  // 1) Credit VAULT_BANK_OMNIBUS
  await db.query(
    `INSERT INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
     VALUES (?, ?, ?, 'VAULT BANK OMNIBUS', ?, ?)
     ON CONFLICT(account_id, currency) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`,
    [OMNIBUS_ACCOUNT_ID, ccy, amount, now, now]
  );

  // 2) Credit vault_accounts via ledger (type BATCH_TO_VAULT)
  await vaultEngine.creditVault({
    merchantId: merchantId || undefined,
    amount,
    currency: ccy,
    reference: externalReference,
    type: 'BATCH_TO_VAULT',
    meta: {
      source: 'pos_settlement',
      settlement_id: settlementId,
      external_reference: externalReference,
    },
  });

  // 3) Record confirmed real funds
  await db.query(
    `INSERT INTO vault_real_funds
       (id, currency, confirmed_amount, available_amount, external_reference, source, confirmed_at)
     VALUES (?, ?, ?, ?, ?, 'pos-acquirer-settlement', ?)`,
    [uuidv4(), ccy, amount, amount, externalReference, now]
  );
}
