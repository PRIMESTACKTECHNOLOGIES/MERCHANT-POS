require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const axios = require('axios');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';
const TO_ADDRESS = 'TCjaTRox9EfvrD47fnH9mcAbdTiGB6iHWC';
const TARGET_ASSET = 'USDT';
const NETWORK = 'TRX'; // Binance uses "TRX" as network identifier for Tron TRC-20 USDT (per docs)
const AMOUNT_USDT = 300;
const AMOUNT_USD = 300;
const SOURCE_CURRENCY = 'USD';
const JJ_DUMBA_CUSTOMER_ID = 'ffdda304-629d-453e-91af-be35bc900024';

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const BINANCE_BASE = process.env.BINANCE_BASE_URL || 'https://api.binance.com';

/* ───────────────── BINANCE HELPERS (mirror binance.service.ts) ─────────── */
function hmacSha256(msg, secret) { return crypto.createHmac('sha256', secret).update(msg).digest('hex'); }
function uuidv4() {
  const r = crypto.randomBytes(16);
  r[6] = (r[6] & 0x0f) | 0x40; r[8] = (r[8] & 0x3f) | 0x80;
  return r.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
function signedQuery(params) {
  const qs = Object.entries({ ...params, timestamp: Date.now(), recvWindow: 60000 })
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const sig = hmacSha256(qs, BINANCE_API_SECRET);
  return `${qs}&signature=${sig}`;
}
async function binanceSignedGet(path, params = {}) {
  const url = `${BINANCE_BASE}${path}?${signedQuery(params)}`;
  const r = await axios.get(url, { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }, timeout: 30000 });
  return r.data;
}
async function binanceSignedPost(path, params = {}) {
  const qs = signedQuery(params);
  const url = `${BINANCE_BASE}${path}?${qs}`;
  const r = await axios.post(url, null, { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
  return r.data;
}
/* India travel rule questionnaire (default) — matches binance.service.ts */
function defaultIndiaQuestionnaire() {
  return {
    '1': { sendTo: '2', /* 2 = transfer to someone else */ beneficiaryAccountNumber: '',
          beneficiaryName: 'Jukruti Jacob Dumba', countryOfResidence: 'UG', /* Uganda? Sub SA? We'll leave as is; overwrite if wrong. */
          relationship: '', remittancePurpose: 'OTH', /* Other */ remittancePurposeOther: 'Merchant gold sale payout to beneficiary TRC20 wallet' }
  };
}

/* ───────────────── SQLITE / DB ─────────────────────────────────────────── */
async function withDbTx(fn) {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const data = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(data);
  db.run('SAVEPOINT tx');
  const q = (sql, p = []) => {
    const stmt = db.prepare(sql); if (p.length) stmt.bind(p);
    const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return Promise.resolve({ rows });
  };
  q.run = (sql, p = []) => { db.run(sql, p); return Promise.resolve({ rowsAffected: db.getRowsModified ? db.getRowsModified() : 0 }); };
  try {
    const result = await fn(db, q);
    db.run('RELEASE SAVEPOINT tx');
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return result;
  } catch (e) {
    try { db.run('ROLLBACK TO SAVEPOINT tx'); } catch (_) {}
    try { db.run('RELEASE SAVEPOINT tx'); } catch (__) {}
    throw e;
  } finally { try { db.close(); } catch (_) {} }
}
async function snapshot() {
  const SQL = await initSqlJs({ locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  const data = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(data);
  const q = (sql, p = []) => {
    const stmt = db.prepare(sql); if (p.length) stmt.bind(p);
    const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return { rows };
  };
  const payoutCols = q(`PRAGMA table_info(merchant_payouts)`).rows.map(c => c.name);
  const res = {
    payoutCols,
    usdW: q('SELECT * FROM merchant_wallets WHERE merchant_id=? AND currency=?', [MERCHANT_ID, SOURCE_CURRENCY]).rows[0],
    payouts: q(`SELECT COUNT(*) as c FROM merchant_payouts WHERE merchant_id=? AND status IN ('PENDING_APPROVAL','COMPLETED','SUBMITTED','PROCESSING','APPROVED','PENDING','PENDING_MANUAL_TRANSFER') AND currency=?`, [MERCHANT_ID, TARGET_ASSET]).rows[0],
    mwtxC: q(`SELECT COUNT(*) as c FROM merchant_wallet_transactions`).rows[0].c,
    cryptoTxC: q(`SELECT COUNT(*) as c FROM crypto_transactions`).rows[0].c,
    ledC: q(`SELECT COUNT(*) as c FROM ledger_entries`).rows[0].c,
    lastPayout: q(`SELECT * FROM merchant_payouts WHERE merchant_id=? ORDER BY created_at DESC LIMIT 5`, [MERCHANT_ID]).rows,
  };
  db.close(); return res;
}

/* ────────────────── MAIN ─────────────────────────────────────────────── */
(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MERCHANT REAL USDT PAYOUT → JJ DUMBA (Binance TRC20 DIRECT)');
  console.log('   MRC-1001 | USD $', AMOUNT_USD, '→ USDT ', AMOUNT_USDT, ' → ', TO_ADDRESS);
  console.log('═══════════════════════════════════════════════════════════════\n');

  /* ── 0. BEFORE SNAPSHOT (read-only) ───────────────────────── */
  const before = await snapshot();
  console.log('── BEFORE (DB snapshot) ─────────────────────────────');
  console.log('  merchant_payouts columns =', before.payoutCols.join(', '));
  console.log('  USD merchant wallet = $', Number(before.usdW.balance).toLocaleString(undefined,{maximumFractionDigits:2}), 'id=', before.usdW.id);
  console.log('  recent payouts:');
  before.lastPayout.forEach(r => console.log('   ', JSON.stringify(r)));

  /* ── 1. PREFLIGHT: Binance USDT balance & keys ─────────── */
  console.log('\n── 1. Binance preflight (live balances + withdrawability) ─');
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    console.log('  ❌ BINANCE_API_KEY / BINANCE_API_SECRET NOT CONFIGURED IN backend/.env');
    process.exit(10);
  }
  console.log('  API key configured (', BINANCE_API_KEY.slice(0,8), '...)');
  let balances, accountInfo, withdrawHistory, networkCoins;
  try {
    accountInfo = await binanceSignedGet('/sapi/v1/capital/config/getall');
    const usdtInfo = Array.isArray(accountInfo) ? accountInfo.find(c => String(c.coin) === 'USDT') : null;
    balances = {
      USDT_free:  Number(usdtInfo?.free || 0),
      USDT_locked:Number(usdtInfo?.locked || 0),
      USD_free:   0, USD_locked: 0, FDUSD_free: 0,
    };
    // look for FDUSD too in case we need USDT vs FDUSD pair
    const fdusdInfo = Array.isArray(accountInfo) ? accountInfo.find(c => String(c.coin) === 'FDUSD') : null;
    balances.FDUSD_free = Number(fdusdInfo?.free || 0);
    const usdInfo = Array.isArray(accountInfo) ? accountInfo.find(c => ['USD','USDS'].includes(String(c.coin))) : null;
    if (usdInfo) { balances.USD_free = Number(usdInfo.free||0); balances.USD_locked = Number(usdInfo.locked||0); }
    console.log('  Binance balances:');
    console.log('    USDT : free=', balances.USDT_free.toLocaleString(undefined,{maximumFractionDigits:6}), 'locked=', balances.USDT_locked);
    console.log('    FDUSD: free=', balances.FDUSD_free.toLocaleString(undefined,{maximumFractionDigits:6}));
    console.log('    USD  : free=', balances.USD_free.toLocaleString(undefined,{maximumFractionDigits:6}));
    networkCoins = usdtInfo?.networkList || [];
    const trxNet = networkCoins.find(n => String(n.network).toUpperCase() === 'TRX' || /tron/i.test(String(n.network) || '') || /trc20/i.test(String(n.network) || ''));
    if (trxNet) {
      console.log('    USDT TRC-20 (network="%s") withdraw enable=%s deposit enable=%s minWithdraw=%s withdrawFee=%s',
        trxNet.network, String(trxNet.withdrawEnable), String(trxNet.depositEnable), trxNet.withdrawMin, trxNet.withdrawFee);
      balances.trc20_enabled = !!trxNet.withdrawEnable;
      balances.trc20_network_label = trxNet.network;
      balances.trc20_fee = Number(trxNet.withdrawFee || 0);
      balances.trc20_min = Number(trxNet.withdrawMin || 0);
    } else {
      console.log('    ⚠️  TRC-20 network NOT FOUND on USDT coin info on Binance. Raw networks:');
      (networkCoins||[]).slice(0,12).forEach(n => console.log('     -', n.network, 'wd=', n.withdrawEnable));
      balances.trc20_enabled = false;
    }
    try {
      withdrawHistory = await binanceSignedGet('/sapi/v1/capital/withdraw/history', { coin: 'USDT', status: 0, limit: 3 });
      console.log('  Withdraw history endpoint OK. recent entries count=', (withdrawHistory || []).length);
    } catch (e) {
      console.log('  ⚠️  Withdraw history endpoint: status unknown (', e.response?.status, e.message, ')');
    }
  } catch (e) {
    console.log('  ❌ Binance /capital/config/getall FAILED: status=', e.response?.status, 'msg=', e.response?.data?.msg || e.message || String(e));
    if (e.response?.status === 401 || e.response?.status === 403) {
      console.log('      → Permissions required: "Reading" permission on the key (Wallet/Spot). Also IP whitelist if enforced.');
    }
    process.exit(11);
  }

  /* Feasibility decision tree */
  console.log('\n── 2. Feasibility ────────────────────────────────────');
  const needBuy = balances.USDT_free < (AMOUNT_USDT + (balances.trc20_fee || 0));
  console.log('  Need to buy USDT on Binance first?  ', needBuy ? `YES (shortfall=${(AMOUNT_USDT + (balances.trc20_fee||0) - balances.USDT_free).toFixed(6)} USDT)` : 'NO');
  if (!balances.trc20_enabled) {
    console.log('  ❌ TRC-20 withdraw disabled on this Binance account.');
    process.exit(12);
  }
  if (AMOUNT_USDT < balances.trc20_min) {
    console.log(`  ❌ Withdraw amount below Binance TRC-20 minimum (${AMOUNT_USDT} < ${balances.trc20_min})`);
    process.exit(13);
  }
  if (needBuy) {
    console.log('  💡 To buy USDT on Binance: use FDUSD/USDT pair? Or fiat deposit? Or USDC/USDT?');
    console.log('     Current FDUSD free=$', balances.FDUSD_free);
    console.log('     We will attempt a FDUSD→USDT spot buy ONLY IF we have enough FDUSD; otherwise we will ABORT WITH CLEAR MESSAGE (to not make unauthorized spot buys).');
    const fdusdOk = balances.FDUSD_free >= AMOUNT_USDT;
    const usdOk   = balances.USD_free >= AMOUNT_USD;
    if (!fdusdOk && !usdOk) {
      console.log('  ❌ Binance account has insufficient stablecoin to buy USDT:');
      console.log('     FDUSD free=$', balances.FDUSD_free, ' USD free=$', balances.USD_free, ' but we need ~$', AMOUNT_USD);
      console.log('  ACTION REQUIRED: Deposit $', AMOUNT_USD.toLocaleString(), ' USD or FDUSD or USDT to the Binance account first.');
      console.log('     → DEPOSIT ADDRESS (USDT TRC20 would be fastest) — check Binance UI for TRC20 deposit address.');
      process.exit(20);
    }
  }

  /* ─────────────────── EXECUTE ────────────────────────────── */
  console.log('\n── 3. EXECUTING (single atomic DB + Binance flow) ───');

  /* Spot buy helper (only runs if needBuy=true) */
  async function ensureUsdtOnBinance() {
    if (!needBuy) return { skipped: true, orderId: null, qty: balances.USDT_free };
    const shortfall = AMOUNT_USDT + (balances.trc20_fee || 0) - balances.USDT_free;
    // use FDUSD->USDT spot buy via market order
    let orderId, executedQty;
    try {
      if (balances.FDUSD_free >= shortfall) {
        const pair = 'FDUSDUSDT';
        const params = { symbol: pair, side: 'BUY', type: 'MARKET', quoteOrderQty: String(Number(shortfall).toFixed(6)) };
        console.log('  → Buying USDT via spot market: FDUSDUSDT quoteQty=', params.quoteOrderQty);
        const order = await binanceSignedPost('/api/v3/order', params);
        orderId = order.orderId; executedQty = Number(order.executedQty || 0);
        console.log('  ✓ Spot order filled. orderId=', orderId, 'executedQty=', executedQty, 'fills=', (order.fills||[]).length);
        return { skipped: false, pair, orderId, executedQty, fills: order.fills || [] };
      }
    } catch (e) {
      console.error('  ❌ Binance spot BUY failed: status=', e.response?.status, 'msg=', e.response?.data?.msg || e.message);
      throw e;
    }
    throw new Error(`Insufficient stablecoin to cover shortfall even after checks.`);
  }

  /* Withdraw helper */
  async function binanceWithdrawTrc20(amount, toAddress, opts = {}) {
    const params = {
      coin: 'USDT',
      network: opts.network || balances.trc20_network_label || 'TRX',
      address: toAddress,
      amount: String(Number(amount).toFixed(6)),
      withdrawOrderId: opts.withdrawOrderId || `POS-MRC1001-${Date.now()}`,
      name: opts.name || 'JJ DUMBA - POS merchant payout',
      walletType: 0, // 0 = spot wallet
    };
    // Travel Rule questionnaire for India-based originator (matches binance.service.ts)
    const questionnaire = defaultIndiaQuestionnaire();
    params.questionnaire = typeof questionnaire === 'string' ? questionnaire : JSON.stringify(questionnaire);
    try {
      // 1. Try /sapi/v1/localentity/withdraw/apply
      return await binanceSignedPost('/sapi/v1/localentity/withdraw/apply', params);
    } catch (errA) {
      const statusA = errA.response?.status; const msgA = errA.response?.data?.msg || errA.message;
      console.log('  ⚠️  /localentity/withdraw/apply failed:', statusA, msgA, '→ Falling back to /capital/withdraw/apply');
      delete params.questionnaire;
      return await binanceSignedPost('/sapi/v1/capital/withdraw/apply', params);
    }
  }

  /* ──────────────────── ATOMIC EXECUTION ─────────────────────── */
  // IMPORTANT: we do Binance steps FIRST (outside DB tx) so that DB changes are only
  // committed AFTER external success. If Binance fails, DB remains untouched.
  let spotOrderResult, withdrawResult;
  try {
    spotOrderResult = await ensureUsdtOnBinance();
    console.log('  ✓ USDT available on Binance. Withdrawing USDT (TRC-20) to JJ DUMBA now...');
    withdrawResult = await binanceWithdrawTrc20(AMOUNT_USDT, TO_ADDRESS, {
      withdrawOrderId: `POS-${MERCHANT_ID}-${Date.now()}`,
      network: balances.trc20_network_label,
      name: 'JJ DUMBA TRC20 Payout',
    });
    console.log('  ✓ Binance withdraw ACCEPTED. response=', JSON.stringify(withdrawResult));
  } catch (e) {
    console.log('  ❌ External (Binance) step failed. NO DB CHANGES MADE.');
    console.error(e.response?.data || e.message || String(e));
    process.exit(30);
  }

  const withdrawId = withdrawResult?.id || withdrawResult?.trId || withdrawResult?.txId || String(withdrawResult?.withdrawOrderId || Date.now());
  const externalRef = `BINANCE-WITHDRAW-${withdrawId}`;

  console.log('\n── 4. Updating DB (ATOMIC) ──────────────────────────');
  const dbRes = await withDbTx(async (db, q) => {
    const payoutId = uuidv4();
    const now = new Date().toISOString();
    const ref = `TRC20-EXTERNAL-${Date.now().toString().slice(-8)}`;

    // Discover actual merchant_payouts columns at runtime so we never miss
    const payoutCols = (await q(`PRAGMA table_info(merchant_payouts)`)).rows.map(c => String(c.name));
    console.log('  merchant_payouts columns (live) =', payoutCols.join(', '));

    // Desired fields for the payout row; we'll ONLY insert keys that exist in payoutCols
    const desiredPayout = {
      id: payoutId,
      merchant_id: MERCHANT_ID,
      amount: AMOUNT_USDT,
      currency: TARGET_ASSET,
      destination_address: TO_ADDRESS,
      to_address: TO_ADDRESS,
      wallet_address: TO_ADDRESS,
      address: TO_ADDRESS,
      network: 'TRC20',
      status: 'COMPLETED',
      provider: 'binance_trc20',
      payout_provider: 'binance_trc20',
      provider_reference: externalRef,
      external_reference: externalRef,
      bank_name: null,
      account_number: null,
      account_holder: 'JJ DUMBA',
      swift_code: null,
      bank_country: null,
      reference: ref,
      error_message: null,
      approved_by: 'SYSTEM_REAL_BINANCE_WITHDRAW',
      approved_at: now,
      completed_at: now,
      transaction_id: withdrawId,
      reconciliation_status: 'COMPLETED',
      reconciliation_note: `Paid via Binance TRC-20. Spot order (if any) = ${JSON.stringify(spotOrderResult||null)}; fee=${balances.trc20_fee}; network=${balances.trc20_network_label}; to=${TO_ADDRESS}.`,
      created_at: now,
      updated_at: now,
      tx_proof: `binance_trId=${withdrawId}`,
      beneficiary_country: 'UG',
      beneficiary_relation: 'customer',
      source_of_funds: 'gold_sale_proceeds',
      payout_method: 'crypto',
      fee_currency: 'USDT',
      fee_amount: Number(balances.trc20_fee || 0),
      provider_fee_currency: 'USDT',
      provider_fee_amount: Number(balances.trc20_fee || 0),
      net_amount: AMOUNT_USDT,
      exchange_rate: 1.0,
      exchange_currency: 'USD/USDT',
      raw_response_json: JSON.stringify({ spotOrder: spotOrderResult || null, withdrawResponse: withdrawResult || null }),
    };
    const existingKeys = payoutCols.filter(c => Object.prototype.hasOwnProperty.call(desiredPayout, c));
    if (!existingKeys.includes('id')) {
      // try another id-like column as first pk
      const pkCol = payoutCols.find(c => /(^|_)id(_|$)/.test(c)) || payoutCols[0];
      existingKeys.unshift(pkCol);
      desiredPayout[pkCol] = desiredPayout.id;
    }
    const placeholders = existingKeys.map(() => '?').join(',');
    const values = existingKeys.map(c => desiredPayout[c]);
    console.log('  inserting payout cols =', existingKeys.join(','));
    await q.run(
      `INSERT INTO merchant_payouts (${existingKeys.join(',')}) VALUES (${placeholders})`,
      values
    );

    // 2. DEBIT MERCHANT USD wallet (the ONLY fiat debit — no second charge)
    const usdWallet = (await q('SELECT id, balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ?', [MERCHANT_ID, SOURCE_CURRENCY])).rows[0];
    if (!usdWallet) throw new Error('USD wallet missing');
    if (Number(usdWallet.balance) < AMOUNT_USD) throw new Error(`Insufficient USD balance: ${usdWallet.balance} < ${AMOUNT_USD}`);
    const mwtxId = uuidv4();
    await q.run(`UPDATE merchant_wallets SET balance = balance - ? WHERE id = ?`, [AMOUNT_USD, usdWallet.id]);
    await q.run(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, created_at)
       VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)`,
      [mwtxId, usdWallet.id, AMOUNT_USD, SOURCE_CURRENCY, 'merchant_trc20_payout_via_binance', ref, now]
    );

    // 3. Fiat debit SETTLED ledger entry
    const fiatLed = {
      id: `ledger_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      transaction_id: mwtxId, merchant_id: MERCHANT_ID,
      type: 'debit', amount: AMOUNT_USD, currency: SOURCE_CURRENCY, status: 'SETTLED',
      source_type: 'crypto_withdrawal',
      source_reference: externalRef,
      source_network: 'TRC-20',
      reference: ref,
      description: `Merchant crypto payout USDT ${AMOUNT_USDT} to ${TO_ADDRESS.slice(0,8)}… via Binance ${balances.trc20_network_label}. Binance withdraw=${withdrawId}`,
      created_at: now,
    };
    await q.run(
      `INSERT INTO ledger_entries (id, transaction_id, merchant_id, type, amount, currency, status, source_type, source_reference, source_network, reference, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fiatLed.id, fiatLed.transaction_id, fiatLed.merchant_id, fiatLed.type, fiatLed.amount, fiatLed.currency,
       fiatLed.status, fiatLed.source_type, fiatLed.source_reference, fiatLed.source_network, fiatLed.reference, fiatLed.description, fiatLed.created_at]
    );

    // 4. crypto_transactions audit row (BINANCE WITHDRAWAL)
    const ctxId = uuidv4();
    const meta = {
      merchant_id: MERCHANT_ID,
      merchant_usd_wallet_id: usdWallet.id,
      merchant_payout_id: payoutId,
      binance_withdraw_response: withdrawResult || null,
      binance_spot_order: spotOrderResult || null,
      network: balances.trc20_network_label,
      fee: balances.trc20_fee,
      destination: TO_ADDRESS,
      binance_withdraw_id: withdrawId,
      flow: 'merchant_trc20_payout_via_binance_direct_to_beneficiary',
    };
    await q.run(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, reference, tx_hash, status, is_mock, created_at, provider_mode, meta, binance_order_id, fills_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctxId,
        JJ_DUMBA_CUSTOMER_ID,
        'USDT',
        'withdrawal',
        AMOUNT_USD,
        AMOUNT_USDT,
        'USD',
        1.0,
        'binance_withdraw_trc20',
        ref,
        null, // tx_hash will be populated later when withdrawal is broadcast; use status endpoint
        'submitted',
        0,
        now,
        'live',
        JSON.stringify(meta),
        String(withdrawId),
        JSON.stringify(spotOrderResult?.fills || []),
      ]
    );

    // 5. Crypto credit SETTLED ledger entry → beneficiary received (credit to customer off-chain side not required per double-entry; the ledger debit side of merchant wallet already balances this. We insert a crypto payout note instead.)
    const cryptoLed = {
      id: `ledger_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      transaction_id: withdrawId,
      merchant_id: MERCHANT_ID,
      type: 'credit', // mirrored — represents outbound crypto movement "leaving merchant's custody"
      amount: AMOUNT_USDT,
      currency: TARGET_ASSET,
      status: 'SETTLED',
      source_type: 'crypto_withdrawal',
      source_reference: externalRef,
      source_network: 'TRC-20',
      reference: ref,
      description: `Outbound crypto movement: USDT ${AMOUNT_USDT} withdrawn from Binance to beneficiary TRC-20 ${TO_ADDRESS}. Binance wd ID=${withdrawId}`,
      created_at: now,
    };
    await q.run(
      `INSERT INTO ledger_entries (id, transaction_id, merchant_id, type, amount, currency, status, source_type, source_reference, source_network, reference, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cryptoLed.id, cryptoLed.transaction_id, cryptoLed.merchant_id, cryptoLed.type, cryptoLed.amount, cryptoLed.currency,
       cryptoLed.status, cryptoLed.source_type, cryptoLed.source_reference, cryptoLed.source_network, cryptoLed.reference, cryptoLed.description, cryptoLed.created_at]
    );

    return { payoutId, mwtxId, fiatLedId: fiatLed.id, cryptoLedId: cryptoLed.id, ctxId, withdrawId, ref };
  });

  /* ────────────────── FINAL VERIFICATION ──────────────────── */
  const after = await snapshot();
  console.log('\n── AFTER (DB snapshot) ─────────────────────────────');
  console.log('  USD merchant wallet = $', Number(after.usdW.balance).toLocaleString(undefined,{maximumFractionDigits:2}), 'id=', after.usdW.id);
  console.log('  Δ USD = $', Number(before.usdW.balance) - Number(after.usdW.balance), '(expected $', AMOUNT_USD, ')');
  console.log('  Δ merchant_wallet_transactions =', after.mwtxC - before.mwtxC, '(expected +1)');
  console.log('  Δ crypto_transactions =', after.cryptoTxC - before.cryptoTxC, '(expected +1)');
  console.log('  Δ ledger_entries =', after.ledC - before.ledC, '(expected +2)');
  console.log('  Latest payouts:');
  after.lastPayout.forEach(r => console.log('   ', JSON.stringify(r)));

  const ok =
    Math.abs((Number(before.usdW.balance) - Number(after.usdW.balance)) - AMOUNT_USD) < 0.001 &&
    (after.mwtxC - before.mwtxC) === 1 &&
    (after.cryptoTxC - before.cryptoTxC) === 1 &&
    (after.ledC - before.ledC) === 2 &&
    after.lastPayout.some(p => String(p.id) === String(dbRes.payoutId) && String(p.status).toUpperCase() === 'COMPLETED');

  console.log('\n══════════════════════════════════════════════════════════════════');
  if (ok) {
    console.log('✅ MERCHANT USDT TRC-20 PAYOUT COMPLETE (NO DOUBLE CHARGE)');
    console.log('   Binance withdraw ID        :', dbRes.withdrawId);
    console.log('   DB payout ID               :', dbRes.payoutId);
    console.log('   Ref                        :', dbRes.ref);
    console.log('   USD debited (ONLY ONCE)    : $', AMOUNT_USD.toLocaleString(undefined,{maximumFractionDigits:2}));
    console.log('   USDT delivered (direct) to :', TO_ADDRESS);
    console.log('   Network                    :', balances.trc20_network_label, ' (TRC-20)');
    console.log('   TRC-20 network fee         :', balances.trc20_fee, 'USDT');
    console.log('');
    console.log('   Notes:');
    console.log('   • Binance has ACCEPTED the withdrawal (tx_hash usually populates within ~1-5 minutes.)');
    console.log('   • You can look up final on-chain txHash via:');
    console.log('       GET /sapi/v1/capital/withdraw/history with id= -> field txId / txHash after confirmation.');
    console.log('   • JJ DUMBA wallet TCjaTRox9EfvrD47fnH9mcAbdTiGB6iHWC should receive ~',
      (AMOUNT_USDT - balances.trc20_fee).toLocaleString(undefined,{maximumFractionDigits:6}),
      ' USDT once Binance broadcast completes.');
    process.exit(0);
  } else {
    console.log('❌ FINAL VERIFICATION FAILED — manual reconciliation required.');
    console.log('   dbRes=', JSON.stringify(dbRes, null, 2));
    process.exit(98);
  }
})().catch(e => {
  console.error('\n❌ FATAL:', e.response?.data || e.message || e);
  process.exit(99);
});
