require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');

  // 1. Force fund_provider_calls + any tables created inside fundProviderAudit.service.ts
  console.log('1. Running fund_provider_calls table migration...');
  await require('./src/services/fundProviderAudit.service').ensureFundProviderCallsTable();
  console.log('   fund_provider_calls table OK');

  // 2. ALTER card_settlements to add audit columns if missing
  console.log('\n2. Checking card_settlements table...');
  const cardSettlementsCols = (await db.query(`PRAGMA table_info(card_settlements)`)).rows.map(r => r.name);
  console.log('   Current cols:', cardSettlementsCols.join(', '));

  const cardSettlementsToAdd = [
    ['fund_provider_audit_id',    'TEXT'],
    ['fund_provider_endpoint',    'TEXT'],
    ['fund_provider_http_status', 'INTEGER'],
    ['fund_provider_response_code','TEXT'],
    ['fund_provider_reference',   'TEXT'],
    ['fund_provider_raw_trunc',   'TEXT'],
    ['provider_reconcile_warning','TEXT'],
  ];
  for (const [name, type] of cardSettlementsToAdd) {
    if (!cardSettlementsCols.includes(name)) {
      try {
        await db.query(`ALTER TABLE card_settlements ADD COLUMN ${name} ${type}`);
        console.log(`   + Added ${name}`);
      } catch(e) { console.log(`   ! Skip ${name}:`, e.message); }
    } else {
      console.log(`   = ${name} already exists`);
    }
  }

  // 3. ALTER merchant_wallet_transactions to add audit cols + provider_reference
  console.log('\n3. Checking merchant_wallet_transactions table...');
  const mwtCols = (await db.query(`PRAGMA table_info(merchant_wallet_transactions)`)).rows.map(r => r.name);
  console.log('   Current cols:', mwtCols.join(', '));
  const mwtToAdd = [
    ['fund_provider_audit_id', 'TEXT'],
    ['provider_reference',     'TEXT'],
    ['settlement_batch_id',    'TEXT'],
  ];
  for (const [name, type] of mwtToAdd) {
    if (!mwtCols.includes(name)) {
      try {
        await db.query(`ALTER TABLE merchant_wallet_transactions ADD COLUMN ${name} ${type}`);
        console.log(`   + Added ${name}`);
      } catch(e) { console.log(`   ! Skip ${name}:`, e.message); }
    } else {
      console.log(`   = ${name} already exists`);
    }
  }

  // 4. ALTER card_settlements to add STAN, pan_last4 if missing (to cross-reference receipt)
  console.log('\n4. card_settlements tracking cols...');
  const csCols = (await db.query(`PRAGMA table_info(card_settlements)`)).rows.map(r => r.name);
  const trackingCols = [
    ['stan',       'TEXT'],
    ['pan_last4',  'TEXT'],
    ['pan_masked', 'TEXT'],
    ['entry_mode', 'TEXT'],
    ['auth_mode',  'TEXT'],
    ['settlement_code', 'TEXT'],
  ];
  for (const [name, type] of trackingCols) {
    if (!csCols.includes(name)) {
      try {
        await db.query(`ALTER TABLE card_settlements ADD COLUMN ${name} ${type}`);
        console.log(`   + Added ${name}`);
      } catch(e) { console.log(`   ! Skip ${name}:`, e.message); }
    } else {
      console.log(`   = ${name} already exists`);
    }
  }

  // 5. Final verification
  console.log('\n\n=== FINAL SCHEMA VERIFICATION ===');
  const verTables = ['fund_provider_calls', 'card_settlements', 'merchant_wallet_transactions'];
  for (const t of verTables) {
    const c = (await db.query(`PRAGMA table_info(${t})`)).rows;
    console.log(`\n[${t}] (${c.length} cols)`);
    for (const col of c) console.log(`  ${col.name.padEnd(34)} ${col.type}`);
  }

  // 6. Also check today's merchant wallet rows after migration
  console.log('\n=== Today merchant_wallet_transactions after schema update (SELECT all cols) ===');
  try {
    const cols = (await db.query(`PRAGMA table_info(merchant_wallet_transactions)`)).rows.map(r => r.name);
    const r = await db.query(
      `SELECT ${cols.join(', ')} FROM merchant_wallet_transactions
        WHERE date(created_at) = '2026-09-27' ORDER BY created_at DESC LIMIT 10`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  console.log('\nAll migrations applied successfully.');
})();
