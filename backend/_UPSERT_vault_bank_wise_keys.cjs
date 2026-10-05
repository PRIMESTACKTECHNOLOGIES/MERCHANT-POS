/* eslint-disable */
const FS = require("fs");
const PATH = require("path");
const initSqlJs = require("sql.js");

const NEW_API_KEY = "9aa51553-51a5-40c5-b272-7ab9f29a6f44";
const NEW_SECRET  = "PRTytA3z3HuHQe+FlSQ04Q==";
const DB_PATH = PATH.join(__dirname, "data", "database.sqlite");

(async () => {
  console.log("=== UPSERT vault bank Wise/vault API key pair ===");
  console.log("[i] DB_PATH =", DB_PATH);
  console.log("[i] NEW VAULT_BANK_API_KEY =", NEW_API_KEY);
  console.log("[i] NEW VAULT_BANK_SECRET_KEY (len=", NEW_SECRET.length, ") =", NEW_SECRET.slice(0, 5) + "…" + NEW_SECRET.slice(-4));

  if (!FS.existsSync(DB_PATH)) {
    console.error("❌ No database at", DB_PATH);
    process.exit(2);
  }

  const SQL = await initSqlJs();
  const bytes = FS.readFileSync(DB_PATH);
  const db = new SQL.Database(bytes);

  function q(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  function run(sql, params = []) { db.run(sql, params); }

  function persist() {
    const data = db.export();
    const buf = Buffer.from(data);
    FS.writeFileSync(DB_PATH, buf);
    console.log("  → persisted to disk");
  }

  // (1) Sanity: ensure vault_api_keys table exists
  const tables = q("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vault_api_keys','vault_api_nonces')");
  console.log("[1] Tables present:", tables.map(r => r.name).join(", ") || "NONE");
  if (!tables.find(r => r.name === "vault_api_keys")) {
    run(`CREATE TABLE IF NOT EXISTS vault_api_keys (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    )`);
    run(`CREATE TABLE IF NOT EXISTS vault_api_nonces (
      api_key TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (api_key, nonce)
    )`);
    console.log("  → created vault_api_keys + vault_api_nonces tables");
  }

  // (2) Show current rows
  const before = q("SELECT id, api_key, secret_key, label, active, created_at, last_used_at FROM vault_api_keys ORDER BY active DESC, created_at DESC");
  console.log("[2] BEFORE vault_api_keys rows:", before.length);
  before.forEach((r, i) => {
    console.log(`   [${i}] id=${r.id} active=${r.active} api_key=${r.api_key.slice(0,8)}…${r.api_key.slice(-4)} secret=${r.secret_key.slice(0,5)}…${r.secret_key.slice(-4)} label=${r.label || 'NULL'} created=${r.created_at}`);
  });

  // (3) Revoke all currently active keys (set active=0)
  const revoked = q("SELECT id FROM vault_api_keys WHERE active = 1");
  run("UPDATE vault_api_keys SET active = 0 WHERE active = 1");
  console.log(`[3] Revoked ${revoked.length} prior active key(s)`);

  // (4) Insert the new key/secret pair as active
  const newId = "vault-key-wise-" + Date.now();
  const createdAt = new Date().toISOString();
  run(
    `INSERT INTO vault_api_keys (id, api_key, secret_key, label, active, created_at, last_used_at)
     VALUES (?, ?, ?, ?, 1, ?, NULL)`,
    [newId, NEW_API_KEY, NEW_SECRET, "Wise Bank Vault Gateway Key", createdAt]
  );
  console.log(`[4] INSERTED new row id=${newId}, createdAt=${createdAt}`);

  // (5) Verify unique constraint didn't silently skip (SQL.js throws on duplicate)
  const after = q("SELECT id, api_key, secret_key, label, active, created_at FROM vault_api_keys ORDER BY active DESC, created_at DESC");
  console.log("[5] AFTER vault_api_keys rows:", after.length);
  after.forEach((r, i) => {
    const tag = r.active ? " ✅ ACTIVE" : " · revoked";
    console.log(`   [${i}]${tag} id=${r.id} api_key=${r.api_key.slice(0,8)}…${r.api_key.slice(-4)} secret=${r.secret_key.slice(0,5)}…${r.secret_key.slice(-4)} label=${r.label || 'NULL'}`);
  });

  // (6) Confirm the NEW_API_KEY is exactly the active one
  const activeRow = q("SELECT * FROM vault_api_keys WHERE active = 1 LIMIT 1")[0];
  if (!activeRow) { console.error("❌ No active row after insert"); process.exit(3); }
  if (activeRow.api_key !== NEW_API_KEY) { console.error("❌ Active api_key mismatch:", activeRow.api_key); process.exit(4); }
  if (activeRow.secret_key !== NEW_SECRET) { console.error("❌ Active secret_key mismatch"); process.exit(5); }
  console.log("[6] ✅ Active row matches provided Wise key/secret exactly");

  persist();

  // (7) Read-back raw masked view that matches /api/vault/security/api-key semantics
  function maskKey(k) { return `${k.slice(0, 8)}...${k.slice(-4)}`; }
  console.log("[7] Masked public view (as vault dashboard would show):");
  console.log("    apiKey:", maskKey(activeRow.api_key));
  console.log("    secretConfigured:", activeRow.secret_key ? true : false, "(len=" + activeRow.secret_key.length + ")");
  console.log("    label:", activeRow.label);
  console.log("    id:", activeRow.id);
  console.log("\n✅ DB upsert DONE (exit 0). Next: update backend/.env to match, then restart backend.");
  process.exit(0);
})().catch(e => { console.error("UNHANDLED:", e); process.exit(99); });
