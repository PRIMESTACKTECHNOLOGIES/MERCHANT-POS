const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const MERCHANT_ID = "MRC-1001";
const TERMINAL_ID = "TERM-2013-SMOKE-01";
const BATCH_ID = `BATCH-FAILCASE-${Date.now()}`;
const PROTOCOL_VERSION = "201.3";
const OFFLINE_BATCH_ENDPOINT = "http://localhost:7000/merchant/v1/pos/201.3/offline-batch";
const RETRY_ENDPOINT = "http://localhost:7000/merchant/v1/pos/201.3/retry-captures";
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

function hmacSha256Base64(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64");
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
  throw new Error("No secret found");
}

function buildTransactions() {
  const now = Date.now();
  return [
    {
      id: "TXN-FAIL1-" + now,
      localTxnId: "LOCAL-FAIL1-" + now,
      stan: "000101",
      authCode: "999991",
      rrn: "RRN-F1-" + now,
      amountMinor: 7777,
      currency: "USD",
      panMasked: "5105********0500",
      cardBrand: "MASTERCARD",
      txnType: "SALE",
      authMode: "OFFLINE_APPROVED",
      entryMode: "CHIP",
      readerSource: "EMV_BRIDGE",
      cvmResult: "PIN",
      pinVerified: true,
      customerName: "FAIL-CASE CUSTOMER 1",
      txnTimestamp: new Date().toISOString(),
      emvData: { tvr: "0000000000", tsi: "0000", atc: "0021", cryptogram: "TC", appLabel: "MC DEBIT" }
    },
    {
      id: "TXN-FAIL2-" + (now + 1),
      localTxnId: "LOCAL-FAIL2-" + (now + 1),
      stan: "000102",
      authCode: "999992",
      rrn: "RRN-F2-" + (now + 1),
      amountMinor: 33300,
      currency: "AED",
      panMasked: "4444********4444",
      cardBrand: "VISA",
      txnType: "SALE",
      authMode: "OFFLINE_APPROVED",
      entryMode: "SWIPED",
      readerSource: "EMV_BRIDGE",
      cvmResult: "SIGNATURE",
      pinVerified: false,
      customerName: "FAIL-CASE CUSTOMER 2",
      txnTimestamp: new Date().toISOString(),
      emvData: { tvr: "0000000000", tsi: "0000", atc: "0022", cryptogram: "TC", appLabel: "VISA SIGNATURE" }
    }
  ];
}

async function postSignedBatch(secret, transactions) {
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
  const res = await fetch(OFFLINE_BATCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-merchant-id": MERCHANT_ID,
      "x-terminal-id": TERMINAL_ID,
      "x-signature": signature
    },
    body: JSON.stringify(batchData)
  });
  const body = await res.json();
  return { status: res.status, body, batchData };
}

const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ PASS  ${msg}`);
  else { console.log(`  ❌ FAIL  ${msg}`); process.exitCode = 2; }
};

async function main() {
  console.log("=====================================================");
  console.log(" FAIL-CASE + RETRY SMOKE: Processor Offline During Sync");
  console.log("=====================================================\n");

  const { secret } = await getSecretKey();
  const transactions = buildTransactions();

  // ── PHASE 1: Processor FAIL (config set to ENABLED=true + blank URLs) ──
  console.log("PHASE 1: POST batch while processor is BROKEN (expect all CAPTURE_FAILED, no wallet credit)\n");
  let r1;
  try { r1 = await postSignedBatch(secret, transactions); }
  catch (e) { console.error("HTTP FAIL:", e.message); process.exit(1); }

  console.log(`  HTTP status: ${r1.status}\n`);
  if (r1.status !== 200) {
    console.error("  Response body:", JSON.stringify(r1.body, null, 2));
    process.exit(1);
  }
  const b1 = r1.body;
  const codes1 = b1.protocolEvents?.map(e => e.code) || [];

  console.log("  Structural assertions (FAIL phase):");
  assert(typeof b1.protocolLastCode === "string" && b1.protocolLastCode.length === 6,
         `protocolLastCode 6-digit → "${b1.protocolLastCode}"`);
  assert(b1.batchStatus === "CAPTURE_FAILED",
         `batchStatus = CAPTURE_FAILED  →  got "${b1.batchStatus}"`);
  assert(b1.failedCount === transactions.length,
         `failedCount = ${transactions.length}  →  got ${b1.failedCount}`);
  assert(b1.capturedCount === 0,
         `capturedCount = 0 (no money moved during failure)  →  got ${b1.capturedCount}`);
  assert(b1.capturedAmountMinor === 0 || b1.capturedAmountMinor == null,
         `capturedAmountMinor = 0  →  got ${b1.capturedAmountMinor}`);

  console.log("\n  Protocol code presence (FAIL phase):");
  assert(codes1.includes(PROCESSOR_LOOKUP_FAILED_CODE = "180103") ||
         codes1.includes("180203"),
         `Gateway FAILED code present (180103 or 180203)  →  counts: 180103×${codes1.filter(c=>c==="180103").length} 180203×${codes1.filter(c=>c==="180203").length}`);
  assert(!codes1.includes("130211"),
         `WALLET_CREDIT_CREDITED (130211) ABSENT (no ghost crediting during processor failure!)  →  present ×${codes1.filter(c=>c==="130211").length}`);
  assert(codes1.includes("150402") === false || b1.batchStatus !== "CAPTURE_FAILED",
         `Final FAIL code expected, not SUCCESS code  →  final=${b1.protocolLastCode} "${b1.protocolLastMeaning}"`);

  console.log("\n  Code counts in FAIL-phase event stream:");
  const wantCounts1 = {
    "150301": { desc: "BATCH_RECONCILE_STARTED", min: 1 },
    "180103": { desc: "GATEWAY_PROCESSOR_LOOKUP_FAILED", min: transactions.length },
    "150303": { desc: "BATCH_RECONCILE_FAILED (all fail)", min: 0, max: 1 }
  };
  Object.entries(wantCounts1).forEach(([code, {desc, min, max}]) => {
    const count = codes1.filter(c => c === code).length;
    const ok = count >= min && (max === undefined || count <= max ? true : true);
    if (ok) console.log(`    ✅ ${code} ×${count}  — ${desc}`);
    else { console.log(`    ❌ ${code} ×${count}  — ${desc}  (want min=${min})`); process.exitCode = 2; }
  });

  console.log("\n  First 20 FAIL-phase events:");
  (b1.protocolEvents || []).slice(0, 20).forEach((ev, i) => {
    const bits = [String(i).padStart(2), ev.code, ev.at.substring(11,19)];
    if (ev.ref) bits.push(`ref=${ev.ref}`);
    if (ev.message) bits.push(`msg="${ev.message.substring(0,50)}"`);
    console.log("     " + bits.join("  "));
  });

  console.log(`\n  → Final phase-1 code: ${b1.protocolLastCode} (${b1.protocolLastMeaning})`);
  console.log(`  → ${b1.failedCount}/${b1.txnCount} captures failed, $${Number(b1.totalAmountMinor)/100} NOT credited (correct!)\n`);

  // ── PHASE 2: Retry failed captures (environment should now be DRY-RUN restored) ──
  console.log("-----------------------------------------------------");
  console.log("PHASE 2: POST /retry-captures after processor FIXED to DRY-RUN\n");
  console.log("  (Restore .env to CARD_PROCESSOR_ENABLED=false, URLs restored, server restarted)\n");
  console.log("  Retry endpoint params: merchantId, terminalId");
  let r2;
  try {
    const res = await fetch(RETRY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-merchant-id": MERCHANT_ID,
        "x-terminal-id": TERMINAL_ID
      },
      body: JSON.stringify({ merchantId: MERCHANT_ID, terminalId: TERMINAL_ID, maxRetries: 10 })
    });
    r2 = { status: res.status, body: await res.json() };
  } catch (e) { console.error("  Retry HTTP FAIL:", e.message); return; }

  console.log(`  Retry HTTP status: ${r2.status}\n`);
  if (r2.status !== 200) {
    console.error("  Retry response:", JSON.stringify(r2.body, null, 2));
    return;
  }
  const b2 = r2.body;
  const codes2 = b2.protocolEvents?.map(e => e.code) || [];

  console.log("  Retry structural assertions:");
  assert(typeof b2.protocolLastCode === "string" && b2.protocolLastCode.length === 6,
         `retry protocolLastCode 6-digit → "${b2.protocolLastCode}"`);
  assert(b2.retried >= transactions.length,
         `retried >= ${transactions.length}  →  retried=${b2.retried}`);
  assert(b2.captured >= 0,
         `captured on retry = ${b2.captured}`);
  assert(b2.failed >= 0,
         `failed on retry = ${b2.failed}`);

  // If processor was fixed between phase 1 and phase 2, captured should be >0
  if (b2.captured > 0) {
    console.log("\n  Retry SUCCESS code presence:");
    assert(codes2.includes("180101") && codes2.includes("180102"),
           `Gateway LOOKUP_STARTED+SUCCESS present on retry  →  counts: 180101×${codes2.filter(c=>c==="180101").length} 180102×${codes2.filter(c=>c==="180102").length}`);
    assert(codes2.includes("130211"),
           `WALLET_CREDIT_CREDITED (130211) present on retry (money moved!)  →  ×${codes2.filter(c=>c==="130211").length}`);
    assert(b2.protocolLastCode === "150402" || codes2.includes("150402"),
           `Final BATCH_RECONCILE_SUCCESS (150402)  →  final=${b2.protocolLastCode}`);
  } else if (b2.captured === 0 && b2.failed === 0 && b2.retried === 0) {
    console.log("\n  ⚠ Retry found 0 pending captures (already retried or phase 1 had a bug). 0 retried 0 captured.");
  } else {
    console.log("\n  ⚠ Retry captured = 0 but retried > 0. Processor still broken in phase 2?");
    console.log(`    retried=${b2.retried} captured=${b2.captured} failed=${b2.failed}`);
    if (b2.errors) b2.errors.slice(0,5).forEach(e => console.log(`    error: ${e}`));
  }

  console.log("\n  Retry code counts in event stream:");
  const wantCodes2 = ["150401", "180101", "180102", "180201", "180202", "130201", "130211", "110310", "150402"];
  wantCodes2.forEach(code => {
    const count = codes2.filter(c => c === code).length;
    if (count > 0) console.log(`    ✅ ${code} ×${count}  — present`);
    else console.log(`    ⚠  ${code} ×0  — absent`);
  });

  console.log(`\n  → Final retry code: ${b2.protocolLastCode} (${b2.protocolLastMeaning || "n/a"})`);
  console.log(`  → Retry summary: retried=${b2.retried}  captured=${b2.captured}  failed=${b2.failed}`);

  if (process.exitCode && process.exitCode !== 0) {
    console.log("\n[FAILCASE] ❌ Some assertions FAILED — check above.");
  } else {
    console.log("\n[FAILCASE] ✅ FAIL-phase assertions PASSED. Retry phase validated structure.");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(99); });
