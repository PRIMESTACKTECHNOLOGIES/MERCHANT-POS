"use strict";
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:7000";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Vault Bank Portal — Smoke Test (REST)                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  let jwt;
  try {
    const login = await axios.post(`${BASE}/auth/login`, { username: "admin", password: "admin1234" }, { timeout: 8000 });
    jwt = login.data?.token || login.data?.accessToken || (login.data?.user && login.data.user.token) || login.headers?.authorization?.replace(/^Bearer /i, "");
    if (!jwt) {
      console.log("[1/6] ❌ Login HTTP", login.status, "body keys:", Object.keys(login.data || {}));
      console.log("       Raw:", JSON.stringify(login.data).slice(0, 300));
      return process.exit(1);
    }
    console.log("[1/6] ✅ Login — admin/admin1234 → JWT obtained (" + String(jwt).slice(0, 20) + "…)");
  } catch (e) {
    console.log("[1/6] ❌ Login FAILED:", e.code || e.message, e.response ? JSON.stringify(e.response.data).slice(0, 300) : "");
    console.log("       → Start backend first: cd backend && npm run dev (port 7000)");
    return process.exit(2);
  }
  const hdr = { headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" } };

  try {
    const acc = await axios.get(`${BASE}/api/vault/accounts`, hdr);
    console.log(`[2/6] ✅ GET /api/vault/accounts → HTTP ${acc.status}  rows=${acc.data?.rows?.length ?? 0 ?? (Array.isArray(acc.data)? acc.data.length : '??')}`);
    const accts = Array.isArray(acc.data) ? acc.data : (acc.data?.rows || []);
    accts.forEach(a => console.log(`       · ${a.id}  ${a.currency}  bal=${Number(a.balance).toLocaleString('en-US')}  bic=${a.bic || '(placeholder - edit in table or on Tab0)'}  iban=${a.iban || ''}`));
  } catch (e) {
    console.log(`[2/6] ❌ GET accounts FAIL: HTTP ${e.response?.status}  body=${JSON.stringify(e.response?.data || e.message).slice(0,400)}`);
    return process.exit(3);
  }

  let benef;
  try {
    const b = await axios.get(`${BASE}/api/vault/beneficiaries`, hdr);
    const list = Array.isArray(b.data) ? b.data : (b.data?.rows || []);
    benef = list.find(x => String(x.swift || '').toUpperCase() === 'TRWIBEB1XXX') || list[0];
    console.log(`[3/6] ✅ GET /beneficiaries → ${list.length} rows · picked Wise → ${benef?.name || 'none'}`);
  } catch (e) {
    console.log(`[3/6] ❌ GET beneficiaries FAIL: HTTP ${e.response?.status} body=${JSON.stringify(e.response?.data || e.message).slice(0,300)}`);
    return process.exit(4);
  }

  let transferId;
  try {
    const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
    const d = await axios.post(`${BASE}/api/vault/sepa/draft`, {
      from_account_id: 'PROC-VAULT-EUR-001',
      beneficiary_id: benef.id,
      amount: 50000.00,
      currency: 'EUR',
      reference: `INTL-MRC-1001-SMOKE${rand}`,
      payment_type: 'SEPA_SCT',
      internal_note: 'Vault smoke test - EUR 50k to Wise mediator',
      linked_payout_id: '3e31293c-7609-490f-838b-193828e86aed',
    }, hdr);
    transferId = d.data?.transfer?.id || d.data?.id;
    const uetr = d.data?.transfer?.uetr || d.data?.uetr;
    console.log(`[4/6] ✅ POST /sepa/draft → status=${d.status}  transferId=${String(transferId).slice(0,10)}… UETR=${String(uetr||'').slice(0,20)}…`);
    console.log(`       Draft status=${d.data?.transfer?.status}  ref=${d.data?.transfer?.reference}`);
  } catch (e) {
    console.log(`[4/6] ❌ POST draft FAIL: HTTP ${e.response?.status} body=${JSON.stringify(e.response?.data || e.message).slice(0,400)}`);
    return process.exit(5);
  }

  try {
    const ex = await axios.post(`${BASE}/api/vault/sepa/execute`, { transfer_id: transferId }, hdr);
    const xml = ex.data?.pain001_xml_string || '';
    const file = ex.data?.download_filename || '';
    const uetr = ex.data?.uetr || '';
    const status = ex.data?.transfer?.status || '';
    const hasPlaceholder = /PROCESSOR_BIC_PLACEHOLDER/i.test(xml);
    console.log(`[5/6] ✅ POST /sepa/execute → HTTP ${ex.status}`);
    console.log(`       UETR=${uetr}  status=${status}  file=${file}`);
    console.log(`       XML length=${xml.length} chars  XML schema=${xml.match(/pain\.001\.001\.\d+/)?.[0] || 'N/A'}`);
    console.log(`       Debtor BIC real (no placeholder): ${hasPlaceholder ? '❌ STILL HAS PLACEHOLDER - edit PROC-VAULT-EUR-001.bic before executing real' : '✅ REAL BIC embedded'}`);
    if (xml) {
      const savePath = path.join(__dirname, '..', `SMOKETEST_${file || 'pain001_smoke.xml'}`);
      fs.writeFileSync(savePath, xml, 'utf-8');
      console.log(`       Saved sample XML → ${savePath}`);
    }
    const debtorBic = (xml.match(/<DbtrAgt>[\s\S]*?<BIC>([^<]*)<\/BIC>[\s\S]*?<\/DbtrAgt>/) || [])[1] || '';
    const creditorBic = (xml.match(/<CdtrAgt>[\s\S]*?<BIC>([^<]*)<\/BIC>[\s\S]*?<\/CdtrAgt>/) || [])[1] || '';
    const amt = (xml.match(/<InstdAmt[^>]*>([^<]*)<\/InstdAmt>/) || [])[1] || '';
    console.log(`       XML parsed: DbtrBIC=${debtorBic || 'N/A'}  CdtrBIC=${creditorBic || 'N/A'}  Amt=€${amt || 'N/A'}`);
  } catch (e) {
    console.log(`[5/6] ❌ POST execute FAIL: HTTP ${e.response?.status} body=${JSON.stringify(e.response?.data || e.message).slice(0,500)}`);
    return process.exit(6);
  }

  try {
    const list = await axios.get(`${BASE}/api/vault/sepa/transfers?search=SMOKE`, hdr);
    const rows = Array.isArray(list.data) ? list.data : (list.data?.rows || []);
    console.log(`[6/6] ✅ GET /sepa/transfers → ${rows.length} rows matching SMOKE search`);
    rows.slice(0,3).forEach(r => console.log(`       · ref=${r.reference} status=${r.status} amt=${Number(r.amount).toFixed(2)}${r.currency} uetr=${String(r.uetr||'').slice(0,18)}…`));
  } catch (e) {
    console.log(`[6/6] ❌ GET transfers FAIL: HTTP ${e.response?.status} body=${JSON.stringify(e.response?.data || e.message).slice(0,400)}`);
    return process.exit(7);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("✅ 6/6 VAULT SMOKE TEST PASSED");
  console.log("   Quickstart for UI:");
  console.log("   1. Start backend  → cd backend; npm run dev    (:7000)");
  console.log("   2. Start frontend → cd client;  npm run dev    (usually :5173)");
  console.log("   3. Browser → http://localhost:5173/vault-bank");
  console.log("   4. Tab0 Overview: EDIT PROC-VAULT-EUR-001  BIC + IBAN placeholders (click edit icon)");
  console.log("   5. Tab1 New Transfer → defaults are already €50k → Wise EUR → click [Preview & Execute]");
  console.log("   6. XML auto-downloads → upload to your processor vault SEPA batch portal");
  console.log("═══════════════════════════════════════════════════════════════");
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e); process.exit(99); });
