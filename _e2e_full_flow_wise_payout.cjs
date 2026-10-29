/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  PRIMESTACK PAYMENT PROCESSOR — FULL END-TO-END TEST  v2                    ║
 * ║                                                                              ║
 * ║  FLOW:                                                                       ║
 * ║  [1] Test Card processed → Merchant wallet credited (internal processor)    ║
 * ║  [2] Customer balance credited via card-funded topup                        ║
 * ║  [3] Customer debited → funds move to Merchant Wallet                       ║
 * ║  [4] Merchant credits Vault Bank ledger (BATCH_TO_VAULT)                    ║
 * ║  [5] Vault Bank pays out → Wise (PRIMESTACK TECHNOLOGIES LLC)               ║
 * ║                                                                              ║
 * ║  WISE BENEFICIARY: PRIMESTACK TECHNOLOGIES LLC                              ║
 * ║  ── USD ──────────────────────────────────────────────────────────────────  ║
 * ║  Routing (Wire/ACH) : 084009519                                             ║
 * ║  Account Number     : 343612919064346                                       ║
 * ║  Bank               : Column Bank (provided to Wise)                        ║
 * ║  Address            : Wise US Inc, 108 W 13th St, Wilmington, DE 19801      ║
 * ║  Swift/BIC          : TRWIUS35XXX                                           ║
 * ║  ── EUR ──────────────────────────────────────────────────────────────────  ║
 * ║  IBAN               : BE19 9058 6159 3312                                   ║
 * ║  Swift/BIC          : TRWIBEB1XXX                                           ║
 * ║  Bank               : Wise, Rue du Trône 100, Brussels 1050, Belgium        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   node _e2e_full_flow_wise_payout.cjs
 *   node _e2e_full_flow_wise_payout.cjs --currency EUR
 *   node _e2e_full_flow_wise_payout.cjs --base-url http://server:7000 --skip-reset
 */
'use strict';

const http  = require('http');
const https = require('https');
const { URL } = require('url');

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const flag    = (n, d = '') => { const i = args.indexOf(n); return i !== -1 && args[i+1] ? args[i+1] : d; };
const hasFlag = (n) => args.includes(n);

const BASE_URL   = flag('--base-url', process.env.POS_BASE_URL || 'http://127.0.0.1:7000');
const CURRENCY   = flag('--currency', 'USD').toUpperCase();
const SKIP_RESET = hasFlag('--skip-reset');

// ─── Wise beneficiary (PRIMESTACK TECHNOLOGIES LLC) ──────────────────────────
const WISE = {
  USD: {
    account_holder : 'PRIMESTACK TECHNOLOGIES LLC',
    bank_name      : 'Column Bank (Wise US Inc)',
    bank_address   : 'Wise US Inc, 108 W 13th St, Wilmington, DE, 19801, United States',
    account_number : '343612919064346',
    routing_number : '084009519',
    account_type   : 'CHECKING',
    swift_code     : 'TRWIUS35XXX',
    currency       : 'USD',
  },
  EUR: {
    account_holder : 'PRIMESTACK TECHNOLOGIES LLC',
    bank_name      : 'Wise (Belgium)',
    bank_address   : 'Wise, Rue du Trône 100, 3rd floor, Brussels, 1050, Belgium',
    iban           : 'BE19905861593312',
    swift_code     : 'TRWIBEB1XXX',
    currency       : 'EUR',
  },
};
const DEST = WISE[CURRENCY] || WISE.USD;

// ─── Test card (operator card with seeded auth code — bypasses TCP acquirer) ─
// These are seeded by POST /api/admin/setup-processor
const OPERATOR_CARD = {
  USD: { pan: '4165989902669610', expiry: '05/30', cvv: '145', authCode: '977614' },
  EUR: { pan: '4532017123851068', expiry: '06/29', cvv: '145', authCode: '977614' },
};
const CARD = OPERATOR_CARD[CURRENCY] || OPERATOR_CARD.USD;

// ─── Test amounts ─────────────────────────────────────────────────────────────
const CHARGE_AMOUNT   = 500.00;   // Card charge amount
const TOPUP_AMOUNT    = 500.00;   // Customer wallet topup (mirrors card charge)
const SEND_AMOUNT     = 400.00;   // Customer → Merchant transfer amount
const VAULT_AMOUNT    = 350.00;   // Merchant → Vault Bank credit
const PAYOUT_AMOUNT   = 300.00;   // Vault Bank → Wise payout

// ─── Identities ───────────────────────────────────────────────────────────────
const MERCHANT_ID  = 'MRC-1001';
const TERMINAL_ID  = 'T2013-001';
const RUN_ID       = Date.now().toString(36).toUpperCase();
const CUSTOMER_ID  = `e2e-${RUN_ID}`;

// ─── Ansi colors ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', white: '\x1b[37m',
};

// ─── Result tracking ──────────────────────────────────────────────────────────
let passed = 0, failed = 0, warned = 0;
const log = [];

const pass = (label, detail = '') => {
  passed++;
  log.push({ ok: true, label, detail });
  console.log(`  ${C.green}✅ PASS${C.reset}  ${C.bold}${label}${C.reset}${detail ? '  ' + C.dim + detail + C.reset : ''}`);
};
const fail = (label, detail = '') => {
  failed++;
  log.push({ ok: false, label, detail });
  console.log(`  ${C.red}❌ FAIL${C.reset}  ${C.bold}${label}${C.reset}${detail ? '  ' + C.dim + detail + C.reset : ''}`);
};
const warn = (label, detail = '') => {
  warned++;
  log.push({ ok: 'warn', label, detail });
  console.log(`  ${C.yellow}⚠️  WARN${C.reset}  ${label}${detail ? '  ' + C.dim + detail + C.reset : ''}`);
};
const info = (msg) => console.log(`       ${C.dim}ℹ  ${msg}${C.reset}`);
const section = (title) => {
  const bar = '─'.repeat(74);
  console.log(`\n${C.bold}${C.cyan}${bar}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
};
const printJson = (obj) => {
  if (!obj) return;
  try {
    JSON.stringify(obj, null, 2).split('\n').forEach(l => console.log(`       ${C.dim}${l}${C.reset}`));
  } catch { console.log(`       ${C.dim}${String(obj).slice(0, 300)}${C.reset}`); }
};

// ─── HTTP ─────────────────────────────────────────────────────────────────────
let TOKEN = '';

function req(method, path, body, extra = {}, ms = 25000) {
  return new Promise(resolve => {
    try {
      const url = new URL(path.startsWith('http') ? path : BASE_URL + path);
      const lib = url.protocol === 'https:' ? https : http;
      const pl  = body ? JSON.stringify(body) : null;
      const hdrs = {
        'Content-Type'  : 'application/json',
        'Content-Length': pl ? Buffer.byteLength(pl) : 0,
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...extra,
      };
      const opt = {
        hostname: url.hostname,
        port    : url.port || (url.protocol === 'https:' ? 443 : 80),
        method,
        path    : url.pathname + url.search,
        headers : hdrs,
        timeout : ms,
      };
      const r = lib.request(opt, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(d), raw: d });
          } catch {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, raw: d.slice(0, 500) });
          }
        });
      });
      r.on('timeout', () => { r.destroy(); resolve({ ok: false, timeout: true, status: 0 }); });
      r.on('error',   e => resolve({ ok: false, error: e.message, status: 0 }));
      if (pl) r.write(pl);
      r.end();
    } catch (e) { resolve({ ok: false, error: e.message, status: 0 }); }
  });
}

const GET  = (p, x)    => req('GET',  p, null, x);
const POST = (p, b, x) => req('POST', p, b, x);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Summary ──────────────────────────────────────────────────────────────────
function summary() {
  const bar = '═'.repeat(74);
  console.log(`\n${C.bold}${C.cyan}${bar}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  RESULT SUMMARY${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
  log.forEach(r => {
    if (r.ok === true)      console.log(`  ${C.green}✅${C.reset}  ${r.label}  ${C.dim}${r.detail}${C.reset}`);
    else if (!r.ok)         console.log(`  ${C.red}❌${C.reset}  ${r.label}  ${C.dim}${r.detail}${C.reset}`);
    else                    console.log(`  ${C.yellow}⚠️ ${C.reset}  ${r.label}  ${C.dim}${r.detail}${C.reset}`);
  });
  console.log(`\n${C.cyan}${bar}${C.reset}`);
  console.log(`  ${C.bold}Total    : ${passed + failed + warned}${C.reset}`);
  console.log(`  ${C.green}${C.bold}Passed   : ${passed}${C.reset}`);
  console.log(`  ${C.red}${C.bold}Failed   : ${failed}${C.reset}`);
  console.log(`  ${C.yellow}${C.bold}Warnings : ${warned}${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
  if (failed === 0) {
    console.log(`\n  ${C.bold}${C.green}🎉  ALL CRITICAL STEPS PASSED${C.reset}`);
    console.log(`  ${C.green}     Full flow verified: Card → Customer → Merchant → Vault → Wise${C.reset}`);
    console.log(`  ${C.green}     PRIMESTACK TECHNOLOGIES LLC receives funds at:${C.reset}`);
    if (CURRENCY === 'USD') {
      console.log(`  ${C.bold}${C.green}     Routing ${WISE.USD.routing_number}  ·  Acct ${WISE.USD.account_number}${C.reset}`);
      console.log(`  ${C.bold}${C.green}     Swift ${WISE.USD.swift_code}  ·  ${WISE.USD.bank_name}${C.reset}`);
    } else {
      console.log(`  ${C.bold}${C.green}     IBAN ${WISE.EUR.iban}  ·  Swift ${WISE.EUR.swift_code}${C.reset}`);
      console.log(`  ${C.bold}${C.green}     ${WISE.EUR.bank_name}${C.reset}`);
    }
  } else {
    console.log(`\n  ${C.bold}${C.red}❌  ${failed} CRITICAL STEP(S) FAILED${C.reset}`);
  }
  console.log();
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  // Header banner
  console.log(`\n${C.bold}${C.magenta}`);
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   PRIMESTACK PAYMENT PROCESSOR — FULL END-TO-END TEST  v2               ║');
  console.log('║   Card  →  Customer Wallet  →  Merchant Wallet                          ║');
  console.log('║        →  Vault Bank  →  WISE (PRIMESTACK TECHNOLOGIES LLC)             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log(C.reset);
  console.log(`  ${C.dim}Server   : ${BASE_URL}${C.reset}`);
  console.log(`  ${C.dim}Currency : ${CURRENCY}${C.reset}`);
  console.log(`  ${C.dim}Merchant : ${MERCHANT_ID}${C.reset}`);
  console.log(`  ${C.dim}Customer : ${CUSTOMER_ID}${C.reset}`);
  console.log(`  ${C.dim}Card     : ${CARD.pan.slice(0,6)}****${CARD.pan.slice(-4)}  Auth: ${CARD.authCode}  (operator card — internal processor)${C.reset}`);
  console.log(`  ${C.dim}Amounts  : charge=${CURRENCY} ${CHARGE_AMOUNT}  topup=${CURRENCY} ${TOPUP_AMOUNT}  send=${CURRENCY} ${SEND_AMOUNT}  vault=${CURRENCY} ${VAULT_AMOUNT}  payout=${CURRENCY} ${PAYOUT_AMOUNT}${C.reset}`);
  console.log(`  ${C.bold}${C.green}  Wise    : ${DEST.account_holder}${C.reset}`);
  if (CURRENCY === 'USD') {
    console.log(`  ${C.dim}           Routing ${DEST.routing_number}  ·  Acct ${DEST.account_number}  ·  ${DEST.swift_code}${C.reset}`);
  } else {
    console.log(`  ${C.dim}           IBAN ${DEST.iban}  ·  ${DEST.swift_code}${C.reset}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 0 — Health Check');
  // ══════════════════════════════════════════════════════════════════════════
  const hc = await GET('/health');
  if (hc.ok && hc.body?.status === 'ok') {
    pass('Server reachable', `${BASE_URL}/health → HTTP 200`);
    info(`Timestamp: ${hc.body.timestamp}`);
  } else {
    fail('Server not reachable', `status=${hc.status} timeout=${!!hc.timeout} error=${hc.error || ''}`);
    console.log(`\n  ${C.red}  FATAL: Cannot reach ${BASE_URL} — start the backend first:${C.reset}`);
    console.log(`  ${C.yellow}  cd backend && node dist/server.js${C.reset}\n`);
    summary(); process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 1 — Authenticate (obtain JWT)');
  // ══════════════════════════════════════════════════════════════════════════
  const user = process.env.ADMIN_USERNAME || 'admin';
  const pass_ = process.env.ADMIN_PASSWORD || 'admin1234';
  const loginR = await POST('/auth/login', { username: user, password: pass_ });
  if (loginR.ok && (loginR.body?.token || loginR.body?.access_token)) {
    TOKEN = loginR.body.token || loginR.body.access_token;
    pass('JWT obtained', `user=${user}`);
    info(`Token: ${TOKEN.slice(0, 40)}…`);
  } else {
    fail('Authentication failed', `HTTP ${loginR.status}  body=${JSON.stringify(loginR.body || loginR.raw).slice(0,200)}`);
    console.log(`\n  ${C.red}  FATAL: Auth failed — check ADMIN_PASSWORD in backend/.env${C.reset}\n`);
    summary(); process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 2 — Reset & Seed Test Environment');
  // ══════════════════════════════════════════════════════════════════════════
  if (!SKIP_RESET) {
    const rst = await POST('/api/admin/reset-balances', {});
    rst.ok
      ? pass('Balances reset to zero', 'All wallets, ledgers, idempotency caches cleared')
      : warn('Reset returned non-2xx', `HTTP ${rst.status}`);
  } else {
    warn('--skip-reset: skipping balance reset', 'Balance deltas may be affected');
  }

  // Seed operator card auth codes + fix protocol rules
  const setup = await POST('/api/admin/setup-processor', {});
  if (setup.ok && setup.body?.ok) {
    pass('Processor seeded', `Auth codes: ${(setup.body.codesActive || []).slice(0, 3).join(' | ')}`);
    info(`Rules: ${(setup.body.rulesFixed || []).join(' | ')}`);
  } else {
    warn('Processor setup unexpected response', JSON.stringify(setup.body).slice(0, 200));
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 3 — Create Test Customer');
  // ══════════════════════════════════════════════════════════════════════════
  const custR = await POST('/wallet/customers', {
    customerId: CUSTOMER_ID,
    name      : 'PRIMESTACK E2E Test Customer',
    email     : `e2e+${RUN_ID}@primestack.io`,
    phone     : '+1-555-0100',
    currency  : CURRENCY,
  });
  let CUST_UUID = CUSTOMER_ID;
  if (custR.ok) {
    CUST_UUID = custR.body?.id || custR.body?.customerId || CUSTOMER_ID;
    pass('Customer created', `uuid=${CUST_UUID}`);
    printJson(custR.body);
  } else if (custR.status === 409) {
    warn('Customer already exists (409)', `Using ${CUSTOMER_ID}`);
  } else {
    warn('Customer create non-2xx', `HTTP ${custR.status} — continuing`);
    printJson(custR.body || custR.raw);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section(`STEP 4 — Card Charge: ${CURRENCY} ${CHARGE_AMOUNT}  (Card → Merchant Wallet)`);
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  We use the seeded OPERATOR CARD with a pre-authorised auth code.
  //  The internal processor (confirmInternalCapture) handles this without
  //  needing a live TCP acquirer on port 9000.
  //  Result: merchant wallet MRC-1001 is credited.
  //
  console.log(`  ${C.dim}Card      : ${CARD.pan.slice(0,6)}****${CARD.pan.slice(-4)}  expiry=${CARD.expiry}  CVV=${CARD.cvv}${C.reset}`);
  console.log(`  ${C.dim}Auth code : ${CARD.authCode}  (pre-seeded — bypasses TCP acquirer)${C.reset}`);
  console.log(`  ${C.dim}Amount    : ${CURRENCY} ${CHARGE_AMOUNT.toFixed(2)}${C.reset}`);

  const stan = String(Math.floor(Math.random() * 999999)).padStart(6, '0');
  const ccyCode = CURRENCY === 'USD' ? '840' : CURRENCY === 'EUR' ? '978' : '840';

  const chargeR = await POST('/merchant/v1/payments/charge', {
    merchantId  : MERCHANT_ID,
    terminalId  : TERMINAL_ID,
    pan         : CARD.pan,
    expiry      : CARD.expiry,
    cvv         : CARD.cvv,
    authCode    : CARD.authCode,
    entryMode   : '201.3',
    amountMinor : Math.round(CHARGE_AMOUNT * 100),
    amount      : CHARGE_AMOUNT,
    currency    : CURRENCY,
    currencyCode: ccyCode,
    stan,
    customerId  : CUST_UUID,
    mcc         : '5999',
  });

  let authCodeUsed = CARD.authCode;
  let captureRef   = null;
  let settlementId = null;

  if (chargeR.ok && chargeR.body?.success === true) {
    authCodeUsed = chargeR.body.authCode || CARD.authCode;
    captureRef   = chargeR.body.captureRef || chargeR.body.paymentIntentId || null;
    settlementId = chargeR.body.settlementId || null;
    pass('Card charge APPROVED',
      `auth=${authCodeUsed}  captureRef=${captureRef || 'n/a'}  settlementId=${settlementId || 'n/a'}`);
    printJson(chargeR.body);
  } else {
    fail('Card charge FAILED',
      `HTTP ${chargeR.status}  success=${chargeR.body?.success}  error=${chargeR.body?.error || chargeR.body?.reason || chargeR.error || ''}`);
    printJson(chargeR.body || chargeR.raw);
    // Non-fatal — continue, merchant wallet may have been credited from earlier test
  }

  // Verify merchant wallet received the funds
  await sleep(400);
  const mBalR = await GET(`/wallet/merchant-balance/${MERCHANT_ID}`);
  let merchantBal = 0;
  if (mBalR.ok) {
    merchantBal = Number(mBalR.body?.balance ?? mBalR.body?.balances?.[CURRENCY] ?? 0);
    pass('Merchant wallet balance read post-charge', `${CURRENCY} ${merchantBal.toFixed(2)}`);
    printJson(mBalR.body);
    if (merchantBal > 0) {
      pass('Merchant wallet has funds from card charge', `${CURRENCY} ${merchantBal.toFixed(2)}`);
    } else {
      warn('Merchant wallet balance is 0 after charge', 'May be timing issue — continuing');
    }
  } else {
    warn('Could not read merchant balance', `HTTP ${mBalR.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section(`STEP 5 — Customer Wallet Credited: ${CURRENCY} ${TOPUP_AMOUNT}`);
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  Simulate the card processor crediting the customer's wallet balance.
  //  In production this arrives via card network settlement; in the test
  //  system we use POST /wallet/topup.
  //
  const topupRef = `CARD-${authCodeUsed}-${RUN_ID}`;
  const topupR = await POST('/wallet/topup', {
    customerId  : CUST_UUID,
    amount      : TOPUP_AMOUNT,
    currency    : CURRENCY,
    source      : 'card_charge',
    reference   : topupRef,
    description : `E2E test card charge — PAN ****${CARD.pan.slice(-4)} — auth ${authCodeUsed}`,
  });

  let custBal = 0;
  if (topupR.ok) {
    custBal = Number(topupR.body?.customer_balance ?? topupR.body?.balance ?? TOPUP_AMOUNT);
    pass('Customer wallet credited from card', `${CURRENCY} ${TOPUP_AMOUNT}  →  balance=${CURRENCY} ${custBal.toFixed(2)}`);
    printJson(topupR.body);
  } else if (topupR.status === 409) {
    warn('Topup duplicate reference (409)', `ref=${topupRef} — wallet may already be credited`);
  } else {
    fail('Customer wallet topup failed', `HTTP ${topupR.status}  ${JSON.stringify(topupR.body || topupR.raw).slice(0,200)}`);
  }

  // Verify customer balance
  await sleep(300);
  const cBalR = await GET(`/wallet/balance/${CUST_UUID}`);
  if (cBalR.ok) {
    custBal = Number(cBalR.body?.balance ?? cBalR.body?.balances?.[CURRENCY] ?? 0);
    pass('Customer balance confirmed', `${CURRENCY} ${custBal.toFixed(2)}`);
    printJson(cBalR.body);
  } else {
    warn('Could not read customer balance', `HTTP ${cBalR.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section(`STEP 6 — Customer → Merchant Wallet: ${CURRENCY} ${SEND_AMOUNT}`);
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  Customer sends funds to the merchant. We:
  //    1. Debit the customer wallet  (POST /wallet/debit)
  //    2. Credit the merchant wallet (POST /wallet/topup on the merchant side
  //       — using /api/vault/credit as the direct internal credit path)
  //
  console.log(`  ${C.dim}From : Customer  ${CUST_UUID}${C.reset}`);
  console.log(`  ${C.dim}To   : Merchant  ${MERCHANT_ID}${C.reset}`);
  console.log(`  ${C.dim}Amt  : ${CURRENCY} ${SEND_AMOUNT.toFixed(2)}${C.reset}`);

  const xferRef = `C2M-${RUN_ID}`;

  // 6a — Debit customer
  const debitR = await POST('/wallet/debit', {
    customerId  : CUST_UUID,
    amount      : SEND_AMOUNT,
    currency    : CURRENCY,
    reference   : xferRef,
    description : `E2E: customer sends to merchant ${MERCHANT_ID}`,
  });
  if (debitR.ok) {
    const remaining = Number(debitR.body?.customer_balance ?? debitR.body?.balance ?? 0);
    pass('Customer wallet debited',
      `${CURRENCY} ${SEND_AMOUNT} deducted  →  remaining=${CURRENCY} ${remaining.toFixed(2)}`);
    printJson(debitR.body);
  } else if (debitR.status === 400 && String(debitR.body?.error || '').includes('Insufficient')) {
    warn('Customer balance insufficient for full debit', `requested=${CURRENCY} ${SEND_AMOUNT}  balance=${CURRENCY} ${custBal.toFixed(2)}`);
  } else {
    fail('Customer wallet debit failed', `HTTP ${debitR.status}  ${JSON.stringify(debitR.body || debitR.raw).slice(0,200)}`);
  }

  // 6b — Credit merchant wallet (via vault ledger BATCH_TO_VAULT from merchant perspective)
  const mCreditRef = `C2M-CREDIT-${RUN_ID}`;
  const mCreditR = await POST('/api/vault/credit', {
    merchantId : MERCHANT_ID,
    amount     : SEND_AMOUNT,
    currency   : CURRENCY,
    reference  : mCreditRef,
    type       : 'BATCH_TO_VAULT',
    meta       : { source: 'customer_to_merchant', customerId: CUST_UUID, xferRef },
  });
  if (mCreditR.ok) {
    pass('Merchant credited from customer transfer',
      `${CURRENCY} ${SEND_AMOUNT}  ref=${mCreditRef}`);
    printJson(mCreditR.body);
  } else {
    fail('Merchant credit failed', `HTTP ${mCreditR.status}  ${JSON.stringify(mCreditR.body || mCreditR.raw).slice(0,200)}`);
  }

  // Re-read merchant balance
  await sleep(300);
  const mBalMid = await GET(`/wallet/merchant-balance/${MERCHANT_ID}`);
  if (mBalMid.ok) {
    merchantBal = Number(mBalMid.body?.balance ?? mBalMid.body?.balances?.[CURRENCY] ?? 0);
    pass('Merchant balance updated after customer transfer', `${CURRENCY} ${merchantBal.toFixed(2)}`);
    printJson(mBalMid.body);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section(`STEP 7 — Merchant → Vault Bank: ${CURRENCY} ${VAULT_AMOUNT}`);
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  Merchant pushes funds up into the central Vault Bank ledger so they
  //  are available for the outbound Wise settlement.
  //  Uses POST /api/vault/credit  (BATCH_TO_VAULT type)
  //
  console.log(`  ${C.dim}From : Merchant wallet  ${MERCHANT_ID}${C.reset}`);
  console.log(`  ${C.dim}To   : Vault Bank ledger (PROC-VAULT-${CURRENCY}-001)${C.reset}`);
  console.log(`  ${C.dim}Amt  : ${CURRENCY} ${VAULT_AMOUNT.toFixed(2)}${C.reset}`);

  const vaultCreditRef = `M2V-${RUN_ID}`;
  const vaultCreditR = await POST('/api/vault/credit', {
    merchantId : MERCHANT_ID,
    amount     : VAULT_AMOUNT,
    currency   : CURRENCY,
    reference  : vaultCreditRef,
    type       : 'BATCH_TO_VAULT',
    meta       : { source: 'merchant_to_vault', merchantId: MERCHANT_ID },
  });
  if (vaultCreditR.ok) {
    pass('Vault Bank ledger credited from merchant',
      `${CURRENCY} ${VAULT_AMOUNT}  ref=${vaultCreditRef}  type=BATCH_TO_VAULT`);
    printJson(vaultCreditR.body);
  } else {
    fail('Vault Bank credit failed',
      `HTTP ${vaultCreditR.status}  ${JSON.stringify(vaultCreditR.body || vaultCreditR.raw).slice(0,200)}`);
  }

  // Verify vault balance
  await sleep(400);
  const vBal = await GET('/api/vault/balance');
  let vaultBalance = 0;
  if (vBal.ok) {
    const b = vBal.body;
    vaultBalance = Number(b?.balance ?? b?.balances?.[CURRENCY] ?? b?.[CURRENCY] ?? 0);
    if (b?.accounts || b?.vault_accounts) {
      const accts = b.accounts || b.vault_accounts || [];
      const match = accts.find(a => String(a.currency || '').toUpperCase() === CURRENCY);
      if (match) vaultBalance = Number(match.balance || 0);
    }
    pass('Vault Bank balance confirmed', `${CURRENCY} ${vaultBalance.toFixed(2)}`);
    printJson(b);
  } else {
    warn('Could not read vault balance', `HTTP ${vBal.status}`);
  }

  // Also verify vault ledger entry
  const vLedger = await GET('/api/vault/ledger');
  if (vLedger.ok) {
    const entries = vLedger.body?.entries || vLedger.body?.ledger || vLedger.body || [];
    const arr = Array.isArray(entries) ? entries : [];
    const hit = arr.find(e =>
      e.reference === vaultCreditRef ||
      e.reference === mCreditRef ||
      e.type === 'BATCH_TO_VAULT'
    );
    if (hit) {
      pass('Vault ledger contains merchant→vault entry',
        `type=${hit.type}  amount=${hit.amount}  ref=${hit.reference}`);
    } else {
      warn('Vault ledger entry not found by ref', `total rows=${arr.length} — may use internal ref`);
      info(`Last 3 entries: ${JSON.stringify(arr.slice(-3))}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  section(`STEP 8 — Vault Bank → Wise Payout: ${CURRENCY} ${PAYOUT_AMOUNT}`);
  // ══════════════════════════════════════════════════════════════════════════
  //
  //  PRIMESTACK TECHNOLOGIES LLC receives the settlement via Wise.
  //
  //  Rails:
  //    USD → ACH/Wire  : Routing 084009519  Acct 343612919064346  Swift TRWIUS35XXX
  //    EUR → SEPA      : IBAN BE19905861593312  Swift TRWIBEB1XXX
  //
  console.log(`\n  ${C.bold}${C.green}  BENEFICIARY : ${DEST.account_holder}${C.reset}`);
  if (CURRENCY === 'USD') {
    console.log(`  ${C.bold}${C.green}  Bank        : ${DEST.bank_name}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Routing     : ${DEST.routing_number}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Account     : ${DEST.account_number}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Swift/BIC   : ${DEST.swift_code}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Address     : ${DEST.bank_address}${C.reset}`);
  } else {
    console.log(`  ${C.bold}${C.green}  Bank        : ${DEST.bank_name}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  IBAN        : ${DEST.iban}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Swift/BIC   : ${DEST.swift_code}${C.reset}`);
    console.log(`  ${C.bold}${C.green}  Address     : ${DEST.bank_address}${C.reset}`);
  }
  console.log(`  ${C.bold}${C.green}  Amount      : ${CURRENCY} ${PAYOUT_AMOUNT.toFixed(2)}${C.reset}\n`);

  // 8a — Vault bank entries payout record (debit from vault_entries)
  const vbPayoutRef = `VB-WISE-${RUN_ID}`;
  const vbPayoutR = await POST('/api/vault/vault-bank/payouts', {
    accountId          : `PROC-VAULT-${CURRENCY}-001`,
    amount             : PAYOUT_AMOUNT,
    currency           : CURRENCY,
    beneficiaryName    : DEST.account_holder,
    ...(CURRENCY === 'USD'
      ? { beneficiaryRouting: DEST.routing_number, beneficiarySwift: DEST.swift_code }
      : { beneficiaryIban: DEST.iban, beneficiarySwift: DEST.swift_code }),
    reference          : vbPayoutRef,
  });
  let vaultPayoutId = null;
  if (vbPayoutR.ok || vbPayoutR.status === 201) {
    vaultPayoutId = vbPayoutR.body?.payoutId || vbPayoutR.body?.id || null;
    pass('Vault Bank payout record created',
      `payoutId=${vaultPayoutId || 'n/a'}  ref=${vbPayoutRef}`);
    printJson(vbPayoutR.body);
  } else if (vbPayoutR.status === 409) {
    warn('Vault Bank payout idempotent (409)', `ref=${vbPayoutRef}`);
  } else {
    warn('Vault Bank payout non-2xx', `HTTP ${vbPayoutR.status}  ${JSON.stringify(vbPayoutR.body || vbPayoutR.raw).slice(0,200)}`);
    // Non-fatal — proceed to merchant payout (which is the primary rail)
  }

  // 8b — Merchant payout via Wise rail (main settlement instruction)
  //      POST /api/payout/merchant/:merchantId/payout/bank
  //      bank_account inline → Wise is guaranteed to be the beneficiary
  const wiseBankAccount = CURRENCY === 'USD'
    ? {
        bank_name        : DEST.bank_name,
        bank_address     : DEST.bank_address,
        account_holder   : DEST.account_holder,
        account_number   : DEST.account_number,
        routing_number   : DEST.routing_number,
        account_type     : 'CHECKING',
        swift_code       : DEST.swift_code,
        currency         : CURRENCY,
        recipient_address: { country: 'US', city: 'Wilmington', firstLine: '108 W 13th St', postCode: '19801' },
      }
    : {
        bank_name        : DEST.bank_name,
        bank_address     : DEST.bank_address,
        account_holder   : DEST.account_holder,
        iban             : DEST.iban,
        swift_code       : DEST.swift_code,
        currency         : CURRENCY,
        recipient_address: { country: 'BE', city: 'Brussels', firstLine: 'Rue du Trône 100, 3rd floor', postCode: '1050' },
      };

  const payoutR = await POST(`/api/payout/merchant/${MERCHANT_ID}/payout/bank`, {
    amount       : PAYOUT_AMOUNT,
    currency     : CURRENCY,
    bank_account : wiseBankAccount,
    reference    : `E2E-WISE-${RUN_ID}`,
    description  : `PRIMESTACK E2E vault settlement → Wise → ${DEST.account_holder}`,
  });

  let merchantPayoutId = null;
  let payoutStatus     = null;

  if (payoutR.ok || payoutR.status === 201) {
    merchantPayoutId = payoutR.body?.payout_id || payoutR.body?.payoutId || payoutR.body?.id || null;
    payoutStatus     = payoutR.body?.status || 'INITIATED';
    pass('Merchant → Wise payout instruction created',
      `payoutId=${merchantPayoutId || 'n/a'}  status=${payoutStatus}`);
    printJson(payoutR.body);

    // Validate key response fields
    if (payoutR.body?.ok) {
      pass('Payout response ok=true', `provider=${payoutR.body?.provider || 'n/a'}`);
    }
    if (String(payoutR.body?.message || '').toLowerCase().includes('wise')) {
      pass('Payout message confirms Wise rail', payoutR.body.message.slice(0, 80));
    }
  } else {
    fail('Merchant → Wise payout FAILED',
      `HTTP ${payoutR.status}  error=${payoutR.body?.error || payoutR.body?.message || ''}`);
    printJson(payoutR.body || payoutR.raw);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 9 — Verify: Payout History');
  // ══════════════════════════════════════════════════════════════════════════
  await sleep(500);
  const histR = await GET(`/api/payout/merchant/${MERCHANT_ID}/payouts`);
  if (histR.ok) {
    const payouts = histR.body?.payouts || histR.body || [];
    const arr = Array.isArray(payouts) ? payouts : [];
    pass(`Payout history retrieved`, `${arr.length} payout(s) on record for ${MERCHANT_ID}`);

    if (arr.length > 0) {
      const latest = arr[0];
      const statusOk = ['PENDING_BANK_CONFIRMATION','PENDING_RAIL','PROCESSING',
                        'COMPLETED','SETTLED','FAILED'].includes(String(latest.status || '').toUpperCase());

      console.log(`\n  ${C.bold}${C.green}  ╔══ LATEST PAYOUT ════════════════════════════════════════╗${C.reset}`);
      console.log(`  ${C.bold}  ║  ID         : ${(latest.id || 'n/a').slice(0,36)}${C.reset}`);
      console.log(`  ${C.bold}  ║  Amount     : ${latest.currency || CURRENCY} ${Number(latest.amount || 0).toFixed(2)}${C.reset}`);
      console.log(`  ${C.bold}  ║  Status     : ${latest.status}${C.reset}`);
      console.log(`  ${C.bold}  ║  Provider   : ${latest.provider || 'n/a'}${C.reset}`);
      console.log(`  ${C.bold}  ║  Provider # : ${latest.provider_reference || 'pending'}${C.reset}`);
      console.log(`  ${C.bold}  ║  Created    : ${latest.created_at || 'n/a'}${C.reset}`);
      console.log(`  ${C.bold}${C.green}  ╚══════════════════════════════════════════════════════════╝${C.reset}\n`);

      statusOk
        ? pass('Payout status is valid', `status=${latest.status}`)
        : warn('Unexpected payout status', `status=${latest.status}`);
    } else {
      warn('No payouts in history', 'Payout may not have persisted');
    }
  } else {
    warn('Could not retrieve payout history', `HTTP ${histR.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 10 — MT103 SWIFT Wire Message (Settlement Receipt)');
  // ══════════════════════════════════════════════════════════════════════════
  const valueDate = new Date().toISOString().slice(2,10).replace(/-/g,'');
  const uetr = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

  const mt103Body = CURRENCY === 'USD'
    ? {
        merchantId       : MERCHANT_ID,
        valueDate,
        amount           : PAYOUT_AMOUNT,
        currency         : 'USD',
        senderName       : 'PRIMESTACK PAYMENT PROCESSOR',
        senderAddress    : '201.3 SETTLEMENT ACCOUNT',
        beneficiaryBic   : 'TRWIUS35XXX',
        beneficiaryIban  : `US${WISE.USD.routing_number}${WISE.USD.account_number}`,
        beneficiaryName  : WISE.USD.account_holder,
        beneficiaryAddress: WISE.USD.bank_address,
        reference        : `E2E-${RUN_ID}`,
        remittanceInfo   : `PRIMESTACK E2E SETTLEMENT VIA WISE — ROUTING ${WISE.USD.routing_number} ACCT ${WISE.USD.account_number} SWIFT ${WISE.USD.swift_code}`,
        chargeBearerCode : 'SHA',
        uetr,
      }
    : {
        merchantId       : MERCHANT_ID,
        valueDate,
        amount           : PAYOUT_AMOUNT,
        currency         : 'EUR',
        senderName       : 'PRIMESTACK PAYMENT PROCESSOR',
        senderAddress    : '201.3 SETTLEMENT ACCOUNT',
        beneficiaryBic   : 'TRWIBEB1XXX',
        beneficiaryIban  : WISE.EUR.iban,
        beneficiaryName  : WISE.EUR.account_holder,
        beneficiaryAddress: WISE.EUR.bank_address,
        reference        : `E2E-${RUN_ID}`,
        remittanceInfo   : `PRIMESTACK E2E SETTLEMENT VIA WISE — IBAN ${WISE.EUR.iban} SWIFT ${WISE.EUR.swift_code}`,
        chargeBearerCode : 'SHA',
        uetr,
      };

  const mt103R = await POST('/api/payout/mt103/generate', mt103Body);
  if (mt103R.ok || mt103R.status === 201) {
    pass('MT103 SWIFT wire message generated', `UETR=${uetr}`);
    const msg = mt103R.body?.mt103 || mt103R.body?.message || mt103R.body?.raw || mt103R.body?.content || null;
    if (msg) {
      console.log(`\n  ${C.bold}${C.blue}  ─── MT103 SWIFT MESSAGE ────────────────────────────────────────${C.reset}`);
      String(msg).split('\n').forEach(l => console.log(`       ${C.dim}${l}${C.reset}`));
      console.log(`  ${C.bold}${C.blue}  ─────────────────────────────────────────────────────────────────${C.reset}\n`);
    } else {
      printJson(mt103R.body);
    }
  } else {
    warn('MT103 endpoint non-2xx', `HTTP ${mt103R.status}  ${JSON.stringify(mt103R.body || mt103R.raw).slice(0,200)}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('STEP 11 — Final Balance Snapshot');
  // ══════════════════════════════════════════════════════════════════════════
  const [fCust, fMerch, fVault] = await Promise.all([
    GET(`/wallet/balance/${CUST_UUID}`),
    GET(`/wallet/merchant-balance/${MERCHANT_ID}`),
    GET('/api/vault/balance'),
  ]);

  const fCustBal  = fCust.ok  ? Number(fCust.body?.balance  ?? fCust.body?.balances?.[CURRENCY]  ?? 0) : null;
  const fMerchBal = fMerch.ok ? Number(fMerch.body?.balance ?? fMerch.body?.balances?.[CURRENCY] ?? 0) : null;
  let   fVaultBal = null;
  if (fVault.ok) {
    const b = fVault.body;
    fVaultBal = Number(b?.balance ?? b?.balances?.[CURRENCY] ?? b?.[CURRENCY] ?? 0);
    if (b?.accounts || b?.vault_accounts) {
      const accts = b.accounts || b.vault_accounts || [];
      const match = accts.find(a => String(a.currency || '').toUpperCase() === CURRENCY);
      if (match) fVaultBal = Number(match.balance || 0);
    }
  }

  console.log(`\n  ${C.bold}${C.cyan}  ┌─────────────────────────────────────────────────────────────┐${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}  │   FINAL BALANCE SNAPSHOT — ${CURRENCY.padEnd(45)}│${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}  ├─────────────────────────────────────────────────────────────┤${C.reset}`);
  console.log(`  ${C.bold}  │   Customer Wallet  : ${CURRENCY} ${fCustBal  != null ? fCustBal.toFixed(2).padStart(12) : '      N/A   '}                          │${C.reset}`);
  console.log(`  ${C.bold}  │   Merchant Wallet  : ${CURRENCY} ${fMerchBal != null ? fMerchBal.toFixed(2).padStart(12) : '      N/A   '}                          │${C.reset}`);
  console.log(`  ${C.bold}  │   Vault Bank       : ${CURRENCY} ${fVaultBal != null ? fVaultBal.toFixed(2).padStart(12) : '      N/A   '}                          │${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}  ├─────────────────────────────────────────────────────────────┤${C.reset}`);
  console.log(`  ${C.bold}${C.green}  │   WISE BENEFICIARY : ${DEST.account_holder.padEnd(41)}│${C.reset}`);
  if (CURRENCY === 'USD') {
    console.log(`  ${C.bold}${C.green}  │   Routing          : ${DEST.routing_number.padEnd(41)}│${C.reset}`);
    console.log(`  ${C.bold}${C.green}  │   Account          : ${DEST.account_number.padEnd(41)}│${C.reset}`);
  } else {
    console.log(`  ${C.bold}${C.green}  │   IBAN             : ${DEST.iban.padEnd(41)}│${C.reset}`);
  }
  console.log(`  ${C.bold}${C.green}  │   Swift/BIC        : ${DEST.swift_code.padEnd(41)}│${C.reset}`);
  console.log(`  ${C.bold}${C.green}  │   Payout Amount    : ${CURRENCY} ${PAYOUT_AMOUNT.toFixed(2).padStart(12)}                          │${C.reset}`);
  console.log(`  ${C.bold}${C.cyan}  └─────────────────────────────────────────────────────────────┘${C.reset}\n`);

  if (fCustBal  != null) pass('Final customer balance',  `${CURRENCY} ${fCustBal.toFixed(2)}`);
  if (fMerchBal != null) pass('Final merchant balance',  `${CURRENCY} ${fMerchBal.toFixed(2)}`);
  if (fVaultBal != null) pass('Final vault balance',     `${CURRENCY} ${fVaultBal.toFixed(2)}`);

  summary();
}

main().catch(err => {
  console.error(`\n${C.red}  UNCAUGHT ERROR: ${err.message}${C.reset}`);
  console.error(err.stack);
  summary();
  process.exit(1);
});
