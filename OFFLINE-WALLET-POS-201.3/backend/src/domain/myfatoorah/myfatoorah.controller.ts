import { Request, Response } from "express";
import { db } from "../../config/db";
import axios from "axios";

export class MyFatoorahController {
  
  /**
   * Handle MyFatoorah webhook (POST)
   * Called by MyFatoorah when payment status changes
   */
  async webhook(req: Request, res: Response) {
    try {
      console.log("[MyFatoorah Webhook] Received:", req.body);
      
      // MyFatoorah sends payment status updates
      const {
        InvoiceId,
        InvoiceReference,
        InvoiceStatus,  // "Paid", "Pending", "Canceled"
        InvoiceValue,
        TransactionId,
        PaymentGateway,
        CustomerReference  // This is your localTxnId!
      } = req.body;

      // Validate required fields
      if (!InvoiceId || !InvoiceStatus) {
        console.error("[MyFatoorah Webhook] Missing required fields");
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Update transaction status in database
      // CustomerReference should match your localTxnId
      if (CustomerReference) {
        await db.query(
          `UPDATE myfatoorah_transactions 
           SET orderStatus = ?, 
               mfReference = ?, 
               paymentStatus = ?,
               paidAt = ?
           WHERE localTxnId = ?`,
          [
            InvoiceStatus === "Paid" ? "PAID" : InvoiceStatus.toUpperCase(),
            TransactionId || null,
            InvoiceStatus,
            InvoiceStatus === "Paid" ? Date.now() : null,
            CustomerReference
          ]
        );
        
        console.log(`[MyFatoorah Webhook] Updated transaction ${CustomerReference} to ${InvoiceStatus}`);
      }

      // Always return 200 OK to acknowledge receipt
      // Otherwise MyFatoorah will retry
      res.status(200).json({ 
        success: true, 
        message: "Webhook received",
        invoiceId: InvoiceId,
        status: InvoiceStatus
      });
      
    } catch (error) {
      console.error("[MyFatoorah Webhook] Error:", error);
      // Still return 200 to prevent retries, but log error
      res.status(200).json({ success: false, error: "Processing error" });
    }
  }

  /**
   * Handle GET webhook (some providers use this)
   */
  async webhookGet(req: Request, res: Response) {
    console.log("[MyFatoorah Webhook] GET received:", req.query);
    
    // Some payment providers send data as query params
    const { 
      paymentId, 
      status, 
      ref 
    } = req.query;

    if (paymentId && status && ref) {
      await db.query(
        `UPDATE myfatoorah_transactions 
         SET orderStatus = ?, 
             paidAt = ?
         WHERE localTxnId = ?`,
        [
          status === "success" ? "PAID" : status,
          status === "success" ? Date.now() : null,
          ref
        ]
      );
    }

    res.status(200).json({ success: true });
  }

  /**
   * Execute Payment (LIVE Mode) - Direct card payment
   */
  async executePayment(req: Request, res: Response) {
    try {
      const {
        amount,
        cardNumber,
        expiryMonth,
        expiryYear,
        cvv
      } = req.body;

      // 🔐 Your LIVE API Key from environment
      const API_KEY = process.env.MYFATOORAH_API_KEY || "YOUR_LIVE_API_KEY";

      // 🌐 MyFatoorah LIVE API URL from environment
      const BASE_URL = process.env.MYFATOORAH_BASE_URL || "https://api.myfatoorah.com/v2/";

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      };

      const body = {
        PaymentMethodId: 2, // 2 = Direct Card Payment
        InvoiceValue: amount,
        CardNumber: cardNumber,
        ExpiryMonth: expiryMonth,
        ExpiryYear: expiryYear,
        SecurityCode: cvv
      };

      const response = await axios.post(`${BASE_URL}ExecutePayment`, body, { headers });

      return res.json({
        success: true,
        data: response.data
      });

    } catch (error: any) {
      console.error("Payment Error:", error.response?.data || error.message);

      return res.status(400).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  }
}

export const myFatoorahController = new MyFatoorahController();
