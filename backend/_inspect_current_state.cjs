const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, "node_modules", "sql.js", "dist", f) });
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, "data", "database.sqlite")));
  const q = (sql, p = []) => {
    const r = db.exec(sql, p);
    if (!r.length) return [];
    return r[0].values.map(row => { const o = {}; r[0].columns.forEach((c, i) => o[c] = row[i]); return o; });
  };
  console.log("━━ RECENT merchant_payouts (EUR + USD, last 20) ━━");
  const pays = q("SELECT id, merchant_id, amount, currency, status, provider, provider_reference, reference, created_at, completed_at, approved_by, reconciliation_status FROM merchant_payouts WHERE merchant_id='MRC-1001' ORDER BY created_at DESC LIMIT 20");
  pays.forEach((p, i) => {
    console.log(`${String(i+1).padStart(2)}. id=${p.id.slice(0,24)}… amt=${Number(p.amount).toLocaleString()} ${p.currency}  st=${p.status}  prov=${p.provider||"null"}  provref=${String(p.provider_reference||"null").slice(0,28)}  ref=${String(p.reference||"null").slice(0,24)}  created=${p.created_at?.slice(0,19)}  done=${p.completed_at?.slice(0,19)||"NULL"}  by=${String(p.approved_by||"null").slice(0,20)}  recon=${p.reconciliation_status||"null"}`);
  });
  console.log("\n━━ merchant_wallets MRC-1001 ━━");
  const ws = q("SELECT id, merchant_id, currency, balance, updated_at FROM merchant_wallets WHERE merchant_id='MRC-1001' ORDER BY currency");
  ws.forEach(w => console.log(`  ${w.currency}: ${Number(w.balance).toLocaleString()}  (id=${w.id.slice(0,20)}… updated=${w.updated_at?.slice(0,19)||"null"})`));
  console.log("\n━━ 50k-ish EUR ledger entries type=debit (last 10) ━━");
  const leds = q("SELECT id, transaction_id, type, amount, currency, status, reference, source_type, source_reference, created_at FROM ledger_entries WHERE merchant_id='MRC-1001' AND currency='EUR' AND type='debit' AND ABS(amount-50000)<0.01 ORDER BY created_at DESC LIMIT 10");
  leds.forEach((l, i) => console.log(`${i+1}. ${l.id.slice(0,32)}…  amt=${Number(l.amount)}  st=${l.status}  ref=${String(l.reference||"null").slice(0,50)}  src=${String(l.source_type||"null")}  srcref=${String(l.source_reference||"null").slice(0,40)}`));
})();
