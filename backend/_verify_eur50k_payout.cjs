const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
(async () => {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, "node_modules", "sql.js", "dist", f),
  });
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, "data", "database.sqlite")));
  const q = (s, p = []) => {
    const r = db.exec(s, p);
    if (!r.length) return [];
    return r[0].values.map((row) => {
      const o = {};
      r[0].columns.forEach((c, i) => (o[c] = row[i]));
      return o;
    });
  };
  const one = (s, p = []) => q(s, p)[0];
  console.log("━━ VERIFICATION: EUR 50K PERSISTED ━━");
  const w = one("SELECT balance, currency FROM merchant_wallets WHERE merchant_id=? AND currency=?", ["MRC-1001", "EUR"]);
  console.log("EUR wallet NOW: " + Number(w.balance).toLocaleString() + " " + w.currency);
  const led = one(
    "SELECT " +
      "COALESCE(SUM(CASE WHEN type='credit' AND status IN ('AUTHORIZED','CAPTURED','SETTLED') THEN amount ELSE 0 END),0) AS cr, " +
      "COALESCE(SUM(CASE WHEN type='debit' AND status IN ('AUTHORIZED','CAPTURED','SETTLED') THEN amount ELSE 0 END),0) AS dr " +
      "FROM ledger_entries WHERE merchant_id=? AND currency=?",
    ["MRC-1001", "EUR"]
  );
  const net = Number(led.cr || 0) - Number(led.dr || 0);
  console.log("EUR ledger net: " + Number(net).toLocaleString() + " EUR");
  const match = Math.abs(Number(w.balance) - net) < 0.01;
  console.log("MATCH: " + (match ? "YES \u2705" : "NO \u274C"));
  const pay = one(
    "SELECT id, merchant_id, amount, currency, status, provider, provider_reference, reference, created_at " +
      "FROM merchant_payouts WHERE merchant_id=? AND currency=? ORDER BY created_at DESC LIMIT 1",
    ["MRC-1001", "EUR"]
  );
  console.log("\nLatest payout:");
  console.log("  ID        : " + pay.id);
  console.log("  Amount    : " + Number(pay.amount).toLocaleString() + " " + pay.currency);
  console.log("  Status    : " + pay.status);
  console.log("  Provider  : " + pay.provider);
  console.log("  Wise Ref  : " + pay.provider_reference + " (Wise Transfer ID)");
  console.log("  System Ref: " + pay.reference);
  console.log("  Created   : " + pay.created_at);
})();
