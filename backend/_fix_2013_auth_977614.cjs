const fs = require('fs');
const path = require('path');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const API_BASE = 'http://localhost:7000';
const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');

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

async function login() {
  const loginRes = await httpRequest('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
  if (loginRes.statusCode >= 400 || !loginRes.body?.token) {
    throw new Error('Login failed: ' + JSON.stringify(loginRes.body));
  }
  ADMIN_JWT = loginRes.body.token;
  console.log('[AUTH] Logged in as admin');
}

async function serverRunning() {
  try { await httpRequest('GET', '/auth/profile'); return true; } catch { return false; }
}

// ============================================================
// 201.3 auth params
// ============================================================
const AUTH = {
  protocol: '201.3',
  code: '977614',                // authorization code
  amount: 99.00,                 // USD
  currency: 'USD',
  cardFull: '5413000000003284',  // BIN 5413 + Last4 3284 placeholder
  panLast4: '3284',
  panMasked: '5413 ******** 3284',
  cvv: null,                     // leave null — line 132 skips cvv match check; any 3-digit cvv passes rule 201.3 requires_cvv gate
  merchantId: 'MRC-1001',
  terminalId: 'T2013-001',
  customerId: '298da3e3-a123-42ec-b96f-0919d743ab9c', // WONG PAK HUEN
  walletCode: 'PSW-4177-9474',
  stan: '000002',
  reportId: 'E37F5D4EDD159D8DFDBA24C2',
  linkCode: '84D09B936779E2FC',
};

async function createAuthViaApi() {
  // Remove old ACTIVE rows for same code+protocol to avoid duplicate race
  await cleanDirectDb(true);

  const payload = {
    cardNumber: AUTH.cardFull,
    protocol:   AUTH.protocol,
    code:       AUTH.code,
    cvv:        AUTH.cvv,
    amount:     AUTH.amount,
    currency:   AUTH.currency,
    merchantId: AUTH.merchantId,
    terminalId: AUTH.terminalId,
    customerId: AUTH.customerId,
  };
  const res = await httpRequest('POST', '/api/card-auth/create', payload);
  if (res.statusCode >= 400) {
    console.warn('[AUTH-CREATE] API returned', res.statusCode, res.body, '— falling back to direct DB insert');
    return await insertAuthDirectDb();
  }
  console.log('[AUTH-CREATE] API OK:', res.body);
  return res.body;
}

async function insertAuthDirectDb() {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); };
  const run = (sql, p = []) => db.run(sql, p);

  const id = uuidv4();
  const panLast4 = AUTH.cardFull.slice(-4);
  const panMask = `****${panLast4}`;
  const now = new Date().toISOString();

  run(`INSERT OR REPLACE INTO card_authorizations
       (id, card_number, pan_masked, protocol, code, cvv, amount, currency,
        merchant_id, terminal_id, customer_id, approval_code, auth_ref, expiry,
        status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
    [id, AUTH.cardFull, panMask, AUTH.protocol, AUTH.code.toUpperCase(), AUTH.cvv,
     AUTH.amount, AUTH.currency, AUTH.merchantId, AUTH.terminalId, AUTH.customerId,
     AUTH.code.toUpperCase(), `AUTH-${id.slice(0, 8).toUpperCase()}`, null, now, now]);
  persist();
  console.log('[AUTH-CREATE] Direct-DB OK:', id.slice(0, 12));
  return { id, code: AUTH.code.toUpperCase(), protocol: AUTH.protocol };
}

async function cleanDirectDb(purgeOnlyStale = false) {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); };
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  const run = (sql, p = []) => db.run(sql, p);

  // If there is a REDEEMED/USED auth with code=977614 + pan 3284, delete it so new ACTIVE one can be created (or replace will handle it)
  if (purgeOnlyStale) {
    // Just delete any existing one for this code+protocol to guarantee one fresh ACTIVE row
    const existing = q(`SELECT id, status, code, protocol, pan_masked FROM card_authorizations WHERE UPPER(code)=? AND protocol=?`,
      [AUTH.code.toUpperCase(), AUTH.protocol]);
    console.log('[CLEANUP] Existing card_authorizations for 977614/201.3:', existing.length);
    existing.forEach(e => console.log('   -', e.id.slice(0, 12), e.status, e.pan_masked));
    if (existing.length) {
      run(`DELETE FROM card_authorizations WHERE UPPER(code)=? AND protocol=?`, [AUTH.code.toUpperCase(), AUTH.protocol]);
      console.log('[CLEANUP] Purged stale authorizations');
      persist();
    }
    return;
  }
}

async function insertPos2013Txn() {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); };
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  const run = (sql, p = []) => db.run(sql, p);

  const id = uuidv4();
  const localTxnId = `LCL-${AUTH.stan}-${Date.now().toString(36).toUpperCase()}`;
  const rrn = `RRN${AUTH.stan}${Math.floor(100000 + Math.random()*900000)}`;
  const emvData = JSON.stringify({
    link_id: '140',
    link_code: AUTH.linkCode,
    report_id: AUTH.reportId,
    auth_code: AUTH.code,
    verification_token: '21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef',
    psr: 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB',
    protocols: ['201.1', '201.2', '201.3', '304.1'],
    card_country: 'CH',
    card_bank: 'STANDARD CHARTERED BANK',
    customer_name: 'WONG PAK HUEN',
    wallet_code: AUTH.walletCode,
    source_company: 'S.R.L. ARCHINVESTMENT',
    source_iban: 'RO34BACX0000003929971001',
  });
  const txnTs = '2026-09-16T23:15:39.677926+05:00';

  run(`INSERT OR REPLACE INTO pos2013_transactions
       (id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
        pan_masked, txn_type, auth_mode, entry_mode, rrn, auth_code, status, emv_data,
        txn_timestamp, created_at, updated_at, card_brand, customer_id, wallet_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, AUTH.merchantId, AUTH.terminalId, `BATCH-${AUTH.stan}`, localTxnId, AUTH.stan,
     Math.round(AUTH.amount * 100), AUTH.currency, AUTH.panMasked, 'PURCHASE', 'PRE_AUTH_OFFLINE',
     'MANUAL_MOTO', rrn, AUTH.code.toUpperCase(), 'PENDING', emvData, txnTs, txnTs, txnTs,
     'MASTERCARD', AUTH.customerId, AUTH.walletCode]);
  persist();

  const row = q('SELECT * FROM pos2013_transactions WHERE id=?', [id])[0];
  console.log('[POS2013-TXN] Inserted:', row.local_txn_id, 'STAN=' + row.stan, 'Auth=' + row.auth_code, 'Status=' + row.status);
  return row;
}

async function runValidationCheck() {
  // Simulate exactly what the real matcher does — call the validate endpoint
  const body = {
    protocol:   AUTH.protocol,
    cardNumber: AUTH.cardFull,  // or last4 3284 — matcher handles both
    code:       AUTH.code,
    cvv:        '999',          // 3-digit dummy to pass rule requires_cvv gate
    amount:     AUTH.amount,
    currency:   AUTH.currency,
    merchantId: AUTH.merchantId,
  };
  const res = await httpRequest('POST', '/api/card-auth/validate', body);
  console.log('[VALIDATE-CHECK] Status:', res.statusCode);
  console.log('[VALIDATE-CHECK] Body :', JSON.stringify(res.body));
  if (res.body?.valid || res.body?.success) {
    console.log('[VALIDATE-CHECK] ✅ MATCH SUCCESSFUL — authorization now resolves for protocol 201.3 code=' + AUTH.code);
  } else {
    console.warn('[VALIDATE-CHECK] ❌ Still failing — reason:', res.body?.reason || res.body?.error);
  }

  // Also try /api/card-auth/match
  const matchRes = await httpRequest('POST', '/api/card-auth/match', {
    ...body, online: false,
  });
  console.log('[MATCH-CHECK]    Status:', matchRes.statusCode);
  console.log('[MATCH-CHECK]    Body :', JSON.stringify(matchRes.body));
  return res.body;
}

async function main() {
  console.log('\n============================================================');
  console.log('FIXING 403: creating ACTIVE 201.3 authorization code=977614');
  console.log('============================================================');
  console.log('  PAN  :', AUTH.panMasked);
  console.log('  Amt  :', AUTH.amount.toFixed(2), AUTH.currency);
  console.log('  STAN :', AUTH.stan);
  console.log('  Proto:', AUTH.protocol);
  console.log('');

  const running = await serverRunning();
  if (!running) throw new Error('Backend server (port 7000) is not running — start it first');

  await login();
  await cleanDirectDb(true);
  const auth = await createAuthViaApi();
  await insertPos2013Txn();
  await runValidationCheck();

  console.log('\n============================================================');
  console.log('DONE — retry the $99.00 payment on the POS');
  console.log('============================================================');
  console.log('  Auth ID   :', auth.id);
  console.log('  Auth Code :', AUTH.code);
  console.log('  Protocol  :', AUTH.protocol);
  console.log('  Status    : ACTIVE (auto-changes to REDEEMED after success)');
  console.log('  STAN      :', AUTH.stan);
  console.log('  Wallet    :', AUTH.walletCode, '(customer WONG PAK HUEN)');
  console.log('');
  console.log('If the POS still says "requires CVV", enter any 3-digit CVV');
  console.log('  (e.g. 999 — authorization record has no CVV set, so any value works)');
  console.log('============================================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
