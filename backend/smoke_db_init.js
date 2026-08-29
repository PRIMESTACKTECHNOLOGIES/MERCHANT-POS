const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const MERCHANT_ID = "MRC-1001";
const TERMINAL_ID = "TERM-2013-SMOKE-01";
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  try { db.run("ALTER TABLE merchant_settings ADD COLUMN support_phone TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN display_name TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN display_currency TEXT DEFAULT 'USD'"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN extended_settings TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN payment_config TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN features TEXT"); } catch (_) {}

  const existing = db.exec(
    "SELECT merchant_id, api_key FROM merchant_settings WHERE merchant_id = ? LIMIT 1",
    [MERCHANT_ID]
  );

  if (!existing.length || !existing[0].values.length) {
    const apiKey = "sk_test_smoke_" + crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO merchant_settings (merchant_id, api_key, merchant_name, display_name, display_currency, features) VALUES (?,?,?,?,?,?)",
      [
        MERCHANT_ID,
        apiKey,
        "ALRKN ALRAQY HOTEL MANAGEMENT LLC",
        "ALRKN ALRAQY HOTEL",
        "AED",
        JSON.stringify({ manualEntry: true, refunds: true, tips: true })
      ]
    );
    console.log("[DBINIT] ✅ Inserted merchant MRC-1001 with new API key:", apiKey.substring(0, 20) + "...");
  } else {
    const row = existing[0].values[0];
    console.log("[DBINIT] ✅ Merchant MRC-1001 already exists. api_key present:", !!row[1]);
    if (!row[1]) {
      const apiKey = "sk_test_smoke_" + crypto.randomBytes(16).toString("hex");
      db.run("UPDATE merchant_settings SET api_key = ? WHERE merchant_id = ?", [apiKey, MERCHANT_ID]);
      console.log("[DBINIT] ✅ Populated missing merchant API key:", apiKey.substring(0, 20) + "...");
    }
  }

  try { db.run("ALTER TABLE terminals ADD COLUMN terminal_secret TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE terminals ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}

  const tRows = db.exec(
    "SELECT terminal_id, terminal_secret FROM terminals WHERE terminal_id = ? AND merchant_id = ? LIMIT 1",
    [TERMINAL_ID, MERCHANT_ID]
  );

  if (!tRows.length || !tRows[0].values.length) {
    const termSecret = "term_secret_" + crypto.randomBytes(24).toString("hex");
    try {
      db.run(
        "INSERT INTO terminals (terminal_id, merchant_id, terminal_secret) VALUES (?,?,?)",
        [TERMINAL_ID, MERCHANT_ID, termSecret]
      );
      console.log("[DBINIT] ✅ Inserted terminal " + TERMINAL_ID + " with per-terminal secret");
    } catch (insertErr) {
      console.log("[DBINIT] ⚠ Terminal insert skipped (schema):", insertErr.message);
    }
  } else {
    const row = tRows[0].values[0];
    console.log("[DBINIT] ✅ Terminal " + TERMINAL_ID + " already exists. Secret present:", !!row[1]);
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log("\n[DBINIT] ✅ All setup complete. Safe to start server now.");
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
