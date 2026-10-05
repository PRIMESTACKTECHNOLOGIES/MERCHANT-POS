// vaultCardService.ts — Issue and manage vault bank cards
import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import { VAULT_BIN, VAULT_BIN_EUR } from "./vaultBin";
import { generateVaultPan, generateExpiry, generateCvv } from "./luhn";
import { generateVaultField55 } from "./vaultEmvGenerator";
import { validateVaultEmv } from "./vaultEmvValidator";

const CURRENCY_CODE: Record<string, string> = {
  USD: "0840", EUR: "0978", GBP: "0826", AED: "0784",
};

export async function ensureVaultCardsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vault_cards (
      id               TEXT PRIMARY KEY,
      vault_account_id TEXT NOT NULL,
      bin              TEXT NOT NULL,
      card_number      TEXT NOT NULL,
      last4            TEXT NOT NULL,
      scheme           TEXT NOT NULL DEFAULT 'VISA',
      product          TEXT NOT NULL DEFAULT 'DEBIT',
      country          TEXT NOT NULL DEFAULT 'AE',
      expiry           TEXT NOT NULL,
      cvv              TEXT NOT NULL,
      currency         TEXT NOT NULL DEFAULT 'USD',
      atc              INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'ACTIVE',
      cardholder_name  TEXT,
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function issueVaultBankCard(
  vaultAccountId: string,
  currency: string = "USD",
  cardholderName?: string
) {
  await ensureVaultCardsTable();

  const ccy    = currency.toUpperCase();
  const binCfg = ccy === "EUR" ? VAULT_BIN_EUR : VAULT_BIN;
  const pan    = generateVaultPan(binCfg.bin);
  const expiry = generateExpiry();
  const cvv    = generateCvv(pan, expiry);
  const id     = uuidv4();
  const now    = new Date().toISOString();

  await db.query(
    `INSERT INTO vault_cards
       (id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, cvv, currency, atc, status, cardholder_name, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'ACTIVE',?,?,?)`,
    [id, vaultAccountId, binCfg.bin, pan, pan.slice(-4), binCfg.scheme, binCfg.product, binCfg.country, expiry, cvv, ccy, cardholderName || null, now, now]
  );

  return { id, vault_account_id: vaultAccountId, scheme: binCfg.scheme, bin: binCfg.bin, card_number: pan, last4: pan.slice(-4), expiry, cvv, currency: ccy, status: "ACTIVE", cardholder_name: cardholderName || null };
}

export async function getVaultCard(id: string) {
  await ensureVaultCardsTable();
  const r = await db.query("SELECT * FROM vault_cards WHERE id = ? LIMIT 1", [id]);
  return r.rows[0] || null;
}

export async function listVaultCards(vaultAccountId?: string) {
  await ensureVaultCardsTable();
  const r = vaultAccountId
    ? await db.query("SELECT id, vault_account_id, bin, last4, scheme, product, currency, expiry, status, cardholder_name, atc, created_at FROM vault_cards WHERE vault_account_id = ? ORDER BY created_at DESC", [vaultAccountId])
    : await db.query("SELECT id, vault_account_id, bin, last4, scheme, product, currency, expiry, status, cardholder_name, atc, created_at FROM vault_cards ORDER BY created_at DESC LIMIT 100");
  return r.rows;
}

export async function authorizeVaultEmv(input: {
  vault_card_id: string;
  field55:       string;
  amountMinor:   number;
  currency:      string;
  merchantId?:   string;
}) {
  await ensureVaultCardsTable();
  const row = await db.query("SELECT * FROM vault_cards WHERE id = ? AND status = 'ACTIVE' LIMIT 1", [input.vault_card_id]);
  if (!row.rows[0]) throw new Error("VAULT_CARD_NOT_FOUND_OR_INACTIVE");

  const card   = row.rows[0] as any;
  const ccy    = (input.currency || "USD").toUpperCase();
  const ccyCode = CURRENCY_CODE[ccy] || "0840";

  const validation = validateVaultEmv(input.field55, { pan: card.card_number, atc: card.atc }, input.amountMinor, ccyCode);
  if (!validation.valid) throw new Error(`EMV_VALIDATION_FAILED: ${validation.reason}`);

  // Increment ATC
  const newAtc = (card.atc || 0) + 1;
  await db.query("UPDATE vault_cards SET atc = ?, updated_at = ? WHERE id = ?", [newAtc, new Date().toISOString(), card.id]);

  return {
    approved:    true,
    responseCode: "00",
    authCode:    `VEMV-${Date.now().toString(36).toUpperCase()}`,
    cardId:      card.id,
    last4:       card.last4,
    amountMinor: input.amountMinor,
    currency:    ccy,
    atc:         newAtc,
  };
}

export async function generateField55ForCard(cardId: string, amountMinor: number, currency: string = "USD") {
  await ensureVaultCardsTable();
  const row = await db.query("SELECT * FROM vault_cards WHERE id = ? LIMIT 1", [cardId]);
  if (!row.rows[0]) throw new Error("VAULT_CARD_NOT_FOUND");
  const card   = row.rows[0] as any;
  const ccy    = (currency || "USD").toUpperCase();
  const ccyCode = CURRENCY_CODE[ccy] || "0840";
  const field55 = generateVaultField55({ pan: card.card_number, expiry: card.expiry, atc: (card.atc || 0) + 1 }, amountMinor, ccyCode);
  return { field55, cardId, last4: card.last4, atc: (card.atc || 0) + 1 };
}