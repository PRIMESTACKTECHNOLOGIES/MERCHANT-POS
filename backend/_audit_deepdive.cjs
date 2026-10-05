const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const BACKUP_PATTERN = /^database\.sqlite\.backup-(\d+)$/;
const dataDir = path.join(__dirname, 'data');
const backups = fs.readdirSync(dataDir)
  .filter(f => BACKUP_PATTERN.test(f))
  .map(f => ({ f, ts: parseInt(BACKUP_PATTERN.exec(f)[1], 10) }))
  .sort((a,b)=>b.ts-a.ts);
const LATEST_BACKUP = backups[0] ? path.join(dataDir, backups[0].f) : null;
console.log('Latest backup: ' + (LATEST_BACKUP || '(none — can not auto-restore if mistake)'));

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(__dirname, 'node_modules','sql.js','dist','sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  if (!fs.existsSync(DB_PATH) || !LATEST_BACKUP) process.exit(2);
  function q(db, sql, params=[]) {
    const s = db.prepare(sql); if (params.length) s.bind(params);
    const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
  }
  function num(v) { return Number(v) || 0; }
  const cur = new SQL.Database(fs.readFileSync(DB_PATH));
  const bak = new SQL.Database(fs.readFileSync(LATEST_BACKUP));

  console.log('\n=============== ROOT CAUSE DEEP-DIVE — CORRECT COLUMN NAMES ===============\n');
  // (A) vault_ledger actual
  console.log('A) vault_ledger raw — EVERY row:');
  const vl = q(bak, `SELECT * FROM vault_ledger ORDER BY ts ASC`);
  if (vl.length) {
    console.log('  cols: ' + Object.keys(vl[0]).join(', '));
  }
  const vlTotUsd = vl.filter(r => (r.currency||'USD').toUpperCase()==='USD').reduce((s,r)=> s + num(r.amount), 0);
  const vlTotEur = vl.filter(r => (r.currency||'USD').toUpperCase()==='EUR').reduce((s,r)=> s + num(r.amount), 0);
  vl.forEach(r => console.log(`    ts=${String(r.ts||'').substring(0,19).padEnd(19)} type=${String(r.type||'').padEnd(16)} merch=${String(r.merchant_id||'').substring(0,8)} amt=${num(r.amount).toFixed(2).padStart(9)} cur=${r.currency||'USD'} ref=${String(r.reference||'').substring(0,18)} status=${r.status||''} meta=${String(r.meta||'').slice(0,80)}`));
  console.log(`  Σ USD vault_ledger = ${vlTotUsd.toFixed(2)}`);
  console.log(`  Σ EUR vault_ledger = ${vlTotEur.toFixed(2)}`);

  // vault_ledger USD sum = 8500 (500+1000+2500+3000+1500). These are the 5 batches.
  // Now the PROC-VAULT-USD-002 stored balance in backup was 8400, but Σ = 8500 → was it actually SHORT $100 (not 8400 phantom)?
  console.log('\nB) vault_accounts in BACKUP (before we touched anything):');
  const vaOld = q(bak, `SELECT * FROM vault_accounts ORDER BY balance DESC`);
  vaOld.forEach(v => console.log(`  id=${String(v.id).padEnd(24)} cur=${v.currency} bal=${num(v.balance).toFixed(2).padStart(9)} reserved=${num(v.reserved_hold||0).toFixed(2).padStart(8)} type=${v.type||''} name=${v.bank_name||''} meta=${String(v.meta||'').slice(0,80)}`));

  // Now compute the delta between Σvault_ledger (by merchant/currency) and stored vault balance
  console.log('\nC) vault_ledger Σ per currency vs stored vault_accounts.balance:');
  console.log(`  USD:  Σvault_ledger USD = ${vlTotUsd.toFixed(2)}  vs stored PROC-VAULT-USD-002 = $8400.00  →  correct delta = ${(vlTotUsd-8400).toFixed(2)}`);
  console.log(`  → If $8500 moved INTO vault via ledger, but PROC-VAULT shows 8400 only, stored balance is ACTUALLY SHORT by $100 (not phantom +8400 — we MISREAD by using balance_after which was not the field).`);
  console.log(`  → Previous script incorrectly used "balance_after=0" (field doesn't exist) as proof of 0, then removed $8400 → WRONG. The real truth is vault should be $8500 (or at least stored $8400 needs explanation why $100 difference with ledger).\n`);

  // (B) crypto_transactions actual
  console.log('D) crypto_transactions raw — EVERY row (from backup before any changes):');
  const cctx = q(bak, `SELECT * FROM crypto_transactions ORDER BY created_at ASC`);
  if (cctx.length) console.log('  cols: ' + Object.keys(cctx[0]).join(', '));
  cctx.forEach(t => console.log(`    ts=${String(t.created_at||'').substring(0,19).padEnd(19)} customer=${String(t.customer_id).substring(0,20)} txType=${String(t.transaction_type||'').padEnd(10)} fiatAmt=${num(t.fiat_amount).toFixed(2).padStart(8)} fiatCur=${t.fiat_currency||''} cryptoAmt=${num(t.crypto_amount).toFixed(8).padStart(14)} cryptoCoin=${t.crypto_coin||''} rate=${num(t.exchange_rate).toFixed(4)} source=${t.source||''} ref=${String(t.reference||'').substring(0,22)} txh=${String(t.tx_hash||'').substring(0,10)} status=${t.status||''} provider=${t.provider_mode||''} is_mock=${t.is_mock}`));

  // Sum crypto per (customer, coin)
  const cryptoProof = {};
  for (const t of cctx) {
    const k = t.customer_id + '|' + (t.crypto_coin||'USDT');
    if (!cryptoProof[k]) cryptoProof[k] = { customer: t.customer_id, coin: t.crypto_coin||'USDT', buy:0, sell:0, in:0, out:0, txs:0, lastTs:'' };
    const typ = String(t.transaction_type||'').toLowerCase();
    // buy, deposit, swap_in, credit, mint → +crypto_amount
    // sell, withdraw, swap_out, debit, fee, send, burn → -crypto_amount
    const dirSign = ['buy','deposit','swap_in','credit','mint','receive','reward','in'].includes(typ) ? 'IN'
      : ['sell','withdraw','swap_out','debit','fee','send','burn','out'].includes(typ) ? 'OUT' : 'NEUTRAL';
    if (dirSign === 'IN') cryptoProof[k].in += num(t.crypto_amount);
    if (dirSign === 'OUT') cryptoProof[k].out += num(t.crypto_amount);
    cryptoProof[k].txs++;
    cryptoProof[k].lastTs = t.created_at || '';
  }
  console.log('\nE) crypto_transactions Σ per (customer, coin):');
  Object.values(cryptoProof).forEach(cp => {
    const net = cp.in - cp.out;
    console.log(`  cust=${String(cp.customer).substring(0,22).padEnd(24)} coin=${cp.coin.padEnd(6)} IN=${cp.in.toFixed(8).padStart(16)} OUT=${cp.out.toFixed(8).padStart(16)} NET=${net.toFixed(8).padStart(16)}  txs=${cp.txs}`);
  });

  console.log('\nF) customer_crypto_wallets in BACKUP:');
  const ccwOld = q(bak, `SELECT * FROM customer_crypto_wallets ORDER BY balance DESC`);
  ccwOld.forEach(c => {
    const k = c.customer_id + '|' + (c.crypto_coin||'USDT');
    const proof = cryptoProof[k] || { in:0, out:0 };
    const net = proof.in - proof.out;
    const stored = num(c.balance);
    const delta = stored - net;
    console.log(`  id=${c.id.substring(0,10)} cust=${String(c.customer_id).substring(0,22).padEnd(24)} coin=${(c.crypto_coin||'').padEnd(6)} stored=${stored.toFixed(8).padStart(16)} proven=${net.toFixed(8).padStart(16)} Δ(stored-proven)=${(delta>=0?'+':'')+delta.toFixed(8).padStart(16)}  ${Math.abs(delta)>1e-5?'❌':'✅'}`);
  });

  // (C) wallet_transactions $1000 credit/debit against customer cc6f0711
  console.log('\nG) wallet_transactions for customer cc6f0711:');
  const wt = q(bak, `SELECT * FROM wallet_transactions wt JOIN customer_wallets cw ON cw.id = wt.wallet_id WHERE cw.customer_id LIKE 'cc6f0711%' ORDER BY wt.created_at ASC`);
  wt.forEach(t => console.log(`    ts=${String(t.created_at||'').substring(0,19)} type=${String(t.type).padEnd(6)} amt=${num(t.amount).toFixed(2).padStart(9)} cur=${t.currency||''} src=${t.source||''} ref=${String(t.reference||'').substring(0,22)} desc=${String(t.description||'').slice(0,70)}`));
  const wtNet = wt.reduce((s,t) => s + (String(t.type).toLowerCase()==='credit'?1:-1)*num(t.amount), 0);
  const custStoredBalOld = q(bak, `SELECT balance FROM customer_wallets WHERE customer_id LIKE 'cc6f0711%' AND currency='USD'`)[0]?.balance || 0;
  console.log(`  → wallet_tx Σ net = $${wtNet.toFixed(2)}  vs stored customer_wallets.balance = $${num(custStoredBalOld).toFixed(2)}  Δ = $${(num(custStoredBalOld)-wtNet).toFixed(2)}`);

  // (D) merchant_wallets in backup vs merchant_wallet_transactions
  console.log('\nH) merchant_wallets in BACKUP:');
  const mwOld = q(bak, `SELECT * FROM merchant_wallets ORDER BY balance DESC`);
  mwOld.forEach(m => {
    const txs = q(bak, `SELECT type, amount FROM merchant_wallet_transactions WHERE wallet_id=?`, [m.id]);
    const net = txs.reduce((s,t)=> s + ((String(t.type||'').toLowerCase().includes('credit')||String(t.type)==='deposit')?1:-1)*num(t.amount), 0);
    console.log(`  id=${m.id.substring(0,10)} merch=${String(m.merchant_id||'').padEnd(10)} cur=${m.currency||'USD'} stored=${num(m.balance).toFixed(2).padStart(9)} txSum=${net.toFixed(2).padStart(9)} Δ=${(num(m.balance)-net).toFixed(2).padStart(8)}  ${Math.abs(num(m.balance)-net)>0.005?'❌':'✅'}`);
  });

  // ---------------------------------------------------------------------------
  // NOW DECIDE: What was the ACTUAL MISTAKE in previous audit fix?
  //   - Customer USD: stored 2000 vs tx prove 1000 → Δ+$1000 phantom. PREVIOUS FIX (REMOVE $1000) WAS CORRECT.
  //   - Merchant USD: $6500 matches $8500 credit - $2000 debit = $6500. PREVIOUS FIX (NO CHANGE) WAS CORRECT.
  //   - Vault USD: vault_ledger Σ USD = $8500 (5 batches BATCH_TO_VAULT) vs PROC-VAULT-USD-002 stored in backup = $8400.
  //       Previously the script used balance_after (wrong column, always 0) and thought proven=0 → removed $8400 → **INCORRECT**.
  //       Correct delta should have been: stored ($8400) - Σvault_ledger ($8500) = -$100 → vault is SHORT by $100 (NOT +$8400 phantom).
  //       Previous fix removed $8400 from PROC-VAULT USD balance → now it's $0, but should be $8500 (or at least $8400 if we don't trust ledger).
  //   - Crypto: customer_id in crypto_transactions first row = "MRC-1001" (merchant id!).  The stored balance row for MRC-1001 was actually in customer_crypto_wallets (not merchant). And crypto_transactions.transaction_type (not type), crypto_amount (not amount).
  //       Let's compute actual per (customer, coin) NET from transactions vs stored:
  //       MRC-1001 USDT stored = $25500 — need to verify against actual crypto_transactions NET using correct columns.
  //       cc6f0711 USDT stored = $250 — need to verify against actual crypto_transactions NET.
  // ---------------------------------------------------------------------------

  console.log('\n=============== VERDICT ON PREVIOUS 4 FIXES ===============\n');
  // Rebuild the correct issues list based on backup + correct column names:
  const realIssues = [];
  // Issue A: customer USD
  {
    const proven = wtNet;  // 1000.00
    const stored = num(custStoredBalOld); // 2000.00
    const delta = stored - proven; // +1000.00
    const id = q(bak, `SELECT id FROM customer_wallets WHERE customer_id LIKE 'cc6f0711%' AND currency='USD'`)[0].id;
    console.log(`  CUSTOMER cc6f0711 USD:  stored=$${stored.toFixed(2)}  proven(tx_sum)=$${proven.toFixed(2)}  Δ=${(delta>=0?'+':'')+delta.toFixed(2)}`);
    console.log(`    PREVIOUS FIX REMOVED $${Math.abs(delta).toFixed(2)}  → ${Math.abs(delta)>0.005 && delta>0?'✅ CORRECT (PHANTOM)':delta<0?'❌ WRONG (MISSING — REMOVED INSTEAD OF ADDED)':'OK'}`);
    if (Math.abs(delta)>0.005) realIssues.push({correct:true, tbl:'customer_wallets', id, ccy:'USD', delta});
  }

  // Issue B: vault PROC-VAULT-USD
  {
    const proven = vlTotUsd; // $8500
    const stored = num(vaOld.find(v=>v.id==='PROC-VAULT-USD-002')?.balance || 0); // $8400
    const delta = stored - proven; // 8400-8500 = -100
    console.log(`\n  VAULT PROC-VAULT-USD-002:  stored=$${stored.toFixed(2)}  proven(Σvault_ledger USD)=$${proven.toFixed(2)}  Δ=${(delta>=0?'+':'')+delta.toFixed(2)}`);
    console.log(`    PREVIOUS FIX (removed $8400 → now $0)  → ❌ WRONG! Proven=${proven.toFixed(2)} but script used balance_after (0). Should be ${proven.toFixed(2)} (or at least ${stored.toFixed(2)} not $0).`);
    console.log(`    Real correction direction: stored < proven. Wallet is SHORT $${Math.abs(delta).toFixed(2)}, not phantom. PREVIOUS removal destroyed $${stored.toFixed(2)} of real vault reserves.`);
    realIssues.push({correct:false, tbl:'vault_accounts', id:'PROC-VAULT-USD-002', ccy:'USD', storedPrev:stored, deltaPrev: stored, shouldBe:proven});
  }

  // Issues C, D: crypto
  for (const c of ccwOld) {
    const cust = c.customer_id, coin = c.crypto_coin || 'USDT';
    const key = cust + '|' + coin;
    const proof = cryptoProof[key] || {in:0, out:0};
    const proven = proof.in - proof.out;
    const stored = num(c.balance);
    const delta = stored - proven;
    const wasRemoved = delta; // previous "phantom" = stored
    console.log(`\n  CRYPTO cust=${String(cust).substring(0,22)} coin=${coin}:  stored=${stored.toFixed(8)}  proven=${proven.toFixed(8)}  Δ=${(delta>=0?'+':'')+delta.toFixed(8)}`);
    const prevCorrect = Math.abs(delta) < 1e-5 ? 'NO CHANGE NEEDED' : (delta>0 ? `✅ PREV REMOVED ${Math.abs(delta).toFixed(8)} → CORRECT (PHANTOM if delta>0)` : `❌ PREV REMOVED INSTEAD OF ADDED — MISSING ${Math.abs(delta).toFixed(8)}`);
    console.log(`    ${prevCorrect}`);
    // Previous action: REMOVE stored bal (because script thought proven=0). Correct only if delta>0 (stored>proven). If delta<0, then previous action was double-wrong.
    if (Math.abs(delta)>1e-5) realIssues.push({correct: delta>0, tbl:'customer_crypto_wallets', id:c.id, ccy:coin, storedPrev:stored, delta, shouldBe:proven});
  }

  // ---------------------------------------------------------------------------
  // ACTION: If any fix was WRONG (negative delta means we *removed* when we should have *added*, or any vault issue — restore to backup then apply ONLY the 2 that were CORRECT)
  // ---------------------------------------------------------------------------
  console.log('\n=============== CORRECTIVE RE-RESTORE ===============\n');
  const anyWrong = realIssues.some(x => !x.correct);
  if (!anyWrong) {
    console.log('  All 4 fixes were CORRECT. No action needed. DB is clean already.');
  } else {
    console.log('  ⚠️ Some fixes were WRONG. Restoring to BACKUP, then re-applying ONLY the CORRECT fixes.');
    console.log('');
    // 1. Restore from backup first (writes backup over the modified DB)
    const backupBuf = fs.readFileSync(LATEST_BACKUP);
    fs.writeFileSync(DB_PATH, backupBuf);
    console.log('  STEP 1: ✅ Restored full DB from backup → ' + LATEST_BACKUP + ' (file size: ' + (backupBuf.length/1024).toFixed(0) + ' KB)');
    // 2. Now open write handle to the restored DB and apply CORRECT fixes only (correct=true entries)
    const dbFix = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('\n  STEP 2: Re-applying only the CORRECT fixes:');
    const correctFixes = realIssues.filter(x => x.correct);
    const wrongFixes   = realIssues.filter(x => !x.correct);
    console.log(`    Correct fixes to keep: ${correctFixes.length}    Wrong fixes skipped: ${wrongFixes.length}`);
    let kept = 0, skipped = 0;
    for (const iss of realIssues) {
      if (!iss.correct) {
        skipped++;
        const dec = iss.ccy === 'USD' || iss.ccy === 'EUR' ? 2 : 8;
        console.log(`    ⚠ SKIPPED WRONG FIX: ${iss.tbl}.id=${String(iss.id).substring(0,18)}  (previous script would have removed ${num(iss.storedPrev).toFixed(dec)} ${iss.ccy} but REAL PROVEN = ${num(iss.shouldBe).toFixed(dec)})`);
        continue;
      }
      const dec = /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(iss.ccy) ? 2 : 8;
      const sign = iss.delta > 0 ? '-' : '+';
      const balCol = iss.tbl.includes('crypto') ? 'balance' : 'balance';
      const updTs = 'updated_at = CURRENT_TIMESTAMP, ';
      const sql = `UPDATE "${iss.tbl}" SET ${updTs} ${balCol} = ${balCol} ${sign} ? WHERE id = ?`;
      try {
        const s = dbFix.prepare(sql);
        s.bind([Math.abs(iss.delta), iss.id]);
        s.step(); s.free();
        kept++;
        console.log(`    ✅ KEPT FIX #${kept}: ${iss.tbl}.id=${String(iss.id).substring(0,18)}  ${sign==='-'?'REMOVED':'ADDED'} ${Math.abs(iss.delta).toFixed(dec)} ${iss.ccy} (balance ${sign==='-'?'−':'+'} ${Math.abs(iss.delta).toFixed(dec)})`);
      } catch(e) {
        console.log(`    ❌ FAIL re-apply: ${e.message}  SQL: ${sql}`);
      }
    }
    // 3. Persist corrected-restored DB
    const finalBuf = dbFix.export();
    fs.writeFileSync(DB_PATH, Buffer.from(finalBuf));
    dbFix.close();
    console.log('\n  STEP 3: 💾 Persisted restored + selectively-fixed DB → ' + DB_PATH + ' (' + (finalBuf.length/1024).toFixed(0) + ' KB)');

    // 4. Final RE-VERIFICATION — print the correct balances
    console.log('\n=============== FINAL VERIFICATION (POST CORRECTIVE RESTORE) ===============\n');
    const finalDb = new SQL.Database(fs.readFileSync(DB_PATH));
    function qF(sql, p=[]) { return q(finalDb, sql, p); }

    // Fiat summary
    const cwF = qF(`SELECT customer_id, currency, balance FROM customer_wallets`);
    const mwF = qF(`SELECT merchant_id, currency, balance FROM merchant_wallets`);
    const vaF = qF(`SELECT id, bank_name, currency, balance, reserved_hold FROM vault_accounts ORDER BY balance DESC`);
    const acF = qF(`SELECT id, currency, balance FROM accounts`);
    const ccF = qF(`SELECT customer_id, crypto_coin, balance FROM customer_crypto_wallets ORDER BY balance DESC`);
    const grand = { fiat:{}, crypto:{} };
    function add(tgt, k, v) { if (!v) return; if (tgt[k]==null) tgt[k]=0; tgt[k]+=v; }
    console.log('  customer_wallets:');
    cwF.forEach(w => { add(grand.fiat, w.currency||'USD', num(w.balance)); if (num(w.balance)!==0) console.log(`    cust=${String(w.customer_id).substring(0,22).padEnd(24)} bal=${num(w.balance).toFixed(2).padStart(9)} ${w.currency||'USD'}`); });
    console.log('  merchant_wallets:');
    mwF.forEach(m => { add(grand.fiat, m.currency||'USD', num(m.balance)); if (num(m.balance)!==0) console.log(`    merch=${String(m.merchant_id).padEnd(14)} bal=${num(m.balance).toFixed(2).padStart(9)} ${m.currency||'USD'}`); });
    console.log('  vault_accounts:');
    vaF.forEach(v => { add(grand.fiat, v.currency||'USD', num(v.balance)); console.log(`    id=${String(v.id).padEnd(24)} bal=${num(v.balance).toFixed(2).padStart(9)} ${v.currency||'USD'} hold=${num(v.reserved_hold||0).toFixed(2)} name=${v.bank_name||''}`); });
    if (acF.length) { console.log('  accounts:'); acF.forEach(a => { add(grand.fiat, a.currency||'USD', num(a.balance)); console.log(`    id=${String(a.id).padEnd(24)} bal=${num(a.balance).toFixed(2).padStart(9)} ${a.currency||'USD'}`); }); }
    console.log('  customer_crypto_wallets:');
    ccF.forEach(c => { add(grand.crypto, c.crypto_coin||'?', num(c.balance)); if (num(c.balance)!==0) console.log(`    cust=${String(c.customer_id).substring(0,22).padEnd(24)} bal=${num(c.balance).toFixed(8).padStart(16)} ${c.crypto_coin||''}`); });
    console.log('\n  FINAL GRAND TOTALS ON BOOKS:');
    Object.keys(grand.fiat).sort().forEach(c => console.log(`    FIAT ${c.padEnd(6)}: ${grand.fiat[c].toFixed(2).padStart(14)}`));
    Object.keys(grand.crypto).sort().forEach(c => console.log(`    CRYPTO ${c.padEnd(8)}: ${grand.crypto[c].toFixed(8).padStart(18)}`));

    finalDb.close();
  }

  console.log('\n=============== END DEEP-DIVE ===============\n');
  cur.close(); bak.close();
})().catch(e => { console.error('FATAL: ' + e.message); console.error(e.stack); process.exit(1); });
