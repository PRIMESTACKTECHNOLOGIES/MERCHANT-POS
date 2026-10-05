const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
  });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  if (!tables.length) { console.log('no tables'); process.exit(0); }
  console.log('TABLES:');
  tables[0].values.forEach(r => {
    const name = r[0];
    const cols = db.exec(`PRAGMA table_info(${name})`);
    const n = cols[0]?.values?.length || 0;
    const count = db.exec(`SELECT COUNT(*) FROM '${name}'`);
    const rows = count[0]?.values?.[0]?.[0] || 0;
    const colNames = cols[0]?.values?.map(c => c[1])?.slice(0, 12)?.join(', ') || '';
    console.log(`  ${name.padEnd(38)} ${String(rows).padStart(6)} rows   cols(${n}): ${colNames}`);
  });
  // Sample the POS txn table (likely pos_transactions or merchant_transactions)
  for (const needle of ['pos_transactions','merchant_transactions','transactions','sales','orders','payments']) {
    const name = tables[0].values.flat().find(n => n.toLowerCase().includes(needle.toLowerCase()));
    if (name) {
      console.log(`\nSample rows from candidate POS txn table [${name}]:`);
      try {
        const sample = db.exec(`SELECT * FROM '${name}' ORDER BY rowid DESC LIMIT 3`);
        if (sample.length) {
          const cols = sample[0].columns;
          sample[0].values.slice(0,5).forEach((row,i) => {
            console.log(`  #${i+1}:`);
            cols.forEach((c,j) => {
              let v = String(row[j] ?? '');
              if (v.length > 80) v = v.slice(0,80)+'…';
              console.log(`      ${c.padEnd(22)} = ${v}`);
            });
          });
        }
      } catch(e) { console.log('  err', e.message); }
    }
  }
})();
