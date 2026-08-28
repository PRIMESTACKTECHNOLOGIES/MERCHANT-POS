import { db } from "./src/config/db";

async function clearTerminals() {
  console.log("Clearing All Terminals...");
  await db.query("DELETE FROM terminals");
  console.log("Terminals Cleared!");
  
  // Re-insert default Web POS terminal
  console.log("Creating default Web POS Terminal...");
  await db.query(`
    INSERT INTO terminals (id, merchant_id, terminal_id, name, terminal_secret, offline_enabled)
    VALUES ('WEB-POS-01', 'MRC-1001', 'WEB-POS-01', 'Web POS (Default)', 'default-secret', 0)
  `);
  console.log("Default Web POS Terminal Created.");
  
  process.exit(0);
}

clearTerminals();
