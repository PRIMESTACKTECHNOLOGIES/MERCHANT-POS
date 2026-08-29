import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { v4 as uuidv4 } from 'uuid';

/** Parse "ALTER TABLE x ADD COLUMN colName TYPE ...DEFAULT..." SQL → [table, colName, fullSQL] */
const parseAddCol = (sql: string): [string, string, string] => {
  const m = sql.match(/ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?\s+ADD\s+COLUMN\s+"?([A-Za-z0-9_]+)"?/i);
  return m ? [m[1], m[2], sql] : ['', '', sql];
};

export const initTables = async () => {
  try {

    // Allow skipping default/demo seeding in CI or production by setting SKIP_SEED=1
    const skipSeed = process.env.SKIP_SEED === '1' || process.env.SKIP_SEED === 'true';


    // ── Run migrations FIRST (add missing columns to existing tables) ─────────
    // Declarative list of ADD COLUMN migrations — applied only if the target column
    // is not already present (checked via PRAGMA table_info — avoids "duplicate column"
    // errors and noisy console output).
    const migrations: Array<[string, string, string]> = [
      // pos2013_batches — columns added over time
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN total_amount_minor INTEGER DEFAULT 0`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN signature TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN nonce TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN upload_timestamp TEXT DEFAULT CURRENT_TIMESTAMP`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN processed_at TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN batch_seq INTEGER`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN batch_file TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN protocol_version TEXT DEFAULT '201.3'`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN settlement_code TEXT`),
      // pos2013_transactions — columns added over time
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN auth_code TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN local_txn_id TEXT NOT NULL DEFAULT ''`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN txn_type TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN auth_mode TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN entry_mode TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN card_brand TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN reader_source TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN cvm_result TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN pin_verified INTEGER DEFAULT 0`),
      // merchant_settings extended fields
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN features TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN extended_settings TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN terminal_id TEXT`),
      // admin_users fields
      parseAddCol(`ALTER TABLE admin_users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0`),
      // POS idempotency table columns (safe for existing databases)
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN result_json TEXT`),
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      // terminals — offline floor limit + ensure offline_enabled present
      parseAddCol(`ALTER TABLE terminals ADD COLUMN floor_limit REAL DEFAULT 0`),
      parseAddCol(`ALTER TABLE terminals ADD COLUMN offline_enabled INTEGER DEFAULT 0`),
      // bank_accounts — support merchant-owned accounts (polymorphic owner via merchant_id XOR customer_id)
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN merchant_id TEXT`),
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN account_type TEXT DEFAULT 'CHECKING'`),
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN bank_address TEXT`),
      // bank_payouts — add provider_ref for Wise tracking
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN provider_ref TEXT`),
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN provider TEXT`),
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      // wallet_transactions — native currency column (AED stays AED, USD stays USD)
      parseAddCol(`ALTER TABLE wallet_transactions ADD COLUMN currency TEXT DEFAULT 'USD'`),
      // merchant_wallet_transactions — native currency column
      parseAddCol(`ALTER TABLE merchant_wallet_transactions ADD COLUMN currency TEXT DEFAULT 'USD'`),
      // customer_crypto_wallets_v2 — HD derivation index for BIP-44 wallet generation
      parseAddCol(`ALTER TABLE customer_crypto_wallets_v2 ADD COLUMN derivation_index INTEGER`),
    ];

    for (const [table, col, sql] of migrations) {
      try {
        if (!table || !col) continue;
        const pragma = await db.query(`PRAGMA table_info("${table}")`);
        const rows: any[] = pragma?.rows ?? [];
        const colLower = col.toLowerCase();
        const exists = rows.some((r: any) => String(r.name || '').toLowerCase() === colLower);
        if (exists) continue;
        await db.query(sql);
      } catch (_) {
        // any unexpected error on ALTER (e.g. table missing) → silently skip.
      }
    }

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

    // Merchant POS settlement ledger for offline and batch reconciliation
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_pos_settlements (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        ledger_entry_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'unsettled',
        settled_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        meta TEXT
      );
    `);

    // Settlement discrepancies for reconciliation mismatches
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_discrepancies (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        provider_ref TEXT,
        local_settlement_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        discrepancy_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unresolved',
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Batches Table — SQLite-compatible, with all columns the service uses
    await db.query(`
      CREATE TABLE IF NOT EXISTS pos2013_batches (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        protocol_version TEXT DEFAULT '201.3',
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        settlement_code TEXT,
        txn_count INTEGER DEFAULT 0,
        total_amount_minor INTEGER DEFAULT 0,
        signature TEXT,
        nonce TEXT,
        batch_file TEXT,
        batch_seq INTEGER,
        upload_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
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
        card_brand TEXT,
        reader_source TEXT,
        cvm_result TEXT,
        pin_verified INTEGER DEFAULT 0,
        rrn TEXT,
        auth_code TEXT,
        status TEXT,
        emv_data TEXT, -- JSON or String
        txn_timestamp TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // POS idempotency cache for duplicate transaction retries
    await db.query(`
      CREATE TABLE IF NOT EXISTS pos_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Protocol 201.3 signed-request replay protection.
    await db.query(`
      CREATE TABLE IF NOT EXISTS protocol_replay_nonces (
        merchant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (merchant_id, terminal_id, nonce)
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_protocol_replay_created ON protocol_replay_nonces(created_at)`);

    // Local offline funds ledger for machine-offline receipt persistence
    await db.query(`
      CREATE TABLE IF NOT EXISTS offline_funds_receipts (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        transaction_id TEXT,
        stan TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'PENDING',
        receipt_payload TEXT,
        synced_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    // Universal immutable invoice/receipt ledger for every financial transaction type.
    await db.query(`
      CREATE TABLE IF NOT EXISTS financial_documents (
        id TEXT PRIMARY KEY,
        document_number TEXT UNIQUE NOT NULL,
        document_type TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        merchant_id TEXT,
        customer_id TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        reference TEXT,
        description TEXT,
        document_data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_table, source_id)
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_financial_documents_created ON financial_documents(created_at DESC)`);
    await db.query(`CREATE TRIGGER IF NOT EXISTS financial_documents_no_update
      BEFORE UPDATE ON financial_documents
      BEGIN SELECT RAISE(ABORT, 'financial documents are immutable'); END`);
    await db.query(`CREATE TRIGGER IF NOT EXISTS financial_documents_no_delete
      BEFORE DELETE ON financial_documents
      BEGIN SELECT RAISE(ABORT, 'financial documents cannot be deleted'); END`);

    // Incoming Payments Table (internal receiver)
    await db.query(`
      CREATE TABLE IF NOT EXISTS incoming_payments (
        id TEXT PRIMARY KEY,
        source TEXT,
        payload TEXT,
        received_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        floor_limit REAL DEFAULT 0,
        last_batch_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

      // Products Table (simple inventory) 
      await db.query(`
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          merchant_id TEXT NOT NULL,
          sku TEXT,
          name TEXT NOT NULL,
          price_minor INTEGER DEFAULT 0,
          stock INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);

    // Seed Admin User
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin1234";
    const hash = await bcrypt.hash(adminPassword, 10);
    const userRes = await db.query("SELECT * FROM admin_users WHERE username = ?", [adminUsername]);

    let adminId: string;
    if (userRes.rowCount === 0) {
      adminId = uuidv4();
      await db.query("INSERT INTO admin_users (id, username, password_hash, full_name) VALUES (?, ?, ?, ?)", [adminId, adminUsername, hash, "System Administrator"]);
      console.log(`✅ Default admin user created: ${adminUsername} / ${adminPassword}`);
    } else {
      await db.query("UPDATE admin_users SET password_hash = ? WHERE username = ?", [hash, adminUsername]);
      adminId = (userRes.rows[0] as any).id;
      console.log(`✅ Admin password ensured for ${adminUsername}`);
    }

    // Create RBAC tables before seeding roles. These tables are declared again
    // in the security section below for compatibility with existing databases.
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        permissions TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        is_system_role INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_role_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        UNIQUE(user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES admin_users(id),
        FOREIGN KEY (role_id) REFERENCES user_roles(id)
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        merchant_id TEXT,
        customer_id TEXT,
        entity_type TEXT NOT NULL,
        limit_type TEXT NOT NULL,
        limit_amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        period_type TEXT NOT NULL,
        current_usage REAL DEFAULT 0,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed Security Roles
    if (!skipSeed) {
      const roles = [
        {
          id: 'role_super_admin',
          name: 'super_admin',
          display_name: 'Super Administrator',
          description: 'Full system access - can do everything including security config',
          permissions: JSON.stringify(['*']), // All permissions
          priority: 100,
          is_system_role: 1
        },
        {
          id: 'role_admin',
          name: 'admin',
          display_name: 'Administrator',
          description: 'Manage merchants, transactions, settlements - cannot change security',
          permissions: JSON.stringify(['merchants.*', 'transactions.*', 'settlements.*', 'reports.view', 'customers.view']),
          priority: 80,
          is_system_role: 1
        },
        {
          id: 'role_operator',
          name: 'operator',
          display_name: 'Operator',
          description: 'Process transactions, view reports - limited access',
          permissions: JSON.stringify(['transactions.create', 'transactions.view', 'reports.view', 'customers.view']),
          priority: 50,
          is_system_role: 1
        },
        {
          id: 'role_viewer',
          name: 'viewer',
          display_name: 'Viewer',
          description: 'Read-only access - can only view data',
          permissions: JSON.stringify(['*.view', 'reports.view']),
          priority: 10,
          is_system_role: 1
        }
      ];

      for (const role of roles) {
        const roleRes = await db.query("SELECT * FROM user_roles WHERE id = ?", [role.id]);
        if (roleRes.rowCount === 0) {
          await db.query(`
            INSERT INTO user_roles (id, name, display_name, description, permissions, priority, is_system_role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [role.id, role.name, role.display_name, role.description, role.permissions, role.priority, role.is_system_role]);
          console.log(`✅ Created role: ${role.display_name}`);
        }
      }

      // Assign Super Admin role to default admin user
      const assignRes = await db.query("SELECT * FROM user_role_assignments WHERE user_id = ? AND role_id = ?", [adminId, 'role_super_admin']);
      if (assignRes.rowCount === 0) {
        await db.query(`
          INSERT INTO user_role_assignments (id, user_id, role_id, assigned_by)
          VALUES (?, ?, ?, ?)
        `, [uuidv4(), adminId, 'role_super_admin', 'system']);
        console.log(`✅ Assigned Super Admin role to ${adminUsername}`);
      }

      // Seed default withdrawal limits for merchants
      const limitRes = await db.query("SELECT * FROM withdrawal_limits WHERE entity_type = ? AND limit_type = ?", ['merchant', 'daily_limit']);
      if (limitRes.rowCount === 0) {
        await db.query(`
          INSERT INTO withdrawal_limits (id, merchant_id, entity_type, limit_type, limit_amount, currency, period_type, period_start, period_end)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 day'))
        `, [uuidv4(), 'MRC-1001', 'merchant', 'daily_limit', 100000.00, 'USD', 'daily']);
        console.log(`✅ Created default withdrawal limit: $100,000/day for MRC-1001`);
      }
    }

    // Seed Merchant Settings and Terminal unless SKIP_SEED is set
    if (!skipSeed) {
      const settingsRes = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", ["MRC-1001"]);
      if (settingsRes.rowCount === 0) {
        await db.query(`
          INSERT INTO merchant_settings (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email, paypal_client_id, paypal_client_secret)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          "MRC-1001",
          "offline_secret_001",
          "",
          0,
          "Default Store",
          "support@example.com",
          "",
          ""
        ]);
        console.log("Default settings created for MRC-1001 with offline API key offline_secret_001.");
        console.log("Use this secret in your POS batch HMAC signature until you configure a custom merchant API key.");
      }

      const terminalRes = await db.query("SELECT * FROM terminals WHERE merchant_id = ? AND terminal_id = ?", ["MRC-1001", "T2013-001"]);
      if (terminalRes.rowCount === 0) {
        await db.query(
          `INSERT INTO terminals (id, merchant_id, terminal_id, name, terminal_secret, offline_enabled) VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), "MRC-1001", "T2013-001", "Main Terminal", "secret_term_001", 1]
        );
        console.log("Default terminal created: MRC-1001 / T2013-001");
      }
    } else {
      console.log('SKIP_SEED is set — skipping merchant and terminal default seeding');
    }

    // Customers Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Customer Wallets Table — one wallet per (customer, currency) so AED stays AED, USD stays USD
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_wallets (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0.00,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'active',
        wallet_code TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (customer_id, currency)
      );
    `);
    // Performance index
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_cw_customer_ccy ON customer_wallets(customer_id, currency)`); } catch(_) {}

    // Wallet Transactions Table (Ledger) with native currency column
    await db.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        source TEXT NOT NULL,
        reference TEXT,
        description TEXT,
        pan_masked TEXT,
        emv_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Merchant Wallets Table — one wallet per (merchant, currency)
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallets (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0.00,
        currency TEXT DEFAULT 'USD',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (merchant_id, currency)
      );
    `);
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_mw_merchant_ccy ON merchant_wallets(merchant_id, currency)`); } catch(_) {}

    // Merchant Wallet Transactions Table with native currency column
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallet_transactions (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        source TEXT NOT NULL,
        reference TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ledger Entries Table for transaction lifecycle auditing
    await db.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Cashouts Table (Settlement Payouts)
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashouts (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'PENDING',
        gateway TEXT DEFAULT 'OFFLINE',
        gateway_payout_id TEXT,
        error_message TEXT,
        fee_minor INTEGER DEFAULT 0,
        net_amount_minor INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Cashout-Transactions Join Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cashout_transactions (
        id TEXT PRIMARY KEY,
        cashout_id TEXT NOT NULL,
        batch_id TEXT,
        transaction_id TEXT,
        amount_minor INTEGER NOT NULL,
        FOREIGN KEY (cashout_id) REFERENCES cashouts(id) ON DELETE CASCADE
      );
    `);

    // Payment Codes Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_codes (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT DEFAULT 'USD',
        used INTEGER DEFAULT 0, -- Boolean
        used_at TEXT,
        used_by_merchant TEXT,
        reference TEXT,
        stan TEXT,
        pan_masked TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Customer Crypto Wallets Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_crypto_wallets (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        crypto_coin TEXT NOT NULL, -- e.g., BTC, ETH, USDT
        balance REAL NOT NULL DEFAULT 0.0,
        crypto_address TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(customer_id, crypto_coin)
      );
    `);

    // Crypto Transactions Table (Buy/Sell Crypto with wallet transactions
    await db.query(`
      CREATE TABLE IF NOT EXISTS crypto_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        crypto_coin TEXT NOT NULL,
        transaction_type TEXT NOT NULL, -- 'buy' or 'sell'
        fiat_amount REAL NOT NULL, -- In USD (or whatever fiat)
        crypto_amount REAL NOT NULL,
        fiat_currency TEXT DEFAULT 'USD',
        exchange_rate REAL,
        source TEXT, -- e.g., 'wallet_balance' (for buying with wallet)
        reference TEXT,
        tx_hash TEXT, -- On-chain tx hash if applicable
        meta TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        is_mock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try {
      await db.query(`ALTER TABLE crypto_transactions ADD COLUMN provider_mode TEXT`);
    } catch (_) { /* ignore exists */ }
    try {
      await db.query(`ALTER TABLE crypto_transactions ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0`);
    } catch (_) { /* ignore exists */ }
    try {
      await db.query(`ALTER TABLE crypto_transactions ADD COLUMN meta TEXT`);
    } catch (_) { /* ignore exists */ }

    // Merchant Crypto Balances Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_crypto_balances (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        asset TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        is_mock INTEGER NOT NULL DEFAULT 0,
        meta TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await db.query(`ALTER TABLE merchant_crypto_balances ADD COLUMN is_mock INTEGER NOT NULL DEFAULT 0`);
    } catch (_) { /* column exists — ignore */ }

    // Bank Accounts Table (for wallet-to-bank transfers)
    //   Polymorphic ownership: EITHER customer_id (customer account) OR merchant_id (merchant account)
    //   is_default=1 is the inbuilt default payout destination for the given owner
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        merchant_id TEXT,
        bank_name TEXT NOT NULL,
        account_holder TEXT NOT NULL,
        account_number TEXT NOT NULL,
        routing_number TEXT,
        account_type TEXT DEFAULT 'CHECKING',
        iban TEXT,
        swift_code TEXT,
        bank_address TEXT,
        currency TEXT DEFAULT 'USD',
        is_default INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Merchant Payouts Table (merchant wallet → external bank)
    //   Written by bank.router.ts /payout/bank endpoint. Tracks Wise transfer lifecycle.
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_payouts (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        bank_account TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        provider TEXT,
        provider_reference TEXT,
        meta TEXT,
        error_message TEXT,
        completed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Wallet Transfers Table (wallet-to-wallet)
    await db.query(`
      CREATE TABLE IF NOT EXISTS wallet_transfers (
        id TEXT PRIMARY KEY,
        sender_customer_id TEXT NOT NULL,
        receiver_customer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        note TEXT,
        status TEXT DEFAULT 'COMPLETED',
        fee REAL DEFAULT 0.00,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallet_transfers (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        note TEXT,
        status TEXT DEFAULT 'COMPLETED',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Bank Payouts Table (wallet-to-bank)
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_payouts (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        bank_account_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        fee REAL DEFAULT 0.00,
        net_amount REAL NOT NULL,
        status TEXT DEFAULT 'PENDING',
        reference TEXT,
        scheduled_at TEXT,
        completed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transak Orders Table (fiat on-ramp via Google Pay and other payment methods)
    await db.query(`
      CREATE TABLE IF NOT EXISTS transak_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT_FROM_USER',
        fiat_currency TEXT NOT NULL,
        fiat_amount REAL NOT NULL DEFAULT 0,
        crypto_currency TEXT NOT NULL,
        crypto_amount REAL NOT NULL DEFAULT 0,
        network TEXT,
        wallet_address TEXT,
        partner_order_id TEXT,
        partner_customer_id TEXT,
        transaction_hash TEXT,
        amount_paid REAL DEFAULT 0,
        conversion_price REAL,
        total_fee REAL DEFAULT 0,
        raw_event TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ───────────────────────────────────────────────────────────────────────
    // BATCH RECONCILIATION TABLES
    // ───────────────────────────────────────────────────────────────────────

    // Reconciliation Reports - High-level summary of batch reconciliation
    await db.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_reports (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        report_date TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_offline_txns INTEGER DEFAULT 0,
        total_online_matches INTEGER DEFAULT 0,
        total_discrepancies INTEGER DEFAULT 0,
        critical_issues INTEGER DEFAULT 0,
        warnings INTEGER DEFAULT 0,
        total_offline_amount REAL DEFAULT 0,
        total_online_amount REAL DEFAULT 0,
        amount_difference REAL DEFAULT 0,
        summary_json TEXT,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );
    `);

    // Reconciliation Discrepancies - Individual issues identified during reconciliation
    await db.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        offline_txn_id TEXT,
        online_txn_id TEXT,
        local_txn_id TEXT NOT NULL,
        offline_amount REAL DEFAULT 0,
        online_amount REAL DEFAULT 0,
        offline_status TEXT,
        online_status TEXT,
        discrepancy_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'INFO',
        notes TEXT,
        resolution_status TEXT DEFAULT 'UNRESOLVED',
        resolved_by TEXT,
        resolution_notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        FOREIGN KEY (report_id) REFERENCES reconciliation_reports(id)
      );
    `);

    // ───────────────────────────────────────────────────────────────────────
    // MERCHANT SETTLEMENT TABLES
    // ───────────────────────────────────────────────────────────────────────

    // Transaction Settlements - Individual transaction settlement records
    await db.query(`
      CREATE TABLE IF NOT EXISTS transaction_settlements (
        id TEXT PRIMARY KEY,
        merchant_id TEXT,
        transaction_id TEXT NOT NULL,
        reconciliation_id TEXT,
        gross_amount REAL DEFAULT 0,
        fee_amount REAL DEFAULT 0,
        net_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'PENDING',
        hold_reason TEXT,
        hold_until TEXT,
        settled_at TEXT,
        reversed_at TEXT,
        adjusted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Settlement Batches - Grouped settlement processing records
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_batches (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        process_date TEXT NOT NULL,
        total_gross_amount REAL DEFAULT 0,
        total_fee_amount REAL DEFAULT 0,
        total_net_amount REAL DEFAULT 0,
        transaction_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );
    `);

    // ───────────────────────────────────────────────────────────────────────
    // CONFLICT RESOLUTION TABLES
    // ───────────────────────────────────────────────────────────────────────

    // Conflict Resolutions - Track all conflict resolution operations
    await db.query(`
      CREATE TABLE IF NOT EXISTS conflict_resolutions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        conflict_type TEXT NOT NULL,
        canonical_id TEXT,
        duplicate_ids TEXT,
        settlement_id TEXT,
        status TEXT NOT NULL DEFAULT 'INITIATED',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        notes TEXT
      );
    `);

    // ═══════════════════════════════════════════════════════════════════════
    // AUTHORIZATION ENGINE TABLES
    // ═══════════════════════════════════════════════════════════════════════

    // Authorization Requests - Transaction authorization workflow
    await db.query(`
      CREATE TABLE IF NOT EXISTS authorization_requests (
        id TEXT PRIMARY KEY,
        transaction_id TEXT UNIQUE NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        customer_id TEXT NOT NULL,
        merchant_id TEXT,
        terminal_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending_authorization',
        authorization_code TEXT UNIQUE NOT NULL,
        verification_source TEXT,
        verification_data TEXT,
        risk_score REAL DEFAULT 0.0,
        fraud_flags TEXT,
        requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
        authorized_at TEXT,
        settled_at TEXT,
        expires_at TEXT,
        decline_reason TEXT,
        notes TEXT
      );
    `);

    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_status ON authorization_requests(status)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_customer ON authorization_requests(customer_id)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_transaction ON authorization_requests(transaction_id)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_code ON authorization_requests(authorization_code)`); } catch(_) {}

    // Authorization Holds - Funds on hold during authorization
    await db.query(`
      CREATE TABLE IF NOT EXISTS authorization_holds (
        id TEXT PRIMARY KEY,
        authorization_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        hold_type TEXT NOT NULL,
        released_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Authorization Log - Audit trail of authorization events
    await db.query(`
      CREATE TABLE IF NOT EXISTS authorization_log (
        id TEXT PRIMARY KEY,
        authorization_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        performed_by TEXT,
        performed_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_log_id ON authorization_log(authorization_id)`); } catch(_) {}

    // Settlement Reversals - Track reversals and chargebacks
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_reversals (
        id TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        chargeback_id TEXT,
        reversal_amount REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'INITIATED',
        processed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (settlement_id) REFERENCES transaction_settlements(id)
      );
    `);

    // ═══════════════════════════════════════════════════════════════════════
    // SECURITY TABLES - FOR REAL FUNDS PROTECTION
    // ═══════════════════════════════════════════════════════════════════════

    // User Roles - RBAC (Role-Based Access Control)
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        permissions TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        is_system_role INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // User Role Assignments - Link users to roles
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_role_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        UNIQUE(user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES admin_users(id),
        FOREIGN KEY (role_id) REFERENCES user_roles(id)
      );
    `);

    // MFA Tokens - Two-Factor Authentication
    await db.query(`
      CREATE TABLE IF NOT EXISTS mfa_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        mfa_type TEXT NOT NULL,
        secret TEXT NOT NULL,
        backup_codes TEXT,
        verified INTEGER DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES admin_users(id)
      );
    `);

    // Security Audit Log - Track ALL security events
    await db.query(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        old_value TEXT,
        new_value TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_sec_audit_user ON security_audit_log(user_id)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_sec_audit_type ON security_audit_log(event_type)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_sec_audit_created ON security_audit_log(created_at)`); } catch(_) {}

    // Transaction Approvals - Dual Authorization Workflow
    await db.query(`
      CREATE TABLE IF NOT EXISTS transaction_approvals (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        initiated_by TEXT NOT NULL,
        approved_by TEXT,
        rejected_by TEXT,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        approval_threshold REAL NOT NULL,
        approval_level INTEGER DEFAULT 1,
        approval_deadline TEXT,
        rejection_reason TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        approved_at TEXT,
        rejected_at TEXT,
        FOREIGN KEY (initiated_by) REFERENCES admin_users(id),
        FOREIGN KEY (approved_by) REFERENCES admin_users(id),
        FOREIGN KEY (rejected_by) REFERENCES admin_users(id)
      );
    `);

    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_tx_approval_status ON transaction_approvals(status)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_tx_approval_initiated ON transaction_approvals(initiated_by)`); } catch(_) {}

    // Withdrawal Limits - Daily/hourly withdrawal restrictions
    await db.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        merchant_id TEXT,
        customer_id TEXT,
        entity_type TEXT NOT NULL,
        limit_type TEXT NOT NULL,
        limit_amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        period_type TEXT NOT NULL,
        current_usage REAL DEFAULT 0,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Withdrawal Velocity Tracking - Detect suspicious withdrawal patterns
    await db.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_velocity_tracking (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        time_window_minutes INTEGER NOT NULL,
        withdrawal_count INTEGER DEFAULT 0,
        total_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // IP Whitelist - Allowed IP addresses
    await db.query(`
      CREATE TABLE IF NOT EXISTS ip_whitelist (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        merchant_id TEXT,
        ip_address TEXT NOT NULL,
        ip_range TEXT,
        label TEXT,
        added_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        last_used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT
      );
    `);

    // Security Alerts - Real-time security notifications
    await db.query(`
      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        user_id TEXT,
        entity_id TEXT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        alert_data TEXT,
        status TEXT DEFAULT 'active',
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        resolved_at TEXT,
        notification_sent INTEGER DEFAULT 0,
        notification_channels TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_sec_alert_status ON security_alerts(status)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_sec_alert_severity ON security_alerts(severity)`); } catch(_) {}

    // Database Backups Log - Track automated backups
    await db.query(`
      CREATE TABLE IF NOT EXISTS database_backups (
        id TEXT PRIMARY KEY,
        backup_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        encryption_enabled INTEGER DEFAULT 1,
        encryption_key_id TEXT,
        backup_hash TEXT,
        status TEXT DEFAULT 'completed',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Geographic Restrictions - Block transactions from certain countries
    await db.query(`
      CREATE TABLE IF NOT EXISTS geographic_restrictions (
        id TEXT PRIMARY KEY,
        rule_type TEXT NOT NULL,
        country_code TEXT NOT NULL,
        restriction_type TEXT NOT NULL,
        reason TEXT,
        added_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT
      );
    `);

    // Failed Syncs - Track failed transaction syncs with retry logic
    await db.query(`
      CREATE TABLE IF NOT EXISTS failed_syncs (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        attempt_count INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        last_attempt_at TEXT,
        next_retry_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ───────────────────────────────────────────────────────────────────────
    // AUDIT TRAIL TABLES
    // ───────────────────────────────────────────────────────────────────────

    // Audit Trail - Full transaction lifecycle tracking and compliance audit log
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_category TEXT NOT NULL,
        actor TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        previous_state TEXT,
        new_state TEXT,
        details TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );
    `);

    // Compliance Reports - Stored compliance audit reports
    await db.query(`
      CREATE TABLE IF NOT EXISTS compliance_reports (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        report_date TEXT DEFAULT CURRENT_TIMESTAMP,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_transactions INTEGER DEFAULT 0,
        total_amount REAL DEFAULT 0,
        summary_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );
    `);

    // Bank Transfer Transactions - Transak virtual account bank transfer payments
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_transfer_transactions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        quote_id TEXT NOT NULL,
        virtual_account_id TEXT NOT NULL,
        amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'INITIATED',
        user_email TEXT,
        user_ip TEXT NOT NULL,
        account_details TEXT,
        webhook_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      );
    `);

    // ───────────────────────────────────────────────────────────────────────
    // ENHANCED CRYPTO WALLET TABLES (v2)
    // ───────────────────────────────────────────────────────────────────────

    // Customer Crypto Wallets v2 - Enhanced with network/address tracking
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_crypto_wallets_v2 (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        coin TEXT NOT NULL,
        network TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        value_usd REAL NOT NULL DEFAULT 0,
        address TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(customer_id, coin, network, address)
      );
    `);

    // Crypto Wallet Transactions v2 - Detailed transaction log
    await db.query(`
      CREATE TABLE IF NOT EXISTS crypto_wallet_transactions_v2 (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        coin TEXT NOT NULL,
        network TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        from_amount REAL NOT NULL,
        to_amount REAL NOT NULL,
        exchange_rate REAL NOT NULL,
        source TEXT NOT NULL,
        reference TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transak Orders v2 - Enhanced order tracking
    await db.query(`
      CREATE TABLE IF NOT EXISTS transak_orders_v2 (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        transak_order_id TEXT,
        status TEXT DEFAULT 'PENDING',
        fiat_amount REAL NOT NULL,
        fiat_currency TEXT NOT NULL,
        crypto_amount REAL DEFAULT 0,
        crypto_currency TEXT NOT NULL,
        network TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        webhook_data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transak Webhook Log - Audit trail for webhooks
    await db.query(`
      CREATE TABLE IF NOT EXISTS transak_webhook_log_v2 (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        processed_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Customer Crypto Withdrawals — on-chain send records for customer self-serve withdrawals
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_crypto_withdrawals (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        coin TEXT NOT NULL,
        network TEXT NOT NULL,
        amount REAL NOT NULL,
        destination_address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_manual',
        provider TEXT,
        ref TEXT,
        tx_id TEXT,
        tx_url TEXT,
        meta TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try {
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ccw_customer_status ON customer_crypto_withdrawals(customer_id, status)`);
    } catch (_) {}

    // Merchant Crypto Withdrawals — on-chain send records for merchant payout router
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_crypto_withdrawals (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount_usd REAL NOT NULL,
        asset TEXT NOT NULL,
        address TEXT NOT NULL,
        network TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_manual',
        provider TEXT,
        ref TEXT,
        tx_id TEXT,
        tx_url TEXT,
        meta TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try {
      await db.query(`CREATE INDEX IF NOT EXISTS idx_mcw_merchant_status ON merchant_crypto_withdrawals(merchant_id, status)`);
    } catch (_) {}

    // Crypto Transactions Log v2 - Comprehensive transaction history
    await db.query(`
      CREATE TABLE IF NOT EXISTS crypto_transactions_log_v2 (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        from_amount REAL NOT NULL,
        to_amount REAL NOT NULL,
        exchange_rate REAL NOT NULL,
        source TEXT NOT NULL,
        reference TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Tables initialized successfully (SQLite)");
  } catch (error) {
    console.error("Error initializing tables:", error);
  }
};
