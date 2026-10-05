const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs"); const path = require("path");
(async()=>{
  const SQL=await initSqlJs();
  const db=new SQL.Database(fs.readFileSync(path.join(__dirname,'data','database.sqlite')));
  const q=(s,p=[])=>{const st=db.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;};
  for (const t of ['merchant_wallets','merchant_wallet_transactions','ledger_entries','merchant_payouts','payout_settlement_instructions','admin_users']) {
    console.log('======== ' + t + ' ========');
    console.log('  PRAGMA table_info:', JSON.stringify(q(`PRAGMA table_info(${t})`)));
  }
})();
