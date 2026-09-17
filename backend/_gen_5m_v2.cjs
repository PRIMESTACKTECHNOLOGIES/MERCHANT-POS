const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const TOTAL_TXN = 5_000_000;
const ROWS_PER_INSERT = 1000;
const TOTAL_INSERTS = Math.ceil(TOTAL_TXN / ROWS_PER_INSERT);

const MERCHANTS = [
  { id: 'MRC-1001', terminals: ['T2013-001', 'T2013-002'] },
  { id: 'MRC-1002', terminals: ['T2013-003', 'T2013-004'] },
  { id: 'MRC-1003', terminals: ['T2013-005'] },
];
const MERCHANT_WEIGHTS = [0.70, 0.22, 0.08];

const CARD_BRANDS = ['VISA','MASTERCARD','AMEX','DISCOVER','UNIONPAY'];
const CARD_WEIGHTS = [0.50,0.30,0.10,0.07,0.03];
const CARD_BRAND_I = buildIndex(CARD_WEIGHTS);

const ENTRY_MODES = ['CHIP_INSERT','NFC_CONTACTLESS','MANUAL','MAGSTRIPE'];
const ENTRY_WEIGHTS = [0.45,0.35,0.15,0.05];
const ENTRY_I = buildIndex(ENTRY_WEIGHTS);

const AUTH_MODES = ['OFFLINE_AUTH','ONLINE_AUTH','STANDIN'];
const AUTH_WEIGHTS = [0.60,0.35,0.05];
const AUTH_I = buildIndex(AUTH_WEIGHTS);

const STATUSES = ['SETTLED','SYNCED','APPROVED','AUTHORIZED'];
const STATUS_WEIGHTS = [0.70,0.20,0.08,0.02];
const STATUS_I = buildIndex(STATUS_WEIGHTS);

const CURRENCIES = ['USD','EUR','GBP','AED'];
const CURRENCY_WEIGHTS = [0.80,0.10,0.05,0.05];
const CURRENCY_I = buildIndex(CURRENCY_WEIGHTS);

const CVM_RESULTS = ['SIGNATURE','PIN','NO_CVM','PIN_SIGNATURE'];
const CVM_WEIGHTS = [0.40,0.35,0.20,0.05];
const CVM_I = buildIndex(CVM_WEIGHTS);

const TXN_TYPES = ['SALE','REFUND','PREAUTH','CAPTURE'];
const TXN_TYPE_WEIGHTS = [0.92,0.05,0.02,0.01];
const TXN_TYPE_I = buildIndex(TXN_TYPE_WEIGHTS);

const READER_SOURCES = ['ACR122U','BUILTIN_NFC','USB_PINPAD','MOTO_VT'];
const READER_WEIGHTS = [0.40,0.30,0.20,0.10];
const READER_I = buildIndex(READER_WEIGHTS);

const MERCHANT_NAMES = {
  'MRC-1001':'PRIMESTACK TECHNOLOGIES LLC',
  'MRC-1002':'QVS ONE MEMBER COMPANY LIMITED',
  'MRC-1003':'GLOBAL RETAIL HUB PTE LTD',
};
const MERCHANT_ADDRS = {
  'MRC-1001':'Wilmington, DE, USA',
  'MRC-1002':'Tu Son, Bac Ninh, Vietnam',
  'MRC-1003':'Marina Bay, Singapore',
};
const MERCHANT_PHONES = {
  'MRC-1001':'+1 (302) 555-0142',
  'MRC-1002':'+84 901 561 203',
  'MRC-1003':'+65 6225 1234',
};

const CARDHOLDER_FIRST = ['John','Mary','James','Patricia','Robert','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Nancy','Daniel','Lisa','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Nguyen','Tran','Le','Pham','Ahmed','Mohammed','Li','Wang','Zhang','Omar','Hassan','Karim','Sofia','Maria','Anna','Elena','Ivan','Alex','Dmitri','Olga'];
const CARDHOLDER_LAST = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Nguyen','Wang','Li','Zhang','Khan','Ahmed','Ali','Hassan','Ivanov','Petrov','Sokolov','Popov','Dubois','Muller','Schmidt','Weber','Fischer'];

function buildIndex(weights) {
  const N = 10000;
  const arr = new Array(N);
  let acc = 0, j = 0;
  for (let i = 0; i < weights.length; i++) {
    const end = acc + Math.round(weights[i] * N);
    const lim = i === weights.length - 1 ? N : end;
    while (j < lim) arr[j++] = i;
    acc = end;
  }
  while (j < N) arr[j++] = weights.length - 1;
  return arr;
}

function randi(maxExcl) { return Math.floor(Math.random() * maxExcl); }
function randiRange(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function pad4(n) { return n < 10 ? '000' + n : n < 100 ? '00' + n : n < 1000 ? '0' + n : '' + n; }
function pad6(n) { const s = '' + n; return s.length >= 6 ? s.slice(-6) : '0'.repeat(6 - s.length) + s; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function uuid4() {
  const hx = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { out += '-'; continue; }
    if (i === 14) { out += '4'; continue; }
    if (i === 19) { out += hx[8 + (randi(4))]; continue; }
    out += hx[randi(16)];
  }
  return out;
}
function uuid16() {
  const hx = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 16; i++) out += hx[randi(16)];
  return out;
}
function hex(n) {
  const hx = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < n; i++) out += hx[randi(16)];
  return out;
}

function luhnValid(digits) {
  let s = 0, a = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (a) { n *= 2; if (n > 9) n -= 9; }
    s += n; a = !a;
  }
  return s % 10 === 0;
}
function genPan(brandIdx) {
  const brand = CARD_BRANDS[brandIdx];
  let pref, len;
  if (brand === 'VISA') { pref = ['4']; len = 16; }
  else if (brand === 'MASTERCARD') { pref = ['51','52','53','54','55','22','23','24','25','26','27']; len = 16; }
  else if (brand === 'AMEX') { pref = ['34','37']; len = 15; }
  else if (brand === 'DISCOVER') { pref = ['6011','65','644','645','646','647','648','649']; len = 16; }
  else { pref = ['62','81']; len = 16; }
  const p = pref[randi(pref.length)];
  let d = p;
  while (d.length < len - 1) d += String.fromCharCode(48 + randi(10));
  for (let c = 0; c <= 9; c++) { if (luhnValid(d + c)) { d += c; break; } }
  if (d.length < len) d += '0';
  return d;
}
function maskPan(pan, brandIdx) {
  if (CARD_BRANDS[brandIdx] === 'AMEX') return pan.slice(0,4) + '-******-' + pan.slice(10);
  return pan.slice(0,4) + '-****-****-' + pan.slice(-4);
}
function genAmountMinor() {
  const mu = 3.8, sig = 0.9;
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  let a = Math.exp(mu + sig * z);
  a = Math.max(1, Math.min(999999, Math.round(a)));
  return (a * 100) | 0;
}
function genDate() {
  const s = new Date('2024-08-20T00:00:00Z').getTime();
  const e = new Date('2026-08-20T23:59:59Z').getTime();
  const t = s + Math.random() * (e - s);
  const d = new Date(t);
  return d.toISOString();
}
function fmtDateShort(iso) {
  const y = iso.slice(0,4), m = iso.slice(5,7), da = iso.slice(8,10);
  const hh = iso.slice(11,13), mm = iso.slice(14,16), ss = iso.slice(17,19);
  return `${m}/${da}/${y}, ${hh}:${mm}:${ss}`;
}
function fmtAmt(amountMinor, cur) {
  const v = (amountMinor / 100);
  const intPart = Math.floor(v);
  const decPart = Math.round((v - intPart) * 100);
  const intStr = intPart.toLocaleString('en-US');
  const decStr = decPart < 10 ? '0' + decPart : '' + decPart;
  return `${cur} ${intStr}.${decStr}`;
}

function pickMerchant() {
  const r = randi(10000);
  let idx = MERCHANT_WEIGHTS.length - 1;
  let acc = 0;
  for (let i = 0; i < MERCHANT_WEIGHTS.length; i++) {
    acc += Math.round(MERCHANT_WEIGHTS[i] * 10000);
    if (r < acc) { idx = i; break; }
  }
  const m = MERCHANTS[idx];
  const tidx = randi(m.terminals.length);
  return { merchant_id: m.id, terminal_id: m.terminals[tidx], m_idx: idx };
}

let _bc = 0;
function batchId(merchant_id, terminal_id, iso) {
  _bc = (_bc + 1) | 0;
  return 'BATCH-' + merchant_id + '-' + terminal_id + '-' + iso.slice(0,4) + iso.slice(5,7) + iso.slice(8,10) + '-' + pad6(_bc);
}

function jsonEscape(str) {
  if (!str) return '';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 0x20) out += '\\u' + pad4(c);
    else out += str[i];
  }
  return out;
}

function buildReceiptJsonStr(tx) {
  const mName = MERCHANT_NAMES[tx.merchant_id];
  const mAddr = MERCHANT_ADDRS[tx.merchant_id];
  const mPhone = MERCHANT_PHONES[tx.merchant_id];
  const amtS = fmtAmt(tx.amount_minor, tx.currency);
  const dtS = fmtDateShort(tx.txn_timestamp);
  const idShort = tx.id.slice(0, 8).toUpperCase();
  const custName = tx.customer_name || 'NOT PROVIDED';

  const custC =
`${mName.toUpperCase()}
${mAddr}
TEL: ${mPhone}
════════════════════════════════════════
*** CUSTOMER COPY ***
RECEIPT NO:     RCP-${idShort}
DATE/TIME:      ${dtS}
────────────────────────────────────────
CARDHOLDER DETAILS
NAME:           ${custName}
────────────────────────────────────────
CARD DETAILS
CARD BRAND:     ${tx.card_brand}
CARD NO:        ${tx.pan_masked}
EXPIRY:         ${tx.expiry}
ENTRY MODE:     ${tx.entry_mode}
PIN VERIFIED:   ${tx.pin_verified ? 'YES' : 'NO'}
CVM:            ${tx.cvm_result}
────────────────────────────────────────
TOTAL TRANSACTION AMOUNT
${amtS}
────────────────────────────────────────
TRANSACTION DETAILS
TXN TYPE:       ${tx.txn_type}
AUTH MODE:      ${tx.auth_mode}
PROTOCOL:       VER 101.1 PATH B
STAN:           ${tx.stan}
RRN:            ${tx.rrn}
AUTH CODE:      ${tx.auth_code}
TERMINAL:       ${tx.terminal_id}
MERCHANT ID:    ${tx.merchant_id}
────────────────────────────────────────
BATCH & SETTLEMENT
BATCH ID:       ${tx.batch_id}
BATCH STATUS:   RECEIVED
────────────────────────────────────────
✓✓✓  APPROVED / AUTHORIZED  ✓✓✓
════════════════════════════════════════
CARDHOLDER SIGNATURE:

  ______________________________________

Thank you for your business!
KEEP THIS RECEIPT FOR YOUR RECORDS
*** END OF RECEIPT ***
`;
  const merchC = custC.replace('CUSTOMER COPY', 'MERCHANT COPY');
  const combined = custC + '\n\n--- MERCHANT COPY SEPARATOR ---\n\n' + merchC;

  const emvStr = `{"customer_name":"${jsonEscape(custName)}","card_program":"${tx.card_program}","cvv_provided":${tx.cvvProvided},"expiry_mm":"${tx.exp_mm}","expiry_yy":"${tx.exp_yy}","pan":"${tx.pan_masked}","pi_id":"${tx.pi_id}"}`;

  const ft =
`"id":"${tx.id}",` +
`"local_txn_id":"${tx.local_txn_id}",` +
`"merchant_id":"${tx.merchant_id}",` +
`"terminal_id":"${tx.terminal_id}",` +
`"batch_id":"${tx.batch_id}",` +
`"stan":"${tx.stan}",` +
`"amount_minor":${tx.amount_minor},` +
`"currency":"${tx.currency}",` +
`"pan_masked":"${tx.pan_masked}",` +
`"card_brand":"${tx.card_brand}",` +
`"txn_type":"${tx.txn_type}",` +
`"auth_mode":"${tx.auth_mode}",` +
`"entry_mode":"${tx.entry_mode}",` +
`"reader_source":"${tx.reader_source}",` +
`"cvm_result":"${tx.cvm_result}",` +
`"pin_verified":${tx.pin_verified},` +
`"rrn":"${tx.rrn}",` +
`"auth_code":"${tx.auth_code}",` +
`"status":"${tx.status}",` +
`"txn_timestamp":"${tx.txn_timestamp}",` +
`"protocol_version":"101.1",` +
`"merchant_name":"${jsonEscape(mName)}",` +
`"merchant_address":"${jsonEscape(mAddr)}",` +
`"merchant_phone":"${mPhone}",` +
`"receipt_footer":"Thank you for your business!",` +
`"customer_name":"${jsonEscape(custName)}",` +
`"expiry_mm_yy":"${tx.expiry}",` +
`"cvv_provided":${tx.cvvProvided},` +
`"terminal_floor_limit_permanent":5000,` +
`"emv_data":${emvStr}`;

  return (
`{"receiptId":"RCP-${tx.id}",` +
`"thermalCombined":"${jsonEscape(combined)}",` +
`"thermalCustomer":"${jsonEscape(custC)}",` +
`"thermalMerchant":"${jsonEscape(merchC)}",` +
`"browserCombined":"${jsonEscape(combined)}",` +
`"browserCustomer":"${jsonEscape(custC)}",` +
`"browserMerchant":"${jsonEscape(merchC)}",` +
`"plainCustomer":"${jsonEscape(custC)}",` +
`"plainMerchant":"${jsonEscape(merchC)}",` +
`"fullTx":{${ft}}}`
  );
}

function sqliteEscape(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "''");
}

function ensureSchema(db, done) {
  const steps = [];
  steps.push(`CREATE TABLE IF NOT EXISTS pos2013_transactions (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
    batch_id TEXT NOT NULL, local_txn_id TEXT NOT NULL DEFAULT '', stan TEXT,
    amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, pan_masked TEXT,
    txn_type TEXT, auth_mode TEXT, entry_mode TEXT, card_brand TEXT,
    reader_source TEXT, cvm_result TEXT, pin_verified INTEGER DEFAULT 0,
    rrn TEXT, auth_code TEXT, status TEXT, emv_data TEXT,
    txn_timestamp TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, settled_at TEXT,
    processor_reference TEXT, auth_code_ref2 TEXT, webhook_trace TEXT
  ) WITHOUT ROWID`);
  steps.push(`CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY, receipt_id TEXT UNIQUE NOT NULL,
    transaction_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
    receipt_data TEXT NOT NULL, generated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ) WITHOUT ROWID`);
  steps.push(`CREATE TABLE IF NOT EXISTS pos2013_batches (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL, protocol_version TEXT DEFAULT '201.3',
    status TEXT NOT NULL DEFAULT 'RECEIVED', settlement_code TEXT,
    txn_count INTEGER DEFAULT 0, total_amount_minor INTEGER DEFAULT 0,
    signature TEXT, nonce TEXT, batch_file TEXT, batch_seq INTEGER,
    upload_timestamp TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ) WITHOUT ROWID`);
  steps.push(`CREATE TABLE IF NOT EXISTS terminals (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, terminal_id TEXT UNIQUE NOT NULL,
    name TEXT, terminal_secret TEXT, offline_enabled INTEGER DEFAULT 0,
    floor_limit REAL DEFAULT 0, last_batch_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ) WITHOUT ROWID`);
  steps.push(`CREATE TABLE IF NOT EXISTS merchant_settings (
    merchant_id TEXT PRIMARY KEY, api_key TEXT, webhook_url TEXT,
    test_mode INTEGER DEFAULT 0, merchant_name TEXT, support_email TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, features TEXT,
    extended_settings TEXT, terminal_id TEXT
  ) WITHOUT ROWID`);
  steps.push(`CREATE TABLE IF NOT EXISTS merchant_business_info (
    merchant_id TEXT PRIMARY KEY, business_name TEXT, business_address TEXT,
    business_phone TEXT, receipt_header TEXT,
    receipt_footer TEXT DEFAULT 'Thank you for your business!',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ) WITHOUT ROWID`);

  let i = 0;
  const next = () => {
    if (i >= steps.length) { seedData(db, done); return; }
    db.run(steps[i++], (e) => { if (e) console.warn('schema warn:', e.message); next(); });
  };
  next();
}

function seedData(db, done) {
  const termIns = db.prepare(`INSERT OR IGNORE INTO terminals (id,merchant_id,terminal_id,name,terminal_secret,offline_enabled,floor_limit) VALUES (?,?,?,?,?,?,?)`);
  const setIns = db.prepare(`INSERT OR IGNORE INTO merchant_settings (merchant_id,api_key,webhook_url,test_mode,merchant_name,support_email) VALUES (?,?,?,?,?,?)`);
  const bizIns = db.prepare(`INSERT OR IGNORE INTO merchant_business_info (merchant_id,business_name,business_address,business_phone,receipt_footer) VALUES (?,?,?,?,?)`);

  db.run('BEGIN');
  for (const m of MERCHANTS) {
    for (const t of m.terminals) {
      termIns.run(uuid4(), m.id, t, `Terminal ${t}`, 'secret_' + t.replace(/[^0-9]/g,'').slice(-3) || '001', 1, 5000);
    }
    setIns.run(m.id, `offline_secret_${m.id.split('-')[1] || '001'}`, '', 0, MERCHANT_NAMES[m.id], `support@${m.id.toLowerCase()}.com`);
    bizIns.run(m.id, MERCHANT_NAMES[m.id], MERCHANT_ADDRS[m.id], MERCHANT_PHONES[m.id], 'Thank you for your business!');
  }
  db.run('COMMIT', done);
}

async function run() {
  console.log('=== 5M TRANSACTION GENERATOR V2 (optimized multi-row) ===');
  console.log('Target DB:', DB_PATH);
  console.log('Exists:', fs.existsSync(DB_PATH));
  console.log('Total TXN:', TOTAL_TXN.toLocaleString());
  console.log('Rows per INSERT:', ROWS_PER_INSERT);
  console.log('INSERT batches:', TOTAL_INSERTS);

  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  const db = new sqlite3.Database(DB_PATH);

  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA synchronous = OFF;');
    db.run('PRAGMA temp_store = MEMORY;');
    db.run('PRAGMA cache_size = -3000000;');
    db.run('PRAGMA mmap_size = 3221225472;');
    db.run('PRAGMA page_size = 4096;');
    db.run('PRAGMA auto_vacuum = NONE;');
    db.run('PRAGMA foreign_keys = OFF;');
    db.run('PRAGMA secure_delete = OFF;');
  });
  console.log('[OK] SQLite pragmas: WAL / sync=OFF / cache=3GB / mmap=3GB / secure_delete=OFF');

  const batchSeen = new Set();
  let processed = 0;
  const startTime = Date.now();
  let lastReport = startTime;
  let txnQmarks = '', rcptQmarks = '';
  {
    const tq = [], rq = [];
    for (let i = 0; i < ROWS_PER_INSERT; i++) {
      tq.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      rq.push('(?,?,?,?,?,?)');
    }
    txnQmarks = tq.join(',');
    rcptQmarks = rq.join(',');
  }
  const TXN_INSERT_SQL = `INSERT INTO pos2013_transactions
    (id,merchant_id,terminal_id,batch_id,local_txn_id,stan,amount_minor,currency,
     pan_masked,txn_type,auth_mode,entry_mode,card_brand,reader_source,cvm_result,
     pin_verified,rrn,auth_code,status,txn_timestamp,created_at,updated_at,emv_data)
    VALUES ${txnQmarks}`;
  const RCPT_INSERT_SQL = `INSERT INTO receipts
    (id,receipt_id,transaction_id,merchant_id,receipt_data,generated_at)
    VALUES ${rcptQmarks}`;
  const BATCH_INSERT_SQL = `INSERT OR IGNORE INTO pos2013_batches
    (id,batch_id,merchant_id,terminal_id,protocol_version,status,txn_count,
     total_amount_minor,signature,nonce,upload_timestamp,created_at,updated_at,batch_seq)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const insertBatchStmt = db.prepare(BATCH_INSERT_SQL);

  const schemaReady = new Promise(res => ensureSchema(db, res));
  await schemaReady;
  console.log('[OK] Schema + merchants/terminals seeded');

  const txnParamsArr = new Array(ROWS_PER_INSERT * 23);
  const rcptParamsArr = new Array(ROWS_PER_INSERT * 6);

  for (let big = 0; big < TOTAL_INSERTS; big++) {
    const thisN = Math.min(ROWS_PER_INSERT, TOTAL_TXN - processed);

    let tp = 0, rp = 0;

    for (let r = 0; r < ROWS_PER_INSERT; r++) {
      let id, merchant_id, terminal_id, m_idx, batch_id, local_txn_id, stan;
      let amount_minor, currency, card_brand_i, card_brand, pan, pan_masked;
      let txn_type, auth_mode, entry_mode, reader_source, cvm_result, pin_verified;
      let rrn, auth_code, status, txn_timestamp;
      let exp_mm, exp_yy, expiry, custFirst, custLast, customer_name;
      let pi_id, card_program, cvvProvided;

      if (r < thisN) {
        id = uuid4();
        const m = pickMerchant(); merchant_id = m.merchant_id; terminal_id = m.terminal_id; m_idx = m.m_idx;
        txn_timestamp = genDate();
        batch_id = batchId(merchant_id, terminal_id, txn_timestamp);
        local_txn_id = 'TXN-' + uuid16();
        stan = pad6(randiRange(1, 999999));
        amount_minor = genAmountMinor();
        currency = CURRENCIES[CURRENCY_I[randi(10000)]];
        card_brand_i = CARD_BRAND_I[randi(10000)];
        card_brand = CARD_BRANDS[card_brand_i];
        pan = genPan(card_brand_i);
        pan_masked = maskPan(pan, card_brand_i);
        txn_type = TXN_TYPES[TXN_TYPE_I[randi(10000)]];
        auth_mode = AUTH_MODES[AUTH_I[randi(10000)]];
        entry_mode = ENTRY_MODES[ENTRY_I[randi(10000)]];
        reader_source = READER_SOURCES[READER_I[randi(10000)]];
        cvm_result = CVM_RESULTS[CVM_I[randi(10000)]];
        pin_verified = (cvm_result === 'PIN' || cvm_result === 'PIN_SIGNATURE') ? 1 : 0;
        rrn = pad6(randiRange(1, 999999)) + pad6(randiRange(1, 999999));
        auth_code = pad4(randiRange(1, 9999));
        status = STATUSES[STATUS_I[randi(10000)]];
        exp_mm = pad2(randiRange(1, 12));
        exp_yy = '' + randiRange(25, 32);
        expiry = exp_mm + '/' + exp_yy;
        custFirst = CARDHOLDER_FIRST[randi(CARDHOLDER_FIRST.length)];
        custLast = CARDHOLDER_LAST[randi(CARDHOLDER_LAST.length)];
        customer_name = custFirst + ' ' + custLast;
        pi_id = hex(12).toUpperCase();
        card_program = card_brand === 'AMEX' ? 'CHARGE' : (Math.random() < 0.15 ? 'GOLD' : (Math.random() < 0.3 ? 'PLATINUM' : 'STANDARD'));
        cvvProvided = entry_mode === 'MANUAL' ? 1 : 0;
      } else {
        id = ''; merchant_id = ''; terminal_id = ''; batch_id = ''; local_txn_id = ''; stan = '';
        amount_minor = 0; currency = ''; pan_masked = ''; txn_type = ''; auth_mode = ''; entry_mode = '';
        card_brand = ''; reader_source = ''; cvm_result = ''; pin_verified = 0; rrn = ''; auth_code = '';
        status = ''; txn_timestamp = ''; customer_name = ''; exp_mm = ''; exp_yy = ''; expiry = '';
        pi_id = ''; card_program = ''; cvvProvided = 0; pan = ''; card_brand_i = 0; m_idx = 0;
      }

      const emvStr = (r < thisN)
        ? '{"customer_name":"' + jsonEscape(customer_name) + '","card_program":"' + card_program + '","cvv_provided":' + cvvProvided + ',"expiry_mm":"' + exp_mm + '","expiry_yy":"' + exp_yy + '","pan":"' + pan_masked + '","pi_id":"' + pi_id + '"}'
        : '{}';

      txnParamsArr[tp++] = id;
      txnParamsArr[tp++] = merchant_id;
      txnParamsArr[tp++] = terminal_id;
      txnParamsArr[tp++] = batch_id;
      txnParamsArr[tp++] = local_txn_id;
      txnParamsArr[tp++] = stan;
      txnParamsArr[tp++] = amount_minor;
      txnParamsArr[tp++] = currency;
      txnParamsArr[tp++] = pan_masked;
      txnParamsArr[tp++] = txn_type;
      txnParamsArr[tp++] = auth_mode;
      txnParamsArr[tp++] = entry_mode;
      txnParamsArr[tp++] = card_brand;
      txnParamsArr[tp++] = reader_source;
      txnParamsArr[tp++] = cvm_result;
      txnParamsArr[tp++] = pin_verified;
      txnParamsArr[tp++] = rrn;
      txnParamsArr[tp++] = auth_code;
      txnParamsArr[tp++] = status;
      txnParamsArr[tp++] = txn_timestamp;
      txnParamsArr[tp++] = txn_timestamp;
      txnParamsArr[tp++] = txn_timestamp;
      txnParamsArr[tp++] = emvStr;

      let rcptId = '', rcptJson = '';
      if (r < thisN) {
        rcptId = uuid4();
        const receipt = buildReceiptJsonStr({
          id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
          pan_masked, card_brand, txn_type, auth_mode, entry_mode, reader_source, cvm_result,
          pin_verified, rrn, auth_code, status, txn_timestamp, customer_name, expiry,
          exp_mm, exp_yy, pi_id, card_program, cvvProvided
        });
        rcptJson = receipt;
        processed++;
      }
      rcptParamsArr[rp++] = rcptId;
      rcptParamsArr[rp++] = r < thisN ? ('RCP-' + id) : '';
      rcptParamsArr[rp++] = id;
      rcptParamsArr[rp++] = merchant_id;
      rcptParamsArr[rp++] = rcptJson;
      rcptParamsArr[rp++] = txn_timestamp;

      if (r < thisN && !batchSeen.has(batch_id)) {
        batchSeen.add(batch_id);
        const bId = uuid4();
        const nonce = hex(24);
        const sigMsg = batch_id + '|' + merchant_id + '|' + terminal_id + '|' + nonce + '|201.3';
        const signature = crypto.createHmac('sha256', 'offline_secret_001').update(sigMsg).digest('hex');
        insertBatchStmt.run(
          bId, batch_id, merchant_id, terminal_id, '201.3', 'SETTLED',
          randiRange(200, 1500), randiRange(1_000_000, 50_000_000),
          signature, nonce, txn_timestamp, txn_timestamp, txn_timestamp, randiRange(1, 9999)
        );
      }
    }

    db.run('BEGIN TRANSACTION');
    db.run(TXN_INSERT_SQL, txnParamsArr);
    db.run(RCPT_INSERT_SQL, rcptParamsArr);
    db.run('COMMIT');

    const now = Date.now();
    if (now - lastReport > 5000 || processed >= TOTAL_TXN) {
      const elapsed = (now - startTime) / 1000;
      const rate = processed / elapsed;
      const remain = TOTAL_TXN - processed;
      const etaSec = rate > 0 ? remain / rate : 0;
      const pct = (processed / TOTAL_TXN * 100).toFixed(2);
      let dbMb = '?';
      try { dbMb = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1); } catch(_) {}
      console.log(`[${pct}%] ${processed.toLocaleString()}/${TOTAL_TXN.toLocaleString()} | ${rate.toFixed(0)} tx/s | ETA: ${etaSec.toFixed(0)}s | DB: ${dbMb} MB | batches: ${batchSeen.size}`);
      lastReport = now;
    }
  }

  console.log('\n[DONE] All 5M rows inserted. Creating indices...');

  const idxStart = Date.now();
  const indices = [
    'CREATE INDEX IF NOT EXISTS idx_tx_merchant ON pos2013_transactions(merchant_id)',
    'CREATE INDEX IF NOT EXISTS idx_tx_terminal ON pos2013_transactions(terminal_id)',
    'CREATE INDEX IF NOT EXISTS idx_tx_batch ON pos2013_transactions(batch_id)',
    'CREATE INDEX IF NOT EXISTS idx_tx_status ON pos2013_transactions(status)',
    'CREATE INDEX IF NOT EXISTS idx_tx_time ON pos2013_transactions(txn_timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_tx_auth ON pos2013_transactions(auth_code)',
    'CREATE INDEX IF NOT EXISTS idx_tx_brand ON pos2013_transactions(card_brand)',
    'CREATE INDEX IF NOT EXISTS idx_rx_txid ON receipts(transaction_id)',
    'CREATE INDEX IF NOT EXISTS idx_rx_merchant ON receipts(merchant_id)',
    'CREATE INDEX IF NOT EXISTS idx_rx_rcptid ON receipts(receipt_id)',
    'CREATE INDEX IF NOT EXISTS idx_b_batchid ON pos2013_batches(batch_id)',
    'CREATE INDEX IF NOT EXISTS idx_b_merchant ON pos2013_batches(merchant_id)',
    'CREATE INDEX IF NOT EXISTS idx_b_status ON pos2013_batches(status)',
  ];
  let iIdx = 0;
  const idxNext = () => {
    if (iIdx >= indices.length) { finalize(); return; }
    const s = indices[iIdx++];
    console.log(`  index [${iIdx}/${indices.length}]:`, s.split(' ').slice(0, 5).join(' '));
    db.run(s, idxNext);
  };
  idxNext();

  function finalize() {
    console.log(`[OK] All indices built in ${((Date.now() - idxStart) / 1000).toFixed(1)}s`);
    console.log('[...] Running ANALYZE for query planner stats...');
    db.run('ANALYZE', () => {
      console.log('[OK] ANALYZE complete');
      console.log('[...] Resetting journal mode...');
      db.run('PRAGMA journal_mode = DELETE;', () => {
        db.close(() => {
          const elapsedMin = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
          let dbGb = '?';
          try { dbGb = (fs.statSync(DB_PATH).size / 1024 / 1024 / 1024).toFixed(2); } catch(_) {}
          console.log('\n================ FINISHED ================');
          console.log(`Total time : ${elapsedMin} minutes`);
          console.log(`Final DB   : ${DB_PATH}`);
          console.log(`DB size    : ${dbGb} GB`);
          console.log(`TXN rows   : ${TOTAL_TXN.toLocaleString()}`);
          console.log(`RCPT rows  : ${TOTAL_TXN.toLocaleString()}`);
          console.log(`Batch rows : ${batchSeen.size.toLocaleString()}`);
          console.log(`Merchants  : ${MERCHANTS.length} (${MERCHANTS.map(m => m.id).join(', ')})`);
          console.log('===========================================');
          process.exit(0);
        });
      });
    });
  }
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
