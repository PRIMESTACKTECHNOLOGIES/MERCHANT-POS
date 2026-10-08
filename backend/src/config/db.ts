// Load .env FIRST — db.ts constructor runs at import time, before server.ts dotenv.config()
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * db.ts — sql.js adapter (pure WebAssembly, zero native binaries)
 *
 * sql.js loads a WASM SQLite into memory. On startup we:
 *   1. Load the WASM module
 *   2. Read the existing .sqlite file into a Buffer (if it exists)
 *   3. Open the DB from that Buffer (or create empty)
 *   4. After every write we flush the in-memory DB back to disk
 *
 * This approach has no native .node bindings — works on any CPU/OS/kernel.
 * The only tradeoff vs better-sqlite3: the entire DB lives in RAM.
 * For a POS system with a few thousand rows this is perfectly fine.
 */

const BACKEND_ROOT = path.join(__dirname, '../..');
// Render mounts its persistent data disk at DATABASE_PATH; local runs keep the default path.
const configuredDbPath = process.env.DATABASE_PATH?.trim();
const DB_PATH = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(BACKEND_ROOT, 'data', 'database.sqlite');

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

console.log('[DB] Connected:', DB_PATH);

// ── Helpers ──────────────────────────────────────────────────────────────────

const columnExists = (pragmaRows: any[], colName: string) => {
  const n = colName.toLowerCase();
  return pragmaRows.some((r: any) => String(r.name || '').toLowerCase() === n);
};

const extractColumnName = (colDef: string) => colDef.trim().split(/\s+/)[0].trim();

// ── sql.js singleton ─────────────────────────────────────────────────────────

let _db: any = null;          // sql.js Database instance
let _dirty = false;            // true when writes need flushing to disk
let _flushTimer: any = null;   // debounce timer for disk flush
let _flushCount = 0;           // count writes between flushes

/** Persist in-memory DB to disk — flush immediately on every write to prevent data loss */
function schedulePersist() {
  _dirty = true;
  _flushCount++;

  // Always flush immediately — never debounce on Render where process can be killed anytime
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }

  if (_db) {
    try {
      const data: Uint8Array = _db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      _dirty = false;
    } catch (e) {
      console.error('[DB] Flush error:', e);
      // Retry once after 100ms
      _flushTimer = setTimeout(() => {
        _flushTimer = null;
        if (_dirty && _db) {
          try {
            const data: Uint8Array = _db.export();
            fs.writeFileSync(DB_PATH, Buffer.from(data));
            _dirty = false;
          } catch (e2) {
            console.error('[DB] Flush retry error:', e2);
          }
        }
      }, 100);
    }
  }
}

/** Flush immediately (called on graceful shutdown) */
export function flushDb() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_dirty && _db) {
    try {
      const data: Uint8Array = _db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      _dirty = false;
    } catch (e) {
      console.error('[DB] Flush error on shutdown:', e);
    }
  }
}

/** Lazily initialise sql.js and open/create the database */
async function getDb(): Promise<any> {
  if (_db) return _db;

  // Dynamic import — sql.js ships its own WASM file
  const initSqlJs = (await import('sql.js')).default;

  // Point sql.js at its own WASM file inside node_modules
  const wasmPath = path.join(
    BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'
  );

  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  // Open existing file or create fresh
  // FORCE_DB_RESET=1 deletes the old file so all tables rebuild correctly
  if (process.env.FORCE_DB_RESET === '1' && fs.existsSync(DB_PATH)) {
    console.warn('[DB] FORCE_DB_RESET=1 — deleting old database and rebuilding from scratch');
    fs.unlinkSync(DB_PATH);
  }

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  // Enable WAL-equivalent pragmas
  _db.run('PRAGMA journal_mode = MEMORY;');
  _db.run('PRAGMA foreign_keys = ON;');
  _db.run('PRAGMA synchronous = NORMAL;');

  // ── Runtime schema guarantees ─────────────────────────────────────────────
  // These tables MUST exist before any query runs — created here as a safety net
  // in case initTables() hasn't run yet (e.g. first boot on Render).
  _db.run(`CREATE TABLE IF NOT EXISTS merchant_wallets (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS merchant_wallet_transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    source TEXT,
    reference TEXT,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customer_wallets (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT,
    customer_id TEXT,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    source TEXT,
    reference TEXT,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customer_crypto_wallets (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    crypto_coin TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'mainnet',
    balance REAL NOT NULL DEFAULT 0,
    crypto_address TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, crypto_coin)
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customer_crypto_withdrawals (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    coin TEXT NOT NULL,
    network TEXT NOT NULL,
    amount REAL NOT NULL,
    address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS transak_webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    event_name TEXT,
    order_id TEXT,
    status TEXT,
    verified INTEGER DEFAULT 0,
    raw_payload TEXT,
    signature TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    created_by_admin_user_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    wallet_code TEXT,
    id_type TEXT,
    id_number TEXT,
    id_expiry TEXT,
    id_country TEXT,
    date_of_birth TEXT,
    nationality TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    country TEXT,
    postal_code TEXT,
    occupation TEXT,
    kyc_status TEXT DEFAULT 'PENDING',
    kyc_verified_at TEXT,
    risk_level TEXT DEFAULT 'LOW',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS omnibus_accounts (
    account_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT 'VAULT BANK OMNIBUS',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, currency)
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    country TEXT,
    timezone TEXT,
    company_name TEXT,
    avatar_url TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    theme_preference TEXT DEFAULT 'light',
    language_preference TEXT DEFAULT 'en',
    api_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    last_active TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS user_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    permissions TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS user_role_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    expires_at TEXT,
    UNIQUE(user_id, role_id)
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS merchant_wallet_transaction_voids (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT,
    voided_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customer_crypto_withdrawals (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    wallet_id TEXT,
    coin TEXT NOT NULL,
    network TEXT NOT NULL,
    amount REAL NOT NULL,
    to_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    fee REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  // ── Missing tables: created at startup so no query ever fails ────────────────
  for (const _tbl of [
    `CREATE TABLE IF NOT EXISTS crypto_transactions (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, crypto_coin TEXT NOT NULL, transaction_type TEXT NOT NULL DEFAULT 'buy', fiat_amount REAL NOT NULL DEFAULT 0, crypto_amount REAL NOT NULL DEFAULT 0, fiat_currency TEXT NOT NULL DEFAULT 'USD', exchange_rate REAL NOT NULL DEFAULT 0, source TEXT, provider_mode TEXT, status TEXT NOT NULL DEFAULT 'completed', reference TEXT, tx_hash TEXT, is_mock INTEGER DEFAULT 0, meta TEXT, binance_order_id TEXT, fills_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS wallet_transfers (id TEXT PRIMARY KEY, sender_customer_id TEXT NOT NULL, receiver_customer_id TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', note TEXT, status TEXT NOT NULL DEFAULT 'COMPLETED', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bank_accounts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, bank_name TEXT, account_holder TEXT, account_number TEXT, routing_number TEXT, iban TEXT, swift_code TEXT, currency TEXT DEFAULT 'USD', is_default INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bank_payouts (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, bank_account_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'PENDING', reference TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_bank_accounts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, bank_name TEXT, account_holder TEXT, account_number TEXT, routing_number TEXT, iban TEXT, swift_code TEXT, currency TEXT DEFAULT 'USD', is_default INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_payouts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, bank_account_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'PENDING', reference TEXT, approved_by TEXT, rejected_by TEXT, rejection_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS hot_wallet_transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, coin TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'mainnet', amount REAL NOT NULL, from_address TEXT, to_address TEXT, tx_hash TEXT, status TEXT NOT NULL DEFAULT 'COMPLETED', reference TEXT, merchant_id TEXT, customer_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_crypto_wallets (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, coin TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'mainnet', balance REAL NOT NULL DEFAULT 0, address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(merchant_id, coin))`,
    `CREATE TABLE IF NOT EXISTS merchant_settings (merchant_id TEXT PRIMARY KEY, api_key TEXT, webhook_url TEXT, test_mode INTEGER DEFAULT 0, merchant_name TEXT, support_email TEXT, features TEXT, extended_settings TEXT, payment_config TEXT, license_number TEXT, tax_id TEXT, merchant_address TEXT, merchant_phone TEXT, bank_name TEXT, bank_account_holder TEXT, bank_account_number TEXT, bank_routing_number TEXT, bank_iban TEXT, bank_swift_code TEXT, usdt_address_tron TEXT, usdt_address_bsc TEXT, usdt_address_polygon TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS virtual_accounts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, customer_id TEXT, currency TEXT NOT NULL DEFAULT 'USD', account_number TEXT, routing_number TEXT, iban TEXT, reference TEXT, provider TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  ]) { try { _db.run(_tbl); } catch (_e) {} }
  _db.run(`CREATE TABLE IF NOT EXISTS vault_reserve (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    reason TEXT,
    release_ts TEXT,
    status TEXT NOT NULL DEFAULT 'HELD',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS pos2013_transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    customer_id TEXT,
    terminal_id TEXT,
    batch_id TEXT NOT NULL DEFAULT '',
    local_txn_id TEXT,
    stan TEXT,
    rrn TEXT,
    amount_minor INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    pan_masked TEXT,
    txn_type TEXT,
    auth_mode TEXT,
    entry_mode TEXT,
    auth_code TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    txn_timestamp TEXT,
    decline_reason TEXT,
    emv_data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS customer_wallet_transaction_voids (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT,
    voided_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS pos2013_transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    customer_id TEXT,
    terminal_id TEXT,
    batch_id TEXT NOT NULL DEFAULT '',
    local_txn_id TEXT,
    stan TEXT,
    amount_minor INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    pan_masked TEXT,
    txn_type TEXT,
    auth_mode TEXT,
    entry_mode TEXT,
    auth_code TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    txn_timestamp TEXT,
    decline_reason TEXT,
    emv_data TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS terminals (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL UNIQUE,
    terminal_secret TEXT NOT NULL,
    name TEXT,
    offline_enabled INTEGER DEFAULT 0,
    floor_limit REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  schedulePersist();

  // ── Trigger full initTables in background to create ALL remaining tables ──
  // Removed — server.ts calls initTables() before listen(), which is the correct place.

  const vaultTableStatements = [
    `CREATE TABLE IF NOT EXISTS vault_api_keys (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS vault_api_nonces (
      api_key TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (api_key, nonce)
    )`,
    `CREATE TABLE IF NOT EXISTS vault_payouts (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      bank_account TEXT NOT NULL,
      beneficiary_name TEXT,
      beneficiary_iban TEXT,
      beneficiary_bic TEXT,
      reference TEXT,
      type TEXT,
      fee REAL NOT NULL DEFAULT 0,
      ledger_entry_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
      ,dwolla_transfer_url TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS bank_partner_webhook_events (
      transfer_id TEXT PRIMARY KEY,
      payout_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      code TEXT,
      reason TEXT,
      received_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS fx_rates (
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (from_currency, to_currency)
    )`,
    `CREATE TABLE IF NOT EXISTS pos1011_batches (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      asset TEXT NOT NULL,
      total_amount_minor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      settled_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS pos1011_batch_items (
      batch_id TEXT NOT NULL,
      tx_id TEXT NOT NULL UNIQUE,
      amount_minor INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (batch_id, tx_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pos1011_events (
      id TEXT PRIMARY KEY,
      tx_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_funding_loads (
      id TEXT PRIMARY KEY,
      external_ref TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      psp TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      ledger_transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_offline_transactions (
      id TEXT PRIMARY KEY,
      local_txn_id TEXT NOT NULL UNIQUE,
      card_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      transaction_timestamp TEXT NOT NULL,
      new_offline_balance_minor INTEGER NOT NULL,
      mac TEXT NOT NULL,
      status TEXT NOT NULL,
      ledger_transaction_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS vault_accounts (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      type TEXT NOT NULL DEFAULT 'internal',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      bank_name TEXT NOT NULL DEFAULT 'Protocol 201.3 Settlement Bank',
      bic TEXT,
      iban TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      balance REAL NOT NULL DEFAULT 0,
      reserved_hold REAL DEFAULT 0,
      available_balance REAL NOT NULL DEFAULT 0,
      pending_settlement REAL NOT NULL DEFAULT 0,
      risk_hold REAL NOT NULL DEFAULT 0,
      payout_in_progress REAL NOT NULL DEFAULT 0,
      last_reconciled TEXT,
      created_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS vault_entries (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      counter_account_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
      amount REAL NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL,
      source TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'POSTED',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS vault_payout_requests (
      id TEXT PRIMARY KEY,
      from_account_id TEXT NOT NULL,
      beneficiary_snapshot TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      bank_instruction TEXT,
      external_reference TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS vault_events (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      payout_id TEXT,
      event_type TEXT NOT NULL,
      amount REAL,
      currency TEXT,
      reference TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS vault_beneficiaries (
      id TEXT PRIMARY KEY,
      name TEXT,
      iban TEXT,
      swift TEXT,
      account_number TEXT,
      routing_number TEXT,
      account_type TEXT,
      address TEXT,
      country TEXT,
      currency TEXT DEFAULT 'EUR',
      bank_name TEXT,
      is_archived INTEGER DEFAULT 0,
      created_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS vault_sepa_transfers (
      id TEXT PRIMARY KEY,
      reference TEXT UNIQUE,
      from_account_id TEXT,
      beneficiary_id TEXT,
      beneficiary_snapshot TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'DRAFT',
      uetr TEXT,
      swift_trn TEXT,
      processor_ticket TEXT,
      internal_note TEXT,
      linked_payout_id TEXT,
      execution_date TEXT,
      sent_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      pain001_xml_path TEXT,
      created_at TEXT,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      currency      TEXT NOT NULL,
      bic           TEXT,
      iban          TEXT,
      bank_name     TEXT,
      balance       REAL NOT NULL DEFAULT 0,
      meta          TEXT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS beneficiaries (
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
    )`,
    `CREATE TABLE IF NOT EXISTS core_payouts (
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
    )`,
    `CREATE TABLE IF NOT EXISTS core_payout_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      request_hash    TEXT NOT NULL,
      payout_id       TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS wallet_cards (
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
    )`,
    `CREATE TABLE IF NOT EXISTS card_tokens (
      id              TEXT PRIMARY KEY,
      token           TEXT UNIQUE NOT NULL,
      customer_id     TEXT NOT NULL,
      bin             TEXT NOT NULL,
      last4           TEXT NOT NULL,
      scheme          TEXT NOT NULL,
      product         TEXT NOT NULL,
      country         TEXT NOT NULL,
      encrypted_pan   BLOB NOT NULL,
      expiry          TEXT NOT NULL,
      cvv_hash        TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status          TEXT NOT NULL DEFAULT 'ACTIVE'
    )`,
    `CREATE TABLE IF NOT EXISTS issuer_accounts (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL,
      currency        TEXT NOT NULL,
      balance         REAL NOT NULL DEFAULT 0,
      available       REAL NOT NULL DEFAULT 0,
      credit_limit    REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (customer_id, currency)
    )`,
    `CREATE TABLE IF NOT EXISTS issuer_auth_holds (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL,
      token           TEXT NOT NULL,
      auth_ref        TEXT NOT NULL UNIQUE,
      merchant_id     TEXT NOT NULL,
      amount          REAL NOT NULL,
      captured_amount REAL NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL,
      status          TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS emv_card_state (
      token           TEXT PRIMARY KEY,
      last_atc        INTEGER NOT NULL DEFAULT -1,
      last_arqc       TEXT,
      last_rrn        TEXT,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS vault_cards (
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
    )`,
    `CREATE TABLE IF NOT EXISTS inbound_transaction_registrations (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL DEFAULT '101.1',
      authorization_code TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      beneficiary_name TEXT,
      beneficiary_account TEXT,
      sender_bic TEXT,
      receiver_bic TEXT,
      uetr TEXT,
      deposit_code TEXT,
      cusip TEXT,
      fed_wire_code TEXT,
      swift_mt_type TEXT,
      iso20022_type TEXT,
      settlement_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
      fund_verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      verification_provider TEXT,
      verification_reference TEXT,
      verified_at TEXT,
      merchant_id TEXT,
      customer_id TEXT,
      pan_masked TEXT,
      card_registered INTEGER NOT NULL DEFAULT 0,
      raw_document TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (authorization_code, protocol)
    )`,
    `CREATE TABLE IF NOT EXISTS fund_verification_audits (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      verification_method TEXT NOT NULL,
      request_payload TEXT,
      response_payload TEXT,
      result_status TEXT NOT NULL,
      result_reason TEXT,
      verified_amount REAL,
      verified_currency TEXT,
      external_reference TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (registration_id) REFERENCES inbound_transaction_registrations(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_inbound_tx_reg_auth_code
       ON inbound_transaction_registrations (authorization_code, protocol)`,
    `CREATE INDEX IF NOT EXISTS idx_inbound_tx_reg_status
       ON inbound_transaction_registrations (settlement_status, fund_verification_status)`,
  ];
  for (const sql of vaultTableStatements) {
    try { _db.run(sql); } catch (_) {}
  }
  const NOW_ISO = new Date().toISOString();
  const gatewayApiKey = process.env.VAULT_BANK_API_KEY?.trim();
  const gatewaySecretKey = process.env.VAULT_BANK_SECRET_KEY?.trim();
  if (gatewayApiKey && gatewaySecretKey) {
    try {
      _db.run(
        `INSERT OR IGNORE INTO vault_api_keys
          (id, api_key, secret_key, label, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [require('uuid').v4(), gatewayApiKey, gatewaySecretKey, 'environment vault bank', NOW_ISO],
      );
      // Always ensure the env key is active with the correct secret on every startup
      _db.run(
        `UPDATE vault_api_keys SET active = 1, secret_key = ? WHERE api_key = ?`,
        [gatewaySecretKey, gatewayApiKey],
      );
    } catch (_) {}
  }

  // ── Void the $10M test inbound entry that polluted the vault ledger ─────────
  // This was a voice-auth inbound registration (auth code "770") that was
  // mistakenly credited to the vault as BATCH_TO_VAULT. It is not real funds.
  try {
    _db.run(
      `UPDATE vault_ledger SET status = 'VOIDED'
       WHERE reference = 'voice_muikk3e0' AND amount = 10000000 AND status = 'COMPLETED'`
    );
    // Recompute vault_accounts balance from non-voided BATCH_TO_VAULT entries only
    _db.run(`
      UPDATE vault_accounts
         SET balance          = COALESCE((
               SELECT SUM(CASE WHEN type IN ('VAULT_TO_MERCHANT','VAULT_TO_BANK') THEN -ABS(amount)
                               WHEN type = 'BATCH_TO_VAULT' THEN ABS(amount)
                               ELSE 0 END)
               FROM vault_ledger
               WHERE currency = vault_accounts.currency AND status = 'COMPLETED'
             ), 0),
             available_balance = COALESCE((
               SELECT SUM(CASE WHEN type IN ('VAULT_TO_MERCHANT','VAULT_TO_BANK') THEN -ABS(amount)
                               WHEN type = 'BATCH_TO_VAULT' THEN ABS(amount)
                               ELSE 0 END)
               FROM vault_ledger
               WHERE currency = vault_accounts.currency AND status = 'COMPLETED'
             ), 0),
             updated_at = ?
       WHERE id IN ('PROC-VAULT-USD-002','PROC-VAULT-EUR-001','VAULT-WISE-EUR-001')
    `, [NOW_ISO]);
  } catch (_) {}

  // Clear only the exact legacy placeholder seeds; leave all ledger-derived balances untouched.
  _db.run(
    `UPDATE vault_accounts
        SET balance = 0
      WHERE ((id = ? AND currency = 'EUR' AND balance = ?)
          OR (id = ? AND currency = 'USD' AND balance = ?))
        AND bic = ?
        AND iban = ?`,
    [
      'PROC-VAULT-EUR-001',
      510000000,
      'PROC-VAULT-USD-002',
      4998363,
      'PROCESSOR_BIC_PLACEHOLDER',
      'PROCESSOR_IBAN_PLACEHOLDER',
    ],
  );
  _db.run(
    `UPDATE vault_accounts
        SET balance = 0, available_balance = 0
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

  const guarantees: Array<[string, string]> = [
    ['vault_payouts',             'idempotency_key TEXT'],
    ['vault_payouts',             'bank_account TEXT'],
    ['vault_payouts',             'beneficiary_name TEXT'],
    ['vault_payouts',             'beneficiary_iban TEXT'],
    ['vault_payouts',             'beneficiary_bic TEXT'],
    ['vault_payouts',             'reference TEXT'],
    ['vault_payouts',             'type TEXT'],
    ['vault_payouts',             'fee REAL NOT NULL DEFAULT 0'],
    ['vault_payouts',             'ledger_entry_id TEXT'],
    ['vault_payouts',             'updated_at TEXT'],
    ['customer_wallets',           'wallet_code TEXT'],
    ['merchant_pos_settlements',   'settled_at TEXT'],
    ['merchant_crypto_withdrawals','network TEXT'],
    ['crypto_transactions',        'provider_mode TEXT'],
    ['pos2013_transactions',       'updated_at TEXT DEFAULT CURRENT_TIMESTAMP'],
    ['pos2013_transactions',       'settled_at TEXT'],
    ['pos2013_transactions',       'processor_reference TEXT'],
    ['pos2013_transactions',       'auth_code_ref2 TEXT'],
    ['pos2013_transactions',       'webhook_trace TEXT'],
    ['pos2013_transactions',       'card_brand TEXT'],
    ['pos2013_transactions',       'reader_source TEXT'],
    ['pos2013_transactions',       'cvm_result TEXT'],
    ['pos2013_transactions',       'pin_verified INTEGER DEFAULT 0'],
    ['merchant_payouts',           'updated_at TEXT DEFAULT CURRENT_TIMESTAMP'],
    ['merchant_payouts',           'provider_reference TEXT'],
    ['merchant_payouts',           'meta TEXT'],
    ['merchant_payouts',           'transaction_id TEXT'],
    ['merchant_payouts',           'settled_at TEXT'],
    ['merchant_wallets',            'dwolla_customer_url TEXT'],
    ['merchant_wallets',            'dwolla_funding_source_url TEXT'],
    ['vault_payouts',               'dwolla_transfer_url TEXT'],
    ['vault_payouts',               'bank_return_code TEXT'],
    ['vault_payouts',               'bank_return_reason TEXT'],
    ['pos2013_transactions',       'decline_reason TEXT'],
    ['pos2013_transactions',       'customer_id TEXT'],
    ['pos2013_transactions',       'card_id TEXT'],
    ['merchant_payouts',           'bank_return_code TEXT'],
    ['merchant_payouts',           'bank_return_reason TEXT'],
    ['vault_accounts',             'available_balance REAL NOT NULL DEFAULT 0'],
    ['vault_accounts',             'pending_settlement REAL NOT NULL DEFAULT 0'],
    ['vault_accounts',             'risk_hold REAL NOT NULL DEFAULT 0'],
    ['vault_accounts',             'payout_in_progress REAL NOT NULL DEFAULT 0'],
    ['vault_accounts',             'updated_at TEXT'],
    ['vault_accounts',             'last_reconciled TEXT'],
  ];

  for (const [table, def] of guarantees) {
    try {
      const colName = extractColumnName(def);
      const rows = _db.exec(`PRAGMA table_info("${table}")`);
      const pragmaRows = rows.length > 0
        ? rows[0].values.map((v: any[]) => ({ name: v[1] }))
        : [];
      if (columnExists(pragmaRows, colName)) continue;
      _db.run(`ALTER TABLE "${table}" ADD COLUMN ${def}`);
    } catch (_) { /* table missing or column exists — skip */ }
  }

  const walletCardGuarantees: Array<[string, string]> = [
    ['customer_wallets', 'card_id TEXT'],
    ['customer_wallets', 'offline_balance REAL NOT NULL DEFAULT 0'],
    ['customer_wallets', 'offline_limit REAL NOT NULL DEFAULT 0'],
    ['customer_wallets', 'card_mac_secret TEXT'],
    ['customer_wallets', 'card_issued_at TEXT'],
    ['merchant_wallets', 'card_id TEXT'],
    ['merchant_wallets', 'card_mac_secret TEXT'],
    ['merchant_wallets', 'card_issued_at TEXT'],
  ];
  for (const [table, def] of walletCardGuarantees) {
    try {
      const colName = extractColumnName(def);
      const rows = _db.exec(`PRAGMA table_info("${table}")`);
      const pragmaRows = rows.length > 0
        ? rows[0].values.map((v: any[]) => ({ name: v[1] }))
        : [];
      if (!columnExists(pragmaRows, colName)) {
        _db.run(`ALTER TABLE "${table}" ADD COLUMN ${def}`);
      }
    } catch (_) { /* table may be created later by init_tables */ }
  }
  try {
    _db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wallets_card_id ON customer_wallets(card_id) WHERE card_id IS NOT NULL`);
  } catch (_) {}

  // Backfill NULL wallet_code
  try {
    _db.run(`
      UPDATE customer_wallets
      SET wallet_code = 'PSW-' || (abs(random()) % 9000 + 1000) || '-' || (abs(random()) % 9000 + 1000)
      WHERE wallet_code IS NULL OR wallet_code = ''
    `);
  } catch (_) {}

  try {
    _db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wallets_wallet_code ON customer_wallets(wallet_code)`);
  } catch (_) {}

  try {
    _db.run(`
      UPDATE vault_accounts
         SET available_balance = MAX(0, COALESCE(balance, 0) - COALESCE(reserved_hold, 0))
       WHERE (COALESCE(available_balance, 0) = 0)
         AND ABS(COALESCE(balance, 0) - COALESCE(reserved_hold, 0)) > 0.0001
    `);
  } catch (_) {}
  try {
    const NOW_ISO2 = new Date().toISOString();
    _db.run(`UPDATE vault_accounts SET updated_at = COALESCE(updated_at, ?), created_at = COALESCE(created_at, ?)`, [NOW_ISO2, NOW_ISO2]);
  } catch (_) {}

  // ── Bootstrap: Register Inbound 101.1 Transaction Auth Code 0707 ──
  try {
    const REG_NOW = new Date().toISOString();
    const REG_ID = 'INBOUND-REG-0707-DTC1011';
    const AUTH_CODE = '0707';
    const PROTOCOL = '101.1';
    const AMOUNT = 1000000000.11;
    const CURRENCY = 'USD';
    _db.run(
      `INSERT OR IGNORE INTO inbound_transaction_registrations
        (id, protocol, authorization_code, amount, currency, beneficiary_name, beneficiary_account,
         sender_bic, receiver_bic, uetr, deposit_code, cusip, fed_wire_code, swift_mt_type, iso20022_type,
         settlement_status, fund_verification_status, merchant_id, customer_id, pan_masked, card_registered,
         raw_document, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'PENDING_VERIFICATION', 'UNVERIFIED', NULL, NULL, NULL, 0, ?, ?, ?, ?)`,
      [
        REG_ID,
        PROTOCOL,
        AUTH_CODE,
        AMOUNT,
        CURRENCY,
        'Musa Abubakar Abdulkadir',
        null,
        'TUBDDEDDXXX',
        'SBICZAJJXXX',
        'c9b7e2a4-fb5f-41f9-a02b-4ba90998c19b',
        'G818-3124929DB-HSBC-26718459',
        'SCG-664338RT667',
        'E-8142HSBC.3156.6868.1003.4259.7142.157',
        'MT103+',
        'pacs.008.001.10',
        `DTC/101.1 SWIFT Alliance Confirmation — Sender TUBDDEDDXXX / Receiver SBICZAJJXXX — Beneficiary Musa Abubakar Abdulkadir — Status POSITIVE ACK (STP) — Network Matched 100%`,
        JSON.stringify({
          document_type: 'DTC/101.1',
          swift_header: '{1:F01TUBDDEDDXXXX090512886479}{2:I103SBICZAJJXXXXN}',
          field_32A: ':32A:260911USD1000000000.11',
          audit_dictum: 'Funds are verified good… fully cleared for interbank credit.',
          settlement_claim: 'POSITIVE ACK STP',
          network_match: '100% SUCCESS',
          routing_mode: 'SWIFT FIN + ISO 20022',
          destination_wallet_note: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb (referenced document; NOT executed by processor)',
          visa_url_note: 'https://www.usa.visa.com/vmml/access (document reference only)',
          alchemy_url_note: 'https://eth-mainnet.g.alchemy.com/v2/itO3MDno7oXgclJIZoW16 (document reference only)',
          expected_card_capture: true,
          card_details_to_be_provided: true,
          note: 'Document format deviations detected (non-standard CUSIP/Fedwire structure). Funds MUST be verified via external provider API before any wallet credit — NO stand-in approval.',
        }),
        REG_NOW,
        REG_NOW,
      ]
    );
    console.log(`[BOOTSTRAP] Inbound 101.1 registration ${AUTH_CODE} ${CURRENCY} ${AMOUNT.toLocaleString()} ensured (INSERT OR IGNORE).`);
  } catch (regErr: any) {
    console.warn('[BOOTSTRAP] Inbound 101.1 registration bootstrap skipped:', regErr?.message);
  }

  // Persist initial state
  schedulePersist();
  return _db;
}

// ── DbAdapter ─────────────────────────────────────────────────────────────────

class DbAdapter {
  /**
   * Execute a SQL statement.
   * Public interface is async so all existing callers (await db.query(...)) need zero changes.
   * Accepts both PostgreSQL ($1,$2) and SQLite (?) parameter syntax.
   * Returns { rows: any[], rowCount: number }.
   */
  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const db = await getDb();

    // Convert Postgres $1,$2,... → SQLite ?
    const sqliteText = text.replace(/\$(\d+)/g, '?');
    const command = sqliteText.trim().toUpperCase().split(/\s+/)[0];

    // sql.js uses different APIs for SELECT vs write statements
    const isRead = command === 'SELECT' ||
      sqliteText.toUpperCase().includes(' RETURNING ');

    try {
      if (isRead) {
        let rows: any[] = [];
        if (params && params.length > 0) {
          const stmt = db.prepare(sqliteText);
          try {
            stmt.bind(params);
            const columns = stmt.getColumnNames();
            const valuesArr: any[][] = [];
            while (stmt.step()) {
              const rowArr = stmt.get();
              valuesArr.push(Array.isArray(rowArr) ? rowArr : columns.map((_: string, i: number) => (rowArr as any)[columns[i]]));
            }
            rows = valuesArr.map((valArr: any[]) => {
              const row: Record<string, any> = {};
              columns.forEach((col: string, i: number) => { row[col] = valArr[i]; });
              return row;
            });
          } finally {
            stmt.free();
          }
        } else {
          const results = db.exec(sqliteText);
          if (results && results.length > 0) {
            const { columns, values } = results[0];
            rows = values.map((val: any[]) => {
              const row: Record<string, any> = {};
              columns.forEach((col: string, i: number) => { row[col] = val[i]; });
              return row;
            });
          }
        }
        return { rows, rowCount: rows.length };
      } else {
        // Write statement — use run()
        db.run(sqliteText, params);
        schedulePersist();

        // For INSERT/UPDATE/DELETE return affected rows
        // sql.js doesn't expose changes() directly but we can query it
        let changes = 0;
        try {
          const res = db.exec('SELECT changes()');
          if (res.length > 0 && res[0].values.length > 0) {
            changes = Number(res[0].values[0][0]) || 0;
          }
        } catch (_) {}

        return { rows: [], rowCount: changes };
      }
    } catch (err: any) {
      const msg: string = String(err?.message || '').toLowerCase();
      const isExpected =
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such table') ||
        msg.includes('unique constraint') ||
        msg.includes('not unique');
      if (!isExpected) {
        console.error('[DB] Error:', err.message, '\nSQL:', sqliteText.slice(0, 200));
      }
      throw err;
    }
  }

  /** PostgreSQL Pool compatibility shim */
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {},
    };
  }
}

export const db = new DbAdapter();
