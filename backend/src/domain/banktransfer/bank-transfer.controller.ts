import { Request, Response } from 'express';
import {
  createVirtualAccount,
  getBankTransferTransaction,
  updateTransactionStatus,
  listBankTransferTransactions,
  updateBankTransferTransaction,
  getBankTransferSummary,
  handleTransakWebhook,
  VirtualAccountRequest,
} from './bank-transfer.service';

export class BankTransferController {
  /**
   * Create virtual account
   * POST /create-account
  * Body: { source, destination }
   */
  async createAccount(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { source, destination, transakAccessToken, transakAuthRelianceEmail } = req.body || {};
      if (!source?.fiatCurrency || !source?.paymentMethod) {
        return res.status(400).json({ error: 'source.fiatCurrency and source.paymentMethod are required' });
      }
      if (!destination?.cryptoCurrency || !destination?.walletAddress || !destination?.network) {
        return res.status(400).json({ error: 'destination.cryptoCurrency, destination.walletAddress and destination.network are required' });
      }

      // Get user IP from request
      const userIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '0.0.0.0';

      console.log(
        `[BankTransfer Controller] Creating merchant VBA: merchant=${merchantId}`
      );

      const request: VirtualAccountRequest = {
        source,
        destination,
        userIp,
        accessToken: typeof transakAccessToken === 'string' ? transakAccessToken : undefined,
        userIdentifier: typeof transakAuthRelianceEmail === 'string' ? transakAuthRelianceEmail.trim() : undefined,
      };

      const transaction = await createVirtualAccount(merchantId, request);

      res.status(201).json({
        success: true,
        transaction,
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error creating account:', e);
      const msg: string = String(e?.message || 'Virtual account creation failed');
      // Detect HTTP status from transak service wrapped message "(HTTP 429)" or keywords.
      const fromMessage = /\(HTTP\s+(\d{3})\)/.exec(msg);
      let status: number;
      if (e?.response?.status) status = Number(e.response.status);
      else if (fromMessage) status = Number(fromMessage[1]);
      else if (/rate-limited|429|too many requests|retry in \d+s/i.test(msg)) status = 429;
      else if (/LIVE_TRANSAK_REQUIRED|production|TRANSAK_MODE/i.test(msg)) status = 412;
      else if (/authentication rejected|forbidden|invalid|unauthorized/i.test(msg)) status = 401;
      else if (/required|missing|verify|address|otp/i.test(msg)) status = 400;
      else status = 500;
      res.status(status).json({
        success: false,
        error: msg,
      });
    }
  }

  /**
   * Get transaction details
   * GET /:transactionId
   */
  async getTransaction(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { transactionId } = req.params;

      console.log(
        `[BankTransfer Controller] Getting transaction: ${transactionId}`
      );

      const transaction = await getBankTransferTransaction(
        merchantId,
        transactionId,
        (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0'
      );

      res.json({
        success: true,
        transaction,
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error getting transaction:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async updateTransaction(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) return res.status(401).json({ error: 'Missing merchant ID' });

      const { transactionId } = req.params;
      const { destination } = req.body || {};
      if (!destination?.cryptoCurrency || !destination?.walletAddress || !destination?.network) {
        return res.status(400).json({ error: 'destination.cryptoCurrency, destination.walletAddress and destination.network are required' });
      }

      const transaction = await updateBankTransferTransaction(
        merchantId,
        transactionId,
        destination,
        (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0'
      );
      res.json({ success: true, transaction });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  /**
   * List transactions
   * GET /list?limit=50&offset=0
   */
  async listTransactions(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const offset = parseInt(req.query.offset as string) || 0;

      console.log(
        `[BankTransfer Controller] Listing transactions: merchant=${merchantId}, limit=${limit}, offset=${offset}`
      );

      const { transactions, total } = await listBankTransferTransactions(
        merchantId,
        limit,
        offset,
        (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0'
      );

      res.json({
        success: true,
        transactions,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
        },
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error listing transactions:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Get summary
   * GET /summary
   */
  async getSummary(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      console.log(`[BankTransfer Controller] Getting summary: merchant=${merchantId}`);

      const summary = await getBankTransferSummary(merchantId);

      res.json({
        success: true,
        summary,
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error getting summary:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Update transaction status (admin/system use)
   * POST /:transactionId/status
   * Body: { status, amount?, webhookData? }
   */
  async updateStatus(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { transactionId } = req.params;
      const { status, amount, webhookData } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Missing status' });
      }

      console.log(
        `[BankTransfer Controller] Updating status: ${transactionId} → ${status}`
      );

      await updateTransactionStatus(transactionId, status, amount, webhookData);

      res.json({
        success: true,
        message: `Transaction updated to ${status}`,
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error updating status:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  /**
   * Transak webhook handler (no auth required)
   * POST /webhook
   */
  async handleWebhook(req: Request, res: Response) {
    try {
      console.log('[BankTransfer Controller] Received webhook');

      const webhookData = req.body;

      await handleTransakWebhook(webhookData);

      res.json({
        success: true,
        message: 'Webhook processed',
      });
    } catch (e: any) {
      console.error('[BankTransfer Controller] Error handling webhook:', e);
      res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }
}

export const bankTransferController = new BankTransferController();
