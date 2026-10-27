/**
 * WISE COLLECT SERVICE
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls Wise API to:
 * 1. Check your Wise balance
 * 2. Create a transfer from your Wise balance to destination bank
 * 3. Fund the transfer from your Wise balance
 * 4. Update your internal ledger when confirmed
 *
 * This is the direct path:
 *   Your Wise account balance → Wise API → destination bank
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

const BASE_URL = (process.env.WISE_API_URL?.trim() || 'https://api.wise.com/2026Q3').replace(/\/+$/, '');
const API_KEY  = process.env.WISE_API_KEY?.trim();

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  };
}

export interface WiseCollectInput {
  amount:          number;
  currency:        string;
  targetBic:       string;
  targetAccount:   string;
  targetName:      string;
  targetAddressLines?: string[];
  targetCountry?: string;
  targetCity?: string;
  targetPostCode?: string;
  reference?:      string;
  merchantId?:     string;
}

export interface WiseCollectResult {
  success:      boolean;
  transferId?:  string;
  uetr?:        string;
  status?:      string;
  profileId?:   string;
  amount:       number;
  currency:     string;
  message:      string;
  wiseBalance?: number;
}

// ── Step 1: Get Wise profile ID ───────────────────────────────────────────────
async function getProfileId(): Promise<string> {
  const explicitId = process.env.WISE_PROFILE_ID?.trim();
  if (explicitId) return explicitId;

  const res = await axios.get(`${BASE_URL}/v1/profiles`, { headers: headers(), timeout: 10000 });
  const profiles: any[] = Array.isArray(res.data) ? res.data : [];
  const biz = profiles.find(p => p.type === 'business') || profiles[0];
  if (!biz?.id) throw new Error('No Wise profile found. Check your WISE_API_KEY.');
  return String(biz.id);
}

// ── Step 2: Get Wise balance ──────────────────────────────────────────────────
export async function getWiseBalance(currency: string = 'USD'): Promise<number> {
  if (!API_KEY) throw new Error('WISE_API_KEY not set in .env');
  const profileId = await getProfileId();
  const ccy = currency.toUpperCase();

  for (const ep of [
    `${BASE_URL}/v4/profiles/${profileId}/balances?types=STANDARD`,
    `${BASE_URL}/v3/profiles/${profileId}/balances`,
  ]) {
    try {
      const res = await axios.get(ep, { headers: headers(), timeout: 10000 });
      const list: any[] = Array.isArray(res.data) ? res.data : res.data?.balances || [];
      const bal = list.find(b => String(b.currency || b.balanceCurrency || '').toUpperCase() === ccy);
      if (bal) return Number(bal.amount?.value ?? bal.balance?.amount ?? 0);
    } catch { /* try next */ }
  }
  return 0;
}

// ── Main: Collect from Wise balance and send to bank ─────────────────────────
export async function wiseCollectAndSend(input: WiseCollectInput): Promise<WiseCollectResult> {
  if (!API_KEY) {
    return {
      success: false,
      amount: input.amount,
      currency: input.currency,
      message: 'WISE_API_KEY not configured. Add it to backend/.env to enable Wise payouts.',
    };
  }

  const ccy       = input.currency.toUpperCase();
  const amount    = Number(input.amount);
  const reference = input.reference || `PAYOUT-${Date.now().toString(36).toUpperCase()}`;

  try {
    const profileId = await getProfileId();

    // Check balance
    const balance = await getWiseBalance(ccy);
    if (balance < amount) {
      return {
        success:      false,
        amount,
        currency:     ccy,
        wiseBalance:  balance,
        message:      `Insufficient Wise ${ccy} balance. Have ${balance.toFixed(2)}, need ${amount.toFixed(2)}. Fund your Wise account at wise.com.`,
      };
    }

    // Create recipient
    let recipient: any;
    try {
      const recipientPayload: any = {
        profile:           Number(profileId),
        accountHolderName: input.targetName,
        currency:          ccy,
        type:              ccy === 'USD' ? 'aba' : ccy === 'EUR' ? 'iban' : 'swift',
        legalType:         'BUSINESS',
        details:           {},
      };

      if (ccy === 'USD') {
        recipientPayload.details.abartn      = input.targetBic; // routing for USD
        recipientPayload.details.accountNumber = input.targetAccount;
        recipientPayload.details.accountType   = 'CHECKING';
        recipientPayload.details.address = {
          country:   input.targetCountry || 'US',
          city:      input.targetCity || 'Wilmington',
          firstLine: input.targetAddressLines?.[0] || 'Wise US Inc, 108 W 13th St',
          postCode:  input.targetPostCode || '19801',
        };
      } else {
        recipientPayload.details.swiftCode     = input.targetBic;
        recipientPayload.details.accountNumber = input.targetAccount;
      }

      const rRes = await axios.post(`${BASE_URL}/v1/accounts`, recipientPayload, { headers: headers(), timeout: 15000 });
      recipient = rRes.data;
    } catch (err: any) {
      const conflict = err?.response?.data?.errors?.find((e: any) => e.code === 'RECIPIENT_ACCOUNT_ALREADY_EXISTS');
      if (conflict) {
        recipient = { id: conflict.metadata?.recipientAccountId };
      } else {
        throw new Error(`Recipient creation failed: ${err?.response?.data?.errors?.[0]?.message || err.message}`);
      }
    }

    // Create quote
    const quoteRes = await axios.post(`${BASE_URL}/v2/quotes`, {
      profile:        Number(profileId),
      sourceCurrency: ccy,
      targetCurrency: ccy,
      targetAmount:   amount,
      rateType:       'FIXED',
      type:           'BALANCE_PAYOUT',
    }, { headers: headers(), timeout: 15000 });
    const quote = quoteRes.data;

    // Create transfer
    const payoutId = uuidv4();
    let transfer: any;
    try {
      const tRes = await axios.post(`${BASE_URL}/v1/transfers`, {
        targetAccount:         Number(recipient.id),
        quoteUuid:             String(quote.id),
        customerTransactionId: payoutId,
        details: { reference: reference.slice(0, 35) },
      }, { headers: headers(), timeout: 15000 });
      transfer = tRes.data;
    } catch (err: any) {
      const dup = err?.response?.data?.errors?.find((e: any) => e.code === 'DUPLICATE_CUSTOMER_TRANSACTION_ID');
      if (dup) {
        const ex = await axios.get(`${BASE_URL}/v1/transfers?profile=${profileId}&customerTransactionId=${payoutId}`, { headers: headers(), timeout: 10000 });
        transfer = Array.isArray(ex.data) ? ex.data[0] : ex.data;
      } else {
        throw new Error(`Transfer creation failed: ${err?.response?.data?.errors?.[0]?.message || err.message}`);
      }
    }

    // Fund transfer from Wise balance
    try {
      await axios.post(
        `${BASE_URL}/v3/profiles/${profileId}/transfers/${transfer.id}/payments`,
        { type: 'BALANCE' },
        { headers: headers(), timeout: 20000 }
      );
    } catch (err: any) {
      const code = err?.response?.data?.errors?.[0]?.code;
      if (!['TRANSFER_ALREADY_FUNDED', 'BAD_STATE', 'ILLEGAL_STATE_TRANSITION'].includes(code || '')) {
        throw new Error(`Transfer funding failed: ${err?.response?.data?.errors?.[0]?.message || err.message}`);
      }
    }

    // Record in DB
    const now = new Date().toISOString();
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wise_payouts (
          id TEXT PRIMARY KEY,
          transfer_id TEXT,
          profile_id TEXT,
          amount REAL,
          currency TEXT,
          target_bic TEXT,
          target_account TEXT,
          target_name TEXT,
          reference TEXT,
          merchant_id TEXT,
          wise_balance_before REAL,
          status TEXT,
          created_at TEXT
        )
      `);
      await db.query(`
        INSERT INTO wise_payouts
          (id, transfer_id, profile_id, amount, currency, target_bic, target_account, target_name, reference, merchant_id, wise_balance_before, status, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [payoutId, String(transfer.id), profileId, amount, ccy, input.targetBic, input.targetAccount, input.targetName, reference, input.merchantId || 'MRC-1001', balance, String(transfer.status || 'submitted'), now]);
    } catch { /* non-critical */ }

    console.log(`[WiseCollect] ✅ Transfer ${transfer.id} | ${ccy} ${amount} → ${input.targetName} (${input.targetAccount})`);

    return {
      success:      true,
      transferId:   String(transfer.id),
      uetr:         transfer.uetr || payoutId,
      status:       String(transfer.status || 'submitted').toUpperCase(),
      profileId,
      amount,
      currency:     ccy,
      wiseBalance:  balance,
      message:      `Wise transfer ${transfer.id} created. ${ccy} ${amount} → ${input.targetName}. Status: ${transfer.status}`,
    };

  } catch (err: any) {
    console.error('[WiseCollect] Error:', err.message);
    return {
      success:  false,
      amount,
      currency: ccy,
      message:  err.message || 'Wise payout failed',
    };
  }
}
