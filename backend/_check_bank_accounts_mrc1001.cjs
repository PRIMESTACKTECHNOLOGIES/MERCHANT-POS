const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
  });
  if (!fs.existsSync(DB_PATH)) { console.log('!no db'); process.exit(1); }
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p = []) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => {
        const o = {};
        r[0].columns.forEach((c, i) => o[c] = row[i]);
        return o;
      });
    } catch (e) { console.error('SQL ERR:', e.message); throw e; }
  };
  const one = (sql, p = []) => q(sql, p)[0];

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🏦 SAVED BANK ACCOUNTS FOR MRC-1001');
  console.log('═══════════════════════════════════════════════════════════════════');

  const cols = q(`PRAGMA table_info(bank_accounts)`).map(r => r.name);
  console.log('   Columns:', cols.join(' | '));

  const banks = q(`SELECT * FROM bank_accounts ORDER BY merchant_id, currency`);
  if (banks.length === 0) console.log('   No bank_accounts table rows. Try merchant_bank_accounts / accounts tables...');
  else {
    banks.forEach((b, i) => {
      console.log(`\n   [${i+1}] id=${b.id}`);
      Object.entries(b).forEach(([k, v]) => {
        if (v !== null && v !== '' && !['id','created_at','updated_at'].includes(k)) {
          console.log(`     ${k} = ${String(v).length > 80 ? String(v).slice(0,77)+'...' : v}`);
        }
      });
    });
  }

  // fallback: check if there's a merchant_bank_accounts table
  const allTables = q(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%bank%' OR name LIKE '%account%'`).map(r => r.name);
  console.log('\n   Bank-related tables:', allTables.join(', '));
  for (const t of allTables) {
    if (t === 'bank_accounts') continue;
    const rows = q(`SELECT * FROM ${t} LIMIT 20`);
    if (rows.length) {
      console.log(`\n   Sample from ${t} (${rows.length} rows):`);
      rows.slice(0, 5).forEach((r, i) => console.log(`     ${i+1}. ${JSON.stringify(r).slice(0,200)}`));
    }
  }

  // Also check inside the last payout for ABSA we know was used
  const lastPayout = one(`
    SELECT id, bank_account, destination, provider, currency, status
    FROM merchant_payouts
    WHERE merchant_id = ? AND status = 'COMPLETED'
    ORDER BY completed_at DESC LIMIT 1
  `, [MERCHANT_ID]);
  if (lastPayout) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('✅ LAST COMPLETED PAYOUT BANK DETAILS (ABSA — already proven to work)');
    console.log('   Payout ID:', lastPayout.id);
    console.log('   Currency:', lastPayout.currency, ' | Provider:', lastPayout.provider);
    try {
      const obj = lastPayout.bank_account ? JSON.parse(lastPayout.bank_account) : null;
      if (obj) {
        console.log('   Parsed bank_account object:');
        Object.entries(obj).forEach(([k,v]) => console.log(`     ${k} = ${v}`));
      }
    } catch (_) { console.log('   bank_account (raw):', String(lastPayout.bank_account||'').slice(0,300)); }
    if (lastPayout.destination && lastPayout.destination !== lastPayout.bank_account) {
      console.log('   destination (raw):', String(lastPayout.destination||'').slice(0,200));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
