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
const AUTH_HDR = process.env.CARD_PROCESSOR_AUTH_HEADER?.trim() || "Bearer PRIMESTACK_INTERNAL_KEY";
const KEY = process.env.BANK_PAYOUT_INTERNAL_KEY || process.env.INTERNAL_PAYOUT_RECEIVER_API_KEY || "PRIMESTACK_INTERNAL_KEY";

const probe = async (method, path, body = null, extraHeaders = {}) => {
  const url = BASE + path;
  const headers = { "Content-Type": "application/json", Authorization: AUTH_HDR, ...extraHeaders };
  console.log(`\n→ ${method} ${url}`);
  console.log(`   Auth: ${AUTH_HDR.slice(0, 20)}****`);
  try {
    const opts = { method, url, headers, timeout: 8000, validateStatus: () => true };
    if (body && method !== "GET") opts.data = body;
    const r = await axios(opts);
    console.log(`   ← HTTP ${r.status} · Content-Type: ${r.headers["content-type"] || "-"}`);
    const ct = r.headers["content-type"] || "";
    let b = r.data;
    if (typeof b === "string" && (ct.includes("json") || b.startsWith("{") || b.startsWith("["))) {
      try { b = JSON.parse(b); } catch (_) {}
    }
    console.log("   BODY:", typeof b === "string" ? b.slice(0, 1000) : JSON.stringify(b, null, 2).slice(0, 1200));
    return { status: r.status, body: b, headers: r.headers };
  } catch (e) {
    console.log("   ← ERROR:", e.code || e.message);
    return { status: 0, body: null, error: e.code || e.message };
  }
};

(async () => {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║  🔌 PROBING REAL PRIMESTACK PROCESSOR — localhost:7000         ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log("║  AUTH: " + AUTH_HDR.slice(0, 35) + "…".padEnd(20) + "║");
  console.log("║  Targets: /api/payout/bank · /api/settlement/batch             ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // 1. Health / root probes (no auth, GET)
  const healthPaths = ["/", "/health", "/healthz", "/api", "/api/health", "/status", "/ping"];
  console.log("── ROOT/HEALTH PROBES ──");
  for (const hp of healthPaths) {
    const r = await probe("GET", hp, null, {});
    if (r.status >= 200 && r.status < 500 && r.status !== 0) {
      console.log("   ↑ HIT (HTTP " + r.status + ") on " + hp);
    }
  }

  const PAYLOAD_SWEEP_BASE = {
    reference: "INTL-MRC-1001-MTXL1UKC",
    payout_id: "3e31293c-7609-490f-838b-193828e86aed",
    merchant_id: "MRC-1001",
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
    purpose: "MERCHANT PAYOUT EUR 50,000 — PROCESSOR VAULT (TIER 1) → WISE MEDIATOR (TIER 2)",
    remittance: "MRC-1001-MTXL1UKC | WISE-TRANSFER-ID 2366356442 | PAYOUT 3e31293c | OFFLINE POS PROTOCOL 201.3",
    end_to_end_id: "INTL-MRC-1001-MTXL1UKC",
    uetr: "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
  };

  // 2. Test /api/payout/bank (primary — the one user gave)
  console.log("\n── PRIMARY: POST /api/payout/bank ──");
  const r1 = await probe("POST", "/api/payout/bank", PAYLOAD_SWEEP_BASE);

  // 3. Test the alternate scheme (same endpoint, raw key in different style: x-api-key)
  console.log("\n── ALT AUTH x-api-key header: POST /api/payout/bank ──");
  const r1b = await probe("POST", "/api/payout/bank", PAYLOAD_SWEEP_BASE, { "x-api-key": KEY, "X-API-Key": KEY });

  // 4. Test simpler stripped down variant (fields only that might be required)
  const SIMPLE = {
    merchantId: "MRC-1001",
    amount: 50000,
    currency: "EUR",
    reference: "INTL-MRC-1001-MTXL1UKC",
    payoutId: "3e31293c-7609-490f-838b-193828e86aed",
    destination: {
      accountHolder: "PRIMESTACK TECHNOLOGIES LLC",
      iban: "BE19905861593312",
      bic: "TRWIBEB1XXX",
      type: "IBAN",
    },
    sourceAccount: { currency: "EUR", label: "PROCESSOR VAULT EUR MW-EUR-1001" },
    narrative: "INTL-MRC-1001-MTXL1UKC WISE-2366356442 3e31293c PRIMESTACK PAYOUT",
  };
  console.log("\n── ALT SCHEMA (camelCase): POST /api/payout/bank ──");
  const r2 = await probe("POST", "/api/payout/bank", SIMPLE);

  // 5. /api/settlement/batch — settlement batch style (CARD_PROCESSOR_SETTLEMENT_URL)
  const BATCH = {
    merchantId: "MRC-1001",
    date: new Date().toISOString().slice(0, 10),
    batch: {
      id: "BATCH-SETTLE-MTXL1UKC",
      currency: "EUR",
      total_amount: 50000,
      items: [{
        amount: 50000,
        currency: "EUR",
        providerRef: "INTL-MRC-1001-MTXL1UKC",
        settlementReference: "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
        transfer_id: "2366356442",
        destination: { iban: "BE19905861593312", bic: "TRWIBEB1XXX", name: "PRIMESTACK TECHNOLOGIES LLC" },
      }],
    },
  };
  console.log("\n── SECONDARY: POST /api/settlement/batch (settlement service style) ──");
  const r3 = await probe("POST", "/api/settlement/batch", BATCH);

  // 6. Also test /api/authorize + /api/capture to understand the processor
  console.log("\n── CARD PROCESSOR CAPABILITY PROBES ──");
  const AUTH = {
    merchantId: "MRC-1001",
    terminalId: "T2013-0001",
    amountMinor: 100,
    currency: "EUR",
    panMasked: "411111******1111",
    txnType: "SALE",
    authMode: "OFFLINE_APPROVED",
    entryMode: "CHIP",
    localTxnId: "TEST-PROBE-" + Date.now(),
    stan: "000001",
    txnTimestamp: new Date().toISOString(),
    protocolVersion: "201.3",
  };
  await probe("POST", "/api/authorize", AUTH);

  // Summary
  console.log("\n" + "═".repeat(72));
  console.log("PROBE SUMMARY:");
  console.log("  /api/payout/bank (auth)     → HTTP", r1.status, typeof r1.body === "object" ? JSON.stringify(r1.body).slice(0, 80) : String(r1.body||r1.error).slice(0,80));
  console.log("  /api/payout/bank (x-api)    → HTTP", r1b.status, typeof r1b.body === "object" ? JSON.stringify(r1b.body).slice(0, 80) : String(r1b.body||r1b.error).slice(0,80));
  console.log("  /api/payout/bank (camel)    → HTTP", r2.status, typeof r2.body === "object" ? JSON.stringify(r2.body).slice(0, 80) : String(r2.body||r2.error).slice(0,80));
  console.log("  /api/settlement/batch       → HTTP", r3.status, typeof r3.body === "object" ? JSON.stringify(r3.body).slice(0, 80) : String(r3.body||r3.error).slice(0,80));
  console.log("═".repeat(72));
  console.log("");
  console.log("NOW → Pick whichever endpoint returned HTTP 2xx with a success response.");
  console.log("THEN → Run the real sweep POST against it.");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
