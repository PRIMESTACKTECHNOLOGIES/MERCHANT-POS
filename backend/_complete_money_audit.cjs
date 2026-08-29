const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(DB);
const Q = function(s, p) { p = p || []; return new Promise(function(rs, rj) { db.all(s, p, function(e, r) { e ? rj(e) : rs(r); }); }); };
const f = function(n, cur) {
  n = Number(n||0);
  var sym = (cur || 'USD').toUpperCase();
  var sign = '';
  if (sym === 'USD') sign = '$';
  else if (sym === 'EUR') sign = '\u20AC';
  else if (sym === 'GBP') sign = '\u00A3';
  else sign = sym + ' ';
  return sign + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fc = function(n, coin) {
  return Number(n||0).toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 }) + ' ' + String(coin||'?');
};

(async function() {
  try {
    console.log('');
    console.log('==============================================================');
    console.log('  COMPLETE MONEY AUDIT  |  FULL DB STATE  |  ALL FUNDS');
    console.log('==============================================================');
    console.log('DB  : ' + DB);
    console.log('Run : ' + new Date().toISOString());
    console.log('');
    const H = function(title) { console.log(''); console.log('=============================================================='); console.log('  ' + title); console.log('--------------------------------------------------------------'); };

    // ---------------------------------------------------------------
    H('1. POS2013_TRANSACTIONS  (Card Charges / Top-ups)');
    // ---------------------------------------------------------------
    const pos = await Q('SELECT auth_code, amount_minor, currency, status, txn_timestamp, pan_masked, local_txn_id, batch_id, settled_at, merchant_id, terminal_id FROM pos2013_transactions ORDER BY datetime(txn_timestamp) ASC');
    if (pos.length === 0) console.log('   (no rows)');
    else {
      console.log(String('#').padEnd(3) + ' ' + String('Auth').padEnd(10) + ' ' + String('Amount').padStart(22) + ' ' + String('Cur').padEnd(5) + ' ' + String('Status').padEnd(12) + ' ' + String('Date').padEnd(22) + ' PAN / Details');
      var posBy = {};
      pos.forEach(function(r, i) {
        var cur = (r.currency || 'USD').toUpperCase();
        var amt = Number(r.amount_minor) / 100;
        if (!posBy[cur]) posBy[cur] = { total: 0, count: 0, byStatus: {} };
        posBy[cur].total += amt; posBy[cur].count++;
        var st = r.status || '(null)';
        if (!posBy[cur].byStatus[st]) posBy[cur].byStatus[st] = { total: 0, count: 0 };
        posBy[cur].byStatus[st].total += amt; posBy[cur].byStatus[st].count++;
        var n = String(i+1).padEnd(3);
        var auth = String(r.auth_code||'').padEnd(10);
        var sst = String(st).padEnd(12);
        var dt = String(r.txn_timestamp||'').slice(0,22).padEnd(22);
        var pan = r.pan_masked || '(no PAN)';
        var sethint = r.settled_at ? ' [settled]' : ' [UNSETTLED]';
        console.log(n + ' ' + auth + ' ' + f(amt, cur).padStart(22) + ' ' + cur.padEnd(5) + ' ' + sst + ' ' + dt + ' ' + pan + sethint);
      });
      console.log('');
      console.log('   AGGREGATE BY CURRENCY + STATUS:');
      var allPOS = 0;
      Object.keys(posBy).forEach(function(cur) {
        var o = posBy[cur];
        allPOS += o.total;
        console.log('   ' + cur.padEnd(5) + '  TOTAL: ' + f(o.total, cur).padStart(22) + '  (' + o.count + ' txns)');
        Object.keys(o.byStatus).forEach(function(st) {
          var oo = o.byStatus[st];
          console.log('       status ' + String(st).padEnd(14) + ': ' + f(oo.total, cur).padStart(22) + '  (' + oo.count + ')');
        });
      });
      console.log('');
      const usett = await Q("SELECT COALESCE(SUM(amount_minor),0)/100 as s, currency, COUNT(*) as cnt FROM pos2013_transactions WHERE (settled_at IS NULL OR settled_at = '') GROUP BY currency");
      if (usett.length && usett[0].cnt > 0) {
        console.log('   !! POS TXNs WITH settled_at NULL (not settled anywhere):');
        usett.forEach(function(r) { console.log('       ' + String(r.currency||'USD').padEnd(5) + ': ' + f(r.s, r.currency).padStart(22) + ' (' + r.cnt + ' rows)'); });
      } else {
        console.log('   OK: All POS txns appear settled (every row has settled_at timestamp)');
      }
    }

    // ---------------------------------------------------------------
    H('2. MERCHANT WALLETS  (WHERE IN-FLOW MONEY LANDS)');
    // ---------------------------------------------------------------
    const mw = await Q('SELECT id, merchant_id, balance, currency, created_at, updated_at FROM merchant_wallets ORDER BY merchant_id, currency');
    var mwBy = {};
    if (mw.length === 0) console.log('   (no rows)');
    else {
      console.log(String('MerchantID').padEnd(12) + ' ' + String('Cur').padEnd(5) + ' ' + String('Balance').padStart(24) + ' ' + String('Last Updated').padEnd(24) + ' WalletID (first 12)');
      mw.forEach(function(m) {
        var cur = (m.currency || 'USD').toUpperCase();
        if (!mwBy[cur]) mwBy[cur] = 0;
        mwBy[cur] += Number(m.balance || 0);
        console.log(String(m.merchant_id).padEnd(12) + ' ' + cur.padEnd(5) + ' ' + f(m.balance, cur).padStart(24) + ' ' + String(m.updated_at || m.created_at || '').slice(0, 24).padEnd(24) + ' ' + String(m.id||'').slice(0, 12));
      });
      console.log('');
      console.log('   MERCHANT WALLET TOTALS:');
      Object.keys(mwBy).forEach(function(cur) { console.log('   ' + cur.padEnd(5) + ' ' + f(mwBy[cur], cur).padStart(24)); });
    }
    console.log('');
    console.log('   --- Ledger backing (merchant_wallet_transactions) ---');
    const mwt = await Q('SELECT type, currency, COALESCE(SUM(amount),0) as s, COUNT(*) as cnt FROM merchant_wallet_transactions GROUP BY type, currency ORDER BY currency, type');
    if (mwt.length === 0) console.log('      (0 ledger rows)');
    else {
      mwt.forEach(function(r) {
        var cur = (r.currency || 'USD').toUpperCase();
        console.log('      ' + cur.padEnd(5) + '  ' + String(r.type).padEnd(8) + '  ' + f(r.s, cur).padStart(22) + '   (' + r.cnt + ' rows)');
      });
      const mwtNet = await Q('SELECT currency, COALESCE(SUM(CASE WHEN type IN (\'credit\',\'deposit\',\'topup\') THEN amount ELSE -amount END),0) as net FROM merchant_wallet_transactions GROUP BY currency');
      console.log('');
      mwtNet.forEach(function(r) {
        var cur = (r.currency || 'USD').toUpperCase();
        console.log('      ' + cur.padEnd(5) + '  NET (credits - debits) = ' + f(r.net, cur));
      });
    }

    // ---------------------------------------------------------------
    H('3. CUSTOMER WALLETS  (WHAT CUSTOMERS THINK THEY OWN)');
    // ---------------------------------------------------------------
    const cust = await Q('SELECT c.id as cust_id, c.name, c.email, w.id as wallet_id, w.balance, w.currency, w.updated_at, w.created_at, w.wallet_code, w.status FROM customers c LEFT JOIN customer_wallets w ON w.customer_id = c.id ORDER BY c.name, w.currency');
    var cwBy = {};
    if (cust.length === 0) console.log('   (no customers registered)');
    else {
      console.log(String('Customer Name').padEnd(28) + ' ' + String('Cur').padEnd(5) + ' ' + String('Balance').padStart(24) + ' ' + String('Status').padEnd(10) + ' ' + String('Updated').padEnd(22) + ' ' + 'Code');
      cust.forEach(function(w) {
        var cur = w.currency ? w.currency.toUpperCase() : null;
        var nm = String(w.name || '(null)').padEnd(28);
        if (!cur) {
          console.log(nm + ' ' + '-'.padEnd(5) + ' ' + '(NO WALLET ROW)'.padStart(24) + ' ' + '-'.padEnd(10));
          return;
        }
        if (!cwBy[cur]) cwBy[cur] = 0;
        cwBy[cur] += Number(w.balance || 0);
        var bal = f(w.balance, cur).padStart(24);
        var st = String(w.status || '').padEnd(10);
        var dt = String(w.updated_at || w.created_at || '').slice(0, 22).padEnd(22);
        var code = String(w.wallet_code || '');
        console.log(nm + ' ' + cur.padEnd(5) + ' ' + bal + ' ' + st + ' ' + dt + ' ' + code);
      });
      console.log('');
      console.log('   CUSTOMER WALLET TOTALS:');
      Object.keys(cwBy).forEach(function(cur) { console.log('   ' + cur.padEnd(5) + ' ' + f(cwBy[cur], cur).padStart(24)); });
    }
    console.log('');
    console.log('   --- Ledger backing (wallet_transactions) ---');
    const wt = await Q('SELECT c.name, wt.type, wt.currency, COALESCE(SUM(wt.amount),0) as s, COUNT(*) as cnt FROM wallet_transactions wt JOIN customer_wallets w ON w.id=wt.wallet_id JOIN customers c ON c.id=w.customer_id GROUP BY c.name, wt.type, wt.currency ORDER BY c.name, wt.currency, wt.type');
    if (wt.length === 0) console.log('      (0 ledger rows - NO customer has any credit/debit history)');
    else {
      var wtNetBy = {};
      wt.forEach(function(r) {
        var cur = (r.currency || 'USD').toUpperCase();
        if (!wtNetBy[cur]) wtNetBy[cur] = { credit: 0, debit: 0 };
        var t = String(r.type || '').toLowerCase();
        if (t === 'credit' || t === 'deposit' || t === 'topup') wtNetBy[cur].credit += Number(r.s);
        else wtNetBy[cur].debit += Number(r.s);
        console.log('      ' + String(r.name).padEnd(26) + ' ' + cur.padEnd(5) + ' ' + String(r.type).padEnd(8) + ' ' + f(r.s, cur).padStart(22) + ' (' + r.cnt + ')');
      });
      console.log('');
      console.log('      NET (CREDITS - DEBITS) vs wallet.balance column:');
      Object.keys(wtNetBy).forEach(function(cur) {
        var net = wtNetBy[cur].credit - wtNetBy[cur].debit;
        var bal = cwBy[cur] || 0;
        var diff = net - bal;
        var warn = Math.abs(diff) > 0.01 ? '   <<< MISMATCH! STALE BALANCE COLUMN' : '   OK (balances match ledger)';
        console.log('      ' + cur.padEnd(5) + '  ledger NET: ' + f(net, cur).padStart(22) + '    stored balance: ' + f(bal, cur).padStart(22) + '    diff: ' + f(diff, cur).padStart(22) + warn);
      });
    }
    console.log('');
    console.log('   --- Crypto Holdings in customer_crypto_wallets ---');
    const ccw = await Q('SELECT c.name, ccw.crypto_coin as coin, COALESCE(SUM(ccw.balance),0) as bal, COUNT(*) as cnt FROM customer_crypto_wallets ccw JOIN customers c ON c.id=ccw.customer_id GROUP BY c.name, ccw.crypto_coin ORDER BY c.name, ccw.crypto_coin');
    if (ccw.length === 0) console.log('      (0 rows - no customer holds any crypto balance)');
    else {
      ccw.forEach(function(r) { console.log('      ' + String(r.name).padEnd(26) + ' ' + String(r.coin).padEnd(6) + ' ' + fc(r.bal, r.coin) + ' (' + r.cnt + ' wallet rows)'); });
      const ccwTot = await Q('SELECT crypto_coin as coin, COALESCE(SUM(balance),0) as bal FROM customer_crypto_wallets GROUP BY crypto_coin');
      console.log(''); ccwTot.forEach(function(r) { console.log('      TOTAL ' + String(r.coin).padEnd(6) + ' = ' + fc(r.bal, r.coin)); });
    }

    // ---------------------------------------------------------------
    H('4. TRANSACTION_SETTLEMENTS  (per-POS-txn split: gross/fee/net)');
    // ---------------------------------------------------------------
    const ts = await Q('SELECT status, currency, COALESCE(SUM(gross_amount),0) as gross, COALESCE(SUM(fee_amount),0) as fee, COALESCE(SUM(net_amount),0) as net, COUNT(*) as cnt FROM transaction_settlements GROUP BY currency, status ORDER BY currency, status');
    if (ts.length === 0) console.log('   (0 rows - transaction_settlements table is empty)');
    else {
      console.log(String('Cur').padEnd(5) + ' ' + String('Status').padEnd(14) + ' ' + String('Gross').padStart(22) + ' ' + String('Fees').padStart(22) + ' ' + String('Net').padStart(22) + ' Rows');
      ts.forEach(function(r) {
        var cur = (r.currency || 'USD').toUpperCase();
        console.log(cur.padEnd(5) + ' ' + String(r.status||'(null)').padEnd(14) + ' ' + f(r.gross, cur).padStart(22) + ' ' + f(r.fee, cur).padStart(22) + ' ' + f(r.net, cur).padStart(22) + ' ' + r.cnt);
      });
      const tsTot = await Q('SELECT currency, COALESCE(SUM(gross_amount),0) gross, COALESCE(SUM(fee_amount),0) fee, COALESCE(SUM(net_amount),0) net FROM transaction_settlements GROUP BY currency');
      console.log('');
      tsTot.forEach(function(r) {
        var cur = (r.currency||'USD').toUpperCase();
        var check = Number(r.gross) - Number(r.fee) - Number(r.net);
        var warn = Math.abs(check) > 0.01 ? '   <<< math mismatch gross-fee-net = '+f(check,cur) : '';
        console.log('   TOTAL ' + cur.padEnd(5) + '  Gross: ' + f(r.gross, cur).padStart(22) + '  Fees: ' + f(r.fee, cur).padStart(22) + '  Net: ' + f(r.net, cur).padStart(22) + warn);
      });
    }
    console.log('');
    console.log('   --- merchant_pos_settlements (batch-level aggregate settlements) ---');
    const mps = await Q('SELECT status, currency, COALESCE(SUM(amount),0) as amt, COUNT(*) as cnt FROM merchant_pos_settlements GROUP BY currency, status ORDER BY currency, status');
    if (mps.length === 0) console.log('      (0 rows)');
    else {
      mps.forEach(function(r) {
        var cur = (r.currency||'USD').toUpperCase();
        var stk = String(r.status||'').toLowerCase() !== 'settled' && String(r.status||'').toLowerCase() !== 'paid' ? '   <<< '+r.status+' STUCK' : '';
        console.log('      ' + cur.padEnd(5) + '  status ' + String(r.status||'(null)').padEnd(14) + ': ' + f(r.amt, cur).padStart(22) + ' (' + r.cnt + ' rows)' + stk);
      });
    }

    // ---------------------------------------------------------------
    H('5. DISCREPANCIES & CONFLICTS (UNRESOLVED)');
    // ---------------------------------------------------------------
    const sd = await Q('SELECT discrepancy_type, currency, COALESCE(SUM(amount),0) as s, COUNT(*) as cnt FROM settlement_discrepancies WHERE status != ? GROUP BY discrepancy_type, currency', ['resolved']);
    if (sd.length === 0) console.log('   settlement_discrepancies: 0 unresolved  OK');
    else { sd.forEach(function(r) { var cur = (r.currency||'USD').toUpperCase(); console.log('   SD type ' + String(r.discrepancy_type).padEnd(24) + ' '+cur.padEnd(5)+' : ' + f(r.s, cur).padStart(22) + ' (' + r.cnt + ')'); }); }
    const rd = await Q('SELECT discrepancy_type, resolution_status, COUNT(*) as cnt, COALESCE(SUM(CASE WHEN offline_amount > 0 THEN offline_amount ELSE online_amount END),0) as s FROM reconciliation_discrepancies WHERE resolution_status != ? GROUP BY discrepancy_type, resolution_status', ['RESOLVED']);
    if (rd.length === 0) console.log('   reconciliation_discrepancies: 0 unresolved  OK');
    else { rd.forEach(function(r) { console.log('   RD type ' + String(r.discrepancy_type).padEnd(24) + ' state='+String(r.resolution_status).padEnd(16)+' USD count=' + r.cnt + ' approx_amount=' + f(r.s,'USD')); }); }
    try {
      const pc = await Q('SELECT resolution_status, COUNT(*) as cnt, COALESCE(SUM(amount_minor),0)/100 as s FROM pos_conflicts GROUP BY resolution_status');
      if (pc.length === 0) console.log('   pos_conflicts: 0 rows  OK');
      else pc.forEach(function(r) { var stk = String(r.resolution_status||'').toLowerCase().indexOf('resolv') < 0 ? '   <<< UNRESOLVED' : ''; console.log('   PC status ' + String(r.resolution_status||'(null)').padEnd(18) + ': ' + f(r.s||0,'USD').padStart(22) + ' (' + r.cnt + ')'+stk); });
    } catch(e) { console.log('   pos_conflicts table does not exist yet'); }

    // ---------------------------------------------------------------
    H('6. CASHOUTS / PAYOUTS / WITHDRAWALS (money leaving the system)');
    // ---------------------------------------------------------------
    const co = await Q('SELECT status, currency, COALESCE(SUM(amount_minor),0)/100 as amt, COALESCE(SUM(fee_minor),0)/100 as fee, COUNT(*) as cnt FROM cashouts GROUP BY currency, status ORDER BY currency, status');
    if (co.length === 0) console.log('   cashouts: 0 (no cashouts ever made)');
    else {
      console.log('   --- cashouts (merchant cashout requests) ---');
      co.forEach(function(r) {
        var cur = (r.currency||'USD').toUpperCase();
        var net = Number(r.amt||0) - Number(r.fee||0);
        var stk = ['PENDING','PROCESSING','FAILED','REVERSED','REJECTED'].indexOf(String(r.status||'').toUpperCase()) >= 0 ? '   <<< STUCK status='+r.status : '';
        console.log('      ' + cur.padEnd(5) + ' ' + String(r.status||'(null)').padEnd(14) + ': amount=' + f(r.amt,cur).padStart(22) + ' fee=' + f(r.fee,cur).padStart(18) + ' net=' + f(net,cur).padStart(22) + ' (' + r.cnt + ')'+stk);
      });
    }
    try {
      const mp = await Q('SELECT status, currency, COALESCE(SUM(amount),0) as amt, COALESCE(SUM(fee),0) as fee, COUNT(*) as cnt FROM merchant_payouts GROUP BY currency, status ORDER BY currency, status');
      if (mp.length === 0) console.log('   merchant_payouts: 0 (no bank payouts yet)');
      else mp.forEach(function(r) {
        var cur = (r.currency||'USD').toUpperCase();
        var stk = String(r.status||'').toLowerCase() === 'pending' ? '   <<< PENDING STUCK' : '';
        console.log('      MP '+cur.padEnd(5)+' '+String(r.status).padEnd(14)+': amount='+f(r.amt,cur).padStart(22)+' fee='+f(r.fee,cur).padStart(18)+' ('+r.cnt+')'+stk);
      });
    } catch(e) { console.log('   merchant_payouts table missing'); }
    console.log('');
    console.log('   --- Customer Crypto Withdrawals ---');
    const cwd = await Q('SELECT status, coin, COALESCE(SUM(amount),0) as amt, COUNT(*) as cnt FROM customer_crypto_withdrawals GROUP BY coin, status ORDER BY coin, status');
    if (cwd.length === 0) console.log('      0 (no customer crypto withdrawals ever requested)');
    else {
      cwd.forEach(function(r) {
        var stk = ['pending','deferred_broadcast','pending_manual','broadcasting','failed','error'].indexOf(String(r.status||'').toLowerCase()) >= 0 ? '   <<< STUCK' : '';
        console.log('      ' + String(r.coin).padEnd(6) + ' status ' + String(r.status||'(null)').padEnd(22) + ': ' + Number(r.amt).toLocaleString(undefined,{minimumFractionDigits:8}) + ' (' + r.cnt + ')'+stk);
      });
    }
    console.log('');
    console.log('   --- Merchant Crypto Withdrawals ---');
    const mwd = await Q('SELECT status, asset, COALESCE(SUM(amount_usd),0) as usd, COALESCE(SUM(amount_usd*1),0) as amt, COUNT(*) as cnt FROM merchant_crypto_withdrawals GROUP BY asset, status ORDER BY asset, status');
    if (mwd.length === 0) console.log('      0 (no merchant crypto withdrawals ever)');
    else {
      mwd.forEach(function(r) {
        var stk = ['pending','deferred_broadcast','pending_manual','broadcasting','failed','error'].indexOf(String(r.status||'').toLowerCase()) >= 0 ? '   <<< STUCK' : '';
        console.log('      ' + String(r.asset).padEnd(6) + ' status ' + String(r.status||'(null)').padEnd(22) + ': USD=' + f(r.usd,'USD').padStart(20) + ' (' + r.cnt + ')'+stk);
      });
    }

    // ---------------------------------------------------------------
    H('7. BATCHES & OFFLINE_FUNDS_RECEIPTS (shadow ledger)');
    // ---------------------------------------------------------------
    const bat = await Q('SELECT status, COALESCE(SUM(total_amount_minor),0)/100 as amt, COUNT(*) as cnt FROM pos2013_batches GROUP BY status');
    if (bat.length === 0) console.log('   pos2013_batches: 0 rows');
    else {
      bat.forEach(function(r) {
        var stk = ['RECEIVED','PROCESSING','PARTIAL','FAILED'].indexOf(String(r.status||'').toUpperCase()) >= 0 ? '   <<< STUCK' : '';
        console.log('   pos2013_batches status ' + String(r.status||'(null)').padEnd(14) + ': ' + f(r.amt, 'USD').padStart(22) + ' (' + r.cnt + ' rows)'+stk);
      });
    }
    const ofr = await Q('SELECT status, currency, COALESCE(SUM(amount_minor),0)/100 as amt, COUNT(*) as cnt FROM offline_funds_receipts GROUP BY currency, status ORDER BY currency, status');
    if (ofr.length === 0) console.log('   offline_funds_receipts: 0 rows');
    else {
      ofr.forEach(function(r) {
        var cur = (r.currency||'USD').toUpperCase();
        var stk = String(r.status||'').toLowerCase().indexOf('pend') >= 0 ? '   <<< PENDING STUCK' : '';
        console.log('   OFR '+cur.padEnd(5)+' status '+String(r.status||'(null)').padEnd(14)+': '+f(r.amt,cur).padStart(22)+' ('+r.cnt+')'+stk);
      });
    }

    // ---------------------------------------------------------------
    H('8. FINAL RECONCILIATION  (inflow = outflow? + FEES + RESIDUAL)');
    // ---------------------------------------------------------------
    var posT = {};
    Object.keys(posBy||{}).forEach(function(k) { posT[k] = posBy[k].total; });
    var tsTotG = {}, tsTotF = {}, tsTotN = {};
    (await Q('SELECT currency, COALESCE(SUM(gross_amount),0) g, COALESCE(SUM(fee_amount),0) fee, COALESCE(SUM(net_amount),0) net FROM transaction_settlements GROUP BY currency')).forEach(function(r) {
      var cur = (r.currency||'USD').toUpperCase();
      tsTotG[cur] = r.g; tsTotF[cur] = r.fee; tsTotN[cur] = r.net;
    });
    var allCur = {};
    [posT, mwBy, cwBy, tsTotN, tsTotF].forEach(function(obj) { Object.keys(obj).forEach(function(k) { allCur[k] = true; }); });
    console.log('');
    console.log(String('Cur').padEnd(5) + ' ' + String('POS (charged)').padStart(22) + ' ' + String('TS Gross').padStart(22) + ' ' + String('TS Fees').padStart(22) + ' ' + String('TS Net->Merch').padStart(22) + ' ' + String('Merchant').padStart(22) + ' ' + String('Customers').padStart(22));
    Object.keys(allCur).forEach(function(cur) {
      var p = posT[cur] || 0;
      var g = tsTotG[cur] || 0;
      var fe = tsTotF[cur] || 0;
      var n = tsTotN[cur] || 0;
      var m = mwBy[cur] || 0;
      var cw = cwBy[cur] || 0;
      console.log(cur.padEnd(5) + ' ' + f(p,cur).padStart(22) + ' ' + f(g,cur).padStart(22) + ' ' + f(fe,cur).padStart(22) + ' ' + f(n,cur).padStart(22) + ' ' + f(m,cur).padStart(22) + ' ' + f(cw,cur).padStart(22));
    });
    console.log('');
    Object.keys(allCur).forEach(function(cur) {
      var p = posT[cur] || 0;
      var g = tsTotG[cur] || 0;
      var fe = tsTotF[cur] || 0;
      var n = tsTotN[cur] || 0;
      var m = mwBy[cur] || 0;
      var cw = cwBy[cur] || 0;
      var resid = m + cw - (n);  // where did settlement net go? net should equal merchant + customer + fees_removed_externally
      var p2n = p - n;          // POS charged vs settlement net (should equal fees)
      var unallocated = (n) - (m + cw);
      console.log('   ' + cur + ':');
      console.log('     POS total charged = '+f(p,cur));
      console.log('     transaction_settlements (Gross - Fees = Net)  =  '+f(g,cur)+' - '+f(fe,cur)+' = '+f(n,cur));
      console.log('     Held now: Merchant '+f(m,cur)+' + Customers '+f(cw,cur)+' = '+f(m+cw,cur));
      if (Math.abs(p2n - fe) > 0.01) console.log('     >>> POS - Net = '+f(p2n,cur)+'  vs  TS Fees = '+f(fe,cur)+'  DIFF = '+f(p2n-fe,cur)+'   <<< FEES NOT MATCHING? ');
      if (Math.abs(unallocated) > 0.01) console.log('     >>> Net settlement '+f(n,cur)+' minus held ('+f(m+cw,cur)+') = '+f(unallocated,cur)+'   <<< UNALLOCATED - STUCK IN LIMBO OR ACCOUNTED ELSEWHERE?');
      else console.log('     OK: Net settlement matches Merchant+Customer balances.');
    });

    console.log('');
    console.log('==============================================================');
    console.log('  END OF FULL AUDIT');
    console.log('==============================================================');
    db.close();
  } catch(e) {
    console.error('');
    console.error('FATAL:', e.message);
    console.error(e.stack && e.stack.split('\n').slice(0,4).join('\n'));
    try { db.close(); } catch(err) {}
    process.exit(1);
  }
})();
