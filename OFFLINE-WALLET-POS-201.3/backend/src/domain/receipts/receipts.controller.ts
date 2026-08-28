import { Request, Response } from "express";
import { receiptsService } from "./receipts.service";

export class ReceiptsController {
  /**
   * Generate a new receipt for a transaction
   */
  async generate(req: Request, res: Response) {
    try {
      const { transactionId } = req.params;
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';

      const receipt = await receiptsService.generateReceipt(transactionId, merchantId);
      res.json({ success: true, receipt });
    } catch (e: any) {
      console.error('Error generating receipt:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }

  /**
   * Get all receipts for merchant
   */
  async list(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';
      const limit = parseInt(req.query.limit as string) || 50;

      const receipts = await receiptsService.getReceipts(merchantId, limit);
      res.json({ success: true, receipts });
    } catch (e: any) {
      console.error('Error fetching receipts:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }

  /**
   * Get single receipt by ID
   */
  async getById(req: Request, res: Response) {
    try {
      const { receiptId } = req.params;
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';

      const receipt = await receiptsService.getReceiptById(receiptId, merchantId);
      
      if (!receipt) {
        return res.status(404).json({ success: false, error: 'Receipt not found' });
      }

      res.json({ success: true, receipt });
    } catch (e: any) {
      console.error('Error fetching receipt:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }

  /**
   * Print receipt (get printable format)
   */
  async print(req: Request, res: Response) {
    try {
      const { receiptId } = req.params;
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';

      const result = await receiptsService.printReceipt(receiptId, merchantId);
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error('Error printing receipt:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }
}

export const receiptsController = new ReceiptsController();
