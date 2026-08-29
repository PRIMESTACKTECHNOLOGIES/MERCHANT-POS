const sqlite3 = require('better-sqlite3');
const db = new sqlite3('./data/database.sqlite');

console.log('\n🔍 CHECKING STORED TRANSACTIONS FROM YOUR SCREENSHOT\n');
console.log('═'.repeat(80));

// Check for specific amounts from screenshot
console.log('\n📊 Searching for these exact transactions:\n');
console.log('   1. $50.00 - Card ••••8257 - Auth: 738471 - 8/14/2026, 5:59:12 AM');
console.log('   2. $995.00 - Card ••••5363 - Auth: 373260 - 8/13/2026, 6:59:20 PM');
console.log('   3. $4990.00 - Card ••••8257 - Auth: 942796 - 8/13/2026, 4:17:34 AM\n');

const searchAmounts = [
  { amount: 50, card: '8257', auth: '738471' },
  { amount: 995, card: '5363', auth: '373260' },
  { amount: 4990, card: '8257', auth: '942796' }
];

let foundCount = 0;

searchAmounts.forEach((search, index) => {
  console.log(`\n[${index + 1}] Searching for $${search.amount}.00 transaction:`);
  
  // Search by amount
  const byAmount = db.prepare(`
    SELECT * FROM pos2013_transactions 
    WHERE amount_minor = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(search.amount * 100);
  
  if (byAmount.length > 0) {
    console.log(`   ✅ Found ${byAmount.length} transaction(s) with amount $${search.amount}`);
    byAmount.forEach((t, i) => {
      const matches = {
        amount: true,
        card: t.pan_masked && t.pan_masked.includes(search.card),
        auth: t.auth_code === search.auth
      };
      
      console.log(`\n   Transaction #${i + 1}:`);
      console.log(`      Amount: $${(t.amount_minor / 100).toFixed(2)} ${matches.amount ? '✅' : '❌'}`);
      console.log(`      Card: ${t.pan_masked || 'N/A'} ${matches.card ? '✅' : '❌'}`);
      console.log(`      Auth Code: ${t.auth_code || 'N/A'} ${matches.auth ? '✅' : '❌'}`);
      console.log(`      Terminal: ${t.terminal_id}`);
      console.log(`      Merchant: ${t.merchant_id}`);
      console.log(`      Date: ${t.txn_timestamp || t.created_at}`);
      console.log(`      Status: ${t.status || 'N/A'}`);
      console.log(`      STAN: ${t.stan || 'N/A'}`);
      console.log(`      Batch: ${t.batch_id || 'N/A'}`);
      
      if (matches.amount && matches.card && matches.auth) {
        console.log(`      🎯 EXACT MATCH FOUND!`);
        foundCount++;
      }
    });
  } else {
    console.log(`   ❌ NOT FOUND in database`);
  }
});

// Show all transactions in database
console.log('\n\n📋 ALL TRANSACTIONS IN DATABASE:\n');
const allTxns = db.prepare(`
  SELECT * FROM pos2013_transactions 
  ORDER BY created_at DESC 
  LIMIT 20
`).all();

if (allTxns.length === 0) {
  console.log('   ❌ No transactions found in pos2013_transactions table\n');
} else {
  console.log(`   Found ${allTxns.length} total transaction(s):\n`);
  allTxns.forEach((t, i) => {
    console.log(`   [${i + 1}] $${(t.amount_minor / 100).toFixed(2)} - Card ${t.pan_masked || 'N/A'} - Auth: ${t.auth_code || 'N/A'}`);
    console.log(`       Terminal: ${t.terminal_id} | Date: ${t.txn_timestamp || t.created_at}`);
    console.log(`       Status: ${t.status || 'N/A'} | Batch: ${t.batch_id || 'N/A'}\n`);
  });
}

// Check batches
console.log('\n📦 BATCH RECORDS:\n');
const batches = db.prepare(`
  SELECT * FROM pos2013_batches 
  ORDER BY created_at DESC 
  LIMIT 10
`).all();

if (batches.length === 0) {
  console.log('   ❌ No batches found\n');
} else {
  console.log(`   Found ${batches.length} batch(es):\n`);
  batches.forEach((b, i) => {
    console.log(`   [${i + 1}] Batch: ${b.batch_id}`);
    console.log(`       Merchant: ${b.merchant_id} | Terminal: ${b.terminal_id}`);
    console.log(`       Txns: ${b.txn_count} | Amount: $${((b.total_amount_minor || 0) / 100).toFixed(2)}`);
    console.log(`       Status: ${b.status} | Date: ${b.upload_timestamp || b.created_at}\n`);
  });
}

console.log('\n═'.repeat(80));
console.log('\n🎯 VERDICT:\n');

if (foundCount === 3) {
  console.log('   ✅ ALL 3 TRANSACTIONS FROM SCREENSHOT FOUND IN DATABASE');
  console.log('   ✅ These are REAL transactions, not mockup data\n');
} else if (foundCount > 0) {
  console.log(`   ⚠️  Found ${foundCount} out of 3 transactions`);
  console.log('   ⚠️  Some transactions might be real, others might be mockup\n');
} else {
  console.log('   ❌ NONE of the screenshot transactions found in database');
  console.log('   ❌ Screenshot shows MOCKUP/DEMO data (not real transactions)\n');
}

console.log('═'.repeat(80) + '\n');

db.close();
