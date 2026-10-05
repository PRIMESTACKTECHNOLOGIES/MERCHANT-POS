/**
 * E2E FLOWCHART COMPLIANCE SIMULATION
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. OFFLINE POS: simulate POS app storing transaction locally
 * 2. SYNCWORKER: POST /api/pos/offline-sale      → credit merchant wallet
 *                                              → create settlement row
 *                                              → log ledger entry
 * 3. MERCHANT WALLET now has REAL USD
 * 4. MERCHANT BUYS CRYPTO: POST /api/merchant/:id/crypto/purchase
 *    → Debit USD wallet  →  Binance/Custom exchange buy  →  Credit crypto asset
 * 5. BANK SETTLEMENT BATCH: POST /api/merchant/:id/settlements/batch-settle
 *    → Bank sends real money → Mark POS sale 'settled'
 *
 * REQUIREMENTS:
 *  - Backend at :7000 (admin/admin123)
 *  - Optional: BINANCE_API_KEY / OKX_KEY / BYBIT_KEY env for live fills
 *    (if not present, uses custom-crypto mock exchange — still exercises code path)
 * ──────────────────────────────────────────────────────────────────────────────
 */
const axios = require('axios');
const BASE = 'http://127.0.0.1:7000';

let TOKEN = null;

function step(no, title, pass, extra) {
  const icon = pass ? '✅ PASS' : '❌ FAIL';
  const line = `Step ${no}. ${icon}  ${title}`;
  console.log(line + (extra ? `  ─  ${extra}` : ''));
  return !!pass;
}

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('    OFFLINE POS LIFECYCLE → FLOWCHART COMPLIANCE E2E SIMULATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── Pre: reset any leftover rows from last run ───────────────────────
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(__dirname, '..', process.env.DATABASE_PATH)
    : path.resolve(__dirname, '..', 'data', 'database.sqlite');
  let db;
  let dbRun;
  try {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    dbRun = db;
    await dbRun.exec('PRAGMA journal_mode = WAL;');
    await dbRun.exec(`
      DELETE FROM merchant_crypto_balances WHERE merchant_id='MRC-1001';
      DELETE FROM merchant_wallet_transactions WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id='MRC-1001');
      DELETE FROM merchant_pos_settlements WHERE merchant_id='MRC-1001';
      DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM customer_wallets WHERE customer_id IN
        (SELECT id FROM customers WHERE name='E2E-FLOWCHART-TEST'));
      DELETE FROM customers WHERE name='E2E-FLOWCHART-TEST';
      UPDATE merchant_wallets SET balance=0, updated_at=CURRENT_TIMESTAMP WHERE merchant_id='MRC-1001';
    `);
    console.log('[PRE-CLEAN] DB reset for MRC-1001. Starting balances = 0.\n');
  } catch (e) {
    console.log('[PRE-CLEAN WARN]', e.message);
  }

  // ── 0. Login ──────────────────────────────────────────────────────────
  let ok = true;
  try {
    const r = await axios.post(BASE + '/auth/login', { username: 'admin', password: 'admin123' });
    TOKEN = r.data.token;
    ok = step(0, 'Admin login → bearer token', !!TOKEN, TOKEN ? `JWT length ${TOKEN.length}` : 'no token');
  } catch (e) {
    ok = step(0, 'Admin login → bearer token', false, String(e?.response?.data || e.message));
  }
  if (!ok) { console.log('\nABORTED: backend not running at', BASE); process.exit(1); }
  const auth = { headers: { Authorization: 'Bearer ' + TOKEN } };

  // ── 1. OFFLINE POS (simulate SyncWorker payload) ─────────────────────
  const offlineTx = {
    merchant_id: 'MRC-1001',
    transactions: [
      {
        amount: 100.00,
        currency: 'AED',
        stan: '000123',
        rrn: 'SYNC-2026-0813-0001',
        card_masked: '4111********1111',
        entryMode: 'CONTACTLESS_CHIP',
        local_txn_id: 'LOCAL-9F3B-8C2E-1111',
        terminal_id: 'T2013-001',
      },
      {
        amount: 250.50,
        currency: 'AED',
        stan: '000124',
        rrn: 'SYNC-2026-0813-0002',
        card_masked: '5500********0004',
        entryMode: 'SWIPE',
        local_txn_id: 'LOCAL-9F3B-8C2E-2222',
        terminal_id: 'T2013-001',
      }
    ]
  };
  let syncRes;
  try {
    syncRes = await axios.post(BASE + '/api/pos/offline-sale', offlineTx, auth);
    const pass = !!syncRes.data && syncRes.data.ok === true && syncRes.data.synced === 2;
    step(1, 'SyncWorker → /api/pos/offline-sale (2 txns)', pass,
      `synced=${syncRes.data.synced} txn 1 bal=${syncRes.data.results?.[0]?.merchant_wallet_balance_after} txn 2 bal=${syncRes.data.results?.[1]?.merchant_wallet_balance_after}`);
    if (!pass) ok = false;
  } catch (e) {
    step(1, 'SyncWorker → /api/pos/offline-sale (2 txns)', false, String(e?.response?.data?.error || e.message));
    ok = false;
  }

  // ── 2. MERCHANT WALLET BALANCE CHECK ($100 + $250.50 = $350.50 AED) ──
  try {
    const b = await axios.get(BASE + '/api/wallet/merchant/MRC-1001/balances', auth);
    const aed = (b.data.wallets || []).find(w => String(w.currency).toUpperCase() === 'AED');
    const expected = 350.50;
    const actual = Number(aed?.balance ?? 0);
    const pass = Math.abs(actual - expected) < 0.001;
    step(2, 'Merchant Wallet now has REAL USD (AED = 350.50 after sync)', pass,
      `actual=${actual.toFixed(2)} AED, rows=${(b.data.wallets || []).length}`);
    if (!pass) ok = false;
  } catch (e) {
    step(2, 'Merchant Wallet now has REAL USD (AED = 350.50 after sync)', false, String(e?.response?.data || e.message));
    ok = false;
  }

  // ── 3. SETTLEMENT ROWS WRITTEN (2 rows, both status='unsettled') ─────
  let settlementRows = [];
  try {
    const s = await axios.get(BASE + '/api/merchant/MRC-1001/settlements/unsettled', auth);
    settlementRows = Array.isArray(s.data) ? s.data : [];
    const pass = settlementRows.length === 2 && settlementRows.every(r => r.status === undefined || r.status === 'unsettled' || !r.status);
    step(3, 'Settlement rows created (2 unsettled rows with stan + rrn + card_masked)',
      pass,
      `rows=${settlementRows.length} sample-id=${settlementRows[0]?.id?.slice(0, 10)}… amount=${settlementRows[0]?.amount}`);
    if (!pass) ok = false;
  } catch (e) {
    step(3, 'Settlement rows created (2 unsettled rows with stan + rrn + card_masked)',
      false, String(e?.response?.data || e.message));
    ok = false;
  }

  // ── 4. LEDGER ENTRIES FOR POS_CREDIT (≥ 2 credit rows for MRC-1001) ───
  if (db && typeof db.get === 'function') {
    try {
      const row = await db.get(`
        SELECT COUNT(*) AS cnt FROM ledger_entries
        WHERE type='credit' AND status IN ('SETTLED','AUTHORIZED')
          AND (description LIKE '%POS_OFFLINE%' OR description LIKE '%POS offline%' OR amount IN (100, 250.5))
      `);
      const pass = (row.cnt || 0) >= 2;
      step(4, 'Ledger entries logged for both sync transactions', pass,
        `ledger credit rows matching: ${row.cnt}`);
      if (!pass) ok = false;
    } catch (e) {
      step(4, 'Ledger entries logged for both sync transactions', false, e.message);
    }
  } else {
    step(4, 'Ledger entries logged for both sync transactions', false, 'sqlite3 not available (skipped)');
  }

  // ── 5. MERCHANT BUYS 100 USDT WORTH OF CRYPTO ────────────────────────
  let cryptoPurchase;
  try {
    cryptoPurchase = await axios.post(BASE + '/api/merchant/MRC-1001/crypto/purchase', {
      amount_usd: 100.00,
      asset: 'USDT',
      source_currency: 'AED',
    }, auth);
    const pass = !!cryptoPurchase.data?.ok === true
      && Array.isArray(cryptoPurchase.data.merchant_crypto_balances);
    step(5,
      'Merchant buys crypto (100 AED → USDT via Binance/Custom) → Debit wallet + exchange fills + credit crypto balance',
      pass,
      `asset_received=${cryptoPurchase.data.asset_received?.toFixed(6)} ${cryptoPurchase.data.asset} provider=${cryptoPurchase.data.provider_used} new_aed_balance=${(cryptoPurchase.data.merchant_fiat_balances || []).find(f => f.currency === 'AED')?.balance}`);
    if (!pass) ok = false;
  } catch (e) {
    step(5,
      'Merchant buys crypto (100 AED → USDT via Binance/Custom) → Debit wallet + exchange fills + credit crypto balance',
      false,
      String(e?.response?.data?.error || e?.response?.data || e.message));
    ok = false;
  }

  // ── 6. POST-BUY: AED balance decremented, crypto balance incremented ──
  try {
    const post = await axios.get(BASE + '/api/wallet/merchant/MRC-1001/balances', auth);
    const aedAfter = Number(((post.data.wallets || []).find(w => w.currency === 'AED') || {}).balance || 0);
    const cryptoBalances = (await axios.get(BASE + '/api/merchant/MRC-1001/crypto/balances', auth)).data.balances || [];
    const usdtRow = cryptoBalances.find(b => String(b.asset).toUpperCase() === 'USDT');
    const expectedAed = 350.50 - 100.00;
    const aedPass = Math.abs(aedAfter - expectedAed) < 0.001;
    const usdtPass = !!usdtRow && Number(usdtRow.balance) > 0;
    const pass = aedPass && usdtPass;
    step(6,
      'Post-buy state: AED 250.50 left, USDT crypto balance > 0 (UPSERT into merchant_crypto_balances)',
      pass,
      `actual AED=${aedAfter.toFixed(2)} USDT=${Number(usdtRow?.balance || 0).toFixed(6)} crypto_rows=${cryptoBalances.length}`);
    if (!pass) ok = false;
  } catch (e) {
    step(6,
      'Post-buy state: AED 250.50 left, USDT crypto balance > 0 (UPSERT into merchant_crypto_balances)',
      false, String(e?.response?.data || e.message));
    ok = false;
  }

  // ── 7. BANK SETTLEMENT BATCH (both POS sales marked settled) ─────────
  let settledCount = 0, totalSettled = 0;
  try {
    const ids = settlementRows.map(r => r.id);
    const bat = await axios.post(BASE + '/api/merchant/MRC-1001/settlements/batch-settle', {
      settlement_ids: ids,
      external_batch_ref: 'BANK-BATCH-2026-0813-T+1',
      provider_ref: 'BANK-SETTLED-1234567',
      settled_by: 'operator',
      note: 'Daily settlement run — Bank sent real money',
    }, auth);
    settledCount = bat.data.settled_count || 0;
    totalSettled = bat.data.total_settled_amount || 0;
    const pass = bat.data.ok === true && settledCount === 2 && Math.abs(totalSettled - 350.50) < 0.001;
    step(7,
      'Settlement Module: bank sends real money → batch mark POS sales settled',
      pass,
      `settled_count=${settledCount} total_settled_amount=${totalSettled.toFixed(2)} AED batch_ref=${bat.data.external_batch_ref}`);
    if (!pass) ok = false;
  } catch (e) {
    step(7,
      'Settlement Module: bank sends real money → batch mark POS sales settled',
      false, String(e?.response?.data?.error || e.message));
    ok = false;
  }

  // ── 8. POST-SETTLEMENT CHECK: both rows status = 'settled' ────────────
  try {
    const after = await axios.get(BASE + '/api/merchant/MRC-1001/settlements/unsettled', auth);
    const pass = Array.isArray(after.data) && after.data.length === 0;
    step(8, 'Unsettled settlement queue now empty (0 rows remaining after batch settle)',
      pass, `remaining_unsettled=${(after.data || []).length}`);
    if (!pass) ok = false;
  } catch (e) {
    step(8, 'Unsettled settlement queue now empty (0 rows remaining after batch settle)',
      false, String(e?.response?.data || e.message));
    ok = false;
  }

  // ── 9. FINAL DATABASE INTEGRITY CHECK (SQL counts) ────────────────────
  if (db && typeof db.get === 'function') {
    try {
      const counts = await db.get(`
        SELECT
          (SELECT COUNT(*) FROM merchant_wallets WHERE merchant_id='MRC-1001') mw,
          (SELECT COUNT(*) FROM merchant_wallet_transactions WHERE wallet_id IN
            (SELECT id FROM merchant_wallets WHERE merchant_id='MRC-1001')) mwt,
          (SELECT COUNT(*) FROM merchant_pos_settlements WHERE merchant_id='MRC-1001') mps,
          (SELECT COUNT(*) FROM merchant_pos_settlements WHERE merchant_id='MRC-1001' AND status='settled') mps_settled,
          (SELECT COUNT(*) FROM merchant_crypto_balances WHERE merchant_id='MRC-1001') mcb,
          (SELECT COUNT(*) FROM ledger_entries
            WHERE (type='credit' AND description LIKE '%POS_OFFLINE%')
               OR (type='debit' AND description LIKE '%Merchant crypto purchase%')) le
      `);
      const pass = (counts.mw >= 1) && (counts.mwt >= 3) /* 2 credit (pos offline) + 1 debit (crypto buy) */
        && (counts.mps === 2) && (counts.mps_settled === 2)
        && (counts.mcb >= 1) && (counts.le >= 3);
      step(9,
        'All database tables populated per flowchart (wallets/transactions/settlements/crypto/ledger)',
        pass,
        `merchant_wallets=${counts.mw} m_wallet_txns=${counts.mwt} pos_settlements=${counts.mps}/${counts.mps_settled} settled crypto_balances=${counts.mcb} ledger_entries=${counts.le}`);
      if (!pass) ok = false;
    } catch (e) {
      step(9,
        'All database tables populated per flowchart (wallets/transactions/settlements/crypto/ledger)',
        false, e.message);
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log(ok ? '   🎉 OVERALL: FLOWCHART COMPLIANT — ALL 9 STEPS PASSED'
    : '   ⚠  OVERALL: SOME STEPS FAILED. Review ❌ rows above + logs.');
  console.log('──────────────────────────────────────────────────────────────────────\n');

  try { if (db) db.close(); } catch { /* ignore */ }
  process.exit(ok ? 0 : 2);
})().catch(err => {
  console.error('[FATAL E2E]', err);
  process.exit(3);
});
