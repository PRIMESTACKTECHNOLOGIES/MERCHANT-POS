require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const PAYOUT_ID = 'f1765ae6-cc67-4d0f-93b4-2da498e34ea2';
const LEDGER_REF = 'CRYPTO-100K-F1765AE6';
const REJECT_REASON = 'CANCELLED: 11-day stale TRC-20 payout. Tron hot wallet TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP has insufficient liquidity (4.5 USDT / 1 TRX vs required 107,890.5 USDT + 20 TRX gas). MERCHANT EUR 100K NEVER DEBITED from merchant_wallets.EUR — so NO wallet refund performed (only open PENDING book entries closed). To re-issue: (1) top up Tron hot wallet, (2) submit a NEW merchant crypto payout via the POS system — do NOT re-approve this cancelled row.';
const REJECTED_AT = new Date().toISOString();

async function withDb(fn) {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const data = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(data);
  try {
    const q = (sql, p = []) => {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => { const o = {}; r[0].columns.forEach((c, i) => o[c] = row[i]); return o; });
    };
    const result = await fn(db, q);
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return result;
  } finally { db.close(); }
}

(async () => {
  console.log('═════════════════════════════════════════════════════');
  console.log('SURGICAL REJECT: Payout f1765ae6 (107,890.5 USDT TRC20)');
  console.log('═════════════════════════════════════════════════════\n');

  const { before, after } = await withDb(async (db, q) => {
    // ── BEFORE ───────────────────────────────────────────────
    const beforePayout = q(`SELECT id, merchant_id, amount, currency, status, provider, error_message,
                                   approved_by, approved_at, reconciliation_status, reconciliation_note,
                                   created_at, updated_at, completed_at
                              FROM merchant_payouts WHERE id = '${PAYOUT_ID}'`);
    const beforeLedger = q(`SELECT id, transaction_id, type, amount, currency, status, description, reference, merchant_id
                              FROM ledger_entries WHERE reference = '${LEDGER_REF}' OR transaction_id = '${PAYOUT_ID}'`);
    const beforeMerchWallets = q(`SELECT currency, balance FROM merchant_wallets WHERE merchant_id = 'MRC-1001'`);
    const beforeCryptoBal = q(`SELECT * FROM merchant_crypto_balances WHERE merchant_id = 'MRC-1001' AND asset = 'USDT'`);
    const beforeMtx = q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions`);
    const before = { beforePayout, beforeLedger, beforeMerchWallets, beforeCryptoBal, beforeMtxCount: beforeMtx[0].c };

    // ── MERCHANT_PAYOUTS UPDATE ──────────────────────────────
    // Read existing reconciliation_note / meta first so we can append
    const existingRow = beforePayout[0];
    const existingRecNote = existingRow.reconciliation_note ? String(existingRow.reconciliation_note) : '';
    const newRecNote =
      (existingRecNote ? existingRecNote + ' | ' : '') +
      `[REJECTED ${REJECTED_AT}] ${REJECT_REASON}`;

    db.run(
      `UPDATE merchant_payouts
          SET status = 'REJECTED',
              error_message = COALESCE(NULLIF(error_message, ''), ?),
              approved_by = COALESCE(NULLIF(approved_by, ''), 'SYSTEM_SURGICAL_REJECT_NO_REFUND_NEEDED'),
              approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
              reconciliation_status = COALESCE(reconciliation_status, 'CANCELLED'),
              reconciliation_note = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PENDING_APPROVAL','PENDING','APPROVED','SUBMITTED','PROCESSING')`,
      [REJECT_REASON, newRecNote, PAYOUT_ID]
    );
    const pAffected = db.getRowsModified();

    // ── LEDGER_ENTRIES UPDATE ────────────────────────────────
    // We flip to REJECTED but DO NOT create a ghost credit entry.
    // Reason: the original €100k CRYPTO_PAYOUT was status=PENDING and
    // was NEVER actually debited from merchant_wallets.EUR (confirmed by
    // zero merchant_wallet_transactions rows matching + EUR balance intact).
    const beforeLedgerRow = beforeLedger[0];
    const existingDesc = beforeLedgerRow ? String(beforeLedgerRow.description || '') : '';
    const newDesc =
      (existingDesc ? existingDesc + ' — ' : '') +
      `[REJECTED ${REJECTED_AT}] ${REJECT_REASON}`;

    db.run(
      `UPDATE ledger_entries
          SET status = 'REJECTED',
              description = ?
        WHERE reference = ? OR transaction_id = ?`,
      [newDesc, LEDGER_REF, PAYOUT_ID]
    );
    const lAffected = db.getRowsModified();

    // ── AFTER ─────────────────────────────────────────────────
    const afterPayout = q(`SELECT id, merchant_id, amount, currency, status, provider, error_message,
                                  approved_by, approved_at, reconciliation_status, reconciliation_note,
                                  created_at, updated_at, completed_at
                             FROM merchant_payouts WHERE id = '${PAYOUT_ID}'`);
    const afterLedger = q(`SELECT id, transaction_id, type, amount, currency, status, description, reference, merchant_id
                             FROM ledger_entries WHERE reference = '${LEDGER_REF}' OR transaction_id = '${PAYOUT_ID}'`);
    const afterMerchWallets = q(`SELECT currency, balance FROM merchant_wallets WHERE merchant_id = 'MRC-1001'`);
    const afterCryptoBal = q(`SELECT * FROM merchant_crypto_balances WHERE merchant_id = 'MRC-1001' AND asset = 'USDT'`);
    const afterMtx = q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions`);
    const after = { afterPayout, afterLedger, afterMerchWallets, afterCryptoBal, afterMtxCount: afterMtx[0].c, pAffected, lAffected };

    return { before, after };
  });

  console.log('── BEFORE ───────────────────────────────────────────');
  console.log('  merchant_payouts:');
  before.beforePayout.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  ledger_entries:');
  before.beforeLedger.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  merchant_wallets MRC-1001:', JSON.stringify(before.beforeMerchWallets));
  console.log('  merchant_crypto_balances USDT MRC-1001:', JSON.stringify(before.beforeCryptoBal));
  console.log('  merchant_wallet_transactions COUNT (before):', before.beforeMtxCount);

  console.log('\n── CHANGES ──────────────────────────────────────────');
  console.log('  merchant_payouts rows updated:', after.pAffected, '(expected 1)');
  console.log('  ledger_entries rows updated  :', after.lAffected, '(expected 1)');
  console.log('  merchant_wallet_transactions new rows:', (after.afterMtxCount - before.beforeMtxCount), '(EXPECTED 0 — NO ghost funds credited)');

  console.log('\n── AFTER ────────────────────────────────────────────');
  console.log('  merchant_payouts:');
  after.afterPayout.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  ledger_entries:');
  after.afterLedger.forEach(r => console.log('   ', JSON.stringify(r)));
  console.log('  merchant_wallets MRC-1001:', JSON.stringify(after.afterMerchWallets));
  console.log('  merchant_crypto_balances USDT MRC-1001:', JSON.stringify(after.afterCryptoBal));

  // FINAL CHECK
  const ok =
    after.pAffected >= 1 &&
    after.afterPayout[0].status === 'REJECTED' &&
    after.afterLedger[0].status === 'REJECTED' &&
    JSON.stringify(before.beforeMerchWallets) === JSON.stringify(after.afterMerchWallets) &&
    JSON.stringify(before.beforeCryptoBal) === JSON.stringify(after.afterCryptoBal) &&
    after.afterMtxCount === before.beforeMtxCount;

  console.log('\n═════════════════════════════════════════════════════');
  if (ok) {
    console.log('✅ VERIFIED: Surgical reject COMPLETE.');
    console.log('   • merchant_payouts.f1765ae6 → REJECTED');
    console.log('   • ledger_entries row → REJECTED');
    console.log('   • merchant_wallets BALANCES UNCHANGED (EUR + USD identical) — NO ghost refund.');
    console.log('   • merchant_crypto_balances USDT UNCHANGED at 50.00 — NO ghost USDT created.');
    console.log('   • merchant_wallet_transactions count identical — NO extraneous audit rows.');
    console.log('');
    console.log('   📝 Re-submission path later:');
    console.log('     1. Top up Tron hot wallet:');
    console.log('           TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP');
    console.log('           → 107,890.50 USDT TRC-20');
    console.log('           → 20+ TRX (gas)');
    console.log('     2. Submit a FRESH TRC-20 crypto payout from the POS UI / API.');
    console.log('     3. Then run node _execute_trc20_payout.cjs OR confirm the script is wired to the new id.');
    process.exit(0);
  } else {
    console.log('❌ VERIFICATION FAILED. Check output above.');
    console.log('   pAffected=', after.pAffected);
    console.log('   payout.status=', after.afterPayout[0]?.status);
    console.log('   ledger.status=', after.afterLedger[0]?.status);
    console.log('   wallets same?', JSON.stringify(before.beforeMerchWallets) === JSON.stringify(after.afterMerchWallets));
    console.log('   crypto same? ', JSON.stringify(before.beforeCryptoBal) === JSON.stringify(after.afterCryptoBal));
    console.log('   mtx same?    ', after.afterMtxCount === before.beforeMtxCount);
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message || e); process.exit(99); });
