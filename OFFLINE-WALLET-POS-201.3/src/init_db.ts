import { db } from "./config/db";

export const initDatabase = async () => {
  try {
    console.log("Initializing SQLite database...");

    // Batches Table
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
        batch_file TEXT,
        batch_seq INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transactions Table
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
        emv_data TEXT,
        txn_timestamp TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Terminals Table (optional, for dashboard)
    await db.query(`
      CREATE TABLE IF NOT EXISTS terminals ( 
        id TEXT PRIMARY KEY, 
        merchant_id TEXT NOT NULL, 
        terminal_id TEXT NOT NULL, 
        name TEXT NOT NULL, 
        terminal_secret TEXT NOT NULL, 
        offline_enabled INTEGER DEFAULT 1, 
        last_batch_at TEXT, 
        created_at TEXT DEFAULT CURRENT_TIMESTAMP 
      );
    `);

    // Add Unique Constraint for (merchant_id, terminal_id) to prevent duplicates
    try {
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_merchant_terminal ON terminals (merchant_id, terminal_id);`);
    } catch (e) {
      console.warn("Could not create unique index on terminals:", e);
    }

    // Merchant Settings Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_settings (
        merchant_id TEXT PRIMARY KEY,
        api_key TEXT,
        webhook_url TEXT,
        test_mode INTEGER DEFAULT 1,
        merchant_name TEXT,
        support_email TEXT,
        merchant_address TEXT,
        merchant_phone TEXT,
        license_number TEXT,
        tax_id TEXT,
        paypal_client_id TEXT,
        paypal_client_secret TEXT,
        myfatoorah_api_token TEXT,
        myfatoorah_test_mode INTEGER DEFAULT 1,
        features TEXT,
        extended_settings TEXT,
        payment_config TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Migration: Add columns if missing (merchant_settings)
    const columns = [
      'features', 
      'extended_settings', 
      'payment_config',
      'merchant_address',
      'merchant_phone',
      'license_number',
      'tax_id',
      'myfatoorah_api_token',
      'myfatoorah_test_mode'
    ];
    for (const col of columns) {
      try {
        await db.query(`ALTER TABLE merchant_settings ADD COLUMN ${col} TEXT;`);
      } catch (e) {
        // Ignore if exists
      }
    }

    // Migration: Add columns if missing (pos2013_batches)
    const batchColumns = [
      'upload_timestamp'
    ];
    for (const col of batchColumns) {
      try {
        await db.query(`ALTER TABLE pos2013_batches ADD COLUMN ${col} TEXT;`);
      } catch (e) {
        // Ignore if exists
      }
    }

    // Admin Users Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        full_name TEXT,
        role TEXT DEFAULT 'admin',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert Default Admin if not exists
    const adminId = "admin-id";
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin123";
    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await db.query(`
      INSERT OR IGNORE INTO admin_users (id, username, password_hash, email, full_name, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [adminId, 'admin', passwordHash, 'admin@pos2013.com', 'System Administrator', 'admin']);

    // MyFatoorah Transactions Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS myfatoorah_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        myfatoorah_invoice_id TEXT,
        payment_url TEXT,
        settlement_code TEXT,
        amount REAL,
        currency TEXT,
        status TEXT DEFAULT 'PENDING',
        paid_at TEXT,
        raw_webhook_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert Default Merchant Settings
    await db.query(`
      INSERT OR IGNORE INTO merchant_settings 
      (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, merchant_address, merchant_phone, license_number, tax_id, myfatoorah_api_token, myfatoorah_test_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'MRC-1001', 
      'sk_test_mock_key_12345', 
      'https://example.com/webhook', 
      1, 
      'AM GLOBAL PAYMENT SOLUTION', 
      'info@abdellahmendjoum.com',
      'Business Center 1, M Floor, The Meydan Hotel, Nad Al Sheba, Dubai, UAE',
      '+971 52 837 3634',
      'LIC-000000',
      'TAX-000000',
      '',  // myfatoorah_api_token - empty by default
      1    // myfatoorah_test_mode - test mode by default
    ]);

    // MyFatoorah Direct Settlements Table (for offline sync)
    await db.query(`
      CREATE TABLE IF NOT EXISTS myfatoorah_direct_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_txn_id TEXT UNIQUE NOT NULL,
        invoice_id TEXT,
        payment_id TEXT,
        auth_code TEXT,
        customer_name TEXT,
        amount REAL,
        status TEXT,
        card_brand TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};
