const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs"); const path = require("path");
(async()=>{
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname,"data","database.sqlite")));
  const q  = (s,p=[])=>{const st=db.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;};
  console.log("=== merchant_wallets (MRC-1001) ===");
  console.log(JSON.stringify(q("SELECT * FROM merchant_wallets WHERE merchant_id=? ORDER BY id",["MRC-1001"]),null,2));
  console.log("\n=== merchant_wallet_transactions (MW-EUR-1001) ===");
  console.log(JSON.stringify(q("SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? ORDER BY datetime(created_at) ASC",["MW-EUR-1001"]),null,2));
  console.log("\n=== ledger_entries (MRC-1001, EUR) ===");
  const ledg = q("SELECT * FROM ledger_entries WHERE merchant_id=? AND currency=? ORDER BY datetime(created_at) ASC",["MRC-1001","EUR"]);
  ledg.forEach((r,i)=>{
    const meta = `[${i}] ${r.status} ${r.type} ${r.amount} ${r.currency} tx=${r.transaction_id?.slice(0,14)||"NULL"} ref=${String(r.reference||"").slice(0,40)} srcRef=${String(r.source_reference||"").slice(0,42)}`;
    console.log("  id=" + r.id.slice(0,18) + "… " + meta);
  });
  console.log("\n=== ledger_entries NET SUM ==", q("SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE -amount END),0) net FROM ledger_entries WHERE merchant_id=? AND currency=?",["MRC-1001","EUR"]));
  console.log("=== merchant_payouts (MRC-1001) ===");
  console.log(JSON.stringify(q("SELECT id,amount,currency,status,approved_by,reconciliation_status,provider,reference FROM merchant_payouts WHERE merchant_id=? ORDER BY datetime(created_at) ASC",["MRC-1001"]),null,2));
})();
