/**
 * Treasury schema — tables used by the funds auto verifier, bank statement
 * processor and the report engines. Idempotent: safe to call on every request.
 */
import { db } from '../../config/db';

let ensured = false;

export async function ensureTreasuryTables(): Promise<void> {
  if (ensured) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS treasury_engine_runs (
      id TEXT PRIMARY KEY,
      engine TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      scanned INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      provider_called INTEGER NOT NULL DEFAULT 0,
      provider_endpoint TEXT,
      error TEXT,
      meta_json TEXT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_statements (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      currency TEXT,
      source_format TEXT,
      source TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      opening_balance REAL,
      closing_balance REAL,
      line_count INTEGER NOT NULL DEFAULT 0,
      imported_by TEXT,
      provider_request_id TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_statement_lines (
      id TEXT PRIMARY KEY,
      statement_id TEXT NOT NULL,
      source_format TEXT NOT NULL,
      account_id TEXT,
      currency TEXT,
      value_date TEXT,
      booking_date TEXT,
      amount REAL NOT NULL,
      credit_debit TEXT,
      reference TEXT,
      counterparty TEXT,
      narrative TEXT,
      match_status TEXT NOT NULL DEFAULT 'UNMATCHED',
      matched_ref TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_bsl_statement ON bank_statement_lines (statement_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bsl_match ON bank_statement_lines (match_status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bsl_reference ON bank_statement_lines (reference)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ter_engine ON treasury_engine_runs (engine, started_at)`);

  ensured = true;
}
