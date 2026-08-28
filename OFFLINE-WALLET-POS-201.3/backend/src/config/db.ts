import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

// Enable verbose mode for debugging
sqlite3.verbose();

class DbAdapter {
  private dbPromise: Promise<Database> | null = null;

  constructor() {
    this.initDb();
  }

  async initDb() {
    if (!this.dbPromise) {
      this.dbPromise = open({
        filename: path.join(__dirname, '../../../database.sqlite'),
        driver: sqlite3.Database
      });
      const db = await this.dbPromise;
      await db.run('PRAGMA foreign_keys = ON;'); // Enable foreign keys
    }
    return this.dbPromise;
  }

  async query(text: string, params: any[] = []): Promise<any> {
    const db = await this.initDb();
    
    // Convert Postgres $1, $2 syntax to SQLite ? syntax
    // Note: This is a simple replacement and assumes params are ordered correctly.
    // Ideally, we should parse the SQL properly, but for this project scope, regex is usually enough.
    let sqliteText = text;
    let paramIndex = 1;
    while (sqliteText.includes(`$${paramIndex}`)) {
      sqliteText = sqliteText.replace(`$${paramIndex}`, '?');
      paramIndex++;
    }
    // Also replace any remaining $N (if skipped or out of order, though unlikely in simple queries)
    sqliteText = sqliteText.replace(/\$\d+/g, '?');

    // Handle "RETURNING *" which SQLite supports in newer versions, but let's be safe
    // For now, let's assume SQLite 3.35+ which supports RETURNING.
    // If not, we might need to adjust queries.

    const command = sqliteText.trim().toUpperCase().split(' ')[0];

    try {
      if (command === 'SELECT' || sqliteText.toUpperCase().includes('RETURNING')) {
        const rows = await db.all(sqliteText, params);
        return { rows, rowCount: rows.length };
      } else {
        const result = await db.run(sqliteText, params);
        return { rows: [], rowCount: result.changes };
      }
    } catch (err: any) {
      console.error('SQLite Error:', err.message, '\nQuery:', sqliteText, '\nParams:', params);
      throw err;
    }
  }

  // Mock connect() to return a client-like object
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {}, // No-op
    };
  }
}

export const db = new DbAdapter();
