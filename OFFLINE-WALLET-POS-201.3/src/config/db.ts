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
      const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../../pos_offline.sqlite');
      console.log(`Using database at: ${dbPath}`);
      this.dbPromise = open({
        filename: dbPath, 
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
    let sqliteText = text;
    let paramIndex = 1;
    while (sqliteText.includes(`$${paramIndex}`)) {
      sqliteText = sqliteText.replace(`$${paramIndex}`, '?');
      paramIndex++;
    }
    // Also replace any remaining $N
    sqliteText = sqliteText.replace(/\$\d+/g, '?');

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

  // Mock connect()
  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {}, 
    };
  }
}

export const db = new DbAdapter();
