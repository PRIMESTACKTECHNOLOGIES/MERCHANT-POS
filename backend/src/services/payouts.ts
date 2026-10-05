import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import { storeIdempotency } from "./payoutIdempotency";

export type PayoutStatus =
  | "PENDING"
  | "QUEUED"
  | "EXECUTING"
  | "SENT"
  | "CONFIRMED"
  | "FAILED";

interface CreatePayoutInput {
  source_account_id: string;
  destination_type: "bank";
  destination_bank: {
    swift_bic: string;
    account_number: string;
    account_name?: string;
    country: string;
  };
  amount: number;
  currency: string;
  purpose?: string;
  internal_reference?: string;
  channel: "MT103" | "RTGS" | "SEPA";
  metadata?: Record<string, any>;
}

export async function createPayout(
  body: CreatePayoutInput,
  idempotencyKey?: string
) {
  const ccy = String(body.currency || "USD").toUpperCase().trim();
  if (body.amount <= 0) {
    throw new Error("NO_FUNDS");
  }

  const accRes = await db.query(
    "SELECT * FROM accounts WHERE id = ? AND currency = ?",
    [body.source_account_id, ccy]
  );
  const source = accRes.rows[0];
  if (!source) throw new Error("ACCOUNT_NOT_FOUND");
  if (Number(source.balance) < Number(body.amount)) throw new Error("NO_FUNDS");

  const beneId = uuidv4();
  await db.query(
    `INSERT INTO beneficiaries (
       id, name, type,
       bank_swift_bic, bank_account_number, bank_country,
       address_line1, address_city, address_postal_code, address_country,
       metadata
     ) VALUES (?, ?, 'corporate', ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    [
      beneId,
      body.destination_bank.account_name || "UNKNOWN",
      body.destination_bank.swift_bic,
      body.destination_bank.account_number,
      body.destination_bank.country,
      body.destination_bank.country,
      JSON.stringify(body.metadata || {}),
    ]
  );

  const payoutId = uuidv4();
  const uetr = uuidv4().toUpperCase();

  await db.query(
    `INSERT INTO core_payouts (
       id, source_account_id, beneficiary_id, destination_type,
       amount, currency, purpose, internal_reference,
       channel, status, uetr, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      payoutId,
      body.source_account_id,
      beneId,
      body.destination_type,
      body.amount,
      ccy,
      body.purpose || null,
      body.internal_reference || null,
      body.channel,
      uetr,
      JSON.stringify(body.metadata || {}),
    ]
  );

  await db.query(
    "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    [body.amount, body.source_account_id]
  );

  if (idempotencyKey) {
    await storeIdempotency(idempotencyKey, body, payoutId);
  }

  return {
    id: payoutId,
    status: "PENDING",
    source_account_id: body.source_account_id,
    amount: body.amount,
    currency: ccy,
    channel: body.channel,
    internal_reference: body.internal_reference || null,
    uetr,
    metadata: body.metadata || {},
  };
}

export async function getPayout(id: string) {
  const res = await db.query("SELECT * FROM core_payouts WHERE id = ?", [id]);
  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    channel: row.channel,
    uetr: row.uetr,
    internal_reference: row.internal_reference,
    amount: Number(row.amount),
    currency: row.currency,
    source_account_id: row.source_account_id,
    beneficiary_id: row.beneficiary_id,
    destination_type: row.destination_type,
    purpose: row.purpose,
    external_reference: row.external_reference,
    created_at: row.created_at,
    sent_at: row.sent_at,
    confirmed_at: row.confirmed_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

export async function listPayouts(params: {
  status?: string;
  channel?: string;
  search?: string;
}) {
  const where: string[] = [];
  const values: any[] = [];

  if (params.status) {
    where.push("status = ?");
    values.push(params.status);
  }
  if (params.channel) {
    where.push("channel = ?");
    values.push(params.channel);
  }
  if (params.search) {
    where.push("(internal_reference LIKE ? OR id LIKE ?)");
    values.push(`%${params.search}%`, `%${params.search}%`);
  }

  const sql =
    "SELECT * FROM core_payouts" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at DESC LIMIT 200";

  const res = await db.query(sql, values);
  return res.rows.map((row: any) => ({
    id: row.id,
    status: row.status,
    channel: row.channel,
    uetr: row.uetr,
    internal_reference: row.internal_reference,
    amount: Number(row.amount),
    currency: row.currency,
    source_account_id: row.source_account_id,
    beneficiary_id: row.beneficiary_id,
    destination_type: row.destination_type,
    purpose: row.purpose,
    created_at: row.created_at,
    sent_at: row.sent_at,
    confirmed_at: row.confirmed_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  }));
}
