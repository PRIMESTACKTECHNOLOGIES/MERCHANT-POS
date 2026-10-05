// _UPSERT_vault_bank_user_card.cjs — inserts the user-provided VISA card
//   PAN:    4002 4687 5424 6857   (Luhn valid, Visa)
//   Exp:    12/30
//   CVV:    547
// into wallet_cards, tied to the existing Vault Bank operator customer ID.
require('dotenv').config();
const { db } = require('./dist/config/db.js');
const virtualCard = require('./dist/utils/virtualCard.js');
const { v4: uuid } = require('uuid');

const PAN = '4002468754246857';  // user provided, no spaces
const EXP = '12/30';            // user provided
const CVV = '547';              // user provided
const CURRENCY = 'USD';
const SCHEME = 'VISA';
const CARDHOLDER = 'PRIMESTACK VAULT OPERATOR';
const SPENDING_LIMIT = 100000;

(async () => {
  // 1. Luhn validate — fail loud if the user's card doesn't pass
  const ok = virtualCard.validateLuhn(PAN);
  console.log(`[1] Luhn valid? ${PAN}  →  ${ok}`);
  if (!ok) { console.error('Luhn INVALID — abort.'); process.exit(1); }

  // 2. Find existing customers — prefer the one already used in wallet_cards
  let customerId = null;
  let customerName = CARDHOLDER;
  try {
    const existing = await db.query('SELECT id, customer_id FROM wallet_cards LIMIT 1');
    if (existing.rows && existing.rows.length > 0 && existing.rows[0].id) {
      customerId = existing.rows[0].customer_id;
      console.log(`[2] Reusing existing customer_id from wallet_cards: ${customerId}`);
    }
  } catch (e) { /* no rows / different schema */ }

  if (!customerId) {
    try {
      // Try read customers table, any shape
      const cols = await db.query('PRAGMA table_info(customers)');
      console.log(`[2] customers columns: ${cols.rows.map(r => r.name).join(', ')}`);
      const idCols = cols.rows.find(r => /^id$/i.test(r.name));
      const nameCols = cols.rows.find(r => /name/i.test(r.name));
      const sample = await db.query(`SELECT * FROM customers LIMIT 1`);
      if (sample.rows && sample.rows.length) {
        const row = sample.rows[0];
        customerId = String(row[idCols ? idCols.name : 'id']);
        if (nameCols && row[nameCols.name]) customerName = String(row[nameCols.name]);
        console.log(`[2] Found customers[0] id=${customerId} name=${customerName}`);
      }
    } catch (e) { console.log('[2] customers table not present or empty: ' + e.message); }
  }

  if (!customerId) {
    // Make a deterministic vault-operator customer id
    customerId = 'vault-bank-operator-' + PAN.slice(-4);
    console.log(`[2] No customers found — creating synthetic customer_id=${customerId}`);
    try {
      const initSql = await require('./dist/domain/setup/init_tables.js');
      if (typeof initSql.ensureTables === 'function') await initSql.ensureTables();
    } catch (_) {}
  }

  // 3. Format PAN + expiry + BIN
  const bin = PAN.slice(0, 6);
  const last4 = PAN.slice(-4);
  const [month, year] = EXP.split('/');
  const expMonth = String(month).padStart(2, '0');
  const expYear  = String(year).padStart(2, '0');

  // 4. Encrypt PAN using AES-256-GCM with env secret
  const { encrypted: panEnc, kid } = virtualCard.encryptPan(PAN);

  // 5. Deterministic card id — same card always gets same UUID (from SHA1 of PAN)
  const crypto = require('crypto');
  const cardIdDeterministic =
    'card-' + crypto.createHash('sha1').update(PAN + EXP + CURRENCY).digest('hex').slice(0, 36).replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'
    );
  const cardId = cardIdDeterministic;
  const now = new Date().toISOString();
  const metaJson = JSON.stringify({
    source: 'user-manual-issued',
    luhn_validated: ok,
    bin_scheme: SCHEME,
    issuer_rail: 'Vault Bank USD Settlement Card',
    protocol: '201.3',
  });

  // 6. UPSERT into wallet_cards
  await db.query(`
    INSERT INTO wallet_cards (
      id, customer_id, wallet_id, scheme, bin, last4, card_number,
      expiry_month, expiry_year, cvv, cardholder_name, currency, status,
      spending_limit, used_amount, pan_encrypted, pan_kid, meta_json,
      created_at, updated_at, activated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      scheme=excluded.scheme,
      bin=excluded.bin,
      last4=excluded.last4,
      card_number=excluded.card_number,
      expiry_month=excluded.expiry_month,
      expiry_year=excluded.expiry_year,
      cvv=excluded.cvv,
      cardholder_name=excluded.cardholder_name,
      currency=excluded.currency,
      status=excluded.status,
      spending_limit=excluded.spending_limit,
      pan_encrypted=excluded.pan_encrypted,
      pan_kid=excluded.pan_kid,
      meta_json=excluded.meta_json,
      updated_at=excluded.updated_at,
      activated_at=COALESCE(wallet_cards.activated_at, excluded.activated_at)
  `, [
    cardId, customerId, null /*wallet_id*/, SCHEME, bin, last4, PAN,
    expMonth, expYear, CVV, customerName, CURRENCY, 'ACTIVE',
    SPENDING_LIMIT, 0, panEnc, kid, metaJson,
    now, now, now,
  ]);
  console.log(`[3] ✅ UPSERTED wallet_cards.id=${cardId}`);
  console.log(`    customer_id = ${customerId}`);
  console.log(`    scheme/bin/last4 = ${SCHEME} ${bin} xxxx-xxxx ${last4}`);
  console.log(`    exp = ${expMonth}/${expYear}, cvv = ${CVV}, currency = ${CURRENCY}`);
  console.log(`    cardholder = ${customerName}`);
  console.log(`    spending_limit = ${SPENDING_LIMIT} ${CURRENCY}`);

  // 7. Final verification SELECT
  const ver = await db.query('SELECT id, customer_id, scheme, bin, last4, expiry_month, expiry_year, cvv, cardholder_name, currency, status, spending_limit, used_amount, created_at FROM wallet_cards WHERE id = ?', [cardId]);
  console.log(`[4] DB readback:\n` + JSON.stringify(ver.rows, null, 2));
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
