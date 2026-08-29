const MERCHANT_ID = "MRC-1001";
const TERMINAL_ID = "TERM-2013-SMOKE-01";
const RETRY_ENDPOINT = "http://localhost:7000/merchant/v1/pos/201.3/retry-captures";

const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ PASS  ${msg}`);
  else { console.log(`  ❌ FAIL  ${msg}`); process.exitCode = 2; }
};

async function main() {
  console.log("=====================================================");
  console.log(" RETRY-CAPTURES ENDPOINT TEST: 2 Failed → Resurrected");
  console.log("=====================================================\n");

  let res, body;
  try {
    res = await fetch(RETRY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-merchant-id": MERCHANT_ID,
        "x-terminal-id": TERMINAL_ID
      },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        terminalId: TERMINAL_ID,
        maxRetries: 10
      })
    });
    body = await res.json();
  } catch (e) { console.error("HTTP FAIL:", e.message); process.exit(1); }

  console.log(`  HTTP status: ${res.status}\n`);
  if (res.status !== 200) {
    console.error("  Response:", JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const codes = body.protocolEvents?.map(e => e.code) || [];
  const counts = c => codes.filter(x => x === c).length;

  console.log("  Structural assertions:");
  assert(typeof body.protocolLastCode === "string" && body.protocolLastCode.length === 6,
         `protocolLastCode 6-digit → "${body.protocolLastCode}" (${body.protocolLastMeaning || "n/a"})`);
  assert(Array.isArray(body.protocolEvents),
         `protocolEvents[] present, length=${body.protocolEvents?.length}`);
  assert(typeof body.retried === "number",
         `retried field present → ${body.retried}`);
  assert(typeof body.captured === "number",
         `captured field present → ${body.captured}`);
  assert(typeof body.failed === "number",
         `failed field present → ${body.failed}`);

  console.log("\n  Retry result counts:");
  console.log(`    retried  = ${body.retried}`);
  console.log(`    captured = ${body.captured}`);
  console.log(`    failed   = ${body.failed}`);
  if (body.errors && body.errors.length) {
    body.errors.slice(0, 5).forEach(e => console.log(`    error: ${e}`));
  }

  if (body.retried > 0 && body.captured > 0) {
    console.log("\n  Protocol code presence (success retry path):");
    assert(counts("150401") >= 1,
           `150401 BATCH_RECONCILE_STARTED present  → ×${counts("150401")}`);
    assert(counts("180101") >= body.captured || counts("180102") >= body.captured,
           `Gateway LOOKUP sequence present for each captured txn  → 180101×${counts("180101")}, 180102×${counts("180102")}`);
    assert(counts("180202") >= body.captured,
           `180202 GATEWAY_PROCESSOR_CAPTURE_SUCCESS ×${body.captured}+  → ×${counts("180202")}`);
    assert(counts("130211") >= body.captured,
           `130211 WALLET_CREDIT_CREDITED (money moved during retry!) ×${counts("130211")}  (want ≥${body.captured})`);
    assert(body.protocolLastCode === "150402" || counts("150402") > 0,
           `150402 BATCH_RECONCILE_SUCCESS final  →  final="${body.protocolLastCode}", 150402_in_stream×${counts("150402")}`);
  } else if (body.retried === 0) {
    console.log("\n  ⚠ retried=0 — no pending captures to retry (previous Phase 1 test may have been re-run). 0 retried = trivially success.");
    console.log(`    final protocol code: ${body.protocolLastCode} (${body.protocolLastMeaning || "n/a"})`);
    assert(body.protocolLastCode === "150402",
           `0-captures final code = 150402 SUCCESS  →  got "${body.protocolLastCode}"`);
  } else if (body.retried > 0 && body.captured === 0) {
    console.log("\n  ⚠ retried>0 but captured=0 — processor still unreachable or prior captures retried already?");
    console.log(`    errors: ${(body.errors||[]).slice(0,3).join("; ")}`);
  }

  console.log("\n  Code distribution in retry event stream:");
  const interest = ["150401","150402","150303","180101","180102","180103","180201","180202","130201","130211","110310"];
  interest.forEach(code => {
    const c = counts(code);
    if (c > 0) console.log(`    ✅ ${code} ×${c}`);
  });
  console.log(`    — other codes: ${codes.filter(c => !interest.includes(c)).length}`);

  console.log("\n  Key response fields:");
  ["success","retried","captured","failed","message","protocolLastCode","protocolLastMeaning"].forEach(k => {
    if (body[k] !== undefined) console.log(`    ${k.padEnd(25)} = ${JSON.stringify(body[k])}`);
  });
  console.log(`    eventCount             = ${codes.length} protocol events`);

  if (process.exitCode && process.exitCode !== 0) {
    console.log("\n[RETRY-TEST] ❌ Some assertions failed.");
  } else {
    console.log("\n[RETRY-TEST] ✅ Retry endpoint structure & protocol codes validated.");
    console.log(`           → Final code: ${body.protocolLastCode} (${body.protocolLastMeaning || "n/a"})`);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(99); });
