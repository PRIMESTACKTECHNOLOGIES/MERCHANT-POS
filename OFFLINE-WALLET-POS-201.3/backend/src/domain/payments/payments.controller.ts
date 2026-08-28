import { Request, Response } from "express";
import { paymentsService } from "./payments.service";

export class PaymentsController {
  async charge(req: Request, res: Response) {
    try {
      const { amountMinor, currency, cardToken, merchantId } = req.body || {};
      if (!amountMinor || !currency) {
        return res.status(400).json({ error: "amountMinor and currency required" });
      }
      const mid = merchantId || "MRC-1001";
      const result = await paymentsService.charge(mid, { amountMinor, currency, cardToken });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Charge failed" });
    }
  }

  async readAcr122uCard(req: Request, res: Response) {
    try {
      const result = await paymentsService.readAcr122uCard();
      res.json(result);
    } catch (e: any) {
      res.status(503).json({ error: e.message || "ACR122U reader unavailable" });
    }
  }

  async getAcr122uStatus(req: Request, res: Response) {
    try {
      const status = await paymentsService.getAcr122uStatus();
      res.json(status);
    } catch (e: any) {
      res.status(503).json({ error: e.message || "Unable to get NFC status" });
    }
  }
}

export const paymentsController = new PaymentsController();
