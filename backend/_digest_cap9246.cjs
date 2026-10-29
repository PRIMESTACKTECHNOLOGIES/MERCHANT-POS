require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');

  const captureRef = 'CAP-924648AF-439';
  const authRef = 'INT-MUJ277GT-000001';

  // 1. Find all tables + cols, then search the captureRef
  console.log('=== All tables in database ===');
  const tables = (await db.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)).rows.map(r => r.name);
  console.log(tables.join(', '));

  console.log('\n=== EVERYTHING referencing captureRef', captureRef, '===');
  for (const t of tables) {
    let cols;
    try { cols = (await db.query(`PRAGMA table_info(${t})`)).rows.map(r => r.name); } catch { continue; }
    if (!cols.length) continue;
    const where = cols.map(c => `COALESCE(CAST(${c} AS TEXT),'') LIKE ?`).join(' OR ');
    const vals = cols.map(() => '%' + captureRef + '%');
    try {
      const r = await db.query(`SELECT * FROM ${t} WHERE ${where}`, vals);
      if (r.rows && r.rows.length) {
        console.log(`\n>>> [${t}]:`);
        console.log(JSON.stringify(r.rows, null, 2));
      }
    } catch {}
  }

  console.log('\n=== EVERYTHING referencing authRef', authRef, '===');
  for (const t of tables) {
    let cols;
    try { cols = (await db.query(`PRAGMA table_info(${t})`)).rows.map(r => r.name); } catch { continue; }
    if (!cols.length) continue;
    const where = cols.map(c => `COALESCE(CAST(${c} AS TEXT),'') LIKE ?`).join(' OR ');
    const vals = cols.map(() => '%' + authRef + '%');
    try {
      const r = await db.query(`SELECT * FROM ${t} WHERE ${where}`, vals);
      if (r.rows && r.rows.length) {
        console.log(`\n>>> [${t}]:`);
        console.log(JSON.stringify(r.rows, null, 2));
      }
    } catch {}
  }

  // 2. ledger chain - check ledger_entries and ledger_transactions for $1 refs
  console.log('\n=== Ledger tables for $1 USD today ===');
  for (const t of ['ledger_entries','ledger_transactions','vault_ledger','vault_entries']) {
    try {
      const cols = (await db.query(`PRAGMA table_info(${t})`)).rows.map(r => r.name);
      if (!cols.length) continue;
      console.log(`\n[${t}] cols:`, cols.join(', '));
      const r = await db.query(
        `SELECT * FROM ${t}
          WHERE (ABS(CAST(amount AS REAL) - 1.0) < 0.001 OR CAST(amount AS REAL) = 100)
            AND date(created_at) = date('2026-09-27')
          ORDER BY created_at DESC LIMIT 10`
      );
      console.log('rows:', JSON.stringify(r.rows, null, 2));
    } catch(e) { console.log(`[${t}] err:`, e.message); }
  }

  // 3. card_authorizations for the code "977614" (INT-MUJ277GT-000001 / stan 000001)
  console.log('\n=== card_authorizations (protocol codes table) ===');
  try {
    const cols = (await db.query(`PRAGMA table_info(card_authorizations)`)).rows.map(r => r.name);
    console.log('cols:', cols.join(', '));
    const r = await db.query(`SELECT * FROM card_authorizations WHERE code = '977614' OR protocol = '201.3' ORDER BY updated_at DESC LIMIT 5`);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  // 4. Look for any plaintext API KEYS anywhere (scan all tables for known prefix patterns)
  console.log('\n=== PLAINTEXT SECRET SCAN (any table cols containing API key/secret/sk_ patterns) ===');
  const patterns = ['sk_live_', 'sk_test_', 'pk_live_', 'PSPK-', 'PSSK-', 'bearer ', 'api_key', 'secret'];
  let hits = 0;
  for (const t of tables) {
    let cols;
    try { cols = (await db.query(`PRAGMA table_info(${t})`)).rows.filter(c => /text|char|clob/i.test(c.type) || !c.type).map(r => r.name); } catch { continue; }
    for (const c of cols) {
      for (const pat of patterns) {
        try {
          const r = await db.query(`SELECT DISTINCT substr(${c},1,80) AS x FROM ${t} WHERE lower(${c}) LIKE lower(?) LIMIT 1`, [ '%' + pat + '%' ]);
          if (r.rows && r.rows.length) {
            console.log(`MATCH table=${t} col=${c} pattern=${pat}:`, JSON.stringify(r.rows[0]));
            hits++;
          }
        } catch {}
      }
    }
  }
  console.log(`Total plaintext secret hits: ${hits}`);
})();
