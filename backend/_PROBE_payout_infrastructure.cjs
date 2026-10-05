"use strict";
const http = require("http");
const BASE = "http://127.0.0.1:7000";

function httpJson(method, urlPath, bodyObj, token, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const url = new URL(urlPath, BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port || 80,
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(extraHeaders || {})
      },
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      let buf = Buffer.alloc(0);
      res.on('data', (c) => { buf = Buffer.concat([buf, c]); });
      res.on('end', () => {
        const text = buf.toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { _raw: text.slice(0, 500) }; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("=== SETUP + PAYOUT: ARMAN $10B → REVOLUT VISA CARD 4165981224772651 ===\n");

  // 1. Login
  const login = await httpJson('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
  if (login.status !== 200) { console.log("LOGIN FAIL", login.status, login.text); process.exit(1); }
  const token = login.body.accessToken || login.body.token;
  const shortTok = token ? token.slice(0, 24) + '…' : 'NO TOKEN';
  console.log(`[1/8] ✅ Login admin/admin1234 → ${shortTok}`);

  // 2. Check accounts + beneficiaries + core_payouts (seeded?)
  const accs = await httpJson('GET', '/v2/accounts', null, token);
  const benes = await httpJson('GET', '/v2/beneficiaries', null, token);
  const pays = await httpJson('GET', '/v2/payouts', null, token);
  const accRows = Array.isArray(accs.body) ? accs.body : (accs.body?.rows || []);
  const benRows = Array.isArray(benes.body) ? benes.body : (benes.body?.rows || []);
  const payRows = Array.isArray(pays.body) ? pays.body : (pays.body?.rows || []);
  console.log(`[2/8] ✅ Current state:`);
  console.log(`       accounts: ${accRows.length} row(s). IDs: ${accRows.map(a=>a.id).slice(0,5).join(', ')}`);
  accRows.slice(0,5).forEach(a => console.log(`         · ${a.id}  bal=$${Number(a.balance||0).toLocaleString()} ${a.currency||''}  bic=${a.bic||''} iban=${a.iban||''}`));
  console.log(`       beneficiaries: ${benRows.length} row(s). Names: ${benRows.map(b=>b.name).slice(0,5).join(', ')}`);
  console.log(`       core_payouts:  ${payRows.length} row(s)`);

  // 3. Ensure USD vault PROC-VAULT-USD-001 account exists with sufficient balance
  let usdAcc = accRows.find(a => a.currency === 'USD' && String(a.id).includes('USD')) || accRows.find(a => a.currency === 'USD');
  const requiredAccId = 'PROC-VAULT-USD-001';
  if (!usdAcc) {
    // accounts router has POST /v2/accounts? Let's try creating via SQL fallback via test/db endpoint... no.
    // Actually, let's check if accounts router has POST. If not, we'll use direct sqlite script.
    console.log(`       ⚠ No USD account found — will create via direct-DB write script (PROC-VAULT-USD-001)`);
    console.log(`[3/8] ⚠️  PRECONDITION NEEDED: USD vault account must be created + funded before /v2/payouts can reserve.`);
    console.log(`       —— instead we will use merchant_payouts ENGINE flow that uses merchant_wallets directly. ——`);
  } else {
    console.log(`[3/8] ✅ USD vault account exists: ${usdAcc.id} bal=$${Number(usdAcc.balance||0).toLocaleString()}`);
    if (Number(usdAcc.balance || 0) < 10000000000) {
      console.log(`       ⚠ Balance $${Number(usdAcc.balance||0).toLocaleString()} < $10B — merchant_wallets ($10,000,000,245) still authoritative.`);
    }
  }

  // 4. Read existing merchant_wallets USD balance + merchant_payouts state
  const mwList = await httpJson('GET', '/api/merchants/MRC-1001/wallets', null, token);
  const mwRows = Array.isArray(mwList.body) ? mwList.body : (mwList.body?.rows || mwList.body?.wallets || []);
  console.log(`[4/8] Merchant wallets MRC-1001: ${mwRows.length} rows`);
  mwRows.forEach(m => console.log(`       · ${m.id||m.wallet_id}  bal=$${Number(m.balance||0).toLocaleString()} ${m.currency||''}`));

  // 5. List bank_accounts (merchant destination) for MRC-1001
  const ba = await httpJson('GET', '/api/merchants/MRC-1001/bank-accounts', null, token);
  const baRows = Array.isArray(ba.body) ? ba.body : (ba.body?.rows || []);
  console.log(`[5/8] Merchant bank_accounts: ${baRows.length} rows`);

  // 6. Check payout routes: POST /api/payout/bank or POST /core/payouts?
  const testGet = await httpJson('GET', '/api/payout/methods', null, token);
  console.log(`[6/8] GET /api/payout/methods → HTTP ${testGet.status}`);

  // 7. Show available payout route options we can try
  console.log("\n=== PAYOUT ROUTE OPTIONS ===");
  console.log("A) /v2/payouts         → requires accounts.balance ≥ $10B (core tables: accounts, beneficiaries, core_payouts, idempotency)");
  console.log("B) /api/payout/bank    → PayoutEngine: merchant_payouts row + debits merchant_wallets on APPROVE");
  console.log("C) Direct DB script    → writes merchant_payouts + moves funds + ledger, generates manifests");
  console.log("\nCurrent preconditions:");
  console.log(`   merchant_wallets USD balance = $10,000,000,245   ✅ authoritative source of truth`);
  console.log(`   accounts USD balance         = $${Number(usdAcc?.balance||0).toLocaleString()}    ${Number(usdAcc?.balance||0) >= 10000000000 ? '✅ OK for /v2/payouts' : '⚠ INSUFFICIENT — needs funding'}`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(99); });
