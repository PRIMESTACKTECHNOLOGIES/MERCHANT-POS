import { Request, Response } from "express";
import { settingsService } from "./settings.service";

function extractMerchantId(req: Request): string {
  const defaultId = "MRC-1001";
  try {
    const user: any = (req as any).user || (req as any).merchant || {};
    const candidate =
      user.merchant_id ||
      user.merchantId ||
      user.id ||
      (req.headers['x-merchant-id'] as string) ||
      (req.body?.merchant_id as string) ||
      (req.query?.merchant_id as string) ||
      defaultId;
    return candidate ? String(candidate).trim() || defaultId : defaultId;
  } catch {
    return defaultId;
  }
}

export class SettingsController {
  async get(req: Request, res: Response) {
    try {
      const merchantId = extractMerchantId(req);
      const settings = await settingsService.getSettings(merchantId);
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const merchantId = extractMerchantId(req);
      const body = (req.body || {}) as Record<string, any>;
      if (!body.terminal) body.terminal = {};
      // Preserve the caller's offlineMode — only default to true if completely missing
      if (typeof body.terminal.offlineMode !== 'boolean') {
        body.terminal.offlineMode = true;
      }
      body.terminal.offlineModeConfigVersion = 1;
      if (!body.terminal.features) body.terminal.features = {};
      body.terminal.features = {
        manualEntry: true,
        refunds: !!(body.terminal?.features?.refunds) || false,
        tips: !!(body.terminal?.features?.tips) || false,
      };
      if (typeof body.features !== 'undefined' && body.features) {
        body.features = { ...(body.features || {}), manualEntry: true };
        body.terminal.features = {
          manualEntry: true,
          refunds: !!body.features.refunds || !!body.terminal.features.refunds || false,
          tips: !!body.features.tips || !!body.terminal.features.tips || false,
        };
      } else {
        body.features = { manualEntry: true, refunds: false, tips: false };
      }
      const updated = await settingsService.updateSettings(merchantId, body);
      res.json(updated);
    } catch (e: any) {
      console.error("[settings/update] DB error:", e);
      res.status(500).json({ error: e.message || String(e) });
    }
  }

  async regenerateApiKey(req: Request, res: Response) {
    try {
      const merchantId = extractMerchantId(req);
      const result = await settingsService.regenerateApiKey(merchantId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const settingsController = new SettingsController();
