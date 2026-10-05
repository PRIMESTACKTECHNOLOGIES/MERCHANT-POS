const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, "node_modules", "sql.js", "dist", f) });
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, "data", "database.sqlite")));
  const q = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
  for (const t of ['card_authorizations','wallet_cards','pos2013_transactions','ledger_entries','merchant_wallet_transactions','wallet_transactions','customer_wallets','merchant_wallets']) {
    console.log('\n===== ' + t + ' =====');
    q('PRAGMA table_info(' + t + ')').forEach(c => console.log('  ', c.cid.toString().padStart(2), c.name.padEnd(30), c.type));
  }
  console.log('\n==== CURRENT MERCHANT USD (MRC-1001) ====');
  q("SELECT id,merchant_id,currency,balance FROM merchant_wallets WHERE merchant_id='MRC-1001' AND currency='USD'").forEach(w => console.log('  $' + Number(w.balance).toLocaleString() + '  id=' + w.id));
  console.log('\n==== CURRENT CUSTOMER PSW-6280-7230 ====');
  q("SELECT c.name,cw.balance,cw.currency,cw.id FROM customer_wallets cw LEFT JOIN customers c ON c.id=cw.customer_id WHERE cw.wallet_code='PSW-6280-7230'").forEach(w => console.log('  ' + w.name + ' $' + Number(w.balance).toLocaleString() + '  id=' + w.id));
})();
