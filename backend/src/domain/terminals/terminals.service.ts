import { db } from "../../config/db";
import { v4 as uuid } from "uuid";

export class TerminalsService {
  async registerTerminal(name: string, deviceSerial?: string) {
    const id = uuid();
    const merchantId = "MRC-1001"; // static for now
    // If the device provided a serial, use it as the terminalId so app and dashboard match.
    const terminalId = deviceSerial ? String(deviceSerial) : "T2013-" + Math.floor(Math.random() * 9999);
    const terminalSecret = uuid().replace(/-/g, "");

    await db.query(
      `
      INSERT INTO terminals (
        id, merchant_id, terminal_id, name, terminal_secret, offline_enabled
      ) VALUES ($1, $2, $3, $4, $5, 1)
      `,
      [id, merchantId, terminalId, name, terminalSecret]
    );

    return {
      id,
      merchantId,
      terminalId,
      terminalSecret,
      offlineEnabled: true
    };
  }

  async regenerateTerminalSecret(merchantId: string, terminalId: string) {
    const terminalSecret = uuid().replace(/-/g, "");
    const res = await db.query(
      `
      UPDATE terminals
      SET terminal_secret = $1
      WHERE merchant_id = $2 AND terminal_id = $3
      RETURNING id, merchant_id, terminal_id, name, terminal_secret, offline_enabled
      `,
      [terminalSecret, merchantId, terminalId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      merchantId: row.merchant_id,
      terminalId: row.terminal_id,
      name: row.name,
      terminalSecret: row.terminal_secret,
      offlineEnabled: row.offline_enabled
    };
  }

  async verifyTerminal(merchantId: string, terminalId: string, secretKey: string) {
    try {
      const result = await db.query(
        `
        SELECT id, merchant_id, terminal_id, name, terminal_secret, offline_enabled
        FROM terminals
        WHERE merchant_id = $1 AND terminal_id = $2
        `,
        [merchantId, terminalId]
      );

      if (result.rows.length === 0) {
        return { valid: false, message: "Terminal not found" };
      }

      const terminal = result.rows[0];

      // Verify secret key
      if (terminal.terminal_secret !== secretKey) {
        return { valid: false, message: "Invalid secret key" };
      }

      return {
        valid: true,
        merchantId: terminal.merchant_id,
        terminalId: terminal.terminal_id,
        name: terminal.name,
        offlineEnabled: terminal.offline_enabled
      };
    } catch (error) {
      console.error("Error verifying terminal:", error);
      return { valid: false, message: "Verification error" };
    }
  }

  async deleteTerminal(merchantId: string, terminalId: string) {
    try {
      const res = await db.query(
        `
        DELETE FROM terminals
        WHERE merchant_id = $1 AND terminal_id = $2
        RETURNING id, merchant_id, terminal_id, name
        `,
        [merchantId, terminalId]
      );

      if (res.rows.length === 0) {
        return null;
      }

      const row = res.rows[0];
      return {
        id: row.id,
        merchantId: row.merchant_id,
        terminalId: row.terminal_id,
        name: row.name
      };
    } catch (error) {
      console.error("Error deleting terminal:", error);
      throw error;
    }
  }

  async getTerminals() {
    try {
      const res = await db.query(`
        SELECT id, merchant_id, terminal_id, name, offline_enabled, last_batch_at
        FROM terminals
        ORDER BY created_at DESC
      `);
      return res.rows.map((row: any) => ({
        id: row.id,
        merchantId: row.merchant_id,
        terminalId: row.terminal_id,
        name: row.name,
        offlineEnabled: row.offline_enabled,
        lastBatchAt: row.last_batch_at
      }));
    } catch (error) {
      console.error("DB Error in getTerminals:", error);
      return [];
    }
  }
}

export const terminalsService = new TerminalsService();
