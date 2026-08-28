import { Client } from 'pg';

const client = new Client({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "pos_db",
  password: process.env.DB_PASSWORD || "password",
  port: parseInt(process.env.DB_PORT || "5432"),
});

const createTableQuery = `
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

async function run() {
  try {
    await client.connect();
    console.log("Connected to database");
    await client.query(createTableQuery);
    console.log("Table 'terminals' created successfully");
  } catch (err) {
    console.error("Error executing query", err);
  } finally {
    await client.end();
  }
}

run();
