require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';
const SOURCE_CURRENCY = 'USD';
const TARGET_ASSET = 'USDT';
const AMOUNT_USD_TO_RESTORE = 107890.50;
const PARITY_ORDER_PREFIX = 'USDT-PARITY-1788736890531';
const REFERENCE_PREFIX = 'MCBP-788736890531';
const CRYPTO_TX_ID = '95593983-2e5f-4078-88ab-78a516700ddd';
const DEBIT_TX_ID = '41acf155-bf39-4536-8947-80e93947ca77';
const FIAT_LEDGER_ID_PREFIX = 'ledger_1788736890616';
const CRYPTO_LEDGER_ID_PREFIX = 'ledger_1788736890617';
const EXPECTED_USD_BALANCE_AFTER_ROLLBACK = 128748738.50;
const EXPECTED_CRYPTO_AFTER_ROLLBACK = 50.00;

async function withDbTx(fn) {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const data = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(data);
  db.run('SAVEPOINT rollback');
  const queryAdapter = (sql, p = []) => {
    const stmt = db.prepare(sql); if (p.length) stmt.bind(p);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free(); return Promise.resolve({ rows });
  };
  queryAdapter.run = (sql, p = []) => {
    db.run(sql, p);
    return Promise.resolve({ rowsAffected: db.getRowsModified ? db.getRowsModified() : null });
  };
  try {
    const result = await fn(db, queryAdapter);
    db.run('RELEASE SAVEPOINT rollback');
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return result;
  } catch (e) {
    try { db.run('ROLLBACK TO SAVEPOINT rollback'); } catch (_) {}
    try { db.run('RELEASE SAVEPOINT rollback'); } catch (__) {}
    throw e;
  } finally { try { db.close(); } catch (_) {} }
}

(async () => {
  console.log('════════════════════════════════════════════════════════════');
  console.log('EMERGENCY ROLLBACK: Reverse erroneous USDT parity purchase');
  console.log('  → Restore USD: $', AMOUNT_USD_TO_RESTORE.toLocaleString(undefined,{maximumFractionDigits:2}));
  console.log('  → Reduce USDT merchant_crypto_balance by 107,890.50 → back to 50.00');
  console.log('  → Delete phantom audit rows (mwtx, crypto_tx, 2x ledger)');
  console.log('════════════════════════════════════════════════════════════\n');

  // BEFORE snapshot
  const before = await (async () => {
    const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
    const data = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(data);
    const q = (sql, p = []) => {
      const stmt = db.prepare(sql); if (p.length) stmt.bind(p);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free(); return { rows };
    };
    const usdW = q(`SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?`, [MERCHANT_ID, SOURCE_CURRENCY]);
    const cryp = q(`SELECT * FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?`, [MERCHANT_ID, TARGET_ASSET]);
    const mwtx = q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions`);
    const crypTx = q(`SELECT COUNT(*) as c FROM crypto_transactions`);
    const ledC = q(`SELECT COUNT(*) as c FROM ledger_entries`);
    const mwtxErr = q(`SELECT * FROM merchant_wallet_transactions WHERE id = ? OR reference LIKE ? OR type LIKE 'debit' AND currency='USD' AND amount=? ORDER BY created_at DESC LIMIT 3`, [DEBIT_TX_ID, `%${REFERENCE_PREFIX}%`, AMOUNT_USD_TO_RESTORE]);
    const crypTxErr = q(`SELECT * FROM crypto_transactions WHERE id = ? OR binance_order_id LIKE ? OR reference LIKE ? ORDER BY created_at DESC LIMIT 3`, [CRYPTO_TX_ID, `%${PARITY_ORDER_PREFIX}%`, `%${REFERENCE_PREFIX}%`]);
    const ledErr = q(`SELECT id, transaction_id, type, amount, currency, status, reference, description FROM ledger_entries WHERE id LIKE ? OR id LIKE ? OR reference LIKE ? ORDER BY created_at DESC LIMIT 5`, [`${FIAT_LEDGER_ID_PREFIX}%`, `${CRYPTO_LEDGER_ID_PREFIX}%`, `%${REFERENCE_PREFIX}%`]);
    const res = {
      usdWallet: usdW.rows[0], crypto: cryp.rows[0],
      mwtxC: Number(mwtx.rows[0].c), crypTxC: Number(crypTx.rows[0].c), ledC: Number(ledC.rows[0].c),
      mwtxErr: mwtxErr.rows, crypTxErr: crypTxErr.rows, ledErr: ledErr.rows,
    };
    db.close(); return res;
  })();
  console.log('── BEFORE ──────────────────────────────────────────');
  console.log('  USD wallet balance = $', Number(before.usdWallet.balance).toLocaleString(undefined,{maximumFractionDigits:2}), 'id=', before.usdWallet.id);
  console.log('  USDT crypto amount =', Number(before.crypto.amount).toLocaleString(undefined,{maximumFractionDigits:6}), 'id=', before.crypto.id);
  console.log('  mwtx rows=', before.mwtxC, '  crypto_tx rows=', before.crypTxC, '  ledger rows=', before.ledC);
  console.log('  Target erroneous mwtx rows (by id/ref/amount/currency/type):');
  before.mwtxErr.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  Target erroneous crypto_tx rows:');
  before.crypTxErr.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  Target erroneous ledger_entries rows:');
  before.ledErr.forEach(r => console.log('   ', JSON.stringify(r)));

  // ── EXECUTE ROLLBACK ──────────────────────────────────────
  const stats = await withDbTx(async (db, q) => {
    const affected = { mwtxD: 0, cryptoTxD: 0, ledgerD: 0, usdCredit: 0, usdtDebit: 0 };

    // 1. DELETE phantom debit merchant_wallet_transactions row
    if (before.mwtxErr.length) {
      const ids = before.mwtxErr.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const r = await q.run(`DELETE FROM merchant_wallet_transactions WHERE id IN (${placeholders})`, ids);
      affected.mwtxD = r.rowsAffected || ids.length;
    }

    // 2. DELETE phantom crypto_transactions audit row (by id OR ref)
    if (before.crypTxErr.length) {
      const ids = before.crypTxErr.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const r = await q.run(`DELETE FROM crypto_transactions WHERE id IN (${placeholders})`, ids);
      affected.cryptoTxD = r.rowsAffected || ids.length;
    }

    // 3. DELETE 2 phantom ledger_entries rows (fiat debit + crypto credit)
    if (before.ledErr.length) {
      const ids = before.ledErr.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const r = await q.run(`DELETE FROM ledger_entries WHERE id IN (${placeholders})`, ids);
      affected.ledgerD = r.rowsAffected || ids.length;
    }

    // 4. RESTORE USD wallet by crediting back $107,890.50
    {
      const balBefore = (await q(`SELECT balance FROM merchant_wallets WHERE id = ?`, [before.usdWallet.id])).rows[0].balance;
      await q.run(`UPDATE merchant_wallets SET balance = balance + ? WHERE id = ?`, [AMOUNT_USD_TO_RESTORE, before.usdWallet.id]);
      const balAfter = (await q(`SELECT balance FROM merchant_wallets WHERE id = ?`, [before.usdWallet.id])).rows[0].balance;
      affected.usdCredit = Number(balAfter) - Number(balBefore);
    }

    // 5. REDUCE USDT crypto wallet by 107,890.50 (restore to 50.00)
    {
      const amtBefore = (await q(`SELECT amount FROM merchant_crypto_balances WHERE id = ?`, [before.crypto.id])).rows[0].amount;
      await q.run(`UPDATE merchant_crypto_balances SET amount = amount - ? WHERE id = ?`, [AMOUNT_USD_TO_RESTORE, before.crypto.id]);
      const amtAfter = (await q(`SELECT amount FROM merchant_crypto_balances WHERE id = ?`, [before.crypto.id])).rows[0].amount;
      affected.usdtDebit = Number(amtBefore) - Number(amtAfter);
    }
    // clean meta.last_buy if we want — remove the erroneous parity reference so it's not stuck
    {
      const row = (await q(`SELECT meta FROM merchant_crypto_balances WHERE id = ?`, [before.crypto.id])).rows[0];
      if (row.meta) {
        let meta = row.meta;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (_) { meta = null; } }
        if (meta && meta.last_buy && String(meta.last_buy.parity_order_id || '').startsWith('USDT-PARITY-1788736890531')) {
          delete meta.last_buy;
          await q.run(`UPDATE merchant_crypto_balances SET meta = ? WHERE id = ?`, [JSON.stringify(meta), before.crypto.id]);
        }
      }
    }

    return affected;
  });

  // ── AFTER snapshot ────────────────────────────────────────
  const after = await (async () => {
    const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
    const data = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(data);
    const q = (sql, p = []) => {
      const stmt = db.prepare(sql); if (p.length) stmt.bind(p);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free(); return { rows };
    };
    const usdW = q(`SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?`, [MERCHANT_ID, SOURCE_CURRENCY]);
    const cryp = q(`SELECT * FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?`, [MERCHANT_ID, TARGET_ASSET]);
    const mwtx = q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions`);
    const crypTx = q(`SELECT COUNT(*) as c FROM crypto_transactions`);
    const ledC = q(`SELECT COUNT(*) as c FROM ledger_entries`);
    const mwtxRemain = q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions WHERE id = ? OR reference LIKE ?`, [DEBIT_TX_ID, `%${REFERENCE_PREFIX}%`]);
    const crypRemain = q(`SELECT COUNT(*) as c FROM crypto_transactions WHERE id = ? OR binance_order_id LIKE ?`, [CRYPTO_TX_ID, `%${PARITY_ORDER_PREFIX}%`]);
    const ledRemain = q(`SELECT COUNT(*) as c FROM ledger_entries WHERE id LIKE ? OR id LIKE ? OR reference LIKE ?`, [`${FIAT_LEDGER_ID_PREFIX}%`, `${CRYPTO_LEDGER_ID_PREFIX}%`, `%${REFERENCE_PREFIX}%`]);
    const res = {
      usdWallet: usdW.rows[0], crypto: cryp.rows[0],
      mwtxC: Number(mwtx.rows[0].c), crypTxC: Number(crypTx.rows[0].c), ledC: Number(ledC.rows[0].c),
      mwtxRemain: Number(mwtxRemain.rows[0].c), crypRemain: Number(crypRemain.rows[0].c), ledRemain: Number(ledRemain.rows[0].c),
    };
    db.close(); return res;
  })();
  console.log('\n── CHANGES ─────────────────────────────────────────');
  console.log('  mwtx deleted              :', stats.mwtxD, '(expected', before.mwtxErr.length, ')');
  console.log('  crypto_tx deleted         :', stats.cryptoTxD, '(expected', before.crypTxErr.length, ')');
  console.log('  ledger_entries deleted    :', stats.ledgerD, '(expected', before.ledErr.length, ')');
  console.log('  USD credited back         : $', Number(stats.usdCredit).toLocaleString(undefined,{maximumFractionDigits:2}), '(expected $', AMOUNT_USD_TO_RESTORE.toLocaleString(), ')');
  console.log('  USDT merchant bal debited :', Number(stats.usdtDebit).toLocaleString(undefined,{maximumFractionDigits:6}), '(expected 107,890.500000)');
  console.log('\n── AFTER ───────────────────────────────────────────');
  console.log('  USD wallet balance = $', Number(after.usdWallet.balance).toLocaleString(undefined,{maximumFractionDigits:2}));
  console.log('  USDT crypto amount =', Number(after.crypto.amount).toLocaleString(undefined,{maximumFractionDigits:6}));
  console.log('  mwtx rows=', after.mwtxC, '(before', before.mwtxC, '→ Δ=', after.mwtxC - before.mwtxC, ', expected Δ=-'+before.mwtxErr.length+')');
  console.log('  crypto_tx rows=', after.crypTxC, '(before', before.crypTxC, '→ Δ=', after.crypTxC - before.crypTxC, ', expected Δ=-'+before.crypTxErr.length+')');
  console.log('  ledger_entries rows=', after.ledC, '(before', before.ledC, '→ Δ=', after.ledC - before.ledC, ', expected Δ=-'+before.ledErr.length+')');
  console.log('  ERRONEOUS mwtx remaining     :', after.mwtxRemain, '(expected 0)');
  console.log('  ERRONEOUS crypto_tx remaining:', after.crypRemain, '(expected 0)');
  console.log('  ERRONEOUS ledger remaining   :', after.ledRemain, '(expected 0)');

  const ok =
    Math.abs(Number(after.usdWallet.balance) - EXPECTED_USD_BALANCE_AFTER_ROLLBACK) < 0.001 &&
    Math.abs(Number(after.crypto.amount)  - EXPECTED_CRYPTO_AFTER_ROLLBACK) < 0.000001 &&
    after.mwtxRemain === 0 && after.crypRemain === 0 && after.ledRemain === 0 &&
    after.mwtxC === before.mwtxC - before.mwtxErr.length &&
    after.crypTxC === before.crypTxC - before.crypTxErr.length &&
    after.ledC === before.ledC - before.ledErr.length;

  console.log('\n════════════════════════════════════════════════════════════');
  if (ok) {
    console.log('✅ ROLLBACK VERIFIED SUCCESSFUL.');
    console.log('   merchant_wallets USD restored to  : $', EXPECTED_USD_BALANCE_AFTER_ROLLBACK.toLocaleString(undefined,{maximumFractionDigits:2}));
    console.log('   merchant_crypto_balances USDT back:', EXPECTED_CRYPTO_AFTER_ROLLBACK.toLocaleString(undefined,{maximumFractionDigits:6}), 'USDT');
    console.log('   ALL phantom audit rows PURGED (mwtx/crypto_tx/ledger).');
    console.log('');
    console.log('   ❌ MY ERROR EXPLANATION:');
    console.log('   The previous script did TWO BAD THINGS:');
    console.log('   1. Debited YOUR USD merchant wallet $107,890.50 (real money)');
    console.log('   2. Credited a FAKE merchant_crypto_balances 107,890.50 USDT');
    console.log('      → this is "paper USDT" on the POS system — NOT real on-chain USDT.');
    console.log('      → it would STILL require you to send ANOTHER $107,890.50 of real USDT');
    console.log('        to the Tron hot wallet before it could hit the chain.');
    console.log('      → So you would have paid TWICE.');
    console.log('');
    console.log('   ✅ CORRECT FLOW (the way you asked, no double charge):');
    console.log('     A. MERCHANT FIAT USD ($107,890.50) → BINANCE → BUY REAL USDT ON-CHAIN / ON-EXCHANGE');
    console.log('     B. BINANCE → USDT TRC-20 → TCjaTRox9EfvrD47fnH9mcAbdTiGB6iHWC (JJ DUMBA) directly');
    console.log('        OR');
    console.log('     B*. BINANCE → TRC-20 → POS hot wallet TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP → on-broadcast to TCjaTRox...');
    console.log('     C. Record payout status: COMPLETED + external_reference=TRON tx hash');
    process.exit(0);
  } else {
    console.log('❌ ROLLBACK VERIFICATION FAILED.');
    console.log('   USD after actual=', Number(after.usdWallet.balance), 'expected=', EXPECTED_USD_BALANCE_AFTER_ROLLBACK);
    console.log('   USDT after actual=', Number(after.crypto.amount), 'expected=', EXPECTED_CRYPTO_AFTER_ROLLBACK);
    console.log('   row counts / phantom remain see above.');
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message || e); process.exit(99); });
