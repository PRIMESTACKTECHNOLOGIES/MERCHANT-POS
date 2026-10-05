const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(__dirname,'node_modules','sql.js','dist','sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  function q(sql,p=[]) {
    const s = db.prepare(sql); if (p.length) s.bind(p);
    const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
  }
  function num(v){return Number(v)||0;}
  console.log('=============== MERCHANT CRYPTO BALANCE AUDIT ===============\n');
  const mcb = q(`SELECT * FROM merchant_crypto_balances ORDER BY amount DESC`);
  console.log('  merchant_crypto_balances: cols=' + Object.keys(mcb[0]||{}).join(', '));
  let totalMcb = 0;
  mcb.forEach(m => {
    const amt = num(m.amount); totalMcb += amt;
    console.log(`    id=${m.id?.substring(0,14)} merch=${String(m.merchant_id).substring(0,12).padEnd(14)} asset=${String(m.asset).padEnd(6)} amount=${amt.toFixed(8)} meta=${String(m.meta||'').slice(0,60)} ts=${String(m.updated_at||m.created_at||'').substring(0,19)}`);
  });
  console.log(`\n  Total merchant_crypto_balances: ${totalMcb.toFixed(8)}`);

  // What SHOULD be in merchant crypto balances? According to wallets.service.ts:
  //  hot_wallet_sweep (crypto) writes: INSERT INTO merchant_crypto_balances … SET amount = amount + sweep_amt
  // Also: manual loads, merchant buys.
  // Verify against: crypto_transactions WHERE transaction_type IN (hot_wallet_sweep / merchant_buy / deposit_for_merchant …) etc. + + merchant_wallet_transactions + any merchant_crypto_withdrawals
  const ct = q(`SELECT * FROM crypto_transactions ORDER BY created_at ASC`);
  console.log('\n  crypto_transactions (ALL rows):');
  ct.forEach(t => {
    const typ = String(t.transaction_type||'').toLowerCase();
    const dir = ['buy','deposit','swap_in','credit','mint','receive','reward'].includes(typ)?'+':
                ['sell','withdraw','swap_out','debit','fee','send','burn','hot_wallet_sweep'].includes(typ)?'-':'=';
    console.log(`    ${String(t.created_at||'').substring(0,19).padEnd(19)} cust=${String(t.customer_id).substring(0,20).padEnd(22)} ${dir}${num(t.crypto_amount).toFixed(8).padStart(14)} ${t.crypto_coin||''}  txType=${t.transaction_type}  fiat=${num(t.fiat_amount).toFixed(2)}${t.fiat_currency||''}  src=${t.source||''}  ref=${String(t.reference||'').substring(0,18)}  provider=${t.provider_mode||''}  status=${t.status||''}`);
  });

  // cc6f0711 total sweeped crypto: 750 USDT (from step E of deepdive). This should appear in merchant_crypto_balances (credit merchant, since it's a sweep).  So merchant_crypto_balances ≥ 750.
  const sweeps = ct.filter(t => String(t.transaction_type).toLowerCase() === 'hot_wallet_sweep');
  const totalSwept = sweeps.reduce((s,t)=>s+num(t.crypto_amount),0);
  console.log(`\n  Total customer → merchant crypto sweeps (hot_wallet_sweep type): ${totalSwept.toFixed(8)}`);
  sweeps.forEach(t => console.log(`    ${String(t.created_at||'').substring(0,19)}  cust=${String(t.customer_id).substring(0,20)}  sweep=${num(t.crypto_amount).toFixed(8)} ${t.crypto_coin||''}`));

  const wdrw = q(`SELECT * FROM merchant_crypto_withdrawals`).map(w => ({...w, _amt: num(w.amount)||num(w.quantity)||0}));
  const totalWithdrawn = wdrw.reduce((s,w)=>s+w._amt,0);
  console.log(`\n  merchant_crypto_withdrawals total = ${totalWithdrawn.toFixed(8)}`);
  if (wdrw.length) wdrw.forEach(w => console.log(`    ${String(w.ts||w.created_at||'').substring(0,19)} merch=${String(w.merchant_id||'').substring(0,10)} asset=${w.asset||w.crypto_coin||w.currency||''} amt=${w._amt.toFixed(8)} status=${w.status||''}`));

  // Expected merchant balance (minimum proven): Σ sweeps - Σ merchant withdrawals = 750 - 0 = 750. Stored = 1805. Where's 1805 − 750 = 1055 from?
  const diff = totalMcb - totalSwept + totalWithdrawn;
  console.log(`\n  MERCHANT CRYPTO PROVENANCE:`);
  console.log(`    Σ sweeps INTO merchant:            ${totalSwept.toFixed(8)}`);
  console.log(`    − Σ merchant withdrawals:          ${totalWithdrawn.toFixed(8)}`);
  console.log(`    = Proven floor merchant balance:   ${(totalSwept - totalWithdrawn).toFixed(8)}`);
  console.log(`    Actually stored in table:          ${totalMcb.toFixed(8)}`);
  console.log(`    UNACCOUNTED DIFFERENCE:            ${diff >= 0 ? '+':''}${diff.toFixed(8)}`);
  if (Math.abs(diff) > 1e-5) console.log(`    → The difference may be legitimate (merchant directly deposited crypto, seeded as vault, or earned via routes not in crypto_transactions). Since there's no "delete" operation on merchant crypto confirmed, and only 2 sweep transactions exist producing 750, the +1055 is either a legitimate merchant seed or a phantom — impossible to prove without a merchant_crypto_transactions audit table. Keep as-is unless user confirms they did NOT seed merchant 1555 extra USDT outside of sweeps.`);
  else console.log(`    ✅ Perfectly reconciled.`);

  console.log('\n=============== END MERCHANT CRYPTO AUDIT ===============\n');
  db.close();
})().catch(e=>{console.error('Err: '+e.message);console.error(e.stack);process.exit(1);});
