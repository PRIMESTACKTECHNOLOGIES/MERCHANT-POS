import { db } from "../../config/db";

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
          paymentConfig
        };
      }
    } catch (e) {
      console.warn("DB Error in getSettings, returning mock", e);
    }
    
    // Return default/mock if DB fails or empty
    return {
        merchant_id: merchantId,
        api_key: "sk_test_mock_key_12345",
        webhook_url: "https://example.com/webhook",
        test_mode: true,
        merchant_name: "Demo Merchant",
        support_email: "support@demo.com",
        paypal_client_id: "AZ78gCo54gfr-itujBtnWMJyFYAYsrONPvIDRJq252pL_kcm3PWt-uS2rRwNTJFhZRRIDc0QRPS0QBWk",
        paypal_client_secret: "EAnAkvmZ4OeAqgr4fTN7gqrc0wiDpovMP7Uni4bOu5Zoh8sDgLhbYZ9Lv4DxJAEr0aFtDJIY0Xj_n9ny",
        features: { manualEntry: false, refunds: false, tips: false },
        business: {},
        banking: {},
        notifications: {},
        security: {},
        paymentConfig: []
    };
  }

  async updateSettings(merchantId: string, data: any) {
    try {
      const { 
        api_key, webhook_url, test_mode, merchant_name, support_email, 
        paypal_client_id, paypal_client_secret, features,
        business, banking, notifications, security, paymentConfig
      } = data;
      
      const featuresJson = JSON.stringify(features || { manualEntry: false, refunds: false, tips: false });
      
      // Store complex objects in extended_settings
      const extendedSettings = {
        business: business || {},
        banking: banking || {},
        notifications: notifications || {},
        security: security || {}
      };
      const extendedJson = JSON.stringify(extendedSettings);
      
      const paymentConfigJson = JSON.stringify(paymentConfig || []);

      // Check if exists
      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = $1", [merchantId]);
      
      if (check.rows.length === 0) {
        // Insert if missing
        await db.query(`
          INSERT INTO merchant_settings 
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, paypal_client_id, paypal_client_secret, features, extended_settings, payment_config)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [merchantId, api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, paypal_client_id, paypal_client_secret, featuresJson, extendedJson, paymentConfigJson]);
        
        return { merchant_id: merchantId, ...data };
      }

      const res = await db.query(`
        UPDATE merchant_settings 
        SET api_key = $2, webhook_url = $3, test_mode = $4, merchant_name = $5, support_email = $6, paypal_client_id = $7, paypal_client_secret = $8, features = $9, extended_settings = $10, payment_config = $11, updated_at = CURRENT_TIMESTAMP
        WHERE merchant_id = $1
        RETURNING *
      `, [merchantId, api_key, webhook_url, test_mode ? 1 : 0, merchant_name, support_email, paypal_client_id, paypal_client_secret, featuresJson, extendedJson, paymentConfigJson]);
      
      const row = res.rows[0];
      const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
      
      return { 
        ...row, 
        features: JSON.parse(row.features),
        business: extended.business,
        banking: extended.banking,
        notifications: extended.notifications,
        security: extended.security,
        paymentConfig: row.payment_config ? JSON.parse(row.payment_config) : []
      };
    } catch (e) {
      console.warn("DB Error in updateSettings, returning input data", e);
      return { merchant_id: merchantId, ...data };
    }
  }

  async regenerateApiKey(merchantId: string) {
    const newApiKey = `sk_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    await db.query(`UPDATE merchant_settings SET api_key = $1 WHERE merchant_id = $2`, [newApiKey, merchantId]);
    return { api_key: newApiKey };
  }
}

export const settingsService = new SettingsService();
