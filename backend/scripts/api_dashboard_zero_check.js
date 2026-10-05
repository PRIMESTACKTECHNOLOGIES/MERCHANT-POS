// End-to-end API dashboard check: login → call all UI dashboard endpoints, print what the operator sees on screen.
const BASE = "http://127.0.0.1:7000";
const U = "admin";
const P = "admin123";

function fmt$(n) { return `$${(Number(n)||0).toFixed(2)}`; }

(async () => {
  let token = null;
  console.log("Step1: POST /auth/login admin/admin123");
  try {
    const res = await fetch(BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: U, password: P })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(j)}`);
    token = j.token;
    console.log(`  OK. token=${token ? token.substring(0,16)+"..." : "null"}`);
  } catch(e) { console.error("LOGIN FAIL", e.message); process.exit(1); }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Step 2 - Merchant dashboard
  console.log("\nStep2: GET /wallet/merchant/dashboard  (UI: Total Sales | Settlement Balance | Available)");
  try {
    const r = await fetch(BASE + "/wallet/merchant/dashboard", { headers });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    console.log("  RAW BODY =", JSON.stringify(j, null, 2).substring(0, 1500));

    // Extract common field names (dashboard implementations vary)
    const v = (keys, def=0) => {
      for (const k of keys) {
        if (!k) continue;
        const parts = k.split(".").filter(Boolean);
        let cur = j;
        for (const p of parts) { if (cur && typeof cur==='object' && p in cur) cur = cur[p]; else { cur = undefined; break; } }
        if (typeof cur === 'number' && !isNaN(cur)) return cur;
        if (typeof cur === 'string' && !isNaN(parseFloat(cur))) return parseFloat(cur);
      }
      return def;
    };
    const totalSales     = v(["totalSales","salesTotal","overview.totalSales","totals.totalSales","stats.sales"]);
    const settlementBal  = v(["settlementBalance","pendingSettlement","overview.settlementBalance","overview.pending"]);
    const availableBal   = v(["availableBalance","balance","available","overview.availableBalance","overview.balance"]);
    const txnCount       = v(["transactionCount","txns","txCount","overview.transactions"]);
    console.log("");
    console.log("  ┌─────────────────────────────────────────────────────────────────┐");
    console.log(`  │  OPERATOR DASHBOARD WILL SHOW:                                  │`);
    console.log(`  │   'Total Sales'             widget  = ${fmt$(totalSales).padStart(14)}  (should be $0.00)  │`);
    console.log(`  │   'Settlement Balance'      widget  = ${fmt$(settlementBal).padStart(14)}  (should be $0.00)  │`);
    console.log(`  │   'Merchant wallet Available' = ${fmt$(availableBal).padStart(14)}  (should be $0.00)  │`);
    console.log(`  │   Transaction count               = ${String(txnCount|0).padStart(6)}  (should be 0)       │`);
    console.log("  └─────────────────────────────────────────────────────────────────┘");
  } catch(e) { console.log("  FAILED:", e.message); }

  // Step 3 - Merchant wallet list
  console.log("\nStep3: GET /wallet/merchant  (Merchant wallet rows USD/AED)");
  try {
    const r = await fetch(BASE + "/wallet/merchant", { headers });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    const arr = Array.isArray(j) ? j : (j.wallets || j.data || [j]);
    let rows = 0;
    for (const w of arr) {
      console.log(`  ${w.merchant_id ? w.merchant_id.substring(0,12)+".." : ""}  cur=${w.currency || "?"}  BALANCE=${fmt$(w.balance)}`);
      rows++;
    }
    if (rows===0) console.log("  (empty array or response not in list form; RAW:", JSON.stringify(j).substring(0,300), ")");
  } catch(e) { console.log("  FAILED:", e.message); }

  // Step 4 - Merchant transactions list
  console.log("\nStep4: GET /wallet/merchant/transactions?limit=100  (count should be 0)");
  try {
    const r = await fetch(BASE + "/wallet/merchant/transactions?limit=100", { headers });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    const arr = Array.isArray(j) ? j : (j.transactions || j.items || j.data || []);
    console.log(`  txns count=${arr.length}  (should be 0 mock txns after cleanup)`);
    if (arr.length > 0) {
      console.log(`  !! TOP 3 txns (mock data NOT DELETED): `);
      arr.slice(0,3).forEach(t => console.log("    ", JSON.stringify(t).substring(0, 200)));
    }
  } catch(e) { console.log("  FAILED:", e.message); }

  // Step 5 - Merchant balances endpoint (WalletsPage.tsx uses this for the card widget)
  console.log("\nStep5: GET /wallet/merchant/settings/merchant/balances");
  try {
    const r = await fetch(BASE + "/wallet/merchant/settings/merchant/balances", { headers });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    console.log("  ", JSON.stringify(j).substring(0, 800));
  } catch(e) { console.log("  FAILED:", e.message); }

  // Step 6 - Crypto balances (API flowchart path)
  console.log("\nStep6: GET /api/merchant/MRC-1001/crypto/balances  (crypto widget)");
  try {
    const r = await fetch(BASE + "/api/merchant/MRC-1001/crypto/balances", { headers });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    console.log("  ", JSON.stringify(j).substring(0, 800));
  } catch(e) { console.log("  FAILED:", e.message); }

  // Step 7 - Settlements list
  console.log("\nStep7: GET /wallet/merchant/settlements?limit=100  (Settlement balance widget source)");
  try {
    const r = await fetch(BASE + "/wallet/merchant/settlements?limit=100", { headers });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    const arr = Array.isArray(j) ? j : (j.settlements || j.items || j.data || []);
    const unsettled = arr.filter(s => String(s.status||'').toLowerCase().includes('unsettled') || s.status==='PENDING');
    const pendingSum = unsettled.reduce((t,s)=>t + Number(s.amount||0), 0);
    console.log(`  count=${arr.length} rows, unsettled_sum=${fmt$(pendingSum)}  (both should be 0)`);
    if (arr.length>0) arr.slice(0,5).forEach(s=>console.log("    ", JSON.stringify(s).substring(0,200)));
  } catch(e) { console.log("  FAILED:", e.message); }

  console.log("\n✅ DONE. Operator dashboard widgets now show $0.00 Total Sales, $0.00 Settlement balance, $0.00 Available if all endpoints return zeros above.");
})().catch(e => { console.error(e); process.exit(1); });
