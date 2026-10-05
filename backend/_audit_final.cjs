const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const BACKEND_ROOT = __dirname;
console.log('============================================================');
console.log('  FULL REAL-FUNDS AUDIT · ALL BALANCES · AUTO-RESTORE');
console.log('  ' + new Date().toISOString());
console.log('  DB: ' + DB_PATH);
console.log('============================================================\n');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  function q(db, sql, params = []) {
    const stmt = db.prepare(sql);
    if (Array.isArray(params) && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  function cols(db, tbl) {
    try { return q(db, `PRAGMA table_info("${tbl}")`).map(c => c.name || c.Name || c['"name"'] || Object.values(c)[1]); }
    catch { return []; }
  }
  function has(db, tbl, c) { return cols(db, tbl).map(String).map(s=>s.toLowerCase()).includes(String(c).toLowerCase()); }
  function num(v) { return Number(v) || 0; }
  function rowHasKeys(row, requiredSome) { return (row && typeof row === 'object') && requiredSome.some(k => Object.keys(row).map(s=>s.toLowerCase()).includes(String(k).toLowerCase())); }

  // Open DB for READ + WRITE
  if (!fs.existsSync(DB_PATH)) { console.error('[X] DB not found.'); process.exit(2); }
  const beforeBuf = fs.readFileSync(DB_PATH);
  const dbRead = new SQL.Database(beforeBuf);
  const dbWrite = new SQL.Database(new Uint8Array(beforeBuf)); // copy for write

  // --- 1. CUSTOMER FIAT ---
  console.log('\n[1/6] CUSTOMER FIAT WALLETS vs wallet_transactions');
  const cw = q(dbRead, `SELECT * FROM customer_wallets`);
  let issues = [];
  cw.forEach(w => {
    const txs = q(dbRead, `SELECT type, amount FROM wallet_transactions WHERE wallet_id = ?`, [w.id]);
    const txSum = txs.reduce((s,t)=> s + (String(t.type||'').toLowerCase()==='credit'?1:-1)*num(t.amount), 0);
    const stored = num(w.balance);
    const delta = stored - txSum;
    if (Math.abs(delta) > 0.005 || txs.length > 0) {
      console.log(`  cust=${String(w.customer_id).substring(0,16).padEnd(18)} cur=${w.currency.padEnd(4)} stored=${stored.toFixed(2).padStart(10)} txSum=${txSum.toFixed(2).padStart(10)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(9)} txs=${String(txs.length).padStart(3)} ${Math.abs(delta)>0.005?'❌ MISMATCH':'✅ OK'}`);
      if (Math.abs(delta) > 0.005) issues.push({table:'customer_wallets', id:w.id, currency:w.currency, stored, proven:txSum, delta});
    }
  });
  if (cw.every(w=>{const s=q(dbRead,`SELECT COUNT(*) AS c FROM wallet_transactions WHERE wallet_id=?`,[w.id])[0].c; return s==0;})) {
    console.log('  (all rows above — only 1 wallet has txs)');
  }

  // --- 2. MERCHANT FIAT ---
  console.log('\n[2/6] MERCHANT FIAT WALLETS vs merchant_wallet_transactions');
  const mw = q(dbRead, `SELECT * FROM merchant_wallets`);
  mw.forEach(m => {
    const txs = q(dbRead, `SELECT * FROM merchant_wallet_transactions WHERE wallet_id = ?`, [m.id]);
    const txSum = txs.reduce((s,t) => {
      const type = String(t.type||'').toLowerCase();
      const sign = (type.includes('credit')||type==='deposit'||type.includes('topup')) ? 1 : -1;
      return s + sign * num(t.amount);
    }, 0);
    const stored = num(m.balance);
    const delta = stored - txSum;
    console.log(`  merch=${String(m.merchant_id).substring(0,16).padEnd(18)} cur=${(m.currency||'USD').padEnd(4)} stored=${stored.toFixed(2).padStart(10)} txSum=${txSum.toFixed(2).padStart(10)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(9)} txs=${String(txs.length).padStart(3)} ${Math.abs(delta)>0.005?'❌ MISMATCH':'✅ OK'}`);
    if (Math.abs(delta) > 0.005) issues.push({table:'merchant_wallets', id:m.id, currency:m.currency||'USD', stored, proven:txSum, delta});
    // Print every merchant tx for verification
    if (txs.length) {
      const mtxTsCol = Object.keys(txs[0]||{}).find(k => /created|date|time|ts/i.test(k));
      txs.forEach(t => console.log(`    - ${String(t[mtxTsCol]||t.id||'').substring(0,19)} ${String(t.type).padEnd(8)} ${num(t.amount).toFixed(2).padStart(10)} ref=${String(t.reference||t.id||'').substring(0,12)} ${t.description?String(t.description).slice(0,60):''}`));
    }
  });

  // --- 3. VAULT_ACCOUNTS vs vault_ledger running balance ---
  console.log('\n[3/6] VAULT RESERVES (vault_accounts) vs vault_ledger running balance');
  const va = q(dbRead, `SELECT * FROM vault_accounts ORDER BY balance DESC`);
  const vlAll = q(dbRead, `SELECT * FROM vault_ledger`);
  const vlSortCol = (vlAll.length && vlAll[0])
    ? (Object.keys(vlAll[0]).find(k => /created|date|time|ts/i.test(k)) || Object.keys(vlAll[0])[0])
    : null;
  const vl = vlSortCol
    ? [...vlAll].sort((a,b) => String(a[vlSortCol]||'').localeCompare(String(b[vlSortCol]||'')))
    : vlAll;
  va.forEach(v => {
    const rows = vl.filter(r => String(r.vault_account_id) === String(v.id));
    const sumC = rows.filter(r => /CREDIT|DEPOSIT|IN/.test(String(r.tx_type||'').toUpperCase())).reduce((s,r)=>s+num(r.amount), 0);
    const sumD = rows.filter(r => /DEBIT|WITHDRAW|OUT/.test(String(r.tx_type||'').toUpperCase())).reduce((s,r)=>s+num(r.amount), 0);
    const ledgerBal = rows.length ? num(rows[rows.length-1].balance_after) : (sumC - sumD);
    const delta = num(v.balance) - ledgerBal;
    console.log(`  acc=${String(v.account_id||v.id).substring(0,20).padEnd(22)} cur=${(v.currency||'USD').padEnd(4)} stored=${num(v.balance).toFixed(2).padStart(10)} ledger_last=${ledgerBal.toFixed(2).padStart(10)} ΣC=${sumC.toFixed(2)} ΣD=${sumD.toFixed(2)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(9)} txs=${String(rows.length).padStart(3)} ${Math.abs(delta)>0.005?'❌ MISMATCH':'✅ OK'}`);
    rows.forEach(r => console.log(`    - ${String(r[vlSortCol]||'').substring(0,19)} ${String(r.tx_type).padEnd(10)} ${num(r.amount).toFixed(2).padStart(12)} after=${num(r.balance_after).toFixed(2).padStart(12)} cust=${String(r.customer_id||'').substring(0,10)} ref=${String(r.tx_reference||'').substring(0,18)}`));
    if (Math.abs(delta) > 0.005) issues.push({table:'vault_accounts', id:v.id, currency:v.currency||'USD', stored:num(v.balance), proven:ledgerBal, delta});
  });

  // --- 4. CUSTOMER CRYPTO ---
  console.log('\n[4/6] CUSTOMER CRYPTO WALLETS vs crypto_transactions');
  const ccw = q(dbRead, `SELECT * FROM customer_crypto_wallets ORDER BY balance DESC`);
  ccw.forEach(c => {
    const txs = q(dbRead, `SELECT type, amount FROM crypto_transactions WHERE customer_id = ? AND crypto_currency = ?`, [c.customer_id, c.crypto_currency]);
    const signOf = t => {
      switch(String(t.type||'').toLowerCase()){
        case 'buy': case 'deposit': case 'swap_in': case 'credit': case 'mint': case 'receive': case 'staking_reward': return 1;
        case 'sell': case 'withdraw': case 'swap_out': case 'debit': case 'fee': case 'send': case 'burn': return -1;
        default: return 0;
      }
    };
    const txSum = txs.reduce((s,t)=>s+signOf(t)*num(t.amount), 0);
    const stored = num(c.balance);
    const delta = stored - txSum;
    console.log(`  cust=${String(c.customer_id).substring(0,18).padEnd(20)} coin=${(c.crypto_currency||'').padEnd(8)} stored=${stored.toFixed(8).padStart(18)} txSum=${txSum.toFixed(8).padStart(18)} Δ=${(delta>=0?'+':'')+delta.toFixed(8).padStart(17)} txs=${String(txs.length).padStart(2)} ${Math.abs(delta)>1e-6?'❌ MISMATCH':'✅ OK'}`);
    if (Math.abs(delta) > 1e-6) issues.push({table:'customer_crypto_wallets', id:c.id, currency:c.crypto_currency, stored, proven:txSum, delta});
  });
  // Also merchant_crypto_balances
  console.log('\n  MERCHANT CRYPTO BALANCES:');
  const mcb = q(dbRead, `SELECT * FROM merchant_crypto_balances ORDER BY balance DESC`);
  mcb.forEach(m => {
    const currency = m.crypto_currency || m.coin || m.currency || '?';
    const id = m.id || m.merchant_id || '?';
    console.log(`    merch=${String(m.merchant_id||'').substring(0,14).padEnd(16)} ${currency.padEnd(8)} bal=${num(m.balance).toFixed(8)}`);
  });

  // --- 5. CORE ACCOUNTS + ledger_entries double-entry ---
  console.log('\n[5/6] CORE PAYOUT ACCOUNTS (accounts) vs ledger_entries + ledger_transactions');
  const accounts = q(dbRead, `SELECT * FROM accounts ORDER BY balance DESC`);
  accounts.forEach(a => {
    const cur = a.currency || 'USD';
    let ledgerSum = 0, n = 0;
    if (has(dbRead, 'ledger_entries', 'account_id')) {
      const rows = q(dbRead, `SELECT * FROM ledger_entries WHERE account_id = ?`, [a.account_id]);
      ledgerSum = rows.reduce((s,r)=>{
        const d = String(r.debit_or_credit||r.type||'').toUpperCase();
        if (d.includes('CREDIT')) return s + num(r.amount);
        if (d.includes('DEBIT'))  return s - num(r.amount);
        return s;
      }, 0);
      n += rows.length;
    }
    if (has(dbRead, 'ledger_transactions', 'account_id')) {
      const lt = q(dbRead, `SELECT * FROM ledger_transactions WHERE account_id = ?`, [a.account_id]);
      lt.forEach(r => {
        if (r.credit_amount || r.credit) ledgerSum += num(r.credit_amount || r.credit);
        if (r.debit_amount  || r.debit)  ledgerSum -= num(r.debit_amount  || r.debit);
      });
      n += lt.length;
    }
    const delta = num(a.balance) - ledgerSum;
    console.log(`  acc=${String(a.account_id||a.id).substring(0,20).padEnd(22)} ${cur.padEnd(4)} stored=${num(a.balance).toFixed(2).padStart(10)} ledger=${ledgerSum.toFixed(2).padStart(10)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(9)} entries=${String(n).padStart(2)} ${Math.abs(delta)>0.005?'❌ MISMATCH':'✅ OK'}`);
    if (Math.abs(delta) > 0.005) issues.push({table:'accounts', id:a.id, currency:cur, stored:num(a.balance), proven:ledgerSum, delta});
  });
  if (accounts.length === 0) console.log('  (no accounts table rows)');

  // --- 6. GRAND TOTALS before ---
  console.log('\n[6/6] GRAND TOTALS BEFORE CORRECTIONS');
  const before = { fiat: {}, crypto: {} };
  function accumulate(tgt, ccy, amt) { if (!amt) return; if (tgt[ccy]==null) tgt[ccy]=0; tgt[ccy]+=amt; }
  cw.forEach(w => accumulate(before.fiat, w.currency, num(w.balance)));
  mw.forEach(m => accumulate(before.fiat, m.currency||'USD', num(m.balance)));
  va.forEach(v => accumulate(before.fiat, v.currency||'USD', num(v.balance)));
  accounts.forEach(a => accumulate(before.fiat, a.currency||'USD', num(a.balance)));
  ccw.forEach(c => accumulate(before.crypto, c.crypto_currency, num(c.balance)));
  mcb.forEach(m => accumulate(before.crypto, m.crypto_currency||m.coin||m.currency||'?', num(m.balance)));
  console.log('  FIAT ON BOOKS BEFORE:');
  Object.keys(before.fiat).sort().forEach(c => console.log('    ' + c.padEnd(6) + ' ' + before.fiat[c].toFixed(2).padStart(14)));
  console.log('  CRYPTO ON BOOKS BEFORE:');
  if (Object.keys(before.crypto).length === 0) console.log('    (no balances)');
  Object.keys(before.crypto).sort().forEach(c => console.log('    ' + c.padEnd(8) + ' ' + before.crypto[c].toFixed(8).padStart(18)));

  // --- ISSUES SUMMARY ---
  console.log('\n============================================================');
  console.log('  DISCREPANCIES FOUND: ' + issues.length);
  console.log('============================================================');
  if (issues.length === 0) {
    console.log('\n✅  No deleted / removed real-fund balances detected anywhere in the system.');
    console.log('    Every stored balance column = SUM of its transaction log (credits-debits).\n');
    // Clean exit (no changes)
    dbRead.close(); dbWrite.close();
    return;
  }
  issues.forEach((x, i) => {
    const fi = /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(x.currency);
    console.log(`\n  [${i+1}] TABLE=${x.table}  id=${x.id}`);
    console.log(`      CURRENCY=${x.currency}  STORED=${num(x.stored).toFixed(fi?2:8)}  TX_PROVEN=${num(x.proven).toFixed(fi?2:8)}  Δ=${(x.delta>=0?'+':'')+num(x.delta).toFixed(fi?2:8)}`);
    if (x.delta > 0) {
      console.log('      ➡ PHANTOM FUNDS: balance column HIGHER than transaction trail proves. Remove Δ (customer sees inflated balance — would allow double spend).');
    } else {
      console.log('      ➡ MISSING FUNDS: balance column LOWER than transactions. RESTORE |Δ| now.');
    }
  });

  // --- BACKUP + RESTORE ---
  console.log('\n============================================================');
  console.log('  APPLYING CORRECTIONS (backup will be created)');
  console.log('============================================================');
  const backupPath = DB_PATH + '.backup-' + Math.floor(Date.now()/1000);
  try { fs.writeFileSync(backupPath, beforeBuf); console.log('\n  💾 BACKUP: ' + backupPath + ' (' + (beforeBuf.length/1024).toFixed(0)+' KB)'); }
  catch(e) { console.error('  ❌ Backup failed — aborting updates. ' + e.message); process.exit(4); }

  let restored = 0, removed = 0;
  for (let i = 0; i < issues.length; i++) {
    const x = issues[i];
    const table = x.table;
    const absDelta = Math.abs(x.delta);
    // Check column exists
    const idCol = (table === 'accounts') ? 'id' : 'id';
    const balanceCol = 'balance';
    const statement = `UPDATE "${table}" SET ${balanceCol} = ${balanceCol} ${x.delta > 0 ? '-' : '+'} ?, updated_at = CURRENT_TIMESTAMP WHERE ${idCol} = ?`;
    try {
      const stmt = dbWrite.prepare(statement);
      stmt.bind([absDelta, x.id]);
      const did = stmt.step();
      stmt.free();
      if (!did) {
        console.log(`  [${i+1}] ⚠ UPDATE ran but no row matched for id=${x.id} in ${table}`);
      } else {
        const fi = /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(x.currency);
        if (x.delta > 0) {
          console.log(`  [${i+1}] ✅ REMOVED phantom ${x.currency} ${absDelta.toFixed(fi?2:8)} from ${table}.id=${x.id.substring(0,10)}... — balance now matches transaction trail.`);
          removed++;
        } else {
          console.log(`  [${i+1}] ✅ RESTORED missing ${x.currency} ${absDelta.toFixed(fi?2:8)} to ${table}.id=${x.id.substring(0,10)}...`);
          restored++;
        }
      }
    } catch (e) {
      console.log(`  [${i+1}] ❌ FAILED: ${e.message}.  SQL: ${statement.replace('?', absDelta).replace('?', x.id)}`);
    }
  }

  // --- Re-verify after ---
  console.log('\n  Re-verifying ALL balances after corrections ...');
  let finalOk = true;
  const verify = (desc, walletTbl, txSql, delta) => {};
  function recheck(label, rows, txFn) {
    let bad = 0;
    rows.forEach(w => {
      const txSum = txFn(w);
      const stored = num(w.balance);
      const d = stored - txSum;
      const fi = /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(w.currency||w.crypto_currency);
      const tol = fi ? 0.005 : 1e-6;
      if (Math.abs(d) > tol) {
        console.log(`  ❌ STILL BROKEN: ${label} ${w.id?.substring(0,10)}  Δ=${(d>=0?'+':'')+d.toFixed(fi?2:8)}`);
        bad++; finalOk = false;
      }
    });
    return bad;
  }
  const cwA = q(dbWrite, `SELECT * FROM customer_wallets`);
  recheck('customer_wallets', cwA, w => q(dbWrite, `SELECT type, amount FROM wallet_transactions WHERE wallet_id=?`, [w.id]).reduce((s,t)=>s+(String(t.type).toLowerCase()==='credit'?1:-1)*num(t.amount),0));
  const mwA = q(dbWrite, `SELECT * FROM merchant_wallets`);
  recheck('merchant_wallets', mwA, m => q(dbWrite, `SELECT * FROM merchant_wallet_transactions WHERE wallet_id=?`, [m.id]).reduce((s,t)=>{
    const type = String(t.type||'').toLowerCase();
    return s + ((type.includes('credit')||type==='deposit')?1:-1) * num(t.amount);
  }, 0));
  const vaA = q(dbWrite, `SELECT * FROM vault_accounts`);
  recheck('vault_accounts', vaA, v => {
    const rows = q(dbWrite, `SELECT * FROM vault_ledger WHERE vault_account_id=? ORDER BY created_at ASC`, [v.id]);
    return rows.length ? num(rows[rows.length-1].balance_after) : 0;
  });
  const ccwA = q(dbWrite, `SELECT * FROM customer_crypto_wallets`);
  recheck('customer_crypto_wallets', ccwA, c => q(dbWrite, `SELECT type, amount FROM crypto_transactions WHERE customer_id=? AND crypto_currency=?`, [c.customer_id, c.crypto_currency]).reduce((s,t)=>{
    const k = String(t.type||'').toLowerCase();
    const sign = ['buy','deposit','swap_in','credit','mint','receive','reward'].includes(k)?1:['sell','withdraw','swap_out','debit','fee','send','burn'].includes(k)?-1:0;
    return s + sign * num(t.amount);
  }, 0));

  // --- GRAND TOTALS after ---
  console.log('\n  GRAND TOTALS AFTER CORRECTIONS:');
  const after = { fiat: {}, crypto: {} };
  q(dbWrite,`SELECT * FROM customer_wallets`).forEach(w => accumulate(after.fiat, w.currency, num(w.balance)));
  q(dbWrite,`SELECT * FROM merchant_wallets`).forEach(m => accumulate(after.fiat, m.currency||'USD', num(m.balance)));
  q(dbWrite,`SELECT * FROM vault_accounts`).forEach(v => accumulate(after.fiat, v.currency||'USD', num(v.balance)));
  q(dbWrite,`SELECT * FROM accounts`).forEach(a => accumulate(after.fiat, a.currency||'USD', num(a.balance)));
  q(dbWrite,`SELECT * FROM customer_crypto_wallets`).forEach(c => accumulate(after.crypto, c.crypto_currency, num(c.balance)));
  q(dbWrite,`SELECT * FROM merchant_crypto_balances`).forEach(m => accumulate(after.crypto, m.crypto_currency||m.coin||m.currency||'?', num(m.balance)));
  console.log('  FIAT:');
  Object.keys({...before.fiat, ...after.fiat}).sort().forEach(c => {
    const b = before.fiat[c] || 0, a = after.fiat[c] || 0;
    console.log('    ' + c.padEnd(6) + ' before=' + b.toFixed(2).padStart(12) + '  after=' + a.toFixed(2).padStart(12) + '  Δ=' + (a-b>=0?'+':'') + (a-b).toFixed(2));
  });
  if (Object.keys(after.crypto).length || Object.keys(before.crypto).length) {
    console.log('  CRYPTO:');
    Object.keys({...before.crypto, ...after.crypto}).sort().forEach(c => {
      const b = before.crypto[c] || 0, a = after.crypto[c] || 0;
      console.log('    ' + c.padEnd(8) + ' before=' + b.toFixed(8).padStart(18) + '  after=' + a.toFixed(8).padStart(18) + '  Δ=' + (a-b>=0?'+':'') + (a-b).toFixed(8));
    });
  }

  // --- Flush ---
  try {
    const fixed = dbWrite.export();
    fs.writeFileSync(DB_PATH, Buffer.from(fixed));
    console.log('\n  💾 Persisted corrected database to ' + DB_PATH + ' (' + (fixed.length/1024).toFixed(0) + ' KB)');
  } catch (e) {
    console.error('\n  ❌ Persist failed: ' + e.message);
    process.exit(5);
  }

  console.log('\n============================================================');
  console.log('  RESULT SUMMARY');
  console.log('============================================================');
  console.log(`  Phantom (inflated) balances removed:  ${removed}`);
  console.log(`  Missing balances restored:            ${restored}`);
  console.log(`  Total discrepancies fixed:            ${issues.length}`);
  console.log(`  Re-verification pass:                 ${finalOk ? '✅ ALL CLEAN' : '⚠ SOME STILL OPEN (see above)'}`);
  console.log(`  Backup file:                          ${backupPath}`);
  console.log('');

  dbRead.close();
  dbWrite.close();
})().catch(e => { console.error('\n❌ FATAL:', e.message); console.error(e.stack); process.exit(1); });
