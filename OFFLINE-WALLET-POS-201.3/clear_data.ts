import { db } from "./src/config/db";

async function clearData() {
  console.log("Clearing Mock Transactions...");
  await db.query("DELETE FROM pos2013_transactions");
  await db.query("DELETE FROM pos2013_batches");
  console.log("Mock Transactions Cleared!");
  process.exit(0);
}

clearData();
