const sqlite3 = require('better-sqlite3');
const db = new sqlite3('./data/database.sqlite');

console.log('\n💰 CUSTOMER WALLET LEDGER FUNDS');
console.log('═'.repeat(70));

// Check USD/Fiat wallets
console.log('\n📊 USD/FIAT WALLETS (customer_wallets table):\n');
const wallets = db.prepare(`
  SELECT 
    c.id as customer_id,
    c.name,
    c.email,
    w.id as wallet_id,
    w.balance,
    w.currency,
    w.status,
    w.wallet_code,
    w.created_at
  FROM customers c
  LEFT JOIN customer_wallets w ON c.id = w.customer_id
  ORDER BY c.name
`).all();

if (wallets.length === 0) {
  console.log('   ❌ No customer wallets found');
} else {
  wallets.forEach(w => {
    console.log(`   Customer: ${w.name}`);
    console.log(`   ├─ Email: ${w.email || 'N/A'}`);
    console.log(`   ├─ Wallet ID: ${w.wallet_id || 'N/A'}`);
    console.log(`   ├─ Balance: $${w.balance || 0} ${w.currency || 'USD'}`);
    console.log(`   ├─ Status: ${w.status || 'N/A'}`);
    console.log(`   ├─ Wallet Code: ${w.wallet_code || 'N/A'}`);
    console.log(`   └─ Created: ${w.created_at || 'N/A'}\n`);
  });
}

// Check Crypto wallets
console.log('\n🪙 CRYPTO WALLETS (customer_crypto_wallets table):\n');
const crypto = db.prepare(`
  SELECT 
    c.name,
    cw.id as wallet_id,
    cw.crypto_coin,
    cw.balance,
    cw.crypto_address,
    cw.status,
    cw.created_at
  FROM customers c
  LEFT JOIN customer_crypto_wallets cw ON c.id = cw.customer_id
  WHERE cw.id IS NOT NULL
  ORDER BY c.name, cw.crypto_coin
`).all();

if (crypto.length === 0) {
  console.log('   ❌ No crypto wallets found');
} else {
  crypto.forEach(w => {
    console.log(`   Customer: ${w.name}`);
    console.log(`   ├─ Coin: ${w.crypto_coin}`);
    console.log(`   ├─ Balance: ${w.balance} ${w.crypto_coin}`);
    console.log(`   ├─ Address: ${w.crypto_address || 'Not assigned'}`);
    console.log(`   ├─ Status: ${w.status}`);
    console.log(`   └─ Created: ${w.created_at}\n`);
  });
}

// Calculate totals
console.log('\n📊 TOTAL PLATFORM LIABILITY (What Platform Owes Customers):\n');
const totalUSD = db.prepare('SELECT SUM(balance) as total FROM customer_wallets').get();
console.log(`   💵 Total USD: $${totalUSD.total || 0}`);

const totalCrypto = db.prepare('SELECT crypto_coin, SUM(balance) as total FROM customer_crypto_wallets GROUP BY crypto_coin').all();
if (totalCrypto.length === 0) {
  console.log('   🪙 Total Crypto: None');
} else {
  console.log('   🪙 Total Crypto:');
  totalCrypto.forEach(c => {
    console.log(`      ${c.crypto_coin}: ${c.total}`);
  });
}

// Check transaction history
console.log('\n\n📜 WALLET TRANSACTION HISTORY (wallet_transactions table):\n');
const txns = db.prepare(`
  SELECT 
    wt.id,
    wt.type,
    wt.amount,
    wt.currency,
    wt.source,
    wt.description,
    wt.created_at,
    c.name as customer_name
  FROM wallet_transactions wt
  JOIN customer_wallets w ON wt.wallet_id = w.id
  JOIN customers c ON w.customer_id = c.id
  ORDER BY wt.created_at DESC
  LIMIT 10
`).all();

if (txns.length === 0) {
  console.log('   ❌ No transaction history');
} else {
  txns.forEach((t, i) => {
    console.log(`   [${i + 1}] ${t.customer_name}`);
    console.log(`       Type: ${t.type.toUpperCase()}`);
    console.log(`       Amount: ${t.type === 'credit' ? '+' : '-'}$${t.amount} ${t.currency}`);
    console.log(`       Source: ${t.source}`);
    console.log(`       Description: ${t.description || 'N/A'}`);
    console.log(`       Date: ${t.created_at}\n`);
  });
}

console.log('\n═'.repeat(70));
console.log('🎯 LEDGER LOCATION:\n');
console.log('   Database: ./data/database.sqlite');
console.log('   Tables:');
console.log('   ├─ customer_wallets (USD/Fiat balances)');
console.log('   ├─ customer_crypto_wallets (Crypto balances)');
console.log('   ├─ wallet_transactions (USD transaction history)');
console.log('   └─ crypto_transactions (Crypto transaction history)');
console.log('\n═'.repeat(70));

db.close();
