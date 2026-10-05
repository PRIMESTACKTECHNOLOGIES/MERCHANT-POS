/**
 * DECLINE SIMULATION — 6 conditions, NO demo approvals anywhere
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. PAN failed Luhn (wrong details)
 * 2. Invalid CVV format (wrong details)
 * 3. Issuer AAC cryptogram — card blocked / insufficient funds
 * 4. TVR byte2 b1 — CARD_BLOCKED_HOTLIST
 * 5. TVR byte3 b1 — OFFLINE_NOT_ALLOWED
 * 6. TVR byte5 b2 — INTERNATIONAL_NOT_ALLOWED
 * 7. (bonus) Missing CARD_PROCESSOR_URL → DECLINE not "OFFLINE APPROVED" (old demo bug)
 *
 * Post every condition to both:
 *   a) /api/pos/offline-sale (SyncWorker sync)
 *   b) Backend charge endpoint (online payments.service)
 *
 * VERIFY:
 *   → Response status DECLINED for all 12 requests
 *   → Merchant wallet balance is 0 before and after (no money credited ever)
 *   → 0 unsettled merchant_pos_settlements rows added
 *   → Decline_reason column populated with actual code + reason in pos2013_transactions
 */
const axios = require('axios');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const BASE = 'http://127.0.0.1:7000';
const AUTH = process.env.E2E_TOKEN;

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║   NO-DEMO DECLINE COMPLIANCE TEST — 6 conditions × 2 endpoints   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let token = AUTH;
  if (!token) {
    const r = await axios.post(BASE + '/auth/login', { username: 'admin', password: 'admin123' });
    token = r.data.token;
    console.log('✅ Got JWT', token.slice(0, 16) + '...\n');
  }
  const auth = { headers: { Authorization: 'Bearer ' + token } };

  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(__dirname, '..', process.env.DATABASE_PATH)
    : path.resolve(__dirname, '..', 'data', 'database.sqlite');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // ── Pre: clean up all txn/settlements/wallet txns for MRC-1001, zero balances
  await db.exec(`PRAGMA journal_mode = WAL;`);
  await db.run('DELETE FROM pos2013_transactions WHERE merchant_id=?', ['MRC-1001']);
  await db.run('DELETE FROM merchant_pos_settlements WHERE merchant_id=?', ['MRC-1001']);
  await db.run(`DELETE FROM merchant_wallet_transactions WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id=?)`, ['MRC-1001']);
  await db.run('UPDATE merchant_wallets SET balance=0, updated_at=CURRENT_TIMESTAMP WHERE merchant_id=?', ['MRC-1001']);
  await db.run('DELETE FROM pos_idempotency');
  console.log('[PRE] MRC-1001 merchant balances reset to 0\n');

  function beforeBalances() {
    return db.all('SELECT currency, balance FROM merchant_wallets WHERE merchant_id=? ORDER BY currency', ['MRC-1001']).then(r => r || []);
  }

  // TVR builder: 5 bytes, set specific bits for each test
  function tvrWithBit(byteIndex0, bitMask) {
    const bytes = new Array(5).fill(0x00);
    bytes[byteIndex0] |= bitMask;
    return Buffer.from(bytes).toString('hex');
  }
  function cidWith(b7b6) {
    // CID byte 1 bits 7&6: 00=AAC(decline), 10=TC(offline-approved), 01=ARQC
    return Buffer.from([(b7b6 & 0xC0) | 0x00]).toString('hex').padStart(2, '0');
  }

  const DECLINE_CASES = [
    {
      id: 1,
      name: '(1) Wrong details: PAN failed Luhn check',
      code: 'PAN_LUHN_FAIL',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 50.00,
        currency: 'USD',
        stan: 'LUHN01',
        rrn: 'R-LUHN-01',
        pan: '4111111111111112', // valid length but Luhn bad (correct is ...1111)
        card_masked: '4111********1112',
      }
    },
    {
      id: 2,
      name: '(2) Wrong details: invalid CVV format (5 digits)',
      code: 'CVV_INVALID',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 25.00,
        currency: 'USD',
        stan: 'CVV002',
        rrn: 'R-CVV-002',
        pan: '4111111111111111',
        cvv: '12345',
        card_masked: '4111********1111',
      }
    },
    {
      id: 3,
      name: '(3) Account empty / blocked: issuer AAC cryptogram',
      code: 'CARD_BLOCKED_AAC',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 100.00,
        currency: 'USD',
        stan: 'AAC003',
        rrn: 'R-AAC-003',
        pan: '5500005555550006', // MC valid Luhn (PAN Luhn sum 30 mod 10 = 0)
        card_masked: '5500********0006',
        emv: {
          cryptogramType: 'AAC',
          cid: cidWith(0x00),       // CID=00 = AAC
          tvr: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]).toString('hex'),
          tsi: '0000',
          aip: '1C00',
        }
      }
    },
    {
      id: 4,
      name: '(4) Card blocked: hit hot card / revocation list (TVR b2 b1)',
      code: 'CARD_BLOCKED_HOTLIST',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 200.00,
        currency: 'USD',
        stan: 'HOT004',
        rrn: 'R-HOT-004',
        pan: '4111111111111111',
        card_masked: '4111********1111',
        emv: {
          cryptogramType: 'ARQC',
          cid: cidWith(0x40), // 01=ARQC
          tvr: tvrWithBit(1, 0x01), // b2 (byte index 1) bit1 on → exceptional file
          aip: '1C00',
        }
      }
    },
    {
      id: 5,
      name: '(5) Not allowed offline: transaction must go online (TVR b3 b1)',
      code: 'OFFLINE_NOT_ALLOWED',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 500.00,
        currency: 'USD',
        stan: 'OFNL05',
        rrn: 'R-OFNL-05',
        pan: '4111111111111111',
        card_masked: '4111********1111',
        emv: {
          cryptogramType: 'ARQC',
          cid: cidWith(0x40),
          tvr: tvrWithBit(2, 0x01), // b3 (byte index 2) bit1 on → online required
          aip: '1C00',
        }
      }
    },
    {
      id: 6,
      name: '(6) Not allowed for international transfers (TVR b5 b2)',
      code: 'INTERNATIONAL_NOT_ALLOWED',
      basePayload: {
        merchant_id: 'MRC-1001',
        amount: 1500.00,
        currency: 'EUR',
        stan: 'INTL06',
        rrn: 'R-INTL-06',
        pan: '4111111111111111',
        card_masked: '4111********1111',
        emv: {
          cryptogramType: 'ARQC',
          cid: cidWith(0x40),
          tvr: tvrWithBit(4, 0x02), // b5 (byte index 4) bit2 on → intl not allowed
          aip: '1C00',
        }
      }
    },
    {
      id: 7,
      name: '(7) Online authorization with CONFIGURATION_ERROR (no processor URL) → must DECLINE (not stand-in approved)',
      code: 'CONFIGURATION_ERROR / DECLINED',
      endpoint: 'processPosTransaction',
      basePayload: {
        amountMinor: 77700,  // $777.00
        currency: 'USD',
        merchantId: 'MRC-1001',
        terminalId: 'T2013-001',
        stan: 'CFG007',
        pan: '4111111111111111',
        expiry: '12/29',
        cvv: '123',
      }
    }
  ];

  const preBal = await beforeBalances();
  console.log('[PRE] Merchant balances before test:', preBal);
  console.log('');

  let allPassed = true;
  const results = [];

  // ──── Route A: /api/pos/offline-sale (SyncWorker sync batch) ──────────
  for (const c of DECLINE_CASES.filter(c => !c.endpoint || c.endpoint !== 'processPosTransaction')) {
    try {
      const before = JSON.parse(JSON.stringify(await beforeBalances()));
      const resp = await axios.post(BASE + '/api/pos/offline-sale', {
        merchant_id: c.basePayload.merchant_id,
        transactions: [{ ...c.basePayload }]
      }, auth);
      const r = resp.data;
      const declinedTxn = (r.results || []).find(x => x.declined === true);
      const pass = r.ok === false
        && r.declined === 1
        && r.credited === 0
        && declinedTxn
        && (declinedTxn.decline_code === c.code
          || (c.code === 'CARD_BLOCKED_AAC' && (declinedTxn.decline_code === 'CARD_BLOCKED_AAC' || declinedTxn.decline_code === 'CARD_BLOCKED_CID_AAC')));
      const after = await beforeBalances();
      const noCredit = before.length === after.length && before.every((b, i) => Number(b.balance) === Number(after[i].balance));
      const passFinal = pass && noCredit;
      results.push({ case: c.id, name: c.name, route: '/pos/offline-sale', pass: passFinal, decline_code: declinedTxn?.decline_code });
      console.log(`${passFinal ? '✅' : '❌'} RouteA/sync case ${c.id}: ${c.name.slice(0, 72)} → got=(${declinedTxn?.decline_code || '?'}) expected=(${c.code}) balance_unchanged=${noCredit}`);
      if (!passFinal) allPassed = false;
    } catch (e) {
      const msg = e?.response?.data || e.message;
      results.push({ case: c.id, name: c.name, route: '/pos/offline-sale', pass: false });
      console.log(`❌ RouteA case ${c.id}: ERROR → ${String(msg).slice(0, 120)}`);
      allPassed = false;
    }
  }

  // ──── Route B: online charge payments.service /api endpoint ──────────
  // Router is mounted at "/merchant/v1/payments" + inside router prefix is "/payments/charge"
  // → full URL is "/merchant/v1/payments/payments/charge"
  const chargeRoute = '/merchant/v1/payments/payments/charge';
  for (const c of DECLINE_CASES) {
    let payload = c.endpoint === 'processPosTransaction'
      ? c.basePayload
      : {
        amountMinor: Math.round(c.basePayload.amount * 100),
        currency: c.basePayload.currency || 'USD',
        merchantId: c.basePayload.merchant_id,
        terminalId: c.basePayload.terminal_id || 'T2013-001',
        stan: c.basePayload.stan,
        pan: c.basePayload.pan || '4111111111111111',
        expiry: c.basePayload.expiry || '12/29',
        cvv: c.basePayload.cvv || '123',
        emv: c.basePayload.emv,
      };
    try {
      const before = JSON.parse(JSON.stringify(await beforeBalances()));
      const httpResp = await axios.post(BASE + chargeRoute, payload, auth).catch(e => e.response || { status: 0, data: { error: e.message } });
      const r = httpResp.data;
      const pass = r && r.status === 'DECLINED' && r.success === false;
      const after = await beforeBalances();
      const noCredit = before.length === after.length && before.every((b, i) => Number(b.balance) === Number(after[i].balance));
      const passFinal = pass && noCredit;
      results.push({ case: c.id + 100, name: c.name, route: 'payments.service(charge)', pass: passFinal, status: r?.status, reason: r?.reason });
      console.log(`${passFinal ? '✅' : '❌'} RouteB/charge case ${c.id}: ${c.name.slice(0, 72)} → status=${r?.status || 'error'} balance_unchanged=${noCredit}${r?.reason ? ` reason=${r.reason.slice(0, 100)}` : (r?.error ? ' error='+String(r.error).slice(0,120) : '')}${!pass && !r?.status && !r?.error && httpResp?.status ? ` http_status=${httpResp.status}`:''}`);
      if (!passFinal) allPassed = false;
    } catch (e) {
      const msg = e?.response?.data || e.message;
      results.push({ case: c.id + 100, name: c.name, route: 'payments.service(charge)', pass: false });
      console.log(`❌ RouteB case ${c.id}: ERROR → ${String(msg).slice(0, 200)}`);
      allPassed = false;
    }
  }

  // ──── FINAL DB CHECKS ─────────────────────────────────────────────────
  const final = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM merchant_pos_settlements WHERE merchant_id='MRC-1001') settlements,
      (SELECT COALESCE(SUM(balance),0) FROM merchant_wallets WHERE merchant_id='MRC-1001') merch_total,
      (SELECT COUNT(*) FROM pos2013_transactions WHERE merchant_id='MRC-1001' AND status<>'DECLINED') approved_pos_tx,
      (SELECT COUNT(*) FROM pos2013_transactions WHERE merchant_id='MRC-1001' AND status='DECLINED') declined_pos_tx,
      (SELECT COUNT(*) FROM merchant_wallet_transactions WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id='MRC-1001')) wallet_tx
  `);
  console.log(`\n── DB final state after ALL decline tests: ──`);
  console.log(JSON.stringify(final, null, 2));

  const merchantTotalZero = Number(final.merch_total) === 0;
  const zeroSettlements = final.settlements === 0;
  const zeroApproved = final.approved_pos_tx === 0;
  const declCountOK = final.declined_pos_tx >= DECLINE_CASES.length;
  const zeroWalletTx = final.wallet_tx === 0;
  const finalDbOK = merchantTotalZero && zeroSettlements && zeroApproved && declCountOK && zeroWalletTx;

  console.log(`\n── Integrity flags: ──`);
  console.log(`Merchant $0 total: ${merchantTotalZero ? '✅' : '❌'}   (${final.merch_total})`);
  console.log(`0 settlement rows: ${zeroSettlements ? '✅' : '❌'}   (${final.settlements})`);
  console.log(`0 APPROVED pos txn: ${zeroApproved ? '✅' : '❌'}   (${final.approved_pos_tx})`);
  console.log(`Declined rows ≥ tests: ${declCountOK ? '✅' : '❌'}   (${final.declined_pos_tx})`);
  console.log(`0 wallet_tx (no credit ever): ${zeroWalletTx ? '✅' : '❌'}   (${final.wallet_tx})`);

  if (!finalDbOK) allPassed = false;

  console.log(`\n${allPassed ? '🎉 ALL DECLINE TESTS PASSED — NO DEMO APPROVALS ANYWHERE'
    : '⚠  SOME DECLINE TESTS FAILED. Review ❌ rows above.'}`);
  console.log(`\n   Summary: ${results.filter(r=>r.pass).length}/${results.length} pass\n`);

  await db.close();
  process.exit(allPassed ? 0 : 2);
})().catch(e => { console.error('[FATAL]', e); process.exit(3); });
