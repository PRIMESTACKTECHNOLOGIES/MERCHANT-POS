const axios = require('axios');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const TRON_WALLET = 'TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP';
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

(async () => {
  console.log('═'.repeat(100));
  console.log('🔴 HONEST LIVE RAIL AUDIT — CAN THIS SOFTWARE MOVE REAL MONEY RIGHT NOW?');
  console.log('═'.repeat(100));
  console.log(`System date : ${new Date().toISOString()}`);
  console.log(`Tron hot wallet: ${TRON_WALLET}\n`);

  // 1. TRON BALANCE LIVE
  console.log('① TRON HOT WALLET (TRC-20 — LIVE TronGrid):');
  try {
    const [trxResp, usdtResp] = await Promise.all([
      axios.get(`https://api.trongrid.io/v1/accounts/${TRON_WALLET}`, { timeout: 9000 }),
      axios.get(`https://apilist.tronscanapi.com/api/account/tokens?address=${TRON_WALLET}&start=0&limit=20&hidden=0&show=0&sortType=0&sortBy=0`, { timeout: 9000 }).catch(()=>({data:{data:[]}}))
    ]);
    const acc = trxResp.data?.data?.[0];
    if (acc) {
      const trx = (Number(acc.balance||0) / 1e6);
      console.log(`   TRX balance  : ${trx.toFixed(6)} TRX   ${trx < 20 ? '⚠️ BELOW 20 TRX MIN — GAS INSUFFICIENT FOR LARGE WITHDRAWS' : '✅ >= 20 TRX gas OK'}`);
      let usdt = 0;
      try {
        const trc10 = acc.trc20 || [];
        for (const row of trc10) {
          for (const [contract, bal] of Object.entries(row)) {
            if (contract === USDT_TRC20_CONTRACT) usdt += Number(bal) / 1e6;
          }
        }
      } catch(_) {}
      if (usdt === 0 && usdtResp.data?.data?.length) {
        const row = usdtResp.data.data.find(r => String(r.contract||'').toLowerCase()===USDT_TRC20_CONTRACT.toLowerCase() || /tether/i.test(r.tokenName||'') || /USDT/i.test(r.tokenAbbr||''));
        if (row) usdt = Number(row.balance||0)/Math.pow(10,Number(row.tokenDecimal||6));
      }
      console.log(`   USDT (TRC-20) : $${usdt.toFixed(6)} USDT   ${usdt >= 50000 ? '✅ HAS $50k+ LIQUIDITY — CAN SEND DIRECT USDT TRC20 TO JUKRUTI NOW' : usdt>0?'⚠️ Has some USDT but NOT ENOUGH for $50k payout':'❌ ZERO USDT — NO DIRECT CRYPTO PAYOUT POSSIBLE'}`);
    } else {
      console.log('   ❓ TronGrid returned empty for this address');
    }
  } catch (e) {
    console.log(`   TronGrid FAIL: ${e.message}`);
  }

  // 2. WISE LIVE?
  const env = fs.readFileSync(path.join(__dirname,'.env'),'utf8');
  const wiseProv = /^BANK_PAYOUT_PROVIDER\s*=\s*(\S+)/m.exec(env);
  const wiseKey  = /^#?\s*WISE_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(env);
  const wiseProf = /^#?\s*WISE_PROFILE_ID\s*=\s*"?([^"\n]+)"?/m.exec(env);
  const wiseURL  = /^#?\s*WISE_API_URL\s*=\s*"?([^"\n]+)"?/m.exec(env);
  console.log(`\n② WISE API (configured?):`);
  const provider = (wiseProv?.[1]||'').replace(/['"]/g,'').toLowerCase();
  const key = (wiseKey?.[1]||'').trim();
  const prof = (wiseProf?.[1]||'').trim();
  const url  = (wiseURL?.[1]||'').trim();
  const keyReal = key && !/your_wise_api|place|example|demo|here/i.test(key);
  const profReal = prof && !/your_wise_numeric|place|example|demo|here/i.test(prof);
  console.log(`   BANK_PAYOUT_PROVIDER = ${provider || '(unset)'}`);
  console.log(`   WISE_API_URL         = ${url || '(unset)'}`);
  console.log(`   WISE_API_KEY         = ${key ? (keyReal ? '✅ PRESENT AND REAL (starts: '+key.slice(0,8)+'...)' : '❌ placeholder/demo only') : '❌ NOT SET / COMMENTED'}`);
  console.log(`   WISE_PROFILE_ID      = ${prof ? (profReal ? '✅ REAL profileId: '+prof : '❌ placeholder') : '❌ NOT SET'}`);
  if (provider !== 'wise') console.log(`   ⚠️ PROVIDER != wise → Wise API will NEVER be called, even if key is set. .env line 74 = "${provider}"`);
  if (!keyReal || !profReal || provider !== 'wise') {
    console.log(`   ❌ WISE LIVE SUBMISSION NOT POSSIBLE WITH CURRENT CONFIG: ${[
      provider !== 'wise' && 'provider != wise',
      !keyReal && 'WISE_API_KEY not a real token',
      !profReal && 'WISE_PROFILE_ID not set real'
    ].filter(Boolean).join('; ')}.`);
  } else {
    console.log(`   ✅ WISE configured — will attempt live diagnostics next`);
    try {
      const diag = await axios.get(`${url.replace(/\/$/,'')}/v1/profiles`, { headers: { Authorization: `Bearer ${key}` }, timeout: 9000 });
      console.log(`   GET /v1/profiles OK → ${diag.data?.length||0} profiles. IDs: ${(diag.data||[]).map(p=>p.id).join(', ') || '—'}`);
      const bal = await axios.get(`${url.replace(/\/$/,'')}/v4/profiles/${profReal?prof: (diag.data?.[0]?.id||'')}/balances?types=STANDARD`, { headers: { Authorization: `Bearer ${key}` }, timeout: 9000 });
      const balData = Array.isArray(bal.data)?bal.data:[];
      console.log(`   Balances: ${balData.length?balData.map(b=>`${b.currency} ${Number(b.amount?.value||0).toFixed(2)}`).join('; '):'(empty)'}`);
      const usdBal = balData.find(b=>b.currency==='USD')?.amount?.value || 0;
      console.log(`   USD balance for payout: ${Number(usdBal).toFixed(2)}  ${usdBal>=50000 ? '✅ CAN FUND $50k WISE PAYOUT NOW' : '⚠️ WISE USD balance INSUFFICIENT — top up Wise account first'}`);
    } catch (e) {
      console.log(`   ❌ Wise API CALL FAILED: ${e.response?.status} ${e.response?.statusText} — ${JSON.stringify(e.response?.data||{}).slice(0,200)}`);
    }
  }

  // 3. TRANSAK OFF-RAMP?
  const tKey = /^TRANSAK_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(env);
  const tReal = tKey && !/your_transak|place|example|demo|here/i.test(tKey[1]);
  console.log(`\n③ TRANSAK OFF-RAMP (crypto → fiat bank):`);
  console.log(`   TRANSAK_API_KEY = ${tReal ? '✅ '+tKey[1].slice(0,12)+'…' : '❌ placeholder/not set'}`);
  console.log(`   Note: Transak is configured as FIAT → CRYPTO ON-RAMP in .env docs (line 139). Off-ramp (withdraw crypto → ABSA bank) requires separate Transak API integration (withdraw endpoint).`);
  try {
    const currencies = await axios.get('https://api-gateway.transak.com/v2/currencies', { timeout: 8000 }).catch(()=>({data:{}}));
    console.log(`   Transak public /v2/currencies → ${currencies.status===200?'OK reachable':'down'}`);
  } catch (e) { console.log(`   Transak unreachable: ${e.message}`); }

  // 4. ABSA RTGS / SWIFT Alliance API — DOES THIS SYSTEM HAVE A REAL ONE?
  console.log(`\n④ ABSA / SWIFT ALLIANCE DIRECT (ABSAZAJJ direct API):`);
  const swiftUrl = /SWIFT|ABSA|RTGS|Alliance/.test(env);
  console.log(`   .env mentions SWIFT/ABSA/RTGS/Alliance tokens? ${swiftUrl?'YES':'NO — no ABSAZAJJ credentials, no SWIFT Alliance Lite2 API key, no BankservAfrica direct RTGS subscription.'}`);
  console.log(`   👉 CANNOT SEND REAL SWIFT MT103 OR REAL ZA RTGS FROM THIS SOFTWARE. NOT CONNECTED TO ANY BANK NETWORK INTERFACE.`);

  // 5. SWIFT GPI TRACE for user's UETR
  const targetUetr = '712436CE-E566-D0F4-7F76-AD8E8B92904F';
  console.log(`\n⑤ SWIFT gpi LIVE TRACE for UETR ${targetUetr}:`);
  console.log(`   SWIFT gpi Tracker requires one of: (a) SWIFT gpi Observer token, (b) sending/receiving bank gpi tracker portal (ABSA), or (c) SWIFT API KlikAccess subscription.`);
  console.log(`   This system has NONE of the above. However, the public SWIFT gpi confirmations API / web endpoints return NO DATA unless a real MT103 with SVCO + UETR was actually received by SWIFTNet.`);
  console.log(`   Attempt public lookup (best-effort non-credentialed):`);
  try {
    // Best-effort: attempt public swift.com ref + a couple SWIFT gpi public endpoints (most require auth). Will error, but honesty requires trying.
    const lookup = await axios.get(`https://swiftgpi.com/tracker/${targetUetr}`, { timeout: 6000 }).catch(()=>({status:0,data:''}));
    console.log(`   public swiftgpi.com/${targetUetr.slice(0,8)} → HTTP ${lookup.status||'FAIL'} (expected 404/not-found because no MT103 was sent)`);
  } catch(e) { console.log(`   (couldn't reach) → ${e.message}`); }
  console.log(`   👉 EXPECTED RESULT for this UETR right now: NOT FOUND / NO EVENTS.`);
  console.log(`      Because UETR 712436CE was generated LOCALLY by this system and embedded in a LOCAL .txt file.`);
  console.log(`      A UETR only enters the SWIFT gpi global tracker AFTER a real SWIFT participant (ABSAZAJJ, JPM, etc.)`);
  console.log(`      transmits a real FIN 103 message with :121:${targetUetr} over SWIFTNet or SWIFTNet Lite2 with gpi (SVCO service level).`);
  console.log(`      THAT NEVER HAPPENED.`);

  console.log(`\n${'═'.repeat(100)}`);
  console.log(`🎯 FINAL TRUTH TABLE — CAN WE MOVE REAL $50,000 TO ABSA #4110362532 RIGHT NOW?`);
  console.log(`   Rail                     Software possible?   Configured correctly?   HAS $50k LIQUIDITY?   === SENDABLE NOW?`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
