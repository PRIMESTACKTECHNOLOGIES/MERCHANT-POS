import { Request, Response } from "express";

/**
 * Settlement Controller
 * 
 * NOTE: This controller's methods rely on settlement.service.ts which was refactored
 * to funds-settlement.service.ts. These endpoints are temporarily disabled until
 * the service layer is properly reconnected.
 * 
 * For new settlement operations, use the funds-settlement.service.ts directly.
 */

export class SettlementsController {
  
  async settleReconciliationBatch(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring',
      message: 'Use funds-settlement.service.ts for settlement operations'
    });
  }

  async getMerchantSummary(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring'
    });
  }

  async getBatchDetails(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring'
    });
  }

  async listBatches(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring'
    });
  }

  async reverseSettlement(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring'
    });
  }

  async adjustSettlement(req: Request, res: Response) {
    res.status(501).json({ 
      error: 'This endpoint is temporarily disabled during refactoring'
    });
  }
}

export const settlementsController = new SettlementsController();
