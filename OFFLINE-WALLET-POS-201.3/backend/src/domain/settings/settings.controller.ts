import { Request, Response } from "express";
import { settingsService } from "./settings.service";

export class SettingsController {
  async get(req: Request, res: Response) {
    try {
      // Assuming single merchant for now or extracted from token in future
      const merchantId = "MRC-1001"; 
      const settings = await settingsService.getSettings(merchantId);
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const merchantId = "MRC-1001";
      const updated = await settingsService.updateSettings(merchantId, req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async regenerateApiKey(req: Request, res: Response) {
    try {
      const merchantId = "MRC-1001"; // In real app, get from user session
      const result = await settingsService.regenerateApiKey(merchantId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const settingsController = new SettingsController();
