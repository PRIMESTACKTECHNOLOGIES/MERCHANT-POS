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
let _inTransaction = false;    // true between BEGIN and COMMIT/ROLLBACK
let _txnStartedAt = 0;         // epoch ms of the open transaction
let _seq = 0;                  // bumped on every write, so a background flush knows it is stale
let _writeInFlight: Promise<void> | null = null; // non-null while an async flush is running

/**
 * Safety valve: if a caller opens a transaction and never ends it, we still
 * flush after this long so writes can never be stranded in RAM forever.
 */
const TXN_FLUSH_CAP_MS = 15000;

/**
 * Local-development flush tuning. 0 (the default) keeps the original behaviour:
 * every write statement rewrites the whole DB file synchronously.
 *
 * Set DB_FLUSH_DEBOUNCE_MS when the DB file sits on a slow disk (this project is
 * developed off a removable USB drive that writes at <1 MB/s, so one 20 MB
 * rewrite takes ~30s). Bursts of writes are then coalesced into a single flush
 * that runs in the background, instead of one freeze-the-event-loop write per
 * statement. Must stay unset in production.
 */
const FLUSH_DEBOUNCE_MS = Math.max(0, Number(process.env.DB_FLUSH_DEBOUNCE_MS) || 0);

/**
 * Every flush writes to a sibling temp file first and then renames it over the
 * real DB. writeFile alone truncates the target, so a kill or power loss during
 * the write leaves a half-written — i.e. corrupt — database behind. rename() is
 * atomic, so the DB file is always either the old or the new complete image.
 */
const DB_TMP_PATH = `${DB_PATH}.tmp`;

/** Rewrite the whole DB file on the calling thread. */
function flushToDiskSync() {
  const data: Uint8Array = _db.export();
  fs.writeFileSync(DB_TMP_PATH, Buffer.from(data));
  fs.renameSync(DB_TMP_PATH, DB_PATH);
  _dirty = false;
}

/**
 * Rewrite the DB file off the main thread so a slow disk cannot stall the HTTP
 * server. Writes made while the flush is running are picked up by the loop, so
 * the file always converges on the newest state.
 */
function startBackgroundFlush() {
  if (_writeInFlight || !_db) return;
  _writeInFlight = (async () => {
    try {
      while (_dirty) {
        const seq = _seq;
        const data: Uint8Array = _db.export();
        await fs.promises.writeFile(DB_TMP_PATH, Buffer.from(data));
        await fs.promises.rename(DB_TMP_PATH, DB_PATH);
        // Only clear the flag if nothing was written during the await.
        if (seq === _seq) _dirty = false;
      }
    } catch (e) {
      console.error('[DB] Flush error:', e);
    } finally {
      _writeInFlight = null;
    }
  })();
}

/**
 * Persist in-memory DB to disk — flush immediately on every write to prevent data loss.
 *
 * MUST NOT be called while a transaction is open: sql.js implements export() by
 * closing and reopening the underlying sqlite connection, which implicitly
 * ROLLBACKs the open transaction. Any writes made after BEGIN are then silently
 * discarded, and the later COMMIT fails with "cannot commit - no transaction is
 * active". Verified against sql.js directly. So writes inside a transaction are
 * held in RAM and flushed by the COMMIT/ROLLBACK handler.
 */
function schedulePersist(force = false) {
  _dirty = true;
  _flushCount++;
  _seq++;

  if (_inTransaction && !force) {
    if (Date.now() - _txnStartedAt < TXN_FLUSH_CAP_MS) return;
    console.warn(`[DB] Transaction open for >${TXN_FLUSH_CAP_MS}ms — forcing flush (atomicity lost).`);
    _inTransaction = false;
  }

  // Slow-disk mode (local dev only): collapse a burst of writes into one flush.
  if (FLUSH_DEBOUNCE_MS > 0 && !force) {
    if (_flushTimer) return; // a flush is already queued for this burst
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      schedulePersist(true);
    }, FLUSH_DEBOUNCE_MS);
    return;
  }

  // Always flush immediately — never debounce on Render where process can be killed anytime
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }

  if (_db) {
    if (FLUSH_DEBOUNCE_MS > 0) {
      startBackgroundFlush();
      return;
    }
    try {
      flushToDiskSync();
    } catch (e) {
      console.error('[DB] Flush error:', e);
      // Retry once after 100ms
      _flushTimer = setTimeout(() => {
        _flushTimer = null;
        if (_dirty && _db) {
          try {
            flushToDiskSync();
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
  // A background flush may be rewriting the file right now; let it finish and
  // then persist the newest state, so stale bytes can never land last on disk.
  if (_writeInFlight) { void flushDbAsync(); return; }
  if (_dirty && _db) {
    try {
      flushToDiskSync();
    } catch (e) {
      console.error('[DB] Flush error on shutdown:', e);
    }
  }
}

/** Await any in-flight background flush, then persist the newest state. */
export async function flushDbAsync(): Promise<void> {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  try { if (_writeInFlight) await _writeInFlight; } catch { /* logged by the flush itself */ }
  if (_dirty && _db) {
    try {
      flushToDiskSync();
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
    pin_hash TEXT,
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
    display_name TEXT,
    description TEXT,
    permissions TEXT,
    is_system_role INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS user_role_assignments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    assigned_by TEXT,
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
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
    `CREATE TABLE IF NOT EXISTS merchant_bank_accounts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, bank_name TEXT, account_holder TEXT, account_number TEXT, routing_number TEXT, iban TEXT, swift_code TEXT, currency TEXT DEFAULT 'USD', is_default INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_payouts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, bank_account_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'PENDING', reference TEXT, approved_by TEXT, rejected_by TEXT, rejection_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS hot_wallet_transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, coin TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'mainnet', amount REAL NOT NULL, from_address TEXT, to_address TEXT, tx_hash TEXT, status TEXT NOT NULL DEFAULT 'COMPLETED', reference TEXT, merchant_id TEXT, customer_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_crypto_wallets (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, coin TEXT NOT NULL, network TEXT NOT NULL DEFAULT 'mainnet', balance REAL NOT NULL DEFAULT 0, address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(merchant_id, coin))`,
    `CREATE TABLE IF NOT EXISTS merchant_settings (merchant_id TEXT PRIMARY KEY, api_key TEXT, webhook_url TEXT, test_mode INTEGER DEFAULT 0, merchant_name TEXT, support_email TEXT, features TEXT, extended_settings TEXT, payment_config TEXT, license_number TEXT, tax_id TEXT, merchant_address TEXT, merchant_phone TEXT, bank_name TEXT, bank_account_holder TEXT, bank_account_number TEXT, bank_routing_number TEXT, bank_iban TEXT, bank_swift_code TEXT, usdt_address_tron TEXT, usdt_address_bsc TEXT, usdt_address_polygon TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS virtual_accounts (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, customer_id TEXT, currency TEXT NOT NULL DEFAULT 'USD', account_number TEXT, routing_number TEXT, iban TEXT, reference TEXT, provider TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS ledger_entries (id TEXT PRIMARY KEY, transaction_id TEXT, type TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'PENDING', description TEXT, merchant_id TEXT, customer_id TEXT, reference_id TEXT, batch_id TEXT, source TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS merchant_pos_settlements (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, ledger_entry_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'unsettled', settled_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, meta TEXT)`,
    `CREATE TABLE IF NOT EXISTS transaction_settlements (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, transaction_id TEXT NOT NULL, gross_amount REAL NOT NULL, fee_amount REAL NOT NULL DEFAULT 0, net_amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'SETTLED', settled_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS vault_ledger (id TEXT PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL, merchant_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', reference TEXT, status TEXT NOT NULL DEFAULT 'PENDING', meta TEXT)`,
    `CREATE TABLE IF NOT EXISTS vault_audit_trail (id TEXT PRIMARY KEY, ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actor TEXT, event TEXT, event_type TEXT, merchant_id TEXT, amount REAL, currency TEXT, reference TEXT, description TEXT, before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', meta_json TEXT NOT NULL DEFAULT '{}', meta TEXT, hash TEXT, prev_hash TEXT)`,
    `CREATE TABLE IF NOT EXISTS pos2013_batches (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE, merchant_id TEXT NOT NULL, terminal_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', settlement_code TEXT, captured_amount_minor INTEGER DEFAULT 0, captured_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, processed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
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
    // Protocol 101.1 codes the vault bank has verified and spent. The unique
    // constraint is what makes a verbal code single-use per merchant.
    `CREATE TABLE IF NOT EXISTS vault_voice_auth_codes (
      id TEXT PRIMARY KEY,
      auth_code TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      pan_last4 TEXT,
      amount_minor REAL,
      currency TEXT,
      terminal_id TEXT,
      stan TEXT,
      reference TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (auth_code, merchant_id)
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
  // Register an env-configured gateway key pair. Always ensures the env values
  // win on every startup so a rotated secret takes effect without a manual reset.
  const seedVaultKey = (apiKey?: string, secretKey?: string, label = 'environment vault bank') => {
    if (!apiKey || !secretKey) return;
    try {
      _db.run(
        `INSERT OR IGNORE INTO vault_api_keys
          (id, api_key, secret_key, label, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [require('uuid').v4(), apiKey, secretKey, label, NOW_ISO],
      );
      _db.run(
        `UPDATE vault_api_keys SET active = 1, secret_key = ? WHERE api_key = ?`,
        [secretKey, apiKey],
      );
    } catch (_) {}
  };
  seedVaultKey(process.env.VAULT_BANK_API_KEY?.trim(), process.env.VAULT_BANK_SECRET_KEY?.trim());
  // Dedicated credential for the Protocol 101.1 voice-auth verify channel, so the
  // POS can verify codes at /api/vault-bank/voice-auth/verify without holding the
  // general vault bank key.
  seedVaultKey(
    process.env.VOICE_AUTH_VERIFY_API_KEY?.trim(),
    process.env.VOICE_AUTH_VERIFY_SECRET?.trim(),
    'voice auth verifier',
  );

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
       WHERE id IN ('PROC-VAULT-USD-002','PROC-VAULT-EUR-001')
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

  // ── PURGE UNBACKED ("fake") FUNDS ───────────────────────────────────────────
  // A capture that no real acquirer / card scheme actually confirmed must never
  // leave a withdrawable balance behind. Older builds credited the merchant (or a
  // walk-in customer) wallet with source 'pos_card_charge_ledger' — and the
  // offline path with 'offline_pos_capture' — even though no money was received.
  // The €10M `onl_mvb67k30` capture was exactly such an entry.
  //
  // This block reverses every such credit (never below zero), voids the history
  // that produced it, deletes the settlement rows it generated, and voids any
  // vault credit that has no recorded real-funds receipt.
  try {
    const UNBACKED = "('pos_card_charge_ledger','offline_pos_capture','offline_sync','internal_ledger_capture')";
    const VOID_REASON = 'UNBACKED - no real scheme capture (voided: fake-funds purge)';

    _db.run(`CREATE TEMP TABLE IF NOT EXISTS _unbacked_refs (reference TEXT PRIMARY KEY)`);
    _db.run(`DELETE FROM _unbacked_refs`);
    try {
      _db.run(`INSERT OR IGNORE INTO _unbacked_refs (reference)
               SELECT reference FROM merchant_wallet_transactions
                WHERE reference IS NOT NULL AND source IN ${UNBACKED}`);
      _db.run(`INSERT OR IGNORE INTO _unbacked_refs (reference)
               SELECT reference FROM wallet_transactions
                WHERE reference IS NOT NULL AND source IN ${UNBACKED}`);
    } catch (_) {}

    // 1) Void the online history that claimed these unbacked captures.
    try {
      _db.run(`UPDATE pos2013_transactions
                  SET status = 'VOIDED', decline_reason = ?
                WHERE id IN (SELECT reference FROM _unbacked_refs)`, [VOID_REASON]);
    } catch (_) {}
    try {
      _db.run(`UPDATE ledger_entries SET status = 'VOIDED', updated_at = ?
                WHERE source IN ${UNBACKED}
                   OR reference_id IN (SELECT reference FROM _unbacked_refs)`, [NOW_ISO]);
    } catch (_) {}

    // 2) Remove the settlement rows they produced so they can never be settled.
    try {
      _db.run(`DELETE FROM merchant_pos_settlements
                WHERE COALESCE(status, 'unsettled') <> 'settled'
                  AND meta LIKE '%"funds_type":"INTERNAL_LEDGER"%'`);
      _db.run(`DELETE FROM merchant_pos_settlements
                WHERE COALESCE(status, 'unsettled') <> 'settled'
                  AND ledger_entry_id IN (SELECT id FROM ledger_entries WHERE status = 'VOIDED')`);
    } catch (_) {}

    // 3) Record the voids for audit, then reverse the balance they raised.
    try {
      _db.run(`INSERT OR IGNORE INTO merchant_wallet_transaction_voids
                 (id, transaction_id, wallet_id, amount, reason, voided_by, created_at)
               SELECT 'purge-' || id, id, wallet_id, amount, ?, 'system:fake-funds-purge', ?
                 FROM merchant_wallet_transactions WHERE source IN ${UNBACKED}`, [VOID_REASON, NOW_ISO]);
      _db.run(`INSERT OR IGNORE INTO customer_wallet_transaction_voids
                 (id, transaction_id, wallet_id, amount, reason, voided_by, created_at)
               SELECT 'purge-' || id, id, wallet_id, amount, ?, 'system:fake-funds-purge', ?
                 FROM wallet_transactions WHERE source IN ${UNBACKED}`, [VOID_REASON, NOW_ISO]);
    } catch (_) {}
    try {
      _db.run(`UPDATE merchant_wallets
                  SET balance = MAX(0, balance - COALESCE((
                        SELECT SUM(t.amount) FROM merchant_wallet_transactions t
                         WHERE t.wallet_id = merchant_wallets.id
                           AND t.type = 'credit' AND t.source IN ${UNBACKED}), 0)),
                      updated_at = ?`, [NOW_ISO]);
      _db.run(`UPDATE customer_wallets
                  SET balance = MAX(0, balance - COALESCE((
                        SELECT SUM(t.amount) FROM wallet_transactions t
                         WHERE t.wallet_id = customer_wallets.id
                           AND t.type = 'credit' AND t.source IN ${UNBACKED}), 0)),
                      updated_at = ?`, [NOW_ISO]);
      _db.run(`DELETE FROM merchant_wallet_transactions WHERE source IN ${UNBACKED}`);
      _db.run(`DELETE FROM wallet_transactions WHERE source IN ${UNBACKED}`);
    } catch (_) {}

    // 4) Vault: void credits with no real-funds backing, then decrement the
    //    affected vault accounts by exactly what was voided.
    try {
      const hasRealFunds = (_db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='vault_real_funds'`,
      )[0]?.values?.length || 0) > 0;
      const voucher = hasRealFunds
        ? `(type = 'BATCH_TO_VAULT' AND reference NOT IN (SELECT external_reference FROM vault_real_funds))
           OR (type = 'ADJUSTMENT'
               AND COALESCE(meta, '') IN ('', '{}')
               AND reference NOT LIKE 'ROLLBACK-%' AND reference NOT LIKE 'rollback_%'
               AND reference NOT IN (SELECT external_reference FROM vault_real_funds))`
        : `(type = 'BATCH_TO_VAULT' AND COALESCE(meta, '') NOT LIKE '%pos_settlement%')`;
      _db.run(`CREATE TEMP TABLE IF NOT EXISTS _voided_vault (currency TEXT PRIMARY KEY, total REAL)`);
      _db.run(`DELETE FROM _voided_vault`);
      _db.run(`INSERT INTO _voided_vault (currency, total)
               SELECT currency, SUM(ABS(amount)) FROM vault_ledger
                WHERE status = 'COMPLETED' AND (${voucher}) GROUP BY currency`);
      _db.run(`UPDATE vault_ledger SET status = 'VOIDED'
                WHERE status = 'COMPLETED' AND (${voucher})`);
      _db.run(`UPDATE vault_accounts
                  SET balance = MAX(0, balance - COALESCE((SELECT v.total FROM _voided_vault v WHERE v.currency = vault_accounts.currency), 0)),
                      available_balance = MAX(0, available_balance - COALESCE((SELECT v.total FROM _voided_vault v WHERE v.currency = vault_accounts.currency), 0)),
                      updated_at = ?`, [NOW_ISO]);
      _db.run(`DROP TABLE IF EXISTS _voided_vault`);
    } catch (err) {
      console.warn('[DB] vault unbacked-funds purge skipped:', (err as Error)?.message);
    }

    _db.run(`DROP TABLE IF EXISTS _unbacked_refs`);
  } catch (err) {
    console.warn('[DB] unbacked-funds purge skipped:', (err as Error)?.message);
  }

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
    // Links a customer wallet credit to the settlement that produced it, so the
    // settlement worker can tell "already funded" from "funded twice".
    ['wallet_transactions',        'settlement_id TEXT'],
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
    ['terminals',                  'last_seen_at TEXT'],
    ['terminals',                  'activation_code TEXT'],
    ['terminals',                  'model TEXT'],
    ['terminals',                  'version TEXT'],
    ['terminals',                  'ip_address TEXT'],
    // user_roles extended columns
    ['user_roles', 'display_name TEXT'],
    ['user_roles', 'description TEXT'],
    ['user_roles', 'is_system_role INTEGER DEFAULT 0'],
    ['user_roles', 'priority INTEGER DEFAULT 0'],
    // user_role_assignments extended columns
    ['user_role_assignments', 'assigned_by TEXT'],
    ['user_role_assignments', 'assigned_at TEXT DEFAULT CURRENT_TIMESTAMP'],
    ['user_role_assignments', 'notes TEXT'],
    // merchant_crypto_withdrawals extra columns
    ['merchant_crypto_withdrawals', 'network TEXT'],
    ['merchant_crypto_withdrawals', 'fee REAL DEFAULT 0'],
    ['merchant_crypto_withdrawals', 'provider TEXT'],
    ['merchant_crypto_withdrawals', 'provider_reference TEXT'],
    // Canonical merchant_crypto_withdrawals columns. Databases created from the older
    // customer-facing shape (customer_id/coin/to_address) are missing these, so
    // `CREATE INDEX ... (merchant_id, status)` and the crypto payout INSERT both fail.
    ['merchant_crypto_withdrawals', 'merchant_id TEXT'],
    ['merchant_crypto_withdrawals', 'amount_usd REAL'],
    ['merchant_crypto_withdrawals', 'asset TEXT'],
    ['merchant_crypto_withdrawals', 'address TEXT'],
    ['merchant_crypto_withdrawals', "status TEXT DEFAULT 'pending_manual'"],
    ['merchant_crypto_withdrawals', 'ref TEXT'],
    ['merchant_crypto_withdrawals', 'tx_id TEXT'],
    ['merchant_crypto_withdrawals', 'tx_url TEXT'],
    ['merchant_crypto_withdrawals', 'meta TEXT'],
    ['merchant_crypto_withdrawals', 'created_at TEXT DEFAULT CURRENT_TIMESTAMP'],
    ['merchant_crypto_withdrawals', 'updated_at TEXT DEFAULT CURRENT_TIMESTAMP'],
    // payout_instructions.provider_ref — the vault-dashboard backfill INSERT writes it.
    ['payout_instructions',          'provider_ref TEXT'],
    // vault_card_txns: POSTED | VOIDED — lets an unbacked card credit be voided
    // without deleting the audit row it left behind.
    ['vault_card_txns',             "status TEXT NOT NULL DEFAULT 'POSTED'"],
    // vault_wire_confirmations: DEFAULT 'CONFIRMED' is deliberate. Wires that
    // predate the two-phase wire flow were credited under the old one-shot
    // behaviour, so they must NOT surface as confirmable pending wires.
    ['vault_wire_confirmations',    "status TEXT NOT NULL DEFAULT 'CONFIRMED'"],
    ['vault_wire_confirmations',    'confirmed_by TEXT'],
    ['vault_wire_confirmations',    'created_at TEXT'],
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

  // ── PURGE UNBACKED VAULT CARD CREDITS (runs once) ──────────────────────────
  // The cash / bank-wire / test-seed card top-up channels credited the card
  // balance from an operator code plus a free-text reference. Nothing verified
  // that any money actually arrived, so those credits were minted, not received.
  // Three such credits put $300,000 on the USD card with no external receipt.
  //
  // Void them, zero the affected cards, and record a marker so this never runs
  // again — later operator-confirmed loads must survive a restart.
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS db_maintenance (
      key TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const alreadyApplied = (_db.exec(
      `SELECT key FROM db_maintenance WHERE key = 'purge_unbacked_card_credits_v1'`,
    )[0]?.values?.length || 0) > 0;

    const hasCardTables = (_db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='vault_card_txns'`,
    )[0]?.values?.length || 0) > 0;

    // Tables are created by ensureOperatorCards() after initTables(), so on a
    // fresh DB they are absent here — leave the marker unset and retry next boot.
    if (!alreadyApplied && hasCardTables) {
      const UNVERIFIED_CARD_CHANNELS = "('cash','bank_wire','test_seed')";
      const CARD_VOID_REASON = 'UNBACKED - no verified external receipt (voided: fake-funds purge)';
      _db.run(`CREATE TEMP TABLE IF NOT EXISTS _voided_card (card_id TEXT, currency TEXT, total REAL)`);
      _db.run(`DELETE FROM _voided_card`);
      _db.run(`INSERT INTO _voided_card (card_id, currency, total)
               SELECT card_id, currency, SUM(amount) FROM vault_card_txns
                WHERE type = 'CREDIT' AND status = 'POSTED' AND channel IN ${UNVERIFIED_CARD_CHANNELS}
                GROUP BY card_id, currency`);
      _db.run(`UPDATE vault_card_txns
                  SET note = COALESCE(note || ' | ', '') || ?
                WHERE type = 'CREDIT' AND status = 'POSTED' AND channel IN ${UNVERIFIED_CARD_CHANNELS}`,
        [CARD_VOID_REASON]);
      _db.run(`UPDATE vault_card_txns SET status = 'VOIDED'
                WHERE type = 'CREDIT' AND channel IN ${UNVERIFIED_CARD_CHANNELS}`);
      _db.run(`UPDATE vault_card_balances
                  SET balance = MAX(0, balance - COALESCE((
                        SELECT v.total FROM _voided_card v
                         WHERE v.card_id = vault_card_balances.card_id
                           AND v.currency = vault_card_balances.currency), 0)),
                      updated_at = ?`, [NOW_ISO]);
      _db.run(`DROP TABLE IF EXISTS _voided_card`);
      _db.run(`INSERT OR IGNORE INTO db_maintenance (key, applied_at)
               VALUES ('purge_unbacked_card_credits_v1', ?)`, [NOW_ISO]);
      const voided = _db.exec(`SELECT COUNT(*) FROM vault_card_txns WHERE status = 'VOIDED'`);
      console.warn(`[DB] vault card fake-funds purge: voided ${voided[0]?.values?.[0]?.[0] ?? 0} unbacked card credit(s).`);
    }
  } catch (err) {
    console.warn('[DB] vault card unbacked-credit purge skipped:', (err as Error)?.message);
  }

  const walletCardGuarantees: Array<[string, string]> = [
    // Customer portal login PIN (bcrypt hash) — added for the customer self-service dashboard.
    ['customers', 'pin_hash TEXT'],
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

  // ── BACKFILL: internal-ledger POS captures → CUSTOMER wallet (runs once) ────
  // Card charges taken before the INTERNAL_LEDGER customer credit existed were
  // recorded in pos2013_transactions but credited NO wallet, so the customer
  // wallet stayed empty and the provider pull (customer → merchant) could never
  // be started for them. Record those captures now as a non-withdrawable
  // INTERNAL_LEDGER receivable on the paying customer's wallet, keyed by the
  // transaction id (idempotent per row). Captures already backed by a wallet
  // credit, or that produced a settlement row, are skipped so nothing is
  // double-counted. Real, withdrawable funds still reach the merchant wallet
  // only via the provider pull.
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS db_maintenance (
      key TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const alreadyApplied = (_db.exec(
      `SELECT key FROM db_maintenance WHERE key = 'backfill_internal_ledger_customer_credits_v1'`,
    )[0]?.values?.length || 0) > 0;

    if (!alreadyApplied) {
      const { v4: uuidv4 } = require('uuid');
      const candidates = _db.exec(`
        SELECT t.id,
               COALESCE(t.customer_id, 'WALKIN-' || t.merchant_id) AS wallet_customer,
               t.amount_minor / 100.0 AS amount,
               COALESCE(NULLIF(UPPER(t.currency), ''), 'USD') AS ccy
          FROM pos2013_transactions t
         WHERE t.status = 'APPROVED'
           AND NOT EXISTS (SELECT 1 FROM merchant_wallet_transactions m WHERE m.reference = t.id)
           AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference = t.id)
           AND NOT EXISTS (SELECT 1 FROM merchant_pos_settlements s
                            WHERE s.meta LIKE '%"paymentIntentId":"' || t.id || '"%')
      `);
      const rows: any[][] = candidates[0]?.values || [];
      let credited = 0;

      for (const row of rows) {
        const txnId = String(row[0] || '');
        const customerId = String(row[1] || '');
        const amount = Number(row[2]);
        const ccy = String(row[3] || 'USD');
        if (!txnId || !customerId || !Number.isFinite(amount) || amount <= 0) continue;

        // resolve (or create) the customer's wallet for this currency
        let walletId = '';
        const findStmt = _db.prepare(
          'SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ? LIMIT 1',
        );
        try {
          findStmt.bind([customerId, ccy]);
          if (findStmt.step()) walletId = String((findStmt.getAsObject() as any).id || '');
        } finally { findStmt.free(); }

        if (!walletId) {
          walletId = uuidv4();
          const walletCode = `PSW-${Math.floor(Math.random() * 9000) + 1000}-${Math.floor(Math.random() * 9000) + 1000}`;
          _db.run(
            `INSERT INTO customer_wallets (id, customer_id, balance, currency, wallet_code) VALUES (?, ?, 0, ?, ?)`,
            [walletId, customerId, ccy, walletCode],
          );
        }

        // per-row idempotency: never credit the same capture twice
        let alreadyCredited = false;
        const dupStmt = _db.prepare(
          `SELECT 1 AS hit FROM wallet_transactions
            WHERE wallet_id = ? AND type = 'credit' AND reference = ? LIMIT 1`,
        );
        try {
          dupStmt.bind([walletId, txnId]);
          alreadyCredited = dupStmt.step();
        } finally { dupStmt.free(); }
        if (alreadyCredited) continue;

        _db.run(
          `INSERT INTO wallet_transactions
            (id, wallet_id, type, amount, currency, source, reference, description, created_at)
           VALUES (?, ?, 'credit', ?, ?, 'pos_card_charge_internal_ledger', ?, ?, ?)`,
          [
            uuidv4(),
            walletId,
            amount,
            ccy,
            txnId,
            `Internal-ledger POS capture backfill (${txnId}) — non-withdrawable until the provider pull`,
            NOW_ISO,
          ],
        );
        _db.run(
          `UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
          [amount, NOW_ISO, walletId],
        );
        credited++;
      }

      _db.run(`INSERT OR IGNORE INTO db_maintenance (key, applied_at)
               VALUES ('backfill_internal_ledger_customer_credits_v1', ?)`, [NOW_ISO]);
      console.warn(
        `[DB] internal-ledger POS capture backfill: credited ${credited} capture(s) to customer wallets ` +
        `(scanned ${rows.length}).`,
      );
    }
  } catch (err) {
    console.warn('[DB] internal-ledger customer-wallet backfill skipped:', (err as Error)?.message);
  }

  // ── BACKFILL: give every existing wallet an owning customer row (runs once) ──
  // Wallet credits can create a wallet for a customer_id that has no matching
  // row in `customers` (e.g. the per-merchant WALKIN-<merchantId> id used when a
  // capture names no customer). Because every customer-facing view lists
  // customers first and then reads that customer's own wallets, such a wallet —
  // and the money in it — is invisible on every screen. Materialise the missing
  // owner records so those funds appear in the customer's own wallet.
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS db_maintenance (
      key TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const alreadyApplied = (_db.exec(
      `SELECT key FROM db_maintenance WHERE key = 'backfill_walkin_customer_records_v1'`,
    )[0]?.values?.length || 0) > 0;

    if (!alreadyApplied) {
      _db.run(`
        INSERT INTO customers (id, merchant_id, name, kyc_status, created_at, updated_at)
        SELECT w.customer_id,
               CASE WHEN UPPER(w.customer_id) LIKE 'WALKIN-%' THEN substr(w.customer_id, 8) ELSE NULL END,
               CASE WHEN UPPER(w.customer_id) LIKE 'WALKIN-%'
                    THEN 'Walk-in Customer (' || substr(w.customer_id, 8) || ')'
                    ELSE 'Customer ' || w.customer_id END,
               'PENDING', ?, ?
          FROM (SELECT DISTINCT customer_id FROM customer_wallets) w
         WHERE w.customer_id IS NOT NULL
           AND w.customer_id <> ''
           AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = w.customer_id)
      `, [NOW_ISO, NOW_ISO]);

      const created = Number(_db.exec(`SELECT changes()`)[0]?.values?.[0]?.[0] || 0);
      _db.run(`INSERT OR IGNORE INTO db_maintenance (key, applied_at)
               VALUES ('backfill_walkin_customer_records_v1', ?)`, [NOW_ISO]);
      console.warn(`[DB] orphan-wallet owner repair: created ${created} missing customer record(s).`);
    }
  } catch (err) {
    console.warn('[DB] orphan-wallet owner repair skipped:', (err as Error)?.message);
  }

  // ── Bootstrap: Inbound SWIFT registration removed ──
  // No fabricated inbound transaction records are seeded at startup.
  // All inbound registrations must be created via POST /payments/inbound/register
  // with real external provider verification before any wallet credit is issued.

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
        const upper = sqliteText.trim().toUpperCase();
        const isBegin = /^BEGIN\b/.test(upper) || /^START\s+TRANSACTION\b/.test(upper);
        const isEnd   = /^COMMIT\b/.test(upper) || /^END\b/.test(upper) || /^ROLLBACK\b/.test(upper);

        let changes = 0;
        try {
          db.run(sqliteText, params);

          // IMPORTANT: read changes() BEFORE schedulePersist().
          // schedulePersist() calls db.export(), and sql.js implements export() by
          // closing and reopening the underlying sqlite connection — which resets the
          // per-connection changes() counter back to 0. Reading it afterwards would
          // always return 0 and make every caller's rowCount falsy (breaks guards
          // like `UPDATE ... WHERE status='PENDING'` → check rowCount).
          try {
            const res = db.exec('SELECT changes()');
            if (res.length > 0 && res[0].values.length > 0) {
              changes = Number(res[0].values[0][0]) || 0;
            }
          } catch (_) {}
        } finally {
          // Track transaction state so schedulePersist() can defer the disk flush
          // until COMMIT/ROLLBACK (see schedulePersist for why this is required).
          if (isBegin) { _inTransaction = true; _txnStartedAt = Date.now(); }
          if (isEnd)   { _inTransaction = false; }
          // A closed transaction must be flushed immediately; it is the only write
          // that actually makes the deferred statements durable.
          schedulePersist(isEnd);
        }

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
