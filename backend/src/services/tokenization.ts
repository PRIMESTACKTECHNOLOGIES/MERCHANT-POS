import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import { pickBin, generateCardNumberFromBin } from "../utils/cardNumber";
import { decryptPan, encryptPan, hashCvv } from "../utils/crypto";

function generateExpiry(): string {
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const year = String((new Date().getFullYear() + 3) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

export async function issueWalletCardToken(customerId: string) {
  if (!customerId) throw new Error("CUSTOMER_REQUIRED");

  const bin = pickBin();
  const pan = generateCardNumberFromBin(bin.bin);
  const cvv = String(crypto.randomInt(100, 1000));
  const tokenId = uuidv4();
  const token = `tok_${tokenId}`;
  const expiry = generateExpiry();

  await db.query(
    `INSERT INTO card_tokens
      (id, token, customer_id, bin, last4, scheme, product, country,
       encrypted_pan, expiry, cvv_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tokenId,
      token,
      customerId,
      bin.bin,
      pan.slice(-4),
      bin.scheme,
      bin.product,
      bin.country,
      encryptPan(pan),
      expiry,
      hashCvv(cvv),
    ],
  );

  return {
    token,
    scheme: bin.scheme,
    product: bin.product,
    country: bin.country,
    bin: bin.bin,
    last4: pan.slice(-4),
    expiry,
    cvv,
  };
}

export async function getCardByToken(token: string) {
  const result = await db.query(
    "SELECT token, bin, last4, scheme, product, country, expiry FROM card_tokens WHERE token = ? AND status = 'ACTIVE'",
    [token],
  );
  const row = result.rows[0];
  return row
    ? {
        token: row.token,
        bin: row.bin,
        last4: row.last4,
        scheme: row.scheme,
        product: row.product,
        country: row.country,
        expiry: row.expiry,
      }
    : null;
}

export async function getPanForProcessing(token: string, cvv?: string) {
  const result = await db.query(
    "SELECT * FROM card_tokens WHERE token = ? AND status = 'ACTIVE'",
    [token],
  );
  const row = result.rows[0];
  if (!row) throw new Error("CARD_TOKEN_NOT_FOUND");
  if (cvv && hashCvv(cvv) !== row.cvv_hash) {
    throw new Error("CVV_MISMATCH");
  }

  return {
    pan: decryptPan(Buffer.from(row.encrypted_pan)),
    expiry: row.expiry,
    bin: row.bin,
    scheme: row.scheme,
    product: row.product,
    country: row.country,
  };
}
