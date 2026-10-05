const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const PROVIDER_REF = 'ABSA-AUTO-SETTLE-1788875393994';

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => { try { const r = db.exec(sql, p); if (!r.length) return []; return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; }); } catch(e){ console.error('SQL ERR:', e.message); return []; } };
  const one = (sql,p=[]) => q(sql,p)[0];

  // 1) list all tables
  const tables = q(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).map(r => r.name);
  console.log('TABLES:', tables.join(', '), '\n');

  const payoutLike = tables.filter(t => /payout|settlement|withdraw|transfer|bank/i.test(t));
  console.log('PAYOUT-LIKE TABLES:', payoutLike.join(', '));

  // Search each payout-like table for the provider reference or for MRC-1001 / $50k amounts
  const KEYWORDS = [PROVIDER_REF, '1788875393994', '13aac090-d6d4-4871-ad292-a81e08c8d470', 'OUTBOUND_WIRE_SENT'];
  for (const tbl of payoutLike) {
    console.log(`\n── Table: ${tbl}  (PRAGMA cols: ${q(`PRAGMA table_info(${tbl})`).map(c=>c.name).join(', ')})`);
    try {
      const cols = q(`PRAGMA table_info(${tbl})`).map(c=>c.name);
      const allRows = q(`SELECT * FROM ${tbl} LIMIT 20`);
      if (!allRows.length) { console.log('   empty.'); continue; }
      // Filter rows matching keywords if any text col matches
      const hits = allRows.filter(r => JSON.stringify(r).includes('MRC-1001') || JSON.stringify(r).includes('50,000') || KEYWORDS.some(k => JSON.stringify(r).includes(k)) || Object.values(r).some(v => typeof v === 'number' && Math.abs(v - 50000) < 0.5));
      const showRows = hits.length ? hits : allRows.slice(0, 6);
      showRows.forEach((r,i) => {
        console.log(`   [${hits.length?'HIT':'row'} ${i+1}] ${cols.slice(0,14).map(c => {
          let v = r[c];
          if (typeof v === 'string' && v.length > 40) v = v.slice(0,36)+'…';
          if (typeof v === 'string' && /meta|payload/.test(c) && v && v[0] === '{') { try { const o = JSON.parse(r[c]); v = `{keys:${Object.keys(o).slice(0,8).join(',')}}`; } catch(_){} }
          return `${c}=${String(v).replace(/\n/g,' ')||'NULL'}`;
        }).join(' | ')}`);
      });
    } catch (e) { console.log('  err:', e.message); }
  }
})();
