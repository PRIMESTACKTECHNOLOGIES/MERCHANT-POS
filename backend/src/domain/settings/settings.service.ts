import { db } from "../../config/db";
import dotenv from "dotenv";
dotenv.config();

export class SettingsService {
  async getSettings(merchantId: string) {
    try {
      const res = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = $1", [merchantId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        
        // Parse JSON fields
        const features = row.features ? JSON.parse(row.features) : { manualEntry: false, refunds: false, tips: false };
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
          terminal: extended.terminal || {
            offlineMode: true,
            autoUpdate: true,
            features: { manualEntry: false, refunds: true, tips: true }
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
        features: { manualEntry: false, refunds: false, tips: false },
        business: {},
        banking: {},
        notifications: {},
        security: {},
        terminal: {
          offlineMode: true,
          autoUpdate: true,
          features: { manualEntry: false, refunds: false, tips: false }
        },
        paymentConfig: []
    };
  }

  async updateSettings(merchantId: string, data: any) {
    try {
      const { 
        api_key, webhook_url, test_mode, merchant_name, support_email, features,
        business, banking, notifications, security, paymentConfig
      } = data;
      
      const featuresJson = JSON.stringify(features || { manualEntry: false, refunds: false, tips: false });
      
      // Store complex objects in extended_settings
      const extendedSettings = {
        business: business || {},
        banking: banking || {},
        notifications: notifications || {},
        security: security || {},
        terminal: data.terminal || {
          offlineMode: true,
          autoUpdate: true,
          features: { manualEntry: false, refunds: true, tips: true }
        }
      };
      const extendedJson = JSON.stringify(extendedSettings);
      
      const paymentConfigJson = JSON.stringify(paymentConfig || []);

      // Check if exists
      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = $1", [merchantId]);
      
      if (check.rows.length === 0) {
        // Insert if missing
        await db.query(`
          INSERT INTO merchant_settings 
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, features, extended_settings, payment_config)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [merchantId, api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, featuresJson, extendedJson, paymentConfigJson]);
        
        return { merchant_id: merchantId, ...data };
      }

      const res = await db.query(`
        UPDATE merchant_settings 
        SET api_key = $2, webhook_url = $3, test_mode = $4, merchant_name = $5, support_email = $6, features = $7, extended_settings = $8, payment_config = $9, updated_at = CURRENT_TIMESTAMP
        WHERE merchant_id = $1
        RETURNING *
      `, [merchantId, api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, featuresJson, extendedJson, paymentConfigJson]);
      
      const row = res.rows[0];
      const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
      
      return { 
        ...row, 
        features: JSON.parse(row.features),
        business: extended.business,
        banking: extended.banking,
        notifications: extended.notifications,
        security: extended.security,
        terminal: extended.terminal || {
          offlineMode: true,
          autoUpdate: true,
          features: { manualEntry: false, refunds: true, tips: true }
        },
        paymentConfig: row.payment_config ? JSON.parse(row.payment_config) : []
      };
    } catch (e) {
      console.warn("DB Error in updateSettings, returning input data", e);
      return { merchant_id: merchantId, ...data };
    }
  }

  async regenerateApiKey(merchantId: string) {
    const newApiKey = `mk_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    await db.query(`UPDATE merchant_settings SET api_key = $1 WHERE merchant_id = $2`, [newApiKey, merchantId]);
    return { api_key: newApiKey };
  }
}

export const settingsService = new SettingsService();
