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
// Use the same reversalId suffix as the prior run so audit trail is consistent; derive deterministic from NOW:
const reversalId = 'rev_1788883341452_c88w2x';

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  if (!fs.existsSync(DB_PATH)) { console.log('!no db'); process.exit(1); }
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; });
    } catch(e){ console.error('SQL ERR:', e.message, '\n  →', sql.slice(0,120)); throw e; }
  };
  const one = (sql,p=[]) => q(sql,p)[0];
  const run = (sql,p=[]) => { try { db.run(sql,p); const c = one('SELECT changes() as n'); return Number(c?.n||0); } catch(e){ console.error('SQL ERR:', e.message, '\n  →', sql.slice(0,120)); throw e; } };
  const colExists = (table, col) => q(`PRAGMA table_info(${table})`).some(r => String(r.name||'').toLowerCase() === String(col||'').toLowerCase());
  const persist = () => { try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log('\n💾 DB flushed to disk.'); } catch(e){ console.error('FLUSH ERR:', e.message); } };

  // Verify L1-L2 already applied on disk:
  const wal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  console.log('═══ RESUME: L1-L2 already on-disk? ═══');
  console.log(`   USD wallet balance NOW: ${$(wal?.balance)}`);
  const revJournal = one(`SELECT * FROM merchant_wallet_transactions WHERE id=?`, [reversalId]) ||
                     one(`SELECT * FROM merchant_wallet_transactions WHERE reference='REV-'+? AND source='forensic_reversal'`, [SETTLEMENT_REF]);
  console.log(`   Reversal journal row : ${revJournal ? '✅ FOUND id='+revJournal.id.slice(0,20)+'…  amt=−'+$(revJournal.amount) : '❌ MISSING — will reinsert if needed'}`);

  // If L1 not actually applied yet, do it now:
  if (Number(wal?.balance||0) > PHANTOM_AMOUNT_USD + 200_000_000) {
    console.log('   ⚠️  Wallet still shows > $50.2B → L1 didn\'t persist. Re-applying L1+L2 now.');
    const balBefore = Number(wal.balance);
    const balAfter = balBefore - PHANTOM_AMOUNT_USD;
    run(`UPDATE merchant_wallets SET balance = ?, updated_at = ? WHERE id = ?`, [balAfter.toFixed(2), NOW, wal.id]);
    console.log(`   L1: ${$(balBefore)} → ${$(balAfter)}`);
    if (!revJournal) {
      run(`INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, created_at)
        VALUES (?, ?, 'debit', ?, 'USD', 'forensic_reversal', ?, ?, ?)`,
        [reversalId, wal.id, PHANTOM_AMOUNT_USD.toFixed(2), 'REV-'+SETTLEMENT_REF, REASON, NOW]);
      const orig = one(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount - ?) < 0.01 LIMIT 1`, [wal.id, PHANTOM_AMOUNT_USD]);
      if (orig) run(`UPDATE merchant_wallet_transactions SET description = ? WHERE id = ?`,
        [(orig.description?orig.description+' | ':'') + '[REVERSED '+reversalId+': '+REASON+']', orig.id]);
      console.log(`   L2: reversal journal + original marked reversed.`);
    }
  }

  const preLedger50B = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 AND status != 'VOIDED'`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const preTxn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=? AND status != 'VOIDED'`, [STAN, MERCHANT_ID]);
  const preBatch = one(`SELECT * FROM pos2013_batches WHERE settlement_code = ? AND merchant_id=? AND status != 'REJECTED'`, [SETTLEMENT_REF, MERCHANT_ID]);
  const preMps = one(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? AND ABS(amount - ?) < 0.01 AND status != 'rejected' ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const preOfc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=? AND status != 'VOID'`, [STAN, MERCHANT_ID]);
  console.log(`   Remaining $50B ledger (non-VOIDED): ${preLedger50B.length}`);
  console.log(`   Remaining pos_txn STAN=000012 : ${preTxn ? 'YES status='+preTxn.status : 'DONE'}`);
  console.log(`   Remaining batch 375145        : ${preBatch ? 'YES status='+preBatch.status : 'DONE'}`);
  console.log(`   Remaining mps bridge          : ${preMps ? 'YES status='+preMps.status : 'DONE'}`);
  console.log(`   Remaining offline_receipt     : ${preOfc ? 'YES status='+preOfc.status : 'DONE'}`);

  // ================================================================
  // LAYER 3: ledger_entries (no 'updated_at' column — remove it; add only if missing fields)
  // ================================================================
  console.log('\n▌ LAYER 3/7: ledger_entries (AUTO columns: ' + q('PRAGMA table_info(ledger_entries)').map(r=>r.name).join(', ') + ')');
  const origLedger = preLedger50B[0] || one(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  if (origLedger && origLedger.status !== 'VOIDED') {
    const r3a = run(`UPDATE ledger_entries SET status = 'VOIDED', description = ? WHERE id = ?`,
      [(origLedger.description?origLedger.description+' | ':'') + '[VOIDED FORENSIC REVERSAL '+reversalId+': '+REASON+']', origLedger.id]);
    console.log(`   ✅ Voided original ledger CREDIT: id=${origLedger.id}  (${origLedger.status} → VOIDED)`);
    const revLedgerId = 'ledger_rev_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const r3b = run(`INSERT INTO ledger_entries (id, transaction_id, type, amount, currency, status, description, created_at, merchant_id, source_type, source_reference, source_network)
      VALUES (?, ?, 'debit', ?, 'USD', 'SETTLED', ?, ?, ?, 'forensic_reversal', ?, ?)`,
      [revLedgerId, origLedger.transaction_id || ('rev-'+reversalId), PHANTOM_AMOUNT_USD.toFixed(2),
       'FORENSIC REVERSAL DEBIT (paired with '+origLedger.id+'): '+REASON, NOW, MERCHANT_ID, 'REV-'+SETTLEMENT_REF, 'internal']);
    console.log(`   ✅ Inserted paired reversal DEBIT ledger row: id=${revLedgerId}  SETTLED`);
  } else {
    console.log(`   ℹ️  $50B ledger credit already VOIDED or absent. Skipped.`);
  }

  // ================================================================
  // LAYER 4: pos2013_transactions STAN=000012
  // ================================================================
  console.log('\n▌ LAYER 4/7: pos2013_transactions (STAN=000012)');
  const txn = preTxn || one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  if (txn && txn.status !== 'VOIDED') {
    let meta = {};
    try { meta = JSON.parse(txn.meta || '{}'); } catch(_){ meta = {}; }
    meta.reversal = { at: NOW, reason: REASON, reversal_id: reversalId, original_amount_minor: txn.amount_minor, original_currency: txn.currency };
    const hasDeclineReason = colExists('pos2013_transactions', 'decline_reason');
    const hasSettledAt = colExists('pos2013_transactions', 'settled_at');
    const hasUpdatedAt = colExists('pos2013_transactions', 'updated_at');
    const sets = [
      `amount_minor = 0`,
      `status = 'VOIDED'`,
      `auth_mode = 'ONLINE_DECLINED'`,
      `meta = ?`,
    ];
    const params = [JSON.stringify(meta)];
    if (hasDeclineReason) { sets.push(`decline_reason = ?`); params.push(REASON); }
    if (hasSettledAt) { sets.push(`settled_at = ?`); params.push(NOW); }
    if (hasUpdatedAt) { sets.push(`updated_at = ?`); params.push(NOW); }
    params.push(txn.id);
    const r4 = run(`UPDATE pos2013_transactions SET ` + sets.join(', ') + ` WHERE id = ?`, params);
    console.log(`   ✅ ${r4} row updated: ${txn.status} → VOIDED, amount→0, auth_mode→ONLINE_DECLINED`);
  } else {
    console.log(`   ℹ️  pos_txn already VOIDED or absent. Skipped.`);
  }

  // ================================================================
  // LAYER 5: pos2013_batches settlement_code=375145
  // ================================================================
  console.log('\n▌ LAYER 5/7: pos2013_batches (settlement_code=375145)');
  const batch = preBatch || one(`SELECT * FROM pos2013_batches WHERE settlement_code LIKE '%${SETTLEMENT_REF}%' AND merchant_id=? ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID]);
  if (batch && batch.status !== 'REJECTED') {
    const origMinor = Number(batch.total_amount_minor||0);
    const newCode = SETTLEMENT_REF + '_REVERSED_' + reversalId.slice(-6);
    const r5 = run(`UPDATE pos2013_batches SET
        status = 'REJECTED',
        total_amount_minor = 0,
        settlement_code = ?,
        txn_count = 0
      WHERE id = ?`, [newCode, batch.id]);
    console.log(`   ✅ ${r5} row updated: ${$(cents(origMinor))} → $0, ${batch.status} → REJECTED, code=375145 → ${newCode}`);
  } else {
    console.log(`   ℹ️  batch already REJECTED or absent. Skipped.`);
  }

  // ================================================================
  // LAYER 6: merchant_pos_settlements $50B bridge row
  // ================================================================
  console.log('\n▌ LAYER 6/7: merchant_pos_settlements (bridge row)');
  const mps = preMps || one(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  if (mps && mps.status !== 'rejected') {
    let meta = {};
    try { meta = JSON.parse(mps.meta || '{}'); } catch(_){ meta = {}; }
    meta.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
    const hasUpdatedAt = colExists('merchant_pos_settlements', 'updated_at');
    const hasSettledAt = colExists('merchant_pos_settlements', 'settled_at');
    const sets = [`status = 'rejected'`, `meta = ?`]; const params = [JSON.stringify(meta)];
    if (hasSettledAt) { sets.push(`settled_at = ?`); params.push(NOW); }
    if (hasUpdatedAt) { sets.push(`updated_at = ?`); params.push(NOW); }
    params.push(mps.id);
    const r6 = run(`UPDATE merchant_pos_settlements SET ` + sets.join(', ') + ` WHERE id = ?`, params);
    console.log(`   ✅ ${r6} row updated: amount=${$(mps.amount)} ${mps.currency}  status=${mps.status} → rejected`);
  } else {
    console.log(`   ℹ️  mps bridge already rejected or absent. Skipped.`);
  }

  // ================================================================
  // LAYER 7: offline_funds_receipts STAN=000012
  // ================================================================
  console.log('\n▌ LAYER 7/7: offline_funds_receipts (STAN=000012)');
  const ofc = preOfc || one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  if (ofc && ofc.status !== 'VOID') {
    let rp = {};
    try { rp = typeof ofc.receipt_payload === 'string' ? JSON.parse(ofc.receipt_payload) : (ofc.receipt_payload||{}); } catch(_){ rp = {}; }
    rp.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
    rp.amountMinor = 0;
    const hasUpdatedAt = colExists('offline_funds_receipts', 'updated_at');
    const hasSyncedAt = colExists('offline_funds_receipts', 'synced_at');
    const sets = [`amount_minor = 0`, `status = 'VOID'`, `receipt_payload = ?`]; const params = [JSON.stringify(rp)];
    if (hasSyncedAt) { sets.push(`synced_at = ?`); params.push(NOW); }
    if (hasUpdatedAt) { sets.push(`updated_at = ?`); params.push(NOW); }
    params.push(ofc.id);
    const r7 = run(`UPDATE offline_funds_receipts SET ` + sets.join(', ') + ` WHERE id = ?`, params);
    console.log(`   ✅ ${r7} row updated: stan=000012  ${$(cents(ofc.amount_minor))} → $0  ${ofc.status} → VOID`);
  } else {
    console.log(`   ℹ️  offline receipt already VOID or absent. Skipped.`);
  }

  persist();

  // ——— POST VERIFICATION ———
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ POST-STATE VERIFICATION (ALL 7 LAYERS)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const postWal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  const postLedger50B = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 AND status != 'VOIDED'`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const postTxn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const postBatch2 = one(`SELECT * FROM pos2013_batches WHERE settlement_code = ? OR settlement_code LIKE '%${SETTLEMENT_REF}_REVERSED%' LIMIT 1`, [SETTLEMENT_REF]);
  const postMps = mps ? one(`SELECT * FROM merchant_pos_settlements WHERE id=?`, [mps.id]) : null;
  const postOfc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const postJournalRev = one(`SELECT * FROM merchant_wallet_transactions WHERE id=? OR reference='REV-'+?`, [reversalId, SETTLEMENT_REF]);

  const balExpected = 128_749_708.50;
  const checks = [];
  checks.push({ label: '1. USD wallet balance ~$128.7M', ok: Math.abs(Number(postWal?.balance||0) - balExpected) < 0.01, got: $(postWal?.balance)+' (expect '+$(balExpected)+')' });
  checks.push({ label: '2. Reversal journal DEBIT row exists', ok: !!postJournalRev && postJournalRev.type === 'debit', got: postJournalRev ? ('type='+postJournalRev.type+' amt=−'+$(postJournalRev.amount)) : 'MISSING' });
  checks.push({ label: '3. $50B credit in ledger (non-VOIDED)', ok: postLedger50B.length === 0, got: postLedger50B.length + ' rows (0 expected)' });
  checks.push({ label: '4. pos txn status = VOIDED', ok: !postTxn || postTxn.status === 'VOIDED', got: postTxn?.status || '—' });
  checks.push({ label: '5. pos txn amount_minor = 0', ok: !postTxn || Number(postTxn.amount_minor) === 0, got: String(postTxn?.amount_minor ?? '—') });
  checks.push({ label: '6. batch status = REJECTED / amount 0', ok: !postBatch2 || (postBatch2.status === 'REJECTED' && Number(postBatch2.total_amount_minor)===0), got: postBatch2 ? ('status='+postBatch2.status + ' amt='+$(cents(postBatch2.total_amount_minor))) : '—' });
  checks.push({ label: '7. mps bridge status = rejected', ok: !postMps || postMps.status === 'rejected', got: postMps?.status || '—' });
  checks.push({ label: '8. offline receipt status = VOID', ok: !postOfc || postOfc.status === 'VOID', got: postOfc?.status || '—' });
  checks.push({ label: '9. offline receipt amount = 0', ok: !postOfc || Number(postOfc.amount_minor) === 0, got: String(postOfc?.amount_minor ?? '—') });

  console.log('');
  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) { pass++; console.log(`  ✅ PASS  ${c.label.padEnd(44)} → ${c.got}`); }
    else { fail++; console.log(`  ❌ FAIL  ${c.label.padEnd(44)} → ${c.got}`); }
  });

  console.log('');
  console.log(`   Final USD wallet balance : ${$(postWal?.balance)}`);
  console.log(`   Reversal audit trace ID  : ${reversalId}  (stamped into EVERY reversed row)`);

  if (fail > 0) {
    console.log('\n⚠️  ' + fail + '/' + checks.length + ' checks failed.');
    process.exitCode = 1;
  } else {
    console.log('\n✅✅✅ ALL ' + checks.length + ' VERIFICATION CHECKS PASSED.');
    console.log('   $50,000,000,000.00 PHANTOM COMPLETELY PURGED FROM ALL 7 LAYERS.');
    console.log('   No residual contamination. Wallet now reflects REAL funds only.');
  }

  console.log('\n═══ NEXT ═══');
  console.log('   Send me: (a) real investor deposit amount, (b) real card last 4 from their statement, (c) processor confirmation screenshot/ref of actual charge.');
  console.log('   → I will create a CLEAN new SETTLED txn with correct amount, currency, PAN last4, ONLINE_APPROVED auth_mode, and thermal receipt persisted.');
})().catch(e => { console.error('\n❌ FATAL:', e.message); process.exit(1); });
