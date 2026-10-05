import { Request, Response } from 'express';
import {
  getDashboardData,
  getPendingTransactions,
  getRecentSettlements,
  getDashboardSummary,
  getUnprocessedSummary,
  processUnprocessedTransactions,
} from './dashboard.service';

export class DashboardController {
  /**
   * Get complete dashboard data
   * GET /data?terminalId=...
   */
  async getDashboard(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { terminalId } = req.query;

      console.log(`[Dashboard Controller] Fetching dashboard: merchant=${merchantId}, terminal=${terminalId}`);

      const dashboard = await getDashboardData(merchantId, terminalId as string);

      res.json({
        success: true,
        dashboard,
      });
    } catch (e: any) {
      console.error('[Dashboard Controller] Error fetching dashboard:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Get summary metrics only
   * GET /summary?terminalId=...
   */
  async getSummary(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { terminalId } = req.query;

      console.log(`[Dashboard Controller] Fetching summary: merchant=${merchantId}`);

      const summary = await getDashboardSummary(merchantId, terminalId as string);

      res.json({
        success: true,
        summary,
      });
    } catch (e: any) {
      console.error('[Dashboard Controller] Error fetching summary:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Get pending transactions
   * GET /pending?terminalId=...&limit=100
   */
  async getPending(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { terminalId } = req.query;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      console.log(`[Dashboard Controller] Fetching pending: merchant=${merchantId}, limit=${limit}`);

      const pending = await getPendingTransactions(merchantId, terminalId as string, limit);

      res.json({
        success: true,
        count: pending.length,
        transactions: pending,
      });
    } catch (e: any) {
      console.error('[Dashboard Controller] Error fetching pending:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Get recent settlements
   * GET /settlements?terminalId=...&limit=50&hoursBack=24
   */
  async getSettlements(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { terminalId } = req.query;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const hoursBack = Math.min(parseInt(req.query.hoursBack as string) || 24, 168); // Max 1 week

      console.log(
        `[Dashboard Controller] Fetching settlements: merchant=${merchantId}, limit=${limit}, hours=${hoursBack}`
      );

      const settlements = await getRecentSettlements(
        merchantId,
        terminalId as string,
        limit,
        hoursBack
      );

      res.json({
        success: true,
        count: settlements.length,
        settlements,
      });
    } catch (e: any) {
      console.error('[Dashboard Controller] Error fetching settlements:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * GET /unprocessed
   * Returns total unprocessed transactions + amount not yet credited to wallet
   */
  async getUnprocessed(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string | undefined;
      const summary = await getUnprocessedSummary(merchantId || undefined);
      res.json({ success: true, ...summary });
    } catch (e: any) {
      console.error('[Dashboard Controller] Error fetching unprocessed:', e);
      const message = e instanceof Error && e.message
        ? e.message
        : 'Batch settlement is unavailable.';
      const status = message.startsWith('LIVE_PROCESSOR_REQUIRED:') ? 409 : 500;
      res.status(status).json({ success: false, message, error: message });
    }
  }

  /**
   * POST /process-batch
   * Credit all unprocessed transactions to merchant wallet + USDT balance
   */
  async processBatch(req: Request, res: Response) {
    try {
      const merchantId =
        (req.body?.merchantId as string) ||
        (req.headers['x-merchant-id'] as string);
      if (!merchantId) {
        return res.status(400).json({ error: 'merchantId required' });
      }
      const result = await processUnprocessedTransactions(merchantId);
      res.json(result);
    } catch (e: any) {
      console.error('[Dashboard Controller] Error processing batch:', e);
      const message = e instanceof Error && e.message
        ? e.message
        : 'Batch settlement is unavailable.';
      const status = message.startsWith('LIVE_PROCESSOR_REQUIRED:') ? 409 : 500;
      res.status(status).json({ success: false, message, error: message });
    }
  }
}

export const dashboardController = new DashboardController();
