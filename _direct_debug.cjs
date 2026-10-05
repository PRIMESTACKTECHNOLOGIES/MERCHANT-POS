// Direct debug: test the validate + acquirer flow step by step
try { require("dotenv").config(); } catch {}
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const services = [];

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
        res.on("end", () => { try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: JSON.parse(data), raw: data }); }
          catch { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 600) }); } });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, timeout: true }); });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      if (payload) req.write(payload);
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
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
        res.on("end", () => { try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: JSON.parse(data), raw: data }); }
          catch { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 400) }); } });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, timeout: true }); });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function launch(name, script) {
  const logFile = path.join(ROOT, "_dbg_" + name + ".log");
  try { fs.truncateSync(logFile, 0); } catch {}
  const s = spawn(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const log = fs.createWriteStream(logFile);
  s.stdout.on("data", d => log.write(d));
  s.stderr.on("data", d => log.write(d));
  services.push({ name, s, logFile });
  return logFile;
}

async function waitFor(url, label, max = 25) {
  for (let i = 0; i < max; i++) {
    const r = await get(url, 1500);
    if (r.ok) return true;
    await sleep(1000);
  }
  return false;
}

function shutdown() {
  for (const s of services) try { s.s.kill("SIGTERM"); } catch {}
  setTimeout(() => { for (const s of services) try { s.s.kill("SIGKILL"); } catch {}; }, 2000);
}

(async () => {
  const pan = process.env.OPERATOR_CARD_USD_NUMBER || "4123458901234567";
  const expiry = process.env.OPERATOR_CARD_USD_EXPIRY || "06/30";
  const cvv = process.env.OPERATOR_CARD_USD_CVV || "392";

  console.log("Launching 3 services...");
  const sLog = launch("settlement", "vault-bank-settlement.js");
  const aLog = launch("acquirer", "vault-bank-acquirer.js");
  const pLog = launch("processor", "primestack-processor.js");
  if (!(await waitFor("http://127.0.0.1:9001/api/vault/omnibus", "settlement"))) { console.log("settle failed"); process.exit(1); }
  if (!(await waitFor("http://127.0.0.1:9009/status", "acquirer"))) { console.log("acq failed"); process.exit(2); }
  if (!(await waitFor("http://127.0.0.1:7000/pipeline/status", "processor"))) { console.log("proc failed"); process.exit(3); }
  await post("http://127.0.0.1:7000/pipeline/connect-live-schemes", {});
  await sleep(2000);

  console.log("\n=== STEP 1: Settlement validateVaultCard ===");
  const sv = await post("http://127.0.0.1:9001/api/vault/vault-card/validate", { pan, expiry, cvv });
  console.log("  validate:", sv.ok, JSON.stringify(sv.body || sv.error || sv.raw));

  console.log("\n=== STEP 2: Card balance (before load) ===");
  const balBef = await get("http://127.0.0.1:9001/api/vault/card-balance?cardId=" + encodeURIComponent("CARD-USD-AJI"));
  console.log("  balance:", balBef.body);

  console.log("\n=== STEP 3: Processor charge (BEFORE load) ===");
  const ch = await post("http://127.0.0.1:7000/merchant/v1/payments/charge", {
    pan, expiry, cvv, amount: 2500, currencyCode: "840",
    mid: "VBM-2024-8910001", tid: "VBT-891-AE001", mcc: "5999"
  }, 15000);
  console.log("  charge approved=", ch.body && ch.body.approved, "RC=", ch.body && ch.body.responseCode, "msg=", ch.body && ch.body.responseMessage, "reason=", ch.body && ch.body.reason);
  if (!ch.ok || !(ch.body && ch.body.approved != null)) console.log("  raw:", ch.raw ? String(ch.raw).slice(0, 500) : ch.error);

  await sleep(2000);
  console.log("\n=== LOG TAILS ===");
  for (const s of services) {
    try {
      const lines = fs.readFileSync(s.logFile, "utf8").split(/\r?\n/);
      console.log("\n---------- " + s.name + " last 20 lines ----------");
      for (const l of lines.slice(-20)) console.log("   ", l);
    } catch (e) { console.log("   (no log) " + e.message); }
  }

  shutdown();
  setTimeout(() => process.exit(0), 3000);
})().catch(e => { console.error(e); shutdown(); process.exit(99); });
