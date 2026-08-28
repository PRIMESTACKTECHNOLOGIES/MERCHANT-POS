import { db } from "../../config/db";

export class SettingsService {
  async getSettings(merchantId: string) {
    try {
      const res = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (e) {
      console.warn("DB Error in getSettings, returning defaults", e);
    }
    
    // Default values if not found in DB
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
        myfatoorah_test_mode: 1
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
        myfatoorah_test_mode
      } = data;
      
      // Check if exists first
      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", [merchantId]);
      
      if (check.rowCount === 0) {
        // Insert
        await db.query(`
          INSERT INTO merchant_settings 
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, merchant_address, merchant_phone, license_number, tax_id, paypal_client_id, paypal_client_secret, myfatoorah_api_token, myfatoorah_test_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          myfatoorah_test_mode !== undefined ? (myfatoorah_test_mode ? 1 : 0) : 1
        ]);
      } else {
        // Update
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
