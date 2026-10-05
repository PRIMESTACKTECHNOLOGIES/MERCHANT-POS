const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MOCK_MARKERS = [
  'demo', 'test', 'mock', 'default_', 'johndoe', 'jane', 'placeholder',
  'sample', 'example', 'ghost', 'stub', 'unit', 'integration'
];
const MOCK_DOMAINS = ['example.com', 'test.com', 'mock.com', 'fake.com', 'demo.io'];
const MOCK_NAMES  = ['john doe', 'jane doe', 'test user', 'demo customer', 'mock account'];
const CARDHOLDER_HINTS_PAN_9999 = true;
const CVV999_HINT     = true;
const STATUS_CONFIRMED= ['APPROVED', 'AUTHORIZED', 'SETTLED', 'COMPLETED', 'PAID', 'SUCCESS', 'SUCCESSFUL', 'SYNCED', 'RECONCILED'];
const STATUS_REJECTED = ['DECLINED', 'FAILED', 'REJECTED', 'VOIDED', 'EXPIRED', 'REFUNDED', 'CANCELED', 'CANCELLED'];

function isMockCustomer(row) {
  const hay = [
    row.customer_id, row.name, row.email, row.phone,
    row.full_name, row.display_name, row.wallet_code
  ].map(v => String(v || '').toLowerCase()).join(' | ');
  if (!hay || hay.trim() === '| | | | | |') return false;
  for (const m of MOCK_MARKERS) if (hay.includes(m)) return true;
  for (const d of MOCK_DOMAINS) if (hay.includes(d)) return true;
  for (const n of MOCK_NAMES) if (hay.includes(n)) return true;
  return false;
}

function isMockTx(row) {
  const hay = [
    row.stan, row.auth_code, row.pan_masked, row.rrn, row.batch_id, row.pi_id,
    row.cardholder_name, row.cardholder_full, row.status, row.merchant_id,
    row.decline_reason, row.batch_file
  ].map(v => String(v || '').toLowerCase()).join(' | ');
  if (hay.trim() === '| | | | | | | | | | |') return false;
  for (const m of MOCK_MARKERS) if (hay.includes(m)) return true;
  if (CVV999_HINT && row.decline_reason && /cvv.*9|9.*cvv/.test(String(row.decline_reason).toLowerCase())) return true;
  return false;
}

function fmt(n, ccy='USD') {
  const v = Number(n||0);
  const sym = (ccy||'USD').toUpperCase()==='USD' ? '$' : '';
  return `${sym}${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${(ccy||'USD').toUpperCase()}`;
}

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname,'node_modules','sql.js','dist',f)
  });
  let db;
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    console.log('[!] DB does not exist:', DB_PATH);
    process.exit(1);
  }

  const tables = (db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]?.values||[]).map(r=>r[0]);
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('DATABASE FILE :', DB_PATH);
  console.log('TABLES        :', tables.length);
  console.log('═══════════════════════════════════════════════════════════════════');

  const q = (sql, params=[]) => {
    try {
      const r = db.exec(sql, params);
      if (!r || !r.length) return [];
      const [res] = r;
      return res.values.map(row => {
        const obj = {};
        res.columns.forEach((c, i) => obj[c] = row[i]);
        return obj;
      });
    } catch (e) { return []; }
  };
  const one = (sql, params=[]) => q(sql, params)[0];

  // ─── 1) RECEIPTS ──────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━ 1) EXISTING RECEIPTS IN DATABASE ━━━━━━━━━━━━━━━━━━');
  const totalReceipts = one("SELECT COUNT(*) AS c FROM receipts")?.c || 0;
  console.log(`TOTAL RECEIPTS ROWS : ${totalReceipts}`);
  const totalTx = one("SELECT COUNT(*) AS c FROM pos2013_transactions")?.c || 0;
  console.log(`TOTAL POS TX ROWS   : ${totalTx}`);

  const receipts = q(`
    SELECT r.receipt_id, r.transaction_id, r.generated_at,
           t.stan, t.amount_minor, t.currency, t.pan_masked,
           t.auth_code, t.status AS tx_status, t.txn_timestamp,
           t.batch_id, t.decline_reason
    FROM receipts r
    LEFT JOIN pos2013_transactions t ON r.transaction_id = t.id
    ORDER BY r.generated_at DESC
    LIMIT 30
  `);
  console.log(`\nLAST ${receipts.length} RECEIPTS (newest first):`);
  if (receipts.length === 0) {
    console.log('  (NONE — no receipts generated yet. Generate via POST /receipts/generate/:txId after any card transaction.)');
  } else {
    const txWithNoReceipt = one(`
      SELECT COUNT(*) AS c FROM pos2013_transactions t
      WHERE NOT EXISTS (SELECT 1 FROM receipts r WHERE r.transaction_id = t.id)
    `)?.c || 0;
    console.log(`  (Transactions missing receipt: ${txWithNoReceipt} — regenerate via dashboard → PRINT THERMAL)`);
    console.log('');
    receipts.forEach((r,i) => {
      const mock = isMockTx(r) ? ' [MOCK?]' : '';
      console.log(`${String(i+1).padStart(2,' ')}. ${r.receipt_id}  ${fmt(r.amount_minor, r.currency)}  ${String(r.tx_status||'').padEnd(11)}  STAN=${String(r.stan||'—').padEnd(8)}  card=${String(r.pan_masked||'—').padEnd(20)}  AUTH=${String(r.auth_code||'—').padEnd(14)}  ${new Date(r.generated_at||r.txn_timestamp).toLocaleString().padStart(21)}${mock}`);
    });
  }

  // ─── 2) DEMO / MOCK vs REAL DATA SPLIT ────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━ 2) MOCK vs REAL DATA IDENTIFICATION ━━━━━━━━━━━━━━━━━━');
  const customers = tables.includes('customers')
    ? q(`SELECT id, customer_id, name, email, phone, full_name, display_name, wallet_code, created_at FROM customers`)
    : [];
  const wallets = tables.includes('customer_wallets')
    ? q(`SELECT * FROM customer_wallets`)
    : [];
  const txList = q(`SELECT * FROM pos2013_transactions`);

  const cusMockCount = customers.filter(isMockCustomer).length;
  const cusRealCount = customers.length - cusMockCount;
  const txMockCount = txList.filter(isMockTx).length;
  const txRealCount = txList.length - txMockCount;
  console.log(`CUSTOMERS   : TOTAL=${customers.length}   REAL=${cusRealCount}   MOCK/DEMO=${cusMockCount}`);
  console.log(`POS TXNS    : TOTAL=${txList.length}   REAL=${txRealCount}   MOCK/DEMO=${txMockCount}`);
  console.log(`WALLETS     : TOTAL=${wallets.length}`);

  // ─── 3) CUSTOMER REAL BALANCES ────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━ 3) REAL CONFIRMED CUSTOMER BALANCES ━━━━━━━━━━━━━━━━━━');

  // Compute REAL customers list
  const realCustomers = customers
    .filter(c => !isMockCustomer(c))
    .sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));

  console.log(`\nFiltering rules applied for "REAL":`);
  console.log(`  • Customer name/email/id NOT IN (demo/test/mock/placeholder/example/sample/johndoe/ghost/stub)`);
  console.log(`  • NOT IN domains: example.com / test.com / mock.com / fake.com / demo.io`);
  console.log(`  • Balance = ledger-confirmed sum of deposits MINUS (settled withdrawals + payouts + crypto buys + transfers OUT)`);
  console.log(`  • EXCLUDE declined/pending/void transactions from balance math.`);
  console.log(`\nUsing source tables: customer_wallets (ledger column), wallet_transactions (status check)${tables.includes('ledger_entries') ? ', ledger_entries (final authoritative)' : ''}\n`);

  const statusFilter = STATUS_CONFIRMED.join("','");

  // Build authoritative customer balance table
  const cwMap = {};
  wallets.forEach(w => {
    const k = w.customer_id || w.customer || w.owner_id || w.id;
    if (k) cwMap[String(k).toLowerCase()] = w;
  });
  const cusMap = {};
  customers.forEach(c => {
    const k = (c.customer_id || c.id || '').toLowerCase();
    if (k) cusMap[k] = c;
  });

  // Ledger-based authoritative (best source)
  let ledgerBalances = {};
  if (tables.includes('ledger_entries')) {
    const rows = q(`
      SELECT customer_id, account_type, entry_type, amount, currency,
             status, reference, created_at
      FROM ledger_entries
      WHERE customer_id IS NOT NULL AND customer_id <> ''
    `);
    rows.forEach(r => {
      const k = String(r.customer_id||'').toLowerCase();
      if (!k) return;
      const ccy = r.currency || 'USD';
      if (!ledgerBalances[k]) ledgerBalances[k] = {};
      if (!ledgerBalances[k][ccy]) ledgerBalances[k][ccy] = { credit: 0, debit: 0, net: 0, rows: 0 };
      const stOk = STATUS_CONFIRMED.includes(String(r.status||'').toUpperCase());
      if (!stOk) return; // ONLY confirmed/successful ledger entries count
      const amt = Number(r.amount||0);
      if (String(r.entry_type||'').toLowerCase() === 'credit') ledgerBalances[k][ccy].credit += amt;
      else ledgerBalances[k][ccy].debit += amt;
      ledgerBalances[k][ccy].net = ledgerBalances[k][ccy].credit - ledgerBalances[k][ccy].debit;
      ledgerBalances[k][ccy].rows++;
    });
  }

  // Wallet txn backup source (wallet_transactions)
  let walletTxBalances = {};
  if (tables.includes('wallet_transactions')) {
    const rows = q(`SELECT customer_id, type, amount, currency, status FROM wallet_transactions`);
    rows.forEach(r => {
      const st = String(r.status||'').toUpperCase();
      if (STATUS_REJECTED.includes(st)) return;
      if (!STATUS_CONFIRMED.includes(st) && st !== 'CONFIRMED') return;
      const k = String(r.customer_id||'').toLowerCase();
      if (!k) return;
      const ccy = r.currency || 'USD';
      if (!walletTxBalances[k]) walletTxBalances[k] = {};
      if (!walletTxBalances[k][ccy]) walletTxBalances[k][ccy] = 0;
      const t = String(r.type||'').toLowerCase();
      const amt = Number(r.amount||0);
      const adds = ['deposit','credit','in','transfer_in','received','refund','reward','cashback','sale','settle','settlement'];
      const subs = ['withdrawal','debit','out','transfer_out','send','fee','payout','purchase','crypto_purchase','buy_crypto'];
      if (adds.some(a => t.includes(a))) walletTxBalances[k][ccy] += amt;
      else if (subs.some(a => t.includes(a))) walletTxBalances[k][ccy] -= amt;
    });
  }

  // Customer_wallets current_balance column (direct value; verify against ledger)
  // Print final report
  const ALL = customers.length === 0 && wallets.length > 0
    ? wallets.map(w => ({ customer_id: w.customer_id||w.id, name: w.customer_name||'?', email: '' }))
    : customers;
  const ALL_REAL = ALL.filter(c => !isMockCustomer(c));
  if (ALL_REAL.length === 0) {
    console.log('⚠  No REAL customers found in DB. Only MOCK/DEMO customers exist:');
    customers.slice(0,10).forEach(c => {
      const id = (c.customer_id||c.id||'?').slice(0,12);
      console.log(`     - ${String(c.name||'').padEnd(24)}  id=${id}  email=${c.email||'—'}`);
    });
    if (customers.length > 10) console.log(`     ... and ${customers.length - 10} more mock customers.`);
  } else {
    console.log(`FOUND ${ALL_REAL.length} REAL CUSTOMERS. BALANCE PER CUSTOMER BELOW:\n`);
    const lines = [];
    lines.push('#'.padEnd(3) + ' | ' + 'CUSTOMER'.padEnd(26) + ' | ' + 'ID'.padEnd(14) + ' | ' + 'WALLET_CODE'.padEnd(16) + ' | ' + 'WALLET_BAL (col)'.padEnd(18) + ' | ' + 'LEDGER_NET'.padEnd(16) + ' | ' + 'WALLET_TX_NET'.padEnd(16) + ' | ' + 'CURRENCY'.padEnd(6) + ' | ' + 'VERIFIED?');
    lines.push('-'.repeat(200));
    let grand = {};
    ALL_REAL.forEach((c, i) => {
      const key = (c.customer_id || c.id || '').toLowerCase();
      const cw = cwMap[key];
      const cid = String(c.customer_id || c.id || '').slice(0,14);
      const name = String(c.name || c.full_name || c.display_name || '').padEnd(26, ' ').slice(0,26);
      const wcode = cw?.wallet_code ? String(cw.wallet_code).slice(0,16).padEnd(16) : '—'.padEnd(16);
      const ccyCol = cw?.currency || 'USD';
      const directBal = cw ? Number(cw.current_balance || cw.balance || cw.balance_usd || 0) : 0;
      const direct = directBal;
      const ledgersForCus = ledgerBalances[key] || {};
      const wtxForCus = walletTxBalances[key] || {};
      const ccys = new Set([
        ...Object.keys(ledgersForCus),
        ...Object.keys(wtxForCus),
        ccyCol
      ]);
      const ccysArr = ccys.size > 0 ? [...ccys] : ['USD'];
      ccysArr.forEach((ccy, idx) => {
        const led = ledgersForCus[ccy]?.net ?? null;
        const wtx = wtxForCus[ccy] ?? null;
        const dir = (ccy === ccyCol) ? direct : null;
        const sources = [dir, led, wtx].filter(v => v !== null && v !== undefined);
        const best = sources.length ? Math.min(...sources.map(v=>Number(v||0))) : 0; // conservative
        const match3 = sources.length >= 2 && sources.every(v => Math.abs(Number(v) - Number(sources[0])) < 0.01);
        const matchAny2 = (() => {
          if (sources.length < 2) return false;
          for (let a=0;a<sources.length;a++)
            for (let b=a+1;b<sources.length;b++)
              if (Math.abs(Number(sources[a])-Number(sources[b])) < 0.01) return true;
          return false;
        })();
        const verified = sources.length >= 3 ? match3 : (sources.length === 2 ? matchAny2 : false);
        grand[ccy] = (grand[ccy]||0) + (led ?? dir ?? wtx ?? 0);
        const col1 = idx === 0 ? (String(i+1).padEnd(3) + ' | ' + name + ' | ' + cid.padEnd(14) + ' | ' + wcode)
                                 : ('    | ' + ' '.repeat(26) + ' | ' + ' '.repeat(14) + ' | ' + ' '.repeat(16));
        lines.push(col1 + ' | ' + (dir !== null ? fmt(dir, ccy).padStart(18) : ' '.repeat(18))
                  + ' | ' + (led !== null ? fmt(led, ccy).padStart(16) : ' '.repeat(16))
                  + ' | ' + (wtx !== null ? fmt(wtx, ccy).padStart(16) : ' '.repeat(16))
                  + ' | ' + ccy.padEnd(6)
                  + ' | ' + (verified ? '✅ TRIPLE-MATCH' : (sources.length === 1 ? '⚠  1 SOURCE ONLY' : (matchAny2 ? '⚠  2/3 MATCH' : '⚠  MISMATCH — REVIEW'))));
      });
    });
    lines.push('-'.repeat(200));
    const totals = Object.entries(grand);
    if (totals.length > 0) {
      lines.push('GRAND TOTALS (per currency, authoritative = LEDGER_NET else WALLET_BAL):');
      totals.forEach(([ccy,v]) => lines.push('  • ' + fmt(v, ccy)));
    }
    console.log(lines.join('\n'));
  }

  // ─── 4) REAL MERCHANT SIDE ────────────────────────────────────────────────
  console.log('\n\n━━━━━━━━━━━━━━━━━ 4) REAL MERCHANT SETTLEMENT / WALLET POSITION ━━━━━━━━━━━━━━━━━━');
  if (tables.includes('merchant_wallet_transactions') || tables.includes('merchant_pos_settlements')) {
    const unsettled = one(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt, COALESCE(SUM(CASE WHEN status='unsettled' THEN amount ELSE 0 END),0) AS uamt FROM merchant_pos_settlements`) || { c:0, amt:0, uamt:0 };
    const settled = one(`SELECT COALESCE(SUM(amount),0) AS amt FROM merchant_pos_settlements WHERE status IN ('settled','paid','completed')`) || { amt:0 };
    console.log(`merchant_pos_settlements rows = ${unsettled.c}`);
    console.log(`  • TOTAL (all statuses)      : ${fmt(unsettled.amt)}`);
    console.log(`  • UNSETTLED (pending T+? )  : ${fmt(unsettled.uamt)}`);
    console.log(`  • SETTLED / PAID            : ${fmt(settled.amt)}`);
    if (tables.includes('merchant_wallets')) {
      const mrw = q(`SELECT * FROM merchant_wallets`);
      if (mrw.length) {
        console.log(`\nmerchant_wallets direct rows (${mrw.length}):`);
        mrw.forEach(m => {
          const bal = Number(m.current_balance || m.balance || m.balance_usd || 0);
          const ccy = m.currency || 'USD';
          const mid = (m.merchant_id || m.id || '?').slice(0,14);
          console.log(`  • merchant_id=${mid}   wallet=${m.wallet_code||m.wallet_id||'—'}   balance=${fmt(bal, ccy)}`);
        });
      }
    }
  } else {
    console.log('(no merchant_settlements / merchant_wallets tables in this DB snapshot)');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════ END');
})();
