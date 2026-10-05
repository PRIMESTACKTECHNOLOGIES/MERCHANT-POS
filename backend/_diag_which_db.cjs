const fs = require('fs');
const path = require('path');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const dbPaths = [
    path.join(__dirname, 'data', 'database.sqlite'),
    path.join(__dirname, '..', 'database.sqlite'),
    path.join(__dirname, '..', 'OFFLINE-WALLET-POS-201.3', 'database.sqlite'),
  ];

  const q = (db, sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  for (const dbp of dbPaths) {
    console.log('\n============================================================');
    console.log('DB:', dbp);
    console.log('Exists:', fs.existsSync(dbp));
    if (!fs.existsSync(dbp)) continue;

    const fileBuffer = fs.readFileSync(dbp);
    const db = new SQL.Database(fileBuffer);

    try {
      const custs = q(db, "SELECT id, name, kyc_status, country FROM customers ORDER BY created_at DESC LIMIT 5");
      console.log('Recent customers (' + custs.length + '):');
      custs.forEach(c => console.log('  -', c.name.padEnd(30), '|', c.id.slice(0,12)+'...', '| KYC:'+c.kyc_status, '| Country:'+c.country));

      const search = q(db, "SELECT id, name, kyc_status FROM customers WHERE name LIKE '%WONG%' OR name LIKE '%HUEN%'");
      if (search.length) {
        console.log('  *** FOUND WONG match:', search[0].name, search[0].id);
      }

      const wallets = q(db, "SELECT COUNT(*) AS c FROM customer_wallets")[0].c;
      const txns = q(db, "SELECT COUNT(*) AS c FROM wallet_transactions")[0].c;
      const ledger = q(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_entries'");
      const ledgerCount = ledger.length ? q(db, 'SELECT COUNT(*) AS c FROM ledger_entries')[0].c : 0;
      console.log('  customer_wallets  :', wallets);
      console.log('  wallet_txns       :', txns);
      console.log('  ledger_entries    :', ledgerCount);
    } catch (e) {
      console.log('  (no customers table or error:', e.message, ')');
    }
    db.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
