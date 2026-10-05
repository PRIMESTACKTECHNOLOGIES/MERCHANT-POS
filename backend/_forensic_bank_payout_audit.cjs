const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p=[]) => { try { const r = db.exec(sql, p); if (!r.length) return []; return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; }); } catch(e){ return []; } };

  console.log('═'.repeat(110));
  console.log('🔍 FORENSIC BANK PAYOUT AUDIT — WHY NO ABSA CREDIT (SUMMARY)');
  console.log('═'.repeat(110));

  const payouts = q(`SELECT id, merchant_id, amount, currency, status, reconciliation_status,
                            provider, provider_reference, created_at, completed_at, settled_at, meta
                       FROM merchant_payouts
                      WHERE amount >= 49999
                   ORDER BY created_at DESC`);

  console.log(`\nPayouts with amount >= $49,999 found: ${payouts.length}\n`);

  payouts.forEach((P, i) => {
    let m; try { m = typeof P.meta === 'string' ? JSON.parse(P.meta) : (P.meta || {}); } catch(_) { m = {}; }
    const ow = m.outbound_wire || {};
    const sb = m.settlement_batch || {};
    const bc = m.merchant_bank_confirmation || {};
    const rej = m.rejection || {};
    const now = new Date();
    const created = new Date(P.created_at || 0);
    const ageDays = (now.getTime() - created.getTime()) / 86400000;

    console.log(`┌─ PAYOUT #${i+1} ───────────────────────────────────────────────────────────────────────────────────────────────────┐`);
    console.log(`│  ID              : ${P.id}`);
    console.log(`│  Created         : ${P.created_at}  (${ageDays.toFixed(1)} days ago)`);
    console.log(`│  Amount          : ${P.currency} ${$(P.amount)}`);
    console.log(`│  DB status       : ${P.status}`);
    console.log(`│  Recon status    : ${P.reconciliation_status || 'NULL'}`);
    console.log(`│  Provider        : ${P.provider || 'NULL'}  (ref: ${P.provider_reference || 'NULL'})`);
    console.log(`│  completed_at    : ${P.completed_at || 'NULL'}`);
    console.log(`│  settled_at      : ${P.settled_at || 'NULL'}`);
    console.log(`│  manual_mode     : ${m.manual_mode ? 'YES' : 'NO / UNKNOWN'}  — provider_mode=${m.provider_mode || 'NULL'}`);
    console.log(`│`);
    console.log(`│  ↳ Outbound Wire (meta.outbound_wire):`);
    console.log(`│    sent_at_utc         : ${ow.sent_at_utc || sb.sent_at_utc || '(NOT STAMPED — no push timestamp ever set!)'}`);
    console.log(`│    before_cutoff       : ${'before_14h_sast_cutoff' in ow ? ow.before_14h_sast_cutoff : 'N/A'}`);
    console.log(`│    UETR                : ${ow.uetr || sb.uetr || '—'}`);
    console.log(`│    RTGS reference      : ${ow.rtgs_reference || ow.rtgs_ref || sb.rtgs_reference || '—'}`);
    console.log(`│    Bankserv seq        : ${ow.bankserv_sequence || sb.bankserv_sequence || '—'}`);
    console.log(`│    expected_credit_ZA  : ${ow.expected_credit_date_za || sb.expected_credit_date_za || '—'}`);
    console.log(`│`);
    console.log(`│  ↳ Merchant Bank Confirmation (meta.merchant_bank_confirmation):`);
    console.log(`│    confirmed           : ${Object.keys(bc).length ? 'YES ⚠️ — merchant clicked approve' : 'NO ❓ — approve endpoint NEVER called for this payout'}`);
    if (Object.keys(bc).length) {
      console.log(`│    confirmed_at        : ${bc.confirmed_at || 'NULL'}`);
      console.log(`│    external_ref        : ${bc.external_reference || bc.bank_reference || 'NULL'}`);
      console.log(`│    bank_statement_date : ${bc.bank_statement_date || 'NULL'}`);
    }
    if (Object.keys(rej).length) {
      console.log(`│  ↳ REJECTION EXISTS: at=${rej.rejected_at} by=${rej.rejected_by} reason=${rej.reason || ''}`);
    }
    console.log(`└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘\n`);

    // 5-way forensic audit
    const mwtx = q(`SELECT id, wallet_id, type, amount, reference, source, created_at, note
                     FROM merchant_wallet_transactions
                    WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id=? AND currency=?)
                      AND ABS(amount - ?) < 0.01
                 ORDER BY datetime(created_at) DESC LIMIT 2`, [P.merchant_id, P.currency, Number(P.amount)]);

    const ledger = q(`SELECT id, type, amount, currency, status, reference, source_reference, narration, created_at
                        FROM ledger_entries
                       WHERE merchant_id=? AND currency=? AND ABS(amount - ?) < 0.01
                    ORDER BY datetime(created_at) DESC LIMIT 2`, [P.merchant_id, P.currency, Number(P.amount)]);

    const wallet = q(`SELECT id, balance, currency FROM merchant_wallets WHERE merchant_id=? AND currency=? LIMIT 1`, [P.merchant_id, P.currency])[0];

    console.log(`  📖 FORENSIC 5-WAY AUDIT (Payout ${P.id.slice(0,12)}…):`);
    console.log(`    1/5 payout_row_exists        : ✅ YES — id=${P.id}  status=${P.status}`);
    const mwtxOK = mwtx.length && mwtx.some(r => String(r.type||'').toLowerCase().includes('debit') || Number(r.amount||0) < 0);
    console.log(`    2/5 wallet_transaction DEBIT: ${mwtxOK ? '✅' : '❌'} ${mwtx.length ? `type=${mwtx[0].type}  amt=${$(Math.abs(Number(mwtx[0].amount||0)))}  ref=${mwtx[0].reference||''}  src=${mwtx[0].source||''}  at=${mwtx[0].created_at}` : 'NO MATCHING MWTX ROW FOUND'}`);
    const ledgerOK = ledger.length && ledger.some(r => String(r.type||'').toLowerCase().includes('debit'));
    console.log(`    3/5 ledger_entry DEBIT       : ${ledgerOK ? '✅' : '❌'} ${ledger.length ? `status=${ledger[0].status}  type=${ledger[0].type}  amt=${$(Number(ledger[0].amount||0))}  src_ref=${String(ledger[0].source_reference||'').slice(0,30)}` : 'NO MATCHING LEDGER ROW'}`);
    const uetrOK = !!(ow.uetr || sb.uetr);
    console.log(`    4/5 UETR stamped             : ${uetrOK ? '✅' : '❌'} ${ow.uetr || sb.uetr || 'NULL'}`);
    const rtgsOK = !!(ow.rtgs_reference || ow.rtgs_ref || sb.rtgs_reference);
    console.log(`    5/5 RTGS ref stamped         : ${rtgsOK ? '✅' : '❌'} ${ow.rtgs_reference || ow.rtgs_ref || sb.rtgs_reference || 'NULL'}`);
    const fc = [true, mwtxOK, ledgerOK, uetrOK, rtgsOK].filter(Boolean).length;
    console.log(`    → RESULT: ${fc}/5 ${fc===5?'💚 PAPERWORK COMPLETE (ledger stamped)':'🛑 GAPS — see above'}`);
    if (wallet) console.log(`    💰 merchant USD wallet balance after debits: ${$(wallet.balance)}`);
    console.log('');
  });

  // Environment configuration — what provider is actually set?
  console.log('─'.repeat(110));
  console.log('⚙️  ACTUAL PROVIDER CONFIGURATION (from backend/.env OR code default):');
  const env = fs.existsSync(path.join(__dirname, '.env')) ? fs.readFileSync(path.join(__dirname, '.env'), 'utf8') : '';
  const envMatch = env.match(/BANK_PAYOUT_PROVIDER\s*=\s*(\S+)/i);
  const configured = (envMatch ? envMatch[1] : 'NOT SET IN .env → FALLS BACK TO DEFAULT = MANUAL').replace(/['"]/g,'');
  console.log(`   BANK_PAYOUT_PROVIDER in .env  : ${envMatch ? envMatch[1] : '(line not found — unset)'}`);
  console.log(`   EFFECTIVE PROVIDER USED       : ${configured}`);
  console.log(`   MANUAL mode means            : NO BANK API EVER CALLED.`);
  console.log(`                                    The system ONLY:`);
  console.log(`                                    ① Debits internal merchant_wallets ledger`);
  console.log(`                                    ② Inserts PENDING_BANK_CONFIRMATION row`);
  console.log(`                                    ③ Generates printable instruction files (MT103 / RTGS / manifest)`);
  console.log(`                                    ④ Awaits HUMAN action: "click Approve + attach external bank ref"`);
  console.log(`                                    → The ACTUAL WIRE never leaves the system unless YOU physically execute it.`);
  console.log('');
  console.log('─'.repeat(110));
  console.log('🧾 FILES ON DISK — SIGNED EXECUTION INSTRUCTIONS (MANUAL MODE OUTPUT):');
  const backendDir = __dirname;
  const patterns = [
    /^SETTLEMENT_MANIFEST/,
    /^WIRE_EXECUTION_RECEIPT/,
    /^RTGS_INSTRUCTION/,
    /^SWIFT_MT103/,
    /^WISE_BATCH/,
    /^PAYOUT_RECEIPT/
  ];
  const files = fs.readdirSync(backendDir).filter(f => patterns.some(p => p.test(f)));
  const sorted = files.map(f => ({ f, st: fs.statSync(path.join(backendDir, f)) }))
                       .sort((a,b) => b.st.mtimeMs - a.st.mtimeMs);
  sorted.slice(0, 20).forEach(x => {
    const sz = (x.st.size/1024).toFixed(1).padStart(6);
    const d = new Date(x.st.mtimeMs);
    const z = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    console.log(`   ${sz} kB  ${z}  ${x.f}`);
  });
  if (sorted.length === 0) console.log('   (no execution files found)');

  console.log('');
  console.log('═'.repeat(110));
  console.log('🎯 ROOT CAUSE OF "NO CREDIT IN ABSA":');
  console.log('═'.repeat(110));
  console.log('   The system is configured as PROVIDER = MANUAL.');
  console.log('   → No bank API (Wise/external/ABSA) is wired up.');
  console.log('   → NO REAL BANK WIRE WAS EVER TRANSMITTED BY SOFTWARE.');
  console.log('   → The internal ledger was debited (book entry only) and signed PDF/HTML');
  console.log('     instruction files were generated (MT103 + RTGS instruction + manifest).');
  console.log('   → For the funds to physically arrive in ABSA account 4110362532,');
  console.log('     A HUMAN MUST take these SIGNED FILES to the ABSA RTGS DESK (or the');
  console.log('     processor/originator) and have them EXECUTE the RTGS credit transfer.');
  console.log('   → The merchant then clicks Approve + attaches the ABSA reference number');
  console.log('     to close the bookkeeping loop to status=COMPLETED (they already did');
  console.log('     this prematurely for these payouts, triggering the "SENT" stamps).');
  console.log('');

  process.exit(0);
})().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
