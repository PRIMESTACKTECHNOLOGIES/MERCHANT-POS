const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const BACKEND_ROOT = __dirname;
console.log('============================================================');
console.log('  FORENSIC REAL-FUNDS AUDIT · ROOT-CAUSE & RESTORE');
console.log('  ' + new Date().toISOString());
console.log('  DB: ' + DB_PATH);
console.log('============================================================\n');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('[i] Loaded database: ' + (buf.length/1024).toFixed(1) + ' KB on disk.');
  } else {
    console.error('[X] DATABASE FILE MISSING — aborting.');
    process.exit(2);
  }

  function q(sql, params = []) {
    const stmt = db.prepare(sql);
    if (Array.isArray(params) && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  function scn(title) {
    console.log('\n──── ' + title + ' ────');
  }
  function printRows(rows, cols) {
    if (!Array.isArray(rows) || rows.length === 0) { console.log('  (empty)'); return; }
    const keys = cols || Object.keys(rows[0]);
    const widths = {};
    keys.forEach(k => widths[k] = Math.max(String(k).length, ...rows.map(r => String((r && r[k] != null) ? r[k] : '').slice(0, 40).length)));
    const line = keys.map(k => String(k).padEnd(widths[k])).join(' | ');
    console.log('  ' + line);
    console.log('  ' + keys.map(k => '-'.repeat(widths[k])).join('-+-'));
    rows.forEach(r => {
      const row = keys.map(k => {
        let v = (r && r[k] != null) ? String(r[k]) : '';
        if (v.length > 40) v = v.slice(0, 36) + '...';
        return v.padEnd(widths[k]);
      }).join(' | ');
      console.log('  ' + row);
    });
  }
  function num(v) { return Number(v) || 0; }

  // ── A ────────────────────────────────────────────────────────
  scn('A. CUSTOMER FIAT WALLETS (STORED BALANCES)');
  const cw = q(`
    SELECT id, customer_id, currency, balance, wallet_code, created_at, updated_at
    FROM customer_wallets ORDER BY balance DESC
  `);
  printRows(cw, ['id','customer_id','currency','balance','wallet_code','created_at']);
  const cwTot = {}; cw.forEach(w => { cwTot[w.currency] = (cwTot[w.currency]||0) + num(w.balance); });
  console.log('  AGG: ' + JSON.stringify(cwTot));

  scn('B. CUSTOMER WALLET_TX — EVERY ROW (rebuild balance from source of truth)');
  const wtx = q(`
    SELECT wt.id, wt.wallet_id, w.customer_id, w.currency, wt.type, wt.amount, wt.source, wt.reference, substr(wt.description,1,60) AS descr, wt.created_at
    FROM wallet_transactions wt LEFT JOIN customer_wallets w ON w.id = wt.wallet_id
    ORDER BY wt.created_at ASC
  `);
  printRows(wtx);
  const wtxAgg = {};
  wtx.forEach(t => {
    const key = (t.wallet_id||'?') + '|' + (t.currency||'USD');
    if (!wtxAgg[key]) wtxAgg[key] = {wallet_id:t.wallet_id, customer_id:t.customer_id, currency:t.currency, txSum:0, n:0};
    wtxAgg[key].txSum += (t.type === 'credit' ? 1 : -1) * num(t.amount);
    wtxAgg[key].n++;
  });
  console.log('  Per-wallet rollup from wallet_transactions:');
  Object.values(wtxAgg).forEach(a => console.log('    wallet=' + a.wallet_id.substring(0,10) + '  cust=' + a.customer_id + '  cur=' + a.currency + '  Σcredits-debits=' + a.txSum.toFixed(2) + '  n=' + a.n));

  scn('C. ROOT-CAUSE — customer cc6f0711 stored 2000.00 vs txSum 1000.00 → FIND THE MISSING CREDIT $1000');
  const misW = cw.find(w => w.customer_id && w.customer_id.startsWith('cc6f0711'));
  if (misW) {
    console.log('  Stored balance: $' + num(misW.balance).toFixed(2) + '  wallet_id=' + misW.id);
    console.log('  Wallet code:    ' + misW.wallet_code);
    console.log('  Checking ALL possible credit sources for this customer — EVERY TABLE that adds funds:');
    const all = [
      { tbl:'ledger_transactions',  sql:`SELECT * FROM ledger_transactions WHERE customer_id = ? OR account_id LIKE '%'||?||'%' OR reference LIKE '%'||?||'%'` },
      { tbl:'vault_ledger',         sql:`SELECT * FROM vault_ledger WHERE customer_id = ? OR vault_account_id IN (SELECT id FROM vault_accounts WHERE holder_id=?) OR tx_reference LIKE '%'||?||'%'` },
      { tbl:'vault_entries',        sql:`SELECT * FROM vault_entries WHERE customer_id = ? OR account_id IN (SELECT id FROM vault_accounts WHERE holder_id=?) OR entry_reference LIKE '%'||?||'%'` },
      { tbl:'vault_reserve',        sql:`SELECT * FROM vault_reserve WHERE movement_ref LIKE '%'||?||'%'` },
      { tbl:'merchant_wallet_transactions', sql:`SELECT * FROM merchant_wallet_transactions WHERE merchant_id=? OR reference LIKE '%'||?||'%' LIMIT 20` },
      { tbl:'wallet_transfers',     sql:`SELECT * FROM wallet_transfers WHERE source_customer_id = ? OR dest_customer_id = ? OR source_wallet_id=? OR dest_wallet_id=?` },
      { tbl:'incoming_payments',    sql:`SELECT * FROM incoming_payments WHERE matched_pos_transaction_id IN (SELECT id FROM pos_transactions WHERE customer_id=?) OR customer_reference LIKE '%'||?||'%' LIMIT 20` },
      { tbl:'reconciliation_matches', sql:`SELECT * FROM reconciliation_matches WHERE notes LIKE '%'||?||'%' LIMIT 20` },
      { tbl:'card_authorizations',  sql:`SELECT status, amount, currency, authorization_code, customer_id, wallet_id FROM card_authorizations WHERE (customer_id=? OR wallet_id=?) AND status IN ('APPROVED','CLEARED','CAPTURED') LIMIT 20` },
      { tbl:'pos_transactions',     sql:`SELECT status, total_amount_cents/100 AS amount, currency, customer_id, wallet_id, settlement_status FROM pos_transactions WHERE customer_id=? OR wallet_id=? LIMIT 20` },
      { tbl:'wallet_funding_loads', sql:`SELECT status, amount_minor/100 AS amount, currency, customer_id, card_id, external_ref, idempotency_key FROM wallet_funding_loads WHERE customer_id=? LIMIT 20` },
      { tbl:'offline_funds_receipts', sql:`SELECT status, amount_minor/100 AS amount, currency, customer_id, reference FROM offline_funds_receipts WHERE customer_id=? LIMIT 20` },
      { tbl:'authorization_requests', sql:`SELECT status, amount, currency, customer_id, wallet_id FROM authorization_requests WHERE customer_id=? OR wallet_id=? LIMIT 20` },
      { tbl:'settlement_reversals', sql:`SELECT status, amount, currency, customer_reference FROM settlement_reversals WHERE customer_reference LIKE '%'||?||'%' LIMIT 20` },
      { tbl:'audit_trail',          sql:`SELECT action, table_name, substr(details,1,80) AS det FROM audit_trail WHERE (table_name IN ('customer_wallets','wallet_transactions','merchant_wallets','accounts','customer_crypto_wallets')) AND (det LIKE '%cc6f0711%' OR det LIKE '%${misW.id.substring(0,8)}%' OR det LIKE '%${misW.wallet_code}%') ORDER BY created_at DESC LIMIT 20` },
      { tbl:'security_audit_log',   sql:`SELECT event_type, actor_id, substr(meta_json,1,80) AS meta FROM security_audit_log WHERE meta_json LIKE '%cc6f0711%' OR meta_json LIKE '%${misW.wallet_code}%' LIMIT 20` },
    ];
    all.forEach(({tbl,sql}) => {
      const params = tbl.includes('wallet_transfers') ? [misW.customer_id, misW.customer_id, misW.id, misW.id]
        : (tbl.includes('pos_transactions') || tbl.includes('card_authorizations') || tbl.includes('authorization_requests')) ? [misW.customer_id, misW.id]
        : tbl.includes('vault_reserve') ? [misW.customer_id]
        : (tbl.includes('settlement_reversals')) ? [misW.customer_id]
        : (tbl.includes('audit_trail')) ? []
        : (tbl.includes('incoming_payments') || tbl.includes('reconciliation_matches') || tbl.includes('security_audit_log')) ? [misW.customer_id]
        : [misW.customer_id, misW.customer_id, misW.customer_id];
      const r = q(sql, params);
      if (r && r.length) {
        console.log('\n  ✅ ' + tbl + ' — ' + r.length + ' record(s):');
        r.slice(0, 15).forEach(row => console.log('    - ' + Object.entries(row).map(([k,v]) => k + '=' + (v == null ? '' : String(v).slice(0, 40))).join(' | ')));
      }
    });
  }

  // ── D ────────────────────────────────────────────────────────
  scn('D. MERCHANT FIAT WALLETS + THEIR TRANSACTIONS');
  const mw = q(`SELECT * FROM merchant_wallets ORDER BY balance DESC`);
  printRows(mw);
  const mwt = q(`
    SELECT mwt.*, m.merchant_id, m.currency AS mcur
    FROM merchant_wallet_transactions mwt LEFT JOIN merchant_wallets m ON m.id=mwt.wallet_id
    ORDER BY mwt.created_at ASC
  `);
  console.log('\n  Merchant wallet transactions:');
  printRows(mwt);
  // Rollup vs stored
  const mwtMap = {};
  mwt.forEach(t => {
    const k = t.wallet_id || '?';
    if (!mwtMap[k]) mwtMap[k] = {sum: 0, n: 0};
    const sign = String(t.type || '').toLowerCase().includes('credit') || String(t.type || '').toLowerCase() === 'deposit' ? 1 : -1;
    mwtMap[k].sum += sign * num(t.amount);
    mwtMap[k].n++;
  });
  console.log('\n  Merchant stored vs tx rollup:');
  mw.forEach(m => {
    const agg = mwtMap[m.id] || {sum:0, n:0};
    const delta = num(m.balance) - agg.sum;
    const ok = Math.abs(delta) < 0.005;
    console.log('    merch=' + String(m.merchant_id).substring(0,12) + '  bal=' + num(m.balance).toFixed(2) + '  txRollup=' + agg.sum.toFixed(2) + '  Δ=' + (delta>=0?'+':'') + delta.toFixed(2) + '  tx=' + agg.n + ' → ' + (ok ? '✅ OK' : '❌ MISMATCH'));
  });

  // ── E ────────────────────────────────────────────────────────
  scn('E. VAULT_ACCOUNTS + VAULT_LEDGER (offline reserve — CRITICAL real funds)');
  const va = q(`SELECT * FROM vault_accounts ORDER BY balance DESC`);
  printRows(va);
  const vl = q(`SELECT id, vault_account_id, tx_type, amount, balance_after, tx_reference, customer_id, created_at FROM vault_ledger ORDER BY created_at ASC`);
  console.log('\n  Vault ledger entries:');
  printRows(vl);
  console.log('\n  Vault account balance vs Σ(ledger running balance last row):');
  va.forEach(v => {
    const rows = vl.filter(r => r.vault_account_id === v.id);
    const derived = rows.length ? num(rows[rows.length-1].balance_after) : 0;
    const sumCredits = rows.filter(r=>String(r.tx_type||'').toUpperCase().includes('CREDIT')||String(r.tx_type||'').toUpperCase()==='DEPOSIT').reduce((s,r)=>s+num(r.amount),0);
    const sumDebits  = rows.filter(r=>String(r.tx_type||'').toUpperCase().includes('DEBIT')||String(r.tx_type||'').toUpperCase()==='WITHDRAW').reduce((s,r)=>s+num(r.amount),0);
    const delta = num(v.balance) - derived;
    console.log('    id=' + v.id.substring(0,8) + '  name=' + (v.account_name||'') + '  stored_bal=' + num(v.balance).toFixed(2) + v.currency + '  ledger_Σ(credits-debits)=' + (sumCredits-sumDebits).toFixed(2) + '  ledger_balance_after=' + derived.toFixed(2) + '  Δstored-derived=' + (delta>=0?'+':'') + delta.toFixed(2) + ' → ' + (Math.abs(delta)<0.005 && Math.abs(num(v.balance)-(sumCredits-sumDebits))<0.005 ? '✅ OK' : '❌ MISMATCH'));
  });

  // ── F ────────────────────────────────────────────────────────
  scn('F. CUSTOMER CRYPTO (customer_crypto_wallets) + merchant_crypto_balances');
  const ccw = q(`SELECT * FROM customer_crypto_wallets ORDER BY balance DESC`);
  printRows(ccw);
  const cctx = q(`SELECT id, customer_id, crypto_currency, amount, type, status, provider_mode, reference, tx_hash, created_at FROM crypto_transactions ORDER BY created_at ASC`);
  console.log('\n  Crypto transactions:');
  printRows(cctx);
  // Rollup per (customer + coin)
  const ccwMap = {};
  cctx.forEach(t => {
    const k = t.customer_id + '|' + t.crypto_currency;
    if (!ccwMap[k]) ccwMap[k] = {sum: 0, n:0};
    const sign = ['buy','deposit','swap_in','credit','mint'].includes(String(t.type).toLowerCase()) ? 1 : -1;
    ccwMap[k].sum += sign * num(t.amount);
    ccwMap[k].n++;
  });
  console.log('\n  Stored crypto balance vs crypto_transactions rollup:');
  ccw.forEach(c => {
    const agg = ccwMap[c.customer_id + '|' + c.crypto_currency] || {sum:0, n:0};
    const delta = num(c.balance) - agg.sum;
    console.log('    cust=' + String(c.customer_id).substring(0,12) + '  ' + c.crypto_currency + '  stored=' + num(c.balance).toFixed(8) + '  txRollup=' + agg.sum.toFixed(8) + '  Δ=' + (delta>=0?'+':'') + delta.toFixed(8) + '  txs=' + agg.n + ' → ' + (Math.abs(delta)<1e-6 ? '✅ OK' : '❌ MISMATCH'));
  });
  console.log('\n  merchant_crypto_balances:');
  const mcb = q(`SELECT * FROM merchant_crypto_balances ORDER BY balance DESC`);
  printRows(mcb);

  // ── G ────────────────────────────────────────────────────────
  scn('G. DELETED / MISSING REAL-FUND ROW SEARCH (SQLite rowid gaps + soft-delete)');
  const balTables = ['customer_wallets','merchant_wallets','customer_crypto_wallets','vault_accounts','accounts','wallet_transactions','merchant_wallet_transactions','crypto_transactions','vault_ledger','ledger_entries','ledger_transactions','core_payouts','payouts','pos_transactions','bank_transfer_transactions'];
  const gapReports = [];
  balTables.forEach(t => {
    try {
      const count = q(`SELECT COUNT(*) AS c FROM "${t}"`);
      const hasRowid = q(`SELECT MIN(rowid) AS mn, MAX(rowid) AS mx, COUNT(DISTINCT rowid) AS nr FROM "${t}"`);
      const mn = hasRowid[0]?.mn; const mx = hasRowid[0]?.mx; const nr = hasRowid[0]?.nr;
      const softDel = q(`SELECT COUNT(*) AS sd FROM "${t}" WHERE deleted_at IS NOT NULL`);
      const n = count[0]?.c ?? 0;
      const sd = softDel[0]?.sd ?? 0;
      const expected = (mx && mn) ? (mx - mn + 1) : nr;
      const missingRows = (nr != null && expected != null) ? Math.max(0, expected - nr) : 0;
      if (n > 0 || sd > 0 || missingRows > 0) {
        gapReports.push({t, n, sd, missingRows, mn, mx});
        console.log(`    ${t.padEnd(38)} rows=${String(n).padStart(4)}  soft-deleted=${sd}  rowid_gaps=${missingRows}  rowid_range=${mn??'NULL'}..${mx??'NULL'}`);
      }
    } catch (e) { /* table doesn't exist, skip */ }
  });

  // ── H ────────────────────────────────────────────────────────
  scn('H. GRAND TOTALS — ALL REAL-FUNDS ON BOOKS');
  const grand = { fiat: {}, crypto: {} };
  (cw||[]).forEach(w => { grand.fiat[w.currency] = (grand.fiat[w.currency]||0) + num(w.balance); });
  (mw||[]).forEach(w => { grand.fiat[w.currency] = (grand.fiat[w.currency]||0) + num(w.balance); });
  (va||[]).forEach(v => { grand.fiat[v.currency] = (grand.fiat[v.currency]||0) + num(v.balance); });
  const accRows = q(`SELECT currency, SUM(balance) AS b FROM accounts GROUP BY currency`);
  accRows.forEach(a => { grand.fiat[a.currency] = (grand.fiat[a.currency]||0) + num(a.b); });
  (ccw||[]).forEach(c => { grand.crypto[c.crypto_currency] = (grand.crypto[c.crypto_currency]||0) + num(c.balance); });
  (mcb||[]).forEach(m => { const cur = m.crypto_currency || m.currency || m.coin || '?'; grand.crypto[cur] = (grand.crypto[cur]||0) + num(m.balance); });
  console.log('  FIAT (USD, EUR, etc):');
  Object.keys(grand.fiat).sort().forEach(c => console.log('    ' + c.padEnd(6) + '  ' + grand.fiat[c].toFixed(2).padStart(14)));
  console.log('  CRYPTO:');
  Object.keys(grand.crypto).sort().forEach(c => console.log('    ' + c.padEnd(8) + '  ' + grand.crypto[c].toFixed(8).padStart(18)));

  // ── I ────────────────────────────────────────────────────────
  scn('I. RESTORE ACTIONS REQUIRED');
  const issues = [];

  // Check A: cust cc6f0711
  if (misW) {
    const agg = Object.values(wtxAgg).find(a => a.wallet_id === misW.id);
    const delta = num(misW.balance) - (agg ? agg.txSum : 0);
    if (Math.abs(delta) > 0.005) {
      issues.push({ severity: delta > 0 ? 'MEDIUM (phantom balance — no tx proof)' : 'HIGH (stolen — txs but balance missing)',
        wallet: 'customer cc6f0711', currency: misW.currency,
        stored: misW.balance, proven: agg ? agg.txSum : 0, delta,
        action: delta > 0 ? `SUBTRACT $${delta.toFixed(2)} from customer_wallets to match transactions (currently stored > proven)` : `ADD $${Math.abs(delta).toFixed(2)} (missing from wallet — tx prove it should be there)`,
        where: misW.id });
    }
  }

  // Merchant mismatches
  mw.forEach(m => {
    const agg = mwtMap[m.id] || {sum:0};
    const delta = num(m.balance) - agg.sum;
    if (Math.abs(delta) > 0.005) {
      issues.push({ severity: delta>0?'MEDIUM':'HIGH', wallet:'merchant ' + m.merchant_id,
        currency: m.currency, stored:m.balance, proven:agg.sum, delta,
        action: delta>0 ? `SUBTRACT $${delta.toFixed(2)} from merchant_wallets.id=${m.id}` : `ADD $${Math.abs(delta).toFixed(2)} to merchant_wallets.id=${m.id}`,
        where: m.id });
    }
  });

  // Vault mismatches
  va.forEach(v => {
    const rows = vl.filter(r => r.vault_account_id === v.id);
    const derived = rows.length ? num(rows[rows.length-1].balance_after) : 0;
    const delta = num(v.balance) - derived;
    if (Math.abs(delta) > 0.005) {
      issues.push({ severity: 'HIGH (vault = real reserve)', wallet:'vault_accounts ' + v.account_name,
        currency: v.currency, stored:v.balance, proven:derived, delta,
        action: delta>0 ? `SUBTRACT ${delta.toFixed(2)} from vault_accounts.id=${v.id}` : `ADD ${Math.abs(delta).toFixed(2)} to vault_accounts.id=${v.id}`,
        where: v.id });
    }
  });

  // Crypto mismatches
  ccw.forEach(c => {
    const agg = ccwMap[c.customer_id + '|' + c.crypto_currency] || {sum:0};
    const delta = num(c.balance) - agg.sum;
    if (Math.abs(delta) > 1e-6) {
      issues.push({ severity: delta>0?'MEDIUM':'HIGH', wallet:'crypto wallet '+c.customer_id+' '+c.crypto_currency,
        currency: c.crypto_currency, stored:c.balance, proven:agg.sum, delta,
        action: delta>0 ? `SUBTRACT ${delta.toFixed(8)} ${c.crypto_currency} from customer_crypto_wallets.id=${c.id}` : `ADD ${Math.abs(delta).toFixed(8)} ${c.crypto_currency} to customer_crypto_wallets.id=${c.id}`,
        where: c.id });
    }
  });

  if (issues.length === 0) {
    console.log('  ✅ No discrepancies found. All real-fund balances match transaction proof.');
  } else {
    console.log('  ⚠ ' + issues.length + ' balance vs. transaction-trail discrepancy(ies) found — SEE DETAILS:');
    issues.forEach((iss,i) => {
      console.log(`\n  [ISSUE ${i+1}] ${iss.severity}`);
      console.log(`      Wallet:         ${iss.wallet}`);
      console.log(`      Currency:       ${iss.currency}`);
      console.log(`      Stored balance: ${Number(iss.stored).toFixed(iss.currency && /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(iss.currency)?2:8)}`);
      console.log(`      Proven via tx:  ${Number(iss.proven).toFixed(iss.currency && /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(iss.currency)?2:8)}`);
      console.log(`      Δ (stored-proven): ${(iss.delta>=0?'+':'')} ${Number(iss.delta).toFixed(iss.currency && /USD|EUR|GBP|AED|NGN|CAD|JPY/.test(iss.currency)?2:8)}`);
      console.log(`      RECOMMENDED ACTION: ${iss.action}`);
      console.log(`      DB row id:      ${iss.where}`);
    });
    console.log('\n  ➡  Running restore SQL now (corrective updates) ...');
    // Actually apply the fixes now — make all stored balances = tx proof
    const rwDb = new SQL.Database(fs.readFileSync(DB_PATH));
    let backup = false;
    try {
      const backupBuf = fs.readFileSync(DB_PATH);
      const backupPath = DB_PATH + '.backup-' + Math.floor(Date.now()/1000);
      fs.writeFileSync(backupPath, backupBuf);
      console.log('  💾 Backup created: ' + backupPath);
      backup = true;
    } catch(e) { console.log('  ⚠ Could not create backup: ' + e.message); }
    issues.forEach((iss,i) => {
      if (Math.abs(iss.delta) < 1e-6) return;
      const sign = iss.delta > 0 ? 'balance = balance - ?' : 'balance = balance + ?';
      const absDelta = Math.abs(iss.delta);
      let sql = null;
      if (/^customer cc6f0711|customer_wallets/.test(iss.wallet) || String(iss.where).length === 36) {
        // Try customer first
        const check = rwDb.exec(`SELECT id FROM customer_wallets WHERE id='${iss.where}'`);
        if (check && check.length && check[0].values?.length) sql = `UPDATE customer_wallets SET ${sign}, updated_at = CURRENT_TIMESTAMP WHERE id = '${iss.where}'`;
        else {
          const check2 = rwDb.exec(`SELECT id FROM merchant_wallets WHERE id='${iss.where}'`);
          if (check2 && check2.length && check2[0].values?.length) sql = `UPDATE merchant_wallets SET ${sign}, updated_at = CURRENT_TIMESTAMP WHERE id = '${iss.where}'`;
          else {
            const check3 = rwDb.exec(`SELECT id FROM vault_accounts WHERE id='${iss.where}'`);
            if (check3 && check3.length && check3[0].values?.length) sql = `UPDATE vault_accounts SET ${sign}, updated_at = CURRENT_TIMESTAMP WHERE id = '${iss.where}'`;
            else {
              const check4 = rwDb.exec(`SELECT id FROM customer_crypto_wallets WHERE id='${iss.where}'`);
              if (check4 && check4.length && check4[0].values?.length) sql = `UPDATE customer_crypto_wallets SET ${sign}, updated_at = CURRENT_TIMESTAMP WHERE id = '${iss.where}'`;
            }
          }
        }
      }
      if (sql) {
        try {
          const stmt = rwDb.prepare(sql);
          stmt.bind([absDelta]);
          stmt.step();
          stmt.free();
          console.log(`  [FIX ${i+1}] ✅ Applied: ${sql.replace('?',absDelta)}`);
        } catch(e) { console.log(`  [FIX ${i+1}] ❌ FAILED: ${e.message}  SQL: ${sql}`); }
      } else {
        console.log(`  [FIX ${i+1}] ⚠ SKIPPED — couldn't resolve table for wallet id: ${iss.where}`);
      }
    });
    // Flush fixed DB back to disk
    try {
      const fixed = rwDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(fixed));
      rwDb.close();
      console.log('\n  💾 Corrected balances written back to ' + DB_PATH);
    } catch(e) {
      console.log('  ❌ Flush to disk failed: ' + e.message);
      process.exit(3);
    }
  }

  console.log('\n============================================================');
  console.log('  AUDIT + RESTORE COMPLETE');
  console.log('============================================================');
  db.close();
})().catch(e => { console.error('\n❌ FATAL:', e.message); console.error(e.stack); process.exit(1); });
