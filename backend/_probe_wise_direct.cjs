require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getWiseDiagnostics } = require('./src/domain/payouts/payoutProvider.service.ts');

(async () => {
  console.log('Running Wise diagnostics (direct function call, no HTTP server needed)…\n');
  console.log('  BANK_PAYOUT_PROVIDER =', process.env.BANK_PAYOUT_PROVIDER);
  console.log('  WISE_API_URL         =', process.env.WISE_API_URL || '(default: api.transferwise.com)');
  console.log('  WISE_API_KEY (last 4)=', (process.env.WISE_API_KEY || '').slice(-4) || '(EMPTY)');
  console.log('  WISE_PROFILE_ID      =', process.env.WISE_PROFILE_ID || '(auto-resolve via GET /v1/profiles)');
  console.log('');

  try {
    const d = await getWiseDiagnostics();
    console.log('✅ getWiseDiagnostics SUCCESS — profile resolved to:', d.profileId, d.autoSavedProfileId ? '(auto-saved to .env)' : '');
    console.log('');
    console.log('Wise profile type:', d.profile?.type || '(unknown)');
    console.log('Balances:');
    if (!d.balances.length) console.log('  ⚠️  NO BALANCES — Wise account has zero funded balances.');
    d.balances.forEach(b => {
      const reserved = b.reservedAmount ? `  reserved=${b.reservedAmount.value} ${b.reservedAmount.currency}` : '';
      console.log(`  • ${b.currency.padEnd(6)} ${String(b.amount.value).padStart(14)} ${b.amount.currency}${reserved}   [id=${b.balanceId || '-'}]`);
    });
    if (d.warnings && d.warnings.length) {
      console.log('\nWarnings:');
      d.warnings.forEach(w => console.log('  ⚠️ ', w));
    } else {
      console.log('\nNo warnings. Configuration clean.');
    }
    console.log('\n  PREFLIGHT: For a $1,000 USD payout you need >= $1,005 USD in Wise USD balance (0.5% headroom).');
    const usd = d.balances.find(b => b.currency === 'USD');
    const usdAvail = Number(usd?.amount?.value || 0);
    if (usdAvail >= 1005) console.log(`  ✅  USD balance = $${usdAvail.toFixed(2)}  →  READY for $1,000 USD payout.`);
    else console.log(`  ❌  USD balance = $${usdAvail.toFixed(2)}  →  INSUFFICIENT. Top up Wise USD before submitting the payout.`);
  } catch (e) {
    console.error('\n❌ Wise diagnostics FAILED:');
    console.error('   ', e.message || String(e));
    if (e?.response?.data) console.error('   Raw:', JSON.stringify(e.response.data, null, 2).slice(0, 2000));
    console.error('\nTroubleshooting tips:');
    console.error('  • If 401 Unauthorized → WISE_API_KEY is wrong/revoked. Generate a new token at wise.com/settings/api-tokens.');
    console.error('  • If "WISE_PROFILE_ID not found" → 401 OR profile not visible under this token.');
    console.error('  • If ECONNREFUSED/ENOTFOUND → no internet, or firewall blocking outgoing to api.transferwise.com.');
    process.exit(1);
  }
})();
