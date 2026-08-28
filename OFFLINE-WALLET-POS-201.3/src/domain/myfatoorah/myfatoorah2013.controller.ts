// src/domain/myfatoorah/myfatoorah2013.controller.ts
// Controller for Protocol 201.3 + MyFatoorah batch processing

import { Request, Response, NextFunction } from "express";
import { myfatoorah2013Service, Protocol2013MyFatoorahTransaction } from "./myfatoorah2013.service";
import { pos2013OfflineService } from "../pos2013/pos2013Offline.service";
import { db } from "../../config/db";
import crypto from "crypto";

function verifyProtocolSignature(body: any, terminalSecret: string): boolean {
  // Format: protocolVersion|merchantId|terminalId|batchId|timestamp|nonce|transactionCount
  const data =
    `${body.protocolVersion}|` +
    `${body.merchantId}|` +
    `${body.terminalId}|` +
    `${body.batchId}|` +
    `${body.timestamp}|` +
    `${body.nonce}|` +
    `${body.transactions.length}`;

  const expected = crypto
    .createHmac("sha256", terminalSecret)
    .update(data, "utf8")
    .digest("base64");

  return expected === body.signature;
}

export class MyFatoorah2013Controller {
  
  /**
   * Handle Protocol 201.3 batch upload with MyFatoorah transactions
   * POST /merchant/v1/pos/201.3/myfatoorah-batch
   */
  async uploadMyFatoorahBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { 
        protocolVersion, 
        merchantId, 
        terminalId, 
        batchId, 
        timestamp, 
        nonce, 
        signature, 
        transactions 
      } = req.body;
      
      // Validate Protocol 201.3 format
      if (protocolVersion !== "201.3") {
        return res.status(400).json({ error: "Invalid protocol version. Expected 201.3" });
      }
      
      if (!merchantId || !terminalId || !batchId || !transactions || !signature || !nonce || !timestamp) {
        return res.status(400).json({ error: "Missing required protocol fields" });
      }

      // Verify HMAC Signature
      const terminalSecret = await pos2013OfflineService.getTerminalSecret(merchantId, terminalId);
      if (!terminalSecret) {
        return res.status(401).json({ error: "Unauthorized: Terminal not found" });
      }

      if (!verifyProtocolSignature(req.body, terminalSecret)) {
        return res.status(401).json({ error: "Invalid protocol signature" });
      }
      
      console.log(`[MyFatoorah2013Controller] Verified batch: ${batchId} with ${transactions.length} transactions`);
      
      // Process batch
      const result = await myfatoorah2013Service.processBatch(
        transactions.map((txn: any) => ({
          localTxnId: txn.localTxnId,
          stan: txn.stan,
          amountMinor: txn.amountMinor,
          currency: txn.currency || "AED",
          customerPhone: txn.customerPhone,
          customerName: txn.customerName,
          description: txn.description,
          batchId,
          merchantId,
          terminalId,
          timestamp: txn.timestamp || timestamp
        })),
        batchId
      );
      
      // Return Protocol 201.3 style response
      res.status(200).json({
        protocolVersion: "201.3",
        batchId,
        merchantId,
        terminalId,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7),
        success: result.failed === 0,
        processed: result.processed,
        failed: result.failed,
        settlementCodes: result.settlementCodes,
        errors: result.errors.length > 0 ? result.errors : undefined
      });
      
    } catch (err) {
      next(err);
    }
  }
  
  /**
   * Handle MyFatoorah webhook for Protocol 201.3 transactions
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      // MyFatoorah v2 webhooks send a signature in the header or body
      // We should verify it using our API Key / Secret Key
      const signature = req.headers["x-myfatoorah-signature"];
      
      if (process.env.NODE_ENV === "production" && !signature) {
        console.warn("[MyFatoorah2013] Webhook received without signature!");
        return res.status(401).json({ error: "No signature provided" });
      }

      // In a real implementation, you'd use MyFatoorah's SDK or manual HMAC verification
      // for the webhook payload here. For now, we'll log it.
      
      const { InvoiceId, InvoiceStatus } = req.body;
      
      if (!InvoiceId || !InvoiceStatus) {
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      await myfatoorah2013Service.handleWebhook(InvoiceId, InvoiceStatus, req.body);
      
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(200).json({ received: true, error: "logged" });
    }
  }
  
  /**
   * Get transaction status (for Android POS to check)
   */
  async getTransactionStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const localTxnId = req.params.localTxnId as string;
      const status = await myfatoorah2013Service.getTransactionStatus(localTxnId);
      
      if (!status) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      
      res.status(200).json({
        localTxnId: status.local_txn_id,
        status: status.status,
        settlementCode: status.settlement_code,
        paymentUrl: status.payment_url,
        amount: status.amount_minor / 100,
        createdAt: status.created_at,
        paidAt: status.paid_at
      });
    } catch (err) {
      next(err);
    }
  }
  
  /**
   * Get batch status
   */
  async getBatchStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { batchId } = req.params;
      const { merchantId } = req.query;
      
      const result = await db.query(
        `SELECT * FROM protocol2013_myfatoorah_transactions 
         WHERE batch_id = ? AND merchant_id = ?
         ORDER BY created_at`,
        [batchId, (merchantId as string) || "default"]
      );
      
      res.status(200).json({
        batchId,
        total: result.rows.length,
        transactions: result.rows.map((row: any) => ({
          localTxnId: row.local_txn_id,
          status: row.status,
          settlementCode: row.settlement_code,
          amount: row.amount_minor / 100,
          customerPhone: row.customer_phone
        }))
      });
    } catch (err) {
      next(err);
    }
  }
}

export const myfatoorah2013Controller = new MyFatoorah2013Controller();
