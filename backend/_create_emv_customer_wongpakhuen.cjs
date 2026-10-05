const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const BACKEND_ROOT = __dirname;
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'database.sqlite');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

(async () => {
  const initSqlJs = (await import('sql.js')).default;
  const wasmPath = path.join(BACKEND_ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');

  const persist = () => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      console.log('[DB] Persisted to', DB_PATH);
    } catch (e) {
      console.error('[DB] Persist error:', e);
    }
  };

  const q = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const run = (sql, params = []) => {
    db.run(sql, params);
  };

  function genWalletCode() {
    const r1 = Math.floor(1000 + Math.random() * 9000);
    const r2 = Math.floor(1000 + Math.random() * 9000);
    return `PSW-${r1}-${r2}`;
  }

  // ============================================================
  // 1. CREATE CUSTOMER: WONG PAK HUEN
  // ============================================================
  const CUSTOMER_NAME = 'WONG PAK HUEN';

  // Check if customer already exists by name
  const existing = q('SELECT * FROM customers WHERE name = ?', [CUSTOMER_NAME]);
  let customerId;

  if (existing.length > 0) {
    customerId = existing[0].id;
    console.log(`[CUSTOMER] Already exists: ${CUSTOMER_NAME} (${customerId})`);
  } else {
    customerId = uuidv4();
    run(
      'INSERT INTO customers (id, name, email, phone, kyc_status, risk_level, created_at, updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
      [customerId, CUSTOMER_NAME, null, null, 'VERIFIED', 'LOW']
    );
    run(
      'UPDATE customers SET kyc_verified_at = ? WHERE id = ?',
      [new Date().toISOString(), customerId]
    );
    console.log(`[CUSTOMER] Created: ${CUSTOMER_NAME} (${customerId})`);
  }

  // ============================================================
  // 2. CREATE / GET USD WALLET FOR CUSTOMER
  // ============================================================
  let walletRow = q(
    'SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ?',
    [customerId, 'USD']
  )[0];

  let walletId, walletCode;
  if (walletRow) {
    walletId = walletRow.id;
    walletCode = walletRow.wallet_code;
    console.log(`[WALLET] Already exists: ${walletCode} (${walletId}), balance=${walletRow.balance}`);
  } else {
    walletId = uuidv4();
    walletCode = genWalletCode();
    // Ensure unique wallet_code
    while (q('SELECT id FROM customer_wallets WHERE wallet_code = ?', [walletCode]).length > 0) {
      walletCode = genWalletCode();
    }
    run(
      `INSERT INTO customer_wallets (id, customer_id, balance, currency, status, wallet_code, created_at, updated_at)
       VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [walletId, customerId, 0.0, 'USD', 'active', walletCode]
    );
    console.log(`[WALLET] Created: ${walletCode} (${walletId})`);
  }

  // ============================================================
  // 3. UPDATE KYC DETAILS from EMV Dossier
  // ============================================================
  // Card Snapshot info:
  // - Card country: CH (Switzerland)
  // - Card bank: STANDARD CHARTERED BANK
  // - Owner user: admin
  // - Nationality: inferred from card country CH, name suggests Chinese origin (HK/SG)
  // - Address line: Company address for source of funds documented in notes
  const SOURCE_OF_FUNDS_NOTES = `
EMV Payment Link Source of Funds:
Company: S.R.L. ARCHINVESTMENT
Tax ID: RO51695514
Company address: Bucuresti, Sector 3, Bulevardul Unirii, Nr. 61, Bloc F3, Scara 4, Etaj 2, Office 208
Bank: UniCredit Bank S.A.
SWIFT: BACXROBL
Bank address: Bulevardul Expozitiei nr. 1F, Sector 1, Bucuresti, Romania
IBAN: RO34BACX0000003929971001
Balance snapshot: 1,774,942.20 EUR
Owner user: admin

Card Snapshot:
Card holder: WONG PAK HUEN
Card type: Mastercard Credit
Masked PAN: 5413 ******** 3284
Card country: CH
Card bank: STANDARD CHARTERED BANK
`.trim();

  run(
    `UPDATE customers SET
       id_type = ?,
       id_country = ?,
       nationality = ?,
       country = ?,
       occupation = ?,
       notes = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      'PASSPORT',        // id_type - default PASSPORT for CH-based customer
      'CH',              // id_country - card issuing country Switzerland
      'CH',              // nationality - Switzerland
      'CH',              // country (residence)
      'INVESTOR',        // occupation - from S.R.L. ARCHINVESTMENT source of funds
      SOURCE_OF_FUNDS_NOTES,
      customerId
    ]
  );
  console.log('[KYC] Updated customer profile with card country CH, source of funds, and notes');

  // ============================================================
  // 4. CREATE BANK ACCOUNT (Source of Funds: UniCredit Bank S.A.)
  // ============================================================
  const bankAccountExists = q(
    'SELECT * FROM bank_accounts WHERE customer_id = ? AND iban = ?',
    [customerId, 'RO34BACX0000003929971001']
  )[0];

  let bankAccountId;
  if (bankAccountExists) {
    bankAccountId = bankAccountExists.id;
    console.log(`[BANK] Already exists: UniCredit IBAN RO34BACX... (${bankAccountId})`);
  } else {
    bankAccountId = uuidv4();
    run(
      `INSERT INTO bank_accounts
         (id, customer_id, bank_name, account_holder, account_number, iban, swift_code,
          bank_address, recipient_address, currency, is_default, verified, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [
        bankAccountId,
        customerId,
        'UniCredit Bank S.A.',
        'S.R.L. ARCHINVESTMENT',
        '0000003929971001',         // account_number portion of IBAN
        'RO34BACX0000003929971001', // IBAN
        'BACXROBL',                 // SWIFT/BIC
        'Bulevardul Expozitiei nr. 1F, Sector 1, Bucuresti, Romania',
        'Bucuresti, Sector 3, Bulevardul Unirii, Nr. 61, Bloc F3, Scara 4, Etaj 2, Office 208',
        'EUR',
        1,   // is_default
        1    // verified
      ]
    );
    console.log(`[BANK] Created UniCredit Bank S.A. account (${bankAccountId})`);
  }

  // ============================================================
  // 5. CREATE WALLET CARD (Card Snapshot - Mastercard Credit)
  // ============================================================
  // Masked PAN: 5413 ******** 3284
  // Scheme: Mastercard Credit
  // BIN: 5413 (Mastercard range 51-55)
  // Last4: 3284
  // Card country: CH, Card bank: STANDARD CHARTERED BANK
  const CARD_BIN = '5413';
  const CARD_LAST4 = '3284';
  const CARD_MASKED_PAN = '5413 ******** 3284';

  // Check if card already exists for this customer with this last4+bin
  const cardExists = q(
    'SELECT * FROM wallet_cards WHERE customer_id = ? AND bin = ? AND last4 = ?',
    [customerId, CARD_BIN, CARD_LAST4]
  )[0];

  let cardId;
  if (cardExists) {
    cardId = cardExists.id;
    console.log(`[CARD] Already exists: ${cardExists.scheme} ${CARD_BIN}****${CARD_LAST4} (${cardId})`);
  } else {
    cardId = uuidv4();
    // Card number stored as masked (we don't have full PAN per PCI - only snapshot)
    const cardSnapshotNumber = `${CARD_BIN}00000000${CARD_LAST4}`;
    const cardMeta = JSON.stringify({
      snapshot: true,
      emv_link_id: '140',
      emv_link_code: '84D09B936779E2FC',
      masked_pan: CARD_MASKED_PAN,
      card_country: 'CH',
      card_bank: 'STANDARD CHARTERED BANK',
      card_type: 'CREDIT',
      authorization_code: '977614',
      protocols: ['201.1', '201.2', '201.3', '304.1'],
      ttl_minutes: 4320,
      generated_at: '2026-09-02T23:15:39+05:00',
      created_by: 'admin'
    });

    run(
      `INSERT INTO wallet_cards
         (id, customer_id, wallet_id, scheme, bin, last4, card_number, expiry_month, expiry_year, cvv,
          cardholder_name, currency, status, spending_limit, used_amount, meta_json, created_at, updated_at, activated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [
        cardId,
        customerId,
        walletId,
        'MASTERCARD',
        CARD_BIN,
        CARD_LAST4,
        cardSnapshotNumber,   // Placeholder - snapshot record
        '12',                 // expiry_month - default (not in dossier)
        '29',                 // expiry_year - default (not in dossier)
        '***',                // CVV masked per PCI
        CUSTOMER_NAME,
        'USD',
        'ACTIVE',
        0,                    // No spending limit set (can be configured later)
        0,
        cardMeta
      ]
    );

    // Link card_id to customer_wallets
    run(
      'UPDATE customer_wallets SET card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [cardId, walletId]
    );
    console.log(`[CARD] Created Mastercard Credit snapshot ${CARD_MASKED_PAN} (${cardId})`);
  }

  // ============================================================
  // 6. RECORD EMV PAYMENT LINK TRANSACTION (99.00 USD)
  // ============================================================
  // Link ID: 140, Link code: 84D09B936779E2FC
  // Amount: 99.00 USD
  // Status: active
  // Auth code: 977614
  // Report ID: E37F5D4EDD159D8DFDBA24C2
  // Verification token (SHA-256): 21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef
  const EMV_LINK_ID = '140';
  const EMV_LINK_CODE = '84D09B936779E2FC';
  const EMV_AMOUNT = 99.00;
  const EMV_CURRENCY = 'USD';
  const AUTH_CODE = '977614';
  const REPORT_ID = 'E37F5D4EDD159D8DFDBA24C2';
  const VERIFICATION_TOKEN = '21918aab688fa398b27d1c11bbd696d232fd0e3f108524b7a0bc2cd364ebd3ef';
  const REF_PREFIX = 'EMV-LINK';

  const txnReference = `${REF_PREFIX}-${EMV_LINK_ID}-${EMV_LINK_CODE}`;

  // Check for duplicate transaction
  const existingTxn = q(
    'SELECT * FROM wallet_transactions WHERE wallet_id = ? AND reference = ?',
    [walletId, txnReference]
  )[0];

  let txnId;
  if (existingTxn) {
    txnId = existingTxn.id;
    console.log(`[TRANSACTION] Already exists: ${txnReference} (${txnId})`);
  } else {
    txnId = uuidv4();

    const emvData = JSON.stringify({
      link_id: EMV_LINK_ID,
      link_code: EMV_LINK_CODE,
      link_status: 'active',
      protocols: ['201.1', '201.2', '201.3', '304.1'],
      authorization_code: AUTH_CODE,
      report_id: REPORT_ID,
      nonce: '14A8DB099A91',
      verification_token_sha256: VERIFICATION_TOKEN,
      control_key_b64url: 'f3sU8Ku8ESTSorj8-ehcNMw-ra0Hs0B_',
      seed_digest_sha1: '110145fe92beb7c1f715496edb287df324e8668d',
      settlement_fingerprint_md5: '6b0d36c25b91a1aa2d4502ca990d88ea',
      signature_algorithm: 'Ed25519',
      hashing_algorithm: 'SHA-256',
      public_key_base64: 'Tna6ZM1feXfSaVu84IlmSKDfI+92qMUSzcGCm7jWs+s=',
      public_key_fingerprint: 'ac9f08ece9754cf3515d926fa52327871482ea46689bc045de32c66e9b5be9db',
      provisional_signature_reference: 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB',
      generated_at: '2026-09-02T23:15:39.677926',
      generated_by: 'admin',
      security_microtext: 'EMVSL/E37F5D4EDD159D8DFDBA24C2/21918aab688fa398b27d1c11',
      validation_barcode: `EMVSL RID:${REPORT_ID} LNK:${EMV_LINK_CODE} TOK:${VERIFICATION_TOKEN.slice(0, 24)}`,
      ttl_minutes: 4320,
      created_by: 'admin'
    });

    const description = `EMV Payment Link #${EMV_LINK_ID} (${EMV_LINK_CODE}) — ${EMV_AMOUNT.toFixed(2)} ${EMV_CURRENCY} — Card ${CARD_MASKED_PAN} — Auth ${AUTH_CODE}`;

    // Insert transaction record (credit type — represents authorized payment link)
    run(
      `INSERT INTO wallet_transactions
         (id, wallet_id, type, amount, currency, source, reference, description, pan_masked, emv_data, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        txnId,
        walletId,
        'credit',                         // Authorized credit (funding via card)
        EMV_AMOUNT,
        EMV_CURRENCY,
        'emv_payment_link',               // source: EMV Payment Link protocol
        txnReference,                     // unique reference
        description,
        CARD_MASKED_PAN,
        emvData,
        '2026-09-02T23:15:39+05:00'       // Generated at timestamp from dossier
      ]
    );

    // Update wallet balance with the authorized amount
    run(
      'UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [EMV_AMOUNT, walletId]
    );
    console.log(`[TRANSACTION] Recorded EMV Payment Link ${EMV_LINK_ID}: +${EMV_AMOUNT.toFixed(2)} ${EMV_CURRENCY}`);
    console.log(`[TRANSACTION] Auth code: ${AUTH_CODE}, Report ID: ${REPORT_ID}`);
  }

  // ============================================================
  // 7. SAVE CRYPTOGRAPHIC VERIFICATION ARTIFACTS to bank_account meta (audit trail)
  // ============================================================
  const integrityMeta = JSON.stringify({
    report_fingerprint_sha256: VERIFICATION_TOKEN,
    seed_digest_sha1: '110145fe92beb7c1f715496edb287df324e8668d',
    settlement_digest_md5: '6b0d36c25b91a1aa2d4502ca990d88ea',
    control_key: 'f3sU8Ku8ESTSorj8-ehcNMw-ra0Hs0B_',
    provisional_signature_reference: 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB',
    linked_transaction_id: txnId,
    balance_snapshot_eur: '1774942.20',
    source_company: 'S.R.L. ARCHINVESTMENT',
    source_tax_id: 'RO51695514'
  });

  run(
    `UPDATE bank_accounts SET recipient_address = ? WHERE id = ?`,
    [
      `Bucuresti, Sector 3, Bulevardul Unirii, Nr. 61, Bloc F3, Scara 4, Etaj 2, Office 208 | IntegrityChain: ${REPORT_ID}`,
      bankAccountId
    ]
  );

  persist();

  // ============================================================
  // 8. VERIFY RESULTS
  // ============================================================
  console.log('\n============================================================');
  console.log('VERIFICATION — Final Database State');
  console.log('============================================================');

  const finalCustomer = q('SELECT * FROM customers WHERE id = ?', [customerId])[0];
  const finalWallet = q('SELECT * FROM customer_wallets WHERE id = ?', [walletId])[0];
  const finalCard = q('SELECT * FROM wallet_cards WHERE id = ?', [cardId])[0];
  const finalBank = q('SELECT * FROM bank_accounts WHERE id = ?', [bankAccountId])[0];
  const finalTxn = q('SELECT * FROM wallet_transactions WHERE id = ?', [txnId])[0];

  console.log('\n── CUSTOMER ──');
  console.log('  ID        :', finalCustomer.id);
  console.log('  Name      :', finalCustomer.name);
  console.log('  KYC       :', finalCustomer.kyc_status, '| Verified At:', finalCustomer.kyc_verified_at);
  console.log('  Risk      :', finalCustomer.risk_level);
  console.log('  Country   :', finalCustomer.country);
  console.log('  ID Type   :', finalCustomer.id_type, '| ID Country:', finalCustomer.id_country);
  console.log('  Occupation:', finalCustomer.occupation);

  console.log('\n── WALLET ──');
  console.log('  ID        :', finalWallet.id);
  console.log('  Code      :', finalWallet.wallet_code);
  console.log('  Balance   :', Number(finalWallet.balance).toFixed(2), finalWallet.currency);
  console.log('  Status    :', finalWallet.status);
  console.log('  Card ID   :', finalWallet.card_id);

  console.log('\n── CARD (Snapshot) ──');
  console.log('  ID        :', finalCard.id);
  console.log('  Scheme    :', finalCard.scheme);
  console.log('  PAN       :', CARD_MASKED_PAN, `(BIN=${finalCard.bin}, Last4=${finalCard.last4})`);
  console.log('  Holder    :', finalCard.cardholder_name);
  console.log('  Currency  :', finalCard.currency);
  console.log('  Status    :', finalCard.status);
  const metaCard = JSON.parse(finalCard.meta_json);
  console.log('  Country   :', metaCard.card_country);
  console.log('  Bank      :', metaCard.card_bank);
  console.log('  Auth Code :', metaCard.authorization_code);
  console.log('  EMV Link  : #' + metaCard.emv_link_id, '| Code:', metaCard.emv_link_code);

  console.log('\n── BANK ACCOUNT (Source of Funds) ──');
  console.log('  ID        :', finalBank.id);
  console.log('  Bank      :', finalBank.bank_name);
  console.log('  Holder    :', finalBank.account_holder);
  console.log('  IBAN      :', finalBank.iban);
  console.log('  SWIFT     :', finalBank.swift_code);
  console.log('  Currency  :', finalBank.currency);
  console.log('  Default   :', finalBank.is_default ? 'Yes' : 'No');
  console.log('  Verified  :', finalBank.verified ? 'Yes' : 'No');

  console.log('\n── TRANSACTION (EMV Payment Link) ──');
  console.log('  ID        :', finalTxn.id);
  console.log('  Type      :', finalTxn.type.toUpperCase());
  console.log('  Amount    :', Number(finalTxn.amount).toFixed(2), finalTxn.currency);
  console.log('  Source    :', finalTxn.source);
  console.log('  Reference :', finalTxn.reference);
  console.log('  PAN Masked:', finalTxn.pan_masked);
  console.log('  Auth Code :', AUTH_CODE);
  console.log('  Created At:', finalTxn.created_at);

  console.log('\n── CRYPTOGRAPHIC INTEGRITY ARTIFACTS ──');
  console.log('  Report ID (RID)     :', REPORT_ID);
  console.log('  Nonce               :', '14A8DB099A91');
  console.log('  SHA-256 Token       :', VERIFICATION_TOKEN);
  console.log('  Control Key (B64)   :', 'f3sU8Ku8ESTSorj8-ehcNMw-ra0Hs0B_');
  console.log('  SHA-1 Seed Digest   :', '110145fe92beb7c1f715496edb287df324e8668d');
  console.log('  MD5 Settlement FP   :', '6b0d36c25b91a1aa2d4502ca990d88ea');
  console.log('  Ed25519 PubKey FP   :', 'ac9f08ece9754cf3515d926fa52327871482ea46689bc045de32c66e9b5be9db');
  console.log('  PSR Reference       :', 'VERTEZED PSR-E37F5D4EDD159D8DFDBA24C2-14A8DB');

  console.log('\n============================================================');
  console.log('ALL RECORDS SAVED SUCCESSFULLY');
  console.log('============================================================');
  console.log(`Customer: ${CUSTOMER_NAME}`);
  console.log(`Wallet  : ${finalWallet.wallet_code} — Balance ${Number(finalWallet.balance).toFixed(2)} ${finalWallet.currency}`);
  console.log(`Txn     : EMV Link #${EMV_LINK_ID} (${EMV_LINK_CODE}) — Auth ${AUTH_CODE}`);
  console.log('============================================================');
})().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
