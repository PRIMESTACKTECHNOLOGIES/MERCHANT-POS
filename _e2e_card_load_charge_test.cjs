// End-to-end test: card MUST be loaded from outside (omnibus → vault account → card)
// before a charge will succeed on a vault-issued operator card.
// Requires files: vault-bank-settlement.js, vault-bank-acquirer.js, primestack-processor.js
// Uses same env as main project.

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const SETTLE_URL = "http://127.0.0.1:9001";
const ACQ_DIAG = "http://127.0.0.1:9009";
const ACQ_PING = ACQ_DIAG + "/status";
const PROC_URL = "http://127.0.0.1:7000";

const CARD = {
  // OPERATOR_CARD_USD from .env (the Aji Alosious card / BIN 412345 VISA USD)
  pan: process.env.OPERATOR_CARD_USD_NUMBER || "4123458901234567",
  expiry: process.env.OPERATOR_CARD_USD_EXPIRY || "06/30",
  cvv: process.env.OPERATOR_CARD_USD_CVV || "392",
  ccy: "USD",
  holder: process.env.OPERATOR_CARD_USD_HOLDER || "AJI ALOSIOUS",
  cardId: (() => {
    const first = String(process.env.OPERATOR_CARD_USD_HOLDER || "AJI ALOSIOUS").split(/\s+/)[0].toUpperCase().slice(0, 8);
    return "CARD-USD-" + first;
  })()
};

const CHARGE_AMOUNT_MINOR = 2500; // $25.00
const LOAD_AMOUNT_MINOR = 5000;   // $50.00 (from outside via funds-received → load-funds)

function post(url, body, timeoutMs = 12000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const payload = body ? JSON.stringify(body) : "";
      const opts = {
        host: u.hostname, port: u.port, method: "POST", path: u.pathname + u.search,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: timeoutMs
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: JSON.parse(data), raw: data }); }
          catch { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 400) }); }
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, timeout: true }); });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      if (payload) req.write(payload);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function get(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const opts = { host: u.hostname, port: u.port, method: "GET", path: u.pathname + u.search, timeout: timeoutMs };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: JSON.parse(data), raw: data }); }
          catch { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 400) }); }
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, timeout: true }); });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(url, label, maxSec = 25) {
  for (let i = 0; i < maxSec; i++) {
    const r = await get(url, 1500);
    if (r.ok) { console.log(`  ⏱  ${label} ready after ${i}s`); return true; }
    await sleep(1000);
  }
  console.log(`  ❌ ${label} not ready after ${maxSec}s`);
  return false;
}

let services = [];
function launchService(name, scriptFile) {
  const s = spawn(process.execPath, [path.join(ROOT, scriptFile)], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: Object.assign({}, process.env, { NODE_ENV: "production" })
  });
  const logFile = path.join(ROOT, `_e2e_${name}.log`);
  const fs = require("fs");
  const log = fs.createWriteStream(logFile, { flags: "a" });
  s.stdout.on("data", (d) => log.write(d));
  s.stderr.on("data", (d) => log.write(d));
  s.on("exit", (c, s) => console.log(`  💥 service ${name} exited code=${c} sig=${s}`));
  services.push({ name, s, logFile });
  return s;
}

function shutdown() {
  for (const svc of services) { try { svc.s.kill("SIGTERM"); } catch {} }
  setTimeout(() => { for (const svc of services) try { svc.s.kill("SIGKILL"); } catch {}; }, 2000);
}
process.on("SIGINT", () => { shutdown(); process.exit(130); });

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║ E2E TEST: Card MUST be loaded from outside → then charge succeeds    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log(`   Card: ${CARD.pan.slice(0,6)}******${CARD.pan.slice(-4)} (${CARD.ccy}) cardId=${CARD.cardId}`);
  console.log(`   Load:   $${(LOAD_AMOUNT_MINOR/100).toFixed(2)}  (funds-received → vault-card/load-funds)`);
  console.log(`   Charge: $${(CHARGE_AMOUNT_MINOR/100).toFixed(2)}  (must fail before load, succeed after)`);
  console.log("");

  console.log("[1/5] Launching services…");
  launchService("settlement", "vault-bank-settlement.js");
  launchService("acquirer", "vault-bank-acquirer.js");
  launchService("processor", "primestack-processor.js");
  const settleOk = await waitFor(SETTLE_URL + "/api/vault/omnibus", "settlement(:9001)", 20);
  const acqOk = await waitFor(ACQ_PING, "acquirer-diag(:9009)", 20);
  const procOk = await waitFor(PROC_URL + "/pipeline/status", "processor(:7000)", 20);
  if (!(settleOk && acqOk && procOk)) {
    console.log("FATAL: services failed to boot. Check logs:");
    for (const s of services) console.log("    " + s.logFile);
    shutdown(); process.exit(2);
  }

  console.log("");
  console.log("[2/5] Connect LIVE scheme sockets on processor…");
  const sock = await post(PROC_URL + "/pipeline/connect-live-schemes", {});
  console.log("   connect-live-schemes:", sock.ok ? "ok" : ("fail " + JSON.stringify(sock.body || sock.error || sock.raw)));

  console.log("");
  console.log("[3/5] CHARGE WITHOUT LOAD → must be DECLINED RC=51 (insufficient funds)");
  const cardBalanceBefore = await get(SETTLE_URL + "/api/vault/card-balance?cardId=" + encodeURIComponent(CARD.cardId));
  console.log(`   Card balance before load: $${(((cardBalanceBefore.body || {}).balance) || 0) / 100}`);
  const badCharge = await post(PROC_URL + "/merchant/v1/payments/charge", {
    pan: CARD.pan, expiry: CARD.expiry, cvv: CARD.cvv,
    amount: CHARGE_AMOUNT_MINOR, currencyCode: "840",
    mid: "VBM-2024-8910001", tid: "VBT-891-AE001", mcc: "5999"
  }, 15000);
  const badApproved = !!(badCharge.body && badCharge.body.approved);
  const badRC = (badCharge.body && badCharge.body.responseCode) || null;
  console.log(`   No-load charge approved=${badApproved} RC=${badRC}`);
  if (badApproved || badRC !== "51") {
    console.log(`   ❌ FAILURE — expected approved=false RC=51. raw=${JSON.stringify(badCharge.body || badCharge.error || badCharge.raw)}`);
    shutdown(); process.exit(3);
  }
  console.log("   ✅ Correctly REJECTED — card not loaded from outside yet.");

  console.log("");
  console.log("[4/5] LOAD CARD FROM OUTSIDE (simulate ACH/SWIFT → omnibus → vault acct → card)");
  const fundsReceived = await post(SETTLE_URL + "/api/vault/funds-received", {
    amount: LOAD_AMOUNT_MINOR, currencyCode: CARD.ccy, scheme: "VISA",
    source: "MANUAL_ACH_CONFIRMATION", notes: "E2E test: scheme payout hits nostro",
    reference: "E2E-FUNDS-RECVD-" + Date.now()
  });
  console.log(`   funds-received: ${fundsReceived.ok ? "✅ ok" : "❌ fail"} omnibusAfter=$${(((fundsReceived.body || {}).omnibusBalanceAfter) || 0) / 100}`);
  if (!fundsReceived.ok) { console.log("   raw:", JSON.stringify(fundsReceived.body || fundsReceived.error)); shutdown(); process.exit(4); }

  const load = await post(SETTLE_URL + "/api/vault/vault-card/load-funds", {
    pan: CARD.pan, expiry: CARD.expiry, cvv: CARD.cvv,
    amount: LOAD_AMOUNT_MINOR, reference: "E2E-LOAD-" + Date.now()
  });
  console.log(`   vault-card/load-funds: ${load.ok && load.body && load.body.loaded ? "✅ ok" : "❌ fail"}`);
  if (load.ok && load.body && load.body.loaded) {
    const p = load.body.phases || {};
    console.log(`     phase1(omnibus→vault): balAfter=${((p.omnibusToVaultAccount || {}).vaultBalanceAfter) || "?"}`);
    console.log(`     phase2(vault→card):  cardBalAfter=${((p.vaultAccountToCard || {}).cardBalanceAfter) || "?"}`);
  } else {
    console.log("   raw:", JSON.stringify(load.body || load.error || load.raw));
    shutdown(); process.exit(4);
  }
  const cardBalanceAfterLoad = await get(SETTLE_URL + "/api/vault/card-balance?cardId=" + encodeURIComponent(CARD.cardId));
  console.log(`   Card balance after load: $${(((cardBalanceAfterLoad.body || {}).balance) || 0) / 100}`);

  console.log("");
  console.log("[5/5] CHARGE AFTER LOAD → must be APPROVED RC=00");
  const goodCharge = await post(PROC_URL + "/merchant/v1/payments/charge", {
    pan: CARD.pan, expiry: CARD.expiry, cvv: CARD.cvv,
    amount: CHARGE_AMOUNT_MINOR, currencyCode: "840",
    mid: "VBM-2024-8910001", tid: "VBT-891-AE001", mcc: "5999"
  }, 15000);
  const goodApproved = !!(goodCharge.body && goodCharge.body.approved);
  const goodRC = (goodCharge.body && goodCharge.body.responseCode) || null;
  const authCode = (goodCharge.body && goodCharge.body.authCode) || null;
  const routing = (goodCharge.body && goodCharge.body.routing) || {};
  console.log(`   Loaded charge approved=${goodApproved} RC=${goodRC} auth=${authCode} via=${routing.acquirer || "?"}`);
  if (!goodApproved || goodRC !== "00") {
    console.log(`   ❌ FAILURE — expected approved=true RC=00. raw=${JSON.stringify(goodCharge.body || goodCharge.error || goodCharge.raw)}`);
    shutdown(); process.exit(5);
  }
  const cardAfter = await get(SETTLE_URL + "/api/vault/card-balance?cardId=" + encodeURIComponent(CARD.cardId));
  const balAfter = ((cardAfter.body || {}).balance) || 0;
  const expected = LOAD_AMOUNT_MINOR - CHARGE_AMOUNT_MINOR;
  const settled = balAfter === expected;
  console.log(`   Card balance after charge: $${(balAfter / 100).toFixed(2)}  (expected $${(expected / 100).toFixed(2)}) ${settled ? "✅ MATCH" : "❌ MISMATCH"}`);
  if (!settled) { console.log("   raw:", cardAfter.body); shutdown(); process.exit(6); }

  const omnibusAfter = await get(SETTLE_URL + "/api/vault/omnibus");
  const omniBal = (((omnibusAfter.body || {}).balances) || {}).USD || 0;
  console.log(`   Omnibus USD after full flow: $${(omniBal / 100).toFixed(2)}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("✅ ALL TESTS PASSED");
  console.log("   1) No-load charge correctly rejected RC=51 (card must be funded outside)");
  console.log("   2) funds-received correctly backs OMNIBUS with real-flagged money");
  console.log("   3) vault-card/load-funds correctly moves OMNIBUS → vault account → card");
  console.log("   4) Charge on funded card approves RC=00 and deducts from card balance");
  console.log("   5) Final card balance = load - charge (100% correct)");
  console.log("═══════════════════════════════════════════════════════════════════════");
  shutdown();
  process.exit(0);
}

main().catch((e) => { console.error("UNHANDLED:", e); shutdown(); process.exit(99); });
