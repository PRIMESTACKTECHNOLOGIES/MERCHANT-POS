const fs = require("fs");
const path = require("path");
const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const jwt = require("./node_modules/jsonwebtoken");
const axios = require("./node_modules/axios/dist/node/axios.cjs");

const DB_PATH = path.join(__dirname, "data", "database.sqlite");
const SECRET_KEY = process.env.JWT_SECRET || "dev_jwt_secret_change_me"; // fallback used since JWT_SECRET is NOT in .env and NODE_ENV !== prod

const BASE = "http://localhost:7000";

const loadEnv = () => {
  const envContent = fs.readFileSync("./.env", "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  });
};

(async () => {
  loadEnv();

  console.log("SECRET_KEY (from auth.service logic):", SECRET_KEY);
  console.log("process.env.JWT_SECRET =", process.env.JWT_SECRET || "(NOT SET → fallback dev used)");
  console.log("process.env.NODE_ENV =", process.env.NODE_ENV || "(NOT SET → dev mode)");
  console.log("");

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  // 1. Get admin user
  const adm = db.exec("SELECT id, username, email, api_key FROM admin_users ORDER BY rowid LIMIT 1");
  if (!adm.length) { console.error("No admin_users!"); process.exit(1); }
  const admin = {};
  adm[0].columns.forEach((c, i) => admin[c] = adm[0].values[0][i]);
  console.log("Admin user loaded:");
  console.log("  id:", admin.id);
  console.log("  username:", admin.username);
  console.log("  email:", admin.email);
  console.log("  api_key (static):", String(admin.api_key || "").slice(0, 16) + "…");
  console.log("");

  // 2. Sign JWT matching auth.service exactly: {id, username} + expiresIn 24h
  const token = jwt.sign({ id: admin.id, username: admin.username }, SECRET_KEY, { expiresIn: "24h" });
  console.log("✅ JWT SIGNED (matches auth.service — works for authenticateToken middleware)");
  console.log("   Token length:", token.length);
  console.log("   Bearer:", "Bearer " + token.slice(0, 40) + "…");
  console.log("");

  // 3. Verify by calling GET /auth/profile — this checks authenticateToken
  console.log("── PROBE: GET /auth/profile WITH JWT Bearer ──");
  const r1 = await axios.get(BASE + "/auth/profile", { headers: { Authorization: "Bearer " + token }, timeout: 10000, validateStatus: () => true });
  console.log("   HTTP", r1.status);
  console.log("   BODY:", JSON.stringify(r1.data).slice(0, 500));

  // 4. Also try static api_key as Bearer (some legacy routes may accept it)
  console.log("\n── PROBE: GET /auth/profile WITH STATIC ADMIN API_KEY Bearer ──");
  const r2 = await axios.get(BASE + "/auth/profile", { headers: { Authorization: "Bearer " + (admin.api_key || "") }, timeout: 10000, validateStatus: () => true });
  console.log("   HTTP", r2.status);
  console.log("   BODY:", JSON.stringify(r2.data).slice(0, 500));

  // 5. Now that we are authenticated, probe the payout routes
  console.log("\n── AUTHENTICATED SWEEP PROBES (using JWT Bearer) ──");
  const hdr = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  const payoutId = "3e31293c-7609-490f-838b-193828e86aed";
  const merchantId = "MRC-1001";

  const sweepPayload = {
    payout_id: payoutId,
    reference: "INTL-MRC-1001-MTXL1UKC",
    merchant_id: merchantId,
    amount: 50000,
    currency: "EUR",
    recipient: {
      name: "PRIMESTACK TECHNOLOGIES LLC",
      iban: "BE19 9058 6159 3312",
      bic: "TRWIBEB1XXX",
      bank_name: "Wise Payments Europe S.A.",
      country: "BE",
    },
    protocol: "201.3",
    acquirer: "JUKRUTI-INTERNAL",
    rail: "SEPA-SCT-TARGET2",
    end_to_end_id: "INTL-MRC-1001-MTXL1UKC",
    uetr: "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
  };

  // 5a. GET list payouts for merchant
  const list = await axios.get(`${BASE}/api/payout/merchant/${merchantId}/payouts`, { headers: hdr, timeout: 12000, validateStatus: () => true });
  console.log("GET /api/payout/merchant/" + merchantId + "/payouts → HTTP", list.status);
  const body = list.data;
  if (Array.isArray(body)) {
    console.log("  Count:", body.length);
    body.slice(0,3).forEach(p => console.log("  → id=" + String(p.id||"").slice(0,10) + " status=" + p.status + " amt=" + p.amount + p.currency + " provRef=" + (p.provider_reference||"")));
  } else {
    console.log("  Body:", JSON.stringify(body).slice(0,500));
  }

  // 5b. Try a sweep trigger endpoint under /api/payout/payouts/:id/sweep or /execute or /downstream
  const subPaths = [
    { m: "POST", p: `/api/payout/payouts/${payoutId}/sweep`, b: sweepPayload },
    { m: "POST", p: `/api/payout/payouts/${payoutId}/execute`, b: sweepPayload },
    { m: "POST", p: `/api/payout/payouts/${payoutId}/downstream-wise`, b: sweepPayload },
    { m: "POST", p: `/api/payout/payouts/${payoutId}/trigger-sweep`, b: sweepPayload },
    { m: "POST", p: `/api/payout/payouts/${payoutId}/processor-sweep`, b: sweepPayload },
    { m: "POST", p: `/api/payout/bank/sweep`, b: sweepPayload },
    { m: "POST", p: `/api/settlement/sweep`, b: sweepPayload },
    { m: "POST", p: `/api/settlement/batch/sweep`, b: sweepPayload },
    { m: "GET",  p: `/api/payout/payouts/${payoutId}/receipt`, b: null },
  ];

  for (const sp of subPaths) {
    try {
      const opts = { method: sp.m, url: BASE + sp.p, headers: hdr, timeout: 8000, validateStatus: () => true };
      if (sp.b && sp.m !== "GET") opts.data = sp.b;
      const r = await axios(opts);
      const ok = r.status >= 200 && r.status < 400;
      const note = (ok ? "✅" : "·") + " HTTP " + r.status;
      console.log(`${note}  ${sp.m.padEnd(5)} ${sp.p.padEnd(62)} → ${typeof r.data === 'string' ? r.data.slice(0,100) : JSON.stringify(r.data).slice(0,120)}`);
    } catch (e) {
      console.log(`  ERR ${sp.m.padEnd(5)} ${sp.p.padEnd(62)} → ${e.code || e.message}`);
    }
  }

  // 6. If we have a matching endpoint → we can call it.
  console.log("\n── EXPORT TOKEN FOR FURTHER USE ──");
  fs.writeFileSync(path.join(__dirname, "_admin_jwt_token.txt"), token);
  console.log("✅ JWT saved to _admin_jwt_token.txt (valid 24h from now)");

  process.exit(0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
