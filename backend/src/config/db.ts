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
// Keep the local POS instance isolated from DATABASE_PATH values inherited
// from older installations or parent shells.
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');

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

/** Persist in-memory DB to disk (debounced — max 1 write per 500ms) */
function schedulePersist() {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_dirty && _db) {
      try {
        const data: Uint8Array = _db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        _dirty = false;
      } catch (e) {
        console.error('[DB] Flush error:', e);
      }
    }
  }, 500);
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
    } catch (_) {}
  }

  try {
    const acc1 = _db.exec(`SELECT COUNT(*) FROM vault_accounts WHERE id='PROC-VAULT-EUR-001'`);
    if (!acc1.length || !acc1[0].values.length || Number(acc1[0].values[0][0]) === 0) {
      _db.run(`INSERT INTO vault_accounts (id,bank_name,bic,iban,currency,balance,reserved_hold,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        ['PROC-VAULT-EUR-001','Protocol 201.3 Settlement Bank','PROCESSOR_BIC_PLACEHOLDER','PROCESSOR_IBAN_PLACEHOLDER','EUR',510000000,0,NOW_ISO,NOW_ISO]);
    }
    const acc2 = _db.exec(`SELECT COUNT(*) FROM vault_accounts WHERE id='PROC-VAULT-USD-002'`);
    if (!acc2.length || !acc2[0].values.length || Number(acc2[0].values[0][0]) === 0) {
      _db.run(`INSERT INTO vault_accounts (id,bank_name,bic,iban,currency,balance,reserved_hold,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        ['PROC-VAULT-USD-002','Protocol 201.3 Settlement Bank','PROCESSOR_BIC_PLACEHOLDER','PROCESSOR_IBAN_PLACEHOLDER','USD',4998363,0,NOW_ISO,NOW_ISO]);
    }
    const wiseEur = _db.exec(`SELECT COUNT(*) FROM vault_accounts WHERE id='VAULT-WISE-EUR-001'`);
    if (!wiseEur.length || !wiseEur[0].values.length || Number(wiseEur[0].values[0][0]) === 0) {
      _db.run(`INSERT INTO vault_accounts (id,bank_name,bic,iban,currency,balance,reserved_hold,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        ['VAULT-WISE-EUR-001','Wise Europe Bank','WISEBANKBIC','DE12345678901234567890','EUR',0,0,NOW_ISO,NOW_ISO]);
    }
    const ben = _db.exec(`SELECT COUNT(*) FROM vault_beneficiaries WHERE swift='TRWIBEB1XXX'`);
    if (!ben.length || !ben[0].values.length || Number(ben[0].values[0][0]) === 0) {
      const { v4: uuidv4 } = require('uuid');
      _db.run(`INSERT INTO vault_beneficiaries (id,name,iban,swift,country,address,currency,bank_name,is_archived,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)`,
        [uuidv4(),'PRIMESTACK TECHNOLOGIES LLC','BE19905861593312','REPLACEMENTBICXXX','Belgium','Replacement provider settlement address','EUR','Replacement Provider',NOW_ISO]);
    }
  } catch (_) {}

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
    ['pos2013_transactions',       'decline_reason TEXT'],
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
        const results = db.exec(sqliteText, params);
        if (!results || results.length === 0) {
          return { rows: [], rowCount: 0 };
        }
        const { columns, values } = results[0];
        const rows = values.map((val: any[]) => {
          const row: Record<string, any> = {};
          columns.forEach((col: string, i: number) => { row[col] = val[i]; });
          return row;
        });
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
