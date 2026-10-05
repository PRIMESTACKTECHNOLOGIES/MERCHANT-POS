const fs = require('fs');
const path = require('path');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const PORT = 7000;
const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');

let adminJwt = '';
const AUTH = {
  protocol: '201.3',
  entryMode: '201.3',
  code: '977614',
  stan: '000002',
  amount: 99.00,
  amountMinor: 9900,
  currency: 'USD',
  panFull: '5413000000003284',
  panMasked: '5413 ******** 3284',
  expiry: '12/29',
  cvv: '999',
  merchantId: 'MRC-1001',
  terminalId: 'T2013-001',
  customerId: '298da3e3-a123-42ec-b96f-0919d743ab9c',
  walletCode: 'PSW-4177-9474',
  reportId: 'E37F5D4EDD159D8DFDBA24C2',
  linkCode: '84D09B936779E2FC',
  linkId: '140',
};

function httpReq(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, hostname: '127.0.0.1', port: PORT, path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...(adminJwt ? { 'Authorization': `Bearer ${adminJwt}` } : {}),
        ...headers,
      },
      timeout: 20000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ statusCode: res.statusCode, body: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runDirectDbFinalVerification(stepLabel) {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const q = (sql, p = []) => {
    const s = db.prepare(sql); s.bind(p); const r = [];
    while (s.step()) r.push(s.getAsObject()); s.free(); return r;
  };

  const auth = q(`SELECT id, status, amount, captured_at FROM card_authorizations WHERE UPPER(code)=? AND protocol=? ORDER BY created_at DESC LIMIT 1`, [AUTH.code.toUpperCase(), AUTH.protocol])[0] || null;
  const wallet = q(`SELECT id, wallet_code, balance, currency FROM customer_wallets WHERE wallet_code=? OR customer_id=? ORDER BY balance DESC LIMIT 1`, [AUTH.walletCode, AUTH.customerId])[0] || null;
  const pos = q(`SELECT id, stan, auth_code, status, amount_minor, pan_masked, updated_at FROM pos2013_transactions WHERE stan=? OR auth_code=? ORDER BY txn_timestamp DESC LIMIT 1`, [AUTH.stan, AUTH.code.toUpperCase()])[0] || null;
  const wtxns = q(`SELECT id, type, amount, currency, source, reference, pan_masked, created_at FROM wallet_transactions WHERE wallet_id=? ORDER BY created_at DESC LIMIT 5`, [wallet?.id || '___no_wallet___']);
  const ledger = q(`SELECT id, type, status, amount, currency, description, created_at FROM ledger_entries ORDER BY datetime(created_at) DESC LIMIT 8`);

  console.log(`\n── DB SNAPSHOT [${stepLabel}] ──`);
  console.log('  auth   :', auth ? `${auth.status} $${Number(auth.amount).toFixed(2)} cap@${auth.captured_at || '(not yet)'}` : '(no row)');
  console.log('  wallet :', wallet ? `${wallet.wallet_code} $${Number(wallet.balance).toFixed(2)} ${wallet.currency}` : '(no row)');
  console.log('  pos2013:', pos ? `STAN=${pos.stan} Auth=${pos.auth_code} [${pos.status}] $${(pos.amount_minor/100).toFixed(2)} PAN=${pos.pan_masked}` : '(no row)');
  console.log('  wallet_txns (latest 5):');
  wtxns.forEach(t => console.log(`     • [${t.type.toUpperCase()}] $${Number(t.amount).toFixed(2)} ${t.currency}  src=${t.source}  ref=${t.reference}  pan=${t.pan_masked}`));
  console.log('  ledger (latest 8) — types/amounts:');
  ledger.forEach(l => console.log(`     • [${l.type}/${l.status}] $${Number(l.amount).toFixed(2)} — ${(l.description || '').slice(0, 90)}`));

  return { auth, wallet, pos, wtxns, ledger };
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   COMPLETE 201.3 REDEMPTION — $99.00 / Auth 977614 / STAN 2 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Login
  const login = await httpReq('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
  adminJwt = login.body?.token || '';
  if (!adminJwt) throw new Error('Login failed: ' + JSON.stringify(login.body));
  console.log('[1/5] Login OK as admin');

  // Pre-check
  await runDirectDbFinalVerification('BEFORE');

  // 2. Protocol 201.3 validation (match-only — marks auth REDEEMED on success per line 153)
  const validateBody = {
    protocol: AUTH.protocol,
    cardNumber: AUTH.panFull,
    code: AUTH.code,
    cvv: AUTH.cvv,
    amount: AUTH.amount,
    currency: AUTH.currency,
    merchantId: AUTH.merchantId,
  };
  const vres = await httpReq('POST', '/api/card-auth/validate', validateBody);
  console.log('\n[2/5] Protocol 201.3 validate:',
    `HTTP ${vres.statusCode}`,
    vres.body?.valid ? '✅ VALID' : '❌ INVALID',
    vres.body?.authorizationId ? '(authId='+vres.body.authorizationId.slice(0,10)+'...)' : '',
  );
  if (!vres.body?.valid) console.log('       Reason:', vres.body?.reason || vres.body?.error || JSON.stringify(vres.body));
  await delay(300);

  // 3. Full charge via /merchant/v1/payments/charge (the route that does: 201.3 validate → service.charge → wallet credit → pos2013 APPROVED → ledger entries)
  const chargeBody = {
    amountMinor: AUTH.amountMinor,
    currency: AUTH.currency,
    merchantId: AUTH.merchantId,
    terminalId: AUTH.terminalId,
    pan: AUTH.panFull,
    expiry: AUTH.expiry,
    cvv: AUTH.cvv,
    stan: AUTH.stan,
    customerId: AUTH.customerId,
    authCode: AUTH.code,
    entryMode: AUTH.entryMode,
    emv: {
      protocol: '201.3',
      link_id: AUTH.linkId,
      link_code: AUTH.linkCode,
      report_id: AUTH.reportId,
      psr: 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB',
      verification_token_sha256: '21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef',
      generated_at: '2026-09-02T23:15:39.677926',
    },
  };
  const cres = await httpReq('POST', '/merchant/v1/payments/charge', chargeBody);
  console.log('\n[3/5] /merchant/v1/payments/charge:', `HTTP ${cres.statusCode}`);
  console.log('       status :', cres.body?.status || cres.body?.statusCode);
  console.log('       success:', cres.body?.success);
  if (cres.statusCode >= 400 || cres.body?.status === 'DECLINED') {
    console.log('       DECLINE Reason / Error:',
      cres.body?.reason || cres.body?.error || cres.body?.message || JSON.stringify(cres.body).slice(0, 500)
    );
  } else {
    for (const k of ['auth_code','rrn','stan','approval_code','settlement_status','authId','transactionId','id','balance','wallet_id']) {
      if (cres.body?.[k] !== undefined && cres.body[k] !== null) {
        console.log(`       ${k.padEnd(20)}:`, String(cres.body[k]).slice(0, 80));
      }
    }
  }
  await delay(600);

  // 4. Post-check
  const post = await runDirectDbFinalVerification('AFTER');

  // 5. Final verdict
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                        FINAL VERDICT                         │');
  console.log('└──────────────────────────────────────────────────────────────┘\n');

  const bal = post.wallet ? Number(post.wallet.balance) : 0;
  const authRedeemed = post.auth && (post.auth.status === 'REDEEMED' || post.auth.status === 'USED');
  const posApproved = post.pos && (post.pos.status === 'APPROVED' || post.pos.status === 'SYNCED');
  const hasCredit = post.wtxns.some(t => t.type.toLowerCase() === 'credit' && Number(t.amount) >= AUTH.amount);
  const hasLedger = post.ledger.length >= 1;

  if (bal >= 99.00 && authRedeemed && posApproved && hasCredit) {
    console.log('  ✅✅✅  PAYMENT FULLY RECEIVED & SETTLED\n');
    console.log('    • Wallet balance        : $' + bal.toFixed(2) + ' USD');
    console.log('    • card_authorizations  : ' + post.auth.status + ' (one-time auth consumed)');
    console.log('    • pos2013_transactions : ' + post.pos.status);
    console.log('    • wallet_transactions  : credit present for $' + AUTH.amount.toFixed(2));
    if (hasLedger) console.log('    • ledger_entries       : ' + post.ledger.length + ' entries (authorize/capture/settle chain)');
    console.log('\n    → Ready for customer use. Balance on ' + AUTH.walletCode + ' is spendable.');
  } else {
    console.log('  ⚠️  PARTIAL / PENDING — investigate:\n');
    console.log('    • Wallet ≥ $99.00  : ' + (bal >= 99.00 ? '✅ $'+bal.toFixed(2) : '❌ $'+bal.toFixed(2)));
    console.log('    • Auth REDEEMED    : ' + (authRedeemed ? '✅ '+post.auth.status : '❌ '+(post.auth?.status || 'NULL')));
    console.log('    • POS2013 APPROVED : ' + (posApproved ? '✅ '+post.pos.status : '❌ '+(post.pos?.status || 'NULL')));
    console.log('    • Credit txn       : ' + (hasCredit ? '✅ present' : '❌ missing'));
    console.log('    • Ledger entries   : ' + (hasLedger ? `✅ ${post.ledger.length}` : '❌ none'));
    console.log('\n    → Charge HTTP response above has the error reason — fix and re-run this script.');
  }
}

main().catch(err => { console.error('\nFATAL:', err); process.exit(1); });
