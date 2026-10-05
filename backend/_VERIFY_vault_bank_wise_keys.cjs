/* eslint-disable */
const FS = require("fs");
const PATH = require("path");
const initSqlJs = require("sql.js");

const EXPECTED_KEY = "9aa51553-51a5-40c5-b272-7ab9f29a6f44";
const EXPECTED_SEC = "PRTytA3z3HuHQe+FlSQ04Q==";
const DB_PATH = PATH.join(__dirname, "data", "database.sqlite");

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(FS.readFileSync(DB_PATH));
  const stmt = db.prepare("SELECT id, api_key, secret_key, label, active, created_at FROM vault_api_keys ORDER BY active DESC, created_at DESC LIMIT 5");
  stmt.bind();
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  console.log("vault_api_keys ordered by (active DESC, created DESC):");
  rows.forEach((r, i) => {
    const k = String(r.api_key || "");
    const s = String(r.secret_key || "");
    const tag = r.active ? "[ACTIVE]" : "[revoked]";
    console.log(
      "  [" + i + "] " + tag +
      " id=" + r.id +
      " key=" + k.slice(0, 8) + "..." + k.slice(-4) +
      " sec=" + s.slice(0, 4) + "..." + s.slice(-4) +
      " label=" + JSON.stringify(r.label || "")
    );
  });

  const a = rows[0];
  if (!a) { console.log("FAIL: no rows"); process.exit(2); }

  const ok =
    a.active === 1 &&
    a.api_key === EXPECTED_KEY &&
    a.secret_key === EXPECTED_SEC;

  console.log("");
  console.log("VERIFY active=1:", a.active === 1);
  console.log("VERIFY api_key exact match:", a.api_key === EXPECTED_KEY);
  console.log("VERIFY secret_key exact match:", a.secret_key === EXPECTED_SEC);
  console.log("");

  if (!ok) {
    console.log("❌ Verification FAILED");
    process.exit(1);
  }
  console.log("✅ ALL VERIFIED: vault bank's active API key/secret are exactly the Wise credentials provided.");
  process.exit(0);
})().catch(e => { console.error("UNHANDLED:", e); process.exit(99); });
