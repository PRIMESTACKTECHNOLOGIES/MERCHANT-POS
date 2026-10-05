const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

const isSuspiciousAmount = (n) => {
  const v = Math.abs(Number(n||0));
  const str = String(v).replace(/\.0+$/,'');
  // Powers of 10 / clean round numbers = common mock patterns
  if ([1,10,50,100,500,1000,10000,100000,1000000,10000000,100000000,
       5000000,50000000,500000000,2000000,20000000,25000000].includes(v)) return true;
  if (v >= 1_000_000_000) return true;
  return false;
};

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname,'node_modules','sql.js','dist',f)
  });
  const db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : (() => { console.log('!no db'); process.exit(1); })();
  const q = (sql, p=[]) => {
    try { const r = db.exec(sql, p); if (!r.length) return [];
      return r[0].values.map(row => { const o={}; r[0].columns.forEach((c,i)=>o[c]=row[i]); return o; });
    } catch (e) { return []; }
  };
  const one = (sql, p=[]) => q(sql,p)[0];
  const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r=>r.name);
  console.log('Tables count:', tables.length);
  console.log('Tables:', tables.join(' | '), '\n');

  // ─── RECEIPT FORENSICS ─────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════ RECEIPTS ══════════════════════════════════════════');
  const rcpt = one(`
    SELECT COUNT(*) AS total,
      COUNT(CASE WHEN transaction_id IS NULL OR transaction_id = '' THEN 1 END) AS orphan_noTx,
      COUNT(CASE WHEN EXISTS (SELECT 1 FROM pos2013_transactions t WHERE t.id = r.transaction_id) THEN 1 END) AS havePosTx,
      COUNT(CASE WHEN receipt_data IS NULL OR receipt_data = '' THEN 1 END) AS noReceiptData,
      COUNT(DISTINCT merchant_id) AS distinctMerchants,
      COUNT(DISTINCT terminal_id) AS distinctTerminals,
      COUNT(DISTINCT transaction_id) AS distinctTxIds
    FROM receipts r
  `);
  console.log('Receipts summary:', JSON.stringify(rcpt, null, 2));

  // Receipts broken down by kind: linked vs orphan
  const recent = q(`
    SELECT r.receipt_id, r.merchant_id, r.terminal_id, r.transaction_id, r.receipt_type,
      r.generated_at,
      SUBSTR(r.receipt_data, 1, 300) AS receipt_data_tail
    FROM receipts r
    ORDER BY r.generated_at DESC LIMIT 10
  `);
  console.log('\nLast 10 receipts with metadata:');
  recent.forEach((r,i) => {
    console.log(`${i+1}. ${r.receipt_id}  merchant=${r.merchant_id||'—'}  term=${r.terminal_id||'—'}  txId=${String(r.transaction_id||'—').slice(0,20)}  type=${r.receipt_type||'—'}  at=${r.generated_at}`);
    if (r.receipt_data_tail && r.receipt_data_tail.length > 50) {
      try {
        const j = JSON.parse(r.receipt_data_tail.slice(0,300)+(r.receipt_data_tail.length>=300?'":""}':''));
      } catch (e) {
        // Not valid parse; print head
        console.log('     receipt_data[:180]:', JSON.stringify(String(r.receipt_data_tail||'').slice(0,180)));
      }
    }
  });

  // Actual card transactions
  console.log('\n\n══════════════════════════════════════════ POS CARD TRANSACTIONS ══════════════════════════════════════');
  const txRows = q(`SELECT * FROM pos2013_transactions ORDER BY txn_timestamp DESC`);
  txRows.forEach((t,i) => {
    const amt = (Number(t.amount_minor||0)).toLocaleString('en-US',{minimumFractionDigits:2}) + ' ' + (t.currency||'USD');
    console.log(`${i+1}. id=${String(t.id).slice(0,24)}  ${amt}  STATUS=${String(t.status||'—').padEnd(10)}  STAN=${String(t.stan||'—').padEnd(8)}  AUTH=${String(t.auth_code||'—').padEnd(10)}  CARD=${String(t.pan_masked||'—').padEnd(20)}  MERCHANT=${t.merchant_id||'—'}  TERMINAL=${t.terminal_id||'—'}  TS=${t.txn_timestamp||'—'}`);
    console.log(`     cardholder=${t.cardholder_name||t.cardholder_full||'—'}    batch=${t.batch_id||'—'}    decline=${t.decline_reason||'—'}    reader=${t.reader_source||'—'}    cvm=${t.cvm_result||'—'}    settledAt=${t.settled_at||'—'}`);
  });

  // ─── FULL CUSTOMER FORENSICS ────────────────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════ FULL CUSTOMER PROFILES ══════════════════════════════════════');
  // Collect every potential customer table
  const profiles = {};
  const addTo = (key, field, val) => {
    if (!val || val === '') return;
    if (!profiles[key]) profiles[key] = {};
    const exist = profiles[key][field];
    if (!exist) profiles[key][field] = val;
    else if (Array.isArray(exist)) exist.push(val);
    else profiles[key][field] = [exist, val];
  };

  // customer_wallets (our earlier source, 7 rows)
  q(`SELECT * FROM customer_wallets`).forEach(w => {
    const k = (w.customer_id || w.customer || w.owner_id || w.id || '').toLowerCase();
    if (!k) return;
    addTo(k, 'wallet_id', w.id);
    addTo(k, 'wallet_code', w.wallet_code);
    addTo(k, 'wallet_currency', w.currency);
    addTo(k, 'wallet_balance', w.current_balance ?? w.balance ?? w.balance_usd);
    addTo(k, 'wallet_created', w.created_at);
    addTo(k, 'wallet_updated', w.updated_at);
  });

  // Any table named customers/users
  tables.forEach(tbl => {
    if (/^(customers|users|customer_profiles|client.*)$/i.test(tbl) || /(customer|user)/i.test(tbl)) {
      try {
        const rows = q(`SELECT * FROM "${tbl}" LIMIT 200`);
        console.log(`  [+] matched table "${tbl}" with ${rows.length} rows`);
        rows.forEach(r => {
          const k = (r.customer_id || r.id || r.user_id || r.client_id || r.uuid || '').toLowerCase();
          if (!k) return;
          Object.entries(r).forEach(([f,v]) => {
            if (v === null || v === '' || v === undefined) return;
            addTo(k, f, v);
          });
        });
      } catch (e) { /* skip */ }
    }
  });

  // wallet_transactions (get unique customer_ids with first/last tx)
  if (tables.includes('wallet_transactions')) {
    const wt = q(`SELECT customer_id, COUNT(*) AS cnt, MIN(created_at) AS first_tx, MAX(created_at) AS last_tx FROM wallet_transactions GROUP BY customer_id`);
    wt.forEach(w => {
      const k = String(w.customer_id||'').toLowerCase();
      if (!k) return;
      addTo(k, 'wallet_tx_count', w.cnt);
      addTo(k, 'first_wallet_tx', w.first_tx);
      addTo(k, 'last_wallet_tx', w.last_tx);
    });
  }

  // ledger_entries (get unique customers, balance from ledger)
  if (tables.includes('ledger_entries')) {
    const le = q(`SELECT customer_id, COUNT(*) AS cnt,
      COALESCE(SUM(CASE WHEN LOWER(entry_type)='credit' THEN amount ELSE 0 END),0) AS cr,
      COALESCE(SUM(CASE WHEN LOWER(entry_type)<>'credit' THEN amount ELSE 0 END),0) AS dr,
      COALESCE(SUM(CASE WHEN LOWER(entry_type)='credit' THEN amount ELSE -amount END),0) AS net,
      MIN(created_at) AS first, MAX(created_at) AS last
      FROM ledger_entries WHERE LOWER(status) IN ('approved','authorized','settled','completed','paid','success','successful','synced','reconciled')
      GROUP BY customer_id`);
    le.forEach(w => {
      const k = String(w.customer_id||'').toLowerCase();
      if (!k) return;
      addTo(k, 'ledger_entries_count', w.cnt);
      addTo(k, 'ledger_credit_total', w.cr);
      addTo(k, 'ledger_debit_total', w.dr);
      addTo(k, 'ledger_net_balance', w.net);
      addTo(k, 'first_ledger_entry', w.first);
      addTo(k, 'last_ledger_entry', w.last);
    });
  }

  // crypto_transactions
  if (tables.includes('crypto_transactions')) {
    const ct = q(`SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total_usd,
      MIN(created_at) AS first, MAX(created_at) AS last FROM crypto_transactions GROUP BY customer_id`);
    ct.forEach(r => {
      const k = String(r.customer_id||'').toLowerCase();
      if (!k) return;
      addTo(k, 'crypto_tx_count', r.cnt);
      addTo(k, 'crypto_total_usd_volume', r.total_usd);
      addTo(k, 'first_crypto_tx', r.first);
      addTo(k, 'last_crypto_tx', r.last);
    });
  }

  // POS card transactions have a customer?
  q(`SELECT customer_id, COUNT(*) AS cnt, SUM(amount_minor) AS vol_minor
     FROM pos2013_transactions WHERE customer_id IS NOT NULL AND customer_id <> ''
     GROUP BY customer_id`).forEach(r => {
    const k = String(r.customer_id||'').toLowerCase();
    addTo(k, 'pos_card_tx_count', r.cnt);
    addTo(k, 'pos_card_vol_minor', r.vol_minor);
  });

  // deposits / payouts / withdrawals
  ['deposits','customer_deposits','withdrawals','customer_withdrawals','merchant_payouts','payouts'].forEach(tbl => {
    if (tables.includes(tbl)) {
      try {
        const rows = q(`SELECT customer_id, COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt
          FROM "${tbl}" WHERE customer_id IS NOT NULL AND customer_id <> ''
          GROUP BY customer_id`);
        rows.forEach(r => {
          const k = String(r.customer_id||'').toLowerCase();
          addTo(k, `${tbl}_count`, r.c);
          addTo(k, `${tbl}_amount`, r.amt);
        });
      } catch(e) {}
    }
  });

  // Now print each profile
  const sortedKeys = Object.keys(profiles).sort((a,b) => {
    const ab = Number(profiles[b].wallet_balance || profiles[b].ledger_net_balance || 0);
    const aa = Number(profiles[a].wallet_balance || profiles[a].ledger_net_balance || 0);
    return ab - aa;
  });
  console.log(`\nTotal unique customer IDs with any data: ${sortedKeys.length}\n`);

  sortedKeys.forEach((k, i) => {
    const p = profiles[k];
    const wBal    = Number(p.wallet_balance || 0);
    const lNet    = Number(p.ledger_net_balance || 0);
    const sources = (p.wallet_balance!==undefined?1:0) + (p.ledger_net_balance!==undefined?1:0) + (p.wallet_tx_count!==undefined?1:0);
    const backings = [];
    if (p.ledger_entries_count) backings.push(`LEDGER(${p.ledger_entries_count} entries, net=${lNet.toLocaleString()})`);
    if (p.wallet_tx_count)      backings.push(`WALLET_TX(${p.wallet_tx_count} txns)`);
    if (p.deposits_count)       backings.push(`DEPOSITS(${p.deposits_count})`);
    if (p.crypto_tx_count)      backings.push(`CRYPTO(${p.crypto_tx_count} txns)`);
    if (p.pos_card_tx_count)    backings.push(`CARD(${p.pos_card_tx_count} txns)`);
    const backed = backings.length > 0;
    const sus   = isSuspiciousAmount(wBal) && !backed;
    const flag  = (sources>=3 ? '✅ ' : '⚠  ') + (sus ? '[MOCK PATTERN?]' : (backed ? '[BACKED BY TXN LOG]' : '[WALLET ONLY — NO TXN PROOF]'));
    console.log(`${String(i+1).padStart(2,' ')} ${flag}`);
    console.log(`   customer_id: ${k}`);
    console.log(`   Name        : ${p.name||p.full_name||p.display_name||p.first_name&&(p.first_name+' '+(p.last_name||''))||'(ANONYMOUS — NO NAME ROW)'}`);
    console.log(`   Email       : ${p.email||'—'}`);
    console.log(`   Phone       : ${p.phone||p.mobile||'—'}`);
    console.log(`   Wallet      : ${p.wallet_code||'—'} (${p.wallet_currency||'USD'})  created=${p.wallet_created||'—'}`);
    console.log(`   WALLET_BAL  : $${wBal.toLocaleString()}`);
    console.log(`   LEDGER_NET  : ${p.ledger_net_balance!==undefined ? '$'+lNet.toLocaleString() : '⚠ NO LEDGER ENTRIES FOR THIS CUSTOMER'}`);
    console.log(`   Balance proof backings: ${backings.length?backings.join(' + '):'(NONE — pure ghost row)'}`);
    console.log(`   First/last activity: ${p.last_ledger_entry||p.last_wallet_tx||p.last_crypto_tx||'(NO ACTIVITY TIMESTAMP)'}`);
    console.log('');
  });

  // ─── REAL (NON-MOCK) BALANCE SUMMARY ───────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════ FINAL: REAL CONFIRMED BALANCES ══════════════════════════════════════');
  console.log('Definition of "REAL" (triple-criteria):');
  console.log('  • Wallet balance is NOT a suspicious clean power-of-10 amount OR');
  console.log('  • Has >=1 backed sources (ledger_entries / wallet_transactions / deposits / crypto txns) AND');
  console.log('  • No demo/test/mock marker in customer name or email.');
  console.log('');

  let grandRealUSD = 0, grandMockUSD = 0, grandUnverifiedUSD = 0;
  const realOnes = [], mockOnes = [], unverifiedOnes = [];
  sortedKeys.forEach(k => {
    const p = profiles[k];
    const wBal = Number(p.wallet_balance || 0);
    const backed = p.ledger_entries_count || p.wallet_tx_count || p.deposits_count || p.crypto_tx_count || p.pos_card_tx_count;
    const sus    = isSuspiciousAmount(wBal) && !backed;
    const mockName = /demo|test|mock|placeholder|example|sample|ghost|stub|johndoe|jane doe/i.test(
      String(p.name||p.full_name||p.email||p.display_name||'').toLowerCase()
    );
    const real = !sus && !mockName && (backed || !isSuspiciousAmount(wBal));
    if (real && backed) { realOnes.push({k, p, wBal}); grandRealUSD += wBal; }
    else if (mockName || sus) { mockOnes.push({k, p, wBal}); grandMockUSD += wBal; }
    else { unverifiedOnes.push({k, p, wBal}); grandUnverifiedUSD += wBal; }
  });
  console.log(`✅ REAL  BACKED customers : ${realOnes.length}    TOTAL BALANCE = $${grandRealUSD.toLocaleString('en-US',{minimumFractionDigits:2})} USD`);
  realOnes.forEach((x,i) => console.log(`   ${i+1}. ${x.p.name||x.p.email||x.k} — wallet $${x.wBal.toLocaleString()}   ${x.p.wallet_code||''}`));
  console.log(`\n🧨 LIKELY MOCK customers   : ${mockOnes.length}    TOTAL BALANCE = $${grandMockUSD.toLocaleString('en-US',{minimumFractionDigits:2})} USD`);
  mockOnes.forEach((x,i) => console.log(`   ${i+1}. ${x.p.name||x.p.email||x.k} — wallet $${x.wBal.toLocaleString()}   ${x.p.wallet_code||''} (${Object.entries(x.p).filter(([f,v])=>f.startsWith('ledger')||f.includes('tx_count')||f.includes('deposits_count')||f.includes('crypto_')).length?'backed':'no-backing'})`));
  console.log(`\n❔ UNVERIFIED (no proof/no-mock, ambiguous): ${unverifiedOnes.length}    TOTAL BALANCE = $${grandUnverifiedUSD.toLocaleString('en-US',{minimumFractionDigits:2})} USD`);
  unverifiedOnes.forEach((x,i) => console.log(`   ${i+1}. ${x.p.name||x.p.email||x.k} — wallet $${x.wBal.toLocaleString()}   ${x.p.wallet_code||''}`));
  console.log('\nTOTAL ALL: $'+(grandRealUSD+grandMockUSD+grandUnverifiedUSD).toLocaleString('en-US',{minimumFractionDigits:2})+' USD');

})();
