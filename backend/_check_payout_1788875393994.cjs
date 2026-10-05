const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const PROVIDER_REF = 'ABSA-AUTO-SETTLE-1788875393994';

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => { try { const r = db.exec(sql, p); if (!r.length) return []; return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; }); } catch(e){ console.error('SQL ERR:', e.message); return []; } };
  const one = (sql,p=[]) => q(sql,p)[0];

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🔍 PAYOUT INVESTIGATION: provider_reference =', PROVIDER_REF);
  console.log('   Payout 2/2 from today\'s batch (second $50k to ABSA 4110362532)');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // 1) payout row
  const payout = one(`SELECT * FROM payouts WHERE provider_reference = ? OR (meta LIKE ?) LIMIT 1`, [PROVIDER_REF, '%'+PROVIDER_REF+'%']);
  if (!payout) {
    console.log('\n❌ NO payout row with provider_reference =', PROVIDER_REF);
    console.log('\nSearching all payouts for merchant MRC-1001 USD:');
    const all = q(`SELECT * FROM payouts WHERE merchant_id = 'MRC-1001' AND currency = 'USD' ORDER BY created_at DESC LIMIT 20`);
    all.forEach((p,i) => {
      let metaRef = '';
      try { metaRef = JSON.parse(p.meta||'{}').outbound_wire?.rtgs_ref || JSON.parse(p.meta||'{}').settlement_batch?.batch_id || ''; } catch(_){}
      console.log(`   ${i+1}. id=${p.id.slice(0,28)}…  amount=${$(p.amount)}${p.currency}  status=${p.status}  recon=${p.reconciliation_status||'—'}  prov_ref=${p.provider_reference?.slice(0,28)||'—'}…  meta_ref=${metaRef.slice(0,30)}  created=${p.created_at?.slice(0,16)||'—'}`);
    });
    process.exit(0);
  }

  console.log('\n▌ PAYOUT ROW:');
  console.log(`   id                   : ${payout.id}`);
  console.log(`   merchant_id          : ${payout.merchant_id}  type=${payout.payout_type||'bank_transfer'}`);
  console.log(`   amount               : ${$(payout.amount)} ${payout.currency}   (fee=${$(payout.fee_amount||0)}, net=${$(Number(payout.amount||0)-Number(payout.fee_amount||0))})`);
  console.log(`   status               : ${payout.status}`);
  console.log(`   provider             : ${payout.provider}`);
  console.log(`   provider_reference   : ${payout.provider_reference}`);
  console.log(`   reconciliation_status: ${payout.reconciliation_status||'—'}`);
  console.log(`   reconciliation_note  : ${payout.reconciliation_note?.slice(0,200)||'—'}`);
  console.log(`   beneficiary_name     : ${payout.beneficiary_name}`);
  console.log(`   bank_account         : ${payout.bank_account_number} / ${payout.bank_code||payout.swift_code||'—'}  branch=${payout.branch_code||'—'}`);
  console.log(`   created_at           : ${payout.created_at}`);
  console.log(`   updated_at           : ${payout.updated_at||'—'}`);
  console.log(`   settled_at           : ${payout.settled_at||'—'}`);
  console.log(`   external_id          : ${payout.external_id||'—'}`);
  let meta = {};
  try { meta = typeof payout.meta === 'string' ? JSON.parse(payout.meta) : (payout.meta||{}); } catch(_){}

  console.log('\n▌ meta.outbound_wire (reconciliation stamping from batch POS-SETTLE-BATCH-1788877956420):');
  const ow = meta.outbound_wire || {};
  if (Object.keys(ow).length) {
    Object.entries(ow).forEach(([k,v]) => { const sv = typeof v==='object' ? JSON.stringify(v).slice(0,200) : String(v).slice(0,200); console.log(`   ${k.padEnd(24)}: ${sv}`); });
  } else {
    console.log('   ❌ NOT STAMPED — no outbound_wire block!');
  }
  const sb = meta.settlement_batch || {};
  console.log('\n▌ meta.settlement_batch:');
  if (Object.keys(sb).length) Object.entries(sb).forEach(([k,v]) => console.log(`   ${k.padEnd(20)}: ${String(v).slice(0,200)}`));
  else console.log('   — (absent)');

  // 2) Double-entry ledger match — any entries referencing payout id or provider_ref?
  console.log('\n▌ DOUBLE-ENTRY LEDGER (payout-related rows):');
  const ledger = q(`SELECT * FROM ledger_entries WHERE transaction_id = ? OR source_reference = ? OR reference = ? OR description LIKE ? ORDER BY created_at DESC`, [payout.id, payout.provider_reference, payout.id, '%'+payout.id.slice(0,20)+'%']);
  if (!ledger.length) {
    const walletDebits = q(`SELECT * FROM ledger_entries WHERE merchant_id=? AND currency=? AND type='debit' AND description LIKE '%merchant_payout%' ORDER BY created_at DESC LIMIT 6`, [payout.merchant_id, payout.currency]);
    console.log(`   ℹ️  No direct linkage. Showing last merchant_payout debits:`);
    walletDebits.forEach((l,i) => console.log(`   ${i+1}. id=${l.id.slice(0,24)}… ${$(l.amount)}  status=${l.status}  src_ref=${l.source_reference?.slice(0,40)||'—'}  desc=${String(l.description||'').slice(0,80)}  created=${l.created_at?.slice(5,16)}`));
  } else {
    ledger.forEach((l,i) => {
      const side = l.type==='credit' ? '📥 CREDIT' : '📤 DEBIT';
      console.log(`   ${i+1}. id=${l.id.slice(0,24)}…  ${side} ${$(l.amount)}${l.currency}  status=${l.status}`);
      console.log(`      src=${l.source_type}:${l.source_reference?.slice(0,40)||'—'}  txn_id=${l.transaction_id?.slice(0,32)||'—'}`);
      console.log(`      desc: ${String(l.description||'').slice(0,140)}`);
      console.log(`      created=${l.created_at}`);
    });
  }

  // 3) merchant_wallet_transactions journal for the payout debit
  console.log('\n▌ WALLET JOURNAL (merchant_payout entries near this amount):');
  const WAL = one(`SELECT id FROM merchant_wallets WHERE merchant_id=? AND currency=?`, [payout.merchant_id, payout.currency]);
  const journal = q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND ABS(amount - ?) < 0.01 AND type='debit' ORDER BY created_at DESC LIMIT 5`, [WAL?.id, payout.amount]);
  if (!journal.length) {
    const recent = q(`SELECT * FROM merchant_wallet_transactions WHERE wallet_id=? AND source='merchant_payout' ORDER BY created_at DESC LIMIT 5`, [WAL?.id]);
    recent.forEach((j,i) => console.log(`   ${i+1}. type=${j.type} ${$(j.amount)} src=${j.source} ref=${j.reference?.slice(0,28)} created=${j.created_at?.slice(5,16)}`));
  } else {
    journal.forEach((j,i) => console.log(`   ${i+1}. ${j.type} ${$(j.amount)}  src=${j.source}  ref=${j.reference?.slice(0,36)}  created=${j.created_at}  desc=${String(j.description||'').slice(0,90)}`));
  }

  // 4) 5-WAY RECON MATCH
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ 5-WAY FORENSIC MATCH — STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const match = [];
  match.push({ label: '1. payout.status = COMPLETED', ok: payout.status === 'COMPLETED', got: payout.status });
  match.push({ label: '2. payout.provider = manual', ok: payout.provider === 'manual', got: payout.provider });
  match.push({ label: '3. reconciliation_status = OUTBOUND_WIRE_SENT', ok: payout.reconciliation_status === 'OUTBOUND_WIRE_SENT', got: payout.reconciliation_status || '—' });
  match.push({ label: '4. meta.outbound_wire has UETR', ok: !!ow.uetr, got: ow.uetr?.slice(0,24)+'…' || 'ABSENT' });
  match.push({ label: '5. meta.outbound_wire has RTGS ref', ok: !!ow.rtgs_ref, got: ow.rtgs_ref || 'ABSENT' });
  match.push({ label: '6. provider_reference set correctly', ok: payout.provider_reference === PROVIDER_REF, got: payout.provider_reference });
  match.push({ label: '7. payout.amount = $50,000.00 USD', ok: Math.abs(Number(payout.amount)-50000) < 0.01 && payout.currency === 'USD', got: $(payout.amount)+' '+payout.currency });
  match.push({ label: '8. payout amount present in wallet journal', ok: journal.length > 0, got: (journal.length?'YES: ':'NO: ')+journal.length+' rows' });

  let pass = 0, fail = 0;
  match.forEach(c => {
    if (c.ok) { pass++; console.log(`  ✅ PASS  ${c.label.padEnd(46)} → ${c.got}`); }
    else { fail++; console.log(`  ❌ FAIL  ${c.label.padEnd(46)} → ${c.got}`); }
  });

  console.log(`\n   ${pass}/${match.length} checks passed.`);

  // 5) Credit timeline based on outbound_wire data
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('⏰ EXPECTED CREDIT TIMELINE TO ABSA 4110362532 (JUKRUTI LOGISTICS PTY LTD)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const sentAt = ow.sent_at || payout.settled_at || payout.created_at;
  const sentAtDate = sentAt ? new Date(sentAt) : null;
  const sentDay = sentAtDate?.toLocaleDateString('en-ZA', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const sentTime = sentAtDate?.toLocaleTimeString('en-ZA', {timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit'});
  console.log(`   Payout created (system) : ${payout.created_at} (UTC)`);
  if (sentAtDate) console.log(`   Wire marked SENT (meta) : ${sentAt.toISOString()} (${sentDay} ${sentTime} SAST)`);
  console.log(`   Channel                : ${ow.channel||'N/A — not stamped'}`);
  console.log(`   Rail                   : ${(ow.correspondent_bic||'') + ' ' + (ow.rail||'')}`);
  console.log(`   SWIFT UETR             : ${ow.uetr || '⚠️  NOT STAMPED'}`);
  console.log(`   RTGS / Bankserv Ref    : ${ow.rtgs_ref || '⚠️  NOT STAMPED'}`);
  console.log(`   Bankserv Sequence      : ${ow.bankserv_sequence || '—'}`);
  console.log(`   Instruction ID         : ${ow.instruction_id || '—'}`);
  console.log(`   Beneficiary Acc        : ${payout.bank_account_number} (${payout.beneficiary_name})`);
  console.log(`   Bank / Branch          : ${payout.swift_code||payout.bank_code||'ABSAZAJJ'} · branch ${payout.branch_code||'250655'}`);

  console.log(`\n   ┌─────────────────────────────────────────────────────────────────────┐`);
  if (payout.reconciliation_status === 'OUTBOUND_WIRE_SENT' && ow.uetr && ow.rtgs_ref) {
    const sentToday = sentAtDate && sentAtDate.toDateString() === new Date().toDateString();
    const beforeCutoff = sentAtDate && sentAtDate.getUTCHours() < 12; // 14:00 SAST = 12:00 UTC
    console.log(`   │ 🟢 RECON STATUS: OUTBOUND_WIRE_SENT / UETR+RTGS STAMPED             │`);
    console.log(`   │                                                                     │`);
    if (sentToday && beforeCutoff) {
      console.log(`   │ ✅  CREDIT TODAY: ${sentDay} (submitted BEFORE ABSA 14:00 SAST     │`);
      console.log(`   │        RTGS cut-off. Expected credit INTO ABSA 4110362532           │`);
      console.log(`   │        between 14:30 SAST — 17:00 SAST today.                      │`);
    } else if (sentToday && !beforeCutoff) {
      console.log(`   │ 🟡 CREDIT TOMORROW: Wire sent AFTER 14:00 SAST RTGS cut-off →       │`);
      console.log(`   │        falls into tomorrow's settlement run. Credit lands          │`);
      console.log(`   │        ${sentAtDate?new Date(sentAtDate.getTime()+86400000).toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'}):'next business day'} by 16:00 SAST.          │`);
    } else {
      console.log(`   │ 🟡 Wire submitted previously — see ABSA statement credit.          │`);
    }
    console.log(`   │                                                                     │`);
    console.log(`   │ 🔍 HOW TO VERIFY THE CREDIT HAS LANDED:                             │`);
    console.log(`   │   1. Open ABSA online banking / ABSA app for 4110362532            │`);
    console.log(`   │   2. Statement date: today ${sentAtDate?sentAtDate.toLocaleDateString('en-ZA'):''} / tomorrow                                     │`);
    console.log(`   │   3. Search EITHER:                                                 │`);
    console.log(`   │      • RTGS reference:  ${(ow.rtgs_ref||'').padEnd(30)}         │`);
    console.log(`   │      • UETR prefix:    ${(ow.uetr||'').slice(0,16).padEnd(30)}         │`);
    console.log(`   │      • Wire memo:      ABSAC… / POS (partial on statement)         │`);
    console.log(`   │   4. Amount: $50,000.00 USD (or ZAR ~R930,000.00 at ~R18.60/USD)   │`);
    console.log(`   │                                                                     │`);
    console.log(`   │ 🚨 IF NO CREDIT BY TOMORROW 17:00 SAST:                             │`);
    console.log(`   │   • Reply with: (a) "no credit yet", (b) ABSA screenshot of        │`);
    console.log(`   │     statement showing nothing, and (c) processor reply if you      │`);
    console.log(`   │     have one. I will: trace via UETR, rollback payout status,      │`);
    console.log(`   │     credit wallet back $50k, and resend with fresh RTGS ref.       │`);
  } else if (payout.status === 'COMPLETED' && payout.reconciliation_status === 'BATCHED_FOR_OUTBOUND_WIRE') {
    console.log(`   │ 🟡 RECON STATUS: BATCHED_FOR_OUTBOUND_WIRE / NOT YET SENT OUT       │`);
    console.log(`   │                                                                     │`);
    console.log(`   │ The system has DEBITED your wallet (-$50k) internally, but the     │`);
    console.log(`   │ RTGS/SWIFT file has NOT been physically submitted to the bank.     │`);
    console.log(`   │ This means credit CANNOT land until YOUR ACTION:                    │`);
    console.log(`   │   1. Open backend/WISE_BATCH_POS-SETTLE-BATCH-1788877956420.csv     │`);
    console.log(`   │   2. Upload to Wise → Batch Payments → Send.                       │`);
    console.log(`   │      OR print RTGS_HTML and hand to processor/banker.              │`);
    console.log(`   │   3. You'll get back UETR + RTGS ref — send them to me.            │`);
    console.log(`   │   4. I stamp OUTBOUND_WIRE_SENT with those refs (closing loop).    │`);
    console.log(`   │                                                                     │`);
    console.log(`   │ Credit to ABSA then lands SAME DAY if before 14:00 SAST cut-off.   │`);
  } else {
    console.log(`   │ 🟠 RECON STATUS: ${String(payout.reconciliation_status||payout.status).padEnd(36)}                │`);
    console.log(`   │                                                                     │`);
    console.log(`   │ See matrix above for specific failures. Action depends on which    │`);
    console.log(`   │ checks failed. Contact processor first if UETR/RTGS are missing.   │`);
  }
  console.log(`   └─────────────────────────────────────────────────────────────────────┘`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('📎 LINKED FILES (from batch POS-SETTLE-BATCH-1788877956420):');
  const batch = sb.batch_id ? sb.batch_id : 'POS-SETTLE-BATCH-1788877956420';
  [
    `WISE_BATCH_${batch}.csv`,
    `SWIFT_MT103_BATCH_${batch}.txt`,
    `SETTLEMENT_MANIFEST_${batch}.json`,
    `RTGS_INSTRUCTION_${batch}.html`,
    `WIRE_EXECUTION_RECEIPT_${batch}.html`,
    `SETTLEMENT_MANIFEST_EXECUTED_${batch}.json`,
  ].forEach(fn => {
    const p = path.join(__dirname, fn);
    console.log(`   ${fs.existsSync(p)?'✅':'❌'}  backend/${fn}  ${fs.existsSync(p)?Math.round(fs.statSync(p).size/1024)+' KB':''}`);
  });

})().catch(e => { console.error('\n❌ FATAL:', e.message); process.exit(1); });
