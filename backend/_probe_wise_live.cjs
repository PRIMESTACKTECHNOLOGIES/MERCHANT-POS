require('dotenv').config();
const axios = require('axios');

const baseUrl = process.env.WISE_API_URL?.trim() || 'https://api.transferwise.com';
const apiKey = process.env.WISE_API_KEY?.trim() || process.env.BANK_PAYOUT_API_KEY?.trim();
const profileId = process.env.WISE_PROFILE_ID?.trim();

const H = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
};

const GET = (u, t=10) => axios.get(u, { headers: H, timeout: t*1000 });

(async () => {
  console.log('═══ WISE LIVE PROVIDER CHECK ═══');
  console.log(`Provider  : BANK_PAYOUT_PROVIDER = ${process.env.BANK_PAYOUT_PROVIDER}`);
  console.log(`API URL   : ${baseUrl}`);
  console.log(`API Key   : ${apiKey ? `${apiKey.slice(0,8)}… (len=${apiKey.length})` : '❌ MISSING'}`);
  console.log(`Profile ID: ${profileId || '(auto-resolve from API)'}\n`);

  if (!apiKey) {
    console.log('❌ WISE_API_KEY not set — payout impossible.');
    process.exit(1);
  }

  // 1. Profiles
  let resolvedPid = profileId;
  try {
    const r = await GET(`${baseUrl}/v1/profiles`);
    const list = Array.isArray(r.data)?r.data:[];
    console.log(`✅ GET /v1/profiles → ${list.length} profile(s)`);
    list.forEach(p => console.log(`   • id=${p.id}  type=${p.type}  name=${p.details?.firstName||''}${p.details?.name||p.details?.companyName||''}`));
    if (!resolvedPid) {
      const b = list.find(p=>p.type==='business')||list[0];
      resolvedPid = b?String(b.id):null;
      if (resolvedPid) console.log(`   → resolved profileId=${resolvedPid} (auto)`);
    }
  } catch (e) {
    console.log('❌ GET /v1/profiles FAIL:', e.response?.status, e.response?.data?.errors?.[0]?.message || e.message);
    process.exit(1);
  }
  if (!resolvedPid) { console.log('❌ No profile ID resolved.'); process.exit(1); }

  // 2. Profile details
  try {
    const r = await GET(`${baseUrl}/v1/profiles/${resolvedPid}`);
    const p = r.data;
    console.log(`\n✅ Profile ${p.id}: type=${p.type}  details=`);
    console.log('   ', JSON.stringify(p.details || p));
  } catch(e) {
    console.log(`\n⚠️  Profile details fail:`, e.response?.data?.errors?.[0]?.message || e.message);
  }

  // 3. Balances (v4, v3, fallback)
  let balances = [];
  const EPs = [
    `${baseUrl}/v4/profiles/${resolvedPid}/balances?types=STANDARD,SAVINGS`,
    `${baseUrl}/v3/profiles/${resolvedPid}/balances`,
    `${baseUrl}/borderless-accounts?profileId=${resolvedPid}`,
  ];
  for (const ep of EPs) {
    try {
      const r = await GET(ep);
      const list = Array.isArray(r.data)?r.data:(r.data?.balances||r.data?.accounts||[]);
      if (list.length) {
        balances = list.map(b=>({
          currency: b.currency||b.balanceCurrency||'',
          value: Number(b.amount?.value ?? b.balance?.amount ?? b.primaryValue ?? 0),
          reserved: Number(b.reservedAmount?.value||0),
        })).filter(x=>x.currency);
        console.log(`\n✅ Balances via ${ep.split('/')[3] || ep.split('/')[2]} → ${balances.length} balance(s):`);
        balances.forEach(b => {
          const headroom = (b.value / 1.005);
          console.log(`   • ${b.currency.padEnd(4)}  AVAILABLE=$${b.value.toFixed(2)}  (MAX payout ≈ $${headroom.toFixed(2)} after 0.5% fee buffer)`);
          if (b.reserved) console.log(`     (reserved: $${b.reserved.toFixed(2)})`);
        });
        break;
      }
    } catch(e) { /* try next */ }
  }
  if (balances.length === 0) {
    console.log('\n⚠️  Wise returned ZERO balances. Either:');
    console.log('   1. Profile has no funded balances — open Wise → Balances → Add money.');
    console.log('   2. API key lacks "balances:read" scope → reissue token at wise.com/settings/api-tokens.');
  }

  // 4. USD payout capability for merchant wallet amount
  const merchantUSD = 3649;
  const usdB = balances.find(b=>b.currency==='USD');
  const needed = merchantUSD * 1.005;
  console.log(`\n─── PREFLIGHT: Merchant wants to payout $${merchantUSD} USD (MRC-1001 current USD wallet) ───`);
  console.log(`   Merchant wallet USD      : $${merchantUSD.toFixed(2)}`);
  console.log(`   Required Wise USD (×1.005): $${needed.toFixed(2)}  (payout amount + 0.5% fee buffer)`);
  if (!usdB) {
    console.log('   ❌ Wise USD balance NOT FOUND. Fund Wise USD balance → https://wise.com');
  } else {
    console.log(`   Wise USD available       : $${usdB.value.toFixed(2)}`);
    if (usdB.value >= needed) {
      console.log(`   ✅ SUFFICIENT — Wise balance covers payout + fee headroom.`);
    } else {
      const short = needed - usdB.value;
      console.log(`   ❌ INSUFFICIENT — short by $${short.toFixed(2)} USD.`);
      console.log(`      Top up Wise USD balance by at least $${short.toFixed(2)} to enable this payout size.`);
    }
  }

  // 5. EUR / GBP / AED capability
  for (const cur of ['EUR','GBP','AED']) {
    const x = balances.find(b=>b.currency===cur);
    if (x) console.log(`   💡 Wise ${cur} balance available: $${x.value.toFixed(2)} — can do same-currency payout if destination bank supports ${cur}.`);
  }

  process.exit(0);
})().catch(e=>{
  console.error('\n💥 UNHANDLED ERROR:', e.message);
  if (e.response) console.error('  HTTP', e.response.status, JSON.stringify(e.response.data).slice(0,300));
  process.exit(1);
});
