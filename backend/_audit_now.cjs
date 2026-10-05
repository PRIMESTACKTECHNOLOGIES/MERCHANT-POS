const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs"); const path = require("path");
(async()=>{
  const SQL=await initSqlJs();
  const db=new SQL.Database(fs.readFileSync(path.join(__dirname,'data','database.sqlite')));
  const q=(s,p=[])=>{const st=db.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;};
  console.log('=== 1. EUR WALLET (MRC-1001) ===');
  console.log(JSON.stringify(q('SELECT id,merchant_id,currency,balance,updated_at FROM merchant_wallets WHERE merchant_id=? AND currency=?',['MRC-1001','EUR']),null,2));
  console.log('\n=== 2. MERCHANT_PAYOUTS latest 3 ===');
  console.log(JSON.stringify(q('SELECT id,status,provider,provider_reference,amount,currency,created_at,error_message FROM merchant_payouts WHERE merchant_id=? ORDER BY datetime(created_at) DESC LIMIT 3',['MRC-1001']),null,2));
  console.log('\n=== 3. SETTLEMENT INSTRUCTIONS latest 3 ===');
  console.log(JSON.stringify(q('SELECT id,payout_id,reference,amount,currency,status,destination_iban,destination_swift FROM payout_settlement_instructions ORDER BY datetime(created_at) DESC LIMIT 3'),null,2));
  console.log('\n=== 4. LEDGER ENTRIES (EUR, MRC-1001) count + last 5 ===');
  console.log('COUNT:', JSON.stringify(q('SELECT COUNT(*) AS c FROM ledger_entries WHERE merchant_id=? AND currency=?',['MRC-1001','EUR'])));
  console.log('LAST 5:', JSON.stringify(q('SELECT id,transaction_id,type,amount,currency,status,description,created_at,source_type,source_reference,source_network,reference FROM ledger_entries WHERE merchant_id=? AND currency=? ORDER BY datetime(created_at) DESC LIMIT 5',['MRC-1001','EUR']),null,2));
  console.log('\n=== 5. LEDGER NET SUM EUR ===');
  const sq = "SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE -amount END),0) AS net FROM ledger_entries WHERE merchant_id=? AND currency=?";
  console.log(JSON.stringify(q(sq,['MRC-1001','EUR']),null,2));
})();
