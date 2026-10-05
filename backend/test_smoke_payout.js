process.env.NODE_ENV = 'test';
process.chdir(require('path').resolve(__dirname));

require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { target: 'ES2020', module: 'commonjs', esModuleInterop: true, strict: false } });

(async () => {
  const { vaultPayoutEngine } = require('./src/domain/payouts/vaultPayoutEngine');
  const { db } = require('./src/config/db');

  const assert = (cond, msg) => {
    if (!cond) { console.error('  ❌ FAIL:', msg); process.exitCode = 1; }
    else console.log('  ✅ PASS:', msg);
  };

  const VAULT = 'PROC-VAULT-USD-002';
  const AMT = 0.25;
  const CCY = 'USD';

  const getAcct = async () => {
    const r = await db.query(
      `SELECT id, currency, balance, available_balance, reserved_hold, payout_in_progress, updated_at
         FROM vault_accounts WHERE id = ?`,
      [VAULT],
    );
    return r.rows[0];
  };

  console.log('\n═══════ SMOKE: executeCardPayout PROC-VAULT-USD-002 @', AMT, CCY, '═══════');

  const before = await getAcct();
  console.log('  before balance=', before.balance, 'avail=', before.available_balance,
              'hold=', before.reserved_hold, 'payout_in_progress=', before.payout_in_progress);
  assert(!!before, 'vault account PROC-VAULT-USD-002 exists');
  assert(before.currency === CCY, 'vault account currency=USD');
  assert(Number(before.balance) >= AMT, `balance >= ${AMT}`);

  const beforeEntries = await db.query(
    `SELECT COUNT(*) AS cnt FROM vault_entries WHERE account_id = ?`,
    [VAULT],
  );
  const beforeEntriesCnt = Number(beforeEntries.rows[0].cnt);
  console.log('  before vault_entries count for account =', beforeEntriesCnt);

  let result;
  try {
    result = await vaultPayoutEngine.executeCardPayout({
      vault_account_id: VAULT,
      amount: AMT,
      currency: CCY,
      reference: 'SMOKE-TEST-' + Date.now().toString(36),
      merchant_id: 'SMOKE-TEST-MID',
    });
    console.log('  result.success =', result && result.success);
    console.log('  result.status =', result && result.status);
    console.log('  result.rail =', result && result.rail);
    console.log('  result.network_reference =', result && result.network_reference);
    console.log('  result.payout_id =', result && result.payout_id);
    if (result && result.vault_card) {
      console.log('  result.vault_card.scheme =', result.vault_card.scheme,
                  'last4 =', result.vault_card.last4, 'bin =', result.vault_card.bin);
    }
  } catch (e) {
    console.error('  executeCardPayout THREW:', e && (e.stack || e.message || e));
    process.exitCode = 1;
  }

  assert(result && result.success === true, 'executeCardPayout returned success=true');
  assert(result && ['VISA_DIRECT', 'MC_SEND', 'LOCAL_RAIL'].includes(result.rail),
         'rail is valid scheme tag: ' + (result && result.rail));
  assert(result && result.status === 'COMPLETED', 'payout status=COMPLETED');
  assert(result && result.payout_id && result.payout_id.length >= 10, 'payout_id populated');
  assert(result && result.vault_card && result.vault_card.last4, 'vault_card subset in result');
  assert(result && result.vault_card && result.vault_card.bin === '412345', 'card bin=412345 (USD vault)');
  assert(result && result.vault_card && result.vault_card.scheme === 'VISA', 'card scheme=VISA (USD vault)');

  await new Promise((r) => setTimeout(r, 800));
  const after = await getAcct();
  console.log('  after  balance=', after.balance, 'avail=', after.available_balance,
              'hold=', after.reserved_hold, 'payout_in_progress=', after.payout_in_progress);

  const balanceDelta = Number((Number(before.balance) - Number(after.balance)).toFixed(6));
  assert(balanceDelta === AMT, `balance decreased by exactly ${AMT} (actual delta=${balanceDelta})`);
  assert(Number(after.reserved_hold) === Number(before.reserved_hold),
         'reserved_hold returned to initial (hold placed & released)');
  assert(Number(after.payout_in_progress) === Number(before.payout_in_progress),
         'payout_in_progress returned to initial');

  const afterEntries = await db.query(
    `SELECT COUNT(*) AS cnt FROM vault_entries WHERE account_id = ?`,
    [VAULT],
  );
  const afterEntriesCnt = Number(afterEntries.rows[0].cnt);
  const entriesDelta = afterEntriesCnt - beforeEntriesCnt;
  console.log('  after vault_entries count =', afterEntriesCnt, ' delta =', entriesDelta);
  assert(entriesDelta === 2, 'vault_entries delta = 2 (RESERVED hold debit + SETTLED debit)');

  const latest = await db.query(
    `SELECT id, direction, amount, currency, source, status, metadata, created_at
       FROM vault_entries
      WHERE account_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 2`,
    [VAULT],
  );
  console.log('  last 2 vault_entries for this account:');
  const sorted = latest.rows.slice().reverse();
  sorted.forEach((r) => {
    const meta = (() => { try { return JSON.parse(r.metadata); } catch (_) { return {}; } })();
    console.log(`    - ${r.source} phase=${meta.phase || 'n/a'} direction=${r.direction} amount=${r.amount}${r.currency} status=${r.status}`);
  });
  assert(sorted[0] && sorted[0].source === 'vault_card_payout',
         '1st entry source=vault_card_payout (RESERVED hold)');
  assert(sorted[0] && sorted[0].direction === 'debit', '1st entry direction=debit (hold)');
  const meta0 = (() => { try { return JSON.parse(sorted[0].metadata); } catch (_) { return {}; } })();
  assert(meta0.phase === 'RESERVED', '1st entry metadata.phase=RESERVED');
  assert(sorted[1] && sorted[1].source === 'vault_card_payout_settled',
         '2nd entry source=vault_card_payout_settled (SETTLED final debit)');
  assert(sorted[1] && sorted[1].direction === 'debit', '2nd entry direction=debit (settled)');
  const meta1 = (() => { try { return JSON.parse(sorted[1].metadata); } catch (_) { return {}; } })();
  assert(meta1.vault_card_id && typeof meta1.vault_card_id === 'string', '2nd entry has vault_card_id in metadata');
  assert(meta1.vault_card_scheme === 'VISA', '2nd entry metadata vault_card_scheme=VISA');
  assert('channel' in meta1, '2nd entry metadata includes channel field');
  assert(Number(sorted[0].amount) === AMT, '1st entry amount === payout amount');
  assert(Number(sorted[1].amount) === AMT, '2nd entry amount === payout amount');

  console.log('\n═══════ SMOKE SUMMARY ═══════');
  if (process.exitCode) console.log('\n❌ Some assertions FAILED (see above).');
  else console.log(`\n✅ All payout ledger assertions PASSED. 0.25 USD debited from ${VAULT} with 2-entry chain.`);
})().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exit(2); });
