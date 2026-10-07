import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { v4 as uuidv4 } from 'uuid';

/** Parse "ALTER TABLE x ADD COLUMN colName TYPE ...DEFAULT..." SQL â†’ [table, colName, fullSQL] */
const parseAddCol = (sql: string): [string, string, string] => {
  const m = sql.match(/ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?\s+ADD\s+COLUMN\s+"?([A-Za-z0-9_]+)"?/i);
  return m ? [m[1], m[2], sql] : ['', '', sql];
};

export const initTables = async () => {
  try {

    // Allow skipping default/demo seeding in CI or production by setting SKIP_SEED=1
    const skipSeed = process.env.SKIP_SEED === '1' || process.env.SKIP_SEED === 'true';


    // â”€â”€ Run migrations FIRST (add missing columns to existing tables) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Declarative list of ADD COLUMN migrations â€” applied only if the target column
    // is not already present (checked via PRAGMA table_info â€” avoids "duplicate column"
    // errors and noisy console output).
    const migrations: Array<[string, string, string]> = [
      // pos2013_batches â€” columns added over time
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN total_amount_minor INTEGER DEFAULT 0`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN signature TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN nonce TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN upload_timestamp TEXT DEFAULT CURRENT_TIMESTAMP`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN processed_at TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN batch_seq INTEGER`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN batch_file TEXT`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN protocol_version TEXT DEFAULT '201.3'`),
      parseAddCol(`ALTER TABLE pos2013_batches ADD COLUMN settlement_code TEXT`),
      parseAddCol(`ALTER TABLE vault_ledger ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'`),
      // pos2013_transactions â€” columns added over time
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN auth_code TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN customer_id TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN local_txn_id TEXT NOT NULL DEFAULT ''`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN txn_type TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN auth_mode TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN entry_mode TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN card_brand TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN reader_source TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN cvm_result TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN pin_verified INTEGER DEFAULT 0`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN decline_reason TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN emv_field55_hex TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN iso_mti TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN iso_response_code TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN iso_message_reference TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN token_reference TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN pan_sequence TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN pos_condition_code TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN pin_block_kid TEXT`),
      parseAddCol(`ALTER TABLE pos2013_transactions ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN license_number TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN tax_id TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN merchant_address TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN merchant_phone TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN support_email TEXT`),
      // merchant_settings extended fields
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN features TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN extended_settings TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN payment_config TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN terminal_id TEXT`),
      // merchant_settings bank account fields (for manual payouts)
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_name TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_account_holder TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_account_number TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_routing_number TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_iban TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_swift_code TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN bank_address TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN usdt_address_tron TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN usdt_address_bsc TEXT`),
      parseAddCol(`ALTER TABLE merchant_settings ADD COLUMN usdt_address_polygon TEXT`),
      // ledger_entries merchant tracking fields
      parseAddCol(`ALTER TABLE ledger_entries ADD COLUMN merchant_id TEXT`),
      parseAddCol(`ALTER TABLE ledger_entries ADD COLUMN source_type TEXT`),
      parseAddCol(`ALTER TABLE ledger_entries ADD COLUMN source_reference TEXT`),
      parseAddCol(`ALTER TABLE ledger_entries ADD COLUMN source_network TEXT`),
      parseAddCol(`ALTER TABLE ledger_entries ADD COLUMN reference TEXT`),
      // merchant_payouts additional fields
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN destination TEXT`),
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN reference TEXT`),
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN approved_by TEXT`),
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN approved_at TEXT`),
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN reconciliation_status TEXT`),
      parseAddCol(`ALTER TABLE merchant_payouts ADD COLUMN reconciliation_note TEXT`),
      // admin_users fields
      parseAddCol(`ALTER TABLE admin_users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0`),
      // POS idempotency table columns (safe for existing databases)
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN result_json TEXT`),
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      parseAddCol(`ALTER TABLE pos_idempotency ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      // terminals â€” offline floor limit + ensure offline_enabled present
      parseAddCol(`ALTER TABLE terminals ADD COLUMN floor_limit REAL DEFAULT 0`),
      parseAddCol(`ALTER TABLE terminals ADD COLUMN offline_enabled INTEGER DEFAULT 0`),
      // bank_accounts â€” support merchant-owned accounts (polymorphic owner via merchant_id XOR customer_id)
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN merchant_id TEXT`),
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN account_type TEXT DEFAULT 'CHECKING'`),
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN bank_address TEXT`),
      parseAddCol(`ALTER TABLE bank_accounts ADD COLUMN recipient_address TEXT`),
      // bank_payouts â€” add provider_ref for Wise tracking
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN provider_ref TEXT`),
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN provider TEXT`),
      parseAddCol(`ALTER TABLE bank_payouts ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`),
      // wallet_transactions â€” native currency column (AED stays AED, USD stays USD)
      parseAddCol(`ALTER TABLE wallet_transactions ADD COLUMN currency TEXT DEFAULT 'USD'`),
      // merchant_wallet_transactions â€” native currency column
      parseAddCol(`ALTER TABLE merchant_wallet_transactions ADD COLUMN currency TEXT DEFAULT 'USD'`),
      // customer_crypto_wallets_v2 â€” HD derivation index for BIP-44 wallet generation
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
        // any unexpected error on ALTER (e.g. table missing) â†’ silently skip.
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
        features TEXT,
        extended_settings TEXT,
        payment_config TEXT,
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

    // Batches Table â€” SQLite-compatible, with all columns the service uses
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
        customer_id TEXT,
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
        emv_field55_hex TEXT,
        iso_mti TEXT,
        iso_response_code TEXT,
        iso_message_reference TEXT,
        token_reference TEXT,
        pan_sequence TEXT,
        pos_condition_code TEXT,
        pin_block_kid TEXT,
        txn_timestamp TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_pos2013_txn_scope
      ON pos2013_transactions (merchant_id, terminal_id, batch_id, local_txn_id);`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_pos2013_txn_rrn
      ON pos2013_transactions (merchant_id, rrn) WHERE rrn IS NOT NULL;`);

    // â”€â”€ Protocol Rules â€” constraints per protocol (101.1 / 101.6 / 201.3) â”€â”€â”€â”€â”€â”€â”€â”€
    // Defines what is required for each protocol. Checked BEFORE auth code lookup.
    await db.query(`
      CREATE TABLE IF NOT EXISTS protocol_rules (
        id              TEXT PRIMARY KEY,
        protocol        TEXT NOT NULL UNIQUE,  -- 101.1 | 101.6 | 201.3
        code_type       TEXT NOT NULL,          -- approval_code | auth_code | token
        requires_cvv    INTEGER NOT NULL DEFAULT 0,  -- 1 = CVV required
        requires_online INTEGER NOT NULL DEFAULT 0,  -- 1 = must be online auth
        requires_offline INTEGER NOT NULL DEFAULT 0, -- 1 = must be offline auth
        min_amount      REAL NOT NULL DEFAULT 0,
        max_amount      REAL NOT NULL DEFAULT 9999999999,
        issuer          TEXT,
        card_bin        TEXT,
        description     TEXT,
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Seed the 3 protocol rules
    const protocolRulesSeed = [
      { id: 'rule-101.1', protocol: '101.1', code_type: 'approval_code', requires_cvv: 0, requires_online: 1, requires_offline: 0, min_amount: 0, max_amount: 9999999999, description: 'Voice Auth â€” approval code from issuer, no CVV required' },
      { id: 'rule-101.6', protocol: '101.6', code_type: 'token',          requires_cvv: 0, requires_online: 1, requires_offline: 0, min_amount: 0, max_amount: 9999999999, description: 'EMV Chip / Online token â€” dynamic code, CVV optional' },
      { id: 'rule-201.3', protocol: '201.3', code_type: 'auth_code',      requires_cvv: 1, requires_online: 0, requires_offline: 1, min_amount: 0, max_amount: 9999999999, description: 'Offline Batch â€” pre-auth code + CVV both required' },
    ];
    for (const rule of protocolRulesSeed) {
      try {
        const chk = await db.query(`SELECT COUNT(*) c FROM protocol_rules WHERE protocol = ?`, [rule.protocol]);
        if ((chk.rows?.[0]?.c || 0) === 0) {
          await db.query(
            `INSERT INTO protocol_rules (id, protocol, code_type, requires_cvv, requires_online, requires_offline, min_amount, max_amount, description) VALUES (?,?,?,?,?,?,?,?,?)`,
            [rule.id, rule.protocol, rule.code_type, rule.requires_cvv, rule.requires_online, rule.requires_offline, rule.min_amount, rule.max_amount, rule.description]
          );
        }
      } catch { /* ignore */ }
    }

    // â”€â”€ Card Authorizations â€” pre-authorized codes for protocol validation â”€â”€
    // Stores valid auth codes per card / protocol for 101.1, 101.6, 201.3.
    // When a POS transaction arrives with an auth code, it must match a row here.
    await db.query(`
      CREATE TABLE IF NOT EXISTS card_authorizations (
        id               TEXT PRIMARY KEY,
        card_number      TEXT NOT NULL,         -- full PAN or masked
        pan_masked       TEXT,                  -- last-4 masked version
        protocol         TEXT NOT NULL,         -- 101.1 | 101.6 | 201.3
        code             TEXT NOT NULL,         -- approval code / token / auth ref
        cvv              TEXT,                  -- required for 201.3 validation
        amount           NUMERIC NOT NULL,      -- authorized amount (decimal)
        currency         TEXT NOT NULL DEFAULT 'USD',
        merchant_id      TEXT,
        terminal_id      TEXT,
        auth_ref         TEXT,                  -- internal reference
        approval_code    TEXT,                  -- alias used by acquirer path
        customer_id      TEXT,
        status           TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | USED | EXPIRED | REVOKED
        expiry           TEXT,                  -- card expiry MM/YY
        captured_at      TEXT,
        reversed_at      TEXT,
        acquirer_raw     TEXT,
        created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Index for fast lookup by code + protocol
    await db.query(`CREATE INDEX IF NOT EXISTS idx_card_auth_code ON card_authorizations(code, protocol)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_card_auth_pan  ON card_authorizations(card_number)`);

    // Migrate: add missing columns to card_authorizations if it existed before
    for (const [col, def] of [
      ['pan_masked',   'TEXT'],
      ['cvv',          'TEXT'],
      ['currency',     "TEXT NOT NULL DEFAULT 'USD'"],
      ['merchant_id',  'TEXT'],
      ['terminal_id',  'TEXT'],
      ['auth_ref',     'TEXT'],
      ['approval_code','TEXT'],
      ['customer_id',  'TEXT'],
      ['expiry',       'TEXT'],
      ['captured_at',  'TEXT'],
      ['reversed_at',  'TEXT'],
      ['acquirer_raw', 'TEXT'],
      ['updated_at',   'TEXT DEFAULT CURRENT_TIMESTAMP'],
    ] as const) {
      try { await db.query(`ALTER TABLE card_authorizations ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
    }

    // POS idempotency cache for duplicate transaction retries
    await db.query(`
      CREATE TABLE IF NOT EXISTS pos_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    // Settlement imports and reconciled vault balances
    await db.query(`
      CREATE TABLE IF NOT EXISTS settlement_imports (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_hash TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        total_net REAL NOT NULL DEFAULT 0,
        row_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS settlement_records (
        id TEXT PRIMARY KEY,
        import_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        auth_ref TEXT NOT NULL,
        capture_ref TEXT NOT NULL,
        amount REAL NOT NULL,
        net_amount REAL NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SETTLED',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (merchant_id, capture_ref, currency),
        FOREIGN KEY (import_id) REFERENCES settlement_imports(id)
      );
      CREATE TABLE IF NOT EXISTS settlement_vaults (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (merchant_id, currency)
      );
      CREATE TABLE IF NOT EXISTS settlement_ledger_entries (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        settlement_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (settlement_id, type)
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
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
    const hash = await bcrypt.hash(adminPassword, 10);
    const userRes = await db.query("SELECT * FROM admin_users WHERE username = ?", [adminUsername]);

    let adminId: string;
    if (userRes.rowCount === 0) {
      adminId = uuidv4();
      await db.query("INSERT INTO admin_users (id, username, password_hash, full_name) VALUES (?, ?, ?, ?)", [adminId, adminUsername, hash, "System Administrator"]);
      console.log(`âœ… Default admin user created: ${adminUsername} / ${adminPassword}`);
    } else {
      await db.query("UPDATE admin_users SET password_hash = ? WHERE username = ?", [hash, adminUsername]);
      adminId = (userRes.rows[0] as any).id;
      console.log(`âœ… Admin password ensured for ${adminUsername}`);
    }

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
          console.log(`âœ… Created role: ${role.display_name}`);
        }
      }

      // Assign Super Admin role to default admin user
      const assignRes = await db.query("SELECT * FROM user_role_assignments WHERE user_id = ? AND role_id = ?", [adminId, 'role_super_admin']);
      if (assignRes.rowCount === 0) {
        await db.query(`
          INSERT INTO user_role_assignments (id, user_id, role_id, assigned_by)
          VALUES (?, ?, ?, ?)
        `, [uuidv4(), adminId, 'role_super_admin', 'system']);
        console.log(`âœ… Assigned Super Admin role to ${adminUsername}`);
      }

      // Seed default withdrawal limits for merchants
      const limitRes = await db.query("SELECT * FROM withdrawal_limits WHERE entity_type = ? AND limit_type = ?", ['merchant', 'daily_limit']);
      if (limitRes.rowCount === 0) {
        await db.query(`
          INSERT INTO withdrawal_limits (id, merchant_id, entity_type, limit_type, limit_amount, currency, period_type, period_start, period_end)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 day'))
        `, [uuidv4(), 'MRC-1001', 'merchant', 'daily_limit', 100000.00, 'USD', 'daily']);
        console.log(`âœ… Created default withdrawal limit: $100,000/day for MRC-1001`);
      }
    }

    // Seed Merchant Settings and Terminal unless SKIP_SEED is set
    if (!skipSeed) {
      const settingsRes = await db.query("SELECT * FROM merchant_settings WHERE merchant_id = ?", ["MRC-1001"]);
      if (settingsRes.rowCount === 0) {
        await db.query(`
          INSERT INTO merchant_settings (merchant_id, api_key, webhook_url, test_mode, merchant_name, support_email)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          "MRC-1001",
          "offline_secret_001",
          "",
          0,
          "Default Store",
          "support@example.com"
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
      console.log('SKIP_SEED is set â€” skipping merchant and terminal default seeding');
    }

    // Customers Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        merchant_id TEXT,
        created_by_admin_user_id TEXT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        -- KYC / Identity fields (for transaction verification)
        id_type        TEXT,           -- PASSPORT | NATIONAL_ID | DRIVING_LICENSE | RESIDENT_ID
        id_number      TEXT,           -- document number
        id_expiry      TEXT,           -- YYYY-MM-DD
        id_country     TEXT,           -- issuing country (ISO-2)
        date_of_birth  TEXT,           -- YYYY-MM-DD
        nationality    TEXT,           -- ISO-2 country code
        address_line1  TEXT,
        address_line2  TEXT,
        city           TEXT,
        country        TEXT,
        postal_code    TEXT,
        occupation     TEXT,
        kyc_status     TEXT DEFAULT 'PENDING',  -- PENDING | VERIFIED | REJECTED
        kyc_verified_at TEXT,
        risk_level     TEXT DEFAULT 'LOW',      -- LOW | MEDIUM | HIGH
        notes          TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // â”€â”€ KYC migration â€” safely add columns if the table already exists â”€â”€â”€â”€â”€â”€â”€â”€
    const kycCols = [
      ['id_type',         'TEXT'],
      ['id_number',       'TEXT'],
      ['id_expiry',       'TEXT'],
      ['id_country',      'TEXT'],
      ['date_of_birth',   'TEXT'],
      ['nationality',     'TEXT'],
      ['address_line1',   'TEXT'],
      ['address_line2',   'TEXT'],
      ['city',            'TEXT'],
      ['country',         'TEXT'],
      ['postal_code',     'TEXT'],
      ['occupation',      'TEXT'],
      ['kyc_status',      "TEXT DEFAULT 'PENDING'"],
      ['kyc_verified_at', 'TEXT'],
      ['risk_level',      "TEXT DEFAULT 'LOW'"],
      ['notes',           'TEXT'],
    ] as const;
    for (const [col, def] of kycCols) {
      try {
        await db.query(`ALTER TABLE customers ADD COLUMN ${col} ${def}`);
      } catch { /* column already exists â€” ignore */ }
    }

    // Customer merchant ownership isolation
    try {
      await db.query(`ALTER TABLE customers ADD COLUMN merchant_id TEXT`);
    } catch { /* column already exists */ }
    try {
      await db.query(`ALTER TABLE customers ADD COLUMN created_by_admin_user_id TEXT`);
    } catch { /* column already exists */ }
    try {
      await db.query(`CREATE INDEX IF NOT EXISTS idx_customers_merchant ON customers(merchant_id)`);
    } catch { /* ignore */ }

    // Customer Wallets Table â€” one wallet per (customer, currency) so AED stays AED, USD stays USD
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_wallets (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0.00,
        currency TEXT DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'active',
        wallet_code TEXT,
        card_id TEXT,
        offline_balance REAL NOT NULL DEFAULT 0,
        offline_limit REAL NOT NULL DEFAULT 0,
        card_mac_secret TEXT,
        card_issued_at TEXT,
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

    // Merchant Wallets Table â€” one wallet per (merchant, currency)
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallets (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0.00,
        currency TEXT DEFAULT 'USD',
        card_id TEXT,
        card_mac_secret TEXT,
        card_issued_at TEXT,
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

    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallet_transaction_voids (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        merchant_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        original_record TEXT NOT NULL,
        voided_at TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_wallet_transaction_voids (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount REAL NOT NULL,
        reason TEXT NOT NULL,
        original_record TEXT NOT NULL,
        voided_at TEXT NOT NULL
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
    try {
      await db.query(`ALTER TABLE crypto_transactions ADD COLUMN binance_order_id TEXT`);
    } catch (_) { /* ignore exists */ }
    try {
      await db.query(`ALTER TABLE crypto_transactions ADD COLUMN fills_json TEXT`);
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
    } catch (_) { /* column exists â€” ignore */ }

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
        recipient_address TEXT,
        currency TEXT DEFAULT 'USD',
        is_default INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Merchant Payouts Table (merchant wallet â†’ external bank)
    //   Tracks manual merchant payout requests (NO AUTO TRANSFER - admin approves manually)
    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_payouts (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        bank_account TEXT,
        destination TEXT,
        status TEXT DEFAULT 'PENDING_APPROVAL',
        provider TEXT DEFAULT 'manual_bank',
        provider_reference TEXT,
        reference TEXT,
        approved_by TEXT,
        approved_at TEXT,
        meta TEXT,
        error_message TEXT,
        reconciliation_status TEXT,
        reconciliation_note TEXT,
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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // BATCH RECONCILIATION TABLES
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // MERCHANT SETTLEMENT TABLES
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CONFLICT RESOLUTION TABLES
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // AUTHORIZATION ENGINE TABLES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SECURITY TABLES - FOR REAL FUNDS PROTECTION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // AUDIT TRAIL TABLES
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ENHANCED CRYPTO WALLET TABLES (v2)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // Customer Crypto Withdrawals â€” on-chain send records for customer self-serve withdrawals
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

    // Merchant Crypto Withdrawals â€” on-chain send records for merchant payout router
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UNIFIED PAYOUT ENGINE TABLES (HLD Phase 1)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Unified Payouts Table â€” replaces scattered merchant_payouts, mt103_payouts, vault_sepa_transfers
    // Status model: PENDING â†’ QUEUED â†’ EXECUTING â†’ SENT â†’ CONFIRMED | FAILED
    await db.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        source_account_id TEXT NOT NULL,
        destination_type TEXT NOT NULL DEFAULT 'bank',
        destination_bank TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        purpose TEXT,
        internal_reference TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'MT103',
        uetr TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        external_reference TEXT,
        merchant_id TEXT,
        metadata TEXT,
        generated_payload TEXT,
        payload_format TEXT,
        error_code TEXT,
        error_message TEXT,
        sent_at TEXT,
        confirmed_at TEXT,
        failed_at TEXT,
        linked_ledger_transaction_id TEXT,
        linked_vault_transfer_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payouts_channel ON payouts(channel)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payouts_merchant ON payouts(merchant_id)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payouts_uetr ON payouts(uetr)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_payouts_internal_ref ON payouts(internal_reference)`); } catch(_) {}

    // Payout Idempotency â€” server-side cache for Idempotency-Key header
    await db.query(`
      CREATE TABLE IF NOT EXISTS payout_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        payout_id TEXT NOT NULL,
        response_snapshot TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Canonical processor vault dashboard read models. Existing operational
    // tables are backfilled below so the dashboard has one stable contract.
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_ledger (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL,
        merchant_id TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        reference TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING'
        ,meta TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS batch_settlement (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'PENDING',
        settlement_ref TEXT,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS payout_instructions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        bank_name TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        provider_ref TEXT,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_incoming_receipts (
        provider_transaction_id TEXT PRIMARY KEY,
        reference TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        allocation_status TEXT NOT NULL,
        merchant_id TEXT,
        payload_sha256 TEXT NOT NULL,
        received_at TEXT NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS offline_txns (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS stored_txns (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_reserve (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        merchant_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        release_ts TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        reference TEXT,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        meta TEXT NOT NULL DEFAULT '{}'
      )
    `);
    for (const sql of [
      `ALTER TABLE vault_reserve ADD COLUMN merchant_id TEXT`,
      `ALTER TABLE vault_reserve ADD COLUMN reason TEXT`,
      `ALTER TABLE vault_reserve ADD COLUMN release_ts TEXT`,
    ]) {
      try { await db.query(sql); } catch (_) { /* already present */ }
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_reconciliation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        vault_balance REAL NOT NULL,
        expected REAL NOT NULL,
        difference REAL NOT NULL,
        merchant_liabilities REAL NOT NULL,
        pending_settlement REAL NOT NULL,
        pending_payouts REAL NOT NULL,
        reserve REAL NOT NULL,
        adjustments REAL NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_liquidity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        currency TEXT NOT NULL,
        vault_balance REAL NOT NULL,
        reserve REAL NOT NULL,
        pending_payouts REAL NOT NULL,
        risk_buffer REAL NOT NULL,
        liquidity REAL NOT NULL,
        status TEXT NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_audit_trail (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        merchant_id TEXT,
        amount REAL,
        currency TEXT,
        reference TEXT,
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        meta_json TEXT NOT NULL DEFAULT '{}',
        hash TEXT NOT NULL UNIQUE,
        prev_hash TEXT
      )
    `);
    // Keep the canonical dashboard models populated from the existing POS
    // tables without duplicating rows on subsequent startups.
    try {
      await db.query(`
        INSERT OR IGNORE INTO batch_settlement
          (id, batch_id, merchant_id, amount, currency, status, settlement_ref, ts)
        SELECT 'batch:' || b.id, b.batch_id, b.merchant_id,
               COALESCE(SUM(t.amount_minor), 0) / 100.0,
               COALESCE(MAX(t.currency), 'USD'),
               CASE WHEN LOWER(b.status) = 'settled' THEN 'SETTLED'
                    WHEN LOWER(b.status) IN ('declined', 'failed', 'capture_failed') THEN 'FAILED'
                    ELSE 'PENDING' END,
               COALESCE(b.settlement_code, b.batch_id),
               COALESCE(b.processed_at, b.upload_timestamp, b.created_at)
          FROM pos2013_batches b
          LEFT JOIN pos2013_transactions t ON t.batch_id = b.batch_id
         GROUP BY b.id, b.batch_id, b.merchant_id, b.status, b.settlement_code,
                  b.processed_at, b.upload_timestamp, b.created_at
      `);
      await db.query(`
        UPDATE batch_settlement
          SET status = 'PENDING'
         WHERE UPPER(status) = 'SETTLED'
          AND EXISTS (
            SELECT 1
              FROM pos2013_batches b
             WHERE b.batch_id = batch_settlement.batch_id
               AND b.merchant_id = batch_settlement.merchant_id
               AND UPPER(b.status) IN ('RECEIVED', 'PENDING', 'UPLOADED', 'EXPORTED', 'PROCESSED', 'PARTIAL')
          )
          AND NOT EXISTS (
            SELECT 1
              FROM bank_incoming_receipts r
             WHERE UPPER(r.allocation_status) = 'ALLOCATED'
               AND r.merchant_id = batch_settlement.merchant_id
               AND UPPER(r.currency) = UPPER(batch_settlement.currency)
               AND ABS(r.amount - batch_settlement.amount) < 0.000001
               AND (r.reference = batch_settlement.settlement_ref OR r.reference = batch_settlement.batch_id)
          )
      `);
      await db.query(`
        INSERT OR IGNORE INTO payout_instructions
          (id, merchant_id, amount, currency, bank_name, status, provider_ref, ts)
        SELECT p.id, p.merchant_id, p.amount, p.currency,
               COALESCE(JSON_EXTRACT(p.destination_bank, '$.bank_name'), ''),
               CASE p.status
                 WHEN 'PENDING' THEN 'QUEUED'
                 WHEN 'QUEUED' THEN 'QUEUED'
                 WHEN 'EXECUTING' THEN 'PROCESSING'
                 WHEN 'SENT' THEN 'PROCESSING'
                 WHEN 'CONFIRMED' THEN 'COMPLETED'
                 ELSE p.status END,
               p.external_reference, p.created_at
          FROM payouts p
      `);
      await db.query(`
        INSERT OR IGNORE INTO offline_txns (id, merchant_id, amount, currency, ts)
        SELECT id, merchant_id, amount_minor / 100.0, currency, COALESCE(txn_timestamp, created_at)
          FROM pos2013_transactions
         WHERE UPPER(status) IN ('OFFLINE_APPROVED', 'OFFLINE', 'PENDING')
      `);
      await db.query(`
        INSERT OR IGNORE INTO stored_txns (id, merchant_id, amount, currency, ts)
        SELECT id, merchant_id, amount_minor / 100.0, currency, COALESCE(txn_timestamp, created_at)
          FROM pos2013_transactions
         WHERE UPPER(status) = 'STORED'
      `);
      await db.query(`
        INSERT OR IGNORE INTO vault_ledger
          (id, ts, type, merchant_id, amount, currency, reference, status)
        SELECT 'settlement:' || id, COALESCE(created_at, CURRENT_TIMESTAMP),
               'VAULT_TO_MERCHANT', merchant_id, -ABS(amount), currency,
               COALESCE(ledger_entry_id, id),
               CASE WHEN LOWER(status) IN ('settled', 'completed') THEN 'COMPLETED'
                    WHEN LOWER(status) IN ('failed', 'reversed', 'chargeback') THEN 'FAILED'
                    ELSE 'PENDING' END
          FROM merchant_pos_settlements
        UNION ALL
        SELECT 'payout:' || id, COALESCE(created_at, CURRENT_TIMESTAMP),
               'VAULT_TO_BANK', merchant_id, -ABS(amount), currency,
               COALESCE(external_reference, id),
               CASE WHEN status IN ('CONFIRMED', 'SENT') THEN 'COMPLETED'
                    WHEN status = 'FAILED' THEN 'FAILED'
                    ELSE 'PENDING' END
          FROM payouts
        UNION ALL
        SELECT 'batch:' || id, COALESCE(ts, CURRENT_TIMESTAMP),
               'BATCH_TO_VAULT', merchant_id, ABS(amount), currency,
               COALESCE(settlement_ref, batch_id),
               CASE WHEN status = 'SETTLED' THEN 'COMPLETED'
                    WHEN status = 'FAILED' THEN 'FAILED'
                    ELSE 'PENDING' END
          FROM batch_settlement
      `);
    } catch (e) {
      console.error('[DB] Vault dashboard backfill skipped:', e);
    }

    // Ledger Transactions â€” parent table grouping double-entry ledger_entries (balanced to 0)
    await db.query(`
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        reference TEXT,
        merchant_id TEXT,
        linked_payout_id TEXT,
        linked_batch_id TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ledgertx_type ON ledger_transactions(type)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ledgertx_status ON ledger_transactions(status)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ledgertx_ref ON ledger_transactions(reference)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ledgertx_payout ON ledger_transactions(linked_payout_id)`); } catch(_) {}

    // Account Codes â€” map vault account ids + logical accounts to ledger codes
    await db.query(`
      CREATE TABLE IF NOT EXISTS account_codes (
        account_code TEXT PRIMARY KEY,
        account_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        vault_account_id TEXT,
        merchant_id TEXT,
        currency TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed standard account codes (forensic double-entry baseline)
    try {
      const codes = [
        ['PROC_SETTLEMENT_EUR', 'vault', 'Processor Settlement Vault (EUR)', 'PROC-VAULT-EUR-001', null, 'EUR'],
        ['PROC_SETTLEMENT_USD', 'vault', 'Processor Settlement Vault (USD)', 'PROC-VAULT-USD-002', null, 'USD'],
        ['PROC_CARD_CLEARING_EUR', 'clearing', 'Processor Card Clearing (EUR)', null, null, 'EUR'],
        ['PROC_CARD_CLEARING_USD', 'clearing', 'Processor Card Clearing (USD)', null, null, 'USD'],
        ['FEES_INCOME', 'income', 'Processing Fees Income', null, null, null],
        ['MRC_1001_WALLET_USD', 'merchant', 'Merchant MRC-1001 Wallet (USD)', null, 'MRC-1001', 'USD'],
        ['MRC_1001_WALLET_EUR', 'merchant', 'Merchant MRC-1001 Wallet (EUR)', null, 'MRC-1001', 'EUR'],
      ];
      for (const [code, type, name, vault_id, merchant_id, ccy] of codes) {
        const chk = await db.query(`SELECT COUNT(*) c FROM account_codes WHERE account_code = ?`, [code]);
        if ((chk.rows?.[0]?.c || 0) === 0) {
          await db.query(
            `INSERT INTO account_codes (account_code, account_type, display_name, vault_account_id, merchant_id, currency) VALUES (?,?,?,?,?,?)`,
            [code, type, name, vault_id, merchant_id, ccy]
          );
        }
      }
    } catch (_) { /* seed race-safe */ }

    // Migration: add account_code column to existing ledger_entries if missing
    try {
      const pragma = await db.query(`PRAGMA table_info("ledger_entries")`);
      const has = (pragma?.rows || []).some((r: any) => String(r.name || '').toLowerCase() === 'account_code');
      if (!has) {
        await db.query(`ALTER TABLE ledger_entries ADD COLUMN account_code TEXT`);
      }
    } catch (_) { /* ignore */ }

    // Migration: add transaction_id FK back-reference from ledger_entries â†’ ledger_transactions
    // (already exists â€” no-op, but ensure ledger_transaction_id column for explicit link)
    try {
      const pragma = await db.query(`PRAGMA table_info("ledger_entries")`);
      const has = (pragma?.rows || []).some((r: any) => String(r.name || '').toLowerCase() === 'ledger_transaction_id');
      if (!has) {
        await db.query(`ALTER TABLE ledger_entries ADD COLUMN ledger_transaction_id TEXT`);
      }
    } catch (_) { /* ignore */ }

    // Migration: extend vault_accounts with type + meta if missing
    try {
      const pragma = await db.query(`PRAGMA table_info("vault_accounts")`);
      const colNames = new Set((pragma?.rows || []).map((r: any) => String(r.name || '').toLowerCase()));
      if (!colNames.has('owner_id')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN owner_id TEXT`);
      if (!colNames.has('type')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN type TEXT DEFAULT 'processor'`);
      if (!colNames.has('status')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN status TEXT DEFAULT 'ACTIVE'`);
      if (!colNames.has('available_balance')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN available_balance REAL NOT NULL DEFAULT 0`);
      if (!colNames.has('pending_settlement')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN pending_settlement REAL NOT NULL DEFAULT 0`);
      if (!colNames.has('risk_hold')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN risk_hold REAL NOT NULL DEFAULT 0`);
      if (!colNames.has('payout_in_progress')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN payout_in_progress REAL NOT NULL DEFAULT 0`);
      if (!colNames.has('meta')) await db.query(`ALTER TABLE vault_accounts ADD COLUMN meta TEXT`);
      await db.query(`UPDATE vault_accounts SET available_balance = balance WHERE available_balance = 0 AND balance != 0`);
    } catch (_) { /* ignore */ }
    await db.query(
      `UPDATE vault_accounts
          SET balance = 0, available_balance = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND currency = 'USD'
          AND bic = ?
          AND iban = ?
          AND balance = ?
          AND available_balance = ?`,
      [
        'PROC-VAULT-USD-002',
        'PROCESSOR_BIC_PLACEHOLDER',
        'PROCESSOR_IBAN_PLACEHOLDER',
        6499.5,
        1999.5,
      ],
    );

    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        counter_account_id TEXT,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'POSTED',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);
    // Keep known smoke-test payouts for audit, but exclude them from posted balances.
    await db.query(
      `UPDATE vault_entries
          SET status = 'VOIDED'
        WHERE account_id = ?
          AND currency = 'USD'
          AND direction = 'debit'
          AND amount = ?
          AND source IN ('vault_card_payout', 'vault_card_payout_settled')
          AND status = 'POSTED'
          AND metadata LIKE ?
          AND metadata LIKE ?`,
      [
        'PROC-VAULT-USD-002',
        0.25,
        '%"merchant_id":"SMOKE-TEST-MID"%',
        '%"vault_card_id":"329eadbd-51fd-45cd-990f-f20d420cee80"%',
      ],
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_payout_requests (
        id TEXT PRIMARY KEY,
        from_account_id TEXT NOT NULL,
        beneficiary_snapshot TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING',
        bank_instruction TEXT,
        external_reference TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_events (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        payout_id TEXT,
        event_type TEXT NOT NULL,
        amount REAL,
        currency TEXT,
        reference TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_cards (
        id              TEXT PRIMARY KEY,
        vault_account_id TEXT NOT NULL,
        bin             TEXT NOT NULL,
        card_number     TEXT NOT NULL,
        last4           TEXT NOT NULL,
        scheme          TEXT NOT NULL,
        product         TEXT NOT NULL,
        country         TEXT NOT NULL,
        expiry          TEXT NOT NULL,
        cvv             TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_vault_cards_account ON vault_cards(vault_account_id)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_vault_cards_status ON vault_cards(status)`); } catch(_) {}
    try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_cards_number ON vault_cards(card_number)`); } catch(_) {}

    // Migration: extend vault_beneficiaries with type + address_json + metadata if missing
    try {
      const pragma = await db.query(`PRAGMA table_info("vault_beneficiaries")`);
      const colNames = new Set((pragma?.rows || []).map((r: any) => String(r.name || '').toLowerCase()));
      if (!colNames.has('type')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN type TEXT DEFAULT 'corporate'`);
      if (!colNames.has('address_json')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN address_json TEXT`);
      if (!colNames.has('metadata')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN metadata TEXT`);
      if (!colNames.has('account_number')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN account_number TEXT`);
      if (!colNames.has('routing_number')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN routing_number TEXT`);
      if (!colNames.has('account_type')) await db.query(`ALTER TABLE vault_beneficiaries ADD COLUMN account_type TEXT`);
    } catch (_) { /* ignore */ }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CORE PAYOUTS API TABLES (spec-aligned standalone tables)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    await db.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            TEXT PRIMARY KEY,
        currency      TEXT NOT NULL,
        bic           TEXT,
        iban          TEXT,
        bank_name     TEXT,
        balance       REAL NOT NULL DEFAULT 0,
        meta          TEXT NULL
      );
    `);
    await db.query(
      `UPDATE accounts
          SET balance = 0
        WHERE ((id = ? AND currency = 'EUR') OR (id = ? AND currency = 'USD'))
          AND bic = ?
          AND iban = ?
          AND meta LIKE ?
          AND balance <> 0`,
      [
        'PROC-VAULT-EUR-001',
        'PROC-VAULT-USD-002',
        'PROCESSOR_BIC_PLACEHOLDER',
        'PROCESSOR_IBAN_PLACEHOLDER',
        '%"seeded":true%',
      ],
    );

    await db.query(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL,
        bank_swift_bic TEXT NOT NULL,
        bank_account_number TEXT NOT NULL,
        bank_country  TEXT NOT NULL,
        address_line1 TEXT,
        address_city  TEXT,
        address_postal_code TEXT,
        address_country TEXT,
        metadata      TEXT NULL,
        created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS core_payouts (
        id                TEXT PRIMARY KEY,
        source_account_id TEXT NOT NULL,
        beneficiary_id    TEXT NOT NULL,
        destination_type  TEXT NOT NULL,
        amount            REAL NOT NULL,
        currency          TEXT NOT NULL,
        purpose           TEXT,
        internal_reference TEXT,
        channel           TEXT NOT NULL,
        status            TEXT NOT NULL,
        uetr              TEXT,
        external_reference TEXT,
        created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at           TEXT NULL,
        confirmed_at      TEXT NULL,
        metadata          TEXT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS core_payout_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        request_hash    TEXT NOT NULL,
        payout_id       TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // WALLET VIRTUAL CARDS (Luhn-valid Visa / Mastercard PANs)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    await db.query(`
      CREATE TABLE IF NOT EXISTS wallet_cards (
        id              TEXT PRIMARY KEY,
        customer_id     TEXT NOT NULL,
        wallet_id       TEXT,
        scheme          TEXT NOT NULL DEFAULT 'VISA',
        bin             TEXT NOT NULL,
        last4           TEXT NOT NULL,
        card_number     TEXT NOT NULL,
        expiry_month    TEXT NOT NULL,
        expiry_year     TEXT NOT NULL,
        cvv             TEXT NOT NULL,
        cardholder_name TEXT,
        currency        TEXT NOT NULL DEFAULT 'USD',
        status          TEXT NOT NULL DEFAULT 'ACTIVE',
        spending_limit  REAL DEFAULT 0,
        used_amount     REAL DEFAULT 0,
        pan_encrypted   TEXT,
        pan_kid         TEXT,
        meta_json       TEXT,
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        activated_at    TEXT,
        deactivated_at  TEXT
      );
    `);
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_cards_customer ON wallet_cards(customer_id, status)`); } catch(_) {}
    try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_cards_pan ON wallet_cards(card_number)`); } catch(_) {}
    try { await db.query(`CREATE INDEX IF NOT EXISTS idx_wallet_cards_wallet ON wallet_cards(wallet_id)`); } catch(_) {}

    console.log("Tables initialized successfully (SQLite)");
  } catch (error) {
    console.error("Error initializing tables:", error);
  }
};