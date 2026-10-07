import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";

export class CashoutsService {
  async getCashouts(merchantId: string) {
    const res = await db.query("SELECT * FROM cashouts WHERE merchant_id = ? ORDER BY created_at DESC", [merchantId]);
    return res.rows;
  }

  async getCashoutById(id: string, merchantId: string) {
    const res = await db.query("SELECT * FROM cashouts WHERE id = ? AND merchant_id = ? LIMIT 1", [id, merchantId]);
    return res.rows[0] || null;
  }

  async getCashoutTransactions(cashoutId: string) {
    const res = await db.query("SELECT * FROM cashout_transactions WHERE cashout_id = ?", [cashoutId]);
    return res.rows;
  }

  async createCashout(merchantId: string, batchIds: string[], gateway: string = "OFFLINE") {
    const placeholders = batchIds.map(() => '?').join(',');
    const batchRes = await db.query(
      `SELECT SUM(total_amount_minor) as total FROM pos2013_batches
       WHERE merchant_id = ? AND (id IN (${placeholders}) OR batch_id IN (${placeholders}))
       AND status IN ('PROCESSED','SETTLED') AND cashout_id IS NULL`,
      [merchantId, ...batchIds, ...batchIds]
    );

    const totalAmountMinor = Number((batchRes.rows[0] as any)?.total || 0);
    if (totalAmountMinor <= 0) throw new Error("No eligible batches to cashout");

    const feeMinor = Math.round(totalAmountMinor * 0.029 + 30);
    const netAmountMinor = totalAmountMinor - feeMinor;
    const cashoutId = uuidv4();

    await db.query(
      `INSERT INTO cashouts (id, merchant_id, amount_minor, currency, status, gateway, fee_minor, net_amount_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cashoutId, merchantId, totalAmountMinor, "USD", "PENDING", gateway, feeMinor, netAmountMinor]
    );

    for (const batchId of batchIds) {
      await db.query(`UPDATE pos2013_batches SET cashout_id = ? WHERE id = ?`, [cashoutId, batchId]);
      const txRes = await db.query("SELECT total_amount_minor FROM pos2013_batches WHERE id = ? LIMIT 1", [batchId]);
      await db.query(
        `INSERT INTO cashout_transactions (id, cashout_id, batch_id, amount_minor) VALUES (?, ?, ?, ?)`,
        [uuidv4(), cashoutId, batchId, (txRes.rows[0] as any)?.total_amount_minor || 0]
      );
    }

    return { cashoutId, amount: totalAmountMinor, fee: feeMinor, net: netAmountMinor };
  }

  async processCashout(cashoutId: string, merchantId: string) {
    const cashout = await this.getCashoutById(cashoutId, merchantId);
    if (!cashout) throw new Error("Cashout not found");
    if ((cashout as any).status !== "PENDING") throw new Error("Cashout already processed");
    await db.query("UPDATE cashouts SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [cashoutId]);
    throw new Error("External payout gateway not configured. Cashout remains PROCESSING until external gateway confirms.");
  }
}

export const cashoutsService = new CashoutsService();
