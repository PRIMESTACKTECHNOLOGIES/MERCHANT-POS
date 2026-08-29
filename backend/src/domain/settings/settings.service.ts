import { db } from "../../config/db";
import dotenv from "dotenv";
import crypto from "crypto";
const uuid4 = () => crypto.randomUUID();
dotenv.config();

export class SettingsService {
  async getSettings(merchantId: string) {
    let defaultBank: any = null;
    let bizInfo: any = null;
    try {
      const bRes = await db.query(`
        SELECT * FROM bank_accounts
         WHERE merchant_id = $1 AND (is_default = 1 OR verified = 1)
         ORDER BY is_default DESC, verified DESC, created_at DESC
         LIMIT 1
      `, [merchantId]);
      if (bRes.rows && bRes.rows.length) defaultBank = bRes.rows[0];
    } catch (_e) { defaultBank = null; }
    try {
      const biRes = await db.query(`SELECT * FROM merchant_business_info WHERE merchant_id = $1 LIMIT 1`, [merchantId]);
      if (biRes.rows && biRes.rows.length) bizInfo = biRes.rows[0];
    } catch (_e) { bizInfo = null; }

    try {
      const res = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = $1", [merchantId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        
        // Parse JSON fields
        const features = row.features ? JSON.parse(row.features) : { manualEntry: false, refunds: false, tips: false };
        const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
        const paymentConfig = row.payment_config ? JSON.parse(row.payment_config) : [];

        const mergedBusiness = {
          businessName: (extended.business && (extended.business.businessName || extended.business.business_name)) || bizInfo?.business_name || row.merchant_name || "",
          business_name: (extended.business && (extended.business.business_name || extended.business.businessName)) || bizInfo?.business_name || row.merchant_name || "",
          businessAddress: (extended.business && (extended.business.businessAddress || extended.business.business_address)) || bizInfo?.business_address || "",
          business_address: (extended.business && (extended.business.business_address || extended.business.businessAddress)) || bizInfo?.business_address || "",
          businessPhone: (extended.business && (extended.business.businessPhone || extended.business.business_phone)) || bizInfo?.business_phone || row.support_phone || "",
          business_phone: (extended.business && (extended.business.business_phone || extended.business.businessPhone)) || bizInfo?.business_phone || row.support_phone || "",
          businessEmail: (extended.business && (extended.business.businessEmail || extended.business.business_email)) || bizInfo?.business_email || row.support_email || "",
          business_email: (extended.business && (extended.business.business_email || extended.business.businessEmail)) || bizInfo?.business_email || row.support_email || "",
          businessCountry: (extended.business && (extended.business.businessCountry || extended.business.business_country)) || bizInfo?.business_country || "",
          business_country: (extended.business && (extended.business.business_country || extended.business.businessCountry)) || bizInfo?.business_country || "",
          businessCity: (extended.business && (extended.business.businessCity || extended.business.business_city)) || bizInfo?.business_city || "",
          business_city: (extended.business && (extended.business.business_city || extended.business.businessCity)) || bizInfo?.business_city || "",
          language: (extended.business && extended.business.language) || bizInfo?.language || "EN",
          businessRegNo: (extended.business && (extended.business.businessRegNo || extended.business.business_reg_no)) || bizInfo?.business_reg_no || "",
          business_reg_no: (extended.business && (extended.business.business_reg_no || extended.business.businessRegNo)) || bizInfo?.business_reg_no || "",
          taxId: (extended.business && (extended.business.taxId || extended.business.tax_id)) || bizInfo?.tax_id || "",
          tax_id: (extended.business && (extended.business.tax_id || extended.business.taxId)) || bizInfo?.tax_id || "",
          ...(extended.business || {})
        };

        const extBanking = extended.banking || {};
        const mergedBanking = {
          cif_id: extBanking.cif_id || (defaultBank && defaultBank.metadata_json ? JSON.parse(defaultBank.metadata_json).cif_id : null) || "",
          routingNumber: extBanking.routingNumber || extBanking.routing_number || defaultBank?.routing_number || "",
          routing_number: extBanking.routing_number || extBanking.routingNumber || defaultBank?.routing_number || "",
          accountNumber: extBanking.accountNumber || extBanking.account_number || defaultBank?.account_number || "",
          account_number: extBanking.account_number || extBanking.accountNumber || defaultBank?.account_number || "",
          iban: extBanking.iban || defaultBank?.iban || "",
          bic_swift: extBanking.bic_swift || extBanking.swift_code || defaultBank?.swift_code || defaultBank?.bic_swift || "",
          swift_code: extBanking.swift_code || extBanking.bic_swift || defaultBank?.swift_code || defaultBank?.bic_swift || "",
          accountType: extBanking.accountType || extBanking.account_type || defaultBank?.account_type || "",
          account_type: extBanking.account_type || extBanking.accountType || defaultBank?.account_type || "",
          accountHolder: extBanking.accountHolder || extBanking.account_holder || defaultBank?.account_holder || "",
          account_holder: extBanking.account_holder || extBanking.accountHolder || defaultBank?.account_holder || "",
          bankName: extBanking.bankName || extBanking.bank_name || defaultBank?.bank_name || "",
          bank_name: extBanking.bank_name || extBanking.bankName || defaultBank?.bank_name || "",
          bankBranchName: extBanking.bankBranchName || extBanking.bank_branch_name || defaultBank?.bank_branch || "",
          bank_branch_name: extBanking.bank_branch_name || extBanking.bankBranchName || defaultBank?.bank_branch || "",
          bankCountry: extBanking.bankCountry || extBanking.bank_country || defaultBank?.country || "",
          bank_country: extBanking.bank_country || extBanking.bankCountry || defaultBank?.country || "",
          currency: extBanking.currency || defaultBank?.currency || "",
          accountStatus: extBanking.accountStatus || extBanking.account_status || (defaultBank && defaultBank.verified ? "ACTIVE" : "") || "",
          account_status: extBanking.account_status || extBanking.accountStatus || (defaultBank && defaultBank.verified ? "ACTIVE" : "") || "",
          isDefault: extBanking.isDefault || extBanking.is_default || (defaultBank && defaultBank.is_default === 1) || false,
          is_default: extBanking.is_default || extBanking.isDefault || (defaultBank && defaultBank.is_default === 1) || false,
          ...extBanking
        };

        const rowSupportPhone = typeof row.support_phone !== "undefined" ? row.support_phone : null;

        // Merge extended settings into the root object for the frontend
        return { 
          ...row, 
          features,
          business: mergedBusiness,
          banking: mergedBanking,
          default_bank_id: defaultBank?.id || null,
          support_phone: rowSupportPhone || mergedBusiness.business_phone || "",
          display_name: extended.display_name || row.merchant_name || mergedBusiness.business_name || "",
          display_currency: extended.display_currency || row.display_currency || "USD",
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
    const defBank = defaultBank || {};
    const defBiz = bizInfo || {};
    return {
        merchant_id: merchantId,
        api_key: "",
        webhook_url: "",
        test_mode: false,
        merchant_name: defBiz.business_name || "",
        display_name: defBiz.business_name || "",
        display_currency: defBank.currency || "USD",
        support_email: defBiz.business_email || "",
        support_phone: defBiz.business_phone || "",
        paypal_client_id: "",
        paypal_client_secret: "",
        features: { manualEntry: false, refunds: false, tips: false },
        business: defBiz,
        banking: defBank,
        default_bank_id: defBank.id || null,
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
        api_key, webhook_url, test_mode, merchant_name, support_email, 
        paypal_client_id, paypal_client_secret, features,
        business, banking, notifications, security, paymentConfig,
        support_phone, display_name, display_currency, terminal
      } = data;
      
      // ---------- Ensure extra merchant_settings columns exist ----------
      try { await db.query("ALTER TABLE merchant_settings ADD COLUMN support_phone TEXT"); } catch (_) {}
      try { await db.query("ALTER TABLE merchant_settings ADD COLUMN display_name TEXT"); } catch (_) {}
      try { await db.query("ALTER TABLE merchant_settings ADD COLUMN display_currency TEXT DEFAULT 'USD'"); } catch (_) {}
      try { await db.query("ALTER TABLE merchant_settings ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}

      const now = new Date().toISOString();
      const biz = business || {};

      // ---------- MERCHANT_BUSINESS_INFO UPSERT ----------
      try {
        const bizName =
          biz.businessName || biz.business_name || display_name || merchant_name || "";
        const bizAddr =
          biz.businessAddress || biz.business_address || "";
        const bizPhone =
          biz.businessPhone || biz.business_phone || support_phone || "";
        const bizEmail =
          biz.businessEmail || biz.business_email || support_email || "";
        const bizRegNo =
          biz.businessRegNo || biz.business_reg_no || "";
        const bizTaxId =
          biz.taxId || biz.tax_id || "";
        const bizCountry =
          biz.businessCountry || biz.business_country || "";
        const bizCity =
          biz.businessCity || biz.business_city || "";
        const bizLang = biz.language || "EN";

        const bizCheck = await db.query(
          "SELECT merchant_id FROM merchant_business_info WHERE merchant_id = $1",
          [merchantId]
        );
        if (bizCheck.rows && bizCheck.rows.length) {
          await db.query(`
            UPDATE merchant_business_info
               SET business_name = $2,
                   business_address = $3,
                   business_phone = $4,
                   business_email = $5,
                   business_reg_no = $6,
                   tax_id = $7,
                   business_country = $8,
                   business_city = $9,
                   language = $10,
                   updated_at = $11
             WHERE merchant_id = $1
          `, [
            merchantId, bizName, bizAddr, bizPhone, bizEmail,
            bizRegNo, bizTaxId, bizCountry, bizCity, bizLang, now
          ]);
        } else if (bizName || bizAddr || bizPhone || bizEmail) {
          try {
            await db.query(`
              INSERT INTO merchant_business_info
              (merchant_id, business_name, business_address, business_phone, business_email,
               business_reg_no, tax_id, business_country, business_city, language, updated_at, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            `, [
              merchantId, bizName, bizAddr, bizPhone, bizEmail,
              bizRegNo, bizTaxId, bizCountry, bizCity, bizLang, now, now
            ]);
          } catch (_e) { /* business info insert best effort */ }
        }
      } catch (_eBiz) {
        console.warn("settings.service updateSettings: merchant_business_info upsert skipped", (_eBiz as any)?.message || _eBiz);
      }

      // ---------- BANK_ACCOUNTS (default receiver) UPSERT ----------
      try {
        const b = banking || {};
        const accNum =
          b.accountNumber || b.account_number || "";
        const routingNum =
          b.routingNumber || b.routing_number || "";
        const iban = b.iban || "";
        const swiftBic =
          b.bic_swift || b.swift_code || "";
        const accType =
          b.accountType || b.account_type || "";
        const accHolder =
          b.accountHolder || b.account_holder || biz?.businessName || merchant_name || "";
        const bankName =
          b.bankName || b.bank_name || "";
        const bankBranch =
          b.bankBranchName || b.bank_branch_name || "";
        const bankCountry =
          b.bankCountry || b.bank_country || biz?.businessCountry || biz?.business_country || "";
        const accCurrency = b.currency || display_currency || "";
        const cifId = b.cif_id || "";
        const accStatus = b.accountStatus || b.account_status || "";
        const isDefault =
          b.is_default === true ||
          b.isDefault === true ||
          b.is_default === 1 ||
          b.isDefault === 1;

        if (accNum || iban || swiftBic) {
          const metaObj: any = {
            cif_id: cifId || null,
            account_status: accStatus || null,
            display_name: display_name || merchant_name || null,
            source: "merchant_settings_save_banking_tab",
            updated_at: now,
          };
          const metaJson = JSON.stringify(metaObj);

          // Ensure bank_accounts extra columns exist
          try { await db.query("ALTER TABLE bank_accounts ADD COLUMN updated_at TEXT"); } catch (_) {}
          try { await db.query("ALTER TABLE bank_accounts ADD COLUMN last_verified_at TEXT"); } catch (_) {}
          try { await db.query("ALTER TABLE bank_accounts ADD COLUMN verification_status TEXT"); } catch (_) {}
          try { await db.query("ALTER TABLE bank_accounts ADD COLUMN account_reference TEXT"); } catch (_) {}
          try { await db.query("ALTER TABLE bank_accounts ADD COLUMN metadata_json TEXT"); } catch (_) {}

          const bDef = await db.query(
            "SELECT id FROM bank_accounts WHERE merchant_id = $1 AND is_default = 1 LIMIT 1",
            [merchantId]
          );
          let bankId = null;
          if (bDef.rows && bDef.rows.length && bDef.rows[0].id) {
            bankId = bDef.rows[0].id;
          } else {
            const bAny = await db.query(
              "SELECT id FROM bank_accounts WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1",
              [merchantId]
            );
            bankId = (bAny.rows && bAny.rows.length && bAny.rows[0].id) || uuid4();
          }

          const existingCheck = await db.query("SELECT id FROM bank_accounts WHERE id = $1", [bankId]);
          const exists = !!(existingCheck.rows && existingCheck.rows.length);

          if (exists) {
            await db.query(`
              UPDATE bank_accounts
                 SET account_holder = $2, account_number = $3, routing_number = $4,
                     bank_name = $5, bank_branch = $6, swift_code = $7, iban = $8,
                     currency = $9, country = $10, account_type = $11,
                     is_default = $12, verified = $13,
                     verification_status = COALESCE($14, verification_status),
                     account_reference = COALESCE($15, account_reference),
                     metadata_json = COALESCE($16, metadata_json),
                     updated_at = $17,
                     last_verified_at = COALESCE($18, last_verified_at)
               WHERE id = $1
            `, [
              bankId,
              accHolder, accNum, routingNum,
              bankName, bankBranch, swiftBic, iban,
              accCurrency, bankCountry, accType,
              isDefault ? 1 : 0,
              accStatus === "ACTIVE" || accStatus === "VERIFIED" ? 1 : 0,
              accStatus || null,
              cifId || null,
              metaJson,
              now,
              now
            ]);
          } else {
            await db.query(`
              INSERT INTO bank_accounts
              (id, merchant_id, account_holder, account_number, routing_number,
               bank_name, bank_branch, swift_code, iban, currency, country,
               account_type, is_default, verified, verification_status,
               account_reference, created_at, updated_at, last_verified_at, metadata_json)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            `, [
              bankId, merchantId,
              accHolder, accNum, routingNum,
              bankName, bankBranch, swiftBic, iban,
              accCurrency, bankCountry, accType,
              isDefault ? 1 : 0,
              accStatus === "ACTIVE" || accStatus === "VERIFIED" ? 1 : 0,
              accStatus || "PENDING",
              cifId || null,
              now, now, now, metaJson
            ]);
          }

          // Only ONE default per merchant
          try {
            await db.query(
              "UPDATE bank_accounts SET is_default = 0 WHERE merchant_id = $1 AND id <> $2",
              [merchantId, bankId]
            );
          } catch (_) {}
        }
      } catch (_eBank) {
        console.warn("settings.service updateSettings: bank_accounts upsert skipped", (_eBank as any)?.message || _eBank);
      }

      const featuresJson = JSON.stringify(features || { manualEntry: false, refunds: false, tips: false });
      
      // Store complex objects in extended_settings
      const extendedSettings = {
        business: business || {},
        banking: banking || {},
        notifications: notifications || {},
        security: security || {},
        terminal: terminal || data.terminal || {
          offlineMode: true,
          autoUpdate: true,
          features: { manualEntry: false, refunds: true, tips: true }
        },
        display_name: display_name || merchant_name || "",
        display_currency: display_currency || "USD"
      };
      const extendedJson = JSON.stringify(extendedSettings);
      
      const paymentConfigJson = JSON.stringify(paymentConfig || []);

      // Check if exists
      const check = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = $1", [merchantId]);
      
      if (check.rows.length === 0) {
        // Insert if missing
        await db.query(`
          INSERT INTO merchant_settings 
          (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email,
           support_phone, display_name, display_currency,
           paypal_client_id, paypal_client_secret, features, extended_settings,
           payment_config, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `, [
          merchantId, api_key || "", webhook_url || "", test_mode ? 1 : 0,
          merchant_name || "", support_email || "",
          support_phone || "", display_name || merchant_name || "",
          display_currency || "USD",
          paypal_client_id || "", paypal_client_secret || "",
          featuresJson, extendedJson, paymentConfigJson, now, now
        ]);
        
        return { merchant_id: merchantId, ...data };
      }

      const res = await db.query(`
        UPDATE merchant_settings 
        SET api_key = $2,
            webhook_url = $3,
            test_mode = $4,
            merchant_name = $5,
            support_email = $6,
            support_phone = $7,
            display_name = $8,
            display_currency = $9,
            paypal_client_id = $10,
            paypal_client_secret = $11,
            features = $12,
            extended_settings = $13,
            payment_config = $14,
            updated_at = CURRENT_TIMESTAMP
        WHERE merchant_id = $1
        RETURNING *
      `, [
        merchantId,
        api_key || "", webhook_url || "", test_mode ? 1 : 0,
        merchant_name || "", support_email || "",
        support_phone || "", display_name || merchant_name || "",
        display_currency || "USD",
        paypal_client_id || "", paypal_client_secret || "",
        featuresJson, extendedJson, paymentConfigJson
      ]);
      
      const row = res.rows[0];
      const extended = row.extended_settings ? JSON.parse(row.extended_settings) : {};
      
      return { 
        ...row, 
        features: row.features ? JSON.parse(row.features) : {},
        business: extended.business || business || {},
        banking: extended.banking || banking || {},
        notifications: extended.notifications || {},
        security: extended.security || {},
        terminal: extended.terminal || terminal || data.terminal || {
          offlineMode: true,
          autoUpdate: true,
          features: { manualEntry: false, refunds: true, tips: true }
        },
        paymentConfig: row.payment_config ? JSON.parse(row.payment_config) : [],
        support_phone: row.support_phone || support_phone || data.support_phone || "",
        display_name: extended.display_name || row.display_name || display_name || data.display_name || "",
        display_currency: extended.display_currency || row.display_currency || display_currency || data.display_currency || "USD"
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
