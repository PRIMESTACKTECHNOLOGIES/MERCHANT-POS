const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => { const r = db.exec(sql, p); if (!r.length) return []; return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; }); };
  const one = (sql,p=[]) => q(sql,p)[0];

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ SERVER WALLET VERIFICATION (same DB server loaded: '+DB_PATH+')');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  const MERCHANT_ID = 'MRC-1001';
  const WAL = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  const EURWAL = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='EUR'`, [MERCHANT_ID]);
  console.log(`\n💰 MRC-1001 USD WALLET BALANCE (what dashboard shows) : ${$(WAL?.balance)}`);
  console.log(`   EUR wallet:                                          ${$(EURWAL?.balance)}`);

  // Mirror of walletsService.listMerchantWallets logic
  const allWallets = q(`SELECT * FROM merchant_wallets WHERE merchant_id=? ORDER BY currency`, [MERCHANT_ID]);
  console.log(`\n📋 All merchant wallets (dashboard "balances" response):`);
  allWallets.forEach(w => console.log(`   • ${(w.currency||'?').padEnd(5)}  balance=${$(w.balance).padStart(30)}  id=${w.id?.slice(0,20)||''}…`));

  const PHANTOM = 50_000_000_000;
  const any50B = one(`SELECT COUNT(*) as n FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount - ?) < 0.01`, [WAL?.id, PHANTOM]);
  const anyRev = one(`SELECT COUNT(*) as n FROM merchant_wallet_transactions WHERE wallet_id=? AND type='debit' AND reference='REV-375145' AND ABS(amount - ?) < 0.01`, [WAL?.id, PHANTOM]);
  const netLedger = one(`SELECT COALESCE(SUM(CASE WHEN type='credit' AND status IN ('CAPTURED','SETTLED') THEN amount WHEN type='debit' AND status IN ('CAPTURED','SETTLED','VOIDED') THEN -amount ELSE 0 END),0) as net FROM ledger_entries WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);

  console.log(`\n🧮 Forensic Cross-Check:`);
  console.log(`   • Journal rows: +$50B credit count = ${any50B?.n},  −$50B reversal debit count = ${anyRev?.n}`);
  console.log(`   • Active (CAPTURED/SETTLED) ledger net balance  = ${$(netLedger.net)}`);
  console.log(`   • Denormalized wallet balance                   = ${$(WAL?.balance)}`);
  const diff = Math.abs(Number(WAL?.balance||0) - Number(netLedger.net||0));
  console.log(`   • Delta (wallet ↔ ledger)                       = ${$(diff)}   ${diff < 1.00 ? '✅ ZERO — perfect double-entry alignment' : '❌ MISALIGNED'}`);

  // Last 5 wallet transactions (what dashboard "Recent Ledger" shows)
  const last5 = q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC LIMIT 5`, [WAL?.id]);
  console.log(`\n📰 Last 5 wallet transactions (dashboard Recent Ledger):`);
  last5.forEach((t,i) => {
    const sign = t.type === 'credit' ? '+' : '−';
    console.log(`   ${i+1}. [${t.created_at?.slice(5,16)||''}] ${sign}${$(t.amount).padStart(20)}  ${(t.source||'').padEnd(18)}  ref=${t.reference||''}  ${String(t.description||'').slice(0,55)}`);
  });

  // Batch summary
  const batches = q(`SELECT settlement_code, status, txn_count, total_amount_minor FROM pos2013_batches WHERE merchant_id=? ORDER BY rowid DESC LIMIT 6`, [MERCHANT_ID]);
  console.log(`\n📦 Last 6 batches:`);
  batches.forEach((b,i) => {
    const amt = Number(b.total_amount_minor||0)/100;
    console.log(`   ${i+1}. settlement=${(b.settlement_code||'').padEnd(32)} status=${(b.status||'').padEnd(12)} n=${String(b.txn_count||0).padStart(3)}  total=${$(amt)}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`🏁 FINAL DASHBOARD AMOUNT: ${$(WAL?.balance)}  USD`);
  const showsClean = Number(WAL?.balance||0) < PHANTOM && Number(WAL?.balance||0) > 125_000_000;
  if (showsClean) {
    console.log('✅✅✅ PHANTOM $50,000,000,000 PURGED. Server is clean.');
    console.log('Refresh the dashboard in your browser (Ctrl+F5 / hard reload) → balance is now ' + $(WAL?.balance) + '.');
  } else {
    console.log('⚠️  STILL LARGE — browser hard refresh required. Or if balance still > $50B, check that server process was actually killed.');
    console.log('Old pid check: run  Get-Process -Name node | Select Id, StartTime  and confirm StartTime > 8:13 PM.');
  }
  console.log('═══════════════════════════════════════════════════════════════════════════');
})();
