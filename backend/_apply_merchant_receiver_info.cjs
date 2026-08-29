const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const uuid4 = () => crypto.randomUUID();

function getCol(db, tableName) {
  const cols = [];
  const r = db.exec("PRAGMA table_info(" + tableName + ")");
  if (r && r[0] && r[0].columns && r[0].values) {
    for (const row of r[0].values) cols.push({ name: row[1], type: row[2], notnull: row[3], dflt: row[4], pk: row[5] });
  }
  return cols;
}
function colNames(rows) { return rows.map(c => c.name); }

(async () => {
  const SQL = await initSqlJs({
    locateFile: (f) => require.resolve("sql.js/dist/" + f),
  });
  const dbPath = path.join(__dirname, "data", "database.sqlite");
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  const MID = "MRC-1001";
  const now = new Date().toISOString();

  const printCols = (tbl) => console.log("COLUMNS(" + tbl + "): " + colNames(getCol(db, tbl)).join(", "));
  printCols("merchant_business_info");
  printCols("merchant_settings");
  printCols("bank_accounts");

  // ---------- MERCHANT_BUSINESS_INFO ----------
  const binfoCols = getCol(db, "merchant_business_info");
  const binfoNames = colNames(binfoCols);
  const existingBInfoQ = db.exec(
    "SELECT * FROM merchant_business_info WHERE merchant_id = ? LIMIT 1",
    [MID]
  );
  const existingBInfo = existingBInfoQ && existingBInfoQ[0] && existingBInfoQ[0].values && existingBInfoQ[0].values[0]
    ? existingBInfoQ[0].columns.reduce((o, k, i) => { o[k] = existingBInfoQ[0].values[0][i]; return o; }, {})
    : null;
  console.log("\nExisting merchant_business_info row: " + (existingBInfo ? JSON.stringify(existingBInfo) : "(none)"));
  const bInfoId = existingBInfo && existingBInfo.id ? existingBInfo.id : uuid4();

  const colsBiz = [
    ["business_name", "ALRKN ALRAQY HOTEL MANAGEMENT LLC"],
    ["business_address", null],
    ["business_phone", "+971559821924"],
    ["business_email", "a.medjoum@gmail.com"],
    ["business_reg_no", null],
    ["tax_id", null],
    ["business_country", "AE"],
    ["business_city", null],
    ["language", "EN"],
    ["updated_at", now],
  ];
  const setBiz = colsBiz.filter(([k]) => binfoNames.includes(k));

  if (existingBInfo) {
    const upd = "UPDATE merchant_business_info SET " + setBiz.map(([k]) => k + " = ?").join(", ") + " WHERE merchant_id = ?";
    db.run(upd, setBiz.map(([,v]) => v).concat([MID]));
  } else {
    const insertCols = [["id", bInfoId], ["merchant_id", MID]].concat(setBiz);
    if (binfoNames.includes("created_at")) insertCols.push(["created_at", now]);
    const sql = "INSERT INTO merchant_business_info (" + insertCols.map(([k]) => k).join(", ") + ") VALUES (" + insertCols.map(()=>"?").join(", ") + ")";
    db.run(sql, insertCols.map(([,v]) => v));
  }
  console.log("merchant_business_info OK");

  // ---------- MERCHANT_SETTINGS ----------
  const msCols = getCol(db, "merchant_settings");
  const msNames = colNames(msCols);
  const existingMsQ = db.exec("SELECT * FROM merchant_settings WHERE merchant_id = ? LIMIT 1", [MID]);
  const existingMs = existingMsQ && existingMsQ[0] && existingMsQ[0].values && existingMsQ[0].values[0]
    ? existingMsQ[0].columns.reduce((o, k, i) => { o[k] = existingMsQ[0].values[0][i]; return o; }, {})
    : null;
  console.log("\nExisting merchant_settings row: " + (existingMs ? JSON.stringify(existingMs) : "(none)"));

  // Ensure extended_settings column
  if (!msNames.includes("extended_settings")) {
    try { db.run("ALTER TABLE merchant_settings ADD COLUMN extended_settings TEXT"); }
    catch(_e){}
  }
  if (!msNames.includes("support_phone")) {
    try { db.run("ALTER TABLE merchant_settings ADD COLUMN support_phone TEXT"); } catch(_e){}
  }
  if (!msNames.includes("display_currency")) {
    try { db.run("ALTER TABLE merchant_settings ADD COLUMN display_currency TEXT DEFAULT 'USD'"); } catch(_e){}
  }

  const bankingBlock = {
    display_name: "ALRKN ALRAQY HOTEL MANAGEMENT LLC",
    business_type: null,
    banking: {
      cif_id: "7120647",
      account_holder: "ABDELLAH MENDJOUM COMMERCIAL TRADIN",
      account_full_legal_name: "ABDELLAH MENDJOUM COMMERCIAL TRADING FZE LLC",
      account_type: "BBG BASIC ACCOUNT",
      account_number: "1001327120647001",
      currency: "AED",
      iban: "AE550351001327120647001",
      bic_swift: "NBADAEAA402",
      bank_branch_name: "Transactional Banking",
      bank_country: "AE",
      routing_number: "NBADAEAA",
      bank_name: "FAB - First Abu Dhabi Bank (NBAD)",
      account_status: "ACTIVE",
      is_default: true,
    },
  };
  const extended = JSON.stringify(bankingBlock);

  const setMs = [
    ["merchant_name", "ALRKN ALRAQY HOTEL MANAGEMENT LLC"],
    ["support_email", "a.medjoum@gmail.com"],
    ["support_phone", "+971559821924"],
    ["display_currency", "AED"],
    ["updated_at", now],
    ["extended_settings", extended],
  ].filter(([k]) => (getCol(db, "merchant_settings").find(c=>c.name===k)));

  if (existingMs) {
    const sql = "UPDATE merchant_settings SET " + setMs.map(([k]) => k + " = ?").join(", ") + " WHERE merchant_id = ?";
    db.run(sql, setMs.map(([,v]) => v).concat([MID]));
  } else {
    const withId = [["merchant_id", MID]].concat(setMs);
    // id column auto or not
    const currentCols = getCol(db,"merchant_settings");
    if (currentCols.find(c=>c.name==="id" && c.pk===1)) {
      // skip id
    } else {
      // insert with id
    }
    const sql = "INSERT INTO merchant_settings (" + withId.map(([k]) => k).join(", ") + ") VALUES (" + withId.map(()=>"?").join(", ") + ")";
    try { db.run(sql, withId.map(([,v]) => v)); } catch(e){ console.warn("ms insert fail (maybe row exists): " + e.message); }
  }
  console.log("merchant_settings OK");

  // ---------- BANK_ACCOUNTS ----------
  const baCols = getCol(db, "bank_accounts");
  const baNames = colNames(baCols);
  console.log("\nBANK_ACCOUNTS columns: " + baNames.join(", "));

  const defQ = db.exec("SELECT * FROM bank_accounts WHERE merchant_id = ? AND is_default = 1 LIMIT 1", [MID]);
  const existingDef = defQ && defQ[0] && defQ[0].values && defQ[0].values[0]
    ? defQ[0].columns.reduce((o, k, i) => { o[k] = defQ[0].values[0][i]; return o; }, {})
    : null;
  console.log("Existing default bank account: " + (existingDef ? JSON.stringify(existingDef) : "(none)"));
  const bankId = existingDef && existingDef.id ? existingDef.id : uuid4();
  const meta = JSON.stringify({
    cif_id: "7120647",
    account_name_truncated: "ABDELLAH MENDJOUM COMMERCIAL TRADIN",
    display_name: "ALRKN ALRAQY HOTEL MANAGEMENT LLC",
    source: "merchant_settings_receiver_bank",
    updated_by: "system_admin_manual_insert",
  });

  // Add metadata_json column if missing
  if (!baNames.includes("metadata_json")) {
    try { db.run("ALTER TABLE bank_accounts ADD COLUMN metadata_json TEXT"); } catch(_e){}
  }
  if (!baNames.includes("iban")) { try { db.run("ALTER TABLE bank_accounts ADD COLUMN iban TEXT"); } catch(_e){} }
  if (!baNames.includes("bic_swift")) { try { db.run("ALTER TABLE bank_accounts ADD COLUMN bic_swift TEXT"); } catch(_e){} }
  if (!baNames.includes("last_verified_at")) { try { db.run("ALTER TABLE bank_accounts ADD COLUMN last_verified_at TEXT"); } catch(_e){} }

  const bankColsAfterAlter = colNames(getCol(db, "bank_accounts"));

  const setBank = [
    ["merchant_id", MID],
    ["account_holder", "ABDELLAH MENDJOUM COMMERCIAL TRADING FZE LLC"],
    ["account_number", "1001327120647001"],
    ["routing_number", "NBADAEAA"],
    ["bank_name", "FAB - First Abu Dhabi Bank (NBAD)"],
    ["bank_branch", "Transactional Banking"],
    ["bic_swift", "NBADAEAA402"],
    ["iban", "AE550351001327120647001"],
    ["currency", "AED"],
    ["country", "AE"],
    ["account_type", "BBG BASIC ACCOUNT"],
    ["is_default", 1],
    ["is_verified", 1],
    ["verification_status", "VERIFIED"],
    ["account_reference", "CIF-7120647"],
    ["updated_at", now],
    ["last_verified_at", now],
    ["metadata_json", meta],
  ].filter(([k]) => bankColsAfterAlter.includes(k));

  if (existingDef) {
    const sql = "UPDATE bank_accounts SET " + setBank.map(([k]) => k + " = ?").join(", ") + " WHERE id = ?";
    db.run(sql, setBank.map(([,v]) => v).concat([bankId]));
  } else {
    const colsWithId = [["id", bankId]].concat(setBank);
    if (bankColsAfterAlter.includes("created_at")) colsWithId.push(["created_at", now]);
    const sql = "INSERT INTO bank_accounts (" + colsWithId.map(([k]) => k).join(", ") + ") VALUES (" + colsWithId.map(()=>"?").join(", ") + ")";
    db.run(sql, colsWithId.map(([,v]) => v));
  }
  // Force others to 0
  try { db.run("UPDATE bank_accounts SET is_default = 0 WHERE merchant_id = ? AND id <> ?", [MID, bankId]); } catch(_e){}
  console.log("bank_accounts OK: id=" + bankId);

  // ---------- PERSIST ----------
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
  console.log("\nDB_PERSISTED: " + dbPath);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
