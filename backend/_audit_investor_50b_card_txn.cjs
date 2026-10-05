const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const TXN_ID = 'txn_1788881192522_2nwzrxhda';
const SETTLEMENT_REF = '375145';
const STAN = '000012';
const MERCHANT_ID = 'MRC-1001';
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
  });
  if (!fs.existsSync(DB_PATH)) { console.log('!no db'); process.exit(1); }
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
  console.log('🔍 FORENSIC TRANSACTION AUDIT');
  console.log('   Txn ID      :', TXN_ID);
  console.log('   STAN        :', STAN);
  console.log('   Settlement  :', SETTLEMENT_REF);
  console.log('   Merchant    :', MERCHANT_ID);
  console.log('   Date (receipt): 9/8/2026 7:26:32 PM  (local)');
  console.log('   Receipt Amt : $50,000,000,000.00 USD  (⚠️ 50 BILLION — sanity check)');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // ── 1) Find the POS transaction
  console.log('\n▌ Step 1: transactions table — exact Txn ID');
  const t1 = one(`SELECT * FROM transactions WHERE id = ?`, [TXN_ID]);
  const t2 = one(`SELECT * FROM transactions WHERE stan = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 1`, [STAN, MERCHANT_ID]);
  const t3 = one(`SELECT * FROM transactions WHERE settlement_reference = ? OR JSON_EXTRACT(meta, '$.settlement') = ? OR JSON_EXTRACT(meta, '$.settlement_ref') = ? ORDER BY created_at DESC LIMIT 1`,
    [SETTLEMENT_REF, SETTLEMENT_REF, SETTLEMENT_REF]);
  const tAll = [t1, t2, t3].filter(Boolean);
  // De-duplicate
  const seen = new Set();
  const txns = tAll.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  // Also look for any transaction with amount >= 50M (or $50B)
  const tBig = q(`SELECT * FROM transactions WHERE merchant_id=? AND amount >= 50000000 ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]);
  if (txns.length === 0) {
    console.log('   ❌ No exact match for TXN_ID / STAN / Settlement ref.');
    console.log('   ℹ️  Looking for any recent MOTO transaction from MRC-1001...');
    const recent = q(`SELECT * FROM transactions WHERE merchant_id=? AND (entry_mode='MANUAL' OR entry_mode='MOTO' OR card_present=0) ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]);
    if (recent.length) {
      console.log('   ℹ️  Recent MOTO/MANUAL txns found:');
      recent.forEach(r => console.log(`     • ${r.id.slice(0,24)}…  amt=${$(r.amount)}  stan=${r.stan}  status=${r.status}  created=${r.created_at}`));
      // Pick most recent as candidate
      txns.push(recent[0]);
    }
  }
  if (txns.length === 0 && tBig.length) {
    console.log('   ℹ️  Large transactions found (>$50M):');
    tBig.forEach(r => console.log(`     • ${r.id.slice(0,24)}…  amt=${$(r.amount)}  stan=${r.stan}  status=${r.status}  created=${r.created_at}`));
    txns.push(tBig[0]);
  }
  if (txns.length === 0) {
    console.log('\n❌❌❌  NO TRANSACTION FOUND FOR THIS RECEIPT IN THE DATABASE.');
    console.log('   → The $50,000,000,000.00 charge shown on the receipt is NOT persisted in transactions table.');
    console.log('   → Likely causes:');
    console.log('     a) Typo in amount field (extra zeros)');
    console.log('     b) Demo/test-mode receipt that never persisted');
    console.log('     c) Transaction ID mismatch (new receipt, wrong txn_id printed)');
    console.log('     d) MOTO entry-mode screen crash after print (no DB commit)');
    console.log('');
    console.log('   Run this to check last 50 txns for MRC-1001:');
    console.log('   SELECT id, amount, stan, status, entry_mode, created_at FROM transactions');
    console.log('   WHERE merchant_id = "MRC-1001" ORDER BY created_at DESC LIMIT 50;');
    process.exit(0);
  }

  console.log(`   ✅ Found ${txns.length} matching transaction row(s):`);
  txns.forEach((t,i) => {
    console.log(`\n   [${i+1}]  id              : ${t.id}`);
    console.log(`        amount          : ${$(t.amount)} ${t.currency}`);
    console.log(`        status          : ${t.status}`);
    console.log(`        stan            : ${t.stan}`);
    console.log(`        batch_id        : ${t.batch_id}`);
    console.log(`        settlement_ref  : ${t.settlement_reference || (t.meta?JSON.stringify(JSON.parse(t.meta||'{}').settlement||JSON.parse(t.meta||'{}').settlement_ref||'—'):'—')}`);
    console.log(`        entry_mode      : ${t.entry_mode}`);
    console.log(`        auth_code       : ${t.auth_code}`);
    console.log(`        card_last4      : ${t.card_last4}`);
    console.log(`        created_at      : ${t.created_at}`);
  });

  const txn = txns[0];

  // ── 2) Trace settlement_ref 375145 → batches
  console.log('\n▌ Step 2: batches table — settlement reference 375145');
  let batch = txn.batch_id ? one(`SELECT * FROM batches WHERE id = ?`, [txn.batch_id]) : null;
  if (!batch) {
    // try settlement_reference
    batch = one(`SELECT * FROM batches WHERE id LIKE ? OR settlement_reference = ? OR JSON_EXTRACT(meta,'$.settlement')=? ORDER BY created_at DESC LIMIT 1`,
      [`%${SETTLEMENT_REF}%`, SETTLEMENT_REF, SETTLEMENT_REF]);
  }
  if (!batch) {
    console.log('   ⚠️  No batch linked via txn.batch_id. Checking any batch containing ref 375145...');
    const anyBatch = q(`SELECT * FROM batches WHERE merchant_id=? ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]);
    if (anyBatch.length) {
      console.log('   ℹ️  Last 5 batches for MRC-1001:');
      anyBatch.forEach(b => {
        let sref;
        try { sref = JSON.parse(b.meta||'{}').settlement || JSON.parse(b.meta||'{}').settlement_ref || '—'; } catch(_){ sref='—'; }
        console.log(`     • ${b.id.slice(0,20)}…  status=${b.status}  total=${$(b.total_amount)}  settled=${b.settled_total||0}  txns=${b.transaction_count}  sref=${sref}  created=${b.created_at}`);
      });
      batch = anyBatch[0];
    }
  }
  if (batch) {
    console.log(`   ✅ Found batch:`);
    console.log(`        id              : ${batch.id}`);
    console.log(`        status          : ${batch.status}`);
    console.log(`        total_amount    : ${$(batch.total_amount)} ${batch.currency}`);
    console.log(`        settled_total   : ${$(batch.settled_total || 0)} ${batch.currency}`);
    console.log(`        transaction_count: ${batch.transaction_count}`);
    console.log(`        net_amount      : ${$(batch.net_amount || 0)}`);
    console.log(`        fee_total       : ${$(batch.fee_total || 0)}`);
    console.log(`        settlement_date : ${batch.settlement_date || '—'}`);
    console.log(`        payout_ref      : ${batch.payout_reference || '—'}`);
    console.log(`        created_at      : ${batch.created_at}`);
  } else {
    console.log('   ❌ No batch found anywhere. This is a forensic RED FLAG for a non-persisted receipt.');
  }

  // ── 3) Wallet + Ledger: was the EXACT txn amount credited?
  console.log('\n▌ Step 3: Wallet + Ledger credit trace');
  const WAL = one(`SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency=?`, [MERCHANT_ID, txn.currency || 'USD']);
  console.log(`   USD wallet balance (merchant_wallets.denormalized): ${$(WAL?.balance)}`);

  // Look for ledger ENTRY that matches this txn: transaction_id, amount, credit side
  const LmatchTxn = q(`
    SELECT * FROM ledger_entries
    WHERE merchant_id = ? AND currency = ?
      AND (transaction_id = ? OR reference = ? OR source_reference = ?)
    ORDER BY created_at DESC LIMIT 5
  `, [MERCHANT_ID, txn.currency || 'USD', TXN_ID, TXN_ID, TXN_ID]);
  const LmatchAmount = q(`
    SELECT * FROM ledger_entries
    WHERE merchant_id = ? AND currency = ? AND type='credit'
      AND ABS(amount - ?) < 0.01
    ORDER BY created_at DESC LIMIT 5
  `, [MERCHANT_ID, txn.currency || 'USD', Number(txn.amount)]);
  const Lcombos = [...LmatchTxn, ...LmatchAmount];
  const Lseen = new Set();
  const L = Lcombos.filter(l => { if (Lseen.has(l.id)) return false; Lseen.add(l.id); return true; });
  if (L.length === 0) {
    console.log(`   ❌ No ledger entry found for Txn ID ${TXN_ID.slice(0,16)}… or amount ${$(txn.amount)}.`);
    console.log(`   → This means the MRC-1001 USD wallet was NOT credited with this amount (neither AUTHORIZED nor SETTLED).`);
  } else {
    console.log(`   ✅ Found ${L.length} ledger candidate row(s):`);
    L.forEach((l,i) => {
      console.log(`\n     [${i+1}] id=${l.id}`);
      console.log(`          type = ${l.type}  (credit=money in, debit=money out)`);
      console.log(`          amount = ${$(l.amount)} ${l.currency}`);
      console.log(`          status = ${l.status}  (${l.status==='SETTLED'?'💸 REAL MONEY credited irreversibly ✅': l.status==='CAPTURED'?'🟡 Captured — pending settlement batch': l.status==='AUTHORIZED'?'🟡 Auth only — may still be released':'⚠️ '+l.status})`);
      console.log(`          transaction_id = ${l.transaction_id}`);
      console.log(`          reference = ${l.reference}`);
      console.log(`          source_type = ${l.source_type}  source_ref = ${l.source_reference}`);
      console.log(`          description = ${l.description}`);
      console.log(`          created_at = ${l.created_at}`);
    });
  }

  // Journal row (merchant_wallet_transactions) — wallet was incremented only if a journal credit row exists with this amount + reference
  console.log('\n▌ Step 4: merchant_wallet_transactions (wallet journal)');
  const jExact = q(`
    SELECT * FROM merchant_wallet_transactions
    WHERE wallet_id = ? AND type = 'credit'
      AND (reference = ? OR reference = ? OR ABS(amount - ?) < 0.01)
    ORDER BY created_at DESC LIMIT 5
  `, [WAL?.id, TXN_ID, SETTLEMENT_REF, Number(txn.amount)]);
  if (jExact.length === 0) {
    console.log(`   ❌ No wallet journal credit row matching Txn ID or amount ${$(txn.amount)}.`);
    console.log(`   → Denormalized wallet balance update SKIPPED → wallet balance unchanged for this txn.`);
  } else {
    console.log(`   ✅ Found ${jExact.length} journal credit candidate(s):`);
    jExact.forEach((j,i) => {
      console.log(`     [${i+1}] ${j.id}  amount=${$(j.amount)}  source=${j.source}  ref=${j.reference}  created=${j.created_at}`);
    });
  }

  // ── 5) $50B sanity check — if receipt says 50B but DB says something else, flag
  console.log('\n▌ Step 5: AMOUNT SANITY CHECK (50 BILLION USD single MOTO card)');
  const RECEIPT_AMOUNT = 50_000_000_000;
  const DB_AMOUNT = Number(txn.amount || 0);
  const diff = Math.abs(DB_AMOUNT - RECEIPT_AMOUNT);
  if (diff < 0.01) {
    console.log(`   ⚠️⚠️⚠️  DANGER: Database stores EXACTLY $50,000,000,000.00 USD for this single card MOTO charge.`);
    console.log(`     → Normal card limits are < $1M / transaction. This is 50,000× higher.`);
    console.log(`     → Possible scenarios:`);
    console.log(`       a) User typed extra zeros in amount entry (field lacked validation).`);
    console.log(`       b) Test/demo data was NOT cleared before production run.`);
    console.log(`       c) Processor settlement 375145 is for the REAL amount; receipt printer corrupted it.`);
    console.log(`       d) Investor genuinely intended to pay $50B (unlikely — max card network limits prevent this).`);
    console.log(``);
    console.log(`   👉 IF REAL AMOUNT WAS INTENDED TO BE $50M or $500k, the system has credited (if SETTLED)`);
    console.log(`      the WRONG amount and it must be corrected via ledger reversal NOW before withdrawal access.`);
  } else if (DB_AMOUNT > 0) {
    console.log(`   ✅ Receipt amount ($50B) ≠ DB amount (${$(DB_AMOUNT)}). Receipt likely has extra zeros.`);
    console.log(`      DB amount = ${$(DB_AMOUNT)} — plausible single MOTO charge for an investor deposit.`);
    console.log(`      Δ (extra zeros factor) = ~${Math.round(RECEIPT_AMOUNT / Math.max(1, DB_AMOUNT))}×`);
  }

  // ── 6) Final closed-loop verdict
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('📊 FINAL VERDICT');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const dbExists = !!txn && dbExists; // always true at this point
  const ledgerSettled = L.some(l => l.status === 'SETTLED' && l.type === 'credit');
  const ledgerAuthorized = L.some(l => l.status === 'AUTHORIZED' && l.type === 'credit');
  const journalCredit = jExact.length > 0;
  const batchSettled = batch && (batch.status === 'SETTLED' || batch.status === 'COMPLETED' || Number(batch.settled_total||0) > 0);
  console.log('');
  console.log(`   1) Transaction persisted? : ${txn && txn.id ? '✅ YES (row exists)' : '❌ NO (not in DB at all)'}`);
  console.log(`   2) Batch found?           : ${batch ? '✅ YES' : '❌ NO (forensic alert)'}  status=${batch?.status || '—'}`);
  console.log(`   3) Ledger CREDIT?         : ${L.length ? (ledgerSettled?'✅ SETTLED (REAL FUNDS irreversibly credited ✅✅✅)':ledgerAuthorized?'🟡 AUTHORIZED only (may still be voided/reversed)':'⚠️ '+L[0].status) : '❌ NO (no ledger entry)'}`);
  console.log(`   4) Wallet journal CREDIT? : ${journalCredit ? '✅ YES (denormalized wallet balance was incremented)' : '❌ NO (wallet balance NOT incremented — forensic ALERT if ledger exists but journal does NOT)'}`);
  console.log(`   5) Batch SETTLED?         : ${batchSettled ? '✅ YES (settlement 375145 closed)' : '🟡 PENDING / NOT BATCHED'}`);
  console.log(`   6) DB Amount              : ${$(Number(txn.amount||0))}  ${txn.currency || 'USD'}`);
  console.log(`   7) Receipt Amount         : ${$(RECEIPT_AMOUNT)} USD  (Δ factor = ${RECEIPT_AMOUNT/Math.max(1,Number(txn.amount||1)).toFixed(0)}× — ${diff<0.01?'⚠️ MATCH (danger!)':'✅ DIFFERENT (receipt has extra zeros → safe)'}'})`);
  console.log(`   8) Current USD Wallet     : ${$(WAL?.balance)}`);
  console.log('');
  const credited = ledgerSettled && journalCredit && batchSettled;
  const partiallyCredited = (ledgerSettled || ledgerAuthorized) && !batchSettled;
  if (credited) {
    console.log('   🟢🟢🟢  FUNDS CREDITED — SETTLED — AVAILABLE FOR WITHDRAWAL');
    console.log(`      • ${$(Number(txn.amount))} is irreversibly in the USD wallet ledger (SETTLED status = terminal).`);
    console.log(`      • Do a wallet vs ledger NET audit: merchant_wallets.balance SHOULD equal SUM(SETTLED credits − debits).`);
  } else if (partiallyCredited) {
    console.log('   🟡 PARTIALLY CREDITED — AUTHORIZED/IN PROGRESS');
    console.log(`      • Ledger shows AUTH or CAPTURED, but batch not yet SETTLED.`);
    console.log(`      • If settlement_reference 375145 is a processor settlement that already pulled the real funds, wait for next settlement batch to run, then re-audit.`);
    console.log(`      • Otherwise call the processor to confirm status of settlement 375145.`);
  } else {
    console.log('   🔴🔴🔴  FUNDS NOT CREDITED (or never persisted beyond a printed demo receipt).');
    console.log(`      • This receipt is a PRINT SLIP ONLY. There is no DB/ledger/journal trail of the money.`);
    console.log(`      • Immediate action required:`);
    console.log(`        a) Call the investor/cardholder and CONFIRM whether their card was actually charged ${$(Number(txn.amount)||$50000000000)}.`);
    console.log(`        b) Check your processor dashboard under settlement 375145 — does it show the real charge + settlement?`);
    console.log(`        c) If processor CONFIRMS charge exists, we must re-insert txn, batch, ledger, and journal to correctly credit the wallet RIGHT NOW.`);
    console.log(`        d) If processor shows NO charge, this receipt is invalid (entry-mode crash, field extra zeros, or demo print). DO NOT accept investor deposit claims against this slip.`);
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
})().catch(e => { console.error('\n❌ FATAL:', e); process.exit(1); });
