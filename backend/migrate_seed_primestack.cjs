const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

const execSql = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ changes: this.changes, lastID: this.lastID });
  });
});
const query = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const MIGRATIONS = [
  `ALTER TABLE bank_accounts ADD COLUMN merchant_id TEXT`,
  `ALTER TABLE bank_accounts ADD COLUMN account_type TEXT DEFAULT 'CHECKING'`,
  `ALTER TABLE bank_accounts ADD COLUMN bank_address TEXT`,
  `ALTER TABLE bank_payouts ADD COLUMN provider_ref TEXT`,
  `ALTER TABLE bank_payouts ADD COLUMN provider TEXT`,
  `ALTER TABLE bank_payouts ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`,
];

(async () => {
  console.log('Running migrations on', DB_PATH);

  // ── 1. Run ALTER migrations (safe, ignore "duplicate column" errors) ──
  for (const sql of MIGRATIONS) {
    try {
      await execSql(sql);
      console.log('  OK  ', sql.slice(0, 80));
    } catch (e) {
      if (/duplicate column name|no such table|already exists/i.test(e.message)) {
        console.log('  SKIP', sql.slice(0, 80), '—', e.message);
      } else {
        console.error('  FAIL', sql, e.message);
        process.exit(1);
      }
    }
  }

  // ── 2. Create merchant_payouts table (idempotent via CREATE IF NOT EXISTS) ──
  try {
    await execSql(`
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
      )
    `);
    console.log('  OK  merchant_payouts table');
  } catch (e) {
    console.error('merchant_payouts create FAIL', e.message);
    process.exit(1);
  }

  // ── 3. Bank account seeding removed ──
  // The previous Wise receiving accounts (Wise US / Column Bank USD, Wise EUR SEPA,
  // Wise Payments Limited GBP) are gone — the Wise account was closed permanently.
  // No accounts are seeded any more. Configure the replacement receiving account via
  // the MERCHANT_BANK_* environment variables (or Merchant Settings) once it is open.

  // ── 4. Report back what's in DB now ──
  console.log('\n=== Final bank_accounts for MRC-1001 ===');
  (await query(`SELECT id, merchant_id, customer_id, bank_name, account_holder, account_number,
                       routing_number, account_type, iban, swift_code, currency, is_default, verified
                FROM bank_accounts WHERE merchant_id = 'MRC-1001' ORDER BY is_default DESC, currency ASC`))
    .forEach(r => console.log(JSON.stringify(r)));

  console.log('\n=== merchant_payouts table exists? columns: ===');
  (await query(`PRAGMA table_info(merchant_payouts)`)).forEach(r => console.log('  •', r.name, r.type));

  console.log('\nDone.');
  db.close();
})().catch(e => { console.error('\nFATAL', e); db.close(); process.exit(1); });
