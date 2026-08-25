const Database = require('better-sqlite3');
const db = new Database('data/database.sqlite', { readonly: true });
for (const table of ['customer_crypto_wallets', 'customer_crypto_withdrawals', 'crypto_transactions', 'crypto_wallet_transactions_v2']) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) continue;
  console.log(`\n=== ${table} ===`);
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT 20`).all();
  for (const row of rows) console.log(JSON.stringify(row));
}
db.close();
