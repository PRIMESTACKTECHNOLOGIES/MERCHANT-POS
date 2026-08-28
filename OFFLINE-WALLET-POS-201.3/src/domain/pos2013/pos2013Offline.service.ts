// src/domain/pos2013/pos2013Offline.service.ts 
import { db } from "../../config/db"; 
import { 
  Pos2013OfflineBatchRequest, 
  Pos2013OfflineBatchResponse, 
} from "./pos2013.types"; 
import crypto from "crypto";
import { batchesService } from "../batches/batches.service";

export class Pos2013OfflineService { 
  async getTerminalSecret(merchantId: string, terminalId: string): Promise<string | null> {
    const result = await db.query(
      `SELECT terminal_secret FROM terminals WHERE merchant_id = $1 AND terminal_id = $2`,
      [merchantId, terminalId]
    );
    return result.rowCount && result.rowCount > 0 ? result.rows[0].terminal_secret : null;
  }

  async uploadOfflineBatch( 
    payload: Pos2013OfflineBatchRequest 
  ): Promise<Pos2013OfflineBatchResponse> { 
    const client = await db.connect(); 
    try { 
      await client.query("BEGIN"); 

      // 1. Check or Create Batch Record
      // We check if this batch ID was already fully processed to return the SAME settlement code
      const existingBatch = await client.query(
        `SELECT settlement_code, status FROM pos2013_batches 
         WHERE merchant_id = $1 AND terminal_id = $2 AND batch_id = $3`,
        [payload.merchantId, payload.terminalId, payload.batchId]
      );

      let settlementCode = "";

      if (existingBatch.rowCount && existingBatch.rowCount > 0) {
        // Batch already exists
        settlementCode = existingBatch.rows[0].settlement_code;
        // If it was already processed, we can still process individual txns if they were missing, 
        // or just return the existing code.
        // For simplicity, we proceed to check transactions, but we keep the old code.
        if (!settlementCode) {
             // Should not happen if status is PROCESSED, but let's generate if missing
             settlementCode = Math.floor(100000 + Math.random() * 900000).toString();
        }
      } else {
        // New Batch: Generate 6-digit Settlement Code
        settlementCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        const batchUuid = crypto.randomUUID();
        await client.query(
          `INSERT INTO pos2013_batches 
           (id, batch_id, merchant_id, terminal_id, protocol_version, status, settlement_code, txn_count)
           VALUES ($1, $2, $3, $4, $5, 'RECEIVED', $6, $7)`,
          [
            batchUuid,
            payload.batchId, 
            payload.merchantId, 
            payload.terminalId, 
            payload.protocolVersion, 
            settlementCode,
            payload.transactions.length
          ]
        );
      }

      const results: Pos2013OfflineBatchResponse["results"] = []; 

      for (const t of payload.transactions) { 
        // Idempotency check 
        const existing = await client.query( 
          ` 
          SELECT id, status 
          FROM pos2013_transactions 
          WHERE merchant_id = $1 
            AND terminal_id = $2 
            AND batch_id = $3 
            AND local_txn_id = $4 
          `, 
          [payload.merchantId, payload.terminalId, payload.batchId, t.localTxnId] 
        ); 

        if (existing.rowCount && existing.rowCount > 0) { 
          const row = existing.rows[0]; 
          results.push({ 
            localTxnId: t.localTxnId, 
            serverTxnId: row.id, 
            status: "DUPLICATE", 
            message: "Already processed", 
          }); 
          continue; 
        } 

        const serverTxnId = crypto.randomUUID(); 

        await client.query( 
          ` 
          INSERT INTO pos2013_transactions ( 
            id, 
            merchant_id, 
            terminal_id, 
            batch_id, 
            local_txn_id, 
            stan, 
            amount_minor, 
            currency, 
            pan_masked, 
            txn_type, 
            auth_mode, 
            entry_mode, 
            rrn, 
            auth_code, 
            status, 
            emv_data, 
            txn_timestamp 
          ) VALUES ( 
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17 
          ) 
          `, 
          [ 
            serverTxnId, 
            payload.merchantId, 
            payload.terminalId, 
            payload.batchId, 
            t.localTxnId, 
            t.stan, 
            t.amountMinor, 
            t.currency, 
            t.panMasked, 
            t.txnType, 
            t.authMode, 
            t.entryMode, 
            t.rrn || null, 
            t.authCode || null, 
            // server side status: we treat offline-approved as APPROVED 
            t.authMode === "OFFLINE_APPROVED" ? "APPROVED" : "DECLINED", 
            t.emvData || null, 
            t.txnTimestamp, 
          ] 
        ); 

        results.push({ 
          localTxnId: t.localTxnId, 
          serverTxnId, 
          status: "ACCEPTED", 
          message: "Stored successfully"
        }); 
      } 

      // Update batch status to PROCESSED
      await client.query(
        `UPDATE pos2013_batches SET status = 'PROCESSED', updated_at = CURRENT_TIMESTAMP 
         WHERE merchant_id = $1 AND terminal_id = $2 AND batch_id = $3`,
        [payload.merchantId, payload.terminalId, payload.batchId]
      );

      await client.query("COMMIT"); 

      return { 
        protocolVersion: "201.3", 
        merchantId: payload.merchantId, 
        terminalId: payload.terminalId, 
        batchId: payload.batchId, 
        results, 
      };
    } catch (err) { 
      await client.query("ROLLBACK"); 
      throw err; 
    } finally { 
      client.release(); 
    } 
  } 

  async getBatches(merchantId: string) {
    const result = await db.query(
      `SELECT * FROM pos2013_batches WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
    return result.rows;
  }

  async getBatchDetails(merchantId: string, batchId: string) {
    const batch = await db.query(
      `SELECT * FROM pos2013_batches WHERE merchant_id = $1 AND batch_id = $2`,
      [merchantId, batchId]
    );
    
    if (batch.rowCount === 0) return null;

    const transactions = await db.query(
      `SELECT * FROM pos2013_transactions WHERE merchant_id = $1 AND batch_id = $2 ORDER BY txn_timestamp ASC`,
      [merchantId, batchId]
    );

    return {
      batch: batch.rows[0],
      transactions: transactions.rows
    };
  }

  async settleBatch(merchantId: string, batchId: string) {
    // 1. Get the batch first
    const batchRes = await db.query(
      `SELECT * FROM pos2013_batches WHERE merchant_id = $1 AND batch_id = $2 AND status = 'PROCESSED'`,
      [merchantId, batchId]
    );

    if (batchRes.rowCount === 0) return null;
    const batch = batchRes.rows[0];

    // 2. Attempt PayPal Payout / Settlement
    try {
      console.log(`[Settlement] Attempting PayPal settlement for Batch ${batchId}`);
      const payoutResult = await batchesService.cashoutBraintree(merchantId, [batch]);
      
      if (payoutResult.failed > 0) {
        throw new Error(payoutResult.message || "PayPal Settlement Failed");
      }
      
      console.log(`[Settlement] PayPal settlement successful for Batch ${batchId}`);
    } catch (err: any) {
      console.error(`[Settlement] Failed: ${err.message}`);
      // Optionally, we could update status to 'SETTLEMENT_FAILED' here
      // For now, we proceed to mark as SETTLED but log the error, 
      // or rethrow to prevent status update? 
      // Let's rethrow to alert the user in the UI.
      throw new Error(`Settlement Failed: ${err.message}`);
    }

    // 3. Mark as SETTLED in DB
    const result = await db.query(
      `UPDATE pos2013_batches 
       SET status = 'SETTLED', updated_at = CURRENT_TIMESTAMP 
       WHERE merchant_id = $1 AND batch_id = $2 AND status = 'PROCESSED'
       RETURNING *`,
      [merchantId, batchId]
    );
    return result.rowCount && result.rowCount > 0 ? result.rows[0] : null;
  }

  async deleteBatch(merchantId: string, batchId: string) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Delete transactions first
      await client.query(
        `DELETE FROM pos2013_transactions WHERE merchant_id = $1 AND batch_id = $2`,
        [merchantId, batchId]
      );

      // Delete batch
      const result = await client.query(
        `DELETE FROM pos2013_batches WHERE merchant_id = $1 AND batch_id = $2 RETURNING *`,
        [merchantId, batchId]
      );

      await client.query("COMMIT");
      return result.rowCount && result.rowCount > 0 ? result.rows[0] : null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async processOnlineCharge(merchantId: string, amountMinor: number, currency: string, pan?: string, expiry?: string) {
    // In a real app, this would integrate with a Payment Gateway (Stripe/PayPal)
    // For this system, we simulate an approval and record it.
    
    const txnId = crypto.randomUUID();
    const batchId = `ONLINE-${Date.now()}`; // Virtual batch for online txns
    const stan = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
    const authCode = "ONL" + Math.floor(Math.random() * 90000);

    // Mask PAN
    const maskedPan = pan && pan.length >= 4 
      ? pan.substring(0, 4) + "********" + pan.substring(pan.length - 4) 
      : "4111********1111";

    // Create a virtual batch if needed, or just insert transaction with a special batch_id
    // We'll insert directly into pos2013_transactions
    
    await db.query(
      `INSERT INTO pos2013_transactions (
        id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency, 
        pan_masked, txn_type, auth_mode, entry_mode, rrn, auth_code, status, txn_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
      [
        txnId, 
        merchantId, 
        "WEB-POS", // Virtual terminal ID for web
        batchId,
        crypto.randomUUID(),
        stan,
        amountMinor,
        currency,
        maskedPan, // Use dynamic masked PAN
        "SALE",
        "ONLINE",
        "KEYED",
        crypto.randomUUID().substring(0, 12),
        authCode,
        "APPROVED"
      ]
    );

    return {
      status: "APPROVED",
      authCode,
      transactionId: txnId,
      amountMinor,
      currency
    };
  }
} 

export const pos2013OfflineService = new Pos2013OfflineService();
