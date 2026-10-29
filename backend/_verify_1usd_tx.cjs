require('ts-node').register({ transpileOnly: true });

(async () => {
  const { db } = require('./src/config/db');
  console.log('=== CANDIDATE card_settlements for $1.00 USD:');
  try {
    const res1 = await db.query(
      'SELECT id, merchant_id, auth_ref, capture_ref, amount, currency, protocol, status, '
      +'fund_provider_audit_id, fund_provider_endpoint, fund_provider_http_status, '
      +'fund_provider_response_code, fund_provider_reference, created_at '
      +'FROM card_settlements '
      +"WHERE ABS(amount - 1.0) < 0.001 AND currency = 'USD' "
      +'ORDER BY created_at DESC LIMIT 5'
    );
    console.log(JSON.stringify(res1.rows, null, 2));
  } catch(e) { console.log('card_settlements error:', e.message); }

  console.log('\n=== fund_provider_calls (most recent 10):');
  try {
    const res2 = await db.query(
      'SELECT id, flow_type, provider_name, endpoint_url, http_method, '
      +'request_api_key_masked, request_amount_minor, request_currency, '
      +'http_status, response_code_provider, response_reference, ledger_status, '
      +'wallet_owner_type, wallet_owner_id, card_last4, protocol, auth_ref, '
      +'error_message, ledger_warning, created_at '
      +'FROM fund_provider_calls '
      +'ORDER BY created_at DESC LIMIT 10'
    );
    console.log(JSON.stringify(res2.rows, null, 2));
  } catch(e) { console.log('fund_provider_calls error:', e.message); }

  console.log('\n=== Merchant wallet transactions $1.00 USD:');
  try {
    const res3 = await db.query(
      'SELECT mw.id AS merchant_wallet_id, mw.merchant_id, mw.balance AS merchant_wallet_balance, mw.currency, '
      +'mwt.id AS txn_id, mwt.type, mwt.amount AS txn_amount, mwt.currency AS txn_ccy, '
      +'mwt.source, mwt.reference, mwt.fund_provider_audit_id, mwt.provider_reference, '
      +'mwt.created_at '
      +'FROM merchant_wallets mw '
      +'LEFT JOIN merchant_wallet_transactions mwt ON mwt.wallet_id = mw.id '
      +"WHERE mwt.amount >= 0.99 AND mwt.amount <= 1.01 AND mwt.currency = 'USD' "
      +'ORDER BY mwt.created_at DESC LIMIT 10'
    );
    console.log(JSON.stringify(res3.rows, null, 2));
  } catch(e) { console.log('merchant_wallets error:', e.message); }

  console.log('\n=== POS2013 txns: pan_last4=7789 / stan=000001 / $1.00 USD:');
  try {
    const res4 = await db.query(
      'SELECT * FROM pos2013_transactions '
      +"WHERE stan = '000001' OR pan_last4 = '7789' OR ABS(amount - 1.0) < 0.001 "
      +'ORDER BY created_at DESC LIMIT 5'
    );
    console.log(JSON.stringify(res4.rows, null, 2));
  } catch(e) { console.log('pos2013_transactions error:', e.message); }

  console.log('\n=== Authorization holds $1.00 USD:');
  try {
    const res5 = await db.query(
      'SELECT id, transaction_id, merchant_id, amount, currency, status, '
      +'auth_code, pan_masked, settlement_code, created_at '
      +'FROM authorization_holds '
      +"WHERE ABS(amount - 1.0) < 0.001 AND currency = 'USD' "
      +'ORDER BY created_at DESC LIMIT 5'
    );
    console.log(JSON.stringify(res5.rows, null, 2));
  } catch(e) { console.log('authorization_holds error:', e.message); }

  console.log('\n=== Customer wallet transactions $1.00 USD (topups + debits to merchant):');
  try {
    const res6 = await db.query(
      'SELECT * FROM wallet_transactions '
      +"WHERE amount >= 0.99 AND amount <= 1.01 AND currency = 'USD' "
      +'ORDER BY created_at DESC LIMIT 10'
    );
    console.log(JSON.stringify(res6.rows, null, 2));
  } catch(e) { console.log('wallet_transactions error:', e.message); }
})();
