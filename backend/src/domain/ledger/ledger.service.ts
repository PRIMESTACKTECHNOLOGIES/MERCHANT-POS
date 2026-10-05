import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

export type TransactionState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'REVERSED' | 'FAILED';

export interface LedgerEntry {
  id: string;
  transactionId: string;
  merchantId?: string;
  customerId?: string | null;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  status: TransactionState;
  sourceType?: 'bank' | 'card' | 'crypto' | 'pos' | 'manual';
  sourceReference?: string;
  sourceNetwork?: string;
  reference?: string;
  description: string;
  createdAt: string;
}

const allowedTransitions: Record<TransactionState, TransactionState[]> = {
  PENDING: ['AUTHORIZED', 'FAILED'],
  AUTHORIZED: ['CAPTURED', 'REVERSED', 'FAILED'],
  CAPTURED: ['SETTLED', 'REVERSED', 'FAILED'],
  SETTLED: ['REVERSED'],
  REVERSED: [],
  FAILED: [],
};

export function validateTransition(current: TransactionState, next: TransactionState): void {
  if (current === next) {
    return;
  }

  if (!allowedTransitions[current]?.includes(next)) {
    throw new Error(`Invalid transition from ${current} to ${next}`);
  }
}

export function createLedgerEntry(
  transactionId: string, 
  type: 'credit' | 'debit', 
  amount: number, 
  currency: string, 
  status: TransactionState, 
  description: string,
  merchantId?: string,
  sourceType?: 'bank' | 'card' | 'crypto' | 'pos' | 'manual',
  sourceReference?: string,
  sourceNetwork?: string,
  reference?: string
): LedgerEntry {
  return {
    id: `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    transactionId,
    merchantId,
    type,
    amount,
    currency,
    status,
    sourceType,
    sourceReference,
    sourceNetwork,
    reference,
    description,
    createdAt: new Date().toISOString(),
  };
}

export async function ensureLedgerFiatSchema(
  query: (text: string, params?: any[]) => Promise<any> = db.query.bind(db)
): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ledger_fiat_rates (
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 1,
      PRIMARY KEY (from_currency, to_currency)
    )
  `);

  const defaults = [
    ['USD', 'USD', 1],
    ['USD', 'EUR', 0.92],
    ['USD', 'GBP', 0.79],
    ['USD', 'NGN', 1573.31],
  ];

  for (const [fromCurrency, toCurrency, rate] of defaults) {
    await query(
      `INSERT OR IGNORE INTO ledger_fiat_rates (from_currency, to_currency, rate) VALUES (?, ?, ?)`,
      [fromCurrency, toCurrency, rate]
    );
  }
}

export function getFxRate(fromCurrency: string, toCurrency: string): number {
  const from = (fromCurrency || 'USD').toUpperCase().trim();
  const to = (toCurrency || 'USD').toUpperCase().trim();

  if (!from || !to || from === to) return 1;

  const staticRates: Record<string, Record<string, number>> = {
    USD: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1573.31 },
    EUR: { USD: 1.09, EUR: 1, GBP: 0.86, NGN: 1713.72 },
    GBP: { USD: 1.27, EUR: 1.16, GBP: 1, NGN: 1990.56 },
    NGN: { USD: 0.00064, EUR: 0.00058, GBP: 0.0005, NGN: 1 },
  };

  return staticRates[from]?.[to] ?? 1;
}

export async function persistLedgerEntry(
  entry: LedgerEntry, 
  query: (text: string, params?: any[]) => Promise<any> = async () => { throw new Error('No query function provided'); }
) {
  await query(
    `INSERT INTO ledger_entries (id, transaction_id, merchant_id, type, amount, currency, status, source_type, source_reference, source_network, reference, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, 
      entry.transactionId, 
      entry.merchantId || null,
      entry.type, 
      entry.amount, 
      entry.currency, 
      entry.status, 
      entry.sourceType || null,
      entry.sourceReference || null,
      entry.sourceNetwork || null,
      entry.reference || null,
      entry.description, 
      entry.createdAt
    ]
  );
}

/**
 * 🏦 UPGRADED LEDGER SERVICE
 * Manages merchant settlement balances and fund movements
 */
export class LedgerService {
  
  /**
   * Get merchant settled balance (sum of all SETTLED ledger entries)
   */
  async getSettledBalance(merchantId: string, currency: string = 'USD'): Promise<number> {
    const result = await db.query(`
      SELECT COALESCE(SUM(
        CASE 
          WHEN type = 'credit' THEN amount
          WHEN type = 'debit' THEN -amount
          ELSE 0
        END
      ), 0) as balance
      FROM ledger_entries
      WHERE merchant_id = ?
        AND currency = ?
        AND status = 'SETTLED'
    `, [merchantId, currency]);

    return Number(result.rows[0]?.balance || 0);
  }
  
  /**
   * Get all ledger entries for a merchant
   */
  async getMerchantLedgerEntries(
    merchantId: string, 
    currency?: string,
    limit: number = 100
  ): Promise<LedgerEntry[]> {
    let sql = `
      SELECT * FROM ledger_entries
      WHERE merchant_id = ?
    `;
    const params: any[] = [merchantId];
    
    if (currency) {
      sql += ` AND currency = ?`;
      params.push(currency);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const result = await db.query(sql, params);
    return result.rows.map((row: any) => ({
      id: row.id,
      transactionId: row.transaction_id,
      merchantId: row.merchant_id,
      type: row.type,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      sourceType: row.source_type,
      sourceReference: row.source_reference,
      sourceNetwork: row.source_network,
      reference: row.reference,
      description: row.description,
      createdAt: row.created_at
    }));
  }
  
  /**
   * Credit merchant balance (on settlement from POS/batch)
   */
  async creditMerchantBalance(
    merchantId: string,
    amount: number,
    currency: string,
    sourceType: 'bank' | 'card' | 'crypto' | 'pos' | 'manual',
    sourceReference: string,
    description: string,
    sourceNetwork?: string
  ): Promise<LedgerEntry> {
    
    const entry = createLedgerEntry(
      uuidv4(), // transactionId
      'credit',
      amount,
      currency,
      'SETTLED', // Immediately settled
      description,
      merchantId,
      sourceType,
      sourceReference,
      sourceNetwork,
      `CREDIT-${Date.now()}`
    );
    
    await persistLedgerEntry(entry, db.query.bind(db));
    
    console.log(`[LedgerService] ✅ Credited ${merchantId}: +$${amount} ${currency} (${sourceType}: ${sourceReference})`);
    
    return entry;
  }
  
  /**
   * Debit merchant balance (on payout)
   */
  async debitMerchantBalance(
    merchantId: string,
    amount: number,
    currency: string,
    reference: string,
    description: string
  ): Promise<LedgerEntry> {
    
    // Check balance first
    const balance = await this.getSettledBalance(merchantId, currency);
    if (balance < amount) {
      throw new Error(`Insufficient balance: merchant ${merchantId} has $${balance} ${currency}, needs $${amount}`);
    }
    
    const entry = createLedgerEntry(
      uuidv4(), // transactionId
      'debit',
      amount,
      currency,
      'SETTLED',
      description,
      merchantId,
      'manual', // Debit is manual (admin action)
      reference,
      undefined,
      reference
    );
    
    await persistLedgerEntry(entry, db.query.bind(db));
    
    console.log(`[LedgerService] ✅ Debited ${merchantId}: -$${amount} ${currency} (${reference})`);
    
    return entry;
  }
  
  /**
   * Authorize funds from external source (mark as authorised pending settlement)
   */
  async authorizeFromBank(
    ledgerId: string,
    bankRef: string,
    amount: number,
    currency: string
  ): Promise<void> {
    const result = await db.query(`
      SELECT * FROM ledger_entries WHERE id = ?
    `, [ledgerId]);
    
    if (!result.rows[0]) {
      throw new Error('Ledger entry not found');
    }
    
    const ledger = result.rows[0];
    
    if (ledger.status === 'SETTLED') {
      throw new Error('Already settled');
    }
    
    if (Number(ledger.amount) !== amount || ledger.currency !== currency) {
      throw new Error(`Amount/currency mismatch: expected $${ledger.amount} ${ledger.currency}, got $${amount} ${currency}`);
    }
    
    await db.query(`
      UPDATE ledger_entries
      SET status = 'AUTHORIZED',
          source_type = 'bank',
          source_reference = ?
      WHERE id = ?
    `, [bankRef, ledgerId]);
    
    console.log(`[LedgerService] ✅ Authorized from bank: ${ledgerId} - ${bankRef}`);
  }
  
  /**
   * Authorize funds from card transaction
   */
  async authorizeFromCard(
    ledgerId: string,
    rrn: string,
    authCode: string,
    amount: number,
    currency: string
  ): Promise<void> {
    const result = await db.query(`
      SELECT * FROM ledger_entries WHERE id = ?
    `, [ledgerId]);
    
    if (!result.rows[0]) {
      throw new Error('Ledger entry not found');
    }
    
    const ledger = result.rows[0];
    
    if (ledger.status === 'SETTLED') {
      throw new Error('Already settled');
    }
    
    if (Number(ledger.amount) !== amount || ledger.currency !== currency) {
      throw new Error('Amount/currency mismatch');
    }
    
    await db.query(`
      UPDATE ledger_entries
      SET status = 'AUTHORIZED',
          source_type = 'card',
          source_reference = ?
      WHERE id = ?
    `, [`${rrn}|${authCode}`, ledgerId]);
    
    console.log(`[LedgerService] ✅ Authorized from card: ${ledgerId} - RRN: ${rrn}, Auth: ${authCode}`);
  }
  
  /**
   * Authorize funds from crypto transaction
   */
  async authorizeFromCrypto(
    ledgerId: string,
    txId: string,
    network: string,
    amount: number,
    currency: string
  ): Promise<void> {
    const result = await db.query(`
      SELECT * FROM ledger_entries WHERE id = ?
    `, [ledgerId]);
    
    if (!result.rows[0]) {
      throw new Error('Ledger entry not found');
    }
    
    const ledger = result.rows[0];
    
    if (ledger.status === 'SETTLED') {
      throw new Error('Already settled');
    }
    
    if (Number(ledger.amount) !== amount || ledger.currency !== currency) {
      throw new Error('Amount/currency mismatch');
    }
    
    await db.query(`
      UPDATE ledger_entries
      SET status = 'AUTHORIZED',
          source_type = 'crypto',
          source_reference = ?,
          source_network = ?
      WHERE id = ?
    `, [txId, network, ledgerId]);
    
    console.log(`[LedgerService] ✅ Authorized from crypto: ${ledgerId} - TX: ${txId} (${network})`);
  }
}

export interface BalancedLedgerEntry {
  account_code: string;
  direction: 'debit' | 'credit';
  amount: number;
  currency: string;
  description?: string;
  merchant_id?: string;
  source_type?: 'bank' | 'card' | 'crypto' | 'pos' | 'manual';
  source_reference?: string;
  source_network?: string;
}

export interface BalancedTransactionResult {
  ledger_transaction_id: string;
  entry_ids: string[];
  type: string;
  status: TransactionState;
  amount: number;
  currency: string;
  reference?: string;
}

const allowedLedgerTxStatuses: Record<string, TransactionState[]> = {
  PENDING: ['AUTHORIZED', 'SETTLED', 'PAID_OUT' as any, 'FAILED'],
  AUTHORIZED: ['SETTLED', 'PAID_OUT' as any, 'REVERSED', 'FAILED'],
  SETTLED: ['PAID_OUT' as any, 'REVERSED'],
  PAID_OUT: ['REVERSED'],
  REVERSED: [],
  FAILED: [],
};

export class BalancedLedgerEngine {
  async createBalancedTransaction(params: {
    type: 'pos_sale' | 'card_auth' | 'card_capture' | 'chargeback' | 'payout' | 'settlement_sweep' | 'fee' | 'refund' | 'internal_transfer' | 'vault_reserve' | 'vault_release';
    status?: TransactionState;
    amount: number;
    currency: string;
    reference?: string;
    merchant_id?: string;
    linked_payout_id?: string;
    linked_batch_id?: string;
    metadata?: Record<string, any>;
    entries: BalancedLedgerEntry[];
  }): Promise<BalancedTransactionResult> {
    const { type, status = 'PENDING', amount, currency, reference, merchant_id, linked_payout_id, linked_batch_id, metadata, entries } = params;

    if (!entries || entries.length < 2) {
      throw new Error('Balanced transaction requires at least 2 entries');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Ledger transaction amount must be a positive number');
    }
    if (!/^[A-Z]{3}$/.test(String(currency || '').toUpperCase())) {
      throw new Error('Ledger transaction currency must be a 3-letter ISO code');
    }

    const debits = entries.filter(e => e.direction === 'debit').reduce((s, e) => s + Number(e.amount || 0), 0);
    const credits = entries.filter(e => e.direction === 'credit').reduce((s, e) => s + Number(e.amount || 0), 0);
    const eps = 0.0001;
    if (Math.abs(debits - credits) > eps) {
      throw new Error(`Ledger transaction not balanced: debits=${debits}, credits=${credits}, delta=${debits - credits}`);
    }
    if (Math.abs(debits - amount) > eps) {
      throw new Error(`Ledger transaction amount mismatch: declared=${amount}, entries=${debits}`);
    }
    if (entries.some((entry) => String(entry.currency || currency).toUpperCase() !== String(currency).toUpperCase())) {
      throw new Error('All ledger entries must use the transaction currency');
    }

    const ledgerTxId = `ledgertx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const entryIds: string[] = [];

    await db.query(`BEGIN IMMEDIATE`);
    try {
      await db.query(
        `INSERT INTO ledger_transactions
         (id, type, status, amount, currency, reference, merchant_id, linked_payout_id, linked_batch_id, metadata, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ledgerTxId, type, status, amount, currency, reference || null,
          merchant_id || null, linked_payout_id || null, linked_batch_id || null,
          metadata ? JSON.stringify(metadata) : null, now, now,
        ]
      );

      for (const entry of entries) {
        const entryId = `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 6)}`;
        entryIds.push(entryId);
        const ccy = entry.currency || currency;
        await db.query(
          `INSERT INTO ledger_entries
           (id, transaction_id, ledger_transaction_id, account_code, merchant_id, type, amount, currency, status,
            source_type, source_reference, source_network, reference, description, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            entryId,
            ledgerTxId,
            ledgerTxId,
            entry.account_code,
            entry.merchant_id || merchant_id || null,
            entry.direction,
            Number(entry.amount),
            ccy,
            status,
            entry.source_type || null,
            entry.source_reference || null,
            entry.source_network || null,
            reference || null,
            entry.description || `${entry.direction} ${entry.account_code}`,
            now,
          ]
        );
      }

      await db.query(`COMMIT`);

      return {
        ledger_transaction_id: ledgerTxId,
        entry_ids: entryIds,
        type,
        status,
        amount,
        currency,
        reference,
      };
    } catch (e) {
      try { await db.query(`ROLLBACK`); } catch (_) { /* ignore */ }
      throw e;
    }
  }

  async transitionLedgerTransaction(
    ledgerTxId: string,
    nextStatus: TransactionState
  ): Promise<void> {
    const sel = await db.query(
      `SELECT type, status FROM ledger_transactions WHERE id = ? LIMIT 1`,
      [ledgerTxId]
    );
    if (!sel.rows?.[0]) throw new Error(`Ledger transaction ${ledgerTxId} not found`);
    const current = sel.rows[0].status as TransactionState;
    if (current === nextStatus) return;
    const allowed = (allowedLedgerTxStatuses[current as string] || []) as string[];
    if (!allowed.includes(nextStatus as string)) {
      throw new Error(`Invalid ledger_transaction transition: ${current} → ${nextStatus}`);
    }
    const now = new Date().toISOString();
    await db.query(
      `UPDATE ledger_transactions SET status = ?, updated_at = ? WHERE id = ?`,
      [nextStatus, now, ledgerTxId]
    );
    await db.query(
      `UPDATE ledger_entries SET status = ?, reference = COALESCE(reference, ?) WHERE ledger_transaction_id = ?`,
      [nextStatus, ledgerTxId, ledgerTxId]
    );
  }

  async getAccountBalance(account_code: string, currency?: string, statuses: TransactionState[] = ['SETTLED', 'AUTHORIZED', 'CAPTURED', 'PAID_OUT' as any]): Promise<number> {
    const placeholders = statuses.map(() => '?').join(',');
    const params: any[] = [account_code, ...statuses];
    let ccyFilter = '';
    if (currency) {
      ccyFilter = ' AND currency = ?';
      params.push(currency);
    }
    const r = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount WHEN type = 'debit' THEN -amount ELSE 0 END), 0) AS balance
       FROM ledger_entries
       WHERE account_code = ? AND status IN (${placeholders})${ccyFilter}`,
      params
    );
    return Number(r.rows?.[0]?.balance || 0);
  }

  async resolveVaultAccountCode(vaultAccountId: string): Promise<string> {
    const r = await db.query(
      `SELECT account_code FROM account_codes WHERE vault_account_id = ? LIMIT 1`,
      [vaultAccountId]
    );
    if (r.rows?.[0]?.account_code) return r.rows[0].account_code;
    return `VAULT_${vaultAccountId}`;
  }

  async resolveMerchantWalletCode(merchantId: string, currency: string): Promise<string> {
    const key = `${merchantId}_${currency}`;
    const r = await db.query(
      `SELECT account_code FROM account_codes
       WHERE (merchant_id = ? AND (currency = ? OR currency IS NULL))
          OR account_code = ?
       LIMIT 1`,
      [merchantId, currency, `MRC_${merchantId.replace(/[^A-Z0-9]/g, '')}_WALLET_${currency}`]
    );
    if (r.rows?.[0]?.account_code) return r.rows[0].account_code;
    const generated = `MRC_${merchantId.replace(/[^A-Z0-9]/g, '')}_WALLET_${currency}`;
    try {
      await db.query(
        `INSERT INTO account_codes (account_code, account_type, display_name, merchant_id, currency)
         VALUES (?,?,?,?,?)`,
        [generated, 'merchant', `Merchant ${merchantId} Wallet (${currency})`, merchantId, currency]
      );
    } catch (_) { /* ignore race */ }
    return generated;
  }
}

export const balancedLedgerEngine = new BalancedLedgerEngine();

// Export singleton instance
export const ledgerService = new LedgerService();
