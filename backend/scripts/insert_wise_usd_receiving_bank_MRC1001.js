const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const { v4: uuidv4 } = (() => { try { return require('uuid'); } catch (e) { return { v4: () => 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) }; } })();

const MID = 'MRC-1001';
const SETTLE_ID = 'setl_offline_msslg0j9';
const BANK_ID = 'bank_' + Date.now().toString(36) + '_usd_wise';

const WISE_USD = {
  id: BANK_ID,
  merchant_id: MID,
  account_nickname: 'Wise USD (Column Bank partner — domestic ACH/Wire)',
  bank_name: 'Column Bank N.A. / Wise US Inc',
  account_holder_name: 'PRIMESTACK TECHNOLOGIES LLC',
  account_type: 'DEPOSIT_CHECKING',
  currency: 'USD',
  is_primary: 1,
  // Domestic: FedWire / ACH USA only
  routing_ach_abain: '084009519',
  routing_wire_usd_us: '084009519',
  account_number: '343612919064346',
  // International: SWIFT
  swift_bic: 'TRWIUS35XXX',
  iban: null,
  // Address for correspondence
  address_line_1: 'Wise US Inc, 108 W 13th St',
  address_line_2: '',
  city: 'Wilmington',
  state_province: 'DE',
  postal_code: '19801',
  country: 'United States',
  // Usage notes
  notes: 'Domestic ACH/FedWire routing: 084009519. Intl SWIFT: TRWIUS35XXX. Column Bank N.A. is our US depository partner provided by Wise. Domestic wire & ACH ONLY on routing 084009519. International wires use SWIFT TRWIUS35XXX with address Wise US Inc, Wilmington DE.',
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

(async () => {
  const db = await open({ filename: path.join(process.cwd(), 'data', 'database.sqlite'), driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode = WAL;');
  await db.run('PRAGMA foreign_keys = ON;');

  try {
    await db.run('BEGIN IMMEDIATE');

    // Step 1: CREATE TABLE merchant_bank_accounts (missing schema!)
    await db.run(`CREATE TABLE IF NOT EXISTS merchant_bank_accounts (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      account_nickname TEXT,
      bank_name TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      account_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      is_primary INTEGER NOT NULL DEFAULT 0,
      routing_ach_abain TEXT,
      routing_wire_usd_us TEXT,
      account_number TEXT NOT NULL,
      swift_bic TEXT,
      iban TEXT,
      address_line_1 TEXT,
      address_line_2 TEXT,
      city TEXT,
      state_province TEXT,
      postal_code TEXT,
      country TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT
    )`);
    console.log('✅ Step 1: merchant_bank_accounts table (CREATE IF NOT EXISTS) — done.');

    // Ensure only ONE primary per merchant + currency.
    await db.run(`UPDATE merchant_bank_accounts SET is_primary = 0 WHERE merchant_id = ? AND currency = ?`, [MID, WISE_USD.currency]);

    // Step 2: INSERT Wise USD account as primary.
    await db.run(`INSERT OR REPLACE INTO merchant_bank_accounts (
      id, merchant_id, account_nickname, bank_name, account_holder_name, account_type,
      currency, is_primary, routing_ach_abain, routing_wire_usd_us, account_number,
      swift_bic, iban, address_line_1, address_line_2, city, state_province, postal_code,
      country, notes, status, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, Object.values(WISE_USD));
    console.log('✅ Step 2: INSERT merchant_bank_accounts.id=' + BANK_ID + ' (PRIMESTACK TECHNOLOGIES LLC / Wise USD · routing 084009519 · a/c 34361…446 · SWIFT TRWIUS35XXX) — done.');

    // Step 3: UPDATE merchant_settings.extended_settings with receiving_bank reference.
    const cur = await db.get(`SELECT extended_settings FROM merchant_settings WHERE merchant_id = ? LIMIT 1`, [MID]);
    let es = {};
    try { es = cur && cur.extended_settings ? (typeof cur.extended_settings === 'string' ? JSON.parse(cur.extended_settings) : cur.extended_settings) : {}; }
    catch (_) { es = {}; }
    es.primary_receiving_bank = {
      USD: {
        bank_account_id: BANK_ID,
        method: 'DOMESTIC_US_FEDWIRE_ACH_084009519_OR_SWIFT_TRWIUS35XXX_INTNL',
        bank_name: WISE_USD.bank_name,
        account_holder: WISE_USD.account_holder_name,
        domestic_routing: WISE_USD.routing_wire_usd_us,
        account_number_masked: '…' + WISE_USD.account_number.slice(-6),
        international_swift: WISE_USD.swift_bic,
        country: WISE_USD.country,
        notes: WISE_USD.notes,
      },
    };
    await db.run(`UPDATE merchant_settings SET extended_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE merchant_id = ?`, [JSON.stringify(es), MID]);
    console.log('✅ Step 3: merchant_settings.extended_settings PRIMARY_RECEIVING_BANK USD → Wise USD — done.');

    // Step 4: UPDATE settlement meta (MAYBANK-MC-BATCH-20260814-MSSLG0) with beneficiary routing!
    const s = await db.get(`SELECT meta FROM merchant_pos_settlements WHERE id = ? LIMIT 1`, [SETTLE_ID]);
    let sm = {};
    try { sm = s && s.meta ? (typeof s.meta === 'string' ? JSON.parse(s.meta) : s.meta) : {}; }
    catch (_) { sm = {}; }
    sm.beneficiary_routing = {
      settlement_beneficiary_name: WISE_USD.account_holder_name,
      settlement_beneficiary_currency: 'USD',
      settlement_method: 'DOMESTIC_US_FEDWIRE_OR_ACH_THEN_INT_SWIFT_IF_XBORDER',
      domestic_us: {
        fedwire_ach_routing: WISE_USD.routing_wire_usd_us,
        depository_bank: 'Column Bank N.A. (Wise US partner bank) — Wilmington DE, USA',
        beneficiary_account_number: WISE_USD.account_number,
      },
      international_swift: {
        swift_bic: WISE_USD.swift_bic,
        beneficiary_bank_name: 'Wise US Inc / TRWIUS35XXX',
        beneficiary_name: WISE_USD.account_holder_name,
        beneficiary_address: `${WISE_USD.address_line_1}, ${WISE_USD.city} ${WISE_USD.state_province} ${WISE_USD.postal_code}, ${WISE_USD.country}`,
      },
      notes_for_bank_settlement_clerk:
        `Batch MAYBANK-MC-BATCH-20260814-MSSLG0 (Stan 000014, $5k USD). Pay to: PRIMESTACK TECHNOLOGIES LLC, via Wise USD.
         For domestic USD wires within USA: FedWire / ACH routing 084009519, a/c 343612919064346.
         For international wires (Maybank Malaysia → US): SWIFT TRWIUS35XXX, Beneficiary Wise US Inc, FFC/OBF: PRIMESTACK TECHNOLOGIES LLC a/c 343612919064346.
         Correspondent: Column Bank N.A., 108 W 13th St, Wilmington DE 19801. Routing 084009519.`,
      expected_settle_date: '2026-08-15 (T+1 Maybank MC batch / MEPS / Mastercard Net)',
      related_settlement_row_id: SETTLE_ID,
      related_customer_pan_last4: '8257',
      related_stan: '000014',
    };
    sm.batch_ref = sm.batch_ref || 'MAYBANK-MC-BATCH-20260814-MSSLG0';
    sm.receiving_bank_account_id = BANK_ID;
    sm.updated_routing_at = new Date().toISOString();
    await db.run(`UPDATE merchant_pos_settlements SET meta = ?, settled_at = settled_at WHERE id = ?`, [JSON.stringify(sm), SETTLE_ID]);
    console.log('✅ Step 4: merchant_pos_settlements.meta beneficiary_routing injected (Maybank $5k wire → Wise USD account 34361…446 via routing 084009519 / SWIFT TRWIUS35XXX) — done.');

    await db.run('COMMIT');
    console.log('\n✅ COMMIT — all routing writes atomic.');

    // Final audit.
    console.log('\n════════════════════════════════════════════════════════════════════════════════════');
    console.log('  🧾 FINAL AUDIT: MERCHANT RECEIVING BANK = WISE USD (Primestack Technologies LLC)');
    console.log('════════════════════════════════════════════════════════════════════════════════════');
    const banks = await db.all(`SELECT id, account_nickname, bank_name, account_holder_name, account_type, currency, is_primary,
      routing_ach_abain, routing_wire_usd_us, account_number, swift_bic, country, status
      FROM merchant_bank_accounts WHERE merchant_id = ? ORDER BY is_primary DESC, id DESC`, [MID]);
    console.log('\n  merchant_bank_accounts:');
    banks.forEach(r => console.log('   ·', JSON.stringify(r)));
    const ms = await db.get(`SELECT merchant_id, merchant_name, substr(extended_settings,1,600) ext_head FROM merchant_settings WHERE merchant_id = ?`, [MID]);
    console.log('\n  merchant_settings:');
    if (ms) console.log('   ', JSON.stringify(ms, null, 2).slice(0, 1200));
    const settle = await db.get(`SELECT id, merchant_id, amount, currency, status, settled_at, substr(meta,1,2200) meta_head FROM merchant_pos_settlements WHERE id = ?`, [SETTLE_ID]);
    console.log('\n  merchant_pos_settlements (the $5k row):');
    if (settle) {
      let mh; try { mh = settle.meta_head ? (typeof settle.meta_head === 'string' ? JSON.parse(settle.meta_head) : settle.meta_head) : {}; } catch (_) { mh = settle.meta_head; }
      console.log('   id           :', settle.id);
      console.log('   amount       :', settle.amount, settle.currency);
      console.log('   status       :', settle.status);
      console.log('   settled_at   :', settle.settled_at);
      console.log('   beneficiary  :', mh && mh.beneficiary_routing ? mh.beneficiary_routing.settlement_beneficiary_name : 'MISSING');
      console.log('   domestic R#  :', mh && mh.beneficiary_routing ? mh.beneficiary_routing.domestic_us.fedwire_ach_routing : 'MISSING');
      console.log('   a/c (masked) :', mh && mh.beneficiary_routing ? '…' + String(mh.beneficiary_routing.domestic_us.beneficiary_account_number).slice(-6) : 'MISSING');
      console.log('   SWIFT        :', mh && mh.beneficiary_routing ? mh.beneficiary_routing.international_swift.swift_bic : 'MISSING');
      console.log('   batch_ref    :', mh && mh.batch_ref);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════════════════════');
    console.log('  📝 INSTRUCTIONS FOR MAYBANK BATCH CLERK TOMORROW (15 Aug 2026 09:10 MYT):');
    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('   Maybank/MEPS/Mastercard netting will remit the $5,000.00 USD as per beneficiary:');
    console.log('');
    console.log('   ┌── DOMESTIC USD WITHIN USA (preferred, faster): ──────────────────────────────┐');
    console.log('   │   • Beneficiary        : PRIMESTACK TECHNOLOGIES LLC                         │');
    console.log('   │   • Depository Bank    : Column Bank N.A. (Wise US Inc, partner bank)        │');
    console.log('   │   • Routing (FedWire/ACH): 084009519                                         │');
    console.log('   │   • Account #          : 343612919064346                                     │');
    console.log('   │   • Address            : Wise US Inc, 108 W 13th St, Wilmington DE 19801    │');
    console.log('   └──────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('   ┌── CROSS-BORDER (Maybank MY → USA, SWIFT wire) ───────────────────────────────┐');
    console.log('   │   • SWIFT/BIC          : TRWIUS35XXX                                        │');
    console.log('   │   • Beneficiary Bank   : Wise US Inc  (via their receiving partner in US)   │');
    console.log('   │   • Beneficiary Name   : PRIMESTACK TECHNOLOGIES LLC                        │');
    console.log('   │   • FFC / OBF memo (MANDATORY!):  "FFC: 343612919064346 — Primestack LLC"  │');
    console.log('   │   • Correspondent      : Column Bank N.A., 108 W 13th St, Wilmington DE     │');
    console.log('   │   • Amount             : USD 5,000.00  (STAN 000014 / customer ****8257)    │');
    console.log('   └──────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('   ⚠️  If no FFC/OBF reference for SWIFT: Wise MAY reject the wire → money held in suspense.');
    console.log('      Domestic ACH/FedWire via 084009519 does NOT need the FFC reference (use exact a/c#).');
    console.log('');
    console.log('   🏁 Expected settlement in your Wise USD balance (Primestack LLC): 1–2 business days');
    console.log('      after Maybank batch upload. You will see a transaction labelled:');
    console.log('      "MAYBANK-MC-BATCH-20260814-MSSLG0 Stan000014 Mc8257 Harris".');

  } catch (err) {
    try { await db.run('ROLLBACK'); } catch (_) {}
    console.error('💥 FATAL (rolled back):', err && err.stack ? err.stack : String(err));
    process.exit(99);
  } finally {
    try { await db.close(); } catch {}
  }
})();
