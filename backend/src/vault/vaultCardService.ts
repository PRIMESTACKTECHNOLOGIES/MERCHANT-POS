// vaultCardService.ts — Issue and manage vault bank cards
import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import { VAULT_BIN, VAULT_BIN_EUR } from "./vaultBin";
import { generateVaultPan, generateExpiry, generateCvv } from "./luhn";
import { generateVaultField55 } from "./vaultEmvGenerator";
import { validateVaultEmv } from "./vaultEmvValidator";
import { currencyToBcd } from "../issuer/emvCdol";
import { SoftwareEmvIssuerCrypto } from "../issuer/issuerCrypto";

/** ISO 4217 numeric currency, converted to tag 5F2A BCD on demand. */
const CURRENCY_NUMERIC: Record<string, string> = {
  USD: "840", EUR: "978", GBP: "826", AED: "784",
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
  const ccyBcd = currencyToBcd(CURRENCY_NUMERIC[ccy] || "840");

  const validation = validateVaultEmv(
    input.field55,
    { pan: card.card_number, panSequence: String(card.pan_sequence || "00") },
    input.amountMinor,
    ccyBcd,
  );
  if (!validation.valid) throw new Error(`EMV_VALIDATION_FAILED: ${validation.reason}`);

  // ── ATC REPLAY GUARD ─────────────────────────────────────────────────────────
  // The card owns the ATC and increments it on every GENERATE AC. The issuer
  // stores the highest ATC it has seen and refuses anything at or below it, so a
  // captured Field 55 block cannot be replayed for a second authorization.
  const presentedAtc = validation.atc!;
  if (presentedAtc <= (card.atc || 0)) {
    throw new Error(`EMV_ATC_REPLAY: presented=${presentedAtc} stored=${card.atc || 0}`);
  }
  const newAtc = presentedAtc;

  // ── ARPC ─────────────────────────────────────────────────────────────────────
  // The card MAC'd `validation.cdol1Hex`; the ARPC must be derived from the
  // identical bytes so the card can verify it after the second GENERATE AC.
  const arpcHex = SoftwareEmvIssuerCrypto.fromEnvironment().generateArpc({
    pan: card.card_number,
    panSequence: String(card.pan_sequence || "00"),
    atc: validation.atcHex!,
    cdol1Hex: validation.cdol1Hex!,
    arqc: validation.arqcHex!,
    responseCode: "00",
  });

  // ── REAL-CAPTURE GATE ────────────────────────────────────────────────────────
  // A valid EMV cryptogram only proves the card data is genuine — it captures no
  // funds. Before answering responseCode "00" we take the money out of the vault
  // account that owns this card. If that account cannot cover the amount, the
  // authorization is refused rather than approved against thin air.
  const captureRef = `VEMV-${Date.now().toString(36).toUpperCase()}`;
  const { vaultEngine } = await import("../domain/vault/vault.service");
  await vaultEngine.debitVault({
    amount:     input.amountMinor / 100,
    currency:   ccy,
    reference:  captureRef,
    merchantId: input.merchantId,
    type:       "VAULT_RESERVE",
    meta: {
      source:           "vault_emv_authorize",
      vault_card_id:    card.id,
      vault_account_id: card.vault_account_id,
      last4:            card.last4,
      atc:              newAtc,
    },
  });

  // ATC advances only after the hold is committed to the ledger
  await db.query("UPDATE vault_cards SET atc = ?, updated_at = ? WHERE id = ?", [newAtc, new Date().toISOString(), card.id]);

  return {
    approved:    true,
    responseCode: "00",
    authCode:    captureRef,
    captureRef,
    captured:    true,
    cardId:      card.id,
    last4:       card.last4,
    amountMinor: input.amountMinor,
    currency:    ccy,
    atc:         newAtc,
    arpcHex,
  };
}

export async function generateField55ForCard(cardId: string, amountMinor: number, currency: string = "USD") {
  await ensureVaultCardsTable();
  const row = await db.query("SELECT * FROM vault_cards WHERE id = ? LIMIT 1", [cardId]);
  if (!row.rows[0]) throw new Error("VAULT_CARD_NOT_FOUND");
  const card   = row.rows[0] as any;
  const ccy    = (currency || "USD").toUpperCase();
  const nextAtc = (card.atc || 0) + 1;
  // The generator takes the alpha currency and owns the numeric→BCD conversion.
  const field55 = generateVaultField55(
    { pan: card.card_number, expiry: card.expiry, atc: nextAtc, panSequence: String(card.pan_sequence || "00") },
    amountMinor,
    ccy,
  );
  return { field55, cardId, last4: card.last4, atc: nextAtc };
}