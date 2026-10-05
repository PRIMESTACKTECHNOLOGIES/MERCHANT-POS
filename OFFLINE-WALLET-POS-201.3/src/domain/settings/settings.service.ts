import { db } from "../../config/db";

const DEFAULT_TERMINAL_SETTINGS = {
  offlineMode: true,
  autoUpdate: false,
  features: {
    manualEntry: false,
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
        const features = row.features ? JSON.parse(row.features) : { manualEntry: false, refunds: false, tips: false };
        const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
        const paymentConfig = row.payment_config ? JSON.parse(row.payment_config) : [];
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
            offlineMode: extended.terminal?.offlineModeConfigVersion === 1
              ? extended.terminal.offlineMode === true
              : true,
            features: {
              ...DEFAULT_TERMINAL_SETTINGS.features,
              ...(extended.terminal?.features || {})
            }
          },
          paymentConfig
        };
      }
    } catch (e) {
      console.warn("DB Error in getSettings, returning defaults", e);
    }

    return {
        merchant_id: merchantId,
        api_key: "",
        webhook_url: "",
        test_mode: 1,
        merchant_name: "",
        support_email: "",
        merchant_address: "",
        merchant_phone: "",
        license_number: "",
        tax_id: "",
        paypal_client_id: "",
        paypal_client_secret: "",
        myfatoorah_api_token: "",
        myfatoorah_test_mode: 1,
        features: { manualEntry: false, refunds: false, tips: false },
        business: {},
        banking: {},
        notifications: {},
        security: {},
        terminal: DEFAULT_TERMINAL_SETTINGS,
        paymentConfig: []
    };
  }

  async updateSettings(merchantId: string, data: any) {
    try {
      const {
        api_key,
        webhook_url,
        test_mode,
        merchant_name,
        support_email,
        merchant_address,
        merchant_phone,
        license_number,
        tax_id,
        paypal_client_id,
        paypal_client_secret,
        myfatoorah_api_token,
        myfatoorah_test_mode,
        features,
        business, banking, notifications, security, paymentConfig, terminal
      } = data;

      const featuresJson = JSON.stringify(features || { manualEntry: false, refunds: false, tips: false });

      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);

      const existingExtended = check.rows.length > 0 && check.rows[0].extended_settings
        ? JSON.parse(check.rows[0].extended_settings)
        : {};
      const terminalSettings = terminal || existingExtended.terminal || DEFAULT_TERMINAL_SETTINGS;
      const extendedSettings = {
        business: business || {},
        banking: banking || {},
        notifications: notifications || {},
        security: security || {},
        terminal: {
          ...DEFAULT_TERMINAL_SETTINGS,
          ...terminalSettings,
          autoUpdate: false,
          offlineModeConfigVersion: 1,
          features: {
            ...DEFAULT_TERMINAL_SETTINGS.features,
            ...(terminalSettings.features || {})
          }
        }
      };
      const extendedJson = JSON.stringify(extendedSettings);

      const paymentConfigJson = JSON.stringify(paymentConfig || []);

      if (!check.rows || check.rows.length === 0) {
        await db.query(`
          INSERT INTO merchant_settings
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, merchant_address, merchant_phone, license_number, tax_id, paypal_client_id, paypal_client_secret, myfatoorah_api_token, myfatoorah_test_mode, features, extended_settings, payment_config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          merchantId,
          api_key || null,
          webhook_url || null,
          test_mode ? 1 : 0,
          merchant_name || null,
          support_email || null,
          merchant_address || null,
          merchant_phone || null,
          license_number || null,
          tax_id || null,
          paypal_client_id || null,
          paypal_client_secret || null,
          myfatoorah_api_token || null,
          myfatoorah_test_mode !== undefined ? (myfatoorah_test_mode ? 1 : 0) : 1,
          featuresJson,
          extendedJson,
          paymentConfigJson
        ]);
      } else {
        await db.query(`
          UPDATE merchant_settings
          SET api_key = ?,
              webhook_url = ?,
              test_mode = ?,
              merchant_name = ?,
              support_email = ?,
              merchant_address = ?,
              merchant_phone = ?,
              license_number = ?,
              tax_id = ?,
              paypal_client_id = ?,
              paypal_client_secret = ?,
              myfatoorah_api_token = ?,
              myfatoorah_test_mode = ?,
              features = ?,
              extended_settings = ?,
              payment_config = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE merchant_id = ?
        `, [
          api_key || null,
          webhook_url || null,
          test_mode ? 1 : 0,
          merchant_name || null,
          support_email || null,
          merchant_address || null,
          merchant_phone || null,
          license_number || null,
          tax_id || null,
          paypal_client_id || null,
          paypal_client_secret || null,
          myfatoorah_api_token || null,
          myfatoorah_test_mode !== undefined ? (myfatoorah_test_mode ? 1 : 0) : 1,
          featuresJson,
          extendedJson,
          paymentConfigJson,
          merchantId
        ]);
      }

      return await this.getSettings(merchantId);
    } catch (e) {
      console.error("DB Error in updateSettings", e);
      throw e;
    }
  }
}

export const settingsService = new SettingsService();
