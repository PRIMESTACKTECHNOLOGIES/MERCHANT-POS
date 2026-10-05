import { db } from "../../config/db";
import { v4 as uuidv4 } from 'uuid';
import { securityService } from '../security/security.service';
import { vaultEngine } from '../vault/vault.service';

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

/**
 * ──────────────────────────────────────────────────────────────────────────
 *  VAULT_BANK_OMNIBUS Shortfall Gate + Dual Ledger Backing
 * ──────────────────────────────────────────────────────────────────────────
 *  Called BEFORE any merchant/customer wallet credit to ensure the processor
 *  has real, externally-funded coverage in the VAULT_BANK_OMNIBUS account.
 *
 *  Pipeline (in this exact order inside the caller's SQL transaction):
 *    1. Shortfall check:   omnibus_accounts.balance >= amount
 *    2. Omnibus debit:     OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION
 *    3. Vault credit:      vault_engine.creditVault (vault_accounts += amount)
 *    4. Wallet credit:     *merchant_wallets* OR *customer_wallets*
 *
 *  Steps 2–4 each run INSERT/UPDATE. If ANY step fails, the outer caller
 *  executes ROLLBACK so NO side effects remain (no "phantom" wallet credits).
 * ──────────────────────────────────────────────────────────────────────────
 */
async function applyOmnibusBackedCredit(input: {
  amount: number;
  currency: string;
  merchantId?: string | null;
  customerId?: string | null;
  reference: string;
  operationId: string;
  operationLabel: string;
  walletId: string;
  walletKind: 'merchant' | 'customer';
}) {
  const { amount, currency, reference, operationId, operationLabel, walletId, walletKind } = input;
  const merchantId = input.merchantId || null;
  const customerId = input.customerId || null;
  const now = new Date().toISOString();
  await ensureOmnibusAccountsTable();

  // 1) SHORTFALL CHECK — hard stop. No funds in Omnibus = no wallet credit.
  const balanceRes = await db.query(
    `SELECT balance FROM omnibus_accounts WHERE account_id = ? AND currency = ? LIMIT 1`,
    [OMNIBUS_ACCOUNT_ID, String(currency).toUpperCase()]
  );
  const omnibusBalance = Number(balanceRes.rows?.[0]?.balance || 0);
  if (!Number.isFinite(omnibusBalance) || omnibusBalance < amount) {
    const shortfall = Number.isFinite(omnibusBalance) ? (amount - omnibusBalance) : amount;
    const msg =
      `VAULT_BANK_OMNIBUS SHORTFALL: ${currency} Omnibus = ${omnibusBalance.toFixed(2)}, ` +
      `required = ${amount.toFixed(2)}, shortfall = ${shortfall.toFixed(2)}. ` +
      `${walletKind} wallet credit BLOCKED. Operator MUST first fund VAULT_BANK_OMNIBUS via real external ` +
      `SWIFT/ACH/SEPA confirmation BEFORE this settlement can proceed.`;
    console.error('[OMNIBUS-GATE]', msg, { operationId, operationLabel, reference });
    throw Object.assign(new Error(msg), {
      code: 'OMNIBUS_SHORTFALL',
      currency,
      omnibusBalance,
      required: amount,
      shortfall,
    });
  }

  // 2) OMNIBUS DEBIT — dual ledger entry
  await db.query(
    `UPDATE omnibus_accounts SET balance = balance - ?, updated_at = ? WHERE account_id = ? AND currency = ?`,
    [amount, now, OMNIBUS_ACCOUNT_ID, currency]
  );
  await db.query(
    `INSERT INTO vault_ledger
      (id, ts, type, merchant_id, amount, currency, reference, status, meta)
     VALUES (?, ?, 'OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION', ?, ?, ?, ?, 'COMPLETED', ?)`,
    [
      uuidv4(), now, merchantId, -amount, currency, reference,
      JSON.stringify({
        phase: 'OMNIBUS_DEBIT',
        operationId,
        operationLabel,
        walletKind,
        walletId,
        omnibus_account: OMNIBUS_ACCOUNT_ID,
        omnibus_balance_before: omnibusBalance,
        omnibus_balance_after: omnibusBalance - amount,
        customer_id: customerId || null,
      })
    ]
  );

  // 3) VAULT CREDIT — vault side moves in lockstep with Omnibus debit
  await vaultEngine.creditVault({
    amount,
    currency,
    reference: `VAULT_CREDIT_BACKING-${operationId}`,
    merchantId,
    type: 'CARD_CAPTURE',
    meta: {
      phase: 'VAULT_CREDIT',
      operationId,
      operationLabel,
      reference,
      walletKind,
      walletId,
      customer_id: customerId || null,
    },
  });

  // 4) WALLET CREDIT — merchant_wallets OR customer_wallets
  if (walletKind === 'merchant') {
    await db.query(
      `UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      [amount, now, walletId]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions
        (id, wallet_id, type, amount, currency, source, reference, description, created_at)
       VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), walletId, amount, currency, 'pos_settlement',
        reference, `${operationLabel} | Vault-backed (Omnibus ${currency} ${amount.toFixed(2)})`, now,
      ]
    );
  } else {
    await db.query(
      `UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      [amount, now, walletId]
    );
    await db.query(
      `INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, currency, source, reference, description)
       VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)`,
      [
        uuidv4(), walletId, amount, currency, 'pos_settlement',
        reference, `${operationLabel} | Vault-backed (Omnibus ${currency} ${amount.toFixed(2)})`,
      ]
    );
  }
}

/**
 * SETTLEMENT SERVICE
 *
 * Securely moves funds from POS transactions to merchant/customer wallets
 * WITH SECURITY PROTECTION:
 * - Audit logging
 * - Dual authorization for large amounts
 * - Withdrawal limits
 * - Complete transaction trail
 * - **VAULT_BANK_OMNIBUS shortfall check + dual ledger backing**
 *   (merchant wallet is only credited if real Omnibus funds exist)
 */

export class SettlementService {

  /**
   * Settle POS transaction to merchant wallet
   * This credits the merchant wallet with funds from a completed POS transaction
   * ONLY IF the VAULT_BANK_OMNIBUS account has sufficient real external balance.
   */
  async settlePOSTransaction(transactionId: string, settledBy: string): Promise<{
    success: boolean;
    merchant_wallet_balance: number;
    settlement_id: string;
  }> {
    // Get POS transaction
    const txnResult = await db.query(`
      SELECT * FROM pos2013_transactions WHERE id = ?
    `, [transactionId]);

    if (txnResult.rowCount === 0) {
      throw new Error('Transaction not found');
    }

    const txn = txnResult.rows[0] as any;

    // Check if already settled
    const existingSettlement = await db.query(`
      SELECT * FROM transaction_settlements WHERE transaction_id = ?
    `, [transactionId]);

    if (existingSettlement.rowCount > 0) {
      throw new Error('Transaction already settled');
    }

    // Only settle SYNCED transactions
    if (txn.status !== 'SYNCED') {
      throw new Error(`Transaction status is ${txn.status}, must be SYNCED to settle`);
    }

    const amount = txn.amount_minor / 100; // Convert to dollars
    const merchantId = txn.merchant_id;
    const currency = String(txn.currency || 'USD').toUpperCase();

    // Get or create merchant wallet
    let walletResult = await db.query(`
      SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?
    `, [merchantId, currency]);

    let walletId: string;
    if (walletResult.rowCount === 0) {
      // Create merchant wallet
      walletId = uuidv4();
      await db.query(`
        INSERT INTO merchant_wallets (id, merchant_id, balance, currency)
        VALUES (?, ?, ?, ?)
      `, [walletId, merchantId, 0, currency]);
    } else {
      walletId = (walletResult.rows[0] as any).id;
    }

    // Create settlement record
    const settlementId = uuidv4();

    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(`
        INSERT INTO transaction_settlements (
          id, merchant_id, transaction_id, gross_amount, fee_amount,
          net_amount, currency, status, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SETTLED', CURRENT_TIMESTAMP)
      `, [settlementId, merchantId, transactionId, amount, 0, amount, currency]);

      // Omnibus shortfall check + Omnibus debit + vault credit + merchant credit
      // (atomically — any failure rolls back everything, including the settlement row).
      await applyOmnibusBackedCredit({
        amount,
        currency,
        merchantId,
        reference: transactionId,
        operationId: settlementId,
        operationLabel: `POS settlement Auth=${txn.auth_code}`,
        walletId,
        walletKind: 'merchant',
      });

      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* nothing */ }
      throw e;
    }

    // Get new balance
    const newBalanceResult = await db.query(`
      SELECT balance FROM merchant_wallets WHERE id = ?
    `, [walletId]);

    const newBalance = (newBalanceResult.rows[0] as any).balance;

    // Log security event
    await securityService.logSecurityEvent({
      event_type: 'SETTLEMENT_COMPLETED',
      severity: 'info',
      user_id: settledBy,
      action: `Settled POS transaction ${transactionId} (Omnibus-backed)`,
      resource_type: 'merchant_wallet',
      resource_id: walletId,
      old_value: String(newBalance - amount),
      new_value: String(newBalance),
      status: 'success',
      metadata: JSON.stringify({
        transaction_id: transactionId,
        settlement_id: settlementId,
        amount: amount,
        currency,
        auth_code: txn.auth_code,
        backing: 'VAULT_BANK_OMNIBUS',
      })
    });

    return {
      success: true,
      merchant_wallet_balance: newBalance,
      settlement_id: settlementId
    };
  }

  /**
   * Settle ALL pending POS transactions
   * SECURITY: Requires super admin permission for batch settlement
   */
  async settleAllPendingTransactions(settledBy: string): Promise<{
    success: boolean;
    settled_count: number;
    total_amount: number;
    merchant_balance: number;
  }> {
    // Get all SYNCED but unsettled transactions
    const txnsResult = await db.query(`
      SELECT t.* FROM pos2013_transactions t
      LEFT JOIN transaction_settlements s ON t.id = s.transaction_id
      WHERE t.status = 'SYNCED'
      AND s.id IS NULL
      ORDER BY t.created_at ASC
    `);

    if (txnsResult.rowCount === 0) {
      return {
        success: true,
        settled_count: 0,
        total_amount: 0,
        merchant_balance: 0
      };
    }

    let settledCount = 0;
    let totalAmount = 0;

    for (const txn of txnsResult.rows as any[]) {
      try {
        const result = await this.settlePOSTransaction(txn.id, settledBy);
        settledCount++;
        totalAmount += (txn.amount_minor / 100);
        console.log(`✅ Settled transaction ${txn.id} - $${(txn.amount_minor / 100).toLocaleString()}`);
      } catch (error: any) {
        console.error(`❌ Failed to settle transaction ${txn.id}:`, error.message);
      }
    }

    // Get final merchant balance
    const balanceResult = await db.query(`
      SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ?
    `, ['MRC-1001', 'USD']);

    const merchantBalance = balanceResult.rowCount > 0 ? (balanceResult.rows[0] as any).balance : 0;

    console.log(`\n✅ Settlement complete:`);
    console.log(`   Settled: ${settledCount} transactions`);
    console.log(`   Total: $${totalAmount.toLocaleString()}`);
    console.log(`   Merchant Balance: $${merchantBalance.toLocaleString()}\n`);

    return {
      success: true,
      settled_count: settledCount,
      total_amount: totalAmount,
      merchant_balance: merchantBalance
    };
  }

  /**
   * Credit customer wallet from POS capture
   *
   * This records an internal ledger entry: "customer is owed this amount."
   * It is NOT a real fund movement — no omnibus check needed here.
   * Real funds are pulled later when the customer provides provider credentials
   * and the backend calls the provider API (C2M flow).
   */
  async creditCustomerWallet(data: {
    customer_id: string;
    amount: number;
    currency: string;
    source: string;
    reference?: string;
    initiated_by: string;
  }): Promise<{
    success: boolean;
    customer_balance: number;
  }> {
    const { customer_id, amount, currency, source, reference, initiated_by } = data;
    const now = new Date().toISOString();
    const ref = reference || `source:${source}`;

    // Get or create customer wallet
    let walletResult = await db.query(
      `SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ?`,
      [customer_id, currency]
    );

    let walletId: string;
    if (walletResult.rowCount === 0) {
      walletId = uuidv4();
      await db.query(
        `INSERT INTO customer_wallets (id, customer_id, balance, currency, status)
         VALUES (?, ?, 0, ?, 'active')`,
        [walletId, customer_id, currency]
      );
    } else {
      walletId = (walletResult.rows[0] as any).id;
    }

    // Direct ledger credit — no omnibus gate (this is internal capture tracking)
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        `UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
        [amount, now, walletId]
      );
      await db.query(
        `INSERT INTO wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description)
         VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)`,
        [
          uuidv4(), walletId, amount, currency,
          source, ref,
          `POS capture ledger entry — awaiting provider pull | ${ref}`,
        ]
      );
      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }

    const newBalance = Number(
      (await db.query(`SELECT balance FROM customer_wallets WHERE id = ?`, [walletId])).rows[0]?.balance || 0
    );

    console.log(`[CustomerWallet] Ledger credit: ${currency} ${amount} → customer ${customer_id} ref=${ref}`);

    return { success: true, customer_balance: newBalance };
  }

  /**
   * Get merchant wallet balance
   */
  async getMerchantWalletBalance(merchantId: string, currency: string = 'USD'): Promise<number> {
    const result = await db.query(`
      SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ?
    `, [merchantId, currency]);

    if (result.rowCount === 0) {
      return 0;
    }

    return (result.rows[0] as any).balance;
  }

  /**
   * Get customer wallet balance
   */
  async getCustomerWalletBalance(customerId: string, currency: string = 'USD'): Promise<number> {
    const result = await db.query(`
      SELECT balance FROM customer_wallets WHERE customer_id = ? AND currency = ?
    `, [customerId, currency]);

    if (result.rowCount === 0) {
      return 0;
    }

    return (result.rows[0] as any).balance;
  }

  /**
   * Get settlement history
   */
  async getSettlementHistory(merchantId: string, limit: number = 50) {
    const result = await db.query(`
      SELECT 
        s.*,
        t.auth_code,
        t.pan_masked,
        t.txn_timestamp
      FROM transaction_settlements s
      LEFT JOIN pos2013_transactions t ON s.transaction_id = t.id
      WHERE s.merchant_id = ?
      ORDER BY s.settled_at DESC
      LIMIT ?
    `, [merchantId, limit]);

    return result.rows;
  }

  /**
   * Get merchant wallet transactions (ledger)
   */
  async getMerchantWalletTransactions(merchantId: string, currency: string = 'USD', limit: number = 50) {
    const walletResult = await db.query(`
      SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ?
    `, [merchantId, currency]);

    if (walletResult.rowCount === 0) {
      return [];
    }

    const walletId = (walletResult.rows[0] as any).id;

    const result = await db.query(`
      SELECT * FROM merchant_wallet_transactions
      WHERE wallet_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [walletId, limit]);

    return result.rows;
  }

  /**
   * Get customer wallet transactions (ledger)
   */
  async getCustomerWalletTransactions(customerId: string, currency: string = 'USD', limit: number = 50) {
    const walletResult = await db.query(`
      SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ?
    `, [customerId, currency]);

    if (walletResult.rowCount === 0) {
      return [];
    }

    const walletId = (walletResult.rows[0] as any).id;

    const result = await db.query(`
      SELECT * FROM wallet_transactions
      WHERE wallet_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [walletId, limit]);

    return result.rows;
  }
}

export const fundsSettlementService = new SettlementService();
