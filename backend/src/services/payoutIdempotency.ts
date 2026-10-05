import { db } from "../config/db";
import { hashBody } from "../utils/hash";

export async function checkIdempotency(key: string, body: any) {
  const hash = hashBody(body);
  const res = await db.query(
    "SELECT * FROM core_payout_idempotency WHERE idempotency_key = ?",
    [key]
  );
  const row = res.rows[0];
  if (!row) return { exists: false, hash, row: null };

  if (row.request_hash !== hash) {
    throw new Error("IDEMPOTENCY_CONFLICT");
  }

  const payoutRes = await db.query(
    "SELECT * FROM core_payouts WHERE id = ?",
    [row.payout_id]
  );
  const payout = payoutRes.rows[0];
  return {
    exists: true,
    hash,
    row,
    payout: payout
      ? {
          id: payout.id,
          status: payout.status,
          channel: payout.channel,
          uetr: payout.uetr,
          internal_reference: payout.internal_reference,
          amount: Number(payout.amount),
          currency: payout.currency,
          source_account_id: payout.source_account_id,
          external_reference: payout.external_reference,
          sent_at: payout.sent_at,
          confirmed_at: payout.confirmed_at,
          metadata: payout.metadata ? JSON.parse(payout.metadata) : {},
        }
      : null,
  };
}

export async function storeIdempotency(
  key: string,
  body: any,
  payoutId: string
) {
  const hash = hashBody(body);
  await db.query(
    `INSERT INTO core_payout_idempotency (idempotency_key, request_hash, payout_id)
     VALUES (?, ?, ?)`,
    [key, hash, payoutId]
  );
}
