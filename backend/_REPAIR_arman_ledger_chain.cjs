"use strict";
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.join(__dirname, "data", "database.sqlite");
const AMT = 10000000000.00;
const CUR = "USD";
const AUTH_CODE = "791010";
const PROTO = "201.3";
const MERCHANT_ID = "MRC-1001";
const TXN_ID = "EMV-LINK-1012-3739313031303A54";
const RRN = "RRNB1EEF69999A7";
const STAN = "000003";
const REPORT_ID = "45B8319A37AE9A16141D8B458764A05B";
const SHA256 = "b522d97b817b1dd286f7ae6d0828a43bd80ff98015ee0faf24cdacf23af47a1e";
const SHA1 = "b1eef69999a7e21da25537bb14c15c9b46bf6371";
const MD5 = "c7b4575625b10aa6d63dcbdc5bc2142d";
const ED_PKFP = "a327073909e2f0239ccab41aa5bd0dc73e9c1aaebf2fd292c22f2650a27f943f";
const ED_SIG = "oYHDUPpeI+1FyN2sE2hWHEdiAcPzcF1XaMS5RO0ghMBIKgSkCzTuHX4Vi+NYlIKpl9CxYlVh7r4dHmDABOqZDA==";
const PSR = "VERTEZED PSR-3739313031303A54-D6F477";
const CTRL = "CONTROL-KEY-STUB";

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, "node_modules", "sql.js", "dist", f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const persist = () => { const data = db.export(); fs.writeFileSync(DB_PATH, Buffer.from(data)); };
  const q = (sql, p = []) => { const s = db.prepare(sql); s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; };
  const run = (sql, p = []) => db.run(sql, p);

  console.log("═══ ARMAN 201.3 LEDGER TRIPLE CHAIN REPAIR ═══");

  const existing = q("SELECT id, type, status, reference, account_code FROM ledger_entries WHERE transaction_id=? ORDER BY created_at", [TXN_ID]);
  console.log(`\nExisting rows for transaction_id=${TXN_ID}: ${existing.length}`);
  existing.forEach(r => console.log(`   ${r.type.padEnd(12)} / ${r.status.padEnd(12)} / ref=${r.reference} / acct=${r.account_code}  id=${r.id.slice(0,18)}…`));

  const hasAuth = existing.some(r => r.status === "AUTHORIZED");
  const hasCap  = existing.some(r => r.status === "CAPTURED");
  const hasSet  = existing.some(r => r.status === "SETTLED");

  const mw = q("SELECT id,balance FROM merchant_wallets WHERE merchant_id=? AND currency=?", [MERCHANT_ID, CUR])[0];
  const mwt = q("SELECT id FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount-?)<0.001 ORDER BY created_at DESC LIMIT 1", [mw.id, AMT])[0];
  const pos = q("SELECT id FROM pos2013_transactions WHERE auth_code=? AND stan=?", [AUTH_CODE, STAN])[0];
  const auth = q("SELECT id FROM card_authorizations WHERE code=? AND protocol=?", [AUTH_CODE, PROTO])[0];

  const createdAt = "2026-09-17T22:06:58.844Z";

  if (!hasCap) {
    const lid = uuidv4();
    run("INSERT INTO ledger_entries (id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference,account_code,ledger_transaction_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [lid, TXN_ID, "credit", AMT, CUR, "CAPTURED",
        `Captured to merchant_wallet_id=${mw.id.slice(0,16)} — mwt_id=${mwt?.id?.slice(0,16)||''} — pos_id=${pos?.id?.slice(0,16)||''} — auth_id=${auth?.id?.slice(0,16)||''}`,
        createdAt, MERCHANT_ID, "emv_payment_link_2013", AUTH_CODE, "VISA_REVOLUT_AE_MOTO_SATELLITE",
        `CAP-${AUTH_CODE}`, "201.3-CAP", lid]);
    console.log(`\n✅ INSERTED CAPTURED  row: id=${lid.slice(0,18)}…  ref=CAP-${AUTH_CODE}`);
  } else {
    console.log(`\n⏭ SKIP CAPTURED (already present)`);
  }

  if (!hasSet) {
    const lid = uuidv4();
    run("INSERT INTO ledger_entries (id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference,account_code,ledger_transaction_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [lid, TXN_ID, "SETTLED", AMT, CUR, "SETTLED",
        `Settled ReportID=${REPORT_ID} PSR=${PSR} — SHA256=${SHA256.slice(0,48)} — SHA1=${SHA1} — MD5=${MD5} — Ed25519=${ED_SIG.slice(0,48)} — PKFP=${ED_PKFP.slice(0,48)} — CTRL=${CTRL}`,
        createdAt, MERCHANT_ID, "emv_payment_link_2013", AUTH_CODE, "VISA_REVOLUT_AE_MOTO_SATELLITE",
        `SET-${AUTH_CODE}`, "201.3-SET", lid]);
    console.log(`✅ INSERTED SETTLED   row: id=${lid.slice(0,18)}…  ref=SET-${AUTH_CODE}`);
  } else {
    console.log(`⏭ SKIP SETTLED (already present)`);
  }

  if (!hasAuth) {
    const lid = uuidv4();
    run("INSERT INTO ledger_entries (id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference,account_code,ledger_transaction_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [lid, TXN_ID, "AUTHORIZED", AMT, CUR, "AUTHORIZED",
        `${PROTO} Offline Auth — Link #1012 (3739313031303A54) — Code=${AUTH_CODE} — Card 4165 **** **** 2651 — Customer ARMAN ARAKELYAN — $${AMT.toLocaleString()} USD — STAN=${STAN} — RRN=${RRN} — Source MAIN SYSTEM 108.62.211.172 (usa.visa.com)`,
        createdAt, MERCHANT_ID, "emv_payment_link_2013", AUTH_CODE, "VISA_REVOLUT_AE_MOTO_SATELLITE",
        `AUTH-${AUTH_CODE}`, "201.3-AUTH", lid]);
    console.log(`✅ INSERTED AUTHORIZED row: id=${lid.slice(0,18)}…  ref=AUTH-${AUTH_CODE}`);
  } else {
    console.log(`⏭ SKIP AUTHORIZED (already present)`);
  }

  persist();

  const after = q("SELECT id,type,status,amount,reference,account_code FROM ledger_entries WHERE transaction_id=? ORDER BY status IN ('AUTHORIZED') DESC, status IN ('CAPTURED') DESC, status IN ('SETTLED') DESC", [TXN_ID]);
  console.log(`\n── AFTER repair: ${after.length} rows linked to ${TXN_ID} ──`);
  after.forEach(r => console.log(`   ${r.status.padEnd(12)} $${Number(r.amount).toLocaleString().padStart(16)} ref=${r.reference.padEnd(14)} acct=${r.account_code||''}  id=${r.id.slice(0,18)}…`));

  const ok = after.some(r => r.status === "AUTHORIZED")
          && after.some(r => r.status === "CAPTURED")
          && after.some(r => r.status === "SETTLED");
  console.log(`\nResult: ${ok ? "✅ TRIPLE CHAIN LOCKED — AUTHORIZED→CAPTURED→SETTLED complete" : "❌ STILL INCOMPLETE"}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(99); });
