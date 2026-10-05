const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { v4: uuidv4 } = require('uuid');

const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');
const API_PORTS = [7000, 3000, 8000, 8080, 4000, 5000];

const AUTH = {
  protocol: '201.3',
  code: '977614',
  amount: 99.00,
  currency: 'USD',
  cardFull: '5413000000003284',
  panMasked: '5413 ******** 3284',
  panLast4: '3284',
  stan: '000002',
  customerId: '298da3e3-a123-42ec-b96f-0919d743ab9c',
  walletCode: 'PSW-4177-9474',
  merchantId: 'MRC-1001',
  terminalId: 'T2013-001',
  reportId: 'E37F5D4EDD159D8DFDBA24C2',
};

let adminJwt = '';

// --- HTTP helper (auto-detects running port later) ---
function httpRequest(port, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...(adminJwt ? { 'Authorization': `Bearer ${adminJwt}` } : {}),
        ...headers,
      },
      timeout: 6000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {}, raw: data }); }
        catch { resolve({ statusCode: res.statusCode, body: data, raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function portOpen(p) {
  return new Promise((r) => {
    const s = new net.Socket();
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); r(true); });
    s.once('timeout', () => { s.destroy(); r(false); });
    s.once('error',   () => { s.destroy(); r(false); });
    s.connect(p, '127.0.0.1');
  });
}

async function findLivePort() {
  for (const p of API_PORTS) if (await portOpen(p)) return p;
  return null;
}

async function probeDbDirect(state) {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  const hasCol = (tableName, colName) => {
    try {
      const pragma = db.exec(`PRAGMA table_info(${tableName})`);
      if (!pragma.length) return false;
      return pragma[0].values.some(v => String(v[1]).toLowerCase() === String(colName).toLowerCase());
    } catch { return false; }
  };

  state.db.wallet = q(
    'SELECT id, customer_id, balance, currency, status, wallet_code, card_id FROM customer_wallets WHERE wallet_code=? OR customer_id=? ORDER BY balance DESC LIMIT 1',
    [AUTH.walletCode, AUTH.customerId]
  )[0] || null;

  state.db.auth = q(
    `SELECT id, code, protocol, status, amount, currency, pan_masked, card_number, cvv,
            customer_id, merchant_id, captured_at, created_at
       FROM card_authorizations WHERE UPPER(code)=? AND protocol=? ORDER BY created_at DESC LIMIT 1`,
    [AUTH.code.toUpperCase(), AUTH.protocol]
  )[0] || null;

  const posAllCols = [
    'id','stan','auth_code','status','amount_minor','currency','pan_masked',
    'local_txn_id','rrn','txn_timestamp','card_brand','wallet_code','customer_id',
  ];
  const posCols = posAllCols.filter(c => hasCol('pos2013_transactions', c));
  const posSelect = posCols.join(', ');
  state.db.pos2013 = q(
    `SELECT ${posSelect}
       FROM pos2013_transactions WHERE stan=? OR auth_code=? ORDER BY txn_timestamp DESC LIMIT 3`,
    [AUTH.stan, AUTH.code.toUpperCase()]
  );

  state.db.txns = q(
    `SELECT id, type, amount, currency, source, reference, description, pan_masked, created_at
       FROM wallet_transactions
       WHERE wallet_id=? OR (pan_masked LIKE ? AND amount=? AND currency=?)
       ORDER BY created_at DESC LIMIT 5`,
    [state.db.wallet?.id || '', `%${AUTH.panLast4}`, AUTH.amount, AUTH.currency]
  );

  state.db.ledger = q(
    `SELECT id, type, status, amount, currency, description, created_at
       FROM ledger_entries
       WHERE description LIKE ? OR description LIKE ?
       ORDER BY created_at DESC LIMIT 10`,
    [`%${AUTH.code}%`, `%${AUTH.reportId}%`]
  );
}

function printState(state) {
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│              PAYMENT STATUS — FORENSIC SNAPSHOT              │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  // Auth row
  const a = state.db.auth;
  console.log('\n① card_authorizations (201.3 / 977614):');
  if (!a) {
    console.log('   ❌ NO ROW — authorization missing (403 would occur)');
  } else {
    const statusColor = a.status === 'ACTIVE' ? '⏳ PRE-AUTH ACTIVE'
                      : a.status === 'REDEEMED' || a.status === 'USED' ? '✅ REDEEMED (paid)'
                      : a.status === 'REVOKED' ? '⛔ REVOKED'
                      : a.status;
    console.log(`   status : ${statusColor}`);
    console.log(`   id     : ${a.id}`);
    console.log(`   amount : ${Number(a.amount).toFixed(2)} ${a.currency}`);
    console.log(`   pan    : ${a.pan_masked} (card_number=${a.card_number})`);
    console.log(`   cvv    : ${a.cvv ? 'set (' + a.cvv + ')' : 'NULL (any 3-digit CVV accepted at runtime)'}`);
    console.log(`   created: ${a.created_at}`);
    if (a.captured_at) console.log(`   cap'd  : ${a.captured_at}`);
  }

  // Wallet
  const w = state.db.wallet;
  console.log('\n② wallet (WONG PAK HUEN):');
  if (!w) {
    console.log('   ❌ NO WALLET ROW');
  } else {
    const bal = Number(w.balance);
    console.log(`   code   : ${w.wallet_code}  (id=${w.id})`);
    console.log(`   status : ${w.status}`);
    console.log(`   balance: ${bal.toFixed(2)} ${w.currency}   — ${
      bal >= 99.00 ? '✅ balance ≥ $99 — PAYMENT APPEARS RECEIVED'
                    : '❌ balance $0 — payment NOT credited yet'
    }`);
    console.log(`   card_id: ${w.card_id || '(none)'}`);
  }

  // POS2013 rows
  const rows = state.db.pos2013;
  console.log('\n③ pos2013_transactions (STAN 000002 / Auth 977614):');
  if (!rows.length) {
    console.log('   ❌ NO ROW — need to create / reinsert');
  } else {
    for (const t of rows) {
      const s = t.status;
      const mark = s === 'APPROVED' || s === 'SYNCED' ? '✅'
                 : s === 'PENDING' ? '⏳' : s === 'DECLINED' ? '❌' : '?';
      console.log(`   ${mark} [${t.status}]  STAN=${t.stan}  Auth=${t.auth_code}  $${(t.amount_minor/100).toFixed(2)} ${t.currency}  PAN=${t.pan_masked}`);
      console.log(`       local=${t.local_txn_id}  RRN=${t.rrn}  ts=${t.txn_timestamp}`);
    }
  }

  // Wallet_transactions
  const txns = state.db.txns;
  console.log('\n④ wallet_transactions (for this wallet / 3284 / $99):');
  if (!txns.length) {
    console.log('   (none)');
  } else {
    for (const t of txns) {
      const mark = t.type === 'credit' ? '⬆️+' : '⬇️-';
      console.log(`   ${mark} $${Number(t.amount).toFixed(2)} ${t.currency}  [${t.type}]  source=${t.source}`);
      console.log(`      ref=${t.reference}  pan=${t.pan_masked}`);
      console.log(`      desc: ${t.description?.slice(0,120) || ''}`);
    }
  }

  // Ledger
  const lg = state.db.ledger;
  console.log('\n⑤ ledger_entries (linked by description):');
  if (!lg.length) {
    console.log('   (none)');
  } else {
    for (const l of lg) {
      const mark = l.status === 'SETTLED' ? '✅' : (l.status || '');
      console.log(`   ${mark} [${l.type}/${l.status}]  $${Number(l.amount).toFixed(2)} ${l.currency}  id=${l.id.slice(0,10)}`);
    }
  }

  // Backend port
  console.log('\n⑥ Backend server:');
  console.log('   live port:', state.livePort ? `port ${state.livePort} ✅ running` : 'NOT RUNNING ❌');
  if (state.apiAuthCheck) {
    console.log('   API matcher check:', state.apiAuthCheck.success ? '✅ MATCH' : '❌ FAIL — '+ (state.apiAuthCheck.reason || state.apiAuthCheck.error || 'no details'));
  }
}

async function runApiAuthMatch(port, state) {
  try {
    const loginRes = await httpRequest(port, 'POST', '/auth/login', { username: 'admin', password: 'admin1234' });
    adminJwt = loginRes.body?.token || '';
  } catch { adminJwt = ''; }

  const body = {
    protocol: AUTH.protocol,
    cardNumber: AUTH.cardFull,
    code: AUTH.code,
    cvv: '999',
    amount: AUTH.amount,
    currency: AUTH.currency,
    merchantId: AUTH.merchantId,
    online: false,
  };
  try {
    const r = await httpRequest(port, 'POST', '/api/card-auth/match', body);
    state.apiAuthCheck = {
      success: !!(r.body?.success || r.body?.valid),
      reason: r.body?.reason || r.body?.error,
      statusCode: r.statusCode,
      raw: r.body,
    };
  } catch (e) {
    state.apiAuthCheck = { success: false, reason: e.message };
  }

  // Also try /validate
  try {
    const r2 = await httpRequest(port, 'POST', '/api/card-auth/validate', { ...body, online: undefined });
    state.apiValidateCheck = {
      success: !!(r2.body?.valid || r2.body?.success),
      reason: r2.body?.reason || r2.body?.error,
      authId: r2.body?.authorizationId,
    };
  } catch {}
}

async function main() {
  const state = {
    livePort: null,
    db: { wallet: null, auth: null, pos2013: [], txns: [], ledger: [] },
    apiAuthCheck: null,
    apiValidateCheck: null,
  };

  state.livePort = await findLivePort();
  await probeDbDirect(state);

  if (state.livePort) {
    await runApiAuthMatch(state.livePort, state);
  }

  printState(state);

  // --- Decision ---
  const a = state.db.auth;
  const w = state.db.wallet;
  const balance = w ? Number(w.balance) : 0;
  const authRedeemed = a && (a.status === 'REDEEMED' || a.status === 'USED');
  const posApproved = state.db.pos2013.some(t => t.status === 'APPROVED' || t.status === 'SYNCED');

  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                       VERDICT                                │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  if (balance >= 99.00 && authRedeemed && posApproved) {
    console.log('\n   ✅✅✅  PAYMENT RECEIVED — FULLY SETTLED');
    console.log('      No action required. All three signals line up:');
    console.log('        • Wallet balance ≥ $99.00 USD');
    console.log('        • card_authorizations status = REDEEMED');
    console.log('        • pos2013_transactions status = APPROVED/SYNCED');
    console.log('\n   Customer wallet credited. Ready for next transaction.');
    state.verdict = 'RECEIVED';
  } else if (authRedeemed || posApproved) {
    console.log('\n   ⚠️  PARTIAL — auth redeemed but wallet NOT credited (race / ledger broken)');
    console.log('      • auth status =', a?.status);
    console.log('      • pos2013 best =', state.db.pos2013[0]?.status);
    console.log('      • wallet bal  = $' + balance.toFixed(2));
    console.log('      Action required: run forensic credit-fix script to sync wallet.');
    state.verdict = 'PARTIAL';
  } else if (a && a.status === 'ACTIVE') {
    console.log('\n   ❌  PAYMENT NOT RECEIVED');
    console.log('      • Authorization 977614 exists but is still ACTIVE');
    console.log('      • Wallet $' + balance.toFixed(2));
    if (state.apiAuthCheck?.success) {
      console.log('      • Runtime matcher: ✅ passes → transaction SHOULD go through now');
      if (!state.livePort) {
        console.log('      • ⚠️  Backend NOT running — start it first, then retry $99.00 on the POS.');
      } else {
        console.log('      • Backend running on port', state.livePort, '→ retry the $99.00 payment on the POS right now.');
        console.log('      • (CVV on POS: type any 3 digits e.g. 999)');
      }
    } else {
      console.log('      • Runtime matcher: ❌ FAILS → reason:', state.apiAuthCheck?.reason || '(unable to test — backend not running)');
      console.log('      • Backend status:', state.livePort ? `running on ${state.livePort} → fix the auth row shape` : 'NOT running → start backend after DB fix');
    }
    state.verdict = 'NOT_RECEIVED_ACTIVE_AUTH_READY';
  } else {
    console.log('\n   ❌  PAYMENT NOT RECEIVED AND NO ACTIVE AUTH');
    console.log('      Action: run the fix script to create the auth, then retry.');
    state.verdict = 'NOT_RECEIVED_NO_AUTH';
  }

  return state;
}

main().then((state) => {
  // exit code reflects verdict for downstream scripts:
  // 0 = received, 1 = partial, 2 = not received (auth ready), 3 = error/no auth
  const code = state.verdict === 'RECEIVED' ? 0
             : state.verdict === 'PARTIAL'  ? 1
             : state.verdict === 'NOT_RECEIVED_ACTIVE_AUTH_READY' ? 2
             : 3;
  process.exitCode = code;
}).catch(err => { console.error('\nFATAL:', err); process.exit(99); });
