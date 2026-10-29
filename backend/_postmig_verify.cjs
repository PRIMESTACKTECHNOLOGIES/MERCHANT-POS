require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');

  // 1. Verify fund_provider_calls was created
  const fp = await db.query(`PRAGMA table_info(fund_provider_calls)`);
  console.log('fund_provider_calls cols (# =', fp.rows.length, '):');
  if (fp.rows.length) {
    console.log(fp.rows.map(r => '  ' + r.name + ' ' + r.type).join('\n'));
  } else {
    // ensure again lazily via insertFundProviderCall + a test row
    console.log(' fund_provider_calls table not found; creating via ensureFundProviderCallsTable()...');
    await require('./src/services/fundProviderAudit.service').ensureFundProviderCallsTable();
    const fp2 = await db.query(`PRAGMA table_info(fund_provider_calls)`);
    console.log(' fund_provider_calls cols now:', fp2.rows.length);
    console.log(fp2.rows.map(r => '  ' + r.name + ' ' + r.type).join('\n'));
  }

  const cs = await db.query(`PRAGMA table_info(card_settlements)`);
  console.log('\ncard_settlements cols (# =', cs.rows.length, '):');
  console.log(cs.rows.map(r => '  ' + r.name + ' ' + r.type).join('\n'));

  const mw = await db.query(`PRAGMA table_info(merchant_wallet_transactions)`);
  console.log('\nmerchant_wallet_transactions cols (# =', mw.rows.length, '):');
  console.log(mw.rows.map(r => '  ' + r.name + ' ' + r.type).join('\n'));

  // 2. Today's merchant wallet transactions (SELECT *)
  console.log('\n=== Today (Sep 27) merchant_wallet_transactions rows (SELECT *): ===');
  try {
    const r = await db.query(
      `SELECT * FROM merchant_wallet_transactions
        WHERE date(created_at) IN ('2026-09-27') ORDER BY created_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  // 3. Today's card_settlements rows
  console.log('\n=== Today card_settlements rows (SELECT *): ===');
  try {
    const r = await db.query(
      `SELECT * FROM card_settlements
        WHERE date(created_at) IN ('2026-09-27') ORDER BY created_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  // 4. Full scan for 7789, 000001, muj277j8, setl_online, txn_179051
  const tokens = ['7789','000001','muj277j8','setl_online','txn_179051','5nub0nij5','CAP-924648'];
  const allTables = (await db.query(`SELECT name FROM sqlite_master WHERE type='table'`)).rows.map(r => r.name);
  console.log('\n=== GLOBAL DB search for user receipt tokens ===');
  for (const tok of tokens) {
    let found = false;
    for (const t of allTables) {
      const cols = (await db.query(`PRAGMA table_info(${t})`)).rows.map(c => c.name);
      if (!cols.length) continue;
      const where = cols.map(c => `COALESCE(CAST(${c} AS TEXT),'') LIKE '%${tok}%'`).join(' OR ');
      try {
        const r = await db.query(`SELECT * FROM ${t} WHERE ${where} LIMIT 3`);
        if (r.rows && r.rows.length) {
          console.log(`FOUND token="${tok}" in table=${t}`);
          console.log(JSON.stringify(r.rows,null,2).split('\n').map(l=>'  '+l).join('\n'));
          found = true;
        }
      } catch {}
    }
    if (!found) console.log(`NOT FOUND token="${tok}" in any DB table`);
  }

  // 5. Force sanity check that TEST_1USD_SANDBOX gate actually triggers (check env var)
  console.log('\n=== Process env TEST_1USD_SANDBOX, PROCESSOR_ACTIVATED ===');
  require('dotenv').config && require('dotenv').config({ path: require('path').resolve(process.cwd(), '..', '.env') });
  console.log('TEST_1USD_SANDBOX =', JSON.stringify(process.env.TEST_1USD_SANDBOX));
  console.log('PROCESSOR_ACTIVATED =', JSON.stringify(process.env.PROCESSOR_ACTIVATED));
  try {
    const aqu = require('./src/config/acquirer');
    console.log('isInternalProcessorAllowed():', aqu.isInternalProcessorAllowed ? aqu.isInternalProcessorAllowed() : '(no export)');
    console.log('isProcessorOnline():', aqu.isProcessorOnline ? aqu.isProcessorOnline() : '(no export)');
    console.log('isAcquirerConfigured():', aqu.isAcquirerConfigured ? aqu.isAcquirerConfigured() : '(no export)');
  } catch(e) { console.log('acquirer import err:', e.message); }
})();
