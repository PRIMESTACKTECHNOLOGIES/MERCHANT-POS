import { db } from "../../config/db";
import { v4 as uuid } from "uuid";

export class TerminalsService {
  async registerTerminal(name: string, deviceSerial?: string) {
    const id = uuid();
    const merchantId = "MRC-1001";
    const terminalId = deviceSerial ? String(deviceSerial) : "T2013-" + Math.floor(Math.random() * 9999);
    const terminalSecret = uuid().replace(/-/g, "");

    await db.query(
      `INSERT INTO terminals (id, merchant_id, terminal_id, name, terminal_secret, offline_enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, merchantId, terminalId, name, terminalSecret]
    );

    return { id, merchantId, terminalId, terminalSecret, offlineEnabled: true };
  }

  async regenerateTerminalSecret(merchantId: string, terminalId: string) {
    const terminalSecret = uuid().replace(/-/g, "");
    await db.query(
      `UPDATE terminals SET terminal_secret = ? WHERE merchant_id = ? AND terminal_id = ?`,
      [terminalSecret, merchantId, terminalId]
    );
    const res = await db.query(
      `SELECT id, merchant_id, terminal_id, name, terminal_secret, offline_enabled
       FROM terminals WHERE merchant_id = ? AND terminal_id = ? LIMIT 1`,
      [merchantId, terminalId]
    );
    if (!res.rows.length) return null;
    const row = res.rows[0] as any;
    return {
      id: row.id, merchantId: row.merchant_id, terminalId: row.terminal_id,
      name: row.name, terminalSecret: row.terminal_secret, offlineEnabled: row.offline_enabled
    };
  }

  async verifyTerminal(merchantId: string, terminalId: string, secretKey: string) {
    try {
      const result = await db.query(
        `SELECT id, merchant_id, terminal_id, name, terminal_secret, offline_enabled, floor_limit
         FROM terminals WHERE merchant_id = ? AND terminal_id = ? LIMIT 1`,
        [merchantId, terminalId]
      );
      if (!result.rows.length) return { valid: false, message: "Terminal not found" };
      const terminal = result.rows[0] as any;
      if (terminal.terminal_secret !== secretKey) return { valid: false, message: "Invalid secret key" };

      // Update last_seen_at so dashboard shows ONLINE status
      const now = new Date().toISOString();
      await db.query(
        `UPDATE terminals SET last_seen_at = ? WHERE merchant_id = ? AND terminal_id = ?`,
        [now, merchantId, terminalId]
      ).catch(() => {
        // Column may not exist yet — add it silently
        db.query(`ALTER TABLE terminals ADD COLUMN last_seen_at TEXT`).catch(() => {});
      });

      return {
        valid: true, merchantId: terminal.merchant_id, terminalId: terminal.terminal_id,
        name: terminal.name, offlineEnabled: Boolean(terminal.offline_enabled),
        floorLimit: Number(terminal.floor_limit || 0)
      };
    } catch (error) {
      console.error("Error verifying terminal:", error);
      return { valid: false, message: "Verification error" };
    }
  }

  async deleteTerminal(merchantId: string, terminalId: string) {
    try {
      const res = await db.query(
        `SELECT id, merchant_id, terminal_id, name FROM terminals
         WHERE merchant_id = ? AND terminal_id = ? LIMIT 1`,
        [merchantId, terminalId]
      );
      if (!res.rows.length) return null;
      await db.query(
        `DELETE FROM terminals WHERE merchant_id = ? AND terminal_id = ?`,
        [merchantId, terminalId]
      );
      const row = res.rows[0] as any;
      return { id: row.id, merchantId: row.merchant_id, terminalId: row.terminal_id, name: row.name };
    } catch (error) {
      console.error("Error deleting terminal:", error);
      throw error;
    }
  }

  async getTerminals() {
    const result = await db.query(
      `SELECT id, merchant_id, terminal_id, name, offline_enabled, floor_limit, last_seen_at, created_at
       FROM terminals ORDER BY created_at DESC`
    );
    return (result.rows as any[]).map(row => ({
      id: row.id,
      merchantId: row.merchant_id,
      terminalId: row.terminal_id,
      name: row.name,
      offlineEnabled: Boolean(row.offline_enabled),
      floorLimit: Number(row.floor_limit || 0),
      lastBatchAt: row.last_seen_at || null,   // frontend uses lastBatchAt for ONLINE status
      createdAt: row.created_at
    }));
  }
}

export const terminalsService = new TerminalsService();
