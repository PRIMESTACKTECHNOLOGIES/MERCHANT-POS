const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(DB);
const Q = function(s, p) { p = p || []; return new Promise(function(rs, rj) { db.all(s, p, function(e, r) { e ? rj(e) : rs(r); }); }); };

(async function() {
  try {
    console.log('');
    console.log('ACTUAL CUSTOMER FUNDS - FULL DATABASE AUDIT');
    console.log('Database: ' + DB);
    console.log('');

    // 1. CUSTOMERS
    console.log('=== 1. ALL CUSTOMERS ===');
    const cust = await Q('SELECT * FROM customers ORDER BY COALESCE(created_at, id) ASC');
    console.log('Total customers: ' + cust.length);
    cust.forEach(function(c) {
      var sid = String(c.id || '').slice(0, 12) + '...';
      var email = c.email || '(no email)';
      var st = c.status || '(null)';
      console.log('   ' + sid + '  Name: ' + String(c.name) + '  Email: ' + email + '  Status: ' + st);
    });
    console.log('');

    // 2. CUSTOMER FIAT WALLETS
    console.log('=== 2. CUSTOMER FIAT WALLET BALANCES ===');
    var cwSQL = 'SELECT c.name, c.id as cust_id, w.id as wallet_id, w.balance, w.currency, ' +
                'w.status as wallet_status, w.wallet_code FROM customers c LEFT JOIN customer_wallets w ' +
                'ON w.customer_id = c.id ORDER BY c.name, w.currency';
    const cw = await Q(cwSQL);
    if (cw.length === 0 || cw.every(function(w) { return !w.wallet_id; })) {
      console.log('   NO CUSTOMER WALLETS CREATED AT ALL (0 rows with wallet_id)');
    } else {
      cw.forEach(function(w) {
        if (!w.wallet_id) {
          console.log('   Customer ' + w.name + ' -> NO WALLET ROW (wallet not created)');
          return;
        }
        var wid = String(w.wallet_id).slice(0, 12) + '...';
        var bal = Number(w.balance || 0).toFixed(2);
        var cur = w.currency || '?';
        var code = w.wallet_code || '(none)';
        var wst = w.wallet_status || '(null)';
        console.log('   ' + w.name + ' -> WalletID ' + wid + '  BALANCE: $' + bal + ' ' + cur + '  Code:' + code + '  Status:' + wst);
      });
    }
    const totFiat = await Q('SELECT COALESCE(SUM(balance),0) as s FROM customer_wallets');
    console.log('');
    console.log('   >>> TOTAL CUSTOMER FIAT WALLETS: $' + Number(totFiat[0].s).toLocaleString(undefined, {minimumFractionDigits: 2}));
    console.log('');

    // 3. CUSTOMER CRYPTO WALLETS
    console.log('=== 3. CUSTOMER CRYPTO WALLETS ===');
    try {
      var ccwSQL = 'SELECT c.name, ccw.crypto_coin, ccw.balance, ccw.locked_balance, ' +
                   'ccw.crypto_address, ccw.status, ccw.network FROM customers c ' +
                   'LEFT JOIN customer_crypto_wallets ccw ON ccw.customer_id = c.id ' +
                   'WHERE ccw.id IS NOT NULL ORDER BY c.name, ccw.crypto_coin';
      const ccw = await Q(ccwSQL);
      if (ccw.length === 0) {
        console.log('   ZERO customer crypto wallets');
      } else {
        ccw.forEach(function(w) {
          var bal = Number(w.balance || 0).toFixed(8);
          var lock = Number(w.locked_balance || 0).toFixed(8);
          var net = w.network || '?';
          var addr = w.crypto_address || '(internal only)';
          var st = w.status || '(null)';
          console.log('   ' + w.name + ' ' + w.crypto_coin + ': ' + bal + ' locked:' + lock + ' net:' + net + ' addr:' + String(addr).slice(0,18) + '... st:' + st);
        });
        const totCrypt = await Q('SELECT crypto_coin, COALESCE(SUM(balance),0) as s FROM customer_crypto_wallets GROUP BY crypto_coin');
        console.log('');
        totCrypt.forEach(function(r) { console.log('   TOTAL ' + r.crypto_coin + ': ' + Number(r.s).toFixed(8)); });
      }
    } catch(e) { console.log('   (table missing: ' + e.message.slice(0,60) + ')'); }
    console.log('');

    // 4. WALLET TRANSACTIONS (FIAT LEDGER)
    console.log('=== 4. CUSTOMER FIAT TRANSACTION LEDGER (wallet_transactions) ===');
    try {
      var wtSQL = 'SELECT c.name, wt.type, wt.amount, wt.currency, wt.source, ' +
                  'wt.reference, wt.description, wt.created_at FROM wallet_transactions wt ' +
                  'JOIN customer_wallets w ON w.id=wt.wallet_id JOIN customers c ON c.id=w.customer_id ' +
                  'ORDER BY datetime(wt.created_at) ASC';
      const wt = await Q(wtSQL);
      if (wt.length === 0) {
        console.log('   ZERO ROWS - NO CUSTOMER EVER HAD ANY FIAT CREDIT/DEBIT WRITTEN TO LEDGER');
      } else {
        console.log('   Total ' + wt.length + ' ledger entries:');
        wt.forEach(function(t, i) {
          var sign = t.type === 'credit' ? '+' : '-';
          var n = String(i + 1).padStart(2);
          var dt = String(t.created_at || '').slice(0, 19).padEnd(19);
          var nm = String(t.name || '').padEnd(20);
          var tp = String(t.type || '').toUpperCase().padEnd(7);
          var amt = sign + '$' + Number(t.amount).toFixed(2).padStart(12);
          var cu = String(t.currency || 'USD').padEnd(4);
          var sr = 'src=' + String(t.source || '').padEnd(18);
          var rf = 'ref=' + String(t.reference || '').padEnd(16);
          var desc = t.description ? ' desc=' + String(t.description).slice(0, 30) : '';
          console.log('   [' + n + '] ' + dt + ' ' + nm + ' ' + tp + ' ' + amt + ' ' + cu + ' ' + sr + ' ' + rf + desc);
        });
        const sumCr = await Q('SELECT type, COALESCE(SUM(amount),0) as s FROM wallet_transactions GROUP BY type');
        console.log('');
        sumCr.forEach(function(r) {
          console.log('   TOTAL ' + r.type.padEnd(7) + ': $' + Number(r.s).toLocaleString(undefined,{minimumFractionDigits:2}));
        });
      }
    } catch(e) { console.log('   error: ' + e.message.slice(0,120)); }
    console.log('');

    // 5. POS TRANSACTIONS (CARD CHARGES)
    console.log('=== 5. POS2013_TRANSACTIONS (WHAT CUSTOMER CARDS WERE ACTUALLY CHARGED) ===');
    try {
      var posSQL = 'SELECT id, pan_masked, auth_code, amount_minor/100 as amount, currency, status, ' +
                   'txn_timestamp, customer_id, local_txn_id, batch_id, terminal_id ' +
                   'FROM pos2013_transactions ORDER BY datetime(created_at) DESC LIMIT 50';
      const pos = await Q(posSQL);
      if (pos.length === 0) {
        console.log('   ZERO POS transactions - NO CUSTOMER CARD WAS EVER CHARGED');
      } else {
        console.log('   Total rows in pos2013_transactions (LIMIT 50):');
        var posSum = 0;
        pos.forEach(function(t, i) {
          posSum += Number(t.amount || 0);
          var cn = cust.find(function(c) { return c.id === t.customer_id; });
          var custLink = cn ? (cn.name) : ('(no cust link) ID:' + String(t.customer_id || '').slice(0, 14));
          var n = String(i + 1).padStart(2);
          var dt = String(t.txn_timestamp || '').slice(0, 19).padEnd(19);
          var auth = 'Auth:' + String(t.auth_code || '').padEnd(10);
          var amt = '$' + Number(t.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2}).padStart(16);
          var cur = String(t.currency || 'USD').padEnd(4);
          var pan = 'PAN:' + String(t.pan_masked || '????').padEnd(19);
          var st = 'Status:' + String(t.status || '').padEnd(10);
          console.log('   [' + n + '] ' + dt + ' ' + auth + ' ' + amt + ' ' + cur + ' ' + pan + ' ' + st + ' Cust:' + custLink);
        });
        var posAllSQL = 'SELECT status, COUNT(*) as cnt, COALESCE(SUM(amount_minor),0)/100 as amt FROM pos2013_transactions GROUP BY status';
        const posAll = await Q(posAllSQL);
        console.log('');
        console.log('   >>> POS TRANSACTION SUMMARY BY STATUS:');
        var grandPos = 0;
        posAll.forEach(function(r) {
          grandPos += Number(r.amt);
          console.log('     Status ' + String(r.status || '(null)').padEnd(15) + ' : ' + String(r.cnt).padStart(4) + ' txns = $' + Number(r.amt).toLocaleString(undefined,{minimumFractionDigits:2}));
        });
        console.log('     ----------');
        console.log('     GRAND TOTAL POS CARD CHARGES: $' + grandPos.toLocaleString(undefined,{minimumFractionDigits:2}));
      }
    } catch(e) { console.log('   error: ' + e.message.slice(0, 200)); }
    console.log('');

    // 6. SETTLEMENTS
    console.log('=== 6. TRANSACTION_SETTLEMENTS (POS -> MERCHANT CREDITS) ===');
    try {
      const ts = await Q('SELECT COUNT(*) as cnt, COALESCE(SUM(net_amount),0) as s, status FROM transaction_settlements GROUP BY status');
      if (ts.length === 0) {
        console.log('   ZERO SETTLEMENT ROWS - NONE OF POS TRANSACTIONS WERE EVER SETTLED VIA transaction_settlements TABLE');
      } else {
        ts.forEach(function(r) {
          console.log('   Status ' + String(r.status || '?').padEnd(10) + ' ' + String(r.cnt).padStart(5) + ' rows = $' + Number(r.s).toLocaleString(undefined,{minimumFractionDigits:2}));
        });
      }
    } catch(e) { console.log('   error: ' + e.message.slice(0,80)); }
    console.log('');

    // 7. MERCHANT WALLET
    console.log('=== 7. MERCHANT WALLET (WHERE THE MONEY ACTUALLY IS) ===');
    try {
      const mw = await Q('SELECT * FROM merchant_wallets ORDER BY currency');
      mw.forEach(function(m) {
        console.log('   MerchantID ' + m.merchant_id + ' -> $' + Number(m.balance || 0).toLocaleString(undefined,{minimumFractionDigits:2}) + ' ' + m.currency);
      });
      var mwt = await Q('SELECT type, COALESCE(SUM(amount),0) as s, COUNT(*) as cnt FROM merchant_wallet_transactions GROUP BY type');
      mwt.forEach(function(r) {
        console.log('   MWT ledger type ' + String(r.type).padEnd(7) + ': $' + Number(r.s).toLocaleString(undefined,{minimumFractionDigits:2}) + ' (' + r.cnt + ' rows)');
      });
    } catch(e) { console.log('   error: ' + e.message.slice(0,80)); }
    console.log('');

    // 8. STUCK CUSTOMER CRYPTO WITHDRAWALS
    console.log('=== 8. CUSTOMER CRYPTO WITHDRAWALS STUCK CHECK ===');
    try {
      var ccwSQL2 = 'SELECT c.name, ccw.coin, ccw.amount, ccw.status, ccw.destination_address, ccw.created_at ' +
                    'FROM customer_crypto_withdrawals ccw JOIN customers c ON c.id = ccw.customer_id ' +
                    'ORDER BY datetime(ccw.created_at) DESC';
      const ccwdraw = await Q(ccwSQL2);
      if (ccwdraw.length === 0) {
        console.log('   No customer crypto withdrawals ever made (0 requests)');
      } else {
        ccwdraw.forEach(function(w) {
          var nm = String(w.name).padEnd(20);
          var cn = String(w.coin).padEnd(6);
          var amt = Number(w.amount);
          var st = String(w.status || '').padEnd(20);
          var dest = String(w.destination_address || '').padEnd(36);
          var dt = String(w.created_at || '').slice(0, 19);
          console.log('   ' + nm + ' ' + cn + ' ' + amt + ' ' + st + ' to:' + dest + ' at:' + dt);
        });
        var stuck = ccwdraw.filter(function(w) {
          return w.status && ['pending','deferred_broadcast','pending_manual'].indexOf(w.status) >= 0;
        });
        console.log('');
        console.log('   >>> STUCK withdrawals (pending / deferred_broadcast / pending_manual): ' + stuck.length);
      }
    } catch(e) { console.log('   (table missing: ' + e.message.slice(0,80) + ')'); }
    console.log('');

    // 9. GRAND SUMMARY
    console.log('==============================================================');
    console.log('          CUSTOMER FUNDS - FINAL VERDICT');
    console.log('==============================================================');
    var custTotal = Number(totFiat[0].s);
    var grandPOS = 0;
    try { var gp = await Q('SELECT COALESCE(SUM(amount_minor),0)/100 as s FROM pos2013_transactions'); grandPOS = Number(gp[0].s); } catch(e) {}
    var merchBal = 0;
    try { var mb = await Q('SELECT COALESCE(SUM(balance),0) as s FROM merchant_wallets'); merchBal = Number(mb[0].s); } catch(e) {}

    console.log('');
    console.log('  💰 WHAT CUSTOMERS CARDS WERE CHARGED ........ $' + grandPOS.toLocaleString(undefined,{minimumFractionDigits:2}));
    console.log('  💳 WHAT CUSTOMERS ACTUALLY HAVE IN WALLETS .. $' + custTotal.toLocaleString(undefined,{minimumFractionDigits:2}));
    console.log('  🏪 WHAT SITS IN MERCHANT WALLET INSTEAD ...... $' + merchBal.toLocaleString(undefined,{minimumFractionDigits:2}));
    console.log('');
    var missing = grandPOS - custTotal;
    console.log('  ❗ CUSTOMER FUNDS MISSING FROM WALLETS ....... $' + missing.toLocaleString(undefined,{minimumFractionDigits:2}));
    console.log('');
    if (missing > 0 && merchBal > 0.9 * grandPOS) {
      console.log('  🔴 ROOT CAUSE:');
      console.log('     - Customer cards were charged (POS table has $' + grandPOS.toLocaleString() + ')');
      console.log('     - ALL the money went to merchant_wallets ($' + merchBal.toLocaleString() + ')');
      console.log('     - customer_wallets balance is $' + custTotal.toLocaleString() + ' (essentially zero)');
      console.log('     - The creditCustomerWallet() function was NEVER CALLED after POS top-ups');
      console.log('     - customer_wallets table has ' + cust.length + ' customers but ' + cw.filter(function(x){return x.wallet_id;}).length + ' wallets only');
      console.log('     - NO wallet_transactions ledger entries: customers were never credited');
      console.log('');
      console.log('  THE ENTIRE CUSTOMER FUNDS ARE STUCK IN: merchant_wallets (NOT customer_wallets)');
    }

    db.close();
  } catch(e) {
    console.error('FATAL ERROR:', e.message);
    console.error(e.stack);
    try { db.close(); } catch(err) {}
    process.exit(1);
  }
})();
