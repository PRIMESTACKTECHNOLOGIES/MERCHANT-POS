import { Request, Response } from "express";
import { batchesService } from "./batches.service";
import { db } from "../../config/db";

export class BatchesController {
  /**
   * List all batches (optionally filtered by merchant)
   */
  async list(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      
      // If merchant ID provided, filter by it
      const batches = await batchesService.getBatches(merchantId);
      res.json(batches);
    } catch (e: any) {
      console.error('Error listing batches:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Process offline batch upload from POS device
   */
  async processOfflineBatch(req: Request, res: Response) {
    try {
      // Get credentials from headers
      const merchantId = req.headers['x-merchant-id'] as string || req.body.merchantId;
      const terminalId = req.headers['x-terminal-id'] as string || req.body.terminalId;
      const signature = req.headers['x-signature'] as string;
      const batchData = req.body;

      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      if (!terminalId) {
        return res.status(401).json({ error: 'Missing terminal ID' });
      }

      console.log('[Protocol 201.3] Batch upload received:', {
        merchantId,
        terminalId,
        batchId: batchData.batchId,
        txnCount: batchData.transactions?.length || 0,
        hasSignature: !!signature
      });

      // Add signature to batch data for verification
      batchData.signature = signature;

      const result = await batchesService.processOfflineBatch(merchantId, terminalId, batchData);
      
      console.log('[Protocol 201.3] Batch processed successfully:', {
        batchId: result.batchId,
        settlementCode: result.settlementCode,
        txnCount: result.txnCount
      });

      res.json(result);
    } catch (e: any) {
      console.error('Error processing offline batch:', e);
      res.status(400).json({ error: e.message });
    }
  }

  /**
   * Get transactions list
   */
  async getTransactions(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const transactions = await batchesService.getTransactions(merchantId, limit);
      res.json(transactions);
    } catch (e: any) {
      console.error('Error fetching transactions:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Verify merchant credentials
   */
  async verifyCredentials(req: Request, res: Response) {
    try {
      const { merchantId, secretKey } = req.body;

      if (!merchantId || !secretKey) {
        return res.status(400).json({ 
          valid: false, 
          error: 'Missing merchant ID or secret key' 
        });
      }

      // Get merchant settings from database
      const result = await db.query(
        'SELECT merchant_id, api_key FROM merchant_settings WHERE merchant_id = ?',
        [merchantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          valid: false, 
          error: 'Merchant not found' 
        });
      }

      const merchant = result.rows[0];

      // Verify secret key
      if (merchant.api_key !== secretKey) {
        return res.status(401).json({ 
          valid: false, 
          error: 'Invalid secret key' 
        });
      }

      res.json({ 
        valid: true, 
        merchantId: merchant.merchant_id,
        message: 'Credentials verified successfully'
      });
    } catch (e: any) {
      console.error('Error verifying credentials:', e);
      res.status(500).json({ valid: false, error: e.message });
    }
  }

  /**
   * Redeem a payment code (Live transaction)
   */
  async redeemPaymentCode(req: Request, res: Response) {
    try {
      const { code, amount, merchantId } = req.body;
      
      if (!code || !amount) {
        return res.status(400).json({ error: 'Missing code or amount' });
      }

      const result = await batchesService.redeemPaymentCode({
        code,
        amount,
        merchantId: merchantId || req.headers['x-merchant-id'] as string || 'MRC-1001'
      });

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (e: any) {
      console.error('Error redeeming code:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Legacy Braintree cashout (deprecated)
   */
  async cashoutBraintree(req: Request, res: Response) {
    try {
      const { batches } = req.body;
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';
      
      console.warn('[Deprecated] Braintree cashout called by:', merchantId);
      
      const result = await batchesService.cashoutBraintree(merchantId, batches);
      res.json(result);
    } catch (e: any) {
      console.error('Error in cashout:', e);
      res.status(500).json({ error: e.message });
    }
  }
}

export const batchesController = new BatchesController();
