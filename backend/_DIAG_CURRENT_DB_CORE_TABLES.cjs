"use strict";
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const DB_PATH = path.join(__dirname, "data", "database.sqlite");

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (s, p = []) => { const st = db.prepare(s); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };

  console.log("DB:", DB_PATH, "\n");

  console.log("═══ merchant_wallets ═══");
  q("SELECT id, merchant_id, currency, balance, updated_at FROM merchant_wallets ORDER BY merchant_id, currency")
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n═══ merchant_payouts (ALL cols) ═══");
  const payouts = q("SELECT id, merchant_id, amount, currency, status, provider, provider_reference, reference, transaction_id, approved_by, reconciliation_status, settled_at, completed_at, created_at FROM merchant_payouts ORDER BY created_at DESC");
  payouts.forEach(r => console.log(JSON.stringify(r)));
  console.log(`count = ${payouts.length}`);

  console.log("\n═══ merchant_wallet_transactions EUR (wallet_id MW-EUR-1001) ═══");
  q(`SELECT id, wallet_id, type, amount, currency, source, reference, description, created_at
       FROM merchant_wallet_transactions
       WHERE currency='EUR' OR wallet_id LIKE '%EUR%'
       ORDER BY created_at DESC`)
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n═══ ledger_entries MRC-1001 EUR ═══");
  q(`SELECT id, substr(transaction_id,1,13) txid, type, amount, currency, status,
            substr(description,1,60) descr, merchant_id, source_type,
            substr(source_reference,1,80) sref, substr(reference,1,40) ref, created_at
       FROM ledger_entries
       WHERE (merchant_id='MRC-1001' AND currency='EUR')
          OR description LIKE '%PAYOUT%'
          OR description LIKE '%EUR50K%'
          OR source_reference LIKE '%2366356442%'
          OR source_reference LIKE '%MTXL1UKC%'
       ORDER BY created_at DESC`)
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n═══ payout_settlement_instructions (ALL) ═══");
  q(`SELECT id, substr(payout_id,1,13) pid, merchant_id, reference, amount, currency, status,
            substr(destination_iban,1,12) iban, destination_swift,
            substr(bank_callback_response,1,120) cb,
            created_at
       FROM payout_settlement_instructions ORDER BY created_at DESC`)
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n═══ bank_accounts (for MRC-1001 / Wise EUR IBAN) ═══");
  q(`SELECT id, merchant_id, bank_name, account_holder, account_number, routing_number,
            iban, swift_code, currency, is_default, verified
       FROM bank_accounts
       WHERE merchant_id='MRC-1001' OR lower(bank_name) LIKE '%wise%' OR currency='EUR'
       ORDER BY merchant_id, currency, is_default DESC`)
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n═══ admin_users ═══");
  q("SELECT id, username, email, full_name, display_name, substr(api_key,1,24) apikey, 2fa FROM admin_users")
    .forEach(r => console.log(JSON.stringify(r)));

  console.log("\n── done ──");
})().catch(e => { console.error(e); process.exit(1); });
