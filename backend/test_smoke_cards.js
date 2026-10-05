process.env.NODE_ENV = 'test';
process.chdir(require('path').resolve(__dirname));

require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { target: 'ES2020', module: 'commonjs', esModuleInterop: true, strict: false } });

(async () => {
  const { issueVaultCard, issueVaultBankCard, getAllVaultCards, getActiveVaultCardByAccount } = require('./src/domain/vault/vaultCardService');
  const { luhnValidate } = require('./src/domain/vault/luhn');
  const { VAULT_BINS } = require('./src/domain/vault/vaultBin');

  const assert = (cond, msg) => {
    if (!cond) { console.error('  ❌ FAIL:', msg); process.exitCode = 1; }
    else console.log('  ✅ PASS:', msg);
  };

  console.log('\n═══════ SMOKE: vault card BIN dictionary ═══════');
  assert(Object.keys(VAULT_BINS).length === 3, 'VAULT_BINS has 3 entries');
  assert(VAULT_BINS['PROC-VAULT-USD-002'].bin === '412345', 'PROC-VAULT-USD-002 bin=412345');
  assert(VAULT_BINS['PROC-VAULT-USD-002'].scheme === 'VISA', 'PROC-VAULT-USD-002 scheme=VISA');
  assert(VAULT_BINS['PROC-VAULT-USD-002'].country === 'US', 'PROC-VAULT-USD-002 country=US');
  assert(VAULT_BINS['PROC-VAULT-EUR-001'].bin === '423456', 'PROC-VAULT-EUR-001 bin=423456');
  assert(VAULT_BINS['PROC-VAULT-EUR-001'].scheme === 'VISA', 'PROC-VAULT-EUR-001 scheme=VISA');
  assert(VAULT_BINS['PROC-VAULT-EUR-001'].country === 'BE', 'PROC-VAULT-EUR-001 country=BE');
  assert(VAULT_BINS['VAULT-WISE-EUR-001'].bin === '532345', 'VAULT-WISE-EUR-001 bin=532345');
  assert(VAULT_BINS['VAULT-WISE-EUR-001'].scheme === 'MASTERCARD', 'VAULT-WISE-EUR-001 scheme=MASTERCARD');
  assert(VAULT_BINS['VAULT-WISE-EUR-001'].country === 'DE', 'VAULT-WISE-EUR-001 country=DE');

  console.log('\n═══════ SMOKE: Luhn validator + PAN generator ═══════');
  const samplePan = '4532015112830366';
  assert(luhnValidate(samplePan) === true, 'Luhn validates known-good Visa PAN');
  assert(luhnValidate('4532015112830367') === false, 'Luhn rejects known-bad PAN');
  assert(luhnValidate('1234567890123456') === false, 'Luhn rejects non-Luhn PAN');
  assert(luhnValidate('') === false, 'Luhn rejects empty');
  assert(luhnValidate('abcd1234') === false, 'Luhn rejects non-digit');

  const generatedPan = require('./src/domain/vault/luhn').generatePan('412345');
  assert(/^412345\d{10}$/.test(generatedPan), 'generatePan(412345) gives 16-digit 412345-prefixed PAN');
  assert(luhnValidate(generatedPan) === true, 'generatePan output passes Luhn');

  const vaultAccounts = ['PROC-VAULT-USD-002', 'PROC-VAULT-EUR-001', 'VAULT-WISE-EUR-001'];
  const issuedCards = [];

  console.log('\n═══════ SMOKE: issue 1 card per vault account ═══════');
  for (const acct of vaultAccounts) {
    console.log(`  → issuing card for ${acct}…`);
    const card = await issueVaultCard(acct);
    issuedCards.push(card);
    const binInfo = VAULT_BINS[acct];
    assert(!!card.id && /^[0-9a-f-]{36}$/i.test(card.id), `${acct}: returned uuid id`);
    assert(card.vault_account_id === acct, `${acct}: vault_account_id matches`);
    assert(card.bin === binInfo.bin, `${acct}: bin matches ${binInfo.bin}`);
    assert(card.scheme === binInfo.scheme, `${acct}: scheme matches ${binInfo.scheme}`);
    assert(card.product === binInfo.product, `${acct}: product=DEBIT`);
    assert(card.country === binInfo.country, `${acct}: country matches ${binInfo.country}`);
    assert(card.status === 'ACTIVE', `${acct}: status=ACTIVE`);
    assert(card.card_number.length === 16, `${acct}: card_number is 16 digits`);
    assert(card.card_number.startsWith(binInfo.bin), `${acct}: card_number starts with ${binInfo.bin}`);
    assert(card.card_number.slice(-4) === card.last4, `${acct}: last4 matches slice(-4)`);
    assert(luhnValidate(card.card_number), `${acct}: card_number passes Luhn`);
    assert(/^\d{2}\/\d{2}$/.test(card.expiry), `${acct}: expiry format MM/YY`);
    const [expMm, expYy] = card.expiry.split('/').map((x) => parseInt(x, 10));
    assert(expMm >= 1 && expMm <= 12, `${acct}: expiry month in 1..12`);
    const thisYear5 = (new Date().getFullYear() + 5) % 100;
    assert(expYy === thisYear5, `${acct}: expiry year = +5 years = ${thisYear5}`);
    assert(/^\d{3}$/.test(card.cvv), `${acct}: cvv is 3 digits`);
    const cvvN = parseInt(card.cvv, 10);
    assert(cvvN >= 100 && cvvN <= 999, `${acct}: cvv in 100..999 range`);
    assert(!!card.created_at, `${acct}: created_at populated`);
    console.log(`    ✔ ${card.scheme} BIN=${card.bin} last4=${card.last4} exp=${card.expiry} cvv=${card.cvv}`);
  }

  console.log('\n═══════ SMOKE: BIN_NOT_DEFINED + fallback bank card ═══════');
  let threwDefined = false;
  try { await issueVaultCard('INVALID-VAULT-999'); } catch (e) {
    threwDefined = e && e.code === 'BIN_NOT_DEFINED_FOR_VAULT';
    console.log('  → strict issueVaultCard(INVALID) threw code:', e && e.code);
  }
  assert(threwDefined, 'issueVaultCard(UNKNOWN) throws BIN_NOT_DEFINED_FOR_VAULT');

  const fallbackCard = await issueVaultBankCard('INVALID-VAULT-999');
  assert(fallbackCard.bin === '412345', 'issueVaultBankCard(UNKNOWN) fallback BIN=412345');
  assert(fallbackCard.scheme === 'VISA', 'issueVaultBankCard(UNKNOWN) fallback scheme=VISA');
  assert(fallbackCard.country === 'AE', 'issueVaultBankCard(UNKNOWN) fallback country=AE');
  assert(luhnValidate(fallbackCard.card_number), 'fallback card PAN passes Luhn');

  console.log('\n═══════ SMOKE: CVV masked on list reads ═══════');
  const list = await getAllVaultCards();
  console.log(`  → total cards in list: ${list.length}`);
  let anyNonMasked = false;
  for (const c of list) {
    if (c.cvv !== '***') { anyNonMasked = true; console.log('    ❗ unmasked cvv on card id=' + c.id + ' cvv=' + c.cvv); }
  }
  assert(list.length > 0, 'getAllVaultCards returns rows (at minimum the ones just issued)');
  assert(!anyNonMasked, 'getAllVaultCards masks every cvv to ***');

  console.log('\n═══════ SMOKE: active card lookup returns ACTIVE raw CVV ═══════');
  const activeUsd = await getActiveVaultCardByAccount('PROC-VAULT-USD-002');
  assert(!!activeUsd, 'getActiveVaultCardByAccount returns row for PROC-VAULT-USD-002');
  assert(activeUsd.status === 'ACTIVE', 'active row status=ACTIVE');
  assert(/^\d{3}$/.test(activeUsd.cvv), 'active lookup returns RAW 3-digit cvv (NOT ***)');
  assert(activeUsd.vault_account_id === 'PROC-VAULT-USD-002', 'active row vault_account_id matches');

  console.log('\n═══════ SMOKE: vaultPayoutEngine imports + type shape ═══════');
  const payoutEngine = require('./src/domain/payouts/vaultPayoutEngine');
  assert(typeof payoutEngine.VaultPayoutEngine === 'function' || typeof payoutEngine.VaultPayoutEngine?.executeCardPayout === 'function' || !!payoutEngine.VaultPayoutEngine?.prototype, 'VaultPayoutEngine exported');
  assert(payoutEngine.VaultPayoutEngine != null, 'VaultPayoutEngine not null/undefined');

  console.log('\n═══════ SMOKE SUMMARY ═══════');
  if (process.exitCode) console.log('\n❌ Some assertions FAILED (see above).');
  else console.log('\n✅ All smoke assertions PASSED.');
})().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exit(2); });
