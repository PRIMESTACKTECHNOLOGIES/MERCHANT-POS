const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs"); const path = require("path");
(async()=>{
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname,"data","database.sqlite")));
  const q=(s,p=[])=>{const st=db.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;};
  // Print actual rows to see columns used
  console.log("FULL merchant_payouts row 3e31293c:");
  const r = q("SELECT * FROM merchant_payouts WHERE id='3e31293c-7609-490f-838b-193828e86aed'")[0];
  if (r) {
    Object.entries(r).forEach(([k,v])=>console.log("   "+k+": "+(typeof v==='string'?v.slice(0,140):v)));
  } else console.log("  (not found)");
  console.log("\nFULL merchant_payouts cols & types from row:");
  if (r) { console.log("   keys =", Object.keys(r)); }
  console.log("\nPRAGMA table_info(merchant_payouts):");
  q("PRAGMA table_info(merchant_payouts)").forEach(c => console.log("   cid="+c.cid+" name='"+c.name+"' type='"+c.type+"' notnull="+c.notnull+" dflt="+JSON.stringify(c.dflt_value)));
})();
