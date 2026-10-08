import { db } from "../../config/db";
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_TERMINAL_SETTINGS = {
  offlineMode: true,
  autoUpdate: false,
  features: {
    manualEntry: true,
    refunds: false,
    tips: false
  }
};

export class SettingsService {
  async getSettings(merchantId: string) {
    try {
      const res = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        
        // Parse JSON fields
        const features = row.features ? JSON.parse(row.features) : { manualEntry: false, refunds: false, tips: false };
        features.manualEntry = true;
        const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
        const paymentConfig = row.payment_config ? JSON.parse(row.payment_config) : [];

        // Merge extended settings into the root object for the frontend
        return { 
          ...row, 
          features,
          business: extended.business || {},
          banking: extended.banking || {},
          notifications: extended.notifications || { email: false, sms: false, alerts: {} },
          security: extended.security || { twoFactorEnabled: false, activeDevices: [] },
          terminal: {
            ...DEFAULT_TERMINAL_SETTINGS,
            ...(extended.terminal || {}),
            offlineMode: extended.terminal?.offlineMode === false ? false : (extended.terminal?.offlineMode ?? true),
            features: {
              ...DEFAULT_TERMINAL_SETTINGS.features,
              ...(extended.terminal?.features || {}),
              manualEntry: true,
            }
          },
          paymentConfig
        };
      }
    } catch (e) {
      console.warn("DB Error in getSettings, returning defaults", e);
    }
    
    // Return default settings if DB fails or empty
    return {
        merchant_id: merchantId,
        api_key: "",
        webhook_url: "",
        test_mode: false,
        merchant_name: "",
        support_email: "",
        features: { manualEntry: true, refunds: false, tips: false },
        business: {},
        banking: {},
        notifications: {},
        security: {},
        terminal: { ...DEFAULT_TERMINAL_SETTINGS, features: { ...DEFAULT_TERMINAL_SETTINGS.features, manualEntry: true } },
        paymentConfig: []
    };
  }

  async updateSettings(merchantId: string, data: any) {
    try {
      const { 
        api_key, webhook_url, test_mode, merchant_name, support_email, features,
        business, banking, notifications, security, paymentConfig, terminal
      } = data;
      
      const rawFeatures = features || { manualEntry: false, refunds: false, tips: false };
      const forcedFeatures = { ...rawFeatures, manualEntry: true };
      const featuresJson = JSON.stringify(forcedFeatures);
      
      // Store complex objects in extended_settings
      const extendedSettings = {
        business: business || {},
        banking: banking || {},
        notifications: notifications || {},
        security: security || {},
        terminal: {
          ...DEFAULT_TERMINAL_SETTINGS,
          ...(terminal || {}),
          offlineMode: typeof terminal?.offlineMode === 'boolean' ? terminal.offlineMode : true,
          offlineModeConfigVersion: 1,
          features: {
            ...DEFAULT_TERMINAL_SETTINGS.features,
            ...(terminal?.features || {}),
            manualEntry: true,
          }
        }
      };
      const extendedJson = JSON.stringify(extendedSettings);
      const paymentConfigJson = JSON.stringify(paymentConfig || []);

      // Check if exists
      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);
      
      if (check.rows.length === 0) {
        await db.query(`
          INSERT INTO merchant_settings 
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, features, extended_settings, payment_config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [merchantId, api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, featuresJson, extendedJson, paymentConfigJson]);
        
        return { merchant_id: merchantId, ...data };
      }

      await db.query(`
        UPDATE merchant_settings 
        SET api_key = ?, webhook_url = ?, test_mode = ?, merchant_name = ?, support_email = ?,
            features = ?, extended_settings = ?, payment_config = ?, updated_at = CURRENT_TIMESTAMP
        WHERE merchant_id = ?
      `, [api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, featuresJson, extendedJson, paymentConfigJson, merchantId]);

      const res = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);
      if (!res.rows || res.rows.length === 0) {
        return { merchant_id: merchantId, ...data, features: forcedFeatures, business: business || {}, banking: banking || {}, notifications: notifications || {}, security: security || {}, terminal: extendedSettings.terminal, paymentConfig: paymentConfig || [] };
      }
      const row = res.rows[0];
      const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
      const parsedFeatures = JSON.parse(row.features || '{}');
      parsedFeatures.manualEntry = true;
      
      return { 
        ...row, 
        features: parsedFeatures,
        business: extended.business || {},
        banking: extended.banking || {},
        notifications: extended.notifications || {},
        security: extended.security || {},
        terminal: {
          ...DEFAULT_TERMINAL_SETTINGS,
          ...(extended.terminal || {}),
          offlineMode: extended.terminal?.offlineMode === false ? false : (extended.terminal?.offlineMode ?? true),
          features: {
            ...DEFAULT_TERMINAL_SETTINGS.features,
            ...(extended.terminal?.features || {}),
            manualEntry: true,
          }
        },
        paymentConfig: row.payment_config ? JSON.parse(row.payment_config) : []
      };
    } catch (e) {
      console.error("DB Error in updateSettings", e);
      throw e;
    }
  }

  async regenerateApiKey(merchantId: string) {
    const newApiKey = `mk_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    await db.query(`UPDATE merchant_settings SET api_key = ? WHERE merchant_id = ?`, [newApiKey, merchantId]);
    return { api_key: newApiKey };
  }
}

export const settingsService = new SettingsService();
