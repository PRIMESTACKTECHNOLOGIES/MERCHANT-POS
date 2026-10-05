const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
(async()=>{
  const SQL=await initSqlJs({locateFile:f=>path.join(__dirname,'node_modules','sql.js','dist',f)});
  const db=new SQL.Database(fs.readFileSync(path.join(__dirname,'data','database.sqlite')));
  const r=db.exec(`SELECT id, amount, currency, created_at, status, reconciliation_status FROM merchant_payouts WHERE amount>=49999 ORDER BY datetime(created_at) DESC`);
  const arr=r[0].values.map(row=>{const o={};r[0].columns.forEach((c,i)=>o[c]=row[i]);return o;});
  console.log(JSON.stringify(arr,null,2));
})().catch(e=>{console.error(e.message);process.exit(1)});
