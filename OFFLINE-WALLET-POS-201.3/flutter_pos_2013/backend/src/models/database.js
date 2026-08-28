const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/pos_2013.db');

let db = null;

function getDatabase() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection failed:', err);
      } else {
        console.log('Connected to SQLite database');
      }
    });
  }
  return db;
}

function initializeDatabase() {
  const database = getDatabase();
  
  database.serialize(() => {
    // Transactions table
    database.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_txn_id TEXT NOT NULL UNIQUE,
        gateway_txn_id TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        card_number_masked TEXT,
        cardholder_name TEXT,
        status TEXT NOT NULL,
        auth_code TEXT,
        error_code TEXT,
        error_message TEXT,
        idempotency_key TEXT UNIQUE,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Idempotency cache
    database.run(`
      CREATE TABLE IF NOT EXISTS idempotency_cache (
        key TEXT PRIMARY KEY,
        response TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sync logs
    database.run(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_txn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized');
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  initializeDatabase,
  getDatabase,
  run,
  get,
  all
};
