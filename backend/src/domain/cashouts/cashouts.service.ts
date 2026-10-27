import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";

export class CashoutsService {
  async getCashouts(merchantId: string) {
    const res = await db.query(
      "SELECT * FROM cashouts WHERE merchant_id = $1 ORDER BY created_at DESC",
      [merchantId]
    );
    return res.rows;
  }

  async getCashoutById(id: string, merchantId: string) {
    const res = await db.query(
      "SELECT * FROM cashouts WHERE id = $1 AND merchant_id = $2",
      [id, merchantId]
    );
    if (!res.rows.length) return null;
    return res.rows[0];
  }

  async getCashoutTransactions(cashoutId: string) {
    const res = await db.query(
      "SELECT * FROM cashout_transactions WHERE cashout_id = $1",
      [cashoutId]
    );
    return res.rows;
  }

  async createCashout(
    merchantId: string,
    batchIds: string[],
    gateway: string = "OFFLINE"
  ) {
    const placeholders = batchIds.map((_, i) => "$" + (i + 2)).join(",");
    const batchRes = await db.query(
      `SELECT SUM(total_amount_minor) as total FROM pos2013_batches WHERE merchant_id = $1 AND (id IN (${placeholders}) OR batch_id IN (${placeholders})) AND status IN ('PROCESSED','SETTLED') AND cashout_id IS NULL`,
      [merchantId, ...batchIds, ...batchIds]
    );

    const totalAmountMinor = batchRes.rows[0].total || 0;
    if (totalAmountMinor <= 0) {
      throw new Error("No eligible batches to cashout");
    }

    const feeMinor = Math.round(totalAmountMinor * 0.029 + 30);
    const netAmountMinor = totalAmountMinor - feeMinor;

    const cashoutId = uuidv4();
    await db.query(
      `INSERT INTO cashouts (
        id, merchant_id, amount_minor, currency, status, gateway, fee_minor, net_amount_minor
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cashoutId,
        merchantId,
        totalAmountMinor,
        "USD",
        "PENDING",
        gateway,
        feeMinor,
        netAmountMinor,
      ]
    );

    for (const batchId of batchIds) {
      await db.query(
        `UPDATE pos2013_batches SET cashout_id = $1 WHERE id = $2`,
        [cashoutId, batchId]
      );

      const txRes = await db.query(
        "SELECT total_amount_minor as amount_minor, id FROM pos2013_batches WHERE id = $1",
        [batchId]
      );

      await db.query(
        `INSERT INTO cashout_transactions (
          id, cashout_id, batch_id, amount_minor
        ) VALUES ($1, $2, $3, $4)`,
        [uuidv4(), cashoutId, batchId, txRes.rows[0].amount_minor]
      );
    }

    return { cashoutId, amount: totalAmountMinor, fee: feeMinor, net: netAmountMinor };
  }

  async processCashout(cashoutId: string, merchantId: string) {
    const cashout = await this.getCashoutById(cashoutId, merchantId);
    if (!cashout) throw new Error("Cashout not found");
    if (cashout.status !== "PENDING") {
      throw new Error("Cashout already processed");
    }

    await db.query(
      "UPDATE cashouts SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [cashoutId]
    );

    throw new Error(
      "External payout gateway is not configured. Connect your bank/PSP processor to finalize cashout settlement. " +
      "Cashout remains in PROCESSING state until the external gateway confirms."
    );
  }
}

export const cashoutsService = new CashoutsService();
