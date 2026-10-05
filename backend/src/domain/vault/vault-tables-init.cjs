"use strict";
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "..", "..", "data", "database.sqlite");
const NOW_UTC = new Date().toISOString();

(async () => {
  const SQL = await initSqlJs();
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : Buffer.alloc(0);
  const db = new SQL.Database(buf);
  const saveDB = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log("   💾 DB persisted →", DB_PATH); };
  const q = (s, p = []) => { const st = db.prepare(s); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("🏦 Vault Bank Portal — Tables Init + Safe Legacy Cleanup");
  console.log("═══════════════════════════════════════════════════════════════════════");

  let accountsCreated = 0;
  let beneficiariesCreated = 0;
  let transfersCreated = 0;

  db.run("BEGIN IMMEDIATE");

  try {
    db.run(`CREATE TABLE IF NOT EXISTS vault_accounts (
      id TEXT PRIMARY KEY,
      bank_name TEXT NOT NULL DEFAULT 'Protocol 201.3 Settlement Bank',
      bic TEXT,
      iban TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      balance REAL NOT NULL DEFAULT 0,
      reserved_hold REAL DEFAULT 0,
      last_reconciled TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);
    accountsCreated = q("SELECT COUNT(*) c FROM vault_accounts")[0].c;
    console.log(`   ✅ vault_accounts table ready (${accountsCreated} existing rows)`);

    const vaultAccountColumns = new Set(q("PRAGMA table_info(vault_accounts)").map(row => row.name));
    if (["id", "currency", "balance", "bic", "iban"].every(column => vaultAccountColumns.has(column))) {
      db.run(
        `UPDATE vault_accounts
            SET balance = 0
          WHERE ((id = 'PROC-VAULT-EUR-001' AND currency = 'EUR' AND balance = 510000000)
              OR (id = 'PROC-VAULT-USD-002' AND currency = 'USD' AND balance = 4998363))
            AND bic = 'PROCESSOR_BIC_PLACEHOLDER'
            AND iban = 'PROCESSOR_IBAN_PLACEHOLDER'`,
      );
    }
    const accountColumns = new Set(q("PRAGMA table_info(accounts)").map(row => row.name));
    if (["id", "currency", "balance", "bic", "iban", "meta"].every(column => accountColumns.has(column))) {
      db.run(
        `UPDATE accounts
            SET balance = 0
          WHERE ((id = 'PROC-VAULT-EUR-001' AND currency = 'EUR')
              OR (id = 'PROC-VAULT-USD-002' AND currency = 'USD'))
            AND bic = 'PROCESSOR_BIC_PLACEHOLDER'
            AND iban = 'PROCESSOR_IBAN_PLACEHOLDER'
            AND meta LIKE '%"seeded":true%'
            AND balance <> 0`,
      );
    }
    if (["id", "currency", "balance", "available_balance", "bic", "iban"].every(column => vaultAccountColumns.has(column))) {
      db.run(
        `UPDATE vault_accounts
            SET balance = 0, available_balance = 0
          WHERE id = 'PROC-VAULT-USD-002'
            AND currency = 'USD'
            AND bic = 'PROCESSOR_BIC_PLACEHOLDER'
            AND iban = 'PROCESSOR_IBAN_PLACEHOLDER'
            AND balance = 6499.5
            AND available_balance = 1999.5`,
      );
    }
    // Preserve the known smoke-test entries for audit while excluding them from posted balances.
    const vaultEntryColumns = new Set(q("PRAGMA table_info(vault_entries)").map(row => row.name));
    if (["account_id", "currency", "direction", "amount", "source", "status", "metadata"].every(column => vaultEntryColumns.has(column))) {
      db.run(
        `UPDATE vault_entries
            SET status = 'VOIDED'
          WHERE account_id = 'PROC-VAULT-USD-002'
            AND currency = 'USD'
            AND direction = 'debit'
            AND amount = 0.25
            AND source IN ('vault_card_payout', 'vault_card_payout_settled')
            AND status = 'POSTED'
            AND metadata LIKE '%"merchant_id":"SMOKE-TEST-MID"%'
            AND metadata LIKE '%"vault_card_id":"329eadbd-51fd-45cd-990f-f20d420cee80"%'`,
      );
    }

    db.run(`CREATE TABLE IF NOT EXISTS vault_beneficiaries (
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
    )`);
    beneficiariesCreated = q("SELECT COUNT(*) c FROM vault_beneficiaries")[0].c;
    console.log(`   ✅ vault_beneficiaries table ready (${beneficiariesCreated} existing rows)`);

    db.run(`CREATE TABLE IF NOT EXISTS vault_sepa_transfers (
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
    )`);
    transfersCreated = q("SELECT COUNT(*) c FROM vault_sepa_transfers")[0].c;
    console.log(`   ✅ vault_sepa_transfers table ready (${transfersCreated} existing rows)`);

    db.run(`CREATE TABLE IF NOT EXISTS vault_cards (
      id TEXT PRIMARY KEY,
      vault_account_id TEXT NOT NULL,
      bin TEXT NOT NULL,
      card_number TEXT NOT NULL,
      last4 TEXT NOT NULL,
      scheme TEXT NOT NULL,
      product TEXT NOT NULL,
      country TEXT NOT NULL,
      expiry TEXT NOT NULL,
      cvv TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const cardsCreated = q("SELECT COUNT(*) c FROM vault_cards")[0].c;
    console.log(`   ✅ vault_cards table ready (${cardsCreated} existing rows)`);

    db.run("COMMIT");
    saveDB();

    console.log("\n═══════════════════════════════════════════════════════════════════════");
    console.log("✅ Vault Bank Portal Init Complete");
    console.log("   vault_sepa_transfers ready : " + transfersCreated + " existing rows");
    console.log("═══════════════════════════════════════════════════════════════════════");
    process.exit(0);
  } catch (e) {
    try { db.run("ROLLBACK"); } catch (_) {}
    console.error("\n❌ FATAL (rolled back):", e?.stack || e);
    process.exit(1);
  }
})().catch(e => { console.error("\n❌ FATAL:", e?.stack || e); process.exit(1); });
