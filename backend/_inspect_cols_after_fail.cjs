const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, "node_modules", "sql.js", "dist", f) });
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, "data", "database.sqlite")));
  const q = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
  console.log("=== merchant_wallet_transactions PRAGMA ===");
  const mwt = q("PRAGMA table_info(merchant_wallet_transactions)");
  mwt.forEach(c => console.log("  ", c.cid, c.name, c.type));
  console.log("\n=== wallet_transactions PRAGMA ===");
  const wt = q("PRAGMA table_info(wallet_transactions)");
  wt.forEach(c => console.log("  ", c.cid, c.name, c.type));
  console.log("\n=== CURRENT MERCHANT WALLET USD (MRC-1001) ===");
  const mw = q("SELECT id,merchant_id,currency,balance,updated_at FROM merchant_wallets WHERE merchant_id=? AND currency=?", ["MRC-1001","USD"]);
  mw.forEach(w => console.log("  balance=$" + Number(w.balance).toLocaleString() + "  id=" + w.id + "  updated=" + (w.updated_at||"").slice(0,19)));
  console.log("\n=== CURRENT CUSTOMER WALLET PSW-6280-7230 ===");
  const cw = q("SELECT cw.id,customer_id,c.name,cw.balance,cw.currency,cw.wallet_code,cw.card_id,cw.updated_at FROM customer_wallets cw LEFT JOIN customers c ON c.id=cw.customer_id WHERE cw.wallet_code=?", ["PSW-6280-7230"]);
  cw.forEach(w => console.log("  name=" + w.name + "  balance=$" + Number(w.balance).toLocaleString() + "  id=" + w.id + "  card=" + (w.card_id||"").slice(0,12)));
  console.log("\n=== RECENT 5 wallet_transactions for customer ===");
  if (cw.length) {
    const txns = q("SELECT id,type,amount,currency,source,reference,pan_masked,created_at FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC LIMIT 5", [cw[0].id]);
    txns.forEach(t => console.log("  " + t.type + " $" + Number(t.amount).toLocaleString() + " " + t.currency + " src=" + (t.source||"") + " ref=" + String(t.reference||"").slice(0,30) + " pan=" + (t.pan_masked||"") + " at=" + (t.created_at||"").slice(0,19)));
  }
  console.log("\n=== RECENT 5 merchant_wallet_transactions ===");
  if (mw.length) {
    const mtxns = q("SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC LIMIT 5", [mw[0].id]);
    if (mtxns.length) console.log("  columns:", Object.keys(mtxns[0]).join(","));
    mtxns.forEach(t => console.log("  " + t.type + " $" + Number(t.amount).toLocaleString() + " " + t.currency + " src=" + (t.source||"") + " ref=" + String(t.reference||"").slice(0,30) + " at=" + (t.created_at||"").slice(0,19)));
  }
})();
