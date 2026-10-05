/* eslint-disable */
const FS = require("fs");
const PATH = require("path");
const initSqlJs = require("sql.js");

const DB_PATH = PATH.join(__dirname, "data", "database.sqlite");
const ORIG_ENV_KEY = "a31e9592f9b3ae376e461c4da72b89c85a9425dedf1417e4a6fdaea11b96ad06";
const ORIG_ENV_LABEL = "environment vault bank";

(async () => {
  console.log("=== REVERT vault_api_keys: deactivate transak row, reactivate original environment key ===");
  const SQL = await initSqlJs();
  const db = new SQL.Database(FS.readFileSync(DB_PATH));
  function q(sql, params = []) {
    const stmt = db.prepare(sql); stmt.bind(params);
    const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
  }
  function run(sql, params = []) { db.run(sql, params); }
  function persist() {
    FS.writeFileSync(DB_PATH, Buffer.from(db.export()));
    console.log("  → DB persisted");
  }

  const before = q("SELECT id, api_key, label, active FROM vault_api_keys ORDER BY active DESC, created_at DESC");
  console.log("BEFORE:");
  before.forEach(r => console.log("   id=%s active=%s key=%s… label=%s", r.id, r.active, r.api_key.slice(0,8), JSON.stringify(r.label)));

  // (1) Find the row labelled "environment vault bank" (the one seeded at startup from VAULT_BANK_* env). If not, pick one whose api_key prefix matches ORIG_ENV_KEY.slice(0,8)
  let origRow = before.find(r => r.label === ORIG_ENV_LABEL);
  if (!origRow) origRow = before.find(r => r.api_key.startsWith(ORIG_ENV_KEY.slice(0, 16)));
  if (!origRow) {
    console.error("❌ Cannot locate original environment vault bank row (label=" + ORIG_ENV_LABEL + ", prefix=" + ORIG_ENV_KEY.slice(0, 16) + "…). Aborting.");
    process.exit(2);
  }
  console.log("TARGET: original environment row id=%s key=%s…", origRow.id, origRow.api_key.slice(0,16));

  // (2) Revoke the transak-key row we inserted in the previous step (api_key prefix "9aa51553")
  run("UPDATE vault_api_keys SET active = 0 WHERE api_key LIKE '9aa51553%'");
  const revokeCount = db.getRowsModified ? db.getRowsModified() : q("SELECT changes() AS c")[0].c;
  console.log("Revoked transak row(s): " + revokeCount);

  // (3) Reactivate the original environment row
  run("UPDATE vault_api_keys SET active = 1 WHERE id = ?", [origRow.id]);
  console.log("Re-activated original env row id=" + origRow.id);

  // (4) Also deactivate any other row whose api_key matches exactly the Transak UUID pattern (belt-and-suspenders)
  run("UPDATE vault_api_keys SET active = 0 WHERE id LIKE 'vault-key-wise-%'");

  const after = q("SELECT id, api_key, secret_key, label, active FROM vault_api_keys ORDER BY active DESC, created_at DESC");
  console.log("\nAFTER:");
  after.forEach((r, i) => {
    const tag = r.active ? "[ACTIVE] " : "[revoked] ";
    console.log("   ["+i+"] "+tag+" id="+r.id+" key="+r.api_key.slice(0,8)+"…"+r.api_key.slice(-4)+" sec="+r.secret_key.slice(0,4)+"… label="+JSON.stringify(r.label));
  });

  const active = after.find(r => r.active === 1);
  const EXPECTED_KEY_PREFIX = ORIG_ENV_KEY.slice(0,16);
  if (!active) { console.error("❌ No active row after revert"); process.exit(3); }
  if (!active.api_key.startsWith(EXPECTED_KEY_PREFIX)) {
    console.error("❌ Active row api_key does not start with expected environment prefix", EXPECTED_KEY_PREFIX, " got:", active.api_key);
    process.exit(4);
  }
  console.log("\n✅ Revert OK: vault bank API key is now the original environment-seeded pair. Transak keys are stored ONLY in TRANSAK_* env vars.");

  persist();
  process.exit(0);
})().catch(e => { console.error("UNHANDLED:", e); process.exit(99); });
