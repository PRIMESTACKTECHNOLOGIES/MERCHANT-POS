import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { walletsService } from '../wallets/wallets.service';
import { fundsSettlementService } from '../settlements/funds-settlement.service';
import { inboundTransactionService } from './inboundTransaction.service';
import { vaultEngine } from '../vault/vault.service';

/**
 * ──────────────────────────────────────────────────────────────────────────
 *  VAULT_BANK_OMNIBUS — Hard Guard for Real-World Fund Backing
 * ──────────────────────────────────────────────────────────────────────────
 *  Every merchant wallet credit MUST be backed by (a) a real Omnibus balance
 *  sufficient to cover the credit, and (b) a dual Omnibus → vault → merchant
 *  ledger entry chain so the vault accounts (source of withdrawable funds)
 *  always reconcile with the merchant/customer wallet balances.
 *
 *  We NEVER credit a wallet without:
 *    1. Verifying VAULT_BANK_OMNIBUS[ccy].balance >= amount (SHORTFALL CHECK)
 *    2. Debiting  OMNIBUS          : OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION
 *    3. Crediting VAULT (currency): CARD_CAPTURE         (= vault_accounts.balance += amount)
 *    4. Then, and only then, credit the merchant wallet row.
 * ──────────────────────────────────────────────────────────────────────────
 */
const OMNIBUS_ACCOUNT_ID = 'VAULT_BANK_OMNIBUS';

async function ensureOmnibusAccountsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS omnibus_accounts (
      account_id TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT 'VAULT BANK OMNIBUS',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, currency)
    )
  `);
  // Seed supported currencies for the Omnibus at 0.00 (operator must fund externally).
  const supportedCurrencies = ['USD','EUR','GBP','ZAR','AED','NGN','KES','GHS','INR','JPY','CAD','AUD','CHF'];
  const now = new Date().toISOString();
  for (const ccy of supportedCurrencies) {
    await db.query(
      `INSERT OR IGNORE INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
       VALUES (?, ?, 0.00, 'VAULT BANK OMNIBUS', ?, ?)`,
      [OMNIBUS_ACCOUNT_ID, ccy, now, now]
    );
  }
}

async function getOmnibusBalance(currency: string): Promise<number> {
  await ensureOmnibusAccountsTable();
  const res = await db.query(
    `SELECT balance FROM omnibus_accounts WHERE account_id = ? AND currency = ? LIMIT 1`,
    [OMNIBUS_ACCOUNT_ID, String(currency).toUpperCase()]
  );
  if (!res.rows.length) return 0;
  return Number(res.rows[0].balance || 0);
}

async function applyOmnibusBackedMerchantCredit(input: {
  amount: number;
  currency: string;
  merchantId: string;
  reference: string;
  captureRef: string;
  protocol: string;
  inbound?: any;
  walletId: string;
  now: string;
}) {
  const { amount, currency, merchantId, reference, captureRef, protocol, walletId, now, inbound } = input;

  // 1) OMNIBUS SHORTFALL CHECK — THE NON-NEGOTIABLE GATE.
  //    If the Omnibus does not have enough real (externally-funded) balance,
  //    we ABORT the merchant wallet credit. Period. No money from thin air.
  const omnibusBalance = await getOmnibusBalance(currency);
  if (!Number.isFinite(omnibusBalance) || omnibusBalance < amount) {
    const shortfall = Number.isFinite(omnibusBalance) ? (amount - omnibusBalance) : amount;
    const msg =
      `VAULT_BANK_OMNIBUS SHORTFALL: ${currency} Omnibus balance = ${omnibusBalance.toFixed(2)}, ` +
      `required = ${amount.toFixed(2)}, shortfall = ${shortfall.toFixed(2)}. ` +
      `Merchant wallet credit BLOCKED. Operator MUST first fund VAULT_BANK_OMNIBUS via external ` +
      `SWIFT/ACH/SEPA settlement confirmation BEFORE issuing this wallet credit.`;
    console.error('[OMNIBUS-GATE]', msg, { merchantId, reference, captureRef, protocol });
    throw Object.assign(new Error(msg), {
      code: 'OMNIBUS_SHORTFALL',
      currency,
      omnibusBalance,
      required: amount,
      shortfall,
    });
  }

  // 2) OMNIBUS DEBIT — funds move from Omnibus to cover the vault credit.
  //    This is the OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION dual entry per project memory.
  await db.query(
    `UPDATE omnibus_accounts SET balance = balance - ?, updated_at = ? WHERE account_id = ? AND currency = ?`,
    [amount, now, OMNIBUS_ACCOUNT_ID, currency]
  );
  await db.query(
    `INSERT INTO vault_ledger
      (id, ts, type, merchant_id, amount, currency, reference, status, meta)
     VALUES (?, ?, 'OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION', ?, ?, ?, ?, 'COMPLETED', ?)`,
    [
      uuidv4(), now, merchantId || null, -amount, currency, reference,
      JSON.stringify({
        phase: 'OMNIBUS_DEBIT',
        protocol,
        captureRef,
        omnibus_account: OMNIBUS_ACCOUNT_ID,
        omnibus_balance_before: omnibusBalance,
        omnibus_balance_after: omnibusBalance - amount,
        inbound_registration_id: inbound?.id || null,
        authorization_code: inbound?.authorizationCode || null,
        beneficiary_name: inbound?.beneficiaryName || null,
      })
    ]
  );

  // 3) VAULT CREDIT — vault_accounts.currency balance grows by amount.
  //    This ensures the Vault Bank API (merchantVaultTransfer.service.ts) sees
  //    real withdrawable coverage when the merchant later triggers a MANUAL
  //    wallet → vault payout. Also reflects the balance on the vault dashboard.
  await vaultEngine.creditVault({
    amount,
    currency,
    reference: `CARD_CAPTURE_VAULT_CREDIT-${captureRef}`,
    merchantId: merchantId || null,
    type: 'CARD_CAPTURE',
    meta: {
      phase: 'VAULT_CREDIT',
      protocol,
      sourceReference: reference,
      captureRef,
      inbound_registration_id: inbound?.id || null,
      authorization_code: inbound?.authorizationCode || null,
    },
  });

  // 4) MERCHANT WALLET CREDIT — the internal wallet row is incremented last,
  //    only AFTER vault-side real coverage has been posted.
  await db.query(
    'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
    [amount, now, walletId]
  );
  await db.query(
    `INSERT INTO merchant_wallet_transactions
      (id, wallet_id, type, amount, currency, source, reference, description, created_at)
     VALUES (?, ?, 'credit', ?, ?, 'internal_processor_capture', ?, ?, ?)`,
    [
      uuidv4(), walletId, amount, currency, captureRef,
      `Internal processor capture ${protocol} | Auth: ${reference} | Vault-backed (Omnibus ${currency} ${amount.toFixed(2)})`,
      now,
    ]
  );
}

export interface InternalCaptureInput {
  merchantId: string;
  amount: number;
  currency: string;
  authRef: string;
  transactionId: string;
  protocol: '101.1' | '101.6' | '201.3';
  batchId?: string;
  stan?: string;
  panMasked?: string;
  customerId?: string;
}

export async function confirmInternalCapture(input: InternalCaptureInput) {
  const amount = Number(input.amount);
  const currency = String(input.currency || 'USD').toUpperCase().trim();
  if (!input.merchantId || !input.authRef || !input.transactionId) {
    throw new Error('Internal capture requires merchant, authorization, and transaction references');
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Internal capture amount must be positive');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Internal capture currency is invalid');

  // ── Inbound Registration Gate: MANDATORY external fund verification ──
  // If the authRef maps to a pre-registered inbound_transaction_registrations row
  // (e.g. 101.1 Auth Code 0707), we MUST confirm fund_verification_status = 'VERIFIED'
  // BEFORE crediting ANY wallet. No simulation, no stand-in, no demo approval.
  const protocolStr = String(input.protocol || '').trim();
  const authCodeStr = String(input.authRef || '').trim().toUpperCase();
  const isInboundProtocol = protocolStr === '101.1' || protocolStr === '101.6' || protocolStr === '201.3';
  let matchedInboundReg: any = null;
  if (isInboundProtocol) {
    matchedInboundReg = await inboundTransactionService.findByAuthorizationCode(authCodeStr, protocolStr);
    if (!matchedInboundReg) {
      // Also try the short 4-digit style without protocol prefix if numeric-ish
      if (/^[0-9A-Z]{1,12}$/.test(authCodeStr)) {
        for (const protoTry of ['101.1', '101.6', '201.3']) {
          const alt = await inboundTransactionService.findByAuthorizationCode(authCodeStr, protoTry);
          if (alt) { matchedInboundReg = alt; break; }
        }
      }
    }
  }

  if (matchedInboundReg) {
    const fvs = String(matchedInboundReg.fundVerificationStatus || '').toUpperCase();
    const sst = String(matchedInboundReg.settlementStatus || '').toUpperCase();
    const fundsAreVerified =
      fvs === 'VERIFIED' &&
      (sst === 'VERIFIED_READY_FOR_CAPTURE' || sst === 'CAPTURED');

    if (!fundsAreVerified) {
      const detail = [
        `[INBOUND_GATE] Authorization ${authCodeStr} is a pre-registered ${matchedInboundReg.protocol} transaction.`,
        `Beneficiary: ${matchedInboundReg.beneficiaryName || 'N/A'}`,
        `Expected: ${matchedInboundReg.currency} ${Number(matchedInboundReg.amount).toLocaleString()}`,
        `Current fund_verification_status = ${fvs}`,
        `Current settlement_status = ${sst}`,
        `REQUIRED: Run POST /payments/inbound/${matchedInboundReg.id}/verify-funds with a real provider`,
        `(SWIFT_GATEWAY via UETR ${matchedInboundReg.uetr || 'N/A'}, VISA_NETWORK via depositCode ${matchedInboundReg.depositCode || 'N/A'}, BANK_API, or MANUAL_CONFIRM with operator sign-off).`,
        `NO wallet credit will be issued until EXTERNAL provider confirms the funds.`,
      ].join(' ');
      console.warn('[internalProcessor] FUND VERIFICATION REQUIRED:', detail);
      throw new Error(
        `Fund verification required for inbound ${matchedInboundReg.protocol} authorization ${authCodeStr}. ` +
        `Current status: ${fvs}/${sst}. Call verify-funds endpoint with real provider data before capture.`
      );
    }

    // Verify amount + currency match the registered record (authoritative).
    const regAmount = Number(matchedInboundReg.amount);
    const regCurrency = String(matchedInboundReg.currency || 'USD').toUpperCase();
    const amountMatches = Math.abs(regAmount - amount) < 0.01;
    const currencyMatches = regCurrency === currency;
    if (!amountMatches || !currencyMatches) {
      throw new Error(
        `Inbound registration mismatch for ${authCodeStr}: ` +
        `expected ${regCurrency} ${regAmount.toFixed(2)}, ` +
        `got ${currency} ${amount.toFixed(2)}.`
      );
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_settlements (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      auth_ref TEXT NOT NULL,
      capture_ref TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      protocol TEXT NOT NULL,
      batch_id TEXT,
      response_code TEXT,
      status TEXT NOT NULL,
      acquirer_raw TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS card_settlements_merchant_auth_idx
       ON card_settlements (merchant_id, auth_ref)`,
  );

  const existing = (await db.query(
    `SELECT * FROM card_settlements
       WHERE merchant_id = ? AND auth_ref = ? AND status = 'CONFIRMED'
       LIMIT 1`,
    [input.merchantId, input.authRef],
  )).rows?.[0] as any;

  if (existing) {
    if (Number(existing.amount) !== amount || String(existing.currency).toUpperCase() !== currency) {
      throw new Error('Authorization was already captured for a different amount or currency');
    }
    const wallet = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);
    return {
      captureRef: String(existing.capture_ref),
      settlementId: String(existing.id),
      amount,
      currency,
      merchantWalletId: wallet.id,
      merchantBalance: Number(wallet.balance || 0),
      idempotent: true,
    };
  }

  const captureRef = `CAP-${uuidv4().slice(0, 12).toUpperCase()}`;
  const settlementId = uuidv4();
  const now = new Date().toISOString();
  const wallet = await walletsService.getOrCreateMerchantWallet(input.merchantId, currency);

  await ensureOmnibusAccountsTable();

  // 4-step atomic write order for financial integrity:
  //   1. Record card_settlements (capture promise)
  //   2. Run Omnibus shortfall check + Omnibus debit → vault credit → merchant credit
  //   3. Commit the SQL transaction so everything posts atomically or rolls back
  //      If any step fails (including shortfall), nothing posts.
  await db.query('BEGIN IMMEDIATE');
  try {
    await db.query(
      `INSERT INTO card_settlements
        (id, merchant_id, auth_ref, capture_ref, amount, currency, protocol, batch_id, response_code, status, acquirer_raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '00', 'CONFIRMED', ?, ?)`,
      [
        settlementId,
        input.merchantId,
        input.authRef,
        captureRef,
        amount,
        currency,
        input.protocol,
        input.batchId || null,
        JSON.stringify({ source: 'internal-offline-processor', transactionId: input.transactionId, stan: input.stan || null }),
        now,
      ],
    );
    // Financial backing chain. If this throws (e.g. OMNIBUS_SHORTFALL), ROLLBACK fires
    // and nothing is credited to merchant wallet.
    await applyOmnibusBackedMerchantCredit({
      amount,
      currency,
      merchantId: input.merchantId,
      reference: input.authRef,
      captureRef,
      protocol: input.protocol,
      inbound: matchedInboundReg,
      walletId: wallet.id,
      now,
    });
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve the capture/shortfall error */ }
    throw error;
  }

  let customerWalletResult: { success: boolean; customer_id?: string; customer_balance_after?: number; error?: string } = { success: false, error: 'CUSTOMER_NOT_ATTEMPTED' };
  try {
    let resolvedCustomerId: string | null = input.customerId || null;
    if (!resolvedCustomerId) {
      const code = String(input.authRef || '').trim();
      const panMasked = String(input.panMasked || '').trim();
      const merchantId = String(input.merchantId || '').trim();
      const where: string[] = [];
      const params: any[] = [];
      if (code) { where.push('code = ?'); params.push(code); }
      if (panMasked) { where.push('(pan_masked = ? OR card_number LIKE ? OR card_number = ?)'); params.push(panMasked, `%${panMasked.slice(-8) || panMasked}%`, panMasked); }
      if (merchantId) { where.push('merchant_id = ?'); params.push(merchantId); }
      if (where.length > 0) {
        const res = await db.query(
          `SELECT customer_id FROM card_authorizations WHERE ${where.join(' AND ')} AND customer_id IS NOT NULL ORDER BY captured_at DESC, created_at DESC LIMIT 1`,
          params
        );
        if (res.rows[0]?.customer_id) resolvedCustomerId = String(res.rows[0].customer_id);
      }
    }
    if (resolvedCustomerId) {
      const src = `internal_processor_capture_${input.protocol}_customer_credit`;
      const res = await fundsSettlementService.creditCustomerWallet({
        customer_id: resolvedCustomerId,
        amount,
        currency,
        source: src,
        reference: captureRef,
        initiated_by: 'internal_processor'
      });
      customerWalletResult = { success: true, customer_id: resolvedCustomerId, customer_balance_after: Number(res.customer_balance || 0) };
    } else {
      customerWalletResult = { success: false, error: 'CUSTOMER_NOT_RESOLVED' };
    }
  } catch (custErr: any) {
    console.warn(`[internalProcessor] customer wallet credit skipped (non-fatal):`, custErr?.message);
    customerWalletResult = { success: false, error: custErr?.message };
  }

  // ── Post-capture: Mark inbound registration CAPTURED if matched ──
  if (matchedInboundReg) {
    try {
      await inboundTransactionService.markSettlementCaptured(matchedInboundReg.id, captureRef);
    } catch (markErr: any) {
      console.warn(`[internalProcessor] inbound registration settlement mark failed (non-fatal): ${markErr.message}`);
    }
  }

  const updated = (await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [wallet.id])).rows?.[0];
  return {
    captureRef,
    settlementId,
    amount,
    currency,
    merchantWalletId: wallet.id,
    merchantBalance: Number(updated?.balance || 0),
    idempotent: false,
    customerWallet: customerWalletResult,
    inboundRegistrationId: matchedInboundReg ? matchedInboundReg.id : undefined,
  };
}
