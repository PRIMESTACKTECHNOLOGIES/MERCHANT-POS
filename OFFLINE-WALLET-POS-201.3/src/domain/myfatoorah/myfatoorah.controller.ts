// src/domain/myfatoorah/myfatoorah.controller.ts
import { Request, Response, NextFunction } from "express";
import { myfatoorahService } from "./myfatoorah.service";

export class MyFatoorahController {
  
  /**
   * Handle MyFatoorah webhook callback
   * MyFatoorah calls this when customer completes payment
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("[MyFatoorah Webhook] Received:", req.body);
      
      // MyFatoorah sends payment notification
      const { 
        InvoiceId, 
        InvoiceStatus, 
        InvoiceReference,
        CustomerName,
        CustomerMobile,
        TransactionDate,
        PaymentGateway,
        ReferenceId,
        TrackId,
        TransactionId,
        PaymentId,
        AuthorizationId,
        InvoiceValue
      } = req.body;

      // Verify it's a successful payment
      if (InvoiceStatus !== "Paid") {
        console.log(`[MyFatoorah] Payment not completed. Status: ${InvoiceStatus}`);
        return res.status(200).json({ received: true, status: "ignored" });
      }

      // Process the payment in YOUR database
      await myfatoorahService.processPayment({
        invoiceId: InvoiceId,
        invoiceReference: InvoiceReference,
        customerName: CustomerName,
        customerMobile: CustomerMobile,
        transactionDate: TransactionDate,
        paymentGateway: PaymentGateway,
        referenceId: ReferenceId,
        trackId: TrackId,
        transactionId: TransactionId,
        paymentId: PaymentId,
        authorizationId: AuthorizationId,
        amount: InvoiceValue,
        rawData: req.body
      });

      // Acknowledge receipt to MyFatoorah
      res.status(200).json({ received: true, status: "processed" });
      
    } catch (err) {
      console.error("[MyFatoorah Webhook] Error:", err);
      // Still return 200 to prevent MyFatoorah from retrying
      res.status(200).json({ received: true, status: "error_logged" });
    }
  }

  /**
   * Get payment status from MyFatoorah API
   * Use this to check if invoice is paid
   */
  async getPaymentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const rawInvoiceId = (req.params as any).invoiceId as string | string[] | undefined;
      const invoiceId = Array.isArray(rawInvoiceId) ? rawInvoiceId[0] : rawInvoiceId;
      if (!invoiceId) {
        return res.status(400).json({ error: "Missing invoiceId" });
      }

      const status = await myfatoorahService.checkPaymentStatus(invoiceId);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get all MyFatoorah payments from YOUR database
   */
  async getPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || "default";
      const payments = await myfatoorahService.getPayments(merchantId);
      res.status(200).json(payments);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create a new MyFatoorah payment (called by Android POS)
   */
  async createPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { amount, customerName, customerMobile, description, reference } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const payment = await myfatoorahService.createPayment({
        amount,
        customerName,
        customerMobile,
        description,
        reference
      });

      res.status(200).json(payment);
    } catch (err) {
      next(err);
    }
  }
}

export const myfatoorahController = new MyFatoorahController();
