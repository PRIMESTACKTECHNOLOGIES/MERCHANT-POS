import { db } from "../../config/db";
import crypto from "crypto";

export class Pos2013TerminalsService {
  async verifyTerminal(merchantId: string, terminalId: string, secretKey: string) {
    const result = await db.query(
      `SELECT id FROM terminals WHERE merchant_id = ? AND terminal_id = ? AND terminal_secret = ? LIMIT 1`,
      [merchantId, terminalId, secretKey]
    );
    return result.rows.length > 0;
  }

  async getTerminals(merchantId: string) {
    try {
      // 1. Get registered terminals
      const registered = await db.query(
        `SELECT * FROM terminals WHERE merchant_id = ? ORDER BY created_at DESC`,
        [merchantId]
      );

      // Map registered terminals
      const terminals = registered.rows.map((row: any) => ({
        id: row.id,
        merchantId: row.merchant_id,
        terminalId: row.terminal_id,
        name: row.name,
        offlineEnabled: row.offline_enabled === 1,
        lastBatchAt: row.last_batch_at
      }));

      return terminals;
    } catch (e) {
      console.error("Error fetching terminals:", e);
      throw new Error("Failed to fetch terminals");
    }
  }

  async getAllTransactions(merchantId: string) {
    try {
      const result = await db.query(
        `
        SELECT 
          id,
          merchant_id as "merchantId",
          terminal_id as "terminalId",
          amount_minor as "amountMinor",
          currency,
          status,
          txn_timestamp as "txnTimestamp",
          NULL as "cardBrand",
          NULL as "invoiceId",
          NULL as "paymentId"
        FROM pos2013_transactions
        WHERE merchant_id = ?
        
        UNION ALL

        SELECT 
          local_txn_id as id,
          ? as "merchantId",
          'FLUTTER-POS' as "terminalId",
          CAST(amount * 100 AS INTEGER) as "amountMinor",
          'AED' as currency,
          status,
          created_at as "txnTimestamp",
          card_brand as "cardBrand",
          invoice_id as "invoiceId",
          payment_id as "paymentId"
        FROM myfatoorah_direct_settlements
        
        ORDER BY "txnTimestamp" DESC
        LIMIT 100
        `,
        [merchantId, merchantId]
      );
      return result.rows;
    } catch (e) {
      console.error("Error fetching transactions:", e);
      throw new Error("Failed to fetch transactions");
    }
  }

  async registerTerminal(merchantId: string, terminalName: string) {
    try {
      // Generate a more robust Terminal ID (e.g., T-TIMESTAMP-RANDOM) to minimize collisions
      const suffix = Math.floor(1000 + Math.random() * 9000);
      const terminalId = `T-${Date.now().toString().slice(-6)}-${suffix}`; 
      
      // Generate a strong cryptographic secret (32 bytes hex)
      const terminalSecret = crypto.randomBytes(32).toString('hex');
      
      const id = crypto.randomUUID();

      await db.query(
        `INSERT INTO terminals (id, merchant_id, terminal_id, name, terminal_secret, offline_enabled)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [id, merchantId, terminalId, terminalName, terminalSecret]
      );

      return {
        id,
        merchantId,
        terminalId,
        name: terminalName,
        secretKey: terminalSecret, // Return secret only once upon creation!
        offlineEnabled: true,
        lastBatchAt: null
      };
    } catch (e: any) {
      console.error("Error registering terminal:", e);
      if (e.message && e.message.includes("UNIQUE constraint failed")) {
        throw new Error("Terminal ID already exists. Please try again.");
      }
      throw new Error("Failed to register terminal");
    }
  }

  async regenerateTerminalSecret(merchantId: string, terminalId: string) {
    const newSecret = crypto.randomBytes(32).toString('hex');
    await db.query(
      `UPDATE terminals SET terminal_secret = ? 
       WHERE merchant_id = ? AND terminal_id = ?`,
      [newSecret, merchantId, terminalId]
    );
    return { terminalId, terminalSecret: newSecret };
  }

  async forceRemoteReboot(merchantId: string, terminalId: string) {
    // In a real world system, this would send a push notification (FCM) or WebSocket message
    // to the terminal. For now, we'll mark it in a 'pending_actions' table or just return success.
    await db.query(
      `UPDATE terminals SET last_reboot_request = CURRENT_TIMESTAMP, status = 'REBOOTING'
       WHERE merchant_id = ? AND terminal_id = ?`,
      [merchantId, terminalId]
    );
    return { terminalId, status: "REBOOT_SENT" };
  }
}

export const pos2013TerminalsService = new Pos2013TerminalsService();
