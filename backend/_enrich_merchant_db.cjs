const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve("sql.js/dist/" + f) });
  const dbPath = path.join(__dirname, "data", "database.sqlite");
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const now = new Date().toISOString();

  const run = (sql, params = []) => {
    try {
      db.run(sql, params);
      console.log("OK: " + sql.trim().split("\n")[0].slice(0, 80));
    } catch (e) {
      console.log("SKIP (exists?): " + sql.trim().split("\n")[0].slice(0, 80) + " → " + e.message.slice(0,120));
    }
  };

  // ---------- bank_accounts missing columns ----------
  run("ALTER TABLE bank_accounts ADD COLUMN bank_branch TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN bic_swift TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN country TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN verification_status TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN account_reference TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN updated_at TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN metadata_json TEXT");
  run("ALTER TABLE bank_accounts ADD COLUMN last_verified_at TEXT");

  // ---------- merchant_business_info missing columns ----------
  run("ALTER TABLE merchant_business_info ADD COLUMN business_email TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN business_country TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN business_city TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN language TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN business_reg_no TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN tax_id TEXT");
  run("ALTER TABLE merchant_business_info ADD COLUMN created_at TEXT");

  // ---------- merchant_settings missing columns ----------
  run("ALTER TABLE merchant_settings ADD COLUMN support_phone TEXT");
  run("ALTER TABLE merchant_settings ADD COLUMN display_name TEXT");
  run("ALTER TABLE merchant_settings ADD COLUMN display_currency TEXT DEFAULT 'USD'");
  run("ALTER TABLE merchant_settings ADD COLUMN created_at TEXT");

  // ---------- FIX bank_accounts default row (bic_swift, bank_branch, country, verified=1, etc) ----------
  try {
    db.run(
      "UPDATE bank_accounts SET bank_branch=?, bic_swift=?, swift_code=COALESCE(NULLIF(swift_code,''),?), country=?, verified=?, verification_status=?, account_reference=?, updated_at=?, last_verified_at=? WHERE merchant_id=? AND is_default=1",
      [
        "Transactional Banking",
        "NBADAEAA402",
        "NBADAEAA402",
        "AE",
        1,
        "VERIFIED",
        "CIF-7120647",
        now,
        now,
        "MRC-1001",
      ]
    );
    console.log("bank_accounts default row enriched");
  } catch (e) {
    console.warn("bank_accounts UPDATE warn:", e.message);
  }

  // ---------- FIX merchant_business_info (email, country, language) ----------
  try {
    db.run(
      "UPDATE merchant_business_info SET business_email=?, business_country=?, language=?, updated_at=? WHERE merchant_id=?",
      ["a.medjoum@gmail.com", "AE", "EN", now, "MRC-1001"]
    );
    console.log("merchant_business_info enriched");
  } catch (e) {
    console.warn("business info UPDATE warn:", e.message);
  }

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log("\nDB_PERSISTED: " + dbPath);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
