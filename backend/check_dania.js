const Database = require("better-sqlite3");
const db = new Database("./data/database.sqlite");

const dania = db.prepare("SELECT * FROM customers WHERE name LIKE ?").all("%DANIA%");
console.log("CUSTOMER:", JSON.stringify(dania, null, 2));

if (dania.length > 0) {
  const custId = dania[0].id;
  const wallet = db.prepare("SELECT * FROM wallets WHERE customer_id = ?").all(custId);
  console.log("WALLET:", JSON.stringify(wallet, null, 2));

  const txns = db.prepare("SELECT * FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE customer_id = ?) ORDER BY created_at DESC LIMIT 10").all(custId);
  console.log("RECENT TRANSACTIONS:", JSON.stringify(txns, null, 2));
}
db.close();
