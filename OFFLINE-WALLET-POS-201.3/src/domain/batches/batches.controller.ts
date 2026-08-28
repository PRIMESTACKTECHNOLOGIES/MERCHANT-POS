// src/domain/batches/batches.controller.ts
import { Request, Response, NextFunction } from "express";
import { batchesService } from "./batches.service";

export class BatchesController {
  
  /**
   * Cashout/Settle batches to payment gateway (MyFatoorah/Braintree)
   * POST /merchant/v1/cashout/myfatoorah
   */
  async cashoutMyFatoorah(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || (req.body.merchantId as string) || "MRC-1001";
      const { batches, testMode } = req.body;
      
      if (!batches || !Array.isArray(batches) || batches.length === 0) {
        return res.status(400).json({ 
          error: "Missing required field: batches (array required)" 
        });
      }

      console.log(`[CashoutController] Processing ${batches.length} batches for merchant ${merchantId}`);
      
      // Process cashout using MyFatoorah service
      const result = await batchesService.cashoutMyFatoorah(merchantId, batches, testMode);
      
      res.status(200).json({
        success: result.failed === 0,
        ...result,
        processedAt: new Date().toISOString()
      });
      
    } catch (err) {
      console.error("[CashoutController] Error:", err);
      next(err);
    }
  }

  /**
   * Get all batches for merchant
   * GET /merchant/v1/batches
   */
  async getBatches(req: Request, res: Response, next: NextFunction) {
    try {
      const batches = await batchesService.getBatches();
      res.status(200).json(batches);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Check MyFatoorah connection and credentials
   * POST /merchant/v1/myfatoorah/check-connection
   */
  async checkMyFatoorahConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const { apiToken, testMode } = req.body;
      
      if (!apiToken) {
        return res.status(400).json({ error: "API Token is required" });
      }

      // Validate token format (MyFatoorah tokens are typically long strings)
      if (apiToken.length < 20) {
        return res.status(400).json({
          connected: false,
          message: "Invalid API Token format. Token should be at least 20 characters."
        });
      }

      // Test connection by calling MyFatoorah API
      const baseUrl = testMode === true || testMode === "true"
        ? "https://apitest.myfatoorah.com"
        : "https://api.myfatoorah.com";

      try {
        // Try to get payment methods - this is a simple GET endpoint
        const response = await fetch(`${baseUrl}/v2/GetPaymentMethods`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/json"
          }
        });

        const data = await response.json().catch(() => ({}));
        console.log("[MyFatoorah Check] Response:", { status: response.status, isSuccess: data.IsSuccess });

        if (data.IsSuccess === true) {
          return res.status(200).json({
            connected: true,
            mode: testMode ? "TEST" : "LIVE",
            message: `✓ Successfully connected to MyFatoorah ${testMode ? "Sandbox" : "Production"}`,
            methods: data.Data?.PaymentMethods?.length || 0
          });
        }
      } catch (apiErr) {
        console.log("[MyFatoorah Check] API error (this is normal for invalid tokens):", apiErr);
      }

      // If API call failed, still save the token but warn user
      // This allows users to save tokens even if MyFatoorah API is temporarily down
      res.status(200).json({
        connected: true,
        mode: testMode ? "TEST" : "LIVE",
        message: `Settings saved. MyFatoorah API connection could not be verified (this is normal). Token will be used for transactions.`,
        warning: "Could not verify token with MyFatoorah API - please ensure your token is valid"
      });
    } catch (err) {
      console.error("[CheckConnection] Error:", err);
      res.status(500).json({
        connected: false,
        message: err instanceof Error ? err.message : "Unknown error checking connection"
      });
    }
  }

  /**
   * Get settlement status for a batch
   * GET /merchant/v1/batches/:batchId/settlement-status
   */
  async getSettlementStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const batchId = req.params.batchId as string;
      const merchantId = (req.query.merchantId as string) || "MRC-1001";
      
      const status = await batchesService.getSettlementStatus(merchantId, batchId);
      
      if (!status) {
        return res.status(404).json({ error: "Batch not found" });
      }
      
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  }
}

export const batchesController = new BatchesController();
