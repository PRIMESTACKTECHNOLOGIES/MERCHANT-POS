require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');

  console.log('=== SCHEMA: column lists for all relevant tables ===');
  const probeTables = [
    'card_settlements','card_authorizations','authorization_holds',
    'pos2013_transactions','stored_txns','merchant_wallets','merchant_wallet_transactions',
    'customer_wallets','wallet_transactions','card_captures',
    'batch_settlement','settlement_batches','merchant_pos_settlements',
    'offline_txns','offline_funds_receipts','wallet_offline_transactions',
    'fund_provider_calls','vault_ledger','vault_entries',
  ];
  for (const t of probeTables) {
    try {
      const r = await db.query(`PRAGMA table_info(${t})`);
      if (r.rows && r.rows.length) {
        console.log(`\n[${t}] (${r.rows.length} cols):`);
        console.log(r.rows.map(c => `  ${c.name} ${c.type}`).join('\n'));
      }
    } catch(e) { /* skip missing tables */ }
  }

  console.log('\n\n=== SEARCH for reference strings across ALL tables ===');
  const needles = ['txn_1790513622314_5nub0nij5', 'setl_online_muj277j8', '000001', '7789', 'MANUAL', 'ONLINE_APPROVED'];
  for (const t of probeTables) {
    let cols = [];
    try {
      const c = await db.query(`PRAGMA table_info(${t})`);
      cols = c.rows.map(r => r.name);
    } catch { continue; }
    if (!cols.length) continue;
    const where = cols.map(c => `COALESCE(CAST(${c} AS TEXT), '') LIKE '%' || ? || '%'`).join(' OR ');
    try {
      for (const needle of needles) {
        const r = await db.query(`SELECT * FROM ${t} WHERE ${where} LIMIT 3`, [needle]);
        if (r.rows && r.rows.length) {
          console.log(`\n>>> In table ${t}, matched "${needle}":`);
          for (const row of r.rows) console.log('  ' + JSON.stringify(row));
        }
      }
    } catch(e) {
      console.log(`  [WARN ${t}]: ${e.message}`);
    }
  }

  console.log('\n\n=== Today (Sep 27) $1.00 customer wallet entries:');
  try {
    const r = await db.query(
      `SELECT * FROM wallet_transactions
        WHERE ABS(amount - 1.0) < 0.001 AND currency = 'USD'
          AND date(created_at) = date('2026-09-27')
        ORDER BY created_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  console.log('\n=== Today $1.00 merchant wallet entries:');
  try {
    const r = await db.query(
      `SELECT * FROM merchant_wallet_transactions
        WHERE ABS(amount - 1.0) < 0.001 AND currency = 'USD'
          AND date(created_at) = date('2026-09-27')
        ORDER BY created_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  console.log('\n=== Today merchant wallet current balances:');
  try {
    const r = await db.query(
      `SELECT * FROM merchant_wallets WHERE balance > 0 ORDER BY updated_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }

  console.log('\n=== Today customer wallet current balances ($1 range):');
  try {
    const r = await db.query(
      `SELECT * FROM customer_wallets
        WHERE ABS(balance - 1.0) < 0.01 OR balance > 0
        ORDER BY updated_at DESC LIMIT 20`
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch(e) { console.log(e.message); }
})();
