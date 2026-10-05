const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const TXN_ID = 'txn_1788881192522_2nwzrxhda';
const SETTLEMENT_REF = '375145';
const STAN = '000012';
const MERCHANT_ID = 'MRC-1001';
const PAN4 = '4643';
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const cents = s => (Number(s || 0) / 100);

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; });
    } catch(e){ console.error('SQL ERR:',e.message); throw e; }
  };
  const one = (sql,p=[]) => q(sql,p)[0];

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🔍 FORENSIC AUDIT — POS2013 OFFLINE TRANSACTION ENGINE');
  console.log('   Txn ID      :', TXN_ID);
  console.log('   STAN        :', STAN);
  console.log('   Settlement  :', SETTLEMENT_REF);
  console.log('   Card last 4 :', PAN4);
  console.log('   Merchant    :', MERCHANT_ID);
  console.log('   Receipt Amt : $50,000,000,000.00 USD  (50 BILLION — sanity)');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // ── 1) Find in pos2013_transactions
  console.log('\n▌ 1/8: pos2013_transactions table');
  const p1 = one(`SELECT * FROM pos2013_transactions WHERE local_txn_id = ? OR id = ?`, [TXN_ID, TXN_ID]);
  const p2 = one(`SELECT * FROM pos2013_transactions WHERE merchant_id=? AND stan=? ORDER BY created_at DESC LIMIT 1`, [MERCHANT_ID, STAN]);
  const p3 = q(`SELECT * FROM pos2013_transactions WHERE merchant_id=? AND pan_masked LIKE ? ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID, `%${PAN4}`]);
  const pAll = [p1,p2,...p3].filter(Boolean);
  const seen = new Set(); const posTxns = pAll.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  // settlement_code search
  const p4 = q(`SELECT * FROM pos2013_transactions WHERE merchant_id=? AND (settlement_code = ? OR JSON_EXTRACT(response_payload, '$.settlement') = ? OR auth_code = ?) ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID, SETTLEMENT_REF, SETTLEMENT_REF, SETTLEMENT_REF]);
  p4.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); posTxns.push(t); } });

  if (posTxns.length === 0) {
    console.log('   ❌ No match in pos2013_transactions.');
  } else {
    console.log(`   ✅ Found ${posTxns.length} candidate(s). Top match:`);
    const t = posTxns[0];
    const amtMajor = cents(t.amount_minor);
    console.log('');
    Object.entries(t).forEach(([k,v]) => {
      let sv = String(v ?? '');
      if (sv.length > 100) sv = sv.slice(0,100) + '…';
      console.log(`      ${k.padEnd(22)} = ${sv}`);
    });
    console.log('');
    console.log(`      💸 Parsed amount     : ${$(amtMajor)} ${t.currency}  (amount_minor=${t.amount_minor} ÷ 100)`);
    console.log(`      PAN masked          : ${t.pan_masked}  (last4 match ${PAN4}? → ${t.pan_masked?.endsWith(PAN4) || t.pan_masked?.slice(-4) === PAN4 ? '✅ YES' : '❌ NO'})`);
    console.log(`      Entry mode          : ${t.entry_mode}  (MANUAL/MOTO expected)`);
    console.log(`      Auth mode           : ${t.auth_mode}  (ONLINE_APPROVED expected)`);
    console.log(`      Txn status          : ${t.status}`);
    console.log(`      Linked batch_id     : ${t.batch_id}`);
    console.log(`      Created At          : ${t.created_at}`);

    const fact = amtMajor === 50_000_000_000;
    if (fact) {
      console.log(`\n   ⚠️⚠️⚠️  AMOUNT ALERT: pos2013_transactions stores EXACTLY $50,000,000,000.00 USD`);
      console.log('      This is 50 BILLION in a single MOTO charge — impossible via standard card network rails.');
      console.log('      → Field entry had extra zeros (validation missing on amount input screen).');
    } else if (amtMajor > 0) {
      console.log(`\n   ✅ DB Amount = ${$(amtMajor)}. Receipt has extra zeros (printed 50B vs real ${$(amtMajor)}). Factor ~${Math.round(50_000_000_000/Math.max(1,amtMajor))}×`);
    }
  }

  // ── 2) Find in offline_funds_receipts (stan match, amount_minor)
  console.log('\n▌ 2/8: offline_funds_receipts table (actual printed receipt payload)');
  const of1 = one(`SELECT * FROM offline_funds_receipts WHERE stan=? AND merchant_id=? ORDER BY created_at DESC LIMIT 1`, [STAN, MERCHANT_ID]);
  const of2 = q(`SELECT * FROM offline_funds_receipts WHERE transaction_id IN (?,?) OR merchant_id=? ORDER BY created_at DESC LIMIT 3`, [TXN_ID, TXN_ID.replace('txn_',''), MERCHANT_ID]);
  const ofRows = [of1,...of2].filter(Boolean).filter((r,i,a) => a.findIndex(x => x.id === r.id) === i);
  if (ofRows.length === 0) {
    console.log('   ❌ No receipt rows match (no row with STAN=' + STAN + ' or txn_id=' + TXN_ID + ').');
  } else {
    ofRows.forEach((r,i) => {
      console.log(`   Receipt row #${i+1}: id=${r.id}  stan=${r.stan}  amt_minor=${r.amount_minor} (${$(cents(r.amount_minor))} ${r.currency})  status=${r.status}  synced_at=${r.synced_at}  txn_id=${r.transaction_id}  created=${r.created_at}`);
      if (r.receipt_payload) {
        try {
          const p = typeof r.receipt_payload === 'string' ? JSON.parse(r.receipt_payload) : r.receipt_payload;
          console.log(`     payload keys: ${Object.keys(p||{}).slice(0,10).join(', ')}`);
          ['settlement','settlement_code','settlement_ref','amount','auth_code','entry_mode','card_last4'].forEach(k => {
            if (p?.[k] !== undefined) console.log(`       payload.${k} = ${JSON.stringify(p[k]).slice(0,80)}`);
          });
        } catch(_) {
          console.log(`     receipt_payload (raw, first 300): ${String(r.receipt_payload).slice(0,300)}`);
        }
      }
    });
  }

  // ── 3) Find in receipts table (719 rows — BLOB storage of the exact receipt you hold)
  console.log('\n▌ 3/8: receipts table (719 rows — find matching receipt_data for STAN/settlement 375145)');
  const recs = q(`SELECT * FROM receipts WHERE merchant_id=? AND (transaction_id=? OR receipt_id LIKE '%${STAN}%' OR receipt_id LIKE '%${SETTLEMENT_REF}%') ORDER BY generated_at DESC LIMIT 5`,
    [MERCHANT_ID, TXN_ID]);
  // Also search receipt_data LIKE via SQL instr — 719 rows, so scan
  const allRecs = q(`SELECT id, receipt_id, transaction_id, generated_at, receipt_data FROM receipts WHERE merchant_id=? ORDER BY generated_at DESC LIMIT 100`, [MERCHANT_ID]);
  const hitRecs = recs.slice();
  for (const r of allRecs) {
    const d = String(r.receipt_data || '');
    if (d.includes(SETTLEMENT_REF) || d.includes(STAN) || d.includes(TXN_ID) || d.includes(PAN4)) {
      if (!hitRecs.find(x => x.id === r.id)) hitRecs.push(r);
    }
  }
  if (hitRecs.length === 0) console.log('   ❌ No receipts match the STAN / settlement / txn ID.');
  else {
    console.log(`   ✅ Found ${hitRecs.length} receipt DB rows that match the paper slip identifiers.`);
    hitRecs.forEach((r,i) => {
      const d = String(r.receipt_data || '');
      const matchSummary = [
        d.includes(SETTLEMENT_REF) ? `Settlement=${SETTLEMENT_REF}` : null,
        d.includes(STAN) ? `STAN=${STAN}` : null,
        d.includes(TXN_ID.slice(0,20)) ? `TxnId=match` : null,
        d.includes(`**** **** **** ${PAN4}`) ? `Card4=${PAN4}` : null,
      ].filter(Boolean).join(', ');
      console.log(`     [${i+1}] id=${r.id}  receipt_id=${r.receipt_id}  txn_id=${r.transaction_id}  generated=${r.generated_at}  matches=(${matchSummary})`);
      // Extract amount from receipt_data with regex
      const amtM = d.match(/Amount\s*[:]\s*[\$]?([0-9][0-9,]*\.?\d*)\s*(USD)?/i) || d.match(/\$([0-9][0-9,]*\.\d{2})\s*USD/);
      if (amtM) console.log(`        Amount in DB receipt data = ${amtM[0]}`);
      const statusM = d.match(/Status\s*[:]\s*([A-Z_]+)/);
      if (statusM) console.log(`        Status   = ${statusM[1]}`);
      const settleM = d.match(/Settlement\s*[:]\s*([A-Z0-9]+)/i);
      if (settleM) console.log(`        SettlRef = ${settleM[1]}`);
    });
  }

  // ── 4) pos2013_batches — settlement_code = 375145?
  console.log('\n▌ 4/8: pos2013_batches (find batch with settlement_code=375145)');
  const b1 = one(`SELECT * FROM pos2013_batches WHERE settlement_code = ? OR batch_id = ? OR id = ? ORDER BY rowid DESC LIMIT 1`, [SETTLEMENT_REF, SETTLEMENT_REF, SETTLEMENT_REF]);
  let batch = b1;
  if (!batch && posTxns[0]?.batch_id) {
    batch = one(`SELECT * FROM pos2013_batches WHERE id = ? OR batch_id = ? LIMIT 1`, [posTxns[0].batch_id, posTxns[0].batch_id]);
  }
  if (!batch) {
    const lastBatches = q(`SELECT * FROM pos2013_batches WHERE merchant_id=? ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]);
    console.log(`   ℹ️  No direct settlement 375145. Last 5 batches:`);
    lastBatches.forEach(b => console.log(`     • id=${b.id}  batch_id=${b.batch_id}  settlement_code=${b.settlement_code}  status=${b.status}  total=${$(cents(b.total_amount_minor))}  txns=${b.txn_count}  created=${b.created_at}`));
    if (lastBatches.length) batch = lastBatches[0];
  }
  if (batch) {
    console.log(`   ✅ Batch found:`);
    Object.entries(batch).forEach(([k,v]) => {
      if (k === 'batch_file' || k === 'signature') {
        console.log(`      ${k.padEnd(22)} = (${String(v||'').length} bytes / BLOB)`);
      } else {
        const sv = String(v ?? ''); if (sv.length > 120) sv = sv.slice(0,120)+'…';
        console.log(`      ${k.padEnd(22)} = ${sv}`);
      }
    });
    if (batch.settlement_code === SETTLEMENT_REF) {
      console.log(`   ✅✅✅ settlement_code EXACTLY MATCHES 375145 — this is the processor settlement for the slip.`);
    }
  } else {
    console.log(`   ❌ No batch anywhere — forensic RED FLAG.`);
  }

  // ── 5) transaction_settlements (processor settlement linkage)
  console.log('\n▌ 5/8: transaction_settlements (processor settlement status per txn)');
  let ts = [];
  if (posTxns[0]?.id) ts = q(`SELECT * FROM transaction_settlements WHERE transaction_id IN (?, ?, ?) ORDER BY rowid DESC`, [TXN_ID, posTxns[0].id, posTxns[0].local_txn_id]);
  if (ts.length === 0 && batch?.id) ts = q(`SELECT * FROM transaction_settlements WHERE merchant_id=? ORDER BY settled_at DESC LIMIT 5`, [MERCHANT_ID]);
  if (ts.length === 0) console.log('   ❌ No transaction_settlements rows.');
  else {
    ts.forEach((t,i) => console.log(`   [${i+1}] id=${t.id}  txn_id=${t.transaction_id}  gross=${$(t.gross_amount)}  fee=${$(t.fee_amount)}  net=${$(t.net_amount)}  status=${t.status}  settled_at=${t.settled_at}`));
  }

  // ── 6) merchant_pos_settlements (ledger linkage record per pos settlement)
  console.log('\n▌ 6/8: merchant_pos_settlements (POS → ledger bridge)');
  const mps = q(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]);
  if (mps.length === 0) console.log('   ❌ No merchant_pos_settlements rows.');
  else {
    mps.forEach((s,i) => console.log(`   [${i+1}] id=${s.id}  ledger_entry_id=${s.ledger_entry_id}  amount=${$(s.amount)} ${s.currency}  status=${s.status}  settled_at=${s.settled_at}  meta=${String(s.meta||'').slice(0,80)}`));
  }

  // ── 7) wallet + ledger CREDIT trace
  console.log('\n▌ 7/8: merchant_wallets + ledger_entries — did money land in USD wallet?');
  const wal = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID]);
  console.log(`   USD Wallet denormalized balance : ${$(wal?.balance)}  (wallet_id=${wal?.id})`);
  const expectedMajor = posTxns[0] ? cents(posTxns[0].amount_minor) : 50_000_000_000;
  console.log(`   Expected credit amount (from pos row) = ${$(expectedMajor)} USD`);

  const Lmatches = [];
  // 7a) ledger by transaction_id (POS local_txn_id, pos_id, TXN_ID)
  const idsToTry = [TXN_ID, posTxns[0]?.id, posTxns[0]?.local_txn_id, batch?.id, batch?.batch_id, SETTLEMENT_REF].filter(Boolean);
  for (const idv of idsToTry) {
    const rows = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND (transaction_id=? OR reference=? OR source_reference=?)`, [MERCHANT_ID, idv, idv, idv]);
    rows.forEach(r => Lmatches.push(r));
  }
  // 7b) by amount match (credit side only, NET settled)
  const amtRows = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID, expectedMajor]);
  amtRows.forEach(r => Lmatches.push(r));
  const Lseen = new Set();
  const Ledger = Lmatches.filter(l => { if (Lseen.has(l.id)) return false; Lseen.add(l.id); return true; });
  if (Ledger.length === 0) {
    console.log(`   ❌ NO ledger CREDIT entries match the POS transaction or amount ${$(expectedMajor)}.`);
    console.log(`      → Funds NOT credited (not AUTHORIZED, not CAPTURED, not SETTLED).`);
  } else {
    console.log(`   ✅ ${Ledger.length} ledger candidate row(s):`);
    Ledger.forEach((l,i) => {
      const term = l.status === 'SETTLED' ? ' (💸 IRREVERSIBLE → REAL MONEY IN ✅✅✅)'
                 : l.status === 'CAPTURED' ? ' (🟡 captured — awaiting settlement batch)'
                 : l.status === 'AUTHORIZED' ? ' (🟡 authorized only — can be voided!)'
                 : ` (${l.status})`;
      console.log(`     [${i+1}] id=${l.id}  type=${l.type}  status=${l.status}${term}`);
      console.log(`          amount=${$(l.amount)} ${l.currency}  src=${l.source_type}  src_ref=${l.source_reference?.slice(0,40)}`);
      console.log(`          txn_id=${l.transaction_id}  ref=${l.reference}  created=${l.created_at}`);
      console.log(`          desc: ${String(l.description||'').slice(0,120)}`);
    });
  }

  // 7c) Wallet journal — matching CREDIT
  console.log(`\n   merchant_wallet_transactions (journal):`);
  const jrn = q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit'
    AND (reference IN (${idsToTry.map(()=>'?').join(',')}) OR ABS(amount - ?) < 0.01)
    ORDER BY created_at DESC LIMIT 5`,
    [wal.id, ...idsToTry, expectedMajor]);
  if (jrn.length === 0) {
    console.log(`   ❌ NO wallet journal CREDIT row — denormalized balance SKIPPED (no +$ in wallet display).`);
  } else {
    jrn.forEach((j,i) => console.log(`     [${i+1}] id=${j.id}  amount=${$(j.amount)}  source=${j.source}  ref=${j.reference?.slice(0,40)}  created=${j.created_at}`));
  }

  // ── 8) FINAL VERDICT
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('📊 FINAL VERDICT (Forensic 8-Way Match)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const dbTxnExists = posTxns.length > 0;
  const receiptPersisted = hitRecs.length > 0 || ofRows.length > 0;
  const batchWithSettlement = batch && (batch.settlement_code === SETTLEMENT_REF);
  const ledgerSettled = Ledger.some(l => l.type === 'credit' && l.status === 'SETTLED');
  const ledgerAuth = Ledger.some(l => l.type === 'credit' && (l.status === 'AUTHORIZED' || l.status === 'CAPTURED'));
  const journalCredit = jrn.length > 0;
  const amt50B = posTxns.some(t => cents(t.amount_minor) === 50_000_000_000);

  console.log(`\n   1. POS txn persisted (pos2013_transactions)?   : ${dbTxnExists ? '✅ YES  id='+posTxns[0]?.id.slice(0,24) : '❌ NO'}`);
  console.log(`   2. Receipt persisted (receipts / offline_funds)? : ${receiptPersisted ? '✅ YES — '+hitRecs.length+' receipts rows + '+ofRows.length+' offline rows' : '❌ NO — printed slip has NO DB copy'}`);
  console.log(`   3. Batch settlement_code = 375145?              : ${batchWithSettlement ? '✅✅✅ EXACT MATCH — processor settlement linked' : (batch?.settlement_code ? `🟡 NO — batch has settlement_code=${batch.settlement_code}` : '❌ NO — no batch')}`);
  console.log(`   4. Ledger: REAL CREDIT SETTLED?                 : ${ledgerSettled ? '✅✅✅ YES — funds are irreversibly SETTLED in double-entry ledger' : (ledgerAuth ? '🟡 only AUTHORIZED/CAPTURED (not yet settled — may still void)' : '❌ NO ledger credit at all')}`);
  console.log(`   5. Wallet journal CREDIT row?                   : ${journalCredit ? '✅ YES — display balance incremented' : '❌ NO — merchant dashboard will NOT show this money'}`);
  console.log(`   6. $50B amount sanity                           : ${amt50B ? '⚠️  DANGER — DB stores EXACTLY 50 BILLION USD (extra zeros in entry field! Validate / fix required.)' : '✅ DB amount sane (no 50B spike). Printed receipt had extra zeros.'}`);
  console.log(`   7. Actual amount credited (if any)              : ${Ledger.filter(l=>l.type==='credit').length>0?$(Ledger.find(l=>l.type==='credit').amount):(posTxns[0]?$(cents(posTxns[0].amount_minor))+' (POS row only, not in ledger)':'UNKNOWN — no rows at all')}`);
  console.log(`   8. Current USD dashboard balance                : ${$(wal?.balance)}`);

  console.log('');
  const FUNDS_REAL = ledgerSettled && journalCredit && batchWithSettlement;
  const FUNDS_PARTIAL = (ledgerSettled || ledgerAuth) && !FUNDS_REAL;
  const NOTHING = !dbTxnExists && !receiptPersisted;

  if (FUNDS_REAL) {
    console.log('🟢🟢🟢  VERDICT: REAL FUNDS ARE CREDITED — SETTLED — AVAILABLE FOR INVESTOR RECORD.');
    console.log(`      The correct amount of ${$(Ledger.find(l=>l.type==='credit').amount)} USD is irreversibly settled in the ledger,`);
    console.log(`      journaled, batched to processor settlement 375145, and reflected on wallet display.`);
    if (amt50B) {
      console.log(`\n      ⚠️  CRITICAL AMOUNT ALERT: credited amount is EXACTLY 50 BILLION USD.`);
      console.log(`      This MUST be reversed to the real investor deposit amount BEFORE any withdrawals.`);
    }
  } else if (FUNDS_PARTIAL) {
    console.log('🟡🟡  VERDICT: PARTIAL. Processor settlement 375145 may have pulled funds off-system,');
    console.log('      but the ledger/journal handoff on THIS system has not completed fully.');
    console.log('      ACTION: (a) Confirm processor dashboard shows settlement 375145 as captured.');
    console.log('              (b) Re-run POS batch settlement sync endpoint to finish credit into wallet.');
    if (amt50B) console.log('              (c) Fix $50B entry-field typo BEFORE syncing.');
  } else if (NOTHING) {
    console.log('🔴🔴🔴  VERDICT: NOT CREDITED.');
    console.log('      The printed slip is the ONLY record. There is NO transaction, NO receipt,');
    console.log('      NO batch, NO ledger, NO journal inside the POS database.');
    console.log('');
    console.log('      POSSIBLE SCENARIOS:');
    console.log('      • POS terminal application crashed right after printing (no DB write survived).');
    console.log('      • Transaction was run in DEMO / TRAINING mode and never hit the real database.');
    console.log('      • Slip was printed from a DIFFERENT merchant_id / terminal than MRC-1001.');
    console.log('      • Amount field had extra zeros in entry screen → 50B is wrong; real amount never saved.');
    console.log('      • Settlement 375145 lives ONLY in the processor side — never pushed back to POS.');
    console.log('');
    console.log('      ACTIONS TO UNLOCK:');
    console.log('      1. Call investor/cardholder directly → "Has your card actually been charged for the deposit?" Get their bank auth / trace number.');
    console.log('      2. Call processor → settlement 375145 report. Ask: gross amount, auth code, card last 4.');
    console.log('      3. If processor confirms REAL charge of $X amount: we can manually re-insert a validated txn row, batch row, SETTLED ledger CREDIT, and wallet journal → funds land in wallet today.');
    console.log('      4. If processor shows NO charge: the slip is invalid. The investor has NOT paid — do not count it.');
  } else {
    console.log('🟡🟡  VERDICT: MIXED / INCONSISTENT — forensic mismatch between layers.');
    console.log('   The printed receipt, pos_transaction table, batch, ledger, and wallet journal disagree in at least 1 layer. Need processor-side confirmation before accepting this deposit as valid.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
})().catch(e => { console.error('\n❌ FATAL:', e); process.exit(1); });
