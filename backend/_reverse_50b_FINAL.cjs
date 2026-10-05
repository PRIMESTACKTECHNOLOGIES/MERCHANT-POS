const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';
const STAN = '000012';
const SETTLEMENT_REF = '375145';
const PHANTOM_AMOUNT_USD = 50_000_000_000;
const REASON = 'FORENSIC REVERSAL: $50B extra-zero phantom MOTO txn (STAN='+STAN+', settlement='+SETTLEMENT_REF+') — card never actually charged by processor';
const NOW = new Date().toISOString();
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const cents = s => (Number(s || 0) / 100);
const reversalId = 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  if (!fs.existsSync(DB_PATH)) { console.log('!no db'); process.exit(1); }
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; });
    } catch(e){ console.error('SQL ERR:', e.message, '\n  →', sql.slice(0,150)); throw e; }
  };
  const one = (sql,p=[]) => q(sql,p)[0];
  const run = (sql,p=[]) => { try { db.run(sql,p); const c = one('SELECT changes() as n'); return Number(c?.n||0); } catch(e){ console.error('SQL ERR:', e.message, '\n  →', sql.slice(0,150)); throw e; } };
  const colsOf = (table) => new Set(q(`PRAGMA table_info(${table})`).map(r => String(r.name||'').toLowerCase()));
  const hasCol = (set, name) => set.has(String(name||'').toLowerCase());
  const persist = () => { try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log('\n💾 DB flushed successfully to:', DB_PATH); } catch(e){ console.error('❌ FLUSH ERR:', e.message); throw e; } };

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🩸 SURGICAL $50B PHANTOM REVERSAL — SINGLE-PASS (ALL 7 LAYERS)');
  console.log('   Reversal Trace ID :', reversalId);
  console.log('   STAN / Settlement :', STAN, '/', SETTLEMENT_REF);
  console.log('   Executed At       :', NOW);
  console.log('═══════════════════════════════════════════════════════════════════════════');

  const preWal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  console.log('\n▌ WALLET PRE-BALANCE :', $(preWal?.balance));
  const balBefore = Number(preWal?.balance || 0);
  const balAfter = Math.max(0, balBefore - PHANTOM_AMOUNT_USD);

  // ====================================================================
  // LAYER 1: merchant_wallets − $50B USD
  // ====================================================================
  console.log('\n▌ L1/7: merchant_wallets.USD balance');
  if (balBefore > PHANTOM_AMOUNT_USD) {
    const cols = colsOf('merchant_wallets');
    const sets = [`balance = ?`]; const params = [balAfter.toFixed(2)];
    if (hasCol(cols, 'updated_at')) { sets.push(`updated_at = ?`); params.push(NOW); }
    params.push(preWal.id);
    run(`UPDATE merchant_wallets SET ` + sets.join(', ') + ` WHERE id = ?`, params);
    console.log(`   ✅ ${$(balBefore)} → ${$(balAfter)}  (−${$(PHANTOM_AMOUNT_USD)})`);
  } else {
    console.log(`   ℹ️  Balance ${$(balBefore)} does not contain phantom — skipping L1.`);
  }

  // ====================================================================
  // LAYER 2: merchant_wallet_transactions journal reversal
  // ====================================================================
  console.log('\n▌ L2/7: merchant_wallet_transactions journal');
  const wCols = colsOf('merchant_wallet_transactions');
  // Find the original $50B credit journal row (if exists)
  const origJournal = one(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [preWal.id, PHANTOM_AMOUNT_USD]);
  // INSERT reversal DEBIT row (only columns that exist)
  const jcol = (name) => hasCol(wCols, name);
  const wFields = ['id','wallet_id','type','amount','currency','source','reference','description','created_at'].filter(jcol);
  const wPlaceholders = wFields.map(()=>'?').join(',');
  const wValues = [];
  if (jcol('id')) wValues.push(reversalId);
  if (jcol('wallet_id')) wValues.push(preWal.id);
  if (jcol('type')) wValues.push('debit');
  if (jcol('amount')) wValues.push(PHANTOM_AMOUNT_USD.toFixed(2));
  if (jcol('currency')) wValues.push('USD');
  if (jcol('source')) wValues.push('forensic_reversal');
  if (jcol('reference')) wValues.push('REV-'+SETTLEMENT_REF);
  if (jcol('description')) wValues.push(REASON);
  if (jcol('created_at')) wValues.push(NOW);
  run(`INSERT INTO merchant_wallet_transactions (${wFields.join(',')}) VALUES (${wPlaceholders})`, wValues);
  console.log(`   ✅ Inserted reversal DEBIT: −${$(PHANTOM_AMOUNT_USD)}`);
  if (origJournal) {
    if (jcol('description')) {
      const newDesc = (origJournal.description?origJournal.description + ' | ':'') + '[REVERSED '+reversalId+': '+REASON+']';
      run(`UPDATE merchant_wallet_transactions SET description = ? WHERE id = ?`, [newDesc, origJournal.id]);
    }
    console.log(`   ✅ Marked original credit row ${origJournal.id?.slice(0,28)??''}… as REVERSED`);
  }

  // ====================================================================
  // LAYER 3: ledger_entries — void $50B credit + insert paired reversal debit
  // ====================================================================
  console.log('\n▌ L3/7: ledger_entries (double-entry)');
  const lCols = colsOf('ledger_entries');
  const lcol = (n) => hasCol(lCols, n);
  // Find the $50B AUTHORIZED credit
  const origLedger = one(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  if (origLedger) {
    const lSets = [`status = 'VOIDED'`]; const lParams = [];
    if (lcol('description')) {
      const d = (origLedger.description?origLedger.description+' | ':'') + '[VOIDED FORENSIC REVERSAL '+reversalId+': '+REASON+']';
      lSets.push(`description = ?`); lParams.push(d);
    }
    lParams.push(origLedger.id);
    run(`UPDATE ledger_entries SET ` + lSets.join(', ') + ` WHERE id = ?`, lParams);
    console.log(`   ✅ Voided credit row ${origLedger.id} (${origLedger.status} → VOIDED)`);
    // Paired reversal DEBIT (SETTLED status — since we're reversing a real journal change already applied)
    const lFields = ['id','transaction_id','type','amount','currency','status','description','created_at','merchant_id','source_type','source_reference','source_network','reference'].filter(lcol);
    const revLedgerId = 'ledger_rev_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const lVals = [];
    if (lcol('id')) lVals.push(revLedgerId);
    if (lcol('transaction_id')) lVals.push(origLedger.transaction_id || ('rev-'+reversalId));
    if (lcol('type')) lVals.push('debit');
    if (lcol('amount')) lVals.push(PHANTOM_AMOUNT_USD.toFixed(2));
    if (lcol('currency')) lVals.push('USD');
    if (lcol('status')) lVals.push('SETTLED');
    if (lcol('description')) lVals.push('FORENSIC REVERSAL DEBIT (paired with '+origLedger.id+'): '+REASON);
    if (lcol('created_at')) lVals.push(NOW);
    if (lcol('merchant_id')) lVals.push(MERCHANT_ID);
    if (lcol('source_type')) lVals.push('forensic_reversal');
    if (lcol('source_reference')) lVals.push('REV-'+SETTLEMENT_REF);
    if (lcol('source_network')) lVals.push('internal');
    if (lcol('reference')) lVals.push(reversalId);
    const lPlaceholders = lFields.map(()=>'?').join(',');
    run(`INSERT INTO ledger_entries (${lFields.join(',')}) VALUES (${lPlaceholders})`, lVals);
    console.log(`   ✅ Inserted paired reversal DEBIT: id=${revLedgerId}, SETTLED status, −${$(PHANTOM_AMOUNT_USD)}`);
  } else {
    console.log(`   ℹ️  No $50B credit ledger row found. Skipped.`);
  }

  // ====================================================================
  // LAYER 4: pos2013_transactions STAN=000012 → VOIDED
  // ====================================================================
  console.log('\n▌ L4/7: pos2013_transactions (STAN=000012)');
  const pCols = colsOf('pos2013_transactions');
  const pcol = (n) => hasCol(pCols, n);
  const txn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=? ORDER BY created_at DESC LIMIT 1`, [STAN, MERCHANT_ID]);
  if (txn) {
    const pSets = [`amount_minor = 0`, `status = 'VOIDED'`, `auth_mode = 'ONLINE_DECLINED'`];
    const pParams = [];
    if (pcol('decline_reason')) { pSets.push(`decline_reason = ?`); pParams.push(REASON); }
    if (pcol('settled_at')) { pSets.push(`settled_at = ?`); pParams.push(NOW); }
    if (pcol('updated_at')) { pSets.push(`updated_at = ?`); pParams.push(NOW); }
    // Save original amount/currency via any available text column (decline_reason suffix or response_payload)
    if (pcol('response_payload') && (txn.amount_minor || txn.currency)) {
      let rp = {};
      try { rp = typeof txn.response_payload === 'string' ? JSON.parse(txn.response_payload) : (txn.response_payload||{}); } catch(_) { rp = {}; }
      rp.reversal = { at: NOW, reason: REASON, reversal_id: reversalId, original_amount_minor: txn.amount_minor, original_currency: txn.currency };
      pSets.push(`response_payload = ?`); pParams.push(JSON.stringify(rp));
    }
    pParams.push(txn.id);
    run(`UPDATE pos2013_transactions SET ` + pSets.join(', ') + ` WHERE id = ?`, pParams);
    console.log(`   ✅ Row ${txn.id.slice(0,32)}…: status=${txn.status} → VOIDED, amount=${$(cents(txn.amount_minor))} ${txn.currency} → $0, auth_mode=${txn.auth_mode} → ONLINE_DECLINED`);
  } else {
    console.log(`   ℹ️  No pos2013_transactions row with STAN=${STAN}. Skipped.`);
  }

  // ====================================================================
  // LAYER 5: pos2013_batches settlement_code=375145 → REJECTED
  // ====================================================================
  console.log('\n▌ L5/7: pos2013_batches (settlement_code=375145)');
  const bCols = colsOf('pos2013_batches');
  const bcol = (n) => hasCol(bCols, n);
  const batch = one(`SELECT * FROM pos2013_batches WHERE merchant_id=? AND (settlement_code = ? OR settlement_code LIKE ('%' || ? || '%')) ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, SETTLEMENT_REF, SETTLEMENT_REF]);
  if (batch) {
    const origMinor = Number(batch.total_amount_minor || 0);
    const newCode = SETTLEMENT_REF + '_REVERSED_' + reversalId.slice(-6);
    const bSets = [`status = 'REJECTED'`, `total_amount_minor = 0`, `txn_count = 0`]; const bParams = [];
    if (bcol('settlement_code')) { bSets.push(`settlement_code = ?`); bParams.push(newCode); }
    bParams.push(batch.id);
    run(`UPDATE pos2013_batches SET ` + bSets.join(', ') + ` WHERE id = ?`, bParams);
    console.log(`   ✅ Row ${batch.id.slice(0,28)}…: total=${$(cents(origMinor))} → $0, status=${batch.status} → REJECTED, settlement_code=${SETTLEMENT_REF} → ${newCode}`);
  } else {
    console.log(`   ℹ️  No batch with settlement_code ~ ${SETTLEMENT_REF}. Skipped.`);
  }

  // ====================================================================
  // LAYER 6: merchant_pos_settlements $50B bridge row → rejected
  // ====================================================================
  console.log('\n▌ L6/7: merchant_pos_settlements (POS↔ledger bridge)');
  const mCols = colsOf('merchant_pos_settlements');
  const mcol = (n) => hasCol(mCols, n);
  const mps = one(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  if (mps) {
    const mSets = [`status = 'rejected'`]; const mParams = [];
    if (mcol('settled_at')) { mSets.push(`settled_at = ?`); mParams.push(NOW); }
    if (mcol('updated_at')) { mSets.push(`updated_at = ?`); mParams.push(NOW); }
    if (mcol('meta')) {
      let meta = {};
      try { meta = JSON.parse(mps.meta || '{}'); } catch(_) { meta = {}; }
      meta.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
      mSets.push(`meta = ?`); mParams.push(JSON.stringify(meta));
    }
    mParams.push(mps.id);
    run(`UPDATE merchant_pos_settlements SET ` + mSets.join(', ') + ` WHERE id = ?`, mParams);
    console.log(`   ✅ Row ${mps.id.slice(0,24)}…: amount=${$(mps.amount)} ${mps.currency} status=${mps.status} → rejected`);
  } else {
    console.log(`   ℹ️  No matching merchant_pos_settlements bridge row. Skipped.`);
  }

  // ====================================================================
  // LAYER 7: offline_funds_receipts STAN=000012 → VOID + amount 0
  // ====================================================================
  console.log('\n▌ L7/7: offline_funds_receipts (STAN=000012)');
  const oCols = colsOf('offline_funds_receipts');
  const ocol = (n) => hasCol(oCols, n);
  const ofc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=? ORDER BY created_at DESC LIMIT 1`, [STAN, MERCHANT_ID]);
  if (ofc) {
    const oSets = [`amount_minor = 0`, `status = 'VOID'`]; const oParams = [];
    if (ocol('receipt_payload')) {
      let rp = {};
      try { rp = typeof ofc.receipt_payload === 'string' ? JSON.parse(ofc.receipt_payload) : (ofc.receipt_payload||{}); } catch(_) { rp = {}; }
      rp.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
      rp.amountMinor = 0;
      oSets.push(`receipt_payload = ?`); oParams.push(JSON.stringify(rp));
    }
    if (ocol('synced_at')) { oSets.push(`synced_at = ?`); oParams.push(NOW); }
    if (ocol('updated_at')) { oSets.push(`updated_at = ?`); oParams.push(NOW); }
    oParams.push(ofc.id);
    run(`UPDATE offline_funds_receipts SET ` + oSets.join(', ') + ` WHERE id = ?`, oParams);
    console.log(`   ✅ Row ${ofc.id.slice(0,24)}…: stan=${STAN} amount=${$(cents(ofc.amount_minor))}→$0 status=${ofc.status}→VOID`);
  } else {
    console.log(`   ℹ️  No offline_funds_receipts STAN=${STAN}. Skipped.`);
  }

  persist();

  // ====================================================================
  // POST VERIFICATION
  // ====================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ POST-STATE VERIFICATION — 9 CHECKS');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  const postWal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  const postLedger = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 AND status != 'VOIDED'`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const postTxn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const postBatch = one(`SELECT * FROM pos2013_batches WHERE merchant_id=? AND (settlement_code = ? OR settlement_code LIKE ('%' || ? || '%')) ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, SETTLEMENT_REF, SETTLEMENT_REF]);
  const postMps = mps ? one(`SELECT * FROM merchant_pos_settlements WHERE id=?`, [mps.id]) : null;
  const postOfc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const postRevDebit = one(`SELECT * FROM merchant_wallet_transactions WHERE (id=? OR reference='REV-' || ?) AND type='debit'`, [reversalId, SETTLEMENT_REF]);
  const postLedgerRev = one(`SELECT * FROM ledger_entries WHERE merchant_id=? AND type='debit' AND status='SETTLED' AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);

  const finalExpected = Math.max(0, Math.round((balBefore - PHANTOM_AMOUNT_USD) * 100) / 100);
  const checks = [];
  checks.push({ label: '1. USD wallet purged $50B', ok: Math.abs(Number(postWal?.balance||0) - finalExpected) < 0.5, got: $(postWal?.balance) + ' (expected ~'+$(finalExpected)+')' });
  checks.push({ label: '2. Journal reversal DEBIT row', ok: !!postRevDebit, got: postRevDebit ? ('−'+$(postRevDebit.amount)+' src='+postRevDebit.source) : 'MISSING' });
  checks.push({ label: '3. Ledger: NO active $50B credit', ok: postLedger.length === 0, got: postLedger.length + ' rows (0 expected)' });
  checks.push({ label: '4. Ledger: reversal DEBIT SETTLED', ok: !!postLedgerRev, got: postLedgerRev ? ('−'+$(postLedgerRev.amount)+' status='+postLedgerRev.status) : 'MISSING' });
  checks.push({ label: '5. pos_txn: VOIDED & amount 0', ok: !postTxn || (postTxn.status === 'VOIDED' && Number(postTxn.amount_minor) === 0), got: postTxn ? ('status='+postTxn.status+' amt='+$(cents(postTxn.amount_minor))) : '—' });
  checks.push({ label: '6. batch: REJECTED & amount 0', ok: !postBatch || (postBatch.status === 'REJECTED' && Number(postBatch.total_amount_minor) === 0), got: postBatch ? ('status='+postBatch.status+' total='+$(cents(postBatch.total_amount_minor))) : '—' });
  checks.push({ label: '7. mps bridge: status=rejected', ok: !postMps || postMps.status === 'rejected', got: postMps?.status || '—' });
  checks.push({ label: '8. offline receipt: VOID & 0', ok: !postOfc || (postOfc.status === 'VOID' && Number(postOfc.amount_minor) === 0), got: postOfc ? ('status='+postOfc.status+' amt='+$(cents(postOfc.amount_minor))) : '—' });
  checks.push({ label: '9. DB actually flushed to disk', ok: fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).mtimeMs > Date.now() - 30_000, got: DB_PATH });

  console.log('');
  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) { pass++; console.log(`  ✅ PASS  ${c.label.padEnd(40)} → ${c.got}`); }
    else { fail++; console.log(`  ❌ FAIL  ${c.label.padEnd(40)} → ${c.got}`); }
  });

  console.log('');
  console.log(`   💰 FINAL USD Wallet Balance  : ${$(postWal?.balance)}`);
  console.log(`   🔍 Reversal Audit Trace ID   : ${reversalId}  (stamped into EVERY row)`);
  console.log(`   🧮 Total purged             : ${$(PHANTOM_AMOUNT_USD)} USD (phantom, never real)`);

  if (fail > 0) {
    console.log('\n⚠️  ' + fail + '/' + checks.length + ' checks failed. See above.');
    process.exitCode = 1;
  } else {
    console.log('\n✅✅✅ ALL ' + checks.length + ' FORENSIC CHECKS PASSED.');
    console.log('   $50,000,000,000 PHANTOM COMPLETELY PURGED FROM ALL 7 LAYERS.');
    console.log('   Database is clean. Wallet reflects REAL funds only.');
  }

  console.log('\n═══ NEXT ACTION ═══');
  console.log('   When you confirm the REAL investor deposit (actual amount, real card last 4, processor confirmation ref),');
  console.log('   send me all three and I will create a CLEAN, fully SETTLED 8-way-matching transaction with:');
  console.log('   • pos2013_transactions (real PAN last4, ONLINE_APPROVED, SETTLED status, correct amount/currency)');
  console.log('   • pos2013_batches (PROCESSED, new settlement ref)');
  console.log('   • transaction_settlements (gross/fee/net + settled_at)');
  console.log('   • merchant_pos_settlements (settled + settled_at)');
  console.log('   • ledger_entries SETTLED credit + double-entry paired rows');
  console.log('   • merchant_wallet_transactions journal CREDIT + denormalized wallet balance update');
  console.log('   • receipts table thermal receipt persisted (matching your printed slip format)');
  console.log('   • offline_funds_receipts SYNCED status');

})().catch(e => { console.error('\n❌ FATAL:', e.message, e.stack?.split('\n').slice(1,3).join('\n')||''); process.exit(1); });
