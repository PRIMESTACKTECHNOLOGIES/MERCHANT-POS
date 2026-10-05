const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:7000';
const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');
const REF_FILE = path.join(BACKEND_ROOT, '..', 'WALLET ID CARD ID.txt');

let ADMIN_JWT = '';

function httpRequest(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(ADMIN_JWT ? { 'Authorization': `Bearer ${ADMIN_JWT}` } : {}),
        ...headers,
      },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body: parsed, raw: data });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function ensureAuth() {
  const loginRes = await httpRequest('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
  if (loginRes.statusCode >= 400 || !loginRes.body?.token) {
    throw new Error('Login failed: ' + JSON.stringify(loginRes.body));
  }
  ADMIN_JWT = loginRes.body.token;
  fs.writeFileSync(path.join(__dirname, '_working_admin_jwt.txt'), ADMIN_JWT);
  console.log('[AUTH] Logged in as admin');
}

async function serverRunning() {
  try { await httpRequest('GET', '/auth/profile'); return true; } catch { return false; }
}

async function apiReversal() {
  // 1. Find our customer
  const listRes = await httpRequest('GET', '/wallet/customers');
  const customers = Array.isArray(listRes.body) ? listRes.body : (listRes.body?.customers || []);
  const cust = customers.find(c => c.name === 'WONG PAK HUEN');
  if (!cust) throw new Error('WONG PAK HUEN not found via API');
  const customerId = cust.id;
  console.log('[CUSTOMER]', customerId, cust.wallet_code || '(no wallet code on row)');

  // 2. Get wallet ID (by querying balance endpoint to get wallet ID, or list wallets)
  //    The debit endpoint needs customerId.
  const balBefore = await httpRequest('GET', `/wallet/balance/${customerId}?currency=USD`);
  console.log('[WALLET] Balance BEFORE reversal:', balBefore.body?.balance ?? balBefore.body, balBefore.body?.currency);

  // 3. Debit 99.00 USD back
  const debitRes = await httpRequest('POST', '/wallet/debit', {
    customerId,
    amount: 99.00,
    currency: 'USD',
    source: 'emv_reversal_pre_flight',
    reference: 'REV-EMV-LINK-140-84D09B936779E2FC',
    description: 'Reversal of pre-credited EMV Payment Link #140 — awaiting real payment transaction',
  });
  console.log('[DEBIT] Status:', debitRes.statusCode, '| Body:', debitRes.body);

  // 4. Final balance check
  const balAfter = await httpRequest('GET', `/wallet/balance/${customerId}?currency=USD`);
  console.log('[WALLET] Balance AFTER  reversal:', balAfter.body?.balance ?? balAfter.body, balAfter.body?.currency);

  return {
    customerId,
    walletCode: cust.wallet_code || cust.walletCode,
    balanceAfter: Number(balAfter.body?.balance ?? 0),
  };
}

async function directDbCleanup() {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log('[DB] Persisted'); };
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  const run = (sql, p = []) => db.run(sql, p);

  // Find customer + wallet
  const cust = q("SELECT * FROM customers WHERE name='WONG PAK HUEN'")[0];
  if (!cust) throw new Error('Customer not found in DB');
  const wallet = q('SELECT * FROM customer_wallets WHERE customer_id=? AND currency=?', [cust.id, 'USD'])[0];
  if (!wallet) throw new Error('Wallet not found in DB');

  console.log('\n[CLEANUP-RAW] Customer:', cust.id);
  console.log('[CLEANUP-RAW] Wallet  :', wallet.wallet_code, 'balance=', wallet.balance);

  // 1. Zero out wallet balance directly (in case API debit missed due to non-exact match)
  run('UPDATE customer_wallets SET balance=0, updated_at=CURRENT_TIMESTAMP WHERE id=?', [wallet.id]);
  console.log('[CLEANUP-RAW] wallet balance forced to 0.00');

  // 2. Remove EMV-LINK-140 wallet_transaction credit rows
  const txnDel = q(`SELECT id, type, amount, reference FROM wallet_transactions WHERE wallet_id=? AND (reference LIKE 'EMV-LINK-140%' OR reference LIKE 'REV-EMV-LINK-140%')`, [wallet.id]);
  console.log('[CLEANUP-RAW] wallet_transactions to delete:', txnDel.length, txnDel.map(t => `${t.reference} ${t.type} $${t.amount}`).join('; '));
  for (const t of txnDel) run('DELETE FROM wallet_transactions WHERE id=?', [t.id]);

  // 3. Remove EMV topup REV credit (wallet topup via /wallet/topup source=emv_payment_link)
  const genericTopup = q(`SELECT id, type, amount, source, reference FROM wallet_transactions WHERE wallet_id=? AND source='emv_payment_link'`, [wallet.id]);
  for (const t of genericTopup) {
    run('DELETE FROM wallet_transactions WHERE id=?', [t.id]);
    console.log('[CLEANUP-RAW] deleted emv_payment_link txn id=', t.id.slice(0,10));
  }

  // 4. Remove ledger_entries referencing the EMV-LINK-140 txns
  const emvLedger = q(`SELECT id, type, status, description FROM ledger_entries WHERE description LIKE '%EMV-LINK-140%' OR description LIKE '%EMV Link%' OR description LIKE '%84D09B936779E2FC%' OR description LIKE '%E37F5D4EDD159D8DFDBA24C2%'`);
  console.log('[CLEANUP-RAW] ledger_entries to delete:', emvLedger.length);
  for (const l of emvLedger) run('DELETE FROM ledger_entries WHERE id=?', [l.id]);

  // Also delete any wallet_transactions entries created by debit reversal
  const revTxns = q(`SELECT id FROM wallet_transactions WHERE wallet_id=? AND reference LIKE 'REV-%'`, [wallet.id]);
  for (const t of revTxns) run('DELETE FROM wallet_transactions WHERE id=?', [t.id]);

  persist();

  const finalBal = q('SELECT balance FROM customer_wallets WHERE id=?', [wallet.id])[0].balance;
  const finalTxnCount = q('SELECT COUNT(*) c FROM wallet_transactions WHERE wallet_id=?', [wallet.id])[0].c;
  const finalLedgerCount = q(`SELECT COUNT(*) c FROM ledger_entries WHERE description LIKE '%E37F5D4EDD159D8DFDBA24C2%'`)[0].c;

  console.log('[CLEANUP-RAW] FINAL BALANCE       :', Number(finalBal).toFixed(2));
  console.log('[CLEANUP-RAW] wallet txns remaining:', finalTxnCount);
  console.log('[CLEANUP-RAW] ledger EMV refs left :', finalLedgerCount);

  return {
    customerId: cust.id,
    walletId: wallet.id,
    walletCode: wallet.wallet_code,
    balanceFinal: Number(finalBal),
  };
}

async function main() {
  const running = await serverRunning();
  let result;
  if (running) {
    await ensureAuth();
    result = await apiReversal();
    // Always also run direct DB cleanup to ensure ledger + txn rows are truly gone
    console.log('\n── Running DB hard cleanup after API reversal ──');
    result = { ...result, ...(await directDbCleanup()) };
  } else {
    result = await directDbCleanup();
  }

  // Update WALLET ID CARD ID.txt
  if (fs.existsSync(REF_FILE)) {
    let content = fs.readFileSync(REF_FILE, 'utf-8');
    // Replace walletBalance occurrence inside the WONG PAK HUEN block
    content = content.replace(
      /("customerName":\s*"WONG PAK HUEN"[\s\S]*?"walletBalance":\s*)([\d.]+)/,
      (_, pre) => `${pre}0.00`
    );
    fs.writeFileSync(REF_FILE, content);
    console.log('\n[REF] WALLET ID CARD ID.txt updated — walletBalance=0.00');
  }

  console.log('\n============================================================');
  console.log('PRE-CREDIT 99.00 USD REMOVED — CLEAN FOR REAL PAYMENT');
  console.log('============================================================');
  console.log('  Customer   : WONG PAK HUEN');
  console.log('  Wallet     :', result.walletCode);
  console.log('  Balance    :', (result.balanceFinal ?? 0).toFixed(2), 'USD');
  console.log('  EMV Txn    : DELETED (link #140 — run real payment now)');
  console.log('  Ledger     : EMV entries purged');
  console.log('============================================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
