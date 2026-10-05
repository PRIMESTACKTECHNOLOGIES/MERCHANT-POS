const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, "node_modules", "sql.js", "dist", f) });
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, "data", "database.sqlite")));
  const q = (sql, p = []) => {
    const stmt = db.prepare(sql); stmt.bind(p);
    const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
  };

  console.log("=== MERCHANT WALLETS (MRC-1001) ===");
  const mw = q("SELECT id,merchant_id,currency,balance,updated_at FROM merchant_wallets WHERE merchant_id=?", ["MRC-1001"]);
  mw.forEach(w => console.log("  " + w.currency + ": " + Number(w.balance).toLocaleString() + "  id=" + w.id.slice(0,16) + "  upd=" + (w.updated_at||"").slice(0,19)));

  console.log("\n=== RECENT MERCHANT TXNS (last 5) ===");
  const mwIds = mw.map(w => w.id);
  if (mwIds.length) {
    const ph = mwIds.map(() => "?").join(",");
    const mwt = q("SELECT id,type,amount,currency,source,reference,created_at FROM merchant_wallet_transactions WHERE wallet_id IN (" + ph + ") ORDER BY created_at DESC LIMIT 5", mwIds);
    mwt.forEach(t => console.log("  " + t.type + " $" + Number(t.amount).toLocaleString() + " " + t.currency + " " + (t.source||"") + " " + String(t.reference||"").slice(0,40) + " " + (t.created_at||"").slice(0,19)));
  }

  console.log("\n=== EXISTING CUSTOMER (by name or wallet PSW-6280-7230) ===");
  const c1 = q("SELECT id,name,email,phone,kyc_status FROM customers WHERE UPPER(name) LIKE '%ARMAN%' OR UPPER(name) LIKE '%ARAKELYAN%'");
  const c2 = q("SELECT id,customer_id,balance,currency,wallet_code,status FROM customer_wallets WHERE wallet_code=?", ["PSW-6280-7230"]);
  console.log("  by name:", JSON.stringify(c1));
  console.log("  by wallet_code:", JSON.stringify(c2));

  console.log("\n=== card_authorizations (by code 791010) ===");
  const a = q("SELECT id,code,protocol,status,amount,currency,pan_masked,card_number,customer_id,merchant_id FROM card_authorizations WHERE code=? ORDER BY created_at DESC LIMIT 3", ["791010"]);
  console.log("  rows:", a.length, JSON.stringify(a));

  console.log("\n=== pos2013_transactions (auth 791010) ===");
  const p = q("SELECT id,stan,auth_code,status,amount_minor,currency,pan_masked,local_txn_id,txn_timestamp FROM pos2013_transactions WHERE auth_code=? ORDER BY txn_timestamp DESC LIMIT 3", ["791010"]);
  console.log("  rows:", p.length, JSON.stringify(p));
})();
