/**
 * Real-fund capture verification test
 * Checks what captureMode the 201.3 engine reports and validates
 * the full Fund Catcher integration flow.
 */
import http from "http";

function call(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : "";
    const req = http.request(
      { hostname: "localhost", port: 7000, path, method,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
        timeout: 15000 },
      (res) => { let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve({ s: res.statusCode, b: JSON.parse(b) }); } catch { resolve({ s: res.statusCode, b }); } }); }
    );
    req.on("error", e => resolve({ s: 0, b: { error: e.message } }));
    req.on("timeout", () => { req.destroy(); resolve({ s: 0, b: { error: "timeout" } }); });
    req.write(data); req.end();
  });
}

const lg = await call("POST", "/auth/login", { username: "admin", password: "admin1234" });
const auth = { Authorization: "Bearer " + lg.b.token };
console.log("Login:", lg.b.token ? "OK" : "FAIL");

// ── Check processor status ─────────────────────────────────────────────────
const status = await call("GET", "/api/pos201/status");
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║  PROCESSOR STATUS                                    ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log("mode:          ", status.b.mode);
console.log("localOnlyMode: ", status.b.localOnlyMode);
console.log("notes:");
(status.b.notes || []).forEach(n => console.log("  •", n));

// ── Run a charge ───────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║  FIRING 201.3 CHARGE via captureCardTransaction()    ║");
console.log("╚══════════════════════════════════════════════════════╝");

const charge = await call("POST", "/api/pos201/charge", {
  pan:          "4165989902669610",
  expiry:       "05/30",
  amountMinor:  10000,
  currency:     "USD",
  merchantId:   "MRC-1001",
  terminalId:   "T2013-LOCAL-001",
  cardholderName: "TEST CARDHOLDER",
  entryMode:    "CHIP",
}, auth);

console.log("HTTP status:   ", charge.s);
console.log("success:       ", charge.b.success);
console.log("status:        ", charge.b.status);
console.log("captureMode:   ", charge.b.captureMode);   // ← THE KEY FIELD
console.log("captureRef:    ", charge.b.captureRef);
console.log("settlementId:  ", charge.b.settlementId);
console.log("authCode:      ", charge.b.authCode);
console.log("amount:        ", charge.b.amount, charge.b.currency);
console.log("merchantBal:   ", charge.b.merchantBalance);
console.log("reason:        ", charge.b.reason);
if (charge.b.error) console.log("error:         ", charge.b.error);
if (charge.b.code)  console.log("code:          ", charge.b.code);

// ── Explain the captureMode ────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║  WHAT captureMode MEANS                              ║");
console.log("╚══════════════════════════════════════════════════════╝");
if (charge.b.captureMode === "REAL_FUND_CAPTURED") {
  console.log(`
  captureMode = REAL_FUND_CAPTURED

  This means the charge went through captureCardTransaction() which called:
  
  1. POST ACQUIRER_HOST/card/capture  (if ACQUIRER_HOST is configured)
     OR
     callExternalFundProvider()  (if GLOBAL_PAYMENTS_API_KEY etc. is set)
  
  2. POST VAULT_BANK_TRANSFER_URL/credit  (HMAC-SHA512 signed confirmation)
  
  3. Merchant wallet was ONLY credited after HTTP 2xx from the provider.
  
  The money went through the real c2m fund capture path.
  Card was actually charged externally.
  `);
} else if (charge.b.captureMode === "LOCAL_OFFLINE") {
  console.log(`
  captureMode = LOCAL_OFFLINE

  This means LOCAL_ONLY_MODE=true in backend/.env.
  The charge self-approved locally without calling any external provider.
  
  To enable REAL fund capture, set in backend/.env:
  
    LOCAL_ONLY_MODE=false
    REAL_FUNDS_ONLY=true
  
  Then configure ONE of these external providers:
  
  Option A — Global Payments UCP (recommended):
    GLOBAL_PAYMENTS_API_KEY=<your_key>
    GLOBAL_PAYMENTS_SECRET_KEY=<your_secret>
    GLOBAL_PAYMENTS_API_URL=https://apis.globalpay.com/ucp
    OPERATOR_CARD_USD_NUMBER=<card_to_charge>
    OPERATOR_CARD_USD_EXPIRY=MM/YY
    OPERATOR_CARD_USD_CVV=<cvv>
    OPERATOR_CARD_USD_HOLDER=<cardholder name>
  
  Option B — Custom endpoint:
    EXTERNAL_FUND_PROVIDER_ENDPOINT=https://your-processor.com/api/capture
    EXTERNAL_FUND_PROVIDER_API_KEY=<your_key>
  
  Option C — Acquirer host:
    ACQUIRER_HOST=https://your-acquirer.com
    ACQUIRER_API_KEY=<key>
    ACQUIRER_MERCHANT_ID=<mid>
  `);
}

// ── Fund Catcher entry point ───────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  FUND CATCHER — trigger via Node.js backend          ║");
console.log("╚══════════════════════════════════════════════════════╝");
const fc = await call("POST", "/api/fund-catcher/run", {
  startDate: new Date(Date.now() - 86400000).toISOString(),
  endDate:   new Date().toISOString(),
}, auth);
if (fc.s === 200 || fc.s === 201) {
  console.log("Fund Catcher triggered: run ID =", fc.b?.data?.runId || fc.b?.runId || JSON.stringify(fc.b).slice(0,80));
} else {
  console.log("Fund Catcher endpoint:", fc.s, "→", JSON.stringify(fc.b).slice(0,120));
  console.log("(Fund Catcher is a C# backend service — it runs separately on its own port)");
}
