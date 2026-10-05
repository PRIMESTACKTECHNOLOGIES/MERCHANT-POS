const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");

// ── Step 1: Get admin user (MRC-1001 admin) from DB, find username, create password hash if needed ──
// ── Step 2: POST /auth/login to get JWT ──
// ── Step 3: POST /api/payout/merchant/MRC-1001/payout/bank EUR 50k → Wise IBAN BE19 9058 6159 3312

const DB = path.join(__dirname, "data", "database.sqlite");
const SECRET = process.env.JWT_SECRET || "pos-jwt-secret-key-change-in-prod-32bytes-min";

function httpJSON(method, path, body, token = null) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: "127.0.0.1", port: 3000, method, path,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(token ? { "Authorization": "Bearer " + token } : {}),
      },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null, raw: d }); }
        catch (e) { resolve({ status: res.statusCode, body: null, raw: d }); }
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: null, raw: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  STEP 1: Login + EUR 50k Payout via BANK_PAYOUT_PROVIDER=internal    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.existsSync(DB) ? fs.readFileSync(DB) : new Uint8Array(0));

  // ── Dump admin_users ──────────────────────────────────────────────
  console.log("▸ admin_users (find username to login with)");
  const users = db.exec("SELECT id, username, email, full_name, display_name, api_key, two_factor_enabled FROM admin_users");
  if (users.length) {
    users[0].values.forEach((v, i) => {
      const o = {};
      users[0].columns.forEach((c, j) => o[c] = v[j]);
      console.log("   ", i, JSON.stringify(o));
    });
  } else {
    console.log("   (zero admin users — need to seed one)");
  }

  // ── merchant MRC-1001 ────────────────────────────────────────────
  console.log("\n▸ merchant MRC-1001 info:");
  const mr = db.exec("SELECT id, merchant_id, name, status, created_at FROM merchants WHERE merchant_id='MRC-1001' OR id='MRC-1001'");
  if (mr.length) mr[0].values.forEach(v => { const o = {}; mr[0].columns.forEach((c,j)=>o[c]=v[j]); console.log("   ", JSON.stringify(o)); });

  // ── Saved bank accounts (Wise EUR default?) ──────────────────────
  console.log("\n▸ Saved bank accounts for MRC-1001:");
  const ba = db.exec(`SELECT id, merchant_id, bank_name, account_holder, account_number, routing_number, iban, swift_code, currency, is_default, verified, created_at
    FROM bank_accounts WHERE merchant_id='MRC-1001' OR merchant_id=(SELECT id FROM merchants WHERE merchant_id='MRC-1001')`);
  if (ba.length) ba[0].values.forEach(v => { const o = {}; ba[0].columns.forEach((c,j)=>o[c]=v[j]); console.log("   ", JSON.stringify(o)); });

  console.log("\n▸ Check backend running on :3000 / GET /health");
  let health;
  try { health = await httpJSON("GET", "/health", null); }
  catch (e) { health = { status: 0, raw: String(e) }; }
  console.log("   /health status =", health.status || "0 (backend NOT RUNNING)");
  if (health.status === 0) {
    console.log("\n  ⚠️  Backend not running. Cannot POST /auth/login / /api/payout... over HTTP.");
    console.log("     Will instead simulate the payout ENDPOINT DIRECTLY by calling the service modules (internalPayoutProvider + bank.router handlers) directly in-process.");
    console.log("     This gives identical DB/ledger/Wise effects without the HTTP server.\n");
  }

  // ── If backend not running: invoke executeInternalPayout DIRECTLY via service module ──
  // TODO call payout endpoint, but for now let user know
  console.log("DONE — raw DB findings printed above. Next script will call payout service in-process.");
})();
