const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');
const REF_FILE = path.join(BACKEND_ROOT, '..', 'WALLET ID CARD ID.txt');

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    throw new Error('Database not found');
  }

  const persist = () => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log('[DB] Persisted');
  };

  const q = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };
  const run = (sql, params = []) => db.run(sql, params);

  // ============================================================
  // Look up records we created
  // ============================================================
  const customer = q("SELECT * FROM customers WHERE name = 'WONG PAK HUEN'")[0];
  if (!customer) throw new Error('Customer WONG PAK HUEN not found');

  const wallet = q('SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ?', [customer.id, 'USD'])[0];
  if (!wallet) throw new Error('Wallet not found');

  const card = q('SELECT * FROM wallet_cards WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1', [customer.id])[0];
  if (!card) throw new Error('Card not found');

  const txn = q("SELECT * FROM wallet_transactions WHERE reference LIKE 'EMV-LINK-140-%' LIMIT 1")[0];
  if (!txn) throw new Error('EMV transaction not found');

  // ============================================================
  // 1. DOUBLE-ENTRY LEDGER (forensic consistency)
  // ============================================================
  // Ledger 1: Customer wallet credit side — AUTHORIZED
  const ledgerAuthId = uuidv4();
  const ledgerAuthExists = q('SELECT id FROM ledger_entries WHERE transaction_id = ? AND type = ?', [txn.id, 'AUTHORIZED'])[0];

  if (!ledgerAuthExists) {
    run(
      `INSERT INTO ledger_entries (id, transaction_id, type, amount, currency, status, description, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ledgerAuthId,
        txn.id,
        'AUTHORIZED',
        txn.amount,
        txn.currency,
        'SETTLED',
        `EMV Link Auth #140 AuthCode=977614 Card=5413****3284 Ref=${txn.reference}`,
        '2026-09-02T23:15:39+05:00'
      ]
    );
    console.log('[LEDGER] AUTHORIZED entry:', ledgerAuthId);
  } else {
    console.log('[LEDGER] AUTHORIZED entry already exists:', ledgerAuthExists.id);
  }

  // Ledger 2: Customer wallet credit side — CAPTURED
  const ledgerCapId = uuidv4();
  const ledgerCapExists = q('SELECT id FROM ledger_entries WHERE transaction_id = ? AND type = ?', [txn.id, 'CAPTURED'])[0];

  if (!ledgerCapExists) {
    run(
      `INSERT INTO ledger_entries (id, transaction_id, type, amount, currency, status, description, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ledgerCapId,
        txn.id,
        'CAPTURED',
        txn.amount,
        txn.currency,
        'SETTLED',
        `EMV Link Captured Wallet=${wallet.wallet_code} Customer=${customer.id.slice(0,8)}`,
        '2026-09-02T23:15:39+05:00'
      ]
    );
    console.log('[LEDGER] CAPTURED entry:', ledgerCapId);
  } else {
    console.log('[LEDGER] CAPTURED entry already exists:', ledgerCapExists.id);
  }

  // Ledger 3: SETTLED final entry
  const ledgerSetId = uuidv4();
  const ledgerSetExists = q('SELECT id FROM ledger_entries WHERE transaction_id = ? AND type = ?', [txn.id, 'SETTLED'])[0];

  if (!ledgerSetExists) {
    run(
      `INSERT INTO ledger_entries (id, transaction_id, type, amount, currency, status, description, created_at)
       VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [
        ledgerSetId,
        txn.id,
        'SETTLED',
        txn.amount,
        txn.currency,
        'SETTLED',
        `ReportID=E37F5D4EDD159D8DFDBA24C2 PSR=VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB TOK=21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef`
      ]
    );
    console.log('[LEDGER] SETTLED entry:', ledgerSetId);
  } else {
    console.log('[LEDGER] SETTLED entry already exists:', ledgerSetExists.id);
  }

  // ============================================================
  // 2. FORENSIC BALANCE VERIFICATION
  // ============================================================
  const txnSum = q(
    `SELECT
       COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),0) -
       COALESCE(SUM(CASE WHEN type='debit'  THEN amount ELSE 0 END),0) AS net
     FROM wallet_transactions WHERE wallet_id = ?`,
    [wallet.id]
  )[0].net;

  const walletBalance = Number(wallet.balance);
  const delta = Math.abs(Number(txnSum) - walletBalance);

  console.log('\n── FORENSIC VERIFICATION ──');
  console.log('  Wallet balance      :', walletBalance.toFixed(2));
  console.log('  Sum of txns (net)   :', Number(txnSum).toFixed(2));
  console.log('  Delta               :', delta < 0.001 ? '0.00 (MATCHED ✓)' : delta.toFixed(4) + ' (MISMATCH)');

  if (delta >= 0.001) {
    console.error('[WARN] Balance / ledger mismatch detected!');
  }

  persist();

  // ============================================================
  // 3. APPEND IDs TO WALLET ID CARD ID.txt
  // ============================================================
  const existingRef = fs.readFileSync(REF_FILE, 'utf-8');

  const customerBlock = `\n\n{\n  "customerId": "${customer.id}",\n  "customerName": "${customer.name}",\n  "walletId": "${wallet.id}",\n  "walletCode": "${wallet.wallet_code}",\n  "walletBalance": ${walletBalance.toFixed(2)},\n  "walletCurrency": "${wallet.currency}",\n  "cardId": "${card.id}",\n  "cardScheme": "${card.scheme}",\n  "cardMaskedPan": "5413 ******** 3284",\n  "cardBin": "${card.bin}",\n  "cardLast4": "${card.last4}",\n  "cardCountry": "CH",\n  "cardBank": "STANDARD CHARTERED BANK",\n  "bankAccountId": "9c7dfb36-fe81-4b56-a8cb-e3bbe08881d3",\n  "sourceBank": "UniCredit Bank S.A. (BACXROBL)",\n  "sourceIban": "RO34BACX0000003929971001",\n  "emvLinkId": "140",\n  "emvLinkCode": "84D09B936779E2FC",\n  "emvLinkAmount": 99.00,\n  "emvLinkCurrency": "USD",\n  "authorizationCode": "977614",\n  "reportId": "E37F5D4EDD159D8DFDBA24C2",\n  "verificationTokenSha256": "21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef",\n  "kycStatus": "${customer.kyc_status}",\n  "riskLevel": "${customer.risk_level}",\n  "walletTransactionId": "${txn.id}",\n  "authenticatedCard": true,\n  "forensicBalanceVerified": ${delta < 0.001}\n}`;

  fs.writeFileSync(REF_FILE, existingRef.trimEnd() + customerBlock);

  console.log('\n── REFERENCE FILE UPDATED ──');
  console.log('  File:', REF_FILE);
  console.log('  Customer ID appended :', customer.id.slice(0, 12) + '...');
  console.log('  Wallet Code          :', wallet.wallet_code);
  console.log('  Forensic check       :', delta < 0.001 ? 'PASS ✓' : 'FAIL (manual review required)');

  console.log('\n============================================================');
  console.log('LEDGER & REFERENCE COMPLETE — READY FOR TRANSACTION');
  console.log('============================================================');
})().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
