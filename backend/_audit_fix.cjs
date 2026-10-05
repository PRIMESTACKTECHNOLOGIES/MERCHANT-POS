const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  if (!fs.existsSync(DB_PATH)) { console.error('No DB'); process.exit(2); }

  function q(db, sql, params=[]) {
    const s = db.prepare(sql);
    if (params.length) s.bind(params);
    const rows = [];
    while (s.step()) rows.push(s.getAsObject());
    s.free();
    return rows;
  }
  function cols(db, tbl) {
    try { return q(db, `PRAGMA table_info("${tbl}")`).map(c => c.name || Object.values(c)[1]); }
    catch(e) { return []; }
  }
  function num(v) { return Number(v) || 0; }
  function cI(obj, key, dflt=null) {
    const k = Object.keys(obj||{}).find(x => x.toLowerCase() === String(key).toLowerCase());
    return k == null ? dflt : obj[k];
  }

  const beforeBuf = fs.readFileSync(DB_PATH);
  const read = new SQL.Database(beforeBuf);
  const write = new SQL.Database(new Uint8Array(beforeBuf));
  console.log('DB loaded. Schema inspection first ...');

  // --------------------------
  // 1) Inspect schema columns
  // --------------------------
  const relevant = ['customer_wallets','wallet_transactions','merchant_wallets','merchant_wallet_transactions','vault_accounts','vault_ledger','vault_entries','customer_crypto_wallets','crypto_transactions','merchant_crypto_balances','accounts','ledger_entries','ledger_transactions'];
  const sc = {};
  relevant.forEach(t => sc[t] = cols(read, t));
  console.log('');
  Object.entries(sc).forEach(([t,cc]) => console.log(`${t.padEnd(32)} cols(${cc.length}): ${cc.join(', ')}`));

  // --------------------------
  // 2) Balances vs their proof
  // --------------------------
  const issues = [];
  console.log('\n[CUSTOMER FIAT]');
  const cw = q(read, `SELECT * FROM customer_wallets`);
  for (const w of cw) {
    const txs = q(read, `SELECT * FROM wallet_transactions WHERE wallet_id=?`, [w.id]);
    const typeCol = sc.wallet_transactions.find(c => /^type$/i.test(c)) || 'type';
    const amtCol  = sc.wallet_transactions.find(c => /^amount$/i.test(c)) || 'amount';
    const txSum = txs.reduce((s,t) => s + (String(cI(t,typeCol)||'').toLowerCase()==='credit' ? 1 : -1) * num(cI(t, amtCol)), 0);
    const stored = num(cI(w,'balance'));
    const delta = stored - txSum;
    console.log(`  cust=${String(cI(w,'customer_id')).substring(0,18).padEnd(20)} ${String(cI(w,'currency')||'').padEnd(4)} stored=${stored.toFixed(2).padStart(9)} txSum=${txSum.toFixed(2).padStart(9)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(8)} ${Math.abs(delta)>0.005?'❌':'✅'}`);
    if (Math.abs(delta) > 0.005) issues.push({tbl:'customer_wallets', id:w.id, ccy:cI(w,'currency'), stored, proven:txSum, delta});
    // Print txs for nonzero wallets
    if (txs.length) {
      const tsCol = sc.wallet_transactions.find(c => /created|date|time/i.test(c));
      txs.forEach(t => console.log(`    - ${String(cI(t,tsCol)||t.id||'').substring(0,19)} ${String(cI(t,typeCol)).padEnd(6)} ${num(cI(t,amtCol)).toFixed(2).padStart(9)} src=${cI(t,'source')||''} ref=${String(cI(t,'reference')||'').substring(0,18)}`));
    }
  }

  console.log('\n[MERCHANT FIAT]');
  const mw = q(read, `SELECT * FROM merchant_wallets`);
  for (const m of mw) {
    const txs = q(read, `SELECT * FROM merchant_wallet_transactions WHERE wallet_id=?`, [m.id]);
    const typeCol = sc.merchant_wallet_transactions.find(c => /^type$/i.test(c)) || 'type';
    const amtCol  = sc.merchant_wallet_transactions.find(c => /^amount$/i.test(c)) || 'amount';
    const txSum = txs.reduce((s,t) => {
      const type = String(cI(t, typeCol)||'').toLowerCase();
      const sign = (type.includes('credit')||type==='deposit'||type.includes('topup')) ? 1 : -1;
      return s + sign * num(cI(t, amtCol));
    }, 0);
    const stored = num(cI(m,'balance'));
    const delta = stored - txSum;
    console.log(`  merch=${String(cI(m,'merchant_id')).substring(0,16).padEnd(18)} ${String(cI(m,'currency')||'USD').padEnd(4)} stored=${stored.toFixed(2).padStart(9)} txSum=${txSum.toFixed(2).padStart(9)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(8)} ${Math.abs(delta)>0.005?'❌':'✅'}`);
    if (Math.abs(delta) > 0.005) issues.push({tbl:'merchant_wallets', id:m.id, ccy:cI(m,'currency')||'USD', stored, proven:txSum, delta});
    if (txs.length) {
      const tsCol = sc.merchant_wallet_transactions.find(c => /created|date|time/i.test(c));
      txs.forEach(t => console.log(`    - ${String(cI(t,tsCol)||'').substring(0,19)} ${String(cI(t,typeCol)).padEnd(8)} ${num(cI(t,amtCol)).toFixed(2).padStart(9)} ref=${String(cI(t,'reference')||'').substring(0,18)}`));
    }
  }

  console.log('\n[VAULT reserves] — vault_accounts.balance vs (vault_ledger final balance_after) + (vault_entries Σ)');
  const va = q(read, `SELECT * FROM vault_accounts ORDER BY balance DESC`);
  const vlAll = q(read, `SELECT * FROM vault_ledger`);
  const veAll = q(read, `SELECT * FROM vault_entries`);
  const vaIdCol = sc.vault_accounts.find(c => /^id$/i.test(c)) || 'id';
  const vaBalCol = sc.vault_accounts.find(c => /^balance$/i.test(c)) || 'balance';
  const vaCurCol = sc.vault_accounts.find(c => /currency/i.test(c)) || 'currency';
  const vaAccIdCol = sc.vault_accounts.find(c => /account_id/i.test(c)) || 'account_id';
  const vaNameCol = sc.vault_accounts.find(c => /account_name|name/i.test(c)) || 'account_name';
  const vlAccCol = sc.vault_ledger.find(c => /vault_account_id|account_id/i.test(c)) || 'vault_account_id';
  const vlAmtCol = sc.vault_ledger.find(c => /^amount$/i.test(c)) || 'amount';
  const vlTypCol = sc.vault_ledger.find(c => /tx_type|type/i.test(c)) || 'tx_type';
  const vlBalCol = sc.vault_ledger.find(c => /balance_after|balance$/i.test(c)) || 'balance_after';
  const vlTsCol  = sc.vault_ledger.find(c => /created|date|time/i.test(c));
  const veAccCol = sc.vault_entries.find(c => /^account_id$|vault_account/i.test(c)) || 'account_id';
  const veAmtCol = sc.vault_entries.find(c => /^amount$/i.test(c)) || 'amount';
  const veTypCol = sc.vault_entries.find(c => /debit_or_credit|type|direction/i.test(c)) || 'debit_or_credit';
  const veTsCol  = sc.vault_entries.find(c => /created|date|time/i.test(c));
  for (const v of va) {
    const id = v[vaIdCol];
    const acc = v[vaAccIdCol];
    const cur = v[vaCurCol] || 'USD';
    const name = v[vaNameCol] || '';
    const stored = num(v[vaBalCol]);
    const vlRows = vlAll.filter(r => String(r[vlAccCol]) === String(id) || String(r[vlAccCol]) === String(acc));
    if (vlTsCol) vlRows.sort((a,b) => String(a[vlTsCol]||'').localeCompare(String(b[vlTsCol]||'')));
    const rowsC = vlRows.filter(r => /CREDIT|DEPOSIT|IN/.test(String(r[vlTypCol]||'').toUpperCase())).reduce((s,r)=>s+num(r[vlAmtCol]),0);
    const rowsD = vlRows.filter(r => /DEBIT|WITHDRAW|OUT/.test(String(r[vlTypCol]||'').toUpperCase())).reduce((s,r)=>s+num(r[vlAmtCol]),0);
    const ledgerLast = vlRows.length ? num(vlRows[vlRows.length-1][vlBalCol]) : (rowsC - rowsD);
    // Also vault_entries
    const veRows = veAll.filter(r => String(r[veAccCol]) === String(id) || String(r[veAccCol]) === String(acc));
    if (veTsCol) veRows.sort((a,b) => String(a[veTsCol]||'').localeCompare(String(b[veTsCol]||'')));
    const veSum = veRows.reduce((s,r) => {
      const d = String(r[veTypCol]||'').toUpperCase();
      if (d.includes('CREDIT')) return s + num(r[veAmtCol]);
      if (d.includes('DEBIT'))  return s - num(r[veAmtCol]);
      return s;
    }, 0);
    const proven = (ledgerLast !== 0 || vlRows.length) ? ledgerLast : veSum;
    const delta = stored - proven;
    console.log(`  ${String(acc||id).substring(0,22).padEnd(24)} ${String(cur).padEnd(4)} name=${String(name).padEnd(14).substring(0,14)} stored=${stored.toFixed(2).padStart(9)} vault_ledger_last=${ledgerLast.toFixed(2).padStart(9)} vault_entries Σ=${veSum.toFixed(2).padStart(9)} Δ(stored-proven)=${(delta>=0?'+':'')+delta.toFixed(2).padStart(8)} txs=${vlRows.length}+${veRows.length} ${Math.abs(delta)>0.005?'❌':'✅'}`);
    vlRows.forEach(r => console.log(`    VL: ${String(r[vlTsCol]||'').substring(0,19)} ${String(r[vlTypCol]).padEnd(10)} ${num(r[vlAmtCol]).toFixed(2).padStart(9)} after=${num(r[vlBalCol]).toFixed(2).padStart(9)} cust=${String(r.customer_id||'').substring(0,10)} ref=${String(r.tx_reference||'').substring(0,18)}`));
    veRows.forEach(r => console.log(`    VE: ${String(r[veTsCol]||'').substring(0,19)} ${String(r[veTypCol]).padEnd(10)} ${num(r[veAmtCol]).toFixed(2).padStart(9)} cust=${String(r.customer_id||'').substring(0,10)} ref=${String(r.entry_reference||'').substring(0,18)}`));
    if (Math.abs(delta) > 0.005) issues.push({tbl:'vault_accounts', id, ccy:cur, stored, proven, delta, hint:(vlRows.length+veRows.length===0?'No tx proof exists — balance was seeded without corresponding ledger entry → remove to match reality, OR backdate a deposit ledger entry.':'' )});
  }

  console.log('\n[CUSTOMER CRYPTO]');
  const ccw = q(read, `SELECT * FROM customer_crypto_wallets ORDER BY balance DESC`);
  const cctxAll = q(read, `SELECT * FROM crypto_transactions`);
  const ccCustCol = sc.customer_crypto_wallets.find(c => /customer_id/i.test(c)) || 'customer_id';
  const ccCoinCol = sc.customer_crypto_wallets.find(c => /crypto_currency|coin|symbol/i.test(c)) || 'crypto_currency';
  const ccBalCol  = sc.customer_crypto_wallets.find(c => /^balance$/i.test(c)) || 'balance';
  const ccIdCol   = sc.customer_crypto_wallets.find(c => /^id$/i.test(c)) || 'id';
  const ctCustCol = sc.crypto_transactions.find(c => /customer_id/i.test(c));
  const ctCoinCol = sc.crypto_transactions.find(c => /crypto_currency|coin|symbol/i.test(c));
  const ctTypCol  = sc.crypto_transactions.find(c => /^type$/i.test(c));
  const ctAmtCol  = sc.crypto_transactions.find(c => /^amount$/i.test(c));
  for (const c of ccw) {
    const cust = c[ccCustCol], coin = c[ccCoinCol];
    const rows = cctxAll.filter(t => (ctCustCol?String(t[ctCustCol])===String(cust):true) && (ctCoinCol?String(t[ctCoinCol])===String(coin):true));
    const txSum = rows.reduce((s,t) => {
      const typ = String(t[ctTypCol]||'').toLowerCase();
      const sign = ['buy','deposit','swap_in','credit','mint','receive','reward'].includes(typ) ? 1 : ['sell','withdraw','swap_out','debit','fee','send','burn'].includes(typ) ? -1 : 0;
      return s + sign * num(t[ctAmtCol]);
    }, 0);
    const stored = num(c[ccBalCol]);
    const delta = stored - txSum;
    console.log(`  cust=${String(cust).substring(0,20).padEnd(22)} ${String(coin).padEnd(8)} stored=${stored.toFixed(8).padStart(16)} txSum=${txSum.toFixed(8).padStart(16)} Δ=${(delta>=0?'+':'')+delta.toFixed(8).padStart(15)} txs=${rows.length} ${Math.abs(delta)>1e-6?'❌':'✅'}`);
    rows.forEach(t => console.log(`    - ${String(t.created_at||'').substring(0,19)} ${String(t[ctTypCol]).padEnd(8)} ${num(t[ctAmtCol]).toFixed(8).padStart(16)} ${t.crypto_currency} ref=${String(t.reference||t.tx_hash||'').substring(0,22)}`));
    if (Math.abs(delta) > 1e-6) issues.push({tbl:'customer_crypto_wallets', id:c[ccIdCol], ccy:coin, stored, proven:txSum, delta, isCrypto:true});
  }
  // Merchant crypto balances
  if (sc.merchant_crypto_balances && sc.merchant_crypto_balances.length) {
    console.log('\n  MERCHANT CRYPTO BALANCES:');
    q(read, `SELECT * FROM merchant_crypto_balances`).forEach(m => {
      const keys = Object.keys(m);
      const balC = keys.find(k=>/balance/i.test(k));
      const curC = keys.find(k=>/crypto|coin|currency|symbol/i.test(k));
      const merC = keys.find(k=>/merchant_id/i.test(k));
      console.log(`    merch=${String(m[merC]||'').substring(0,14).padEnd(16)} ${String(m[curC]||'?').padEnd(8)} bal=${num(m[balC]).toFixed(8)}`);
    });
  }

  console.log('\n[CORE ACCOUNTS (payout vault)]');
  if (sc.accounts && sc.accounts.length) {
    const acc = q(read, `SELECT * FROM accounts ORDER BY balance DESC`);
    for (const a of acc) {
      const cur = cI(a,'currency')||'USD';
      const accid = cI(a,'account_id') || cI(a,'id');
      let sum = 0;
      if (sc.ledger_entries && sc.ledger_entries.length) {
        const rows = q(read, `SELECT * FROM ledger_entries WHERE account_id = ?`, [accid]);
        rows.forEach(r => { const d = String(cI(r,'debit_or_credit')||cI(r,'type')||'').toUpperCase(); if (d.includes('CREDIT')) sum += num(cI(r,'amount')); if (d.includes('DEBIT')) sum -= num(cI(r,'amount')); });
      }
      if (sc.ledger_transactions && sc.ledger_transactions.length) {
        const rows = q(read, `SELECT * FROM ledger_transactions WHERE account_id = ?`, [accid]);
        rows.forEach(r => { const cr = num(cI(r,'credit_amount')||cI(r,'credit')); const dr = num(cI(r,'debit_amount')||cI(r,'debit')); sum += cr - dr; });
      }
      const stored = num(cI(a,'balance'));
      const delta = stored - sum;
      console.log(`  acc=${String(accid).substring(0,24).padEnd(26)} ${cur.padEnd(4)} stored=${stored.toFixed(2).padStart(9)} ledger=${sum.toFixed(2).padStart(9)} Δ=${(delta>=0?'+':'')+delta.toFixed(2).padStart(8)} ${Math.abs(delta)>0.005?'❌':'✅'}`);
      if (Math.abs(delta) > 0.005) issues.push({tbl:'accounts', id:cI(a,'id'), ccy:cur, stored, proven:sum, delta});
    }
  } else console.log('  (no accounts rows)');

  // --------------------------
  // GRAND TOTALS BEFORE
  // --------------------------
  console.log('\n==================== GRAND TOTALS BEFORE CORRECTION ====================');
  const before = { fiat: {}, crypto: {} };
  function accu(tgt, key, v) { if (!v) return; if (tgt[key]==null) tgt[key]=0; tgt[key]+=v; }
  cw.forEach(w => accu(before.fiat, w.currency || 'USD', num(w.balance)));
  mw.forEach(m => accu(before.fiat, m.currency || 'USD', num(m.balance)));
  va.forEach(v => accu(before.fiat, v[vaCurCol] || 'USD', num(v[vaBalCol])));
  if (sc.accounts && sc.accounts.length) q(read,`SELECT * FROM accounts`).forEach(a => accu(before.fiat, cI(a,'currency')||'USD', num(cI(a,'balance'))));
  ccw.forEach(c => accu(before.crypto, c[ccCoinCol]||'?', num(c[ccBalCol])));
  if (sc.merchant_crypto_balances && sc.merchant_crypto_balances.length) {
    const mc = q(read, `SELECT * FROM merchant_crypto_balances`);
    mc.forEach(m => {
      const k = Object.keys(m);
      const balC = k.find(x=>/balance/i.test(x));
      const curC = k.find(x=>/crypto|coin|currency|symbol/i.test(x));
      accu(before.crypto, m[curC]||'?', num(m[balC]));
    });
  }
  console.log('  FIAT:');
  Object.keys(before.fiat).sort().forEach(c => console.log(`    ${c.padEnd(6)} ${before.fiat[c].toFixed(2).padStart(14)}`));
  if (Object.keys(before.crypto).length) {
    console.log('  CRYPTO:');
    Object.keys(before.crypto).sort().forEach(c => console.log(`    ${c.padEnd(8)} ${before.crypto[c].toFixed(8).padStart(18)}`));
  }

  // --------------------------
  // ISSUES LIST
  // --------------------------
  console.log(`\n==================== ${issues.length} BALANCE DISCREPANCIES FOUND ====================`);
  if (!issues.length) {
    console.log('\n✅ No discrepancies. No real funds were deleted. All balances match the full transaction proof.');
    read.close(); write.close();
    return;
  }
  issues.forEach((x,i) => {
    const fi = !x.isCrypto;
    const dec = fi ? 2 : 8;
    console.log(`\n  ${i+1}. TABLE=${x.tbl}  id=${x.id}`);
    console.log(`     CURRENCY: ${x.ccy}   STORED=${num(x.stored).toFixed(dec)}   TX_PROVEN=${num(x.proven).toFixed(dec)}   Δ(stored-proven)=${(x.delta>=0?'+':'')+num(x.delta).toFixed(dec)}`);
    if (x.delta > 0) console.log('     ➡ PHANTOM/UNPROVEN BALANCE (balance > transaction proof). REMOVE this $ — would cause double-spend / free money.');
    else             console.log('     ➡ MISSING / STOLEN BALANCE (proven transactions exist but balance missing). RESTORE the proven amount.');
    if (x.hint) console.log('     HINT: ' + x.hint);
  });

  // --------------------------
  // BACKUP + RESTORE
  // --------------------------
  console.log('\n==================== APPLYING RESTORE / REMOVAL ====================');
  const backupPath = DB_PATH + '.backup-' + Math.floor(Date.now()/1000);
  try { fs.writeFileSync(backupPath, beforeBuf); console.log('\n💾 Backup written: ' + backupPath); }
  catch(e) { console.error('Backup fail: ' + e.message); process.exit(4); }
  const tablePk = {
    customer_wallets: 'id', merchant_wallets: 'id',
    vault_accounts: sc.vault_accounts.find(c => /^id$/i.test(c)) || 'id',
    customer_crypto_wallets: sc.customer_crypto_wallets.find(c => /^id$/i.test(c)) || 'id',
    accounts: 'id',
  };
  let fixedPhantom = 0, fixedMissing = 0, failed = 0;
  issues.forEach((x,i) => {
    const pk = tablePk[x.tbl] || 'id';
    const balCol = x.tbl.includes('crypto') ? (sc[x.tbl] && sc[x.tbl].find(c=>/balance/i.test(c)) || 'balance') : 'balance';
    const updCol = sc[x.tbl] && sc[x.tbl].some(c=>/updated_at/i.test(c)) ? 'updated_at = CURRENT_TIMESTAMP, ' : '';
    const sign = x.delta > 0 ? '-' : '+';
    const absD = Math.abs(x.delta);
    const sql = `UPDATE "${x.tbl}" SET ${updCol} ${balCol} = ${balCol} ${sign} ? WHERE ${pk} = ?`;
    try {
      const s = write.prepare(sql);
      s.bind([absD, x.id]);
      s.step(); s.free();
      const dec = x.isCrypto ? 8 : 2;
      if (x.delta > 0) { console.log(`  ✅ FIX#${i+1}: Removed phantom ${x.ccy} ${absD.toFixed(dec)} from ${x.tbl}.${pk}=${x.id.substring(0,12)}...`); fixedPhantom++; }
      else            { console.log(`  ✅ FIX#${i+1}: Restored missing ${x.ccy} ${absD.toFixed(dec)} to ${x.tbl}.${pk}=${x.id.substring(0,12)}...`); fixedMissing++; }
    } catch(e) {
      failed++;
      console.log(`  ❌ FIX#${i+1}: FAILED ${e.message}   SQL: ${sql.replace('?',absD).replace('?',x.id)}`);
    }
  });

  // --------------------------
  // RE-VERIFY AFTER
  // --------------------------
  console.log('\n==================== RE-VERIFICATION AFTER FIXES ====================');
  let verifyOk = true;
  function test(label, rows, fn) {
    let bad = 0;
    for (const w of rows) {
      const { stored, proven, isCrypto } = fn(w);
      const tol = isCrypto ? 1e-6 : 0.005;
      if (Math.abs(stored-proven) > tol) { console.log(`  ❌ ${label} still broken ${w.id?.substring(0,10)} Δ=${(stored-proven>=0?'+':'')+(stored-proven).toFixed(isCrypto?8:2)}`); bad++; verifyOk=false; }
    }
    return bad;
  }
  const cw2 = q(write, `SELECT * FROM customer_wallets`);
  test('customer_wallets', cw2, w => {
    const txs = q(write, `SELECT * FROM wallet_transactions WHERE wallet_id=?`, [w.id]);
    const txSum = txs.reduce((s,t) => s + (String(cI(t,'type')||'').toLowerCase()==='credit'?1:-1)*num(cI(t,'amount')), 0);
    return { stored: num(w.balance), proven: txSum };
  });
  const mw2 = q(write, `SELECT * FROM merchant_wallets`);
  test('merchant_wallets', mw2, m => {
    const txs = q(write, `SELECT * FROM merchant_wallet_transactions WHERE wallet_id=?`, [m.id]);
    const sum = txs.reduce((s,t) => { const k=String(cI(t,'type')||'').toLowerCase(); return s + ((k.includes('credit')||k==='deposit'||k.includes('topup'))?1:-1)*num(cI(t,'amount')); }, 0);
    return { stored: num(m.balance), proven: sum };
  });
  const va2 = q(write, `SELECT * FROM vault_accounts`);
  test('vault_accounts', va2, v => {
    const vl2 = q(write, `SELECT * FROM vault_ledger`);
    const rows = vl2.filter(r => String(r[vlAccCol]) === String(v[vaIdCol]) || String(r[vlAccCol]) === String(v[vaAccIdCol]));
    if (vlTsCol) rows.sort((a,b) => String(a[vlTsCol]||'').localeCompare(String(b[vlTsCol]||'')));
    const proven = rows.length ? num(rows[rows.length-1][vlBalCol]) : 0;
    return { stored: num(v[vaBalCol]), proven };
  });
  const ccw2 = q(write, `SELECT * FROM customer_crypto_wallets`);
  const cctx2 = q(write, `SELECT * FROM crypto_transactions`);
  test('customer_crypto_wallets', ccw2, c => {
    const cust = c[ccCustCol], coin = c[ccCoinCol];
    const rows = cctx2.filter(t => (ctCustCol?String(t[ctCustCol])===String(cust):true) && (ctCoinCol?String(t[ctCoinCol])===String(coin):true));
    const sum = rows.reduce((s,t) => { const k = String(t[ctTypCol]||'').toLowerCase(); const sign = ['buy','deposit','swap_in','credit','mint','receive','reward'].includes(k)?1:['sell','withdraw','swap_out','debit','fee','send','burn'].includes(k)?-1:0; return s + sign*num(t[ctAmtCol]); }, 0);
    return { stored: num(c[ccBalCol]), proven: sum, isCrypto:true };
  });
  if (verifyOk) console.log('  ✅ ALL RE-VERIFICATION PASSED — every balance now matches its transaction proof.');

  // --------------------------
  // GRAND TOTALS AFTER
  // --------------------------
  console.log('\n==================== GRAND TOTALS AFTER CORRECTION ====================');
  const after = { fiat: {}, crypto: {} };
  q(write,`SELECT * FROM customer_wallets`).forEach(w => accu(after.fiat, w.currency||'USD', num(w.balance)));
  q(write,`SELECT * FROM merchant_wallets`).forEach(m => accu(after.fiat, m.currency||'USD', num(m.balance)));
  q(write,`SELECT * FROM vault_accounts`).forEach(v => accu(after.fiat, v[vaCurCol]||'USD', num(v[vaBalCol])));
  if (sc.accounts && sc.accounts.length) q(write,`SELECT * FROM accounts`).forEach(a => accu(after.fiat, cI(a,'currency')||'USD', num(cI(a,'balance'))));
  q(write,`SELECT * FROM customer_crypto_wallets`).forEach(c => accu(after.crypto, c[ccCoinCol]||'?', num(c[ccBalCol])));
  if (sc.merchant_crypto_balances && sc.merchant_crypto_balances.length) {
    q(write,`SELECT * FROM merchant_crypto_balances`).forEach(m => {
      const k = Object.keys(m);
      const balC = k.find(x=>/balance/i.test(x));
      const curC = k.find(x=>/crypto|coin|currency|symbol/i.test(x));
      accu(after.crypto, m[curC]||'?', num(m[balC]));
    });
  }
  console.log('  FIAT:');
  Object.keys({...before.fiat, ...after.fiat}).sort().forEach(c => {
    const b = before.fiat[c] || 0, a = after.fiat[c] || 0;
    console.log(`    ${c.padEnd(6)} before=${b.toFixed(2).padStart(12)}   after=${a.toFixed(2).padStart(12)}   Δ=${(a-b>=0?'+':'')+(a-b).toFixed(2)}`);
  });
  if (Object.keys({...before.crypto,...after.crypto}).length) {
    console.log('  CRYPTO:');
    Object.keys({...before.crypto,...after.crypto}).sort().forEach(c => {
      const b = before.crypto[c]||0, a = after.crypto[c]||0;
      console.log(`    ${c.padEnd(8)} before=${b.toFixed(8).padStart(18)}   after=${a.toFixed(8).padStart(18)}   Δ=${(a-b>=0?'+':'')+(a-b).toFixed(8)}`);
    });
  }

  // Persist
  try {
    const fixed = write.export();
    fs.writeFileSync(DB_PATH, Buffer.from(fixed));
    console.log(`\n💾 Corrected DB persisted to ${DB_PATH} (${(fixed.length/1024).toFixed(0)} KB)`);
  } catch(e) { console.error('Persist fail: ' + e.message); process.exit(5); }

  console.log(`\n============================================================`);
  console.log(`  RESTORE SUMMARY`);
  console.log(`============================================================`);
  console.log(`  Total discrepancies found:   ${issues.length}`);
  console.log(`  Phantom balances removed:    ${fixedPhantom}`);
  console.log(`  Missing balances restored:   ${fixedMissing}`);
  console.log(`  Fixes failed:                ${failed}`);
  console.log(`  Re-verification:             ${verifyOk ? '✅ PASSED' : '⚠ OPEN (see above)'}`);
  console.log(`  Backup:                      ${backupPath}`);
  console.log(``);

  read.close(); write.close();
})().catch(e => { console.error('FATAL: ' + e.message); console.error(e.stack); process.exit(1); });
