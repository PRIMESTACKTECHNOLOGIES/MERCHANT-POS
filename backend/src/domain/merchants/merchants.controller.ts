import { Request, Response } from "express";
import { merchantsService } from "./merchants.service";

export class MerchantsController {
  async list(_req: Request, res: Response) {
    try {
      res.json(await merchantsService.listMerchantProfiles());
    } catch (error: any) {
      console.error("[Merchants] list error:", error);
      res.status(500).json({ error: error?.message || "Failed to load merchant profiles" });
    }
  }

  async get(req: Request, res: Response) {
    try {
      const { merchantId } = req.params;
      if (!merchantId) return res.status(400).json({ error: "merchantId is required" });
      res.json(await merchantsService.getMerchantProfile(merchantId));
    } catch (error: any) {
      const message = error?.message || "Failed to load merchant profile";
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const { merchantId } = req.params;
      const confirmationName = String(
        req.body?.confirmationName || req.body?.confirmation_name || ""
      );
      const result = await merchantsService.deleteMerchantProfile(merchantId, confirmationName);
      res.json({ ok: true, ...result });
    } catch (error: any) {
      const message = error?.message || "Failed to delete merchant profile";
      const status = message.includes("not found") ? 404
        : message.includes("blocked") || message.includes("does not match") ? 409
        : 500;
      res.status(status).json({ ok: false, error: message });
    }
  }
}

export const merchantsController = new MerchantsController();
