import { Request, Response } from "express";
import { customerAuthService } from "./customer-auth.service";

export class CustomerAuthController {
  async login(req: Request, res: Response) {
    try {
      const { walletCode, wallet_code, pin } = req.body || {};
      const code = walletCode || wallet_code;
      if (!code || !pin) {
        return res.status(400).json({ error: "Wallet code and PIN are required" });
      }
      const result = await customerAuthService.login(String(code), String(pin));
      res.json(result);
    } catch (e: any) {
      res.status(401).json({ error: e.message || "Login failed" });
    }
  }

  async me(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      res.json(await customerAuthService.getProfile(customerId));
    } catch (e: any) {
      res.status(e.message.includes("not found") ? 404 : 500).json({ error: e.message });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      res.json(await customerAuthService.updateProfile(customerId, req.body || {}));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async changePin(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      const { currentPin, newPin } = req.body || {};
      if (!newPin) return res.status(400).json({ error: "newPin is required" });
      res.json(await customerAuthService.changePin(customerId, currentPin, String(newPin)));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }
}

export const customerAuthController = new CustomerAuthController();
