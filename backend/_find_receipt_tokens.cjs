require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');

  // 1. Search for ALL $1 USD transactions today (Sep 27 2026) - no reference strings
  console.log('=== wallet_transactions today (Sep 27 2026) any amount near $1 USD ===');
  try {
    const r = await db.query(
      `SELECT * FROM wallet_transactions
        WHERE date(created_at) IN ('2026-09-27')
        ORDER BY created_at DESC LIMIT 30`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  console.log('\n=== merchant_wallet_transactions today (Sep 27) all rows ===');
  try {
    const r = await db.query(
      `SELECT * FROM merchant_wallet_transactions
        WHERE date(created_at) IN ('2026-09-27')
        ORDER BY created_at DESC LIMIT 30`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  // 2. Look for receipt reference strings the user provided
  //    txn_1790513622314_5nub0nij5  setl_online_muj277j8  STAN=000001  7789  MANUAL  ONLINE_APPROVED
  console.log('\n=== GLOBAL SCAN for receipt tokens ===');
  const tokens = [
    'txn_1790513622314_5nub0nij5', 'txn_179051', '5nub0nij5',
    'setl_online_muj277j8', 'setl_online_muj277', 'muj277j8',
    '000001',
    '7789',
  ];
  const tables = (await db.query(`SELECT name FROM sqlite_master WHERE type='table'`)).rows.map(r => r.name);
  for (const tok of tokens) {
    console.log(`\n-- token: "${tok}"`);
    for (const t of tables) {
      let cols;
      try { cols = (await db.query(`PRAGMA table_info(${t})`)).rows.map(c => c.name); } catch { continue; }
      if (!cols.length) continue;
      let whereClause = cols.map(c => `CAST(COALESCE(${c},'') AS TEXT) LIKE '%${String(tok).replace(/'/g,"''")}%'`).join(' OR ');
      try {
        const r = await db.query(`SELECT * FROM ${t} WHERE ${whereClause} LIMIT 5`);
        if (r.rows && r.rows.length) {
          console.log(`  >>> table=${t} (${r.rows.length} match)`);
          console.log(JSON.stringify(r.rows, null, 2).split('\n').map(l=>'    '+l).join('\n'));
        }
      } catch {}
    }
  }

  // 3. Check ALL SQLite DB files found earlier (check alternate DBs too)
  console.log('\n=== Check alternate database file: pos_offline.db  ===');
  try {
    const Database = require('better-sqlite3');
    const dbo = new Database(require('path').resolve(process.cwd(), 'pos_offline.db'));
    dbo.pragma('journal_mode = WAL');
    const tables2 = dbo.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r=>r.name);
    console.log('Tables in pos_offline.db:', tables2.length, tables2.slice(0,50).join(', '));
    for (const tok of tokens) {
      for (const t of tables2) {
        try {
          const cols = dbo.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
          if (!cols.length) continue;
          let whereClause = cols.map(c => `CAST(COALESCE(${c},'') AS TEXT) LIKE ?`).join(' OR ');
          const params = cols.map(() => `%${tok}%`);
          const r = dbo.prepare(`SELECT * FROM ${t} WHERE ${whereClause} LIMIT 3`).all(...params);
          if (r.length) {
            console.log(`\n  >>> pos_offline.db: table=${t} token="${tok}"`);
            console.log(JSON.stringify(r,null,2).split('\n').map(l=>'    '+l).join('\n'));
          }
        } catch {}
      }
    }
    dbo.close();
  } catch(e) { console.log('pos_offline.db error (might need separate driver):', e.message); }
})();
