const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const MERCHANT_ID = "MRC-1001";
const TERMINAL_ID = "TERM-2013-SMOKE-01";
const BATCH_ID = `BATCH-SMOKE-${Date.now()}`;
const PROTOCOL_VERSION = "201.3";
const API_ENDPOINT = "http://localhost:7000/merchant/v1/pos/201.3/offline-batch";
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

function hmacSha256Base64(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64");
}

async function getMerchantApiKey() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);
  const rows = db.exec(
    "SELECT api_key FROM merchant_settings WHERE merchant_id = ? LIMIT 1",
    [MERCHANT_ID]
  );
  db.close();
  if (!rows.length || !rows[0].values.length) return null;
  return rows[0].values[0][0];
}

async function ensureMerchantAndTerminal() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  try { db.run("ALTER TABLE merchant_settings ADD COLUMN support_phone TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN display_name TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN display_currency TEXT DEFAULT 'USD'"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN extended_settings TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN payment_config TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE merchant_settings ADD COLUMN features TEXT"); } catch (_) {}

  const existing = db.exec(
    "SELECT merchant_id FROM merchant_settings WHERE merchant_id = ?",
    [MERCHANT_ID]
  );

  if (!existing.length || !existing[0].values.length) {
    const apiKey = "sk_test_smoke_" + crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO merchant_settings (merchant_id, api_key, merchant_name, display_name, display_currency, features) VALUES (?,?,?,?,?,?)",
      [
        MERCHANT_ID,
        apiKey,
        "ALRKN ALRAQY HOTEL MANAGEMENT LLC",
        "ALRKN ALRAQY HOTEL",
        "AED",
        JSON.stringify({ manualEntry: true, refunds: true, tips: true })
      ]
    );
    console.log("[SMOKE] Inserted merchant MRC-1001 with fresh API key");
  }

  try { db.run("ALTER TABLE terminals ADD COLUMN terminal_secret TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE terminals ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}

  const tRows = db.exec(
    "SELECT terminal_id FROM terminals WHERE terminal_id = ? AND merchant_id = ?",
    [TERMINAL_ID, MERCHANT_ID]
  );

  if (!tRows.length || !tRows[0].values.length) {
    const termSecret = "term_secret_" + crypto.randomBytes(24).toString("hex");
    try {
      db.run(
        "INSERT INTO terminals (terminal_id, merchant_id, terminal_secret) VALUES (?,?,?)",
        [TERMINAL_ID, MERCHANT_ID, termSecret]
      );
      console.log("[SMOKE] Inserted terminal", TERMINAL_ID, "with per-terminal secret");
    } catch (insertErr) {
      console.log("[SMOKE] Terminal insert skipped (schema mismatch):", insertErr.message);
      console.log("[SMOKE] Will fall back to merchant API key for signing");
    }
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
}

async function getSecretKey() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);
  const tRows = db.exec(
    "SELECT terminal_secret FROM terminals WHERE terminal_id = ? AND merchant_id = ? LIMIT 1",
    [TERMINAL_ID, MERCHANT_ID]
  );
  if (tRows.length && tRows[0].values.length && tRows[0].values[0][0]) {
    db.close();
    return { source: "terminal", secret: tRows[0].values[0][0] };
  }
  const mRows = db.exec(
    "SELECT api_key FROM merchant_settings WHERE merchant_id = ? LIMIT 1",
    [MERCHANT_ID]
  );
  db.close();
  if (mRows.length && mRows[0].values.length) {
    return { source: "merchant api_key", secret: mRows[0].values[0][0] };
  }
  throw new Error("No terminal or merchant secret found");
}

function buildTransactions() {
  const now = Date.now();
  return [
    {
      id: "TXN-HUSSAM-" + now,
      localTxnId: "LOCAL-HUSSAM-" + now,
      stan: "000006",
      authCode: "423685",
      rrn: "RRN-" + now,
      amountMinor: 100,
      currency: "USD",
      panMasked: "4111********1111",
      cardBrand: "VISA",
      txnType: "SALE",
      authMode: "OFFLINE_APPROVED",
      entryMode: "CHIP",
      readerSource: "EMV_BRIDGE",
      cvmResult: "PIN",
      pinVerified: true,
      customerName: "HUSSAM ALI",
      txnTimestamp: new Date().toISOString(),
      emvData: {
        tvr: "0000000000",
        tsi: "0000",
        atc: "0001",
        cryptogram: "TC",
        appLabel: "VISA CREDIT"
      }
    },
    {
      id: "TXN-NGUYEN-" + (now + 1),
      localTxnId: "LOCAL-NGUYEN-" + (now + 1),
      stan: "000007",
      authCode: "587241",
      rrn: "RRN-" + (now + 1),
      amountMinor: 2500,
      currency: "AED",
      panMasked: "5555********4444",
      cardBrand: "MASTERCARD",
      txnType: "SALE",
      authMode: "OFFLINE_APPROVED",
      entryMode: "CHIP",
      readerSource: "EMV_BRIDGE",
      cvmResult: "SIGNATURE",
      pinVerified: false,
      customerName: "NGUYEN VAN",
      txnTimestamp: new Date().toISOString(),
      emvData: {
        tvr: "0000000000",
        tsi: "0000",
        atc: "0002",
        cryptogram: "TC",
        appLabel: "MASTERCARD WORLD"
      }
    },
    {
      id: "TXN-JJDUMBA-" + (now + 2),
      localTxnId: "LOCAL-JJDUMBA-" + (now + 2),
      stan: "000008",
      authCode: "771203",
      rrn: "RRN-" + (now + 2),
      amountMinor: 50000,
      currency: "USD",
      panMasked: "3782******00002",
      cardBrand: "AMEX",
      txnType: "SALE",
      authMode: "OFFLINE_APPROVED",
      entryMode: "CONTACTLESS",
      readerSource: "EMV_BRIDGE",
      cvmResult: "NO_CVM",
      pinVerified: false,
      customerName: "JJ DUMBA",
      txnTimestamp: new Date().toISOString(),
      emvData: {
        tvr: "0000000000",
        tsi: "0000",
        atc: "0003",
        cryptogram: "TC",
        appLabel: "AMERICAN EXPRESS"
      }
    }
  ];
}

async function main() {
  console.log("=====================================================");
  console.log(" Protocol 201.3 OFFLINE BATCH → CAPTURE DRY-RUN TEST");
  console.log("=====================================================\n");

  if (process.env.SKIP_DB_SETUP !== "1") {
    await ensureMerchantAndTerminal();
  } else {
    console.log("[SMOKE] SKIP_DB_SETUP=1 — assuming merchant/terminal already provisioned\n");
  }
  const { source, secret } = await getSecretKey();
  console.log(`[SMOKE] Signing key source: ${source} (len=${secret.length})\n`);

  const transactions = buildTransactions();
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const txnCount = transactions.length;

  const sigPayload = `${PROTOCOL_VERSION}|${MERCHANT_ID}|${TERMINAL_ID}|${BATCH_ID}|${timestamp}|${nonce}|${txnCount}`;
  const signature = hmacSha256Base64(sigPayload, secret);

  const batchData = {
    protocolVersion: PROTOCOL_VERSION,
    batchId: BATCH_ID,
    timestamp,
    nonce,
    signature,
    merchantId: MERCHANT_ID,
    terminalId: TERMINAL_ID,
    transactions
  };

  console.log("[SMOKE] Batch payload summary:");
  console.log(`  - batchId     : ${BATCH_ID}`);
  console.log(`  - merchantId  : ${MERCHANT_ID}`);
  console.log(`  - terminalId  : ${TERMINAL_ID}`);
  console.log(`  - txnCount    : ${txnCount}`);
  console.log(`  - totalMinor  : ${transactions.reduce((s,t) => s + t.amountMinor, 0)}`);
  console.log(`  - signature   : ${signature.substring(0, 24)}...`);
  console.log(`  - processor   : DRY-RUN (CARD_PROCESSOR_ENABLED=false)\n`);

  let body;
  let status;
  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-merchant-id": MERCHANT_ID,
        "x-terminal-id": TERMINAL_ID,
        "x-signature": signature
      },
      body: JSON.stringify(batchData)
    });
    status = res.status;
    body = await res.json();
  } catch (e) {
    console.error("[SMOKE] HTTP request failed:", e.message);
    process.exit(1);
  }

  console.log(`[SMOKE] Response status: ${status}\n`);

  if (status !== 200) {
    console.error("[SMOKE] FAIL — non-200 status. Response body:");
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const assert = (cond, msg) => {
    if (cond) {
      console.log(`  ✅ PASS  ${msg}`);
    } else {
      console.log(`  ❌ FAIL  ${msg}`);
      process.exitCode = 2;
    }
  };

  console.log("[SMOKE] Structural assertions:");
  assert(typeof body.protocolLastCode === "string" && body.protocolLastCode.length === 6,
         `protocolLastCode present & 6-digit → got "${body.protocolLastCode}"`);
  assert(typeof body.protocolLastMeaning === "string" && body.protocolLastMeaning.length > 0,
         `protocolLastMeaning present → "${body.protocolLastMeaning?.substring(0,50)}..."`);
  assert(Array.isArray(body.protocolEvents) && body.protocolEvents.length > 0,
         `protocolEvents[] present, length=${body.protocolEvents?.length}`);
  assert(body.processorMode === "DRY-RUN",
         `processorMode=DRY-RUN (safety flag respected) → got "${body.processorMode}"`);
  assert(typeof body.capturedCount === "number" && body.capturedCount === transactions.length,
         `capturedCount=${body.capturedCount} matches txns=${transactions.length}`);
  assert(body.batchStatus === "PROCESSED" || body.batchStatus === "PARTIAL",
         `batchStatus=PROCESSED → got "${body.batchStatus}"`);
  assert(typeof body.settlementCode === "string" && body.settlementCode.length === 6,
         `settlementCode 6-digit present → "${body.settlementCode}"`);

  console.log("\n[SMOKE] Protocol code sequence check (15xx/18xx/13xx/11xx families):");
  const codes = body.protocolEvents.map(e => e.code);
  const wantCodes = {
    "150101": "BATCH_UPLOAD_STARTED (15 Settlement BB=01 Upload CC=01)",
    "150102": "BATCH_UPLOAD_SUCCESS  (15 Settlement BB=01 Upload CC=02)",
    "180101": "GATEWAY_PROCESSOR_LOOKUP_STARTED (18 Gateway BB=01 Lookup CC=01)",
    "180102": "GATEWAY_PROCESSOR_LOOKUP_SUCCESS (18 Gateway BB=01 Lookup CC=02)",
    "180201": "GATEWAY_PROCESSOR_CAPTURE_STARTED (18 Gateway BB=02 Capture CC=01)",
    "180202": "GATEWAY_PROCESSOR_CAPTURE_SUCCESS (18 Gateway BB=02 Capture CC=02)",
    "130201": "WALLET_CREDIT_STARTED    (13 Wallet BB=02 Credit CC=01)",
    "130202": "WALLET_CREDIT_SUCCESS    (13 Wallet BB=02 Credit CC=02)",
    "130211": "WALLET_CREDIT_CREDITED   (13 Wallet BB=02 Credit CC=11)",
    "110310": "EMV_OFFLINE_SYNC_COMPLETED (11 EMV BB=03 Offline CC=10)",
    "150402": "BATCH_RECONCILE_SUCCESS  (15 Settlement BB=04 Reconcile CC=02)"
  };
  for (const [code, desc] of Object.entries(wantCodes)) {
    const found = codes.includes(code);
    const count = codes.filter(c => c === code).length;
    if (found) {
      console.log(`  ✅ ${code}  present ×${count}  — ${desc}`);
    } else {
      console.log(`  ❌ ${code}  MISSING          — ${desc}`);
      process.exitCode = 2;
    }
  }

  console.log("\n[SMOKE] Protocol events stream (first 30 rows, code@at→ref+message):");
  body.protocolEvents.slice(0, 30).forEach((ev, i) => {
    const bits = [
      String(i).padStart(2),
      ev.code,
      ev.at.substring(11, 19),
    ];
    if (ev.ref) bits.push(`ref=${ev.ref}`);
    if (ev.amountMinor) bits.push(`amt=${ev.amountMinor/100}`);
    if (ev.currency) bits.push(`${ev.currency}`);
    if (ev.message) bits.push(`msg="${ev.message.substring(0,60)}"`);
    console.log("   " + bits.join("  "));
  });

  console.log("\n[SMOKE] Key response fields:");
  const keysShow = [
    "success", "replayed", "batchId", "settlementCode",
    "txnCount", "capturedCount", "failedCount",
    "capturedAmountMinor", "totalAmountMinor",
    "batchStatus", "processorMode",
    "protocolLastCode", "protocolLastMeaning"
  ];
  keysShow.forEach(k => {
    console.log(`   ${k.padEnd(25)} = ${JSON.stringify(body[k])}`);
  });

  if (process.exitCode && process.exitCode !== 0) {
    console.log("\n[SMOKE] ❌ SOME ASSERTIONS FAILED — check above for ❌ rows");
  } else {
    console.log("\n[SMOKE] ✅ ALL ASSERTIONS PASSED — Protocol 201.3 codes wired correctly end-to-end");
    console.log(`          → Final protocol code: ${body.protocolLastCode} (${body.protocolLastMeaning})`);
    console.log(`          → Event count: ${body.protocolEvents.length} protocol events in stream`);
    console.log(`          → Next action: flip CARD_PROCESSOR_ENABLED=true in .env for LIVE captures`);
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(99);
});
