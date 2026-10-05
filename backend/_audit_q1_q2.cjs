const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql, p = []) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => {
        const o = {};
        r[0].columns.forEach((c, i) => o[c] = row[i]);
        return o;
      });
    } catch (e) { return []; }
  };

  console.log('══════════ QUESTION 1: transaction_settlements → REAL wallet credits? ══════════');
  console.log('\n--- transaction_settlements rows (3 rows: EUR x2 + USD x1) ---');
  q('SELECT * FROM transaction_settlements').forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- Link: transaction_settlements → merchant_pos_settlements ---');
  q(`
    SELECT
      ts.id AS settle_id,
      ts.pos_settlement_id,
      ts.transaction_id,
      ts.gross_amount, ts.fee_amount, ts.net_amount,
      ts.merchant_id, ts.currency, ts.settled_at,
      mps.amount AS mps_amount, mps.status AS mps_status, mps.settled_at AS mps_settled
    FROM transaction_settlements ts
    LEFT JOIN merchant_pos_settlements mps ON mps.id = ts.pos_settlement_id
  `).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- merchant_wallet_transactions WHERE source = pos_settlement (3 rows expected) ---');
  q(`SELECT * FROM merchant_wallet_transactions mwt WHERE source='pos_settlement' ORDER BY mwt.created_at DESC`).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- Manual link: look for pos_settlement source rows whose reference matches transaction_id ---');
  q(`
    SELECT
      ts.id AS settle_id, ts.transaction_id, ts.net_amount, ts.currency,
      mwt.id AS mwt_id, mwt.amount AS mwt_amount, mwt.type, mwt.source,
      mwt.reference AS mwt_reference, mwt.description, mwt.created_at AS mwt_time
    FROM transaction_settlements ts
    LEFT JOIN merchant_wallet_transactions mwt
      ON mwt.reference = ts.transaction_id
      OR CAST(mwt.reference AS TEXT) = CAST(ts.id AS TEXT)
      OR instr(COALESCE(mwt.description, ''), COALESCE(ts.transaction_id, '')) > 0
    WHERE mwt.source='pos_settlement'
    ORDER BY ts.id
  `).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- Full list of ALL merchant_wallet_transactions for reference ---');
  q(`SELECT mwt.id, mwt.type, mwt.amount, mwt.currency, mwt.source, mwt.reference, substr(mwt.description, 1, 80) AS desc80, mwt.created_at FROM merchant_wallet_transactions mwt ORDER BY mwt.created_at DESC`).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- QUESTION 2: Find the PENDING_APPROVAL 107,890.5 USDT payout ---');
  q(`SELECT * FROM merchant_payouts WHERE status IN ('PENDING_APPROVAL','PENDING') ORDER BY created_at DESC`).forEach(r => console.log(JSON.stringify(r)));

  console.log('\n--- Merchant crypto balances (source of funds for USDT payout) ---');
  q(`SELECT * FROM merchant_crypto_balances ORDER BY asset`).forEach(r => console.log(JSON.stringify(r)));
})();
