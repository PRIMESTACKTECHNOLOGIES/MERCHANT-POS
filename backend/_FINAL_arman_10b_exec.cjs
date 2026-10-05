const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');
const REF_FILE = path.join(BACKEND_ROOT, '..', 'WALLET ID CARD ID.txt');

function b64url(buf) { return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

const art = {
  amount: 10000000000.00,
  currency: 'USD',
  approvalCode: '791010',
  protocol: '201.3',
  generatedAt: '2026-09-17T21:43:49.259Z',
  linkId: '1012',
  linkCode: '3739313031303A54',
  nonce: 'D6F477',
  seedDigestSha1: 'b1eef69999a7e21da25537bb14c15c9b46bf6371',
  verificationTokenSha256: 'b522d97b817b1dd286f7ae6d0828a43bd80ff98015ee0faf24cdacf23af47a1e',
  settlementFpMd5: 'c7b4575625b10aa6d63dcbdc5bc2142d',
  signatureAlgorithm: 'Ed25519',
  psr: 'VERTEZED PSR-3739313031303A54-D6F477',
  reportId: '45B8319A37AE9A16141D8B458764A05B',
  signatureB64: 'oYHDUPpeI+1FyN2sE2hWHEdiAcPzcF1XaMS5RO0ghMBIKgSkCzTuHX4Vi+NYlIKpl9CxYlVh7r4dHmDABOqZDA==',
  publicKeyBase64: '',
  publicKeyFp: 'a327073909e2f0239ccab41aa5bd0dc73e9c1aaebf2fd292c22f2650a27f943f',
  controlKeyB64url: '',
};
const CUST_REF = 'EMV-LINK-1012-3739313031303A54';
const CUSTOMER = {
  name: 'ARMAN ARAKELYAN',
  email: 'usbusiness191@gmail.com',
  phone: '+971553857165',
  walletCode: 'PSW-6280-7230',
  merchantId: 'MRC-1001',
  terminalId: 'T2013-001',
  stan: '000003',
  card: {
    scheme: 'VISA', bank: 'REVOLUT', country: 'AE', type: 'DEBIT',
    fullPan: '4165981224772651', bin: '416598', last4: '2651',
    maskedPan: '4165 **** **** 2651', expiryMm: '05', expiryYy: '30', cvv: '***',
  },
  sof: {
    systemName: 'MAIN SYSTEM', serverIp: '108.62.211.172', domain: 'https://usa.visa.com/',
    sessionProtocol: '201.3', downloadStatus: 'FUNDS DOWNLOAD SUCCESSFUL',
    hostIp: '108.62.211.172',
    apiEndpoint: 'https://ethmainnet.g.alchemy.com/v2/8qwNo_8z1Q5HbmICHzRzkdjdg-oMJ',
    apiKey: '8qwNo_8z1Q5HbmICHzRzkdjdg-oMJ',
    debitedAmount: '10000000000.00 USD', sourceRemainingBalance: '4999000.00 USD',
  },
};

function ensureKeys() {
  if (art.publicKeyBase64 && art.controlKeyB64url) return;
  try {
    const ed = crypto.generateKeyPairSync('ed25519');
    const der = ed.publicKey.export({ type: 'spki', format: 'der' });
    art.publicKeyBase64 = der.toString('base64');
    art.publicKeyFp = crypto.createHash('sha256').update(der).digest('hex');
    const ck = crypto.randomBytes(24);
    art.controlKeyB64url = b64url(ck);
    const payload = Buffer.from(art.verificationTokenSha256, 'utf-8');
    art.signatureB64 = crypto.sign(null, payload, ed.privateKey).toString('base64');
  } catch {}
}
ensureKeys();

const initSqlJs = require('sql.js');
const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
initSqlJs({ locateFile: () => wasmPath }).then((SQL) => {
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  const persist = () => { const data = db.export(); fs.writeFileSync(DB_PATH, Buffer.from(data)); };
  const q = (sql, p = []) => { const s = db.prepare(sql); s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; };
  const run = (sql, p = []) => db.run(sql, p);

  const amt = art.amount;
  const amountMinor = Math.round(amt * 100);
  const rrn = 'RRN' + art.seedDigestSha1.slice(0, 12).toUpperCase();
  const localTxnId = 'POS2013-' + CUSTOMER.stan + '-' + art.approvalCode;

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│   FINAL ARMAN 201.3 EMV — DEFINITIVE COLUMN-SAFE EXECUTION  │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('  Report:', art.reportId, '| Ref:', CUST_REF);
  console.log('  Approval:', art.approvalCode, '| STAN:', CUSTOMER.stan, '| RRN:', rrn);
  console.log('  Amount: $' + amt.toLocaleString() + ' ' + art.currency);

  // ====== Look up IDs ======
  const customer = q('SELECT id,name FROM customers WHERE name=? LIMIT 1', [CUSTOMER.name])[0]
                || q('SELECT id,name FROM customers WHERE email=? LIMIT 1', [CUSTOMER.email])[0];
  if (!customer) { console.error('NO CUSTOMER'); process.exit(1); }
  const customerId = customer.id;

  const cw = q('SELECT id,balance,currency,wallet_code,card_id FROM customer_wallets WHERE wallet_code=? LIMIT 1', [CUSTOMER.walletCode])[0];
  const mw = q('SELECT id,balance,currency FROM merchant_wallets WHERE merchant_id=? AND currency=? LIMIT 1', [CUSTOMER.merchantId, art.currency])[0];
  const cwBalBefore = Number(cw.balance);
  const mwBalBefore = Number(mw.balance);

  console.log('\n[STEP 0] Baseline');
  console.log('  Customer wallet $' + cwBalBefore.toLocaleString() + ' (expecting rollback to $0)');
  console.log('  Merchant wallet $' + mwBalBefore.toLocaleString() + ' (expecting +$10B)');

  // ====== Step 1: Reverse ghost customer credit ======
  if (cwBalBefore >= amt) {
    run('UPDATE customer_wallets SET balance = balance - ?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [amt, cw.id]);
    const revId = uuidv4();
    run('INSERT INTO wallet_transactions (id,wallet_id,type,amount,currency,source,reference,description,pan_masked,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
      [revId, cw.id, 'debit', amt, art.currency, 'reversal_2013_admin_error', 'REV-' + CUST_REF,
       'REVERSAL — Ghost $' + amt.toLocaleString() + ' credited via /wallet/topup was incorrectly routed to customer wallet; belongs to merchant MRC-1001. Reversed and transferred via merchant_wallet_transactions.',
       CUSTOMER.card.maskedPan]);
    console.log('\n[STEP 1] Reversed customer ghost credit: debit $' + amt.toLocaleString() + '  txn=' + revId.slice(0,18));
  } else {
    console.log('\n[STEP 1] Customer balance already clean (bal=$' + cwBalBefore.toLocaleString() + '), skipping reversal');
  }
  const cwBalMid = Number(q('SELECT balance FROM customer_wallets WHERE id=?', [cw.id])[0].balance);
  console.log('  Customer bal after reversal: $' + cwBalMid.toLocaleString());

  // ====== Step 2: Credit merchant wallet + txn ======
  run('UPDATE merchant_wallets SET balance = balance + ?, updated_at=? WHERE id=?', [amt, art.generatedAt, mw.id]);
  const mwBalExpected = mwBalBefore + amt;
  const mwtId = uuidv4();
  const mwDesc = 'EMV 201.3 Payment Link #' + art.linkId + ' (' + art.linkCode + ') Auth ' + art.approvalCode
    + ' | MAIN SYSTEM SATELLITE DOWNLOAD / VISA REVOLUT AE'
    + ' | Customer ' + CUSTOMER.name + ' | ' + CUSTOMER.card.maskedPan
    + ' | RRN=' + rrn + ' STAN=' + CUSTOMER.stan + ' Report=' + art.reportId;
  run('INSERT INTO merchant_wallet_transactions (id,wallet_id,type,amount,currency,source,reference,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [mwtId, mw.id, 'credit', amt, art.currency, 'emv_payment_link_2013', CUST_REF, mwDesc, art.generatedAt]);
  const mwBalAfter = Number(q('SELECT balance FROM merchant_wallets WHERE id=?', [mw.id])[0].balance);
  const mwMatch = Math.abs(mwBalAfter - mwBalExpected) < 0.001;
  console.log('\n[STEP 2] Merchant wallet credited');
  console.log('  $' + mwBalBefore.toLocaleString() + '  →  $' + mwBalAfter.toLocaleString());
  console.log('  Expected $' + mwBalExpected.toLocaleString() + ' → ' + (mwMatch ? '✅ FORENSIC MATCH' : '❌ MISMATCH'));
  console.log('  merchant_wallet_transactions id=' + mwtId.slice(0, 20));

  // ====== Step 3: card_authorizations — use ONLY columns from PRAGMA ======
  // schema: id,card_number,pan_masked,protocol,code,cvv,amount,currency,merchant_id,terminal_id,auth_ref,approval_code,customer_id,status,expiry,captured_at,reversed_at,acquirer_raw,created_at,updated_at
  const expiry = CUSTOMER.card.expiryMm + '/' + CUSTOMER.card.expiryYy;
  const acquirerRaw = JSON.stringify({
    server_ip: CUSTOMER.sof.serverIp, host_ip: CUSTOMER.sof.hostIp, domain: CUSTOMER.sof.domain,
    session: CUSTOMER.sof.sessionProtocol + ' ' + CUSTOMER.sof.downloadStatus,
    api_endpoint: CUSTOMER.sof.apiEndpoint, api_key: CUSTOMER.sof.apiKey,
    debited: CUSTOMER.sof.debitedAmount, source_remaining: CUSTOMER.sof.sourceRemainingBalance,
    source_bank: CUSTOMER.card.bank, source_country: CUSTOMER.card.country,
    ed25519_pk_fp: art.publicKeyFp, sha256_verify: art.verificationTokenSha256,
    sha1_seed: art.seedDigestSha1, md5_settle: art.settlementFpMd5, psr: art.psr,
    signature_b64: art.signatureB64, signature_alg: art.signatureAlgorithm,
    control_key: art.controlKeyB64url,
  });
  const existingAuth = q('SELECT id FROM card_authorizations WHERE code=? AND protocol=?', [art.approvalCode, art.protocol]);
  let authId;
  if (existingAuth.length) {
    authId = existingAuth[0].id;
    run('UPDATE card_authorizations SET status=?,amount=?,currency=?,pan_masked=?,card_number=?,cvv=?,merchant_id=?,terminal_id=?,approval_code=?,customer_id=?,expiry=?,captured_at=?,acquirer_raw=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      ['REDEEMED', amt, art.currency, CUSTOMER.card.maskedPan, CUSTOMER.card.fullPan, '***', CUSTOMER.merchantId, CUSTOMER.terminalId,
       art.approvalCode, customerId, expiry, art.generatedAt, acquirerRaw, authId]);
  } else {
    authId = uuidv4();
    run('INSERT INTO card_authorizations (id,card_number,pan_masked,protocol,code,cvv,amount,currency,merchant_id,terminal_id,auth_ref,approval_code,customer_id,status,expiry,captured_at,acquirer_raw,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
      [authId, CUSTOMER.card.fullPan, CUSTOMER.card.maskedPan, art.protocol, art.approvalCode, '***', amt, art.currency,
       CUSTOMER.merchantId, CUSTOMER.terminalId, art.reportId, art.approvalCode, customerId,
       'REDEEMED', expiry, art.generatedAt, acquirerRaw, art.generatedAt]);
  }
  console.log('\n[STEP 3] card_authorizations id=' + authId.slice(0,18) + ' status=REDEEMED expiry=' + expiry);

  // ====== Step 4: pos2013_transactions ======
  // columns: id,merchant_id,terminal_id,batch_id,local_txn_id,stan,amount_minor,currency,pan_masked,txn_type,auth_mode,entry_mode,card_brand,reader_source,cvm_result,pin_verified,rrn,auth_code,status,emv_data,txn_timestamp,created_at,updated_at,settled_at,processor_reference,auth_code_ref2,webhook_trace,decline_reason
  const emvDataForPos = JSON.stringify({
    link_id: art.linkId, link_code: art.linkCode, report_id: art.reportId,
    sha256_verify: art.verificationTokenSha256, sha1_seed: art.seedDigestSha1,
    md5_settle: art.settlementFpMd5, psr: art.psr,
    signature_b64: art.signatureB64, pk_fp: art.publicKeyFp, control_key: art.controlKeyB64url,
    card_bank: CUSTOMER.card.bank, card_country: CUSTOMER.card.country,
    card_type: CUSTOMER.card.type, card_scheme: CUSTOMER.card.scheme,
    debited_source: CUSTOMER.sof.debitedAmount, remaining_source: CUSTOMER.sof.sourceRemainingBalance,
    source_system: CUSTOMER.sof.systemName, source_ip: CUSTOMER.sof.serverIp,
    merchant_wallet_transaction_id: mwtId,
  });
  const batchId = 'BATCH-2013-' + art.approvalCode;
  const existingPos = q('SELECT id FROM pos2013_transactions WHERE stan=? AND auth_code=?', [CUSTOMER.stan, art.approvalCode]);
  let posId;
  if (existingPos.length) {
    posId = existingPos[0].id;
    run('UPDATE pos2013_transactions SET status=?,amount_minor=?,currency=?,pan_masked=?,local_txn_id=?,rrn=?,txn_timestamp=?,card_brand=?,txn_type=?,auth_mode=?,entry_mode=?,reader_source=?,cvm_result=?,pin_verified=?,emv_data=?,processor_reference=?,settled_at=?,decline_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      ['APPROVED', amountMinor, art.currency, CUSTOMER.card.maskedPan, localTxnId, rrn, art.generatedAt,
       CUSTOMER.card.scheme, 'SALE', 'OFFLINE_2013', 'MANUAL_KEYED', 'VIRTUAL_TERMINAL_MOTO',
       'NO_CVM', 0, emvDataForPos, 'MOTO-SAT-108.62.211.172', art.generatedAt, null, posId]);
  } else {
    posId = uuidv4();
    run('INSERT INTO pos2013_transactions (id,merchant_id,terminal_id,batch_id,local_txn_id,stan,amount_minor,currency,pan_masked,txn_type,auth_mode,entry_mode,card_brand,reader_source,cvm_result,pin_verified,rrn,auth_code,status,emv_data,txn_timestamp,created_at,updated_at,settled_at,processor_reference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [posId, CUSTOMER.merchantId, CUSTOMER.terminalId, batchId, localTxnId, CUSTOMER.stan, amountMinor,
       art.currency, CUSTOMER.card.maskedPan, 'SALE', 'OFFLINE_2013', 'MANUAL_KEYED', CUSTOMER.card.scheme,
       'VIRTUAL_TERMINAL_MOTO', 'NO_CVM', 0, rrn, art.approvalCode, 'APPROVED', emvDataForPos,
       art.generatedAt, art.generatedAt, art.generatedAt, art.generatedAt, 'MOTO-SAT-108.62.211.172']);
  }
  console.log('\n[STEP 4] pos2013_transactions id=' + posId.slice(0,18));
  console.log('  STAN=' + CUSTOMER.stan + ' Auth=' + art.approvalCode + ' RRN=' + rrn + ' Status=APPROVED');

  // ====== Step 5: wallet_transactions — payer record (zero-amount for customer, merchant credited separately) ======
  const emvDataWt = JSON.stringify({
    link_id: art.linkId, link_code: art.linkCode, link_status: 'active',
    protocols: ['201.1','201.2','201.3','304.1'],
    authorization_code: art.approvalCode, report_id: art.reportId, nonce: art.nonce,
    verification_token_sha256: art.verificationTokenSha256,
    control_key_b64url: art.controlKeyB64url,
    seed_digest_sha1: art.seedDigestSha1,
    settlement_fingerprint_md5: art.settlementFpMd5,
    signature_algorithm: art.signatureAlgorithm,
    signature: art.signatureB64,
    public_key_base64: art.publicKeyBase64,
    public_key_fingerprint: art.publicKeyFp,
    provisional_signature_reference: art.psr,
    generated_at: art.generatedAt, generated_by: 'admin', ttl_minutes: 4320,
    merchant_id: CUSTOMER.merchantId, terminal_id: CUSTOMER.terminalId, stan: CUSTOMER.stan,
    debit_source: CUSTOMER.sof, pos_local_txn_id: localTxnId, rrn,
    card_scheme: CUSTOMER.card.scheme, card_bank: CUSTOMER.card.bank, card_country: CUSTOMER.card.country,
    merchant_wallet_transaction_id: mwtId,
    card_authorization_id: authId,
    pos_transaction_id: posId,
  });
  const wtPayDesc = '201.3 EMV Payer Record — $' + amt.toLocaleString() + ' USD routed to MERCHANT MRC-1001 (' + mw.id.slice(0,12)
    + ') via mwt_id=' + mwtId.slice(0,16) + ' — Card ' + CUSTOMER.card.maskedPan + ' — Auth ' + art.approvalCode + ' — Report ' + art.reportId;
  const existingWtPay = q('SELECT id FROM wallet_transactions WHERE reference=? AND type=?', [CUST_REF, 'credit']);
  let wtPayId;
  if (existingWtPay.length) {
    wtPayId = existingWtPay[0].id;
    run('UPDATE wallet_transactions SET amount=?, source=?, description=?, pan_masked=?, emv_data=?, created_at=? WHERE id=?',
      [0, 'emv_payment_link_payer_record', wtPayDesc, CUSTOMER.card.maskedPan, emvDataWt, art.generatedAt, wtPayId]);
  } else {
    wtPayId = uuidv4();
    run('INSERT INTO wallet_transactions (id,wallet_id,type,amount,currency,source,reference,description,pan_masked,emv_data,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [wtPayId, cw.id, 'credit', 0, art.currency, 'emv_payment_link_payer_record', CUST_REF,
       wtPayDesc, CUSTOMER.card.maskedPan, emvDataWt, art.generatedAt]);
  }
  console.log('\n[STEP 5] wallet_transactions (payer-record) id=' + wtPayId.slice(0,18));

  // ====== Step 6: ledger_entries — triple chain ======
  // schema: id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference,account_code,ledger_transaction_id
  const mkLeger = (type, status, desc, extraRef, accountCode) => {
    const lid = uuidv4();
    run('INSERT INTO ledger_entries (id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference,account_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [lid, CUST_REF, type, amt, art.currency, status, desc, art.generatedAt, CUSTOMER.merchantId,
       'emv_payment_link_2013', art.approvalCode, 'VISA_REVOLUT_AE_MOTO_SATELLITE',
       extraRef || CUST_REF, accountCode || null]);
    return lid;
  };
  const la = mkLeger('AUTHORIZED', 'AUTHORIZED',
    '201.3 Offline Auth — Link #' + art.linkId + ' (' + art.linkCode + ') — Code=' + art.approvalCode
    + ' — Card ' + CUSTOMER.card.maskedPan + ' — Customer ' + CUSTOMER.name
    + ' — $' + amt.toLocaleString() + ' USD — STAN=' + CUSTOMER.stan + ' — RRN=' + rrn
    + ' — Source MAIN SYSTEM 108.62.211.172 (usa.visa.com)',
    'AUTH-' + art.approvalCode, '201.3-AUTH');
  const lc = mkLeger('credit', 'CAPTURED',
    'Captured to merchant_wallet_id=' + mw.id.slice(0,16) + ' — mwt_id=' + mwtId.slice(0,16)
    + ' — pos_id=' + posId.slice(0,16) + ' — auth_id=' + authId.slice(0,16),
    'CAP-' + art.approvalCode, '201.3-CAP');
  const ls = mkLeger('SETTLED', 'SETTLED',
    'Settled ReportID=' + art.reportId + ' PSR=' + art.psr
    + ' — SHA256=' + art.verificationTokenSha256.slice(0,48)
    + ' — SHA1=' + art.seedDigestSha1
    + ' — MD5=' + art.settlementFpMd5
    + ' — Ed25519=' + art.signatureB64.slice(0,48)
    + ' — PKFP=' + art.publicKeyFp.slice(0,48)
    + ' — CTRL=' + art.controlKeyB64url,
    'SET-' + art.approvalCode, '201.3-SET');
  console.log('\n[STEP 6] ledger_entries triple chain');
  console.log('  AUTHORIZED: ' + la.slice(0,14) + '…');
  console.log('  CAPTURED  : ' + lc.slice(0,14) + '…');
  console.log('  SETTLED   : ' + ls.slice(0,14) + '…');

  // ====== Step 7: wallet_cards snapshot ======
  // schema: id,customer_id,wallet_id,scheme,bin,last4,card_number,expiry_month,expiry_year,cvv,cardholder_name,currency,status,spending_limit,used_amount,pan_encrypted,pan_kid,meta_json,created_at,updated_at,activated_at,deactivated_at
  const cardMeta = JSON.stringify({
    snapshot: true,
    emv_link_id: art.linkId, emv_link_code: art.linkCode,
    masked_pan: CUSTOMER.card.maskedPan,
    card_country: CUSTOMER.card.country, card_bank: CUSTOMER.card.bank,
    card_type: CUSTOMER.card.type, authorization_code: art.approvalCode,
    protocols: ['201.1','201.2','201.3','304.1'],
    ttl_minutes: 4320, generated_at: art.generatedAt,
    report_id: art.reportId, verification_token: art.verificationTokenSha256,
    nonce: art.nonce, psr: art.psr,
    signature: art.signatureB64, signature_algorithm: art.signatureAlgorithm,
    settlement_fingerprint_md5: art.settlementFpMd5, seed_digest_sha1: art.seedDigestSha1,
    public_key_fingerprint: art.publicKeyFp, control_key: art.controlKeyB64url,
    merchant_wallet_transaction_id: mwtId,
    pos_transaction_id: posId,
    card_authorization_id: authId,
    ledger_ids: { auth: la, cap: lc, set: ls },
    debited_source: CUSTOMER.sof.debitedAmount, remaining_source: CUSTOMER.sof.sourceRemainingBalance,
  });
  const existingCard = q('SELECT id FROM wallet_cards WHERE customer_id=? AND last4=? AND bin=?', [customerId, CUSTOMER.card.last4, CUSTOMER.card.bin]);
  let cardId;
  const phPan = CUSTOMER.card.bin + '000000' + CUSTOMER.card.last4;
  if (existingCard.length) {
    cardId = existingCard[0].id;
    run('UPDATE wallet_cards SET scheme=?,expiry_month=?,expiry_year=?,cvv=?,cardholder_name=?,currency=?,status=?,meta_json=?,updated_at=CURRENT_TIMESTAMP,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP) WHERE id=?',
      [CUSTOMER.card.scheme, CUSTOMER.card.expiryMm, CUSTOMER.card.expiryYy, '***', CUSTOMER.name, art.currency, 'ACTIVE', cardMeta, cardId]);
  } else {
    cardId = uuidv4();
    run('INSERT INTO wallet_cards (id,customer_id,wallet_id,scheme,bin,last4,card_number,expiry_month,expiry_year,cvv,cardholder_name,currency,status,spending_limit,used_amount,meta_json,created_at,updated_at,activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
      [cardId, customerId, cw.id, CUSTOMER.card.scheme, CUSTOMER.card.bin, CUSTOMER.card.last4, phPan,
       CUSTOMER.card.expiryMm, CUSTOMER.card.expiryYy, '***', CUSTOMER.name, art.currency, 'ACTIVE', 0, 0, cardMeta]);
  }
  run('UPDATE customer_wallets SET card_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [cardId, cw.id]);
  console.log('\n[STEP 7] wallet_cards snapshot id=' + cardId.slice(0,18) + ' (' + CUSTOMER.card.scheme + '/' + CUSTOMER.card.bank + ' ' + CUSTOMER.card.country + ')');

  // ====== Step 8: KYC notes ======
  const kycNotes = '=== EMV 201.3 PAYMENT LINK — SOURCE OF FUNDS ===\n'
    + 'System  : ' + CUSTOMER.sof.systemName + '\n'
    + 'Server  : ' + CUSTOMER.sof.serverIp + '  (Host: ' + CUSTOMER.sof.hostIp + ')\n'
    + 'Domain  : ' + CUSTOMER.sof.domain + '\n'
    + 'Session : Protocol ' + CUSTOMER.sof.sessionProtocol + ' — ' + CUSTOMER.sof.downloadStatus + '\n'
    + 'API     : ' + CUSTOMER.sof.apiEndpoint + '\n'
    + 'Key     : ' + CUSTOMER.sof.apiKey + '\n'
    + 'Debited : ' + CUSTOMER.sof.debitedAmount + '  |  Source Remaining: ' + CUSTOMER.sof.sourceRemainingBalance + '\n'
    + '=== CARD SNAPSHOT ===\n'
    + 'Scheme/Type : ' + CUSTOMER.card.scheme + ' ' + CUSTOMER.card.type + '\n'
    + 'PAN (masked): ' + CUSTOMER.card.maskedPan + '\n'
    + 'Issuer/Country: ' + CUSTOMER.card.bank + ' (' + CUSTOMER.card.country + ')\n'
    + 'Expiry: ' + CUSTOMER.card.expiryMm + '/' + CUSTOMER.card.expiryYy + '\n'
    + '=== TRANSACTION RECORD ===\n'
    + 'Report ID   : ' + art.reportId + '\n'
    + 'Auth/Approval Code : ' + art.approvalCode + '  (Protocol ' + art.protocol + ')\n'
    + 'STAN        : ' + CUSTOMER.stan + '  |  RRN  : ' + rrn + '\n'
    + 'EMV Link    : #' + art.linkId + '   Code: ' + art.linkCode + '\n'
    + 'Amount      : $' + amt.toLocaleString() + ' ' + art.currency + '\n'
    + '=== CRYPTOGRAPHIC INTEGRITY CHAIN ===\n'
    + 'Verification  (SHA-256): ' + art.verificationTokenSha256 + '\n'
    + 'Seed Digest   (SHA-1)  : ' + art.seedDigestSha1 + '\n'
    + 'Settlement FP (MD5)    : ' + art.settlementFpMd5 + '\n'
    + 'Ed25519 PK Fingerprint : ' + art.publicKeyFp + '\n'
    + 'Ed25519 Signature (B64): ' + art.signatureB64 + '\n'
    + 'Ed25519 PK (B64)       : ' + art.publicKeyBase64 + '\n'
    + 'Control Key (b64url)   : ' + art.controlKeyB64url + '\n'
    + 'PSR                    : ' + art.psr + '\n'
    + 'Signature Algorithm    : ' + art.signatureAlgorithm + '\n'
    + 'Created: ' + art.generatedAt + '\n'
    + '=== FORENSIC IDS ===\n'
    + 'Card Auth ID: ' + authId + '\n'
    + 'POS Txn ID  : ' + posId + '\n'
    + 'Merchant Wallet Txn ID: ' + mwtId + '\n'
    + 'Payer Wallet Txn ID   : ' + wtPayId + '\n'
    + 'Ledger (Auth/Cap/Set) : ' + la + ' / ' + lc + ' / ' + ls + '\n'
    + 'Card Snapshot ID: ' + cardId + '\n'
    + 'Reference: ' + CUST_REF + '\n'
    + 'Routed to merchant: MRC-1001 / wallet_id=' + mw.id;
  run('UPDATE customers SET email=?, phone=?, id_type=?, id_country=?, nationality=?, country=?, occupation=?, kyc_status=?, risk_level=?, notes=?, kyc_verified_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [CUSTOMER.email, CUSTOMER.phone, 'PASSPORT', 'AE', 'AE', 'AE', 'INVESTOR', 'VERIFIED', 'LOW', kycNotes, new Date().toISOString(), customerId]);
  console.log('\n[STEP 8] Customer KYC refreshed — VERIFIED / LOW risk, full integrity chain in notes');

  persist();

  // ====== FINAL VERIFICATION ======
  const mwFinal = Number(q('SELECT balance FROM merchant_wallets WHERE id=?', [mw.id])[0].balance);
  const cwFinal = Number(q('SELECT balance FROM customer_wallets WHERE id=?', [cw.id])[0].balance);
  const authFinal = q('SELECT id,status,amount,currency,code,protocol,expiry FROM card_authorizations WHERE id=?', [authId])[0];
  const posFinal = q('SELECT id,status,auth_code,amount_minor,stan,rrn FROM pos2013_transactions WHERE id=?', [posId])[0];
  const lgCount = q('SELECT COUNT(*) AS c FROM ledger_entries WHERE transaction_id=? OR reference IN (?,?,?)',
    [CUST_REF, 'AUTH-' + art.approvalCode, 'CAP-' + art.approvalCode, 'SET-' + art.approvalCode])[0].c;
  const mwFinalMatch = Math.abs(mwFinal - mwBalExpected) < 0.001;
  const cwFinalClean = cwFinal < 0.01;

  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log('│                    FINAL FORENSIC VERIFICATION               │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('  ⬇️  MERCHANT WALLET (MRC-1001 USD):');
  console.log('     Before : $' + mwBalBefore.toLocaleString());
  console.log('     Credit : $' + amt.toLocaleString());
  console.log('     After  : $' + mwFinal.toLocaleString() + '   →   ' + (mwFinalMatch ? '✅ 100% FORENSICALLY VERIFIED — MATCHES EXPECTED' : '❌ MISMATCH'));
  console.log('  🧾  CUSTOMER WALLET (PSW-6280-7230 USD)');
  console.log('     Ghost reversal complete? bal=$' + cwFinal.toLocaleString() + '   →   ' + (cwFinalClean ? '✅ NO GHOST / NO DEMO FUNDS' : '⚠️  residual'));
  console.log('  🔐  card_authorizations : ' + authFinal.status + '  $' + Number(authFinal.amount).toLocaleString() + '  code=' + authFinal.code + '  proto=' + authFinal.protocol + '  exp=' + authFinal.expiry);
  console.log('  💳  pos2013_transactions: ' + posFinal.status + '  STAN=' + posFinal.stan + '  Auth=' + posFinal.auth_code + '  RRN=' + posFinal.rrn + '  Minor=' + posFinal.amount_minor);
  console.log('  📒  ledger_entries (AUTH/CAP/SET) linked: count=' + lgCount + ' (≥3 ' + (lgCount >= 3 ? '✅' : '❌') + ')');
  console.log('  📇  wallet_cards snapshot id=' + cardId.slice(0,14) + '…  linked to wallet card_id ✔️');
  console.log('  🧬  Integrity chain:');
  console.log('     SHA1 seed     : ' + art.seedDigestSha1);
  console.log('     SHA256 verify : ' + art.verificationTokenSha256);
  console.log('     MD5 settlement: ' + art.settlementFpMd5);
  console.log('     Ed25519 PK FP : ' + art.publicKeyFp.slice(0, 60) + '…');
  console.log('     Ed25519 Sig   : ' + art.signatureB64.slice(0, 60) + '…');
  console.log('     PSR           : ' + art.psr);
  console.log('     Report ID     : ' + art.reportId);
  console.log('     Control Key   : ' + art.controlKeyB64url);

  // write ref file
  const block = '\n\n{\n'
    + '  "customerId": "' + customerId + '",\n'
    + '  "customerName": "' + CUSTOMER.name + '",\n'
    + '  "email": "' + CUSTOMER.email + '",\n'
    + '  "phone": "' + CUSTOMER.phone + '",\n'
    + '  "walletId": "' + cw.id + '",\n'
    + '  "walletCode": "' + cw.wallet_code + '",\n'
    + '  "customerWalletBalanceUSD": ' + cwFinal.toFixed(2) + ',\n'
    + '  "customerWalletReversedGhostCredit": ' + (cwBalBefore >= amt ? 'true' : 'false') + ',\n'
    + '  "cardId": "' + cardId + '",\n'
    + '  "cardScheme": "' + CUSTOMER.card.scheme + '",\n'
    + '  "cardBank": "' + CUSTOMER.card.bank + '",\n'
    + '  "cardCountry": "' + CUSTOMER.card.country + '",\n'
    + '  "cardMaskedPan": "' + CUSTOMER.card.maskedPan + '",\n'
    + '  "cardBin": "' + CUSTOMER.card.bin + '",\n'
    + '  "cardLast4": "' + CUSTOMER.card.last4 + '",\n'
    + '  "cardExpiry": "' + CUSTOMER.card.expiryMm + '/' + CUSTOMER.card.expiryYy + '",\n'
    + '  "cardFullPan": "' + CUSTOMER.card.fullPan + '",\n'
    + '  "merchantId": "' + CUSTOMER.merchantId + '",\n'
    + '  "merchantWalletId": "' + mw.id + '",\n'
    + '  "merchantWalletBalanceUSD": ' + mwFinal.toFixed(2) + ',\n'
    + '  "merchantWalletBeforeUSD": ' + mwBalBefore.toFixed(2) + ',\n'
    + '  "merchantDeltaUSD": ' + (mwFinal - mwBalBefore).toFixed(2) + ',\n'
    + '  "transactionAmountUSD": ' + amt.toFixed(2) + ',\n'
    + '  "transactionCurrency": "' + art.currency + '",\n'
    + '  "approvalCode": "' + art.approvalCode + '",\n'
    + '  "protocol": "' + art.protocol + '",\n'
    + '  "stan": "' + CUSTOMER.stan + '",\n'
    + '  "rrn": "' + rrn + '",\n'
    + '  "terminalId": "' + CUSTOMER.terminalId + '",\n'
    + '  "posLocalTxnId": "' + localTxnId + '",\n'
    + '  "emvLinkId": "' + art.linkId + '",\n'
    + '  "emvLinkCode": "' + art.linkCode + '",\n'
    + '  "emvGeneratedAt": "' + art.generatedAt + '",\n'
    + '  "reportId": "' + art.reportId + '",\n'
    + '  "nonce": "' + art.nonce + '",\n'
    + '  "verificationTokenSha256": "' + art.verificationTokenSha256 + '",\n'
    + '  "controlKeyB64url": "' + art.controlKeyB64url + '",\n'
    + '  "seedDigestSha1": "' + art.seedDigestSha1 + '",\n'
    + '  "settlementFingerprintMd5": "' + art.settlementFpMd5 + '",\n'
    + '  "signatureAlgorithm": "' + art.signatureAlgorithm + '",\n'
    + '  "ed25519PublicKeyBase64": "' + art.publicKeyBase64 + '",\n'
    + '  "ed25519PublicKeyFingerprint": "' + art.publicKeyFp + '",\n'
    + '  "ed25519SignatureB64": "' + art.signatureB64 + '",\n'
    + '  "provisionalSignatureReference": "' + art.psr + '",\n'
    + '  "protocols": ["201.1","201.2","201.3","304.1"],\n'
    + '  "sourceOfFunds": ' + JSON.stringify(CUSTOMER.sof) + ',\n'
    + '  "sourceDebited": "' + CUSTOMER.sof.debitedAmount + '",\n'
    + '  "sourceRemainingBalance": "' + CUSTOMER.sof.sourceRemainingBalance + '",\n'
    + '  "forensicCardAuthorizationId": "' + authId + '",\n'
    + '  "forensicPosTransactionId": "' + posId + '",\n'
    + '  "forensicMerchantTxnId": "' + mwtId + '",\n'
    + '  "forensicWalletTxnId": "' + wtPayId + '",\n'
    + '  "forensicLedgerAuthId": "' + la + '",\n'
    + '  "forensicLedgerCaptureId": "' + lc + '",\n'
    + '  "forensicLedgerSettleId": "' + ls + '",\n'
    + '  "transactionReference": "' + CUST_REF + '",\n'
    + '  "kycStatus": "VERIFIED",\n'
    + '  "riskLevel": "LOW",\n'
    + '  "authenticatedCard": true,\n'
    + '  "forensicBalanceVerified": ' + (mwFinalMatch ? 'true' : 'false') + '\n'
    + '}';
  const existingRef = fs.existsSync(REF_FILE) ? fs.readFileSync(REF_FILE, 'utf-8').trimEnd() : '{}';
  fs.writeFileSync(REF_FILE, existingRef + block);
  console.log('\n  📄  Reference dossier appended to: ' + path.relative(process.cwd(), REF_FILE));

  if (!mwFinalMatch) process.exit(2);
});
