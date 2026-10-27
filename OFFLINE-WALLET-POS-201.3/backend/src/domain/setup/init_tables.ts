import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from 'uuid';

export const initTables = async () => {
  try {
    // Admin Users Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        display_name TEXT,
        phone TEXT,
        country TEXT,
        timezone TEXT,
        company_name TEXT,
        email TEXT,
        avatar_url TEXT,
        two_factor_enabled INTEGER DEFAULT 0, -- Boolean as 0/1
        two_factor_secret TEXT,
        theme_preference TEXT DEFAULT 'light',
        language_preference TEXT DEFAULT 'en',
        api_key TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Merchant Settings Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_settings (
        merchant_id TEXT PRIMARY KEY,
        api_key TEXT,
        webhook_url TEXT,
        test_mode INTEGER DEFAULT 0, -- Boolean
        merchant_name TEXT,
        support_email TEXT,
        paypal_client_id TEXT,
        paypal_client_secret TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Batches Table - Updated to match usage in pos2013Offline.service.ts
    await db.query(`
      CREATE TABLE IF NOT EXISTS pos2013_batches (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        protocol_version TEXT,
        status TEXT NOT NULL,
        settlement_code TEXT,
        txn_count INTEGER,
        batch_file TEXT, -- JSON stored as TEXT
        batch_seq INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transactions Table - Added as it was missing
    await db.query(`
      CREATE TABLE IF NOT EXISTS pos2013_transactions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        local_txn_id TEXT NOT NULL,
        stan TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        pan_masked TEXT,
        txn_type TEXT,
        auth_mode TEXT,
        entry_mode TEXT,
        rrn TEXT,
        auth_code TEXT,
        status TEXT,
        emv_data TEXT, -- JSON or String
        txn_timestamp TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // User Sessions Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_info TEXT,
        ip_address TEXT,
        last_active TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Receipts Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        receipt_id TEXT UNIQUE NOT NULL,
        transaction_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        receipt_data TEXT NOT NULL, -- JSON
        generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transaction_id) REFERENCES pos2013_transactions(id)
      );
    `);

    // Merchant Business Info Table (for receipt headers)
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_business_info (
        merchant_id TEXT PRIMARY KEY,
        business_name TEXT,
        business_address TEXT,
        business_phone TEXT,
        receipt_header TEXT,
        receipt_footer TEXT DEFAULT 'Thank you for your business!',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Terminals Table - for device registration
    await db.query(`
      CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        terminal_id TEXT UNIQUE NOT NULL,
        name TEXT,
        terminal_secret TEXT,
        offline_enabled INTEGER DEFAULT 0,
        last_batch_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed Admin User
    const userRes = await db.query("SELECT * FROM admin_users WHERE username = ?", ["admin"]);
    if (userRes.rowCount === 0) {
      const hash = await bcrypt.hash("admin123", 10);
      const adminId = uuidv4();
      await db.query("INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)", [adminId, "admin", hash]);
      console.log("Default admin user created: admin / admin123");
    }

    // Seed Merchant Settings
    const settingsRes = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", ["MRC-1001"]);
    if (settingsRes.rowCount === 0) {
      await db.query(`
        INSERT INTO merchant_settings (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, paypal_client_id, paypal_client_secret)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        "MRC-1001", 
        "sk_test_default_key_123", 
        "https://api.example.com/webhook", 
        1, 
        "Default Store", 
        "support@example.com",
        "AZ78gCo54gfr-itujBtnWMJyFYAYsrONPvIDRJq252pL_kcm3PWt-uS2rRwNTJFhZRRIDc0QRPS0QBWk",
        "EAnAkvmZ4OeAqgr4fTN7gqrc0wiDpovMP7Uni4bOu5Zoh8sDgLhbYZ9Lv4DxJAEr0aFtDJIY0Xj_n9ny"
      ]);
      console.log("Default settings created for MRC-1001");
    }

    const terminalRes = await db.query("SELECT * FROM terminals WHERE merchant_id = ? AND terminal_id = ?", ["MRC-1001", "T2013-001"]);
    if (terminalRes.rowCount === 0) {
      await db.query(
        `INSERT INTO terminals (id, merchant_id, terminal_id, name, terminal_secret, offline_enabled) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), "MRC-1001", "T2013-001", "Main Terminal", "secret_term_001", 1]
      );
      console.log("Default terminal created: MRC-1001 / T2013-001");
    }

    console.log("Tables initialized successfully (SQLite)");
  } catch (error) {
    console.error("Error initializing tables:", error);
  }
};
