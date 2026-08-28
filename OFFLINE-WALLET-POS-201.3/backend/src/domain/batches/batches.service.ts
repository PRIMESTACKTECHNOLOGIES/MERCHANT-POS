import { db } from "../../config/db";
import { settingsService } from "../settings/settings.service";
import crypto from "crypto";

export class BatchesService {
  /**
   * Process offline batch upload with Protocol 201.3
   */
  async processOfflineBatch(merchantId: string, terminalId: string, batchData: any) {
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');

      const {
        protocolVersion,
        batchId,
        timestamp,
        nonce,
        signature,
        transactions = []
      } = batchData;

      // Verify HMAC signature
      const settings = await settingsService.getSettings(merchantId);
      const expectedSignature = this.generateHmacSignature(
        protocolVersion,
        merchantId,
        terminalId,
        batchId,
        timestamp,
        nonce,
        transactions.length,
        settings.api_key || 'sk_test_mock_key_12345'
      );

      if (signature !== expectedSignature) {
        await client.query('ROLLBACK');
        throw new Error('Invalid signature');
      }

      // Calculate total amount
      const totalAmountMinor = transactions.reduce((sum: number, txn: any) => sum + (txn.amountMinor || 0), 0);

      // Insert batch record
      await client.query(`
        INSERT INTO pos2013_batches (
          batch_id, merchant_id, terminal_id, protocol_version, status,
          txn_count, total_amount_minor, signature, nonce, upload_timestamp
        ) VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(merchant_id, terminal_id, batch_id) DO UPDATE SET
          status = 'RECEIVED',
          txn_count = excluded.txn_count,
          total_amount_minor = excluded.total_amount_minor,
          updated_at = datetime('now')
      `, [
        batchId, merchantId, terminalId, protocolVersion,
        transactions.length, totalAmountMinor, signature, nonce
      ]);

      // Insert transactions
      for (const txn of transactions) {
        await client.query(`
          INSERT INTO pos2013_transactions (
            id, merchant_id, terminal_id, batch_id, local_txn_id,
            stan, amount_minor, currency, pan_masked, txn_type,
            auth_mode, entry_mode, status, emv_data, txn_timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(merchant_id, terminal_id, batch_id, local_txn_id) DO NOTHING
        `, [
          txn.id || `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          merchantId,
          terminalId,
          batchId,
          txn.localTxnId || `LOCAL-${Date.now()}`,
          txn.stan,
          txn.amountMinor,
          txn.currency || 'USD',
          txn.panMasked || '****',
          txn.txnType || 'SALE',
          txn.authMode || 'OFFLINE_APPROVED',
          txn.entryMode || 'MANUAL',
          'PENDING',
          txn.emvData ? JSON.stringify(txn.emvData) : null,
          new Date(txn.timestamp || Date.now()).toISOString()
        ]);
      }

      // Update batch status to PROCESSED
      await client.query(`
        UPDATE pos2013_batches 
        SET status = 'PROCESSED', processed_at = datetime('now'), updated_at = datetime('now')
        WHERE merchant_id = ? AND terminal_id = ? AND batch_id = ?
      `, [merchantId, terminalId, batchId]);

      await client.query('COMMIT');

      return {
        success: true,
        batchId,
        settlementCode: String(Math.floor(100000 + Math.random() * 900000)), // 6-digit code
        txnCount: transactions.length,
        totalAmountMinor
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error processing batch:', error);
      throw error;
    }
  }

  /**
   * Generate HMAC-SHA256 signature for batch verification
   */
  private generateHmacSignature(
    protocolVersion: string,
    merchantId: string,
    terminalId: string,
    batchId: string,
    timestamp: number,
    nonce: string,
    transactionCount: number,
    secretKey: string
  ): string {
    const data = `${protocolVersion}|${merchantId}|${terminalId}|${batchId}|${timestamp}|${nonce}|${transactionCount}`;
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(data);
    return hmac.digest('base64');
  }

  /**
   * Redeem a payment code (Live transaction)
   */
  async redeemPaymentCode(payload: { code: string; amount: number; merchantId: string }) {
    const { code, amount, merchantId } = payload;
    
    // Check if code exists and is unused
    const result = await db.query(
      `SELECT * FROM payment_codes 
       WHERE code = ? AND used = FALSE 
       LIMIT 1`,
      [code]
    );

    if (result.rows.length === 0) {
      return { success: false, message: 'Invalid or expired code' };
    }

    const paymentCode = result.rows[0];

    // Verify amount matches
    if (paymentCode.amount_minor !== Math.round(amount * 100)) {
      return { success: false, message: 'Amount mismatch' };
    }

    // Mark code as used
    await db.query(
      `UPDATE payment_codes 
       SET used = TRUE, used_at = datetime('now'), used_by_merchant = ? 
       WHERE code = ?`,
      [merchantId, code]
    );

    return {
      success: true,
      message: 'Payment redeemed successfully',
      reference: paymentCode.reference,
      time: new Date().toISOString()
    };
  }

  async cashoutBraintree(merchantId: string, batches: any[]) {
    // Legacy method - kept for backward compatibility
    console.log(`[Legacy Cashout] Processing ${batches.length} batches for ${merchantId}`);
    return {
      synced: batches.length,
      failed: 0,
      mode: "TEST",
      details: batches.map((b: any) => ({ id: b.batchId || "unknown", status: "authorized_sandbox" }))
    };
  }

  async getBatches(merchantId?: string) {
    try {
      let query = `
        SELECT 
          b.batch_id as id,
          b.merchant_id,
          b.terminal_id,
          b.status,
          b.txn_count,
          b.total_amount_minor,
          b.settlement_code,
          b.upload_timestamp,
          b.protocol_version
        FROM pos2013_batches b
      `;
      
      const params: any[] = [];
      
      if (merchantId) {
        query += ` WHERE b.merchant_id = ?`;
        params.push(merchantId);
      }
      
      query += ` ORDER BY b.upload_timestamp DESC`;
      
      const res = await db.query(query, params);
      return res.rows;
    } catch (e) {
      console.error("DB Error in getBatches:", e);
      return [];
    }
  }
  
  /**
   * Get transactions for a specific merchant
   */
  async getTransactions(merchantId?: string, limit: number = 100) {
    try {
      let query = `
        SELECT 
          t.id,
          t.stan,
          t.amount_minor,
          t.currency,
          t.pan_masked,
          t.status,
          t.txn_timestamp,
          t.terminal_id,
          t.batch_id
        FROM pos2013_transactions t
      `;
      
      const params: any[] = [];
      
      if (merchantId) {
        query += ` WHERE t.merchant_id = ?`;
        params.push(merchantId);
      }
      
      query += ` ORDER BY t.txn_timestamp DESC LIMIT ?`;
      params.push(limit);
      
      const res = await db.query(query, params);
      return res.rows.map((row: any) => ({
        ...row,
        amount: (row.amount_minor / 100).toFixed(2)
      }));
    } catch (e) {
      console.error("DB Error in getTransactions:", e);
      return [];
    }
  }
}

export const batchesService = new BatchesService();
