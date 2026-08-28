// src/domain/myfatoorah/myfatoorah2013.service.ts
// MyFatoorah integration for Protocol 201.3 batch processing

import { db } from "../../config/db";

const MYFATOORAH_BASE_URL = process.env.MYFATOORAH_TEST_MODE === "true" 
  ? "https://apitest.myfatoorah.com/" 
  : "https://api.myfatoorah.com/";

const MYFATOORAH_API_KEY = process.env.MYFATOORAH_API_KEY || "";

export interface Protocol2013MyFatoorahTransaction {
  localTxnId: string;
  stan: string;
  amountMinor: number;
  currency: string;
  customerPhone: string;
  customerName: string;
  description?: string;
  batchId: string;
  merchantId: string;
  terminalId: string;
  timestamp: number;
}

export class MyFatoorah2013Service {
  
  /**
   * Process Protocol 201.3 batch transaction with MyFatoorah
   * Creates payment link instead of processing card
   */
  async processBatchTransaction(
    transaction: Protocol2013MyFatoorahTransaction
  ): Promise<{ success: boolean; settlementCode?: string; error?: string; paymentUrl?: string }> {
    try {
      console.log(`[MyFatoorah2013] Processing transaction: ${transaction.localTxnId}`);
      
      // Convert amount from minor units
      const amount = transaction.amountMinor / 100;
      
      // Create MyFatoorah payment link
      const requestBody = {
        InvoiceValue: amount,
        CustomerName: transaction.customerName || "Customer",
        CustomerMobile: transaction.customerPhone,
        CustomerReference: `${transaction.batchId}-${transaction.localTxnId}`,
        DisplayCurrencyIso: transaction.currency || "AED",
        Language: "EN",
        NotificationOption: "LNK", // Send as link
        CallBackUrl: `${process.env.BACKEND_URL}/api/myfatoorah/webhook`,
        ErrorUrl: `${process.env.BACKEND_URL}/api/myfatoorah/error`,
        InvoiceItems: [
          {
            ItemName: transaction.description || "Purchase",
            Quantity: 1,
            UnitPrice: amount
          }
        ]
      };

      const response = await fetch(`${MYFATOORAH_BASE_URL}v2/SendPayment`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${MYFATOORAH_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      
      if (!result.IsSuccess) {
        console.error("[MyFatoorah2013] Failed:", result.Message);
        return { 
          success: false, 
          error: result.Message || "Failed to create payment link" 
        };
      }

      // Generate 6-digit settlement code (Protocol 201.3 style)
      const settlementCode = this.generateSettlementCode();
      
      // Save to database
      await db.query(
        `INSERT INTO protocol2013_myfatoorah_transactions (
          local_txn_id,
          stan,
          batch_id,
          merchant_id,
          terminal_id,
          amount_minor,
          currency,
          customer_phone,
          customer_name,
          description,
          myfatoorah_invoice_id,
          payment_url,
          settlement_code,
          status,
          txn_timestamp,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (local_txn_id) DO UPDATE SET
          status = $14,
          settlement_code = $13,
          updated_at = NOW()`,
        [
          transaction.localTxnId,
          transaction.stan,
          transaction.batchId,
          transaction.merchantId,
          transaction.terminalId,
          transaction.amountMinor,
          transaction.currency,
          transaction.customerPhone,
          transaction.customerName,
          transaction.description,
          result.Data.InvoiceId,
          result.Data.InvoiceURL,
          settlementCode,
          "LINK_SENT",
          new Date(transaction.timestamp).toISOString()
        ]
      );

      console.log(`[MyFatoorah2013] Success - Settlement Code: ${settlementCode}`);
      
      return {
        success: true,
        settlementCode,
        paymentUrl: result.Data.InvoiceURL
      };
      
    } catch (error) {
      console.error("[MyFatoorah2013] Error:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }
  
  /**
   * Process entire batch (multiple transactions)
   */
  async processBatch(
    transactions: Protocol2013MyFatoorahTransaction[],
    batchId: string
  ): Promise<{
    batchId: string;
    processed: number;
    failed: number;
    settlementCodes: string[];
    errors: string[];
  }> {
    console.log(`[MyFatoorah2013] Processing batch: ${batchId} (${transactions.length} transactions)`);
    
    let processed = 0;
    let failed = 0;
    const settlementCodes: string[] = [];
    const errors: string[] = [];
    
    for (const txn of transactions) {
      const result = await this.processBatchTransaction(txn);
      
      if (result.success) {
        processed++;
        if (result.settlementCode) {
          settlementCodes.push(result.settlementCode);
        }
      } else {
        failed++;
        errors.push(`${txn.localTxnId}: ${result.error}`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Update batch status
    await db.query(
      `INSERT INTO protocol2013_batches (
        batch_id, merchant_id, terminal_id, protocol_version, 
        status, settlement_code, txn_count, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (merchant_id, terminal_id, batch_id) DO UPDATE SET
        status = $5,
        settlement_code = $6,
        updated_at = NOW()`,
      [
        batchId,
        transactions[0]?.merchantId || "unknown",
        transactions[0]?.terminalId || "unknown",
        "201.3-MYFATOORAH",
        failed === 0 ? "PROCESSED" : "PARTIAL",
        settlementCodes.join(","),
        transactions.length
      ]
    );
    
    return {
      batchId,
      processed,
      failed,
      settlementCodes,
      errors
    };
  }
  
  /**
   * Handle webhook from MyFatoorah - update transaction status
   */
  async handleWebhook(invoiceId: number, status: string, data: any): Promise<void> {
    console.log(`[MyFatoorah2013] Webhook received: Invoice ${invoiceId} = ${status}`);
    
    const dbStatus = status === "Paid" ? "PAID" : status.toUpperCase();
    
    await db.query(
      `UPDATE protocol2013_myfatoorah_transactions 
       SET status = $1, 
           paid_at = CASE WHEN $1 = 'PAID' THEN NOW() ELSE paid_at END,
           raw_webhook_data = $2,
           updated_at = NOW()
       WHERE myfatoorah_invoice_id = $3`,
      [dbStatus, JSON.stringify(data), invoiceId]
    );
    
    console.log(`[MyFatoorah2013] Transaction ${invoiceId} updated to ${dbStatus}`);
  }
  
  /**
   * Get transaction status by local_txn_id
   */
  async getTransactionStatus(localTxnId: string): Promise<any> {
    const result = await db.query(
      `SELECT * FROM protocol2013_myfatoorah_transactions 
       WHERE local_txn_id = $1`,
      [localTxnId]
    );
    return result.rows[0];
  }
  
  private generateSettlementCode(): string {
    // Generate 6-digit code like your existing Protocol 201.3
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const myfatoorah2013Service = new MyFatoorah2013Service();
