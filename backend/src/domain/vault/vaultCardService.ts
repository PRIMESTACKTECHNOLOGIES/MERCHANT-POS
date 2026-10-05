import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/db";
import { VAULT_BIN, VAULT_BINS, getVaultBin } from "./vaultBin";
import { generateVaultPan, generatePan, generateExpiry, generateCvv } from "./luhn";

export interface VaultCard {
  id: string;
  vault_account_id: string;
  scheme: string;
  product?: string;
  country?: string;
  bin: string;
  card_number: string;
  last4: string;
  expiry: string;
  cvv: string;
  status: string;
  product_type?: string;
  created_at?: string;
}

export async function issueVaultBankCard(vaultAccountId: string): Promise<VaultCard> {
  const binInfo = getVaultBin(vaultAccountId);
  const pan = generateVaultPan(binInfo.bin);
  const last4 = pan.slice(-4);
  const expiry = generateExpiry();
  const cvv = generateCvv();

  const id = uuidv4();

  await db.query(
    `INSERT INTO vault_cards (
       id, vault_account_id, bin, card_number, last4,
       scheme, product, country, expiry, cvv, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      id,
      vaultAccountId,
      binInfo.bin,
      pan,
      last4,
      binInfo.scheme,
      binInfo.product,
      binInfo.country,
      expiry,
      cvv,
    ]
  );

  const nowIso = new Date().toISOString();
  return {
    id,
    vault_account_id: vaultAccountId,
    scheme: binInfo.scheme,
    product: binInfo.product,
    country: binInfo.country,
    bin: binInfo.bin,
    card_number: pan,
    last4,
    expiry,
    cvv,
    status: "ACTIVE",
    created_at: nowIso,
  };
}

export async function issueVaultCard(vaultAccountId: string): Promise<VaultCard> {
  const binInfo = VAULT_BINS[vaultAccountId];
  if (!binInfo) {
    throw Object.assign(new Error("BIN_NOT_DEFINED_FOR_VAULT"), { code: "BIN_NOT_DEFINED_FOR_VAULT" });
  }

  const pan = generatePan(binInfo.bin);
  const last4 = pan.slice(-4);
  const expiry = generateExpiry();
  const cvv = generateCvv();

  const id = uuidv4();

  await db.query(
    `INSERT INTO vault_cards (
       id, vault_account_id, bin, card_number, last4,
       scheme, product, country, expiry, cvv, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      id,
      vaultAccountId,
      binInfo.bin,
      pan,
      last4,
      binInfo.scheme,
      binInfo.product,
      binInfo.country,
      expiry,
      cvv,
    ]
  );

  const created = new Date().toISOString();
  return {
    id,
    vault_account_id: vaultAccountId,
    scheme: binInfo.scheme,
    product: binInfo.product,
    country: binInfo.country,
    bin: binInfo.bin,
    card_number: pan,
    last4,
    expiry,
    cvv,
    status: "ACTIVE",
    created_at: created,
  };
}

export async function getVaultCardsByAccount(vaultAccountId: string): Promise<VaultCard[]> {
  const res = await db.query(
    `SELECT id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, status, created_at
     FROM vault_cards
     WHERE vault_account_id = ?
     ORDER BY created_at DESC`,
    [vaultAccountId]
  );
  return res.rows.map((row: any) => ({
    id: row.id,
    vault_account_id: row.vault_account_id,
    scheme: row.scheme,
    product: row.product,
    country: row.country,
    bin: row.bin,
    card_number: row.card_number,
    last4: row.last4,
    expiry: row.expiry,
    cvv: "***",
    status: row.status,
    created_at: row.created_at,
  }));
}

export async function getAllVaultCards(): Promise<VaultCard[]> {
  const res = await db.query(
    `SELECT id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, status, created_at
     FROM vault_cards
     ORDER BY created_at DESC
     LIMIT 500`
  );
  return res.rows.map((row: any) => ({
    id: row.id,
    vault_account_id: row.vault_account_id,
    scheme: row.scheme,
    product: row.product,
    country: row.country,
    bin: row.bin,
    card_number: row.card_number,
    last4: row.last4,
    expiry: row.expiry,
    cvv: "***",
    status: row.status,
    created_at: row.created_at,
  }));
}

export async function getVaultCardById(cardId: string): Promise<VaultCard | null> {
  const res = await db.query(
    `SELECT id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, cvv, status, created_at
     FROM vault_cards WHERE id = ?`,
    [cardId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    vault_account_id: row.vault_account_id,
    scheme: row.scheme,
    product: row.product,
    country: row.country,
    bin: row.bin,
    card_number: row.card_number,
    last4: row.last4,
    expiry: row.expiry,
    cvv: row.cvv,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function getActiveVaultCardByAccount(vaultAccountId: string): Promise<VaultCard | null> {
  const res = await db.query(
    `SELECT id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, cvv, status, created_at
     FROM vault_cards
     WHERE vault_account_id = ? AND status = 'ACTIVE'
     ORDER BY created_at DESC
     LIMIT 1`,
    [vaultAccountId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    vault_account_id: row.vault_account_id,
    scheme: row.scheme,
    product: row.product,
    country: row.country,
    bin: row.bin,
    card_number: row.card_number,
    last4: row.last4,
    expiry: row.expiry,
    cvv: row.cvv,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function updateVaultCardStatus(
  cardId: string,
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED"
): Promise<boolean> {
  const res = await db.query(
    `UPDATE vault_cards SET status = ? WHERE id = ?`,
    [status, cardId]
  );
  return res.rowCount > 0;
}
