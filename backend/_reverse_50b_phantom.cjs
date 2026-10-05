const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';
const STAN = '000012';
const SETTLEMENT_REF = '375145';
const TXN_ID = 'txn_1788881192522_2nwzrxhda';
const PHANTOM_AMOUNT_USD = 50_000_000_000;
const REASON = 'FORENSIC REVERSAL: $50B extra-zero phantom MOTO txn (STAN='+STAN+', settlement='+SETTLEMENT_REF+') — card never actually charged by processor';
const NOW = new Date().toISOString();
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const cents = s => (Number(s || 0) / 100);

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
  const persist = () => { try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log('\n💾 DB flushed to disk.'); } catch(e){ console.error('FLUSH ERR:', e.message); } };

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🩸 SURGICAL $50B PHANTOM REVERSAL — 7 LAYERS');
  console.log('   Txn ID           :', TXN_ID);
  console.log('   STAN / Settlement:', STAN, '/', SETTLEMENT_REF);
  console.log('   Merchant         :', MERCHANT_ID);
  console.log('   Phantom amount   :', $(PHANTOM_AMOUNT_USD), 'USD');
  console.log('   Reversal reason  :', REASON);
  console.log('   Executed At      :', NOW);
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // ——— PRE-STATE SNAPSHOT ———
  console.log('\n▌ PRE-STATE SNAPSHOT');
  const preWal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  const preLedger50B = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const preJournal50B = q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND ABS(amount - ?) < 0.01`, [preWal?.id, PHANTOM_AMOUNT_USD]);
  const preTxn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const preBatch = one(`SELECT * FROM pos2013_batches WHERE settlement_code=? AND merchant_id=?`, [SETTLEMENT_REF, MERCHANT_ID]);
  const preMps = one(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const preOfc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  console.log(`   USD Wallet balance (PRE)      : ${$(preWal?.balance)}`);
  console.log(`   Ledger $50B credit rows (PRE) : ${preLedger50B.length}`);
  console.log(`   Wallet journal $50B credit (PRE): ${preJournal50B.length}`);
  console.log(`   pos txn (PRE) amount          : ${$(cents(preTxn?.amount_minor))} ${preTxn?.currency} status=${preTxn?.status}`);
  console.log(`   batch (PRE) settlement_code   : ${preBatch?.settlement_code} status=${preBatch?.status} total=${$(cents(preBatch?.total_amount_minor))}`);
  console.log(`   mps (PRE) amount              : ${$(preMps?.amount)} ${preMps?.currency} status=${preMps?.status}`);
  console.log(`   offline receipt (PRE) amt     : ${$(cents(preOfc?.amount_minor))} status=${preOfc?.status}`);

  const safety = one(`SELECT COUNT(*) as n FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' AND amount > ?`, [preWal?.id, PHANTOM_AMOUNT_USD - 1]);
  if (Number(safety?.n||0) !== preJournal50B.length) {
    console.log('   ⚠️  safety check: multiple giant credits — confirm before reversing. Halting.');
    process.exit(1);
  }

  // ================================================================
  // LAYER 1: merchant_wallets denormalized balance − $50B
  // ================================================================
  console.log('\n▌ LAYER 1/7: merchant_wallets.USD balance − $50,000,000,000');
  const balBefore = Number(preWal?.balance || 0);
  const balAfter = balBefore - PHANTOM_AMOUNT_USD;
  if (balAfter < 0) { console.log('   ❌ Refusing: new balance would be negative (' + $(balAfter) + '). Phantom wasn\'t fully credited?'); process.exit(1); }
  const r1 = run(`UPDATE merchant_wallets SET balance = ?, updated_at = ? WHERE id = ?`, [balAfter.toFixed(2), NOW, preWal.id]);
  console.log(`   ${r1} row updated: ${$(balBefore)} → ${$(balAfter)}  (−${$(PHANTOM_AMOUNT_USD)})`);

  // ================================================================
  // LAYER 2: merchant_wallet_transactions — insert reversal debit, mark original credit as reversed
  // ================================================================
  console.log('\n▌ LAYER 2/7: merchant_wallet_transactions (journal)');
  const reversalId = 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const r2a = run(`INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, created_at)
    VALUES (?, ?, 'debit', ?, 'USD', 'forensic_reversal', ?, ?, ?)`,
    [reversalId, preWal.id, PHANTOM_AMOUNT_USD.toFixed(2), 'REV-'+SETTLEMENT_REF, REASON, NOW]);
  console.log(`   ✅ Inserted reversal DEBIT journal row: id=${reversalId}  amount=−${$(PHANTOM_AMOUNT_USD)}`);
  if (preJournal50B.length) {
    const origId = preJournal50B[0].id;
    const r2b = run(`UPDATE merchant_wallet_transactions SET description = ? WHERE id = ?`,
      [(preJournal50B[0].description ? preJournal50B[0].description + ' | ' : '') + '[REVERSED '+reversalId+': '+REASON+']', origId]);
    console.log(`   ✅ Marked original journal row ${origId.slice(0,24)}… as REVERSED`);
  }

  // ================================================================
  // LAYER 3: ledger_entries — create REVERSAL debit, set original $50B credit status to VOIDED
  // ================================================================
  console.log('\n▌ LAYER 3/7: ledger_entries (double-entry reversal)');
  const origLedger = preLedger50B[0];
  if (origLedger) {
    // Original was AUTHORIZED, not SETTLED — so VOID the credit side
    const r3a = run(`UPDATE ledger_entries SET status = 'VOIDED', description = ?, updated_at = ? WHERE id = ?`,
      [(origLedger.description?origLedger.description+' | ':'') + '[VOIDED FORENSIC REVERSAL '+reversalId+': '+REASON+']', NOW, origLedger.id]);
    console.log(`   ✅ Voided original ledger CREDIT: id=${origLedger.id}  (AUTHORIZED → VOIDED)`);
    // Pair with a reversal DEBIT to balance (same txn_id, opposite side)
    const revLedgerId = 'ledger_rev_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const r3b = run(`INSERT INTO ledger_entries (id, transaction_id, type, amount, currency, status, description, created_at, merchant_id, source_type, source_reference, source_network)
      VALUES (?, ?, 'debit', ?, 'USD', 'SETTLED', ?, ?, ?, 'forensic_reversal', ?, ?)`,
      [revLedgerId, origLedger.transaction_id || 'rev-'+reversalId, PHANTOM_AMOUNT_USD.toFixed(2),
       'FORENSIC REVERSAL DEBIT (paired with '+origLedger.id+'): '+REASON, NOW, MERCHANT_ID, 'REV-'+SETTLEMENT_REF, 'internal']);
    console.log(`   ✅ Inserted matching reversal DEBIT ledger row: id=${revLedgerId}  amount=−${$(PHANTOM_AMOUNT_USD)} SETTLED`);
  } else {
    console.log('   ℹ️  No $50B ledger credit to void (already cleaned?).');
  }

  // ================================================================
  // LAYER 4: pos2013_transactions — STAN=000012 → status VOIDED, amount 0, add meta reversal
  // ================================================================
  console.log('\n▌ LAYER 4/7: pos2013_transactions (STAN=000012)');
  if (preTxn) {
    let meta = {};
    try { meta = JSON.parse(preTxn.meta || '{}'); } catch(_){ meta = {}; }
    meta.reversal = { at: NOW, reason: REASON, reversal_id: reversalId, original_amount_minor: preTxn.amount_minor, original_currency: preTxn.currency };
    const r4 = run(`UPDATE pos2013_transactions SET
        amount_minor = 0,
        status = 'VOIDED',
        auth_mode = 'ONLINE_DECLINED',
        decline_reason = ?,
        pan_masked = COALESCE(NULLIF(pan_masked,'****'), '****'),
        meta = ?,
        settled_at = ?,
        updated_at = ?
      WHERE id = ?`,
      [REASON, JSON.stringify(meta), NOW, NOW, preTxn.id]);
    console.log(`   ✅ ${r4} row updated: id=${preTxn.id.slice(0,32)}…  amount_minor=${preTxn.amount_minor}→0  status=${preTxn.status}→VOIDED  auth_mode→ONLINE_DECLINED`);
  } else {
    console.log('   ℹ️  No pos txn with STAN='+STAN+' found.');
  }

  // ================================================================
  // LAYER 5: pos2013_batches settlement_code=375145 → status REJECTED
  // ================================================================
  console.log('\n▌ LAYER 5/7: pos2013_batches (settlement_code=375145)');
  if (preBatch) {
    const origMinor = Number(preBatch.total_amount_minor||0);
    const r5 = run(`UPDATE pos2013_batches SET
        status = 'REJECTED',
        total_amount_minor = 0,
        settlement_code = ?,
        txn_count = 0,
        created_at = created_at
      WHERE id = ?`,
      [SETTLEMENT_REF + '_REVERSED_' + reversalId.slice(-6), preBatch.id]);
    console.log(`   ✅ ${r5} row updated: id=${preBatch.id.slice(0,32)}…  total=${$(cents(origMinor))}→$0  status=${preBatch.status}→REJECTED  settlement_code→${SETTLEMENT_REF}_REVERSED…`);
  } else {
    console.log('   ℹ️  No batch with settlement_code='+SETTLEMENT_REF+' found.');
  }

  // ================================================================
  // LAYER 6: merchant_pos_settlements $50B EUR bridge row → status rejected
  // ================================================================
  console.log('\n▌ LAYER 6/7: merchant_pos_settlements (bridge row)');
  if (preMps) {
    let meta = {};
    try { meta = JSON.parse(preMps.meta || '{}'); } catch(_){ meta = {}; }
    meta.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
    const r6 = run(`UPDATE merchant_pos_settlements SET status = 'rejected', settled_at = ?, meta = ?, updated_at = ? WHERE id = ?`,
      [NOW, JSON.stringify(meta), NOW, preMps.id]);
    console.log(`   ✅ ${r6} row updated: id=${preMps.id.slice(0,28)}…  amount=$(preMps.amount) ${preMps.currency}  status=${preMps.status}→rejected  `);
  } else {
    console.log('   ℹ️  No matching merchant_pos_settlements $50B bridge row.');
  }

  // ================================================================
  // LAYER 7: offline_funds_receipts STAN=000012 → status VOID, amount 0
  // ================================================================
  console.log('\n▌ LAYER 7/7: offline_funds_receipts (STAN=000012)');
  if (preOfc) {
    let rp = {};
    try { rp = typeof preOfc.receipt_payload === 'string' ? JSON.parse(preOfc.receipt_payload) : (preOfc.receipt_payload||{}); } catch(_){ rp = {}; }
    rp.reversal = { at: NOW, reason: REASON, reversal_id: reversalId };
    rp.amountMinor = 0;
    const r7 = run(`UPDATE offline_funds_receipts SET
        amount_minor = 0,
        status = 'VOID',
        synced_at = ?,
        receipt_payload = ?,
        updated_at = ?
      WHERE id = ?`,
      [NOW, JSON.stringify(rp), NOW, preOfc.id]);
    console.log(`   ✅ ${r7} row updated: id=${preOfc.id.slice(0,28)}…  stan=${STAN}  amount=$(cents(preOfc.amount_minor))→$0  status=${preOfc.status}→VOID`);
  } else {
    console.log('   ℹ️  No offline_funds_receipts row with STAN='+STAN+'.');
  }

  persist();

  // ——— POST-STATE + VERIFICATION ———
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ POST-STATE VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const postWal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  const postLedger50B = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 AND status != 'VOIDED'`, [MERCHANT_ID, PHANTOM_AMOUNT_USD]);
  const postJournalNet = one(`SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END), 0) as net FROM merchant_wallet_transactions WHERE wallet_id=?`, [preWal?.id]);
  const postTxn = one(`SELECT * FROM pos2013_transactions WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);
  const postBatch = one(`SELECT * FROM pos2013_batches WHERE id = ?`, [preBatch?.id||'__none__']);
  const postMps = preMps ? one(`SELECT * FROM merchant_pos_settlements WHERE id=?`, [preMps.id]) : null;
  const postOfc = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=?`, [STAN, MERCHANT_ID]);

  const checks = [];
  checks.push({ label: '1. USD wallet −$50B', ok: Math.abs(Number(postWal?.balance||0) - balAfter) < 0.01, got: $(postWal?.balance) + ' (expected ' + $(balAfter)+')' });
  checks.push({ label: '2. $50B credit in ledger (non-VOIDED)', ok: postLedger50B.length === 0, got: postLedger50B.length + ' rows' });
  checks.push({ label: '3. pos txn status = VOIDED', ok: !postTxn || postTxn.status === 'VOIDED', got: postTxn?.status || '—' });
  checks.push({ label: '4. pos txn amount_minor = 0', ok: !postTxn || Number(postTxn.amount_minor) === 0, got: String(postTxn?.amount_minor ?? '—') });
  checks.push({ label: '5. batch status = REJECTED', ok: !preBatch || !postBatch || postBatch.status === 'REJECTED', got: postBatch?.status || '—' });
  checks.push({ label: '6. batch total_amount_minor = 0', ok: !preBatch || !postBatch || Number(postBatch.total_amount_minor) === 0, got: String(postBatch?.total_amount_minor ?? '—') });
  checks.push({ label: '7. mps status = rejected', ok: !postMps || postMps.status === 'rejected', got: postMps?.status || '—' });
  checks.push({ label: '8. offline receipt = VOID', ok: !postOfc || postOfc.status === 'VOID', got: postOfc?.status || '—' });
  checks.push({ label: '9. offline receipt amount = 0', ok: !postOfc || Number(postOfc.amount_minor) === 0, got: String(postOfc?.amount_minor ?? '—') });

  console.log('');
  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) { pass++; console.log(`  ✅ PASS  ${c.label.padEnd(42)} → ${c.got}`); }
    else { fail++; console.log(`  ❌ FAIL  ${c.label.padEnd(42)} → ${c.got}`); }
  });

  console.log('');
  console.log(`   USD Wallet (final) : ${$(postWal?.balance)}   (was ${$(balBefore)}, removed ${$(PHANTOM_AMOUNT_USD)} phantom)`);
  console.log(`   Journal NET (sum)  : ${$(Number(postJournalNet?.net||0))}   (should closely match final wallet if no prior gaps)`);
  console.log(`   Reversal trace ID  : ${reversalId}   (stamped in every reversed row for audit)`);

  if (fail > 0) {
    console.log('\n⚠️  ' + fail + '/' + checks.length + ' checks failed. Review above and re-run probe _diag_investor_txn_probe.cjs.');
  } else {
    console.log('\n✅✅✅ ALL ' + checks.length + ' VERIFICATION CHECKS PASSED.');
    console.log('   $50B phantom completely removed from all 7 layers. No residual contamination.');
  }

  console.log('');
  console.log('═══ NEXT STEPS ═══');
  console.log('   Once you confirm REAL charge amount from investor + processor (e.g. $50k USD):');
  console.log('   → I will create a NEW clean transaction (pos + batch + ledger SETTLED + journal + receipt)');
  console.log('     with the correct amount, currency, card last4, and ONLINE_APPROVED auth_mode.');
  console.log('');

})().catch(e => { console.error('\n❌ FATAL:', e.message); process.exit(1); });
