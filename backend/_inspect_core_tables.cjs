const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
  });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => {
    const r = db.exec(sql, p);
    if (!r.length) return [];
    return r[0].values.map(row => {
      const o = {};
      r[0].columns.forEach((c,i) => o[c] = row[i]);
      return o;
    });
  };
  for (const t of ['merchant_wallet_transactions','merchant_payouts','merchant_wallets','ledger_entries','bank_accounts']) {
    const cols = q(`PRAGMA table_info(${t})`);
    console.log(`\n■ ${t} (${cols.length} cols)`);
    cols.forEach(c => console.log(`   ${c.cid.toString().padStart(2)} ${c.name.padEnd(26)} ${c.type.padEnd(12)} ${c.notnull?'NOT NULL':''} pk=${c.pk}${c.dflt_value?`  DEFAULT ${c.dflt_value}`:''}`));
  }
  console.log('\nSample merchant_wallet_transactions row:');
  const sample = q(`SELECT * FROM merchant_wallet_transactions ORDER BY created_at DESC LIMIT 1`);
  console.log(JSON.stringify(sample, null, 2));
})();
