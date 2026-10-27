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
  console.log("🏦 Vault Bank Portal — Tables Init + Seed");
  console.log("═══════════════════════════════════════════════════════════════════════");

  let accountsCreated = 0;
  let beneficiariesCreated = 0;
  let transfersCreated = 0;
  let accountsSeeded = 0;
  let beneficiariesSeeded = 0;

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

    const eurExists = q("SELECT COUNT(*) c FROM vault_accounts WHERE id = ?", ["PROC-VAULT-EUR-001"])[0].c;
    if (eurExists === 0) {
      db.run(`INSERT INTO vault_accounts (id, bank_name, bic, iban, currency, balance, reserved_hold, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["PROC-VAULT-EUR-001", "Protocol 201.3 Settlement Bank", "PROCESSOR_BIC_PLACEHOLDER", "PROCESSOR_IBAN_PLACEHOLDER",
         "EUR", 510000000, 0, NOW_UTC, NOW_UTC]);
      accountsSeeded++;
      console.log("   🌱 Seeded PROC-VAULT-EUR-001 · EUR 510,000,000.00");
    } else {
      console.log("   ⏭ PROC-VAULT-EUR-001 already exists — skipping seed");
    }

    const usdExists = q("SELECT COUNT(*) c FROM vault_accounts WHERE id = ?", ["PROC-VAULT-USD-002"])[0].c;
    if (usdExists === 0) {
      db.run(`INSERT INTO vault_accounts (id, bank_name, bic, iban, currency, balance, reserved_hold, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["PROC-VAULT-USD-002", "Protocol 201.3 Settlement Bank", "PROCESSOR_BIC_PLACEHOLDER", "PROCESSOR_IBAN_PLACEHOLDER",
         "USD", 4998363, 0, NOW_UTC, NOW_UTC]);
      accountsSeeded++;
      console.log("   🌱 Seeded PROC-VAULT-USD-002 · USD 4,998,363.00");
    } else {
      console.log("   ⏭ PROC-VAULT-USD-002 already exists — skipping seed");
    }

    const wiseExists = q("SELECT COUNT(*) c FROM vault_beneficiaries WHERE iban = ?", ["BE19905861593312"])[0].c;
    if (wiseExists === 0) {
      const benId = "BEN-WISE-EUR-BE19-TRWIBEB1-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      db.run(`INSERT INTO vault_beneficiaries (id, name, iban, swift, address, country, currency, bank_name, is_archived, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [benId, "PRIMESTACK TECHNOLOGIES LLC", "BE19905861593312", "TRWIBEB1XXX",
         "Wise, Rue du Trône 100, 3rd floor, Brussels, 1050, Belgium", "Belgium", "EUR",
         "Wise Payments NV", 0, NOW_UTC]);
      beneficiariesSeeded++;
      console.log("   🌱 Seeded Wise EUR beneficiary · PRIMESTACK TECHNOLOGIES LLC / BE19 9058 6159 3312 / TRWIBEB1XXX");
    } else {
      console.log("   ⏭ Wise EUR beneficiary already exists — skipping seed");
    }

    db.run("COMMIT");
    saveDB();

    console.log("\n═══════════════════════════════════════════════════════════════════════");
    console.log("✅ Vault Bank Portal Init Complete");
    console.log("   vault_accounts seeded      : " + accountsSeeded);
    console.log("   vault_beneficiaries seeded : " + beneficiariesSeeded);
    console.log("   vault_sepa_transfers ready : " + transfersCreated + " existing rows");
    console.log("═══════════════════════════════════════════════════════════════════════");
    process.exit(0);
  } catch (e) {
    try { db.run("ROLLBACK"); } catch (_) {}
    console.error("\n❌ FATAL (rolled back):", e?.stack || e);
    process.exit(1);
  }
})().catch(e => { console.error("\n❌ FATAL:", e?.stack || e); process.exit(1); });
