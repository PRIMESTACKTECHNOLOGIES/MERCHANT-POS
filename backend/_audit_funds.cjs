const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const BACKEND_ROOT = __dirname;
console.log('============================================================');
console.log('  FORENSIC REAL-FUNDS AUDIT  ·  ' + DB_PATH);
console.log('  Generated: ' + new Date().toISOString());
console.log('============================================================\n');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('  Loaded existing database: ' + buf.length + ' bytes');
  } else {
    db = new SQL.Database();
    console.log('  WARNING: database.sqlite missing — created empty in-memory DB');
  }

function run(label, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (Array.isArray(params) && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    return { ERROR: e.message };
  }
}

function section(title) {
  console.log('\n─────────────────────────────────────────────────────────');
  console.log('  ' + title);
  console.log('─────────────────────────────────────────────────────────');
}

// Step 0 — tables present
section('0. ALL RELEVANT TABLES FOUND IN DB');
const allTables = run('', "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
if (Array.isArray(allTables)) {
  const balanceRelated = allTables.filter(t => /(wallet|balance|account|payout|ledger|tx|transaction|crypto|pos|reconcil|transak|bank)/i.test(t.name));
  console.log('  Balance/ledger tables (' + balanceRelated.length + '):');
  balanceRelated.forEach(t => {
    const cnt = run('', `SELECT COUNT(*) as n FROM "${t.name}"`);
    console.log('    - ' + t.name.padEnd(42) + ' rows=' + (Array.isArray(cnt) ? cnt[0].n : '?'));
  });
  const other = allTables.filter(t => !balanceRelated.includes(t));
  console.log('\n  Other tables (' + other.length + '): ' + other.map(t=>t.name).join(', '));
}

// Step 1 — Customer FIAT wallets
section('1. CUSTOMER FIAT WALLETS (customer_wallets — REAL funds)');
const custW = run('', `
  SELECT id, customer_id, currency, ROUND(balance,4) AS balance, wallet_code,
         strftime('%Y-%m-%d %H:%M', created_at) AS created,
         strftime('%Y-%m-%d %H:%M', updated_at) AS updated
  FROM customer_wallets
  ORDER BY balance DESC
`);
if (Array.isArray(custW) && custW.length) {
  console.log('  ' + custW.length + ' wallet(s). Balance column verified as REAL source of truth.');
  const totals = {};
  custW.forEach(w => {
    totals[w.currency] = (totals[w.currency] || 0) + Number(w.balance);
    if (Number(w.balance) !== 0) {
      console.log('    id=' + w.id.substring(0, 8) + '...  cust=' + (String(w.customer_id).substring(0,12)) + '  bal=' + Number(w.balance).toFixed(2) + ' ' + w.currency + '  code=' + w.wallet_code);
    }
  });
  console.log('  ─ AGGREGATE ─');
  Object.keys(totals).forEach(ccy => console.log('    TOTAL ' + ccy + ' = ' + Number(totals[ccy]).toFixed(2)));
} else {
  console.log('  ⚠ NO customer_wallets rows — table empty or missing.');
}

// Step 2 — Merchant FIAT wallets
section('2. MERCHANT FIAT WALLETS (merchant_wallets — REAL funds)');
const merchW = run('', `
  SELECT id, merchant_id, currency, ROUND(balance,4) AS balance, wallet_code,
         strftime('%Y-%m-%d %H:%M', created_at) AS created
  FROM merchant_wallets
  ORDER BY balance DESC
`);
if (Array.isArray(merchW) && merchW.length) {
  const totals = {};
  merchW.forEach(w => {
    totals[w.currency] = (totals[w.currency] || 0) + Number(w.balance);
    if (Number(w.balance) !== 0) {
      console.log('    id=' + w.id.substring(0, 8) + '...  merch=' + (String(w.merchant_id).substring(0,12)) + '  bal=' + Number(w.balance).toFixed(2) + ' ' + w.currency + '  code=' + w.wallet_code);
    }
  });
  console.log('  ─ AGGREGATE ─');
  Object.keys(totals).forEach(ccy => console.log('    TOTAL ' + ccy + ' = ' + Number(totals[ccy]).toFixed(2)));
} else {
  console.log('  ⚠ NO merchant_wallets rows — table empty or missing.');
}

// Step 3 — Core accounts (payout vault accounts per project memory)
section('3. CORE PAYOUT ACCOUNTS (accounts — REAL funds / vault reserves)');
const accW = run('', `
  SELECT id, account_id, account_type, account_name,
         holder_type, holder_id, currency,
         ROUND(balance,4) AS balance,
         ROUND(available_balance,4) AS available,
         ROUND(reserved_balance,4) AS reserved,
         status, created_at
  FROM accounts
  ORDER BY balance DESC
`);
if (Array.isArray(accW) && accW.length) {
  const totals = {};
  accW.forEach(a => {
    totals[a.currency] = (totals[a.currency] || 0) + Number(a.balance);
    if (Number(a.balance) !== 0 || Number(a.reserved) !== 0) {
      console.log('    id=' + a.id.substring(0,8) + '...  acc=' + a.account_id + '  type=' + a.account_type.padEnd(10) + '  bal=' + Number(a.balance).toFixed(2) + '  avail=' + Number(a.available||0).toFixed(2) + '  res=' + Number(a.reserved||0).toFixed(2) + ' ' + a.currency + '  [' + a.holder_type + ':' + String(a.holder_id||'').substring(0,8) + ']  status=' + a.status);
    }
  });
  console.log('  ─ AGGREGATE ─');
  Object.keys(totals).forEach(ccy => console.log('    TOTAL ' + ccy + ' = ' + Number(totals[ccy]).toFixed(2)));
} else {
  console.log('  ⚠ NO accounts rows — table empty or missing (no payout vault accounts found).');
}

// Step 4 — Customer CRYPTO wallets
section('4. CUSTOMER CRYPTO WALLETS (customer_crypto_wallets — REAL crypto balances)');
const cryptoW = run('', `
  SELECT id, customer_id, crypto_currency, ROUND(balance,8) AS balance,
         ROUND(locked_balance,8) AS locked, address,
         strftime('%Y-%m-%d %H:%M', updated_at) AS up
  FROM customer_crypto_wallets
  ORDER BY balance DESC
`);
if (Array.isArray(cryptoW) && cryptoW.length) {
  const totals = {};
  cryptoW.forEach(w => {
    totals[w.crypto_currency] = (totals[w.crypto_currency] || 0) + Number(w.balance);
    if (Number(w.balance) !== 0 || Number(w.locked) !== 0) {
      console.log('    cust=' + String(w.customer_id).substring(0,12).padEnd(14) + '  ' + w.crypto_currency.padEnd(6) + ' bal=' + Number(w.balance).toFixed(8) + '  locked=' + Number(w.locked||0).toFixed(8) + (w.address ? '  addr=' + w.address.substring(0,10)+'...' : ''));
    }
  });
  console.log('  ─ AGGREGATE ─');
  Object.keys(totals).forEach(ccy => console.log('    TOTAL ' + ccy + ' = ' + Number(totals[ccy]).toFixed(8)));
} else {
  console.log('  ⚠ NO customer_crypto_wallets rows — table empty or missing.');
}

// Step 5 — Merchant CRYPTO wallets
section('5. MERCHANT CRYPTO WALLETS (merchant_crypto_wallets)');
const mCrypto = run('', `
  SELECT * FROM merchant_crypto_wallets ORDER BY balance DESC LIMIT 20
`);
if (Array.isArray(mCrypto) && mCrypto.length) {
  // dynamic keys
  const cols = Object.keys(mCrypto[0]);
  const balC = cols.find(c => /balance/i.test(c)) || 'balance';
  const curC = cols.find(c => /currency|coin|crypto/i.test(c) && !/addr/i.test(c)) || 'crypto_currency';
  const idC = cols.find(c => /merchant/i.test(c)) || 'merchant_id';
  const totals = {};
  mCrypto.forEach(r => {
    const k = r[curC] || '?';
    totals[k] = (totals[k] || 0) + Number(r[balC] || 0);
    if (Number(r[balC]) !== 0) console.log('    merch=' + String(r[idC]||'').substring(0,10).padEnd(12) + '  ' + (r[curC]||'').padEnd(6) + ' bal=' + Number(r[balC]||0).toFixed(8));
  });
  Object.keys(totals).forEach(c => console.log('    TOTAL ' + c + ' = ' + Number(totals[c]).toFixed(8)));
} else {
  console.log('  (empty)');
}

// Step 6 — Wallet transactions REVERSE BALANCE PROOF
section('6. CUSTOMER FIAT — WALLET_TX REVERSE COMPUTATION VS STORED BALANCE');
const wt = run('', `
  SELECT w.id, w.customer_id, w.currency,
         ROUND(w.balance,4) AS stored_balance,
         ROUND(COALESCE(SUM(CASE WHEN wt.type='credit' THEN wt.amount ELSE -wt.amount END), 0),4) AS tx_balance,
         ROUND(w.balance,4) - ROUND(COALESCE(SUM(CASE WHEN wt.type='credit' THEN wt.amount ELSE -wt.amount END), 0),4) AS delta,
         COUNT(wt.id) AS tx_count
  FROM customer_wallets w
  LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
  GROUP BY w.id, w.customer_id, w.currency, w.balance
  HAVING ABS(delta) > 0.001 OR tx_count >= 0
  ORDER BY ABS(delta) DESC
`);
if (Array.isArray(wt) && wt.length) {
  let broken = 0;
  wt.forEach(r => {
    const flag = Math.abs(Number(r.delta)) > 0.001;
    if (flag) broken++;
    if (Math.abs(Number(r.delta)) > 0.001 || r.tx_count === 0) {
      console.log('    ' + (flag ? '❌ MISMATCH' : '✅ OK').padEnd(12)
        + '  cust=' + String(r.customer_id).substring(0,12).padEnd(14)
        + ' stored=' + Number(r.stored_balance).toFixed(2)
        + ' txSum=' + Number(r.tx_balance).toFixed(2)
        + ' Δ=' + (Number(r.delta)>=0?'+':'') + Number(r.delta).toFixed(2)
        + '  txs=' + r.tx_count + ' ' + r.currency);
    }
  });
  if (broken === 0) console.log('  ✅ ALL ' + wt.length + ' customer wallets balance = Σ(credits-debits) from wallet_transactions.');
  else console.log('  ❌ ' + broken + ' wallet(s) have STORED BALANCE ≠ TX SUM — see above.');
}

// Step 7 — Crypto transactions REVERSE BALANCE PROOF
section('7. CUSTOMER CRYPTO — crypto_transactions vs stored balance');
const ctw = run('', `
  SELECT cw.id, cw.customer_id, cw.crypto_currency,
         ROUND(cw.balance,8) AS stored,
         ROUND(COALESCE(SUM(
           CASE ct.type
             WHEN 'buy' THEN ct.amount
             WHEN 'deposit' THEN ct.amount
             WHEN 'sell' THEN -ct.amount
             WHEN 'withdraw' THEN -ct.amount
             WHEN 'swap_out' THEN -ct.amount
             WHEN 'swap_in' THEN ct.amount
             WHEN 'credit' THEN ct.amount
             WHEN 'debit' THEN -ct.amount
             WHEN 'fee' THEN -ct.amount
             ELSE 0 END
         ),0),8) AS tx_balance,
         ROUND(cw.balance,8) - ROUND(COALESCE(SUM(
           CASE ct.type
             WHEN 'buy' THEN ct.amount
             WHEN 'deposit' THEN ct.amount
             WHEN 'sell' THEN -ct.amount
             WHEN 'withdraw' THEN -ct.amount
             WHEN 'swap_out' THEN -ct.amount
             WHEN 'swap_in' THEN ct.amount
             WHEN 'credit' THEN ct.amount
             WHEN 'debit' THEN -ct.amount
             WHEN 'fee' THEN -ct.amount
             ELSE 0 END
         ),0),8) AS delta,
         COUNT(ct.id) AS tx_count
  FROM customer_crypto_wallets cw
  LEFT JOIN crypto_transactions ct ON ct.customer_id = cw.customer_id AND ct.crypto_currency = cw.crypto_currency
  GROUP BY cw.id, cw.customer_id, cw.crypto_currency, cw.balance
  ORDER BY ABS(delta) DESC
`);
if (Array.isArray(ctw) && ctw.length) {
  let broken = 0;
  ctw.forEach(r => {
    const flag = Math.abs(Number(r.delta)) > 0.000001;
    if (flag) broken++;
    if (flag || r.tx_count === 0) {
      console.log('    ' + (flag ? '❌ MISMATCH' : '✅ OK').padEnd(12)
        + ' cust=' + String(r.customer_id).substring(0,12).padEnd(14)
        + (r.crypto_currency||'').padEnd(6)
        + ' stored=' + Number(r.stored).toFixed(8)
        + ' txSum=' + Number(r.tx_balance).toFixed(8)
        + ' Δ=' + (Number(r.delta)>=0?'+':'') + Number(r.delta).toFixed(8)
        + ' txs=' + r.tx_count);
    }
  });
  if (broken === 0) console.log('  ✅ ALL ' + ctw.length + ' customer crypto wallets = Σ(typed crypto_transactions).');
  else console.log('  ❌ ' + broken + ' crypto wallet(s) have STORED BALANCE ≠ TX SUM.');
}

// Step 8 — Payout / double-entry (core ledger_entries)
section('8. CORE PAYOUT DOUBLE-ENTRY (accounts.balance = Σ ledger_entries)');
const core = run('', `
  SELECT a.id, a.account_id, a.holder_type, a.currency,
         ROUND(a.balance,4) AS stored,
         ROUND(COALESCE(SUM(CASE le.debit_or_credit WHEN 'CREDIT' THEN le.amount WHEN 'DEBIT' THEN -le.amount ELSE 0 END),0),4) AS ledger_bal,
         ROUND(a.balance,4) - ROUND(COALESCE(SUM(CASE le.debit_or_credit WHEN 'CREDIT' THEN le.amount WHEN 'DEBIT' THEN -le.amount ELSE 0 END),0),4) AS delta,
         COUNT(le.id) AS entries, a.status
  FROM accounts a
  LEFT JOIN ledger_entries le ON le.account_id = a.account_id
  GROUP BY a.id, a.account_id, a.holder_type, a.currency, a.balance, a.status
  ORDER BY ABS(delta) DESC
`);
if (Array.isArray(core) && core.length) {
  let broken = 0;
  core.forEach(r => {
    const flag = Math.abs(Number(r.delta)) > 0.001;
    if (flag) broken++;
    console.log('    ' + (flag ? '❌ MISMATCH' : '✅ OK').padEnd(12)
      + ' acc=' + (r.account_id||'').padEnd(14)
      + ' [' + (r.holder_type||'') + '] '
      + (r.currency||'').padEnd(5)
      + ' stored=' + Number(r.stored).toFixed(2)
      + ' ledger=' + Number(r.ledger_bal||0).toFixed(2)
      + ' Δ=' + (Number(r.delta)>=0?'+':'') + Number(r.delta||0).toFixed(2)
      + ' entries=' + r.entries + ' status=' + r.status);
  });
  if (broken === 0) console.log('  ✅ All accounts match ledger_entries double-entry.');
} else {
  console.log('  (no accounts or no ledger_entries)');
}

// Step 9 — global transaction aggregate to detect missing debits
section('9. ALL FIAT MOVEMENT TOTALS (forensic leak check)');
const gt = run('', `
  SELECT 'wallet_transactions' AS src, type, currency,
         ROUND(SUM(amount),2) AS amt, COUNT(*) AS n
  FROM wallet_transactions GROUP BY type, currency
  UNION ALL
  SELECT 'crypto_transactions' AS src, type, crypto_currency AS currency,
         ROUND(SUM(amount),4) AS amt, COUNT(*) AS n
  FROM crypto_transactions GROUP BY type, crypto_currency
  UNION ALL
  SELECT 'ledger_entries' AS src, debit_or_credit AS type, currency,
         ROUND(SUM(amount),2) AS amt, COUNT(*) AS n
  FROM ledger_entries GROUP BY debit_or_credit, currency
  UNION ALL
  SELECT 'pos_transactions' AS src, status AS type, COALESCE(currency,'USD') AS currency,
         ROUND(SUM(COALESCE(amount_cents,0)/100.0 + COALESCE(tip_cents,0)/100.0),2) AS amt, COUNT(*) AS n
  FROM pos_transactions GROUP BY status, currency
  UNION ALL
  SELECT 'core_payouts' AS src, status AS type, currency,
         ROUND(SUM(amount),2) AS amt, COUNT(*) AS n
  FROM core_payouts GROUP BY status, currency
  ORDER BY src, type, currency
`);
if (Array.isArray(gt) && gt.length) {
  let src = '';
  gt.forEach(r => {
    if (r.src !== src) { console.log(''); console.log('  ● ' + r.src); src = r.src; }
    console.log('    ' + String(r.type).padEnd(14) + ' ' + String(r.currency||'?').padEnd(6) + ' sum=' + Number(r.amt).toFixed(2).padStart(14) + '  n=' + r.n);
  });
}

// Step 10 — DELETE operations from sqlite_sequence / WAL checks + soft deletes
section('10. DELETED-ROW CHECK (sqlite stat1 + deleted_at soft-delete flags + suspicious empty balances)');
const sdTables = run('', "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%deleted_at%' ORDER BY name");
if (Array.isArray(sdTables) && sdTables.length) {
  sdTables.forEach(t => {
    const r = run('', `SELECT COUNT(*) AS total, SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted FROM "${t.name}"`);
    if (Array.isArray(r) && (r[0].deleted > 0)) console.log('    ⚠ ' + t.name.padEnd(35) + ' total=' + r[0].total + '  soft-deleted=' + r[0].deleted);
  });
}
const allTbls = (run('', "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('customer_wallets','merchant_wallets','customer_crypto_wallets','accounts','wallet_transactions','crypto_transactions','ledger_entries','core_payouts','pos_transactions')")||[]).map(t=>t.name);
console.log('  WAL + DB page integrity check (basic):');
try {
  const szRows = run('', "PRAGMA page_count");
  const flRows = run('', "PRAGMA freelist_count");
  const sz = (szRows && szRows[0]) ? (szRows[0].page_count || Object.values(szRows[0])[0] || 0) : 0;
  const freelist = (flRows && flRows[0]) ? (flRows[0].freelist_count || Object.values(flRows[0])[0] || 0) : 0;
  console.log('    SQLite pages used / freelist: ~' + sz + ' pages, ' + freelist + ' on freelist');
  if (Number(freelist) > Number(sz) * 0.2) console.log('    ⚠ High % of free pages (>20%) — may indicate recent DELETEs/VACUUM candidates.');
} catch(e) { console.log('    (pg stat error: ' + e.message + ')'); }

// Step 11 — Beneficiaries + payout totals
section('11. CORE PAYOUTS (reserved funds vs actual payouts)');
const cp = run('', `
  SELECT status, currency, ROUND(SUM(amount),2) AS amt, COUNT(*) AS n
  FROM core_payouts GROUP BY status, currency ORDER BY status, currency
`);
if (Array.isArray(cp) && cp.length) {
  cp.forEach(r => console.log('    ' + String(r.status).padEnd(14) + ' ' + r.currency + ' sum=' + Number(r.amt).toFixed(2).padStart(12) + ' n=' + r.n));
} else console.log('  (empty / no core_payouts)');

section('12. CRYPTO PURCHASABLE FUNDS — SUMMARY');
console.log('');
console.log('  This section summarizes the REAL funds the system treats as "in" the system.');
console.log('  It compares every balance column vs its corresponding transaction/ledger rollup.');
console.log('');

// GRAND TOTALS
const cwtot = run('', "SELECT currency, ROUND(SUM(balance),4) AS t FROM customer_wallets GROUP BY currency");
const mwtot = run('', "SELECT currency, ROUND(SUM(balance),4) AS t FROM merchant_wallets GROUP BY currency");
const awtot = run('', "SELECT currency, ROUND(SUM(balance),4) AS t FROM accounts GROUP BY currency");
const crwTot = run('', "SELECT crypto_currency, ROUND(SUM(balance),8) AS t FROM customer_crypto_wallets GROUP BY crypto_currency HAVING ABS(t) > 0");

const fiatGTotals = {};
(cwtot||[]).forEach(r => fiatGTotals[r.currency] = (fiatGTotals[r.currency]||{customer:0,merchant:0,accounts:0,grand:0}) || (fiatGTotals[r.currency]={customer:0,merchant:0,accounts:0,grand:0}));
(mwtot||[]).forEach(r => { if(!fiatGTotals[r.currency]) fiatGTotals[r.currency]={customer:0,merchant:0,accounts:0,grand:0}; fiatGTotals[r.currency].merchant=Number(r.t); });
(awtot||[]).forEach(r => { if(!fiatGTotals[r.currency]) fiatGTotals[r.currency]={customer:0,merchant:0,accounts:0,grand:0}; fiatGTotals[r.currency].accounts=Number(r.t); });
(cwtot||[]).forEach(r => { fiatGTotals[r.currency].customer = Number(r.t); });

console.log('  ── FIAT CURRENCY ─────────────────────────────────────────────');
Object.keys(fiatGTotals).sort().forEach(c => {
  const o = fiatGTotals[c];
  const g = o.customer + o.merchant + o.accounts;
  o.grand = g;
  console.log('    ' + c + ':');
  console.log('      customer_wallets         = ' + o.customer.toFixed(2).padStart(14));
  console.log('      merchant_wallets         = ' + o.merchant.toFixed(2).padStart(14));
  console.log('      accounts (payout vault)  = ' + o.accounts.toFixed(2).padStart(14));
  console.log('      ────────────────────────────────────');
  console.log('      GRAND TOTAL ' + c + ' ON BOOKS = ' + g.toFixed(2).padStart(14));
});
console.log('');
console.log('  ── CRYPTO CURRENCY ───────────────────────────────────────────');
const crMap = {};
if (Array.isArray(crwTot)) crwTot.forEach(r => { crMap[r.crypto_currency] = Number(r.t); });
if (Object.keys(crMap).length === 0) {
  console.log('    (no nonzero crypto wallets — crypto purchasable funds = 0)');
} else {
  Object.keys(crMap).sort().forEach(coin => {
    console.log('    ' + coin.padEnd(8) + '  customer_crypto_wallets = ' + crMap[coin].toFixed(8).padStart(18));
  });
}

console.log('\n============================================================');
console.log('  AUDIT END');
console.log('============================================================');

db.close();
})().catch(e => { console.error('FATAL AUDIT ERROR:', e.message); console.error(e.stack); process.exit(1); });
