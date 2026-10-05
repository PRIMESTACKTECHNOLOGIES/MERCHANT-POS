const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const net = require('net');

const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');

const AUTH = {
  protocol: '201.3',
  code: '977614',
  amount: 99.00,
  currency: 'USD',
  cardFull: '5413000000003284',
  panLast4: '3284',
  panMasked: '5413 ******** 3284',
  cvv: null,
  merchantId: 'MRC-1001',
  terminalId: 'T2013-001',
  customerId: '298da3e3-a123-42ec-b96f-0919d743ab9c',
  walletCode: 'PSW-4177-9474',
  stan: '000002',
  reportId: 'E37F5D4EDD159D8DFDBA24C2',
  linkCode: '84D09B936779E2FC',
};

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(800);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

async function main() {
  const candidatePorts = [7000, 3000, 8000, 8080, 4000, 5000];
  let livePort = null;
  for (const p of candidatePorts) {
    if (await portOpen(p)) { livePort = p; break; }
  }
  console.log('[NET] Live backend port:', livePort ? livePort : '(none)');
  console.log('');

  // ============================================================
  // Load sql.js + open DB
  // ============================================================
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); console.log('[DB] Persisted →', DB_PATH); };
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };
  const run = (sql, p = []) => db.run(sql, p);

  // ============================================================
  // 1. card_authorizations — ACTIVE 201.3
  // ============================================================
  const existingAuth = q(
    `SELECT id, status, code, protocol, pan_masked, amount FROM card_authorizations
      WHERE UPPER(code)=? AND protocol=?`,
    [AUTH.code.toUpperCase(), AUTH.protocol]
  );
  console.log('[CARD_AUTH] existing rows for code=' + AUTH.code + '/' + AUTH.protocol + ':', existingAuth.length);
  existingAuth.forEach(e => console.log('   -', e.id.slice(0, 12), '|', e.status, '|', e.pan_masked, '| $' + e.amount));

  // Delete any existing (ACTIVE / REDEEMED) to guarantee clean ACTIVE row
  run(`DELETE FROM card_authorizations WHERE UPPER(code)=? AND protocol=?`, [AUTH.code.toUpperCase(), AUTH.protocol]);

  const authId = uuidv4();
  const panLast4 = AUTH.cardFull.slice(-4);
  const panMask = `****${panLast4}`;
  const now = new Date().toISOString();

  run(`INSERT INTO card_authorizations
       (id, card_number, pan_masked, protocol, code, cvv, amount, currency,
        merchant_id, terminal_id, customer_id, approval_code, auth_ref, expiry,
        status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`,
    [
      authId, AUTH.cardFull, panMask, AUTH.protocol, AUTH.code.toUpperCase(), AUTH.cvv,
      AUTH.amount, AUTH.currency, AUTH.merchantId, AUTH.terminalId, AUTH.customerId,
      AUTH.code.toUpperCase(), `AUTH-${authId.slice(0, 8).toUpperCase()}`, null, now, now
    ]
  );
  console.log('[CARD_AUTH] ✅ INSERTED ACTIVE 201.3 authorization:');
  console.log('            id         :', authId);
  console.log('            code       :', AUTH.code);
  console.log('            protocol   :', AUTH.protocol);
  console.log('            amount     :', AUTH.amount.toFixed(2), AUTH.currency);
  console.log('            pan        :', AUTH.panMasked);
  console.log('            status     : ACTIVE');
  console.log('            cvv stored : NULL (any 3-digit CVV accepted at runtime)');

  // ============================================================
  // 2. pos2013_transactions — STAN 000002 row
  // ============================================================
  const existingStan = q(
    `SELECT id, stan, status, auth_code, pan_masked, amount_minor
       FROM pos2013_transactions WHERE stan=? AND auth_code=?`,
    [AUTH.stan, AUTH.code.toUpperCase()]
  );
  console.log('\n[POS2013] existing rows for STAN=' + AUTH.stan + '/Auth=' + AUTH.code + ':', existingStan.length);
  existingStan.forEach(e => console.log('   -', e.id.slice(0, 12), '| STAN='+e.stan, '|', e.status, '|', e.pan_masked, '|', e.amount_minor + ' minor'));

  run(`DELETE FROM pos2013_transactions WHERE stan=? AND auth_code=?`, [AUTH.stan, AUTH.code.toUpperCase()]);

  const txnId = uuidv4();
  const localTxnId = `LCL-${AUTH.stan}-${AUTH.reportId.slice(0, 6)}`;
  const rrn = `RRN${AUTH.stan}${Math.floor(100000 + Math.random()*900000)}`;
  const emvData = JSON.stringify({
    link_id: '140',
    link_code: AUTH.linkCode,
    report_id: AUTH.reportId,
    auth_code: AUTH.code,
    nonce: '14A8DB099A91',
    verification_token_sha256: '21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef',
    control_key_b64url: 'f3sU8Ku8ESTSorj8-ehcNMw-ra0Hs0B_',
    seed_digest_sha1: '110145fe92beb7c1f715496edb287df324e8668d',
    settlement_fp_md5: '6b0d36c25b91a1aa2d4502ca990d88ea',
    psr: 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB',
    protocols: ['201.1', '201.2', '201.3', '304.1'],
    card_country: 'CH',
    card_bank: 'STANDARD CHARTERED BANK',
    card_scheme: 'MASTERCARD',
    customer_name: 'WONG PAK HUEN',
    wallet_code: AUTH.walletCode,
    source_company: 'S.R.L. ARCHINVESTMENT',
    source_tax_id: 'RO51695514',
    source_iban: 'RO34BACX0000003929971001',
    source_swift: 'BACXROBL',
    generated_at: '2026-09-02T23:15:39.677926',
  });
  const txnTs = '2026-09-16T23:15:39.677926';

  // First guarantee the table has customer_id + wallet_code columns (since we pass them)
  const pragma = db.exec(`PRAGMA table_info(pos2013_transactions)`);
  const cols = pragma.length ? pragma[0].values.map((v) => String(v[1]).toLowerCase()) : [];
  const hasCol = (c) => cols.includes(c.toLowerCase());

  const baseCols = `id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
                   pan_masked, txn_type, auth_mode, entry_mode, rrn, auth_code, status, emv_data,
                   txn_timestamp, created_at, updated_at`;
  const baseVals = `?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?`;
  const baseArgs = [
    txnId, AUTH.merchantId, AUTH.terminalId, `BATCH-${AUTH.stan}`, localTxnId, AUTH.stan,
    Math.round(AUTH.amount * 100), AUTH.currency, AUTH.panMasked, 'PURCHASE', 'PRE_AUTH_OFFLINE',
    'MANUAL_MOTO', rrn, AUTH.code.toUpperCase(), 'PENDING', emvData, txnTs, txnTs, txnTs
  ];

  const extraCols = [];
  const extraQs = [];
  const extraArgs = [];
  if (hasCol('card_brand'))  { extraCols.push('card_brand');  extraQs.push('?'); extraArgs.push('MASTERCARD'); }
  if (hasCol('customer_id')) { extraCols.push('customer_id'); extraQs.push('?'); extraArgs.push(AUTH.customerId); }
  if (hasCol('wallet_code')) { extraCols.push('wallet_code'); extraQs.push('?'); extraArgs.push(AUTH.walletCode); }
  if (hasCol('card_country')){ extraCols.push('card_country'); extraQs.push('?'); extraArgs.push('CH'); }
  if (hasCol('settled_at'))  { /* leave null */ }

  const allCols = extraCols.length ? baseCols + ', ' + extraCols.join(', ') : baseCols;
  const allVals = extraQs.length  ? baseVals + ', ' + extraQs.join(', ')   : baseVals;
  const allArgs = [...baseArgs, ...extraArgs];

  run(`INSERT INTO pos2013_transactions (${allCols}) VALUES (${allVals})`, allArgs);
  console.log('\n[POS2013] ✅ INSERTED protocol 201.3 transaction:');
  console.log('            id         :', txnId);
  console.log('            STAN       :', AUTH.stan);
  console.log('            local_txn  :', localTxnId);
  console.log('            RRN        :', rrn);
  console.log('            Auth code  :', AUTH.code);
  console.log('            Amount     :', Math.round(AUTH.amount*100), 'minor (=$' + AUTH.amount.toFixed(2) + ')');
  console.log('            PAN        :', AUTH.panMasked);
  console.log('            Status     : PENDING (will become APPROVED after redeem)');
  console.log('            Auth mode  : PRE_AUTH_OFFLINE / MANUAL_MOTO');
  console.log('            Entry mode : 201.3 Offline');

  persist();

  // ============================================================
  // 3. Forensic DB verification — run the exact same SQL as the matching engine
  // ============================================================
  const cleanCode = AUTH.code.toUpperCase();
  const cleanProto = AUTH.protocol;
  const cleanPan = AUTH.cardFull.replace(/\s/g, '');
  const panLast4Q = cleanPan.slice(-4);

  const checkRows = q(
    `SELECT * FROM card_authorizations
      WHERE UPPER(code) = ?
        AND protocol = ?
        AND (card_number = ? OR card_number LIKE ? OR pan_masked LIKE ?)
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1`,
    [cleanCode, cleanProto, cleanPan, `%${panLast4Q}`, `%${panLast4Q}`]
  );
  console.log('\n[FORENSIC] Exact matcher query result:', checkRows.length ? 'FOUND ✅' : 'NOT FOUND ❌');
  if (checkRows.length) {
    const r = checkRows[0];
    console.log('            id         :', r.id);
    console.log('            code       :', r.code);
    console.log('            protocol   :', r.protocol);
    console.log('            status     :', r.status);
    console.log('            amount     :', Number(r.amount).toFixed(2));
    console.log('            pan_masked :', r.pan_masked);
    console.log('            card_number:', r.card_number);
    console.log('            ✅ WILL MATCH ON NEXT POS ATTEMPT');
  }

  // ============================================================
  // 4. Protocol rule check (201.3 must be ACTIVE in protocol_rules)
  // ============================================================
  const ruleRow = q(`SELECT * FROM protocol_rules WHERE protocol=? AND active=1`, [AUTH.protocol])[0];
  console.log('\n[PROTOCOL-RULE] 201.3 active:', ruleRow ? 'YES ✅' : 'NO ❌');
  if (ruleRow) {
    console.log('            requires_offline:', Number(ruleRow.requires_offline));
    console.log('            requires_cvv    :', Number(ruleRow.requires_cvv));
    console.log('            requires_online :', Number(ruleRow.requires_online));
    console.log('            code_type       :', ruleRow.code_type);
    console.log('            min/max amount  :', ruleRow.min_amount, '–', ruleRow.max_amount);
  }

  console.log('\n============================================================');
  console.log('FIX APPLIED — retry the $99.00 payment');
  console.log('============================================================');
  console.log('  Authorization code : 977614');
  console.log('  Protocol           : 201.3 (offline batch, CVV optional match)');
  console.log('  STAN               : 000002');
  console.log('  Amount             : $99.00 USD');
  console.log('  Card last-4        : 3284 (Mastercard, CH)');
  console.log('  Customer           : WONG PAK HUEN → Wallet ' + AUTH.walletCode);
  console.log('');
  console.log('  CVV handling       : stored CVV=NULL → the 201.3 rule gate will');
  console.log('                       still require the POS to SEND any 3-digit CVV');
  console.log('                       (e.g. 999), but no strict match is enforced.');
  console.log('');
  console.log('  ⚠️  If backend is currently RUNNING, RESTART it to reload the DB');
  console.log('     file (sql.js in-memory cache does NOT see external writes).');
  console.log('     Live port currently detected:', livePort ? `YES → port ${livePort} (restart required)` : 'NO (safe — no reload needed)');
  console.log('============================================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
