const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const PHANTOM = 50_000_000_000;
const MERCHANT_ID = 'MRC-1001';

const candidates = [
  path.join(__dirname, 'data', 'database.sqlite'),
  path.join(__dirname, 'pos_offline.db'),
  path.join(__dirname, '..', 'database.sqlite'),
  path.join(__dirname, '..', 'OFFLINE-WALLET-POS-201.3', 'database.sqlite'),
];

const q = (db, sql, p=[]) => { try { const r = db.exec(sql, p); if (!r.length) return []; return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; }); } catch(e){ return []; } };
const one = (db, sql, p=[]) => q(db,sql,p)[0];

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🔎 SCANNING ALL 4 SQLITE FILES FOR $50B PHANTOM + USD WALLET BALANCE');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  for (const dbp of candidates) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const exists = fs.existsSync(dbp);
    const stat = exists ? fs.statSync(dbp) : null;
    const sizeKB = Math.round((stat?.size||0)/1024);
    console.log(`📁 FILE: ${dbp}`);
    console.log(`   EXISTS: ${exists ? 'YES ('+sizeKB+' KB, mtime='+stat.mtime.toISOString()+')' : 'NO'}`);
    if (!exists) continue;
    try {
      const db = new SQL.Database(fs.readFileSync(dbp));

      // Wallet balance
      const wal = one(db, `SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
      const allWal = q(db, `SELECT * FROM merchant_wallets WHERE merchant_id=?`, [MERCHANT_ID]);
      console.log(`   💰 USD wallet: ${wal ? $(wal.balance) : 'N/A'}  (wallet_id=${wal?.id||'—'})`);
      if (allWal.length) {
        allWal.forEach(w => console.log(`      → ${w.currency.padEnd(5)} balance=${$(w.balance).padStart(30)}  id=${w.id?.slice(0,18)||''}…`));
      }

      // pos2013_transactions STAN=000012
      const tx = one(db, `SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=? ORDER BY rowid DESC LIMIT 1`, ['000012', MERCHANT_ID]);
      const amtMajor = tx ? (Number(tx.amount_minor||0)/100) : 0;
      console.log(`   🧾 STAN=000012: ${tx ? 'FOUND id='+tx.id.slice(0,20)+'…  status='+tx.status+'  amount='+$(amtMajor)+' '+tx.currency : 'NOT FOUND'}`);

      // pos2013_batches settlement ~ 375145
      const bat = one(db, `SELECT * FROM pos2013_batches WHERE merchant_id=? AND (settlement_code = ? OR settlement_code LIKE ('%' || ? || '%')) ORDER BY rowid DESC LIMIT 1`, [MERCHANT_ID, '375145', '375145']);
      const batMajor = bat ? (Number(bat.total_amount_minor||0)/100) : 0;
      console.log(`   📦 batch~375145: ${bat ? 'FOUND code='+bat.settlement_code+' status='+bat.status+' total='+$(batMajor) : 'NOT FOUND'}`);

      // Ledger $50B credit (non-VOIDED) count
      const lc = one(db, `SELECT COUNT(*) as n, SUM(amount) as sum FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 AND status != 'VOIDED'`, [MERCHANT_ID, PHANTOM]);
      console.log(`   📒 Ledger $50B ACTIVE credit: count=${lc?.n||0}  sum=${$(lc?.sum||0)}  (should be 0 / $0 after reversal)`);

      // All ledger $50B credit (INCLUDING VOIDED) — reference only
      const lcAll = one(db, `SELECT COUNT(*) as n, SUM(amount) as sum FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01`, [MERCHANT_ID, PHANTOM]);
      console.log(`   📒 Ledger $50B ALL credit (incl VOIDED): count=${lcAll?.n||0}  sum=${$(lcAll?.sum||0)}`);

      // Journal $50B reversal DEBIT
      const jr = one(db, `SELECT id, type, amount, source, reference, created_at FROM merchant_wallet_transactions WHERE wallet_id=? AND type='debit' AND ABS(amount - ?) < 0.01 ORDER BY rowid DESC LIMIT 1`, [wal?.id||-1, PHANTOM]);
      console.log(`   📓 Journal reversal DEBIT: ${jr ? 'FOUND  id='+jr.id.slice(0,18)+'…  −'+$(jr.amount)+' src='+jr.source+' ref='+jr.reference : 'NOT FOUND'}`);

      // Journal ORIGINAL $50B CREDIT
      const jo = one(db, `SELECT id, type, amount, source, reference, description FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount - ?) < 0.01 ORDER BY rowid DESC LIMIT 1`, [wal?.id||-1, PHANTOM]);
      const isMarkedReversed = jo && String(jo.description||'').includes('REVERSED');
      console.log(`   📓 Journal original CREDIT : ${jo ? 'FOUND  +'+$(jo.amount)+' marked_REVERSED='+(isMarkedReversed?'YES ✅':'NO ❌') : 'NOT FOUND'}`);

      // Flags
      const bal = Number(wal?.balance||0);
      if (bal > PHANTOM + 200_000_000) {
        console.log(`   🚨🚨🚨 LIVE $50B PHANTOM DETECTED IN THIS FILE — balance=$(bal). THIS IS THE DB YOUR DASHBOARD READS.`);
      } else if (bal > 128_000_000 && bal < 129_000_000) {
        console.log(`   ✅ THIS DB IS CLEAN (balance ~$128.7M matches expected real funds).`);
      } else {
        console.log(`   ℹ️  Balance=$(bal). Not the contaminated or cleaned target.`);
      }
    } catch (e) {
      console.log(`   ❌ ERROR OPENING: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('💡 SUMMARY HOW TO FIX:');
  console.log('   1. Identify which DB shows 🚨 LIVE $50B (balance > 50B). This is the LIVE DB.');
  console.log('   2. Check .env DATABASE_PATH — it may point to a DIFFERENT file than backend/data/database.sqlite.');
  console.log('   3. Run reversal against THAT file specifically (rebuild _reverse_50b_FINAL.cjs with new DB_PATH).');
  console.log('   4. Restart dashboard server so it reloads from new SQLite file (NOT from sql.js in-memory stale copy).');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // Print .env DATABASE_PATH if found
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const m = env.match(/DATABASE_PATH\s*=\s*(.+)/);
    console.log('\n📄 .env DATABASE_PATH =', m ? m[1].trim() : '(not set)');
  } else {
    console.log('\n📄 No .env file in backend/ — using db.ts default (backend/data/database.sqlite)');
    if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
      const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      const m = env.match(/DATABASE_PATH\s*=\s*(.+)/);
      console.log('📄 ROOT .env DATABASE_PATH =', m ? m[1].trim() : '(not set)');
    }
  }
})();
