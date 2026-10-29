import { Request, Response } from "express";
import { preAuthService } from "./preauth.service";

export class PreAuthController {
  status(req: Request, res: Response) {
    return res.json(preAuthService.getProtocolStatus());
  }

  async authorize(req: Request, res: Response) {
    try {
      const result = await preAuthService.authorize(req.body || {});
      return res.status(result.success ? 200 : 402).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Pre-authorization failed" });
    }
  }

  async capture(req: Request, res: Response) {
    try {
      const result = await preAuthService.capture(req.params.id, req.body?.amountMinor);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Capture failed" });
    }
  }

  async void(req: Request, res: Response) {
    try {
      const result = await preAuthService.void(req.params.id);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Void failed" });
    }
  }
}

export const preAuthController = new PreAuthController();
