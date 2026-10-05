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
    } catch(e){ console.error('SQL ERR:',e.message); return []; }
  };
  const one = (sql,p=[]) => q(sql,p)[0];

  // ── Print schemas for key tables
  console.log('═══ SCHEMA: pos2013_transactions ═══');
  const pragma = q(`PRAGMA table_info(pos2013_transactions)`);
  pragma.forEach(c => console.log(`  ${c.cid}. ${c.name} ${c.type} ${c.notnull?'NOT NULL':''} ${c.dflt_value||''}`));

  console.log('\n═══ SCHEMA: pos2013_batches ═══');
  q(`PRAGMA table_info(pos2013_batches)`).forEach(c => console.log(`  ${c.cid}. ${c.name} ${c.type}`));

  console.log('\n═══ SCHEMA: transaction_settlements ═══');
  q(`PRAGMA table_info(transaction_settlements)`).forEach(c => console.log(`  ${c.cid}. ${c.name} ${c.type}`));

  // ── Dump all rows from pos2013_transactions (only 8 rows)
  console.log('\n═══ ALL pos2013_transactions (8 rows max) ═══');
  const allPos = q(`SELECT * FROM pos2013_transactions ORDER BY created_at DESC`);
  allPos.forEach((t,i) => {
    console.log(`\n[${i+1}] id=${t.id?.slice(0,40)??'—'}`);
    console.log(`    local_txn_id : ${t.local_txn_id}`);
    console.log(`    merchant_id  : ${t.merchant_id}  terminal: ${t.terminal_id}`);
    console.log(`    batch_id     : ${t.batch_id}`);
    console.log(`    stan         : ${t.stan}`);
    console.log(`    amount_minor : ${t.amount_minor}  → ${$(cents(t.amount_minor))} ${t.currency}`);
    console.log(`    pan_masked   : ${t.pan_masked}`);
    console.log(`    txn_type     : ${t.txn_type}  entry_mode: ${t.entry_mode}  auth_mode: ${t.auth_mode}`);
    console.log(`    status       : ${t.status}`);
    console.log(`    auth_code    : ${t.auth_code}  processor_ref: ${t.processor_reference}`);
    console.log(`    card_brand   : ${t.card_brand}  reader_source: ${t.reader_source}`);
    console.log(`    created_at   : ${t.created_at}  settled_at: ${t.settled_at}`);
    console.log(`    response_payload: ${String(t.response_payload||'').slice(0,200)}`);
    if (t.meta) console.log(`    meta         : ${String(t.meta||'').slice(0,200)}`);
  });

  // ── Dump all pos2013_batches
  console.log('\n═══ ALL pos2013_batches (8 rows max) ═══');
  const allB = q(`SELECT * FROM pos2013_batches ORDER BY created_at DESC`);
  allB.forEach((b,i) => {
    console.log(`\n[${i+1}] id=${b.id}`);
    console.log(`    batch_id          : ${b.batch_id}`);
    console.log(`    merchant_id       : ${b.merchant_id}  terminal: ${b.terminal_id}`);
    console.log(`    settlement_code   : ${b.settlement_code}`);
    console.log(`    status            : ${b.status}`);
    console.log(`    txn_count         : ${b.txn_count}`);
    console.log(`    total_amount_minor: ${b.total_amount_minor}  → ${$(cents(b.total_amount_minor))}`);
    console.log(`    nonce             : ${b.nonce}`);
    console.log(`    signature len     : ${String(b.signature||'').length}`);
    console.log(`    created_at        : ${b.created_at}`);
  });

  // ── Dump all transaction_settlements
  console.log('\n═══ ALL transaction_settlements ═══');
  q(`SELECT * FROM transaction_settlements ORDER BY settled_at DESC`).forEach((t,i) => {
    console.log(`[${i+1}] id=${t.id}  txn_id=${t.transaction_id?.slice(0,30)??'—'}`);
    console.log(`    gross=${$(t.gross_amount)}  fee=${$(t.fee_amount)}  net=${$(t.net_amount)} ${t.currency}`);
    console.log(`    status=${t.status}  settled_at=${t.settled_at}`);
  });

  // ── Dump all merchant_pos_settlements
  console.log('\n═══ ALL merchant_pos_settlements (MRC-1001) ═══');
  q(`SELECT * FROM merchant_pos_settlements WHERE merchant_id=? ORDER BY created_at DESC`, [MERCHANT_ID]).forEach((s,i) => {
    console.log(`[${i+1}] id=${s.id}  ledger_entry_id=${s.ledger_entry_id}`);
    console.log(`    amount=${$(s.amount)} ${s.currency}  status=${s.status}  settled_at=${s.settled_at}`);
    console.log(`    meta=${String(s.meta||'').slice(0,150)}`);
  });

  // ── Search in 719 receipts for SETTLEMENT_REF / STAN / PAN4 / TXN_ID
  console.log('\n═══ receipts table MATCHES (scanning 719 rows) ═══');
  const allR = q(`SELECT id, receipt_id, transaction_id, generated_at, receipt_data FROM receipts WHERE merchant_id=? ORDER BY generated_at DESC LIMIT 200`, [MERCHANT_ID]);
  const hits = [];
  for (const r of allR) {
    const d = String(r.receipt_data || '');
    if (d.includes(SETTLEMENT_REF) || d.includes(STAN) || d.includes(TXN_ID.slice(0,16)) || d.includes(`**** **** **** ${PAN4}`) || d.includes(TXN_ID)) {
      hits.push(r);
    }
  }
  if (hits.length === 0) {
    console.log('  ❌ NO receipts match settlement/STAN/txnid/card4');
    console.log('  (Printed receipt payload is not among last 200 receipts.)');
    // print last 3 receipts to show format
    const last3 = q(`SELECT id, receipt_id, transaction_id, generated_at, receipt_data FROM receipts WHERE merchant_id=? ORDER BY generated_at DESC LIMIT 3`, [MERCHANT_ID]);
    console.log('  Last 3 receipts sample:');
    last3.forEach((r,i) => {
      const d = String(r.receipt_data || '');
      const amtM = d.match(/Amount\s*[:]\s*[\$]?([0-9][0-9,]*\.?\d*)/i) || d.match(/\$([0-9][0-9,]*\.\d{2})/);
      const stM = d.match(/Status\s*[:]\s*([A-Z_]+)/);
      const setM = d.match(/Settlement\s*[:]\s*([A-Z0-9]+)/i);
      console.log(`    [${i+1}] id=${r.id}  txn=${r.transaction_id?.slice(0,28)??'—'}  gen=${r.generated_at}`);
      console.log(`         Amt=${amtM?.[0]||'?'}  Status=${stM?.[1]||'?'}  SettlRef=${setM?.[1]||'?'}`);
      console.log(`         receipt_data first 250: ${d.slice(0,250)}`);
    });
  } else {
    hits.forEach((r,i) => {
      const d = String(r.receipt_data || '');
      const summary = [
        d.includes(SETTLEMENT_REF) ? `Settlement=${SETTLEMENT_REF}` : null,
        d.includes(STAN) ? `STAN=${STAN}` : null,
        d.includes(TXN_ID.slice(0,16)) ? `TxnId~match` : null,
        d.includes(`**** **** **** ${PAN4}`) ? `Card4=${PAN4}` : null,
      ].filter(Boolean).join(', ');
      console.log(`  [${i+1}] id=${r.id}  receipt_id=${r.receipt_id}  txn_id=${r.transaction_id}  gen=${r.generated_at}  matches=(${summary})`);
      const amtM = d.match(/Amount\s*[:]\s*[\$]?([0-9][0-9,]*\.?\d*)/i) || d.match(/\$([0-9][0-9,]*\.\d{2})/);
      const stM = d.match(/Status\s*[:]\s*([A-Z_]+)/);
      const setM = d.match(/Settlement\s*[:]\s*([A-Z0-9]+)/i);
      console.log(`       Amt=${amtM?.[0]||'?'}  Status=${stM?.[1]||'?'}  SettlRef=${setM?.[1]||'?'}`);
      console.log(`       Full receipt (first 1200 chars):\n${d.slice(0,1200)}`);
    });
  }

  // ── offline_funds_receipts
  console.log('\n═══ offline_funds_receipts (STAN match) ═══');
  const ofr = q(`SELECT * FROM offline_funds_receipts WHERE merchant_id=? ORDER BY created_at DESC`, [MERCHANT_ID]);
  ofr.forEach((r,i) => {
    const isMatch = r.stan === STAN || (r.transaction_id && (r.transaction_id.includes(TXN_ID) || TXN_ID.includes(r.transaction_id)));
    console.log(`[${i+1}] id=${r.id}  stan=${r.stan}  amt_minor=${r.amount_minor} (${$(cents(r.amount_minor))})  txn_id=${r.transaction_id}  status=${r.status}  created=${r.created_at}  ${isMatch?'✅MATCH':'—'}`);
    if (isMatch && r.receipt_payload) {
      const p = typeof r.receipt_payload === 'string' ? JSON.parse(r.receipt_payload) : r.receipt_payload;
      console.log(`     payload keys: ${Object.keys(p||{}).slice(0,15).join(', ')}`);
      Object.entries(p||{}).forEach(([k,v]) => {
        if (String(v).length < 200) console.log(`       ${k} = ${JSON.stringify(v)}`);
      });
    }
  });

  // ── Ledger entries (MRC-1001 USD)
  console.log('\n═══ ledger_entries — ALL CREDIT rows for MRC-1001 USD ═══');
  const L = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' ORDER BY created_at DESC`, [MERCHANT_ID]);
  L.forEach((l,i) => {
    const term = l.status === 'SETTLED' ? ' (💸 SETTLED — real money in)'
               : l.status === 'CAPTURED' ? ' (🟡 captured)'
               : l.status === 'AUTHORIZED' ? ' (🟡 authorized only — can void)'
               : '';
    console.log(`[${i+1}] id=${l.id}  amount=${$(l.amount)}  status=${l.status}${term}`);
    console.log(`    src=${l.source_type}  src_ref=${l.source_reference?.slice(0,50)??'—'}`);
    console.log(`    txn_id=${l.transaction_id?.slice(0,50)??'—'}  ref=${l.reference?.slice(0,50)??'—'}`);
    console.log(`    desc=${String(l.description||'').slice(0,120)}`);
    console.log(`    created=${l.created_at}`);
  });
  console.log(`\n═══ Total credit by status (MRC-1001 USD) ═══`);
  const byStatus = q(`SELECT status, SUM(amount) as sum_amt, COUNT(*) as n FROM ledger_entries WHERE merchant_id=? AND currency='USD' AND type='credit' GROUP BY status`, [MERCHANT_ID]);
  byStatus.forEach(r => console.log(`  status=${r.status}  count=${r.n}  total=${$(r.sum_amt)}`));

  // ── Wallet balance + journal
  console.log('\n═══ merchant_wallets ═══');
  q(`SELECT * FROM merchant_wallets WHERE merchant_id=?`, [MERCHANT_ID]).forEach(w => {
    console.log(`  id=${w.id}  currency=${w.currency}  balance=${$(w.balance)}  created=${w.created_at}`);
  });

  console.log('\n═══ merchant_wallet_transactions — last 10 CREDIT rows (MRC-1001) ═══');
  const walId = one(`SELECT id FROM merchant_wallets WHERE merchant_id=? AND currency='USD'`, [MERCHANT_ID])?.id;
  q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND type='credit' ORDER BY created_at DESC LIMIT 10`, [walId||-1]).forEach((j,i) => {
    console.log(`[${i+1}] id=${j.id}  amount=${$(j.amount)}  source=${j.source}  ref=${j.reference?.slice(0,50)??'—'}`);
    console.log(`    desc=${String(j.description||'').slice(0,100)}  created=${j.created_at}`);
  });

  // ── Summary verdict blurbs
  console.log('\n\n═══ FORENSIC SUMMARY ═══');
  const posWithStan = allPos.find(t => t.stan === STAN);
  const posWithCard4 = allPos.find(t => t.pan_masked?.endsWith(PAN4) || t.pan_masked?.slice(-4) === PAN4);
  const has50BPos = allPos.some(t => cents(t.amount_minor) === 50_000_000_000);
  const batchWith375145 = allB.find(b => b.settlement_code === SETTLEMENT_REF || String(b.batch_id||'').includes(SETTLEMENT_REF));
  const ledgerWith50B = L.find(l => l.amount === 50_000_000_000);
  const ledgerSettled = L.some(l => l.status === 'SETTLED');

  console.log(`  1. pos2013_transactions with STAN=${STAN}              → ${posWithStan ? '✅ FOUND id='+posWithStan.id.slice(0,24)+' amt='+$(cents(posWithStan.amount_minor)) : '❌ NOT FOUND'}`);
  console.log(`  2. pos2013_transactions with PAN ****4643              → ${posWithCard4 ? '✅ FOUND amt='+$(cents(posWithCard4.amount_minor))+' status='+posWithCard4.status : '❌ NOT FOUND'}`);
  console.log(`  3. DB stores EXACT $50,000,000,000.00 (extra zeros?)   → ${has50BPos ? '⚠️  YES — AMOUNT SANITY FAIL' : '✅ NO — amount sane'}`);
  console.log(`  4. pos2013_batches with settlement_code=${SETTLEMENT_REF} → ${batchWith375145 ? '✅✅✅ FOUND id='+batchWith375145.id+' status='+batchWith375145.status+' total='+$(cents(batchWith375145.total_amount_minor)) : '❌ NOT FOUND'}`);
  console.log(`  5. Receipt DB row matches slip (settlement/STAN/card4) → ${hits.length>0 ? '✅ '+hits.length+' ROWS' : '❌ NO — printed slip only'}`);
  console.log(`  6. Ledger: CREDIT $50B row exists?                     → ${ledgerWith50B ? '⚠️  YES — $50B in ledger! Fix required.' : '✅ NO'}`);
  console.log(`  7. Ledger: ANY SETTLED credit USD rows MRC-1001?       → ${ledgerSettled ? '✅ YES — total settled credits='+$(byStatus.find(s=>s.status==='SETTLED')?.sum_amt||0) : '❌ NO — nothing settled'}`);
  console.log(`  8. Receipt printed matches any DB row?                 → ${(posWithStan||posWithCard4||hits.length>0) ? '🟡 PARTIAL — check above' : '🔴 NO — forensic mismatch!'}`);

})().catch(e => { console.error('\n❌ FATAL:', e); process.exit(1); });
