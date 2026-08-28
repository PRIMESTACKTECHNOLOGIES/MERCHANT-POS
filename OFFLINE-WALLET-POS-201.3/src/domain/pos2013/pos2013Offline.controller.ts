// src/domain/pos2013/pos2013Offline.controller.ts 
 import { Request, Response, NextFunction } from "express"; 
import { pos2013OfflineService } from "./pos2013Offline.service"; 
import { Pos2013OfflineBatchRequest } from "./pos2013.types"; 
import crypto from "crypto";

function verifySignature(body: any, terminalSecret: string): boolean {
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

export class Pos2013OfflineController { 
   async uploadOfflineBatch(req: Request, res: Response, next: NextFunction) { 
     try { 
       const body = req.body as Pos2013OfflineBatchRequest; 
 
       // Basic validation (you can replace with Zod/Joi) 
      if ( 
        body.protocolVersion !== "201.3" || 
        !body.merchantId || 
        !body.terminalId || 
        !body.batchId || 
        !body.nonce || 
        !body.timestamp || 
        !body.signature || 
        !Array.isArray(body.transactions) 
      ) { 
        return res.status(400).json({ error: "Invalid payload: Missing required fields (nonce, timestamp, signature)" }); 
      } 

      const terminalSecret = await pos2013OfflineService.getTerminalSecret(body.merchantId, body.terminalId);

      if (!terminalSecret) {
        return res.status(401).json({ error: "Unauthorized: Terminal not found or not registered" });
      }

      if (!verifySignature(req.body, terminalSecret)) { 
        return res.status(401).json({ error: "Invalid signature" }); 
      } 
 
       const response = await pos2013OfflineService.uploadOfflineBatch(body); 
       res.status(200).json(response); 
     } catch (err) { 
       next(err); 
     } 
   } 

   async getBatches(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || "MRC-1001";
      const batches = await pos2013OfflineService.getBatches(merchantId);
      res.status(200).json(batches);
    } catch (err) {
      next(err);
    }
  }

  async getBatchDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || "MRC-1001";
      const batchId = req.params.batchId as string;
      const details = await pos2013OfflineService.getBatchDetails(merchantId, batchId);
      
      if (!details) {
        return res.status(404).json({ error: "Batch not found" });
      }
      
      res.status(200).json(details);
    } catch (err) {
      next(err);
    }
  }

  async settleBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || "MRC-1001";
      const batchId = req.params.batchId as string;
      
      const batch = await pos2013OfflineService.settleBatch(merchantId, batchId);
      
      if (!batch) {
        return res.status(400).json({ error: "Batch not found or not in PROCESSED state" });
      }
      
      res.status(200).json({ message: "Batch settled successfully", batch });
    } catch (err) {
      next(err);
    }
  }

  async deleteBatch(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = (req.query.merchantId as string) || "MRC-1001";
      const batchId = req.params.batchId as string;
      
      const batch = await pos2013OfflineService.deleteBatch(merchantId, batchId);
      
      if (!batch) {
        return res.status(404).json({ error: "Batch not found" });
      }
      
      res.status(200).json({ message: "Batch deleted successfully" });
    } catch (err) {
      next(err);
    }
  }

  async chargePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { amountMinor, currency, merchantId, pan, expiry } = req.body;
      
      if (!amountMinor || amountMinor <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      // Call service to record transaction
      const result = await pos2013OfflineService.processOnlineCharge(merchantId, amountMinor, currency, pan, expiry);
      
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const pos2013OfflineController = new Pos2013OfflineController();