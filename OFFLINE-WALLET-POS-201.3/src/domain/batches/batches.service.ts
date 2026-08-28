import { db } from "../../config/db";
import { settingsService } from "../settings/settings.service";

// MyFatoorah Configuration
const MYFATOORAH_TEST_URL = "https://apitest.myfatoorah.com/";
const MYFATOORAH_LIVE_URL = "https://api.myfatoorah.com/";

export class BatchesService {
  
  /**
   * Cashout batches using MyFatoorah API
   * This creates payment links for each transaction in the batch
   */
  async cashoutMyFatoorah(merchantId: string, batches: any[], forceTestMode?: boolean) {
    // 1. Get Settings including MyFatoorah API Token
    const settings = await settingsService.getSettings(merchantId);
    
    // Determine mode - explicit override > settings > default to test
    const isTestMode = forceTestMode !== undefined 
      ? forceTestMode 
      : (settings.test_mode === 1 || settings.test_mode === true);
    
    const myfatoorahToken = settings.myfatoorah_api_token;
    
    console.log(`[MyFatoorah Cashout] Processing for ${merchantId} in ${isTestMode ? "TEST" : "LIVE"} mode`);
    
    if (!myfatoorahToken) {
      return {
        synced: 0,
        failed: batches.length,
        mode: isTestMode ? "TEST" : "LIVE",
        message: "MyFatoorah API Token not configured. Please add it in Settings.",
        details: []
      };
    }

    const baseUrl = isTestMode ? MYFATOORAH_TEST_URL : MYFATOORAH_LIVE_URL;
    const settlementCodes: string[] = [];
    const errors: string[] = [];
    let processed = 0;
    let failed = 0;

    // Process each batch
    for (const batch of batches) {
      try {
        console.log(`[MyFatoorah Cashout] Processing batch ${batch.batchId || batch.id}`);
        
        // Get batch transactions from database if not provided
        const batchDetails = await this.getBatchWithTransactions(merchantId, batch.batchId || batch.id);
        
        if (!batchDetails || !batchDetails.transactions || batchDetails.transactions.length === 0) {
          errors.push(`${batch.batchId || batch.id}: No transactions found`);
          failed++;
          continue;
        }

        // Process each transaction through MyFatoorah
        const batchSettlementCodes: string[] = [];
        
        for (const txn of batchDetails.transactions) {
          try {
            // Create MyFatoorah payment for this transaction
            const paymentResult = await this.createMyFatoorahPayment(
              baseUrl,
              myfatoorahToken,
              txn,
              batch,
              merchantId
            );
            
            if (paymentResult.success && paymentResult.settlementCode) {
              batchSettlementCodes.push(paymentResult.settlementCode);
              
              // Update transaction with settlement info
              await db.query(
                `UPDATE pos2013_transactions 
                 SET status = 'SETTLED', 
                     settlement_code = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [paymentResult.settlementCode, txn.id]
              );
            } else {
              errors.push(`${txn.local_txn_id}: ${paymentResult.error}`);
            }
          } catch (txnError: any) {
            errors.push(`${txn.local_txn_id}: ${txnError.message}`);
          }
        }

        // Update batch status
        if (batchSettlementCodes.length > 0) {
          await db.query(
            `UPDATE pos2013_batches 
             SET status = 'SETTLED',
                 settlement_code = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE merchant_id = ? AND batch_id = ?`,
            [batchSettlementCodes.join(','), merchantId, batch.batchId || batch.id]
          );
          
          settlementCodes.push(...batchSettlementCodes);
          processed++;
        } else {
          failed++;
          errors.push(`${batch.batchId || batch.id}: No transactions could be settled`);
        }

      } catch (batchError: any) {
        console.error(`[MyFatoorah Cashout] Batch error:`, batchError);
        errors.push(`${batch.batchId || batch.id}: ${batchError.message}`);
        failed++;
      }
    }

    return {
      synced: processed,
      failed: failed,
      mode: isTestMode ? "TEST" : "LIVE",
      message: processed > 0 
        ? `Successfully settled ${processed} batch(es) via MyFatoorah ${isTestMode ? "Sandbox" : "Live"}`
        : `Settlement failed. Check your MyFatoorah credentials and try again.`,
      settlementCodes,
      errors: errors.length > 0 ? errors : undefined,
      details: batches.map((b: any) => ({ 
        id: b.batchId || b.id, 
        status: processed > 0 ? 'settled' : 'failed' 
      }))
    };
  }

  /**
   * Create a single payment through MyFatoorah
   */
  private async createMyFatoorahPayment(
    baseUrl: string,
    apiToken: string,
    txn: any,
    batch: any,
    merchantId: string
  ): Promise<{ success: boolean; settlementCode?: string; error?: string; paymentUrl?: string }> {
    try {
      const amount = txn.amount_minor / 100; // Convert from minor units
      
      // Generate 6-digit settlement code
      const settlementCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      const requestBody = {
        InvoiceValue: amount,
        CustomerName: txn.customer_name || "Customer",
        CustomerMobile: txn.customer_mobile || "",
        CustomerReference: `${batch.batchId || batch.id}-${txn.local_txn_id || txn.id}`,
        DisplayCurrencyIso: txn.currency || "AED",
        Language: "EN",
        NotificationOption: "LNK", // Send as link
        CallBackUrl: `${process.env.BACKEND_URL || ''}/merchant/v1/myfatoorah/webhook`,
        ErrorUrl: `${process.env.BACKEND_URL || ''}/merchant/v1/myfatoorah/error`,
        InvoiceItems: [
          {
            ItemName: `Transaction ${txn.stan || ''}`,
            Quantity: 1,
            UnitPrice: amount
          }
        ]
      };

      const response = await fetch(`${baseUrl}v2/SendPayment`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      
      if (!result.IsSuccess) {
        return {
          success: false,
          error: result.Message || "MyFatoorah payment creation failed"
        };
      }

      // Store the MyFatoorah transaction reference
      await db.query(
        `INSERT INTO myfatoorah_transactions (
          transaction_id,
          merchant_id,
          batch_id,
          myfatoorah_invoice_id,
          payment_url,
          settlement_code,
          amount,
          currency,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          txn.id,
          merchantId,
          batch.batchId || batch.id,
          result.Data.InvoiceId,
          result.Data.InvoiceURL,
          settlementCode,
          amount,
          txn.currency || "AED",
          "PENDING"
        ]
      );

      return {
        success: true,
        settlementCode,
        paymentUrl: result.Data.InvoiceURL
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Unknown error creating MyFatoorah payment"
      };
    }
  }

  /**
   * Get batch with its transactions
   */
  private async getBatchWithTransactions(merchantId: string, batchId: string) {
    const batchResult = await db.query(
      `SELECT * FROM pos2013_batches WHERE merchant_id = ? AND batch_id = ?`,
      [merchantId, batchId]
    );
    
    if (batchResult.rowCount === 0) return null;
    
    const transactionsResult = await db.query(
      `SELECT * FROM pos2013_transactions 
       WHERE merchant_id = ? AND batch_id = ?
       ORDER BY txn_timestamp ASC`,
      [merchantId, batchId]
    );
    
    return {
      ...batchResult.rows[0],
      transactions: transactionsResult.rows
    };
  }

  /**
   * Get settlement status for a batch
   */
  async getSettlementStatus(merchantId: string, batchId: string) {
    const result = await db.query(
      `SELECT 
        b.batch_id,
        b.status,
        b.settlement_code,
        b.txn_count,
        COUNT(t.id) as total_transactions,
        SUM(CASE WHEN t.status = 'SETTLED' THEN 1 ELSE 0 END) as settled_count,
        SUM(CASE WHEN t.status = 'APPROVED' THEN 1 ELSE 0 END) as approved_count
      FROM pos2013_batches b
      LEFT JOIN pos2013_transactions t ON b.batch_id = t.batch_id AND b.merchant_id = t.merchant_id
      WHERE b.merchant_id = ? AND b.batch_id = ?
      GROUP BY b.batch_id, b.status, b.settlement_code, b.txn_count`,
      [merchantId, batchId]
    );
    
    return result.rowCount > 0 ? result.rows[0] : null;
  }

  /**
   * Legacy Braintree cashout (kept for backward compatibility)
   */
  async cashoutBraintree(merchantId: string, batches: any[]) {
    console.warn("[Cashout] Braintree is deprecated. Please use MyFatoorah instead.");
    return this.cashoutMyFatoorah(merchantId, batches, true);
  }

  /**
   * Get all batches
   */
  async getBatches() {
    try {
      const res = await db.query(`
        SELECT 
          id, 
          merchant_id, 
          terminal_id, 
          status, 
          batch_seq, 
          settlement_code,
          upload_timestamp,
          txn_count,
          batch_id
        FROM pos2013_batches 
        ORDER BY upload_timestamp DESC
      `);
      return res.rows;
    } catch (e) {
      console.warn("DB Error in getBatches, returning mock");
      return [];
    }
  }
}

export const batchesService = new BatchesService();
