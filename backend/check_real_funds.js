const sqlite3 = require('better-sqlite3');
const db = new sqlite3('./data/database.sqlite');

console.log('\n💰 REAL FUNDS VERIFICATION\n');
console.log('='.repeat(80));

// Check POS transactions (money coming in)
console.log('\n📊 POS TRANSACTIONS (Real Money In):\n');
const txns = db.prepare('SELECT * FROM pos2013_transactions ORDER BY created_at DESC').all();
let totalIn = 0;
txns.forEach(t => {
  const amt = t.amount_minor / 100;
  totalIn += amt;
  console.log(`   ✅ $${amt.toLocaleString()} - Auth: ${t.auth_code} - Status: ${t.status}`);
});
console.log(`\n   TOTAL REAL MONEY IN: $${totalIn.toLocaleString()}\n`);

console.log('='.repeat(80));

// Check merchant wallets
console.log('\n💼 MERCHANT WALLETS (Where Money Should Be):\n');
const mWallets = db.prepare('SELECT * FROM merchant_wallets').all();
if (mWallets.length === 0) {
  console.log('   ❌ NO MERCHANT WALLETS FOUND!\n');
} else {
  mWallets.forEach(w => {
    console.log(`   Merchant: ${w.merchant_id}`);
    console.log(`   Balance: $${w.balance.toLocaleString()}`);
    console.log(`   Currency: ${w.currency}\n`);
  });
}

console.log('='.repeat(80));

// Check customer wallets
console.log('\n👤 CUSTOMER WALLETS (Where Customers See Balance):\n');
const cWallets = db.prepare('SELECT * FROM customer_wallets').all();
if (cWallets.length === 0) {
  console.log('   ❌ NO CUSTOMER WALLETS FOUND!\n');
} else {
  cWallets.forEach(w => {
    console.log(`   Customer: ${w.customer_id}`);
    console.log(`   Balance: $${w.balance.toLocaleString()}`);
    console.log(`   Currency: ${w.currency}`);
    console.log(`   Status: ${w.status}\n`);
  });
}

console.log('='.repeat(80));

// Check wallet transactions
console.log('\n📝 WALLET TRANSACTIONS (Ledger):\n');
const wTxns = db.prepare('SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT 10').all();
if (wTxns.length === 0) {
  console.log('   ❌ NO WALLET TRANSACTIONS!\n');
} else {
  console.log(`   Found ${wTxns.length} transaction(s):\n`);
  wTxns.forEach(t => {
    console.log(`   • ${t.type} - $${t.amount} - ${t.source}`);
  });
  console.log();
}

console.log('='.repeat(80));

// Check merchant wallet transactions
console.log('\n💼 MERCHANT WALLET TRANSACTIONS:\n');
const mWTxns = db.prepare('SELECT * FROM merchant_wallet_transactions ORDER BY created_at DESC LIMIT 10').all();
if (mWTxns.length === 0) {
  console.log('   ❌ NO MERCHANT WALLET TRANSACTIONS!\n');
} else {
  console.log(`   Found ${mWTxns.length} transaction(s):\n`);
  mWTxns.forEach(t => {
    console.log(`   • ${t.type} - $${t.amount} - ${t.source}`);
  });
  console.log();
}

console.log('='.repeat(80));
console.log('\n🎯 PROBLEM ANALYSIS:\n');

if (totalIn > 0 && mWallets.length === 0) {
  console.log('   ⚠️  FUNDS ARE IN POS BUT NO MERCHANT WALLET EXISTS!');
  console.log('   ⚠️  Need to create merchant wallet and credit with POS transaction amounts\n');
} else if (totalIn > 0 && mWallets[0]?.balance === 0) {
  console.log('   ⚠️  MERCHANT WALLET EXISTS BUT BALANCE IS $0!');
  console.log('   ⚠️  POS transactions are NOT being credited to wallet\n');
  console.log('   💡 SOLUTION: Need to credit merchant wallet with settled POS transactions\n');
} else if (totalIn > 0 && mWallets[0]?.balance > 0) {
  console.log('   ✅ MERCHANT WALLET HAS FUNDS!');
  console.log(`   ✅ Balance: $${mWallets[0].balance.toLocaleString()}\n`);
  
  if (mWallets[0].balance < totalIn) {
    console.log(`   ⚠️  WARNING: Wallet balance ($${mWallets[0].balance.toLocaleString()}) is less than POS total ($${totalIn.toLocaleString()})`);
    console.log(`   ⚠️  Missing: $${(totalIn - mWallets[0].balance).toLocaleString()}\n`);
  }
}

if (cWallets.length === 0) {
  console.log('   ℹ️  No customer wallets yet (customers haven\'t registered)\n');
}

console.log('='.repeat(80));
console.log('\n📋 SUMMARY:\n');
console.log(`   Real Money In (POS):        $${totalIn.toLocaleString()}`);
console.log(`   Merchant Wallet Balance:    $${mWallets[0]?.balance.toLocaleString() || '0'}`);
console.log(`   Customer Wallets:           ${cWallets.length}`);
console.log(`   Merchant Wallet Txns:       ${mWTxns.length}`);
console.log(`   Customer Wallet Txns:       ${wTxns.length}\n`);

console.log('='.repeat(80) + '\n');

db.close();
