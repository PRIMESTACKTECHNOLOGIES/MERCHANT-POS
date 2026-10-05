import { readFileSync, writeFileSync } from "fs";
import initSqlJs from "sql.js";
import axios from "./node_modules/axios/dist/node/axios.cjs";

// Load .env
const envContent = readFileSync("./.env", "utf8");
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) return;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (key && val) process.env[key] = val;
});

const WISE_API_KEY = process.env.WISE_API_KEY?.trim();
const BASE_URL = process.env.WISE_API_URL?.trim() || 'https://api.transferwise.com';
const PAYOUT_ID = '4b121006-2df1-4d23-bcf0-847ea0f3983c';
const AMOUNT = 200;
const CURRENCY = 'USD';

if (!WISE_API_KEY) { console.error('âŒ WISE_API_KEY not set'); process.exit(1); }

console.log('âœ… Wise key:', WISE_API_KEY.slice(0,8) + '****');

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${WISE_API_KEY}` };

try {
  // Step 1: Get profile
  console.log('\nâ”€â”€ Step 1: Getting profile...');
  const profileRes = await axios.get(`${BASE_URL}/v1/profiles`, { headers, timeout: 10000 });
  const profiles = Array.isArray(profileRes.data) ? profileRes.data : [];
  const biz = profiles.find(p => p.type === 'business') || profiles[0];
  const profileId = String(biz.id);
  console.log('âœ… Profile:', profileId, `(${biz.type})`);

  // Step 2: Check Wise account requirements for USD
  console.log('\nâ”€â”€ Step 2: Getting account requirements for USD...');
  try {
    const reqRes = await axios.get(`${BASE_URL}/v1/account-requirements?source=USD&target=USD&sourceAmount=${AMOUNT}`, { headers, timeout: 10000 });
    console.log('Account requirement types:', Array.isArray(reqRes.data) ? reqRes.data.map(r => r.type).join(', ') : 'unknown');
  } catch (e) { console.log('Requirements check skipped:', e.message); }

  // Step 3: Create recipient with correct format
  console.log('\nâ”€â”€ Step 3: Creating recipient...');
  let recipient: any;
  try {
    const recipientRes = await axios.post(`${BASE_URL}/v1/accounts`, {
      profile: Number(profileId),
      accountHolderName: 'PRIMESTACK TECHNOLOGIES LLC',
      currency: 'USD',
      type: 'aba',
      legalType: 'BUSINESS',
      details: {
        abartn: '084009519',
        accountNumber: '343612919064346',
        accountType: 'CHECKING',
        address: {
          country: 'US',
          state: 'DE',
          city: 'Wilmington',
          postCode: '19801',
          firstLine: '108 W 13th St',
        },
      },
    }, { headers, timeout: 15000 });
    recipient = recipientRes.data;
    console.log('âœ… Recipient created:', recipient.id);
  } catch (err) {
    const conflict = err?.response?.data?.errors?.find((e) => e.code === 'RECIPIENT_ACCOUNT_ALREADY_EXISTS');
    if (conflict) {
      recipient = { id: conflict.metadata?.recipientAccountId };
      console.log('âœ… Recipient exists:', recipient.id);
    } else {
      console.error('Recipient error:', JSON.stringify(err?.response?.data, null, 2));
      throw new Error('Recipient creation failed: ' + (err?.response?.data?.errors?.[0]?.message || err.message));
    }
  }

  // Step 4: Create quote
  console.log('\nâ”€â”€ Step 4: Creating quote...');
  const quoteRes = await axios.post(`${BASE_URL}/v2/quotes`, {
    profile: Number(profileId),
    sourceCurrency: CURRENCY,
    targetCurrency: CURRENCY,
    targetAmount: AMOUNT,
    rateType: 'FIXED',
    type: 'BALANCE_PAYOUT',
  }, { headers, timeout: 15000 });
  const quote = quoteRes.data;
  console.log('âœ… Quote:', quote.id, '| Fee:', quote.fee?.total || 'N/A');

  // Step 5: Create transfer
  console.log('\nâ”€â”€ Step 5: Creating transfer...');
  let transfer: any;
  try {
    const tRes = await axios.post(`${BASE_URL}/v1/transfers`, {
      targetAccount: Number(recipient.id),
      quoteUuid: String(quote.id),
      customerTransactionId: PAYOUT_ID,
      details: { reference: 'POS-201.3-INTERNAL-200USD' },
    }, { headers, timeout: 15000 });
    transfer = tRes.data;
    console.log('âœ… Transfer:', transfer.id, '| Status:', transfer.status);
  } catch (err) {
    const dup = err?.response?.data?.errors?.find((e) => e.code === 'DUPLICATE_CUSTOMER_TRANSACTION_ID');
    if (dup) {
      const ex = await axios.get(`${BASE_URL}/v1/transfers?profile=${profileId}&customerTransactionId=${PAYOUT_ID}`, { headers, timeout: 10000 });
      transfer = Array.isArray(ex.data) ? ex.data[0] : ex.data;
      console.log('âœ… Transfer already exists:', transfer?.id, '| Status:', transfer?.status);
    } else {
      console.error('Transfer error:', JSON.stringify(err?.response?.data, null, 2));
      throw new Error('Transfer failed: ' + (err?.response?.data?.errors?.[0]?.message || err.message));
    }
  }

  // Step 6: Fund transfer
  console.log('\nâ”€â”€ Step 6: Funding transfer...');
  try {
    const fRes = await axios.post(`${BASE_URL}/v3/profiles/${profileId}/transfers/${transfer.id}/payments`, { type: 'BALANCE' }, { headers, timeout: 20000 });
    console.log('âœ… Funded:', fRes.data?.status || 'submitted');
  } catch (err) {
    const code = err?.response?.data?.errors?.[0]?.code;
    if (['TRANSFER_ALREADY_FUNDED','BAD_STATE','ILLEGAL_STATE_TRANSITION'].includes(code || '')) {
      console.log('âœ… Already funded/processing');
    } else {
      console.error('Funding error:', JSON.stringify(err?.response?.data, null, 2));
      throw new Error('Funding failed: ' + (err?.response?.data?.errors?.[0]?.message || err.message));
    }
  }

  // Update DB
  console.log('\nâ”€â”€ Updating database...');
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync("./data/database.sqlite"));
  db.run(`UPDATE merchant_payouts SET provider = 'internal/wise-rail', provider_reference = ?, status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [String(transfer.id), PAYOUT_ID]);
  const data = db.export();
  writeFileSync("./data/database.sqlite", Buffer.from(data));
  db.close();

  console.log('\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘  âœ… $200 SUBMITTED VIA WISE RAIL                 â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  Transfer ID : ${transfer.id}`);
  console.log(`  Status      : ${transfer.status}`);
  console.log(`  Amount      : USD 200`);
  console.log(`  Destination : PRIMESTACK TECHNOLOGIES LLC`);
  console.log(`  Account     : 343612919064346 (Wise US)`);
  console.log(`  Routing     : 084009519`);
  console.log('\n  Check Developer page â†’ ðŸ” Sync Now for final status.');

} catch (err) {
  console.error('\nâŒ FAILED:', err.message);
}

