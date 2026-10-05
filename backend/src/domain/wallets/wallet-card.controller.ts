import { Request, Response } from 'express';
import { walletCardService } from './wallet-card.service';

export class WalletCardController {
  async issue(req: Request, res: Response) {
    try {
      const result = await walletCardService.issueCard(req.body?.customerId, req.body?.currency);
      res.status(result.alreadyIssued ? 200 : 201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to issue wallet card' });
    }
  }

  async issueMerchant(req: Request, res: Response) {
    try {
      const result = await walletCardService.issueMerchantCard(req.body?.merchantId, req.body?.currency);
      res.status(result.alreadyIssued ? 200 : 201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to issue merchant card' });
    }
  }

  async setOfflineLimit(req: Request, res: Response) {
    try {
      const result = await walletCardService.setOfflineLimit(req.body?.cardId, Number(req.body?.limitMinor));
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to set offline limit' });
    }
  }

  async load(req: Request, res: Response) {
    try {
      const result = await walletCardService.loadWalletOnline(req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to load wallet' });
    }
  }

  async sync(req: Request, res: Response) {
    try {
      const result = await walletCardService.syncOfflineTransactions(req.body?.transactions);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to sync offline transactions' });
    }
  }
}

export const walletCardController = new WalletCardController();
