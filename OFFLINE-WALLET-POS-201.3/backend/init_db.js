"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const client = new pg_1.Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "yourpassword",
    database: process.env.DB_NAME || "posdb"
});
const createTerminalsTable = `
CREATE TABLE IF NOT EXISTS terminals ( 
   id UUID PRIMARY KEY, 
   merchant_id VARCHAR(64) NOT NULL, 
   terminal_id VARCHAR(64) NOT NULL, 
   name VARCHAR(128) NOT NULL, 
   terminal_secret VARCHAR(128) NOT NULL, 
   offline_enabled BOOLEAN DEFAULT TRUE, 
   last_batch_at TIMESTAMP NULL, 
   created_at TIMESTAMP DEFAULT NOW() 
);
`;
const createTransactionsTable = `
CREATE TABLE IF NOT EXISTS pos2013_transactions ( 
   id UUID PRIMARY KEY, 
   merchant_id VARCHAR(64) NOT NULL, 
   terminal_id VARCHAR(64) NOT NULL, 
   batch_id VARCHAR(64) NOT NULL, 
   local_txn_id VARCHAR(64) NOT NULL, 
   stan VARCHAR(6) NOT NULL, 
   amount_minor BIGINT NOT NULL, 
   currency VARCHAR(3) NOT NULL, 
   status VARCHAR(16) NOT NULL, 
   txn_timestamp TIMESTAMP NOT NULL, 
   created_at TIMESTAMP DEFAULT NOW(), 
   UNIQUE (merchant_id, terminal_id, batch_id, local_txn_id) 
);
`;
async function run() {
    try {
        await client.connect();
        console.log("Connected to database");
        await client.query(createTerminalsTable);
        console.log("Table 'terminals' created/verified successfully");
        await client.query(createTransactionsTable);
        console.log("Table 'pos2013_transactions' created/verified successfully");
    }
    catch (err) {
        console.error("Error executing query", err);
    }
    finally {
        await client.end();
    }
}
run();
