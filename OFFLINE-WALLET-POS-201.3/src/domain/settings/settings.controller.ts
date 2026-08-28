import { Request, Response } from "express";
import { settingsService } from "./settings.service";

export class SettingsController {
  async get(req: Request, res: Response) {
    try {
      // Assuming single merchant for now or extracted from token in future
      const merchantId = "MRC-1001"; 
      const settings = await settingsService.getSettings(merchantId);
      
      // Convert SQLite 0/1 to boolean
      if (settings && typeof settings.test_mode === 'number') {
        settings.test_mode = settings.test_mode === 1;
      }
      
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const merchantId = "MRC-1001";
      const updated = await settingsService.updateSettings(merchantId, req.body);
      
      // Convert SQLite 0/1 to boolean
      if (updated && typeof updated.test_mode === 'number') {
        updated.test_mode = updated.test_mode === 1;
      }
      
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const settingsController = new SettingsController();
