import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

// Enable verbose mode for debugging
sqlite3.verbose();

class DbAdapter {
  private dbPromise: Promise<Database>;

  constructor() {
    this.dbPromise = open({
      filename: path.join(__dirname, '../../database.sqlite'),
      driver: sqlite3.Database
    });
  }

  async query(text: string, params: any[] = []): Promise<any> {
    const db = await this.dbPromise;
    
    // Convert Postgres $1, $2 syntax to SQLite ? syntax
    // This is a simple regex replacement. It might fail for complex strings containing $1, but should work for most queries.
    const sqliteText = text.replace(/\$\d+/g, '?');

    // Check if it's a SELECT or INSERT/UPDATE/DELETE
    const command = text.trim().toUpperCase().split(' ')[0];

    try {
      if (command === 'SELECT' || text.includes('RETURNING')) {
        // For RETURNING, we might need special handling if SQLite version is old, 
        // but modern sqlite3 supports RETURNING. 
        // If it fails, we might need a polyfill, but let's try direct execution first.
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

  // Mock connect() to return self (since SQLite is file-based and "always connected" in this wrapper)
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {}, // No-op for release
    };
  }
}

export const db = new DbAdapter();
