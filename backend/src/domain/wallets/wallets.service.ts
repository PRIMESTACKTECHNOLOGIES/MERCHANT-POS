import axios from "axios";
import crypto from "crypto";
import { db } from "../../config/db";
import { acquirerConfig } from "../../config/acquirer";
import { createAcquirerClient } from '../payments/acquirer';
import { v4 as uuidv4 } from 'uuid';
import { validateTransition, createLedgerEntry, persistLedgerEntry, type TransactionState } from '../ledger/ledger.service';

export class WalletsService {

  private normalizeCurrency(c: any): string {
    const raw = (c || 'USD').toString().toUpperCase().trim();
    if (!raw) return 'USD';
    return raw;
  }

  // ── Wallet helpers ───────────────────────────────────────────────────────────
  async getOrCreateWallet(customerId: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const res = await db.query(
      'SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ?',
      [customerId, ccy]
    );
    if (res.rows.length) return res.rows[0];
    const id = uuidv4();
    const walletCode = `PSW-${Math.floor(Math.random() * 9000) + 1000}-${Math.floor(Math.random() * 9000) + 1000}`;
    await db.query(
      `INSERT INTO customer_wallets (id, customer_id, balance, currency, wallet_code) VALUES (?, ?, 0, ?, ?)`,
      [id, customerId, ccy, walletCode]
    );
    return (await db.query('SELECT * FROM customer_wallets WHERE id = ?', [id])).rows[0];
  }

  async listCustomerWallets(customerId: string) {
    return (await db.query(
      `SELECT id, customer_id, balance, currency, wallet_code, status, created_at, updated_at
       FROM customer_wallets
       WHERE customer_id = ?
       ORDER BY CASE WHEN balance != 0 THEN 0 ELSE 1 END,
                ABS(balance) DESC,
                updated_at DESC,
                currency ASC`,
      [customerId]
    )).rows;
  }

  async getOrCreateMerchantWallet(merchantId: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const res = await db.query(
      'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?',
      [merchantId, ccy]
    );
    if (res.rows.length) return res.rows[0];
    const id = uuidv4();
    await db.query(
      `INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, ?)`,
      [id, merchantId, ccy]
    );
    return (await db.query('SELECT * FROM merchant_wallets WHERE id = ?', [id])).rows[0];
  }

  async listMerchantWallets(merchantId: string) {
    return (await db.query(
      'SELECT * FROM merchant_wallets WHERE merchant_id = ? ORDER BY currency',
      [merchantId]
    )).rows;
  }

  async creditMerchantWallet(merchantId: string, amount: number, source: string, reference?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
    const transactionId = uuidv4();
    const now = new Date().toISOString();
    const prevBalance = Number(wallet.balance || 0);

    await db.query(
      `UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      [amount, now, wallet.id]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, created_at)
       VALUES (?, ?, 'credit', ?, ?, ?, ?, ?)`,
      [transactionId, wallet.id, amount, ccy, source, reference || null, now]
    );
    let ledgerEntryId: string | null = null;
    try {
      const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, ccy, 'AUTHORIZED', `POS offline sale: ${reference || source || 'pos_offline'}`, merchantId, 'pos', reference || undefined, undefined, source || undefined);
      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));
      ledgerEntryId = ledgerEntry.id;
    } catch (err) {
      console.error('Failed to persist ledger entry for merchant credit', err);
    }
    return { success: true, transactionId, status: 'COMPLETED', ledgerEntryId, currency: ccy, balanceAfter: prevBalance + amount };
  }

  // ── Fiat wallet ops ──────────────────────────────────────────────────────────
  async topupWallet(customerId: string, amount: number, source: string, reference?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const transactionId = uuidv4();
    const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, ccy, 'AUTHORIZED', `Wallet topup via ${source || 'manual'}`);
    validateTransition('PENDING', ledgerEntry.status as TransactionState);

    await db.query(
      `UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference) VALUES (?, ?, 'credit', ?, ?, ?, ?)`,
      [transactionId, wallet.id, amount, ccy, source || 'manual', reference || null]
    );
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));
    return { success: true, transactionId, status: ledgerEntry.status, currency: ccy };
  }

  async creditCustomerWallet(
    customerId: string,
    amount: number,
    source: string,
    reference: string,
    currency: string = 'USD',
  ) {
    if (!customerId?.trim() || !reference?.trim() || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Customer, positive amount, and capture reference are required');
    }

    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const transactionId = uuidv4();
    const now = new Date().toISOString();
    await db.query('BEGIN IMMEDIATE');
    try {
      const prior = await db.query(
        `SELECT id FROM wallet_transactions
         WHERE wallet_id = ? AND type = 'credit' AND reference = ? LIMIT 1`,
        [wallet.id, reference],
      );
      if (prior.rows.length) {
        await db.query('COMMIT');
        return {
          success: true,
          transactionId: String(prior.rows[0].id),
          status: 'COMPLETED',
          currency: ccy,
          idempotent: true,
        };
      }

      await db.query(
        `UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
        [amount, now, wallet.id],
      );
      await db.query(
        `INSERT INTO wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          wallet.id,
          amount,
          ccy,
          source,
          reference,
          `Provider-captured POS funds (${reference})`,
          now,
        ],
      );
      await db.query('COMMIT');
      return { success: true, transactionId, status: 'COMPLETED', currency: ccy, idempotent: false };
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  private async authorizeCardTopup(amount: number, currency: string, cardNumber: string, expiry: string, cvv: string, emvData?: string) {
    const ccy = this.normalizeCurrency(currency);
    const sanitizedPan = (cardNumber || '').replace(/\D/g, '');
    const normalizedEmv = (emvData || '').trim();

    if (normalizedEmv) {
      try {
        const parsed = JSON.parse(normalizedEmv);
        const approved = parsed?.approved === true || parsed?.success === true || parsed?.status === 'approved' || parsed?.status === 'APPROVED';
        if (approved) {
          return {
            authCode: parsed?.authCode || parsed?.processorId || parsed?.authorizationCode || parsed?.id || `AUTH-${Date.now().toString(36).toUpperCase()}`,
            processorId: parsed?.processorId || parsed?.id || null,
            processor: parsed?.processor || 'PROVIDED',
            status: 'APPROVED',
          };
        }
        if (parsed?.message) {
          throw new Error(parsed.message);
        }
      } catch (parseError) {
        const trimmed = normalizedEmv.replace(/^['"]|['"]$/g, '');
        if (/^AUTH[-:_A-Z0-9]{3,}$/i.test(trimmed)) {
          return {
            authCode: trimmed,
            processorId: trimmed,
            processor: 'PROVIDED',
            status: 'APPROVED',
          };
        }
        if (trimmed) {
          throw new Error('Card authorization payload was invalid');
        }
      }
    }

    const acquirerActive = Boolean(acquirerConfig.host);
    const enabledRaw = String(process.env.CARD_PROCESSOR_ENABLED || 'false').trim().toLowerCase();
    const enabled = ['1', 'true', 'on', 'yes'].includes(enabledRaw);
    if (!acquirerActive && !enabled) {
      throw new Error('Card processor disabled (CARD_PROCESSOR_ENABLED kill switch active — set to true to enable or configure Vault Bank Acquirer)');
    }

    if (acquirerActive) {
      try {
        const acquirer = createAcquirerClient();
        const merchantAccount = acquirerConfig.merchantId || process.env.PROCESSOR_MERCHANT_ID || 'MRC-1001';
        const result = await acquirer.authorize({
          merchantAccount,
          amountMinor: Math.round(Number(amount) * 100),
          currency: String(ccy || 'USD').toUpperCase(),
          cardNumber: sanitizedPan,
          expiry: expiry,
          cvv: cvv,
          protocol: '101.1',
        });
        if (!result.success) {
          throw new Error(result.message || `Acquirer declined wallet topup (RC=${result.responseCode})`);
        }
        return {
          authCode: result.approvalCode || `AUTH-${Date.now().toString(36).toUpperCase()}`,
          processorId: result.authRef || null,
          processor: 'VAULT_BANK_ACQUIRER',
          status: 'APPROVED',
        };
      } catch (acqErr: any) {
        throw new Error(acqErr?.message || String(acqErr));
      }
    }

    const processorUrl = process.env.CARD_PROCESSOR_URL?.trim() || process.env.CARD_PROCESSOR_AUTH_URL?.trim();
    if (!processorUrl) {
      throw new Error('Real card authorization is required — set CARD_PROCESSOR_URL or CARD_PROCESSOR_AUTH_URL');
    }
    if (!/^https:\/\//i.test(processorUrl) || /(your[-_.]?processor|example\.com|localhost|127\.0\.0\.1)/i.test(processorUrl)) {
      throw new Error('Card processor URL is placeholder/invalid — set a real HTTPS endpoint (not example.com/localhost/your-processor)');
    }

    const response = await axios.post(processorUrl, {
      amount,
      currency: ccy,
      cardNumber: sanitizedPan,
      expiry,
      cvv,
      panLast4: sanitizedPan.slice(-4),
      source: 'wallet_topup',
    }, { timeout: 5000 });

    const approved = response?.data?.approved === true || response?.data?.success === true || response?.data?.status?.toLowerCase() === 'approved';
    if (!approved) {
      throw new Error(response?.data?.message || 'Card authorization declined');
    }

    const authCode = response?.data?.authCode || response?.data?.authorizationCode || response?.data?.processorId || response?.data?.id || `AUTH-${Date.now().toString(36).toUpperCase()}`;
    const processor = response?.data?.processor || 'PROCESSOR';
    const isMock = /mock/i.test(authCode) || /mock/i.test(processor) || response?.data?.mock === true;
    if (isMock) {
      throw new Error('Real card authorization is required');
    }

    return {
      authCode,
      processorId: response?.data?.processorId || response?.data?.id || null,
      processor,
      status: 'APPROVED',
    };
  }

  async topupWalletWithCard(customerId: string, amount: number, cardNumber: string, panMasked?: string, expiry?: string, cvv?: string, emvData?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    if (!customerId) throw new Error('customerId is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive');

    const sanitizedPan = (cardNumber || '').replace(/\D/g, '');
    if (!sanitizedPan || sanitizedPan.length < 13 || sanitizedPan.length > 19) {
      throw new Error('Enter a valid card number');
    }
    if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) {
      throw new Error('Enter card expiry as MM/YY');
    }
    if (!cvv || !/^\d{3,4}$/.test(cvv)) {
      throw new Error('Enter a valid CVV');
    }

    const authorization = await this.authorizeCardTopup(amount, ccy, sanitizedPan, expiry, cvv, emvData);

    const wallet = await this.getOrCreateWallet(customerId, ccy);
    await db.query(
      `UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );

    const txnId = uuidv4();
    const maskedPan = panMasked || (cardNumber ? cardNumber.slice(-4) : 'N/A');

    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, pan_masked, emv_data, reference) VALUES (?, ?, 'credit', ?, ?, 'card_topup', ?, ?, ?)`,
      [txnId, wallet.id, amount, ccy, maskedPan, emvData || null, authorization.authCode]
    );

    return {
      success: true,
      transactionId: txnId,
      authCode: authorization.authCode,
      processorId: authorization.processorId,
      processor: authorization.processor,
      walletId: wallet.id,
      expiry,
      cvv,
      currency: ccy,
    };
  }

  async debitWallet(customerId: string, amount: number, source: string, reference?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const balanceRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balanceRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error(`Insufficient ${ccy} balance`);

    const transactionId = uuidv4();
    const ledgerEntry = createLedgerEntry(transactionId, 'debit', amount, ccy, 'AUTHORIZED', `Wallet debit via ${source || 'pos_offline'}`);
    validateTransition('PENDING', ledgerEntry.status as TransactionState);

    await db.query(
      `UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference) VALUES (?, ?, 'debit', ?, ?, ?, ?)`,
      [transactionId, wallet.id, amount, ccy, source || 'pos_offline', reference || null]
    );
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));
    return { success: true, transactionId, status: ledgerEntry.status, currency: ccy };
  }

  async getWalletBalance(customerId: string, currency?: string) {
    const ccy = currency ? this.normalizeCurrency(currency) : null;
    const res = ccy
      ? await db.query(
          'SELECT balance, currency FROM customer_wallets WHERE customer_id = ? AND currency = ?',
          [customerId, ccy]
        )
      // No currency: return the wallet with the highest balance (actual transaction currency)
      // Do NOT default to USD — show the currency the customer actually paid in
      : await db.query(
          `SELECT balance, currency FROM customer_wallets
           WHERE customer_id = ?
           ORDER BY CASE WHEN balance != 0 THEN 0 ELSE 1 END,
                    ABS(balance) DESC,
                    updated_at DESC,
                    created_at ASC
           LIMIT 1`,
          [customerId]
        );
    if (res.rows.length) return res.rows[0];
    // No wallet found — return zero balance without creating a default USD wallet.
    // A wallet is created when the first real transaction arrives with its actual currency.
    return { balance: 0, currency: ccy || 'USD' };
  }

  async getWalletTransactions(customerId: string, currency?: string) {
    const walletRes = currency
      ? await db.query('SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ?', [customerId, this.normalizeCurrency(currency)])
      : await db.query('SELECT id FROM customer_wallets WHERE customer_id = ?', [customerId]);
    if (!walletRes.rows.length) return [];
    const walletIds = walletRes.rows.map((r: any) => r.id);
    const placeholders = walletIds.map(() => '?').join(',');
    return (await db.query(
      `SELECT t.* FROM wallet_transactions t
       WHERE t.wallet_id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM customer_wallet_transaction_voids v
           WHERE v.transaction_id = t.id
         )
       ORDER BY t.created_at DESC LIMIT 100`,
      walletIds
    )).rows;
  }

  // ── Customers ────────────────────────────────────────────────────────────────
  async getCustomers() {
    // Join to the wallet with the highest balance per customer — that is the currency
    // they actually paid in on the processor. Do NOT hardcode USD-first ordering.
    return (await db.query(`
      SELECT
        c.id, c.name, c.email, c.phone, c.created_at, c.updated_at,
        w.id AS wallet_id,
        w.wallet_code,
        w.balance AS wallet_balance,
        w.currency AS wallet_currency
      FROM customers c
      LEFT JOIN customer_wallets w ON w.id = (
        SELECT id FROM customer_wallets
        WHERE customer_id = c.id
        ORDER BY CASE WHEN balance != 0 THEN 0 ELSE 1 END,
                 ABS(balance) DESC,
                 updated_at DESC,
                 created_at ASC
        LIMIT 1
      )
      ORDER BY c.created_at DESC
    `)).rows;
  }

  async createCustomer(name: string, email?: string, phone?: string) {
    const trimmedName = (name || '').trim();
    if (!trimmedName) throw new Error('Customer name is required');
    if (trimmedName.length < 2) throw new Error('Customer name must be at least 2 characters');
    if (trimmedName.length > 120) throw new Error('Customer name too long (max 120 chars)');

    const safeEmail = email && email.trim() ? email.trim() : null;
    const safePhone = phone && phone.trim() ? phone.trim() : null;

    const id = uuidv4();
    await db.query(
      'INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)',
      [id, trimmedName, safeEmail, safePhone]
    );
    const wallet = await this.getOrCreateWallet(id);
    const rows = (await db.query(
      'SELECT * FROM customers WHERE id = ?',
      [id]
    )).rows;
    const customer = rows[0];
    if (!customer) throw new Error('Customer record not found after insert — DB integrity failure');
    if (!customer.name) throw new Error('Customer name failed to persist — DB write verification failed');
    return {
      ...customer,
      wallet_id: wallet.id,
      wallet_code: wallet.wallet_code,
      wallet_balance: wallet.balance
    };
  }

  async deleteCustomer(customerId: string, confirmationName: string) {
    if (!customerId) throw new Error('customerId is required');

    const customerRes = await db.query(
      'SELECT id, name FROM customers WHERE id = ?',
      [customerId]
    );
    const customer = customerRes.rows[0];
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    if (String(confirmationName || '').trim() !== String(customer.name || '').trim()) {
      throw new Error('Confirmation name does not match the customer name');
    }

    const walletIds = (await db.query(
      'SELECT id FROM customer_wallets WHERE customer_id = ?',
      [customerId]
    )).rows.map((row: any) => row.id);

    if (walletIds.length > 0) {
      const placeholders = walletIds.map(() => '?').join(',');
      const walletBalance = await db.query(
        `SELECT COALESCE(SUM(balance), 0) AS total
           FROM customer_wallets
          WHERE id IN (${placeholders})`,
        walletIds
      );
      const walletTransactions = await db.query(
        `SELECT COUNT(*) AS count
           FROM wallet_transactions
          WHERE wallet_id IN (${placeholders})`,
        walletIds
      );
      if (Number(walletBalance.rows[0]?.total || 0) !== 0) {
        throw new Error('Customer still has a non-zero fiat wallet balance. Withdraw or transfer the funds before deleting the customer.');
      }
      if (Number(walletTransactions.rows[0]?.count || 0) > 0) {
        throw new Error('Customer has wallet transaction history. Delete is blocked to preserve the financial audit trail.');
      }
    }

    const cryptoBalance = await db.query(
      `SELECT COALESCE(SUM(balance), 0) AS total
         FROM customer_crypto_wallets
        WHERE customer_id = ?`,
      [customerId]
    );
    if (Number(cryptoBalance.rows[0]?.total || 0) !== 0) {
      throw new Error('Customer still has crypto funds. Withdraw or transfer the crypto before deleting the customer.');
    }

    const protectedCounts = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM crypto_transactions WHERE customer_id = ?', [customerId]),
      db.query('SELECT COUNT(*) AS count FROM customer_crypto_withdrawals WHERE customer_id = ?', [customerId]),
      db.query('SELECT COUNT(*) AS count FROM wallet_transfers WHERE sender_customer_id = ? OR receiver_customer_id = ?', [customerId, customerId]),
      db.query('SELECT COUNT(*) AS count FROM bank_accounts WHERE customer_id = ?', [customerId]),
    ]);
    if (protectedCounts.some((result) => Number(result.rows[0]?.count || 0) > 0)) {
      throw new Error('Customer has financial or bank activity. Delete is blocked to preserve the audit trail.');
    }

    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query('DELETE FROM customer_crypto_wallets WHERE customer_id = ?', [customerId]);
      await db.query('DELETE FROM customer_wallets WHERE customer_id = ?', [customerId]);
      await db.query('DELETE FROM customers WHERE id = ?', [customerId]);
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
      throw error;
    }

    return { id: customerId, name: customer.name, deleted: true };
  }

  // ── Update customer KYC / identity details ───────────────────────────────
  async updateCustomerKYC(customerId: string, kyc: {
    id_type?: string;
    id_number?: string;
    id_expiry?: string;
    id_country?: string;
    date_of_birth?: string;
    nationality?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    country?: string;
    postal_code?: string;
    occupation?: string;
    kyc_status?: string;
    risk_level?: string;
    notes?: string;
  }) {
    const existing = (await db.query('SELECT id FROM customers WHERE id = ?', [customerId])).rows;
    if (!existing.length) throw new Error(`Customer ${customerId} not found`);

    const allowed = [
      'id_type','id_number','id_expiry','id_country','date_of_birth',
      'nationality','address_line1','address_line2','city','country',
      'postal_code','occupation','kyc_status','risk_level','notes',
    ] as const;

    const setClauses: string[] = [];
    const values: any[]        = [];

    for (const key of allowed) {
      if (key in kyc && kyc[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(kyc[key]);
      }
    }

    if (setClauses.length === 0) throw new Error('No KYC fields to update');

    // Auto-set kyc_verified_at when status moves to VERIFIED
    if (kyc.kyc_status === 'VERIFIED') {
      setClauses.push('kyc_verified_at = ?');
      values.push(new Date().toISOString());
    }

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(customerId);

    await db.query(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    const row = (await db.query('SELECT * FROM customers WHERE id = ?', [customerId])).rows[0];
    return row;
  }

  // ── Get full customer profile with KYC ────────────────────────────────────
  async getCustomerProfile(customerId: string) {
    const rows = (await db.query('SELECT * FROM customers WHERE id = ?', [customerId])).rows;
    if (!rows.length) throw new Error(`Customer ${customerId} not found`);
    return rows[0];
  }

  // ── Merchant → Customer fiat transfer ────────────────────────────────────
  async merchantToCustomerTransfer(merchantId: string, customerId: string, amount: number, note?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    if (!merchantId) throw new Error('merchantId is required');
    if (!customerId) throw new Error('customerId is required');
    if (amount <= 0) throw new Error('Amount must be positive');

    // Verify customer exists
    const custRes = await db.query('SELECT id, name FROM customers WHERE id = ?', [customerId]);
    if (!custRes.rows.length) throw new Error(`Customer ${customerId} not found`);

    // Lock and debit merchant wallet
    const merchantWallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
    const balRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error(`Insufficient merchant wallet balance. Have $${balance.toFixed(2)}, need $${amount.toFixed(2)}`);

    const transferId = uuidv4();
    const ref = `MCT-${transferId.slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const description = note || `Merchant credit to customer ${custRes.rows[0].name}`;

    // Debit merchant
    await db.query(
      'UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?',
      [amount, now, merchantWallet.id]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference)
       VALUES (?, ?, 'debit', ?, ?, 'merchant_to_customer', ?)`,
      [uuidv4(), merchantWallet.id, amount, ccy, ref]
    );

    // Credit customer fiat wallet
    const customerWallet = await this.getOrCreateWallet(customerId, ccy);
    await db.query(
      'UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [amount, customerWallet.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description)
       VALUES (?, ?, 'credit', ?, ?, 'merchant_credit', ?, ?)`,
      [uuidv4(), customerWallet.id, amount, ccy, ref, description]
    );

    return {
      success: true,
      transferId,
      reference: ref,
      amount,
      currency: ccy,
      merchantId,
      customerId,
      customerName: custRes.rows[0].name,
      note: description,
    };
  }
  // ── Send customer assets → merchant hot wallet ───────────────────────────
  async sendCustomerAssetToHotWallet(
    customerId: string,
    merchantId: string,
    assetType: 'fiat' | 'crypto',
    amount: number,
    cryptoCoin?: string,
    reason?: string,
    currency: string = 'USD'
  ) {
    const ccy = this.normalizeCurrency(currency);
    if (!customerId) throw new Error('customerId is required');
    if (!merchantId) throw new Error('merchantId is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive');
    if (assetType !== 'fiat' && assetType !== 'crypto') throw new Error('Asset type must be fiat or crypto');

    // Verify customer exists
    const custRes = await db.query('SELECT id, name FROM customers WHERE id = ?', [customerId]);
    if (!custRes.rows.length) throw new Error(`Customer ${customerId} not found`);
    const customerName = custRes.rows[0].name;

    const ref = `STH-${uuidv4().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const description = reason || `Customer asset sweep to hot wallet`;

    await db.query('BEGIN IMMEDIATE');
    try {
    if (assetType === 'fiat') {
      // Debit customer fiat wallet
      const wallet = await this.getOrCreateWallet(customerId, ccy);
      const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
      const balance = Number(balRes.rows[0]?.balance ?? 0);
      if (balance < amount) throw new Error(`Insufficient ${ccy} balance. Have $${balance.toFixed(2)}, need $${amount.toFixed(2)}`);

      await db.query(
        'UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [amount, wallet.id]
      );
      await db.query(
        `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description)
         VALUES (?, ?, 'debit', ?, ?, 'hot_wallet_sweep', ?, ?)`,
        [uuidv4(), wallet.id, amount, ccy, ref, description]
      );

      // Credit merchant wallet
      const merchantWallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [amount, now, merchantWallet.id]
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description)
         VALUES (?, ?, 'credit', ?, ?, 'customer_asset_sweep', ?, ?)`,
        [uuidv4(), merchantWallet.id, amount, ccy, ref, `Fiat sweep from customer ${customerName}`]
      );

      await db.query('COMMIT');
      return {
        success: true, reference: ref, assetType: 'fiat',
        amount, currency: ccy, customerId, customerName, merchantId,
        description,
      };

    } else {
      // Crypto sweep
      if (!cryptoCoin) throw new Error('cryptoCoin is required for crypto asset type');
      const coin = cryptoCoin.toUpperCase();

      const walletRes = await db.query(
        'SELECT id, balance FROM customer_crypto_wallets WHERE customer_id = ? AND crypto_coin = ?',
        [customerId, coin]
      );
      if (!walletRes.rows.length) throw new Error(`No ${coin} wallet found for customer`);
      const cryptoBal = Number(walletRes.rows[0].balance ?? 0);
      if (cryptoBal < amount) throw new Error(`Insufficient ${coin} balance. Have ${cryptoBal}, need ${amount}`);

      // Debit customer crypto
      await db.query(
        'UPDATE customer_crypto_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND crypto_coin = ?',
        [amount, customerId, coin]
      );
      await db.query(
        `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, status, created_at)
         VALUES (?, ?, ?, 'hot_wallet_sweep', 0, ?, ?, 0, 'COMPLETED', ?)`,
        [uuidv4(), customerId, coin, amount, ccy, now]
      );

      // Credit merchant crypto balance
      await db.query(
        `INSERT OR IGNORE INTO merchant_crypto_balances (id, merchant_id, asset, amount, updated_at)
         VALUES (?, ?, ?, 0, ?)`,
        [uuidv4(), merchantId, coin, now]
      );
      await db.query(
        `UPDATE merchant_crypto_balances SET amount = amount + ?, updated_at = ? WHERE merchant_id = ? AND asset = ?`,
        [amount, now, merchantId, coin]
      );

      await db.query('COMMIT');
      return {
        success: true, reference: ref, assetType: 'crypto',
        amount, cryptoCoin: coin, customerId, customerName, merchantId,
        description,
      };
    }
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back customer-to-merchant transfer:', rollbackError);
      }
      throw error;
    }
  }

  async callProviderAndSendToMerchant(params: {
    customerId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
    endpointUrl: string;
    apiKey: string;
    requestReference: string;
    reason?: string;
  }) {
    const { customerId, merchantId, endpointUrl, apiKey, requestReference } = params;
    const amountMinor = Number(params.amountMinor);
    const ccy = this.normalizeCurrency(params.currency);

    if (!customerId || !merchantId || !endpointUrl || !apiKey || !requestReference) {
      throw new Error('customerId, merchantId, endpointUrl, apiKey, and requestReference are required');
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('amountMinor must be a positive integer');
    }
    if (!/^[A-Z]{3}$/.test(ccy)) {
      throw new Error('currency must be a three-letter code');
    }
    if (!/^WPM-[A-Z0-9]{8,32}$/.test(requestReference)) {
      throw new Error('requestReference is invalid');
    }

    let providerUrl: URL;
    try {
      providerUrl = new URL(endpointUrl);
    } catch {
      throw new Error('Provider endpoint URL is invalid');
    }
    if (providerUrl.protocol !== 'https:' || providerUrl.username || providerUrl.password) {
      throw new Error('Provider endpoint must be an HTTPS URL without embedded credentials');
    }
    const allowedHosts = String(process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (!allowedHosts.includes(providerUrl.hostname.toLowerCase())) {
      throw new Error('Provider endpoint host is not allowlisted by the server');
    }

    const amount = amountMinor / 100;
    const now = new Date().toISOString();
    await db.query(`CREATE TABLE IF NOT EXISTS customer_provider_transfers (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_reference TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    let walletId = '';
    let customerName = '';
    await db.query('BEGIN IMMEDIATE');
    try {
      const previous = await db.query(
        'SELECT * FROM customer_provider_transfers WHERE reference = ?',
        [requestReference],
      );
      if (previous.rows.length) {
        await db.query('ROLLBACK');
        const existing = previous.rows[0];
        if (existing.status === 'SUCCEEDED') {
          return {
            success: true,
            reference: requestReference,
            providerReference: existing.provider_reference || requestReference,
            amount: Number(existing.amount_minor) / 100,
            currency: existing.currency,
            customerId: existing.customer_id,
            merchantId: existing.merchant_id,
          };
        }
        throw new Error(`Provider request ${requestReference} is ${existing.status}; do not retry it`);
      }

      const unresolved = await db.query(
        `SELECT reference, status FROM customer_provider_transfers
          WHERE customer_id = ? AND currency = ?
            AND status IN ('PROCESSING', 'UNKNOWN', 'PROVIDER_CONFIRMED')
          LIMIT 1`,
        [customerId, ccy],
      );
      if (unresolved.rows.length) {
        throw new Error(
          `Provider request ${unresolved.rows[0].reference} is ${unresolved.rows[0].status}; reconcile it before starting another transfer`,
        );
      }

      const customer = await db.query('SELECT id, name FROM customers WHERE id = ?', [customerId]);
      if (!customer.rows.length) throw new Error(`Customer ${customerId} not found`);
      customerName = String(customer.rows[0].name || '');
      const walletRes = await db.query(
        'SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ?',
        [customerId, ccy],
      );
      if (!walletRes.rows.length) throw new Error(`Insufficient ${ccy} customer wallet balance`);
      walletId = String(walletRes.rows[0].id);
      const reserved = await db.query(
        'UPDATE customer_wallets SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?',
        [amount, now, walletId, amount],
      );
      if (reserved.rowCount !== 1) throw new Error(`Insufficient ${ccy} customer wallet balance`);
      await db.query(
        `INSERT INTO customer_provider_transfers
          (id, reference, customer_id, merchant_id, wallet_id, amount_minor, currency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?)`,
        [uuidv4(), requestReference, customerId, merchantId, walletId, amountMinor, ccy, now, now],
      );
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back provider transfer reservation:', rollbackError);
      }
      throw error;
    }

    const updateStatus = async (status: string, errorMessage?: string, providerReference?: string) => {
      await db.query(
        `UPDATE customer_provider_transfers
            SET status = ?, error_message = ?, provider_reference = ?, updated_at = ?
          WHERE reference = ?`,
        [status, errorMessage || null, providerReference || null, new Date().toISOString(), requestReference],
      );
    };
    const releaseReservation = async (errorMessage: string) => {
      await db.query('BEGIN IMMEDIATE');
      try {
        await db.query(
          'UPDATE customer_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
          [amount, new Date().toISOString(), walletId],
        );
        await updateStatus('FAILED', errorMessage);
        await db.query('COMMIT');
      } catch (error) {
        try { await db.query('ROLLBACK'); } catch (rollbackError) {
          console.error('[WalletsService] Failed to roll back provider reservation release:', rollbackError);
        }
        throw error;
      }
    };

    let response;
    try {
      response = await axios.post(
        providerUrl.toString(),
        { customerId, merchantId, amountMinor, currency: ccy, reference: requestReference },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: ['Bearer', apiKey].join(' '),
            'Idempotency-Key': requestReference,
          },
          timeout: 8000,
          maxRedirects: 0,
          maxContentLength: 32 * 1024,
          maxBodyLength: 32 * 1024,
        },
      );
    } catch (error: unknown) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status && status >= 400 && status < 500) {
        const message = `Provider rejected the request (HTTP ${status})`;
        await releaseReservation(message);
        throw new Error(message);
      }
      const message = `Provider result is uncertain; funds are held under reference ${requestReference}. Reconcile before retrying.`;
      await updateStatus('UNKNOWN', message);
      throw new Error(message);
    }

    const providerResult = response.data;
    if (providerResult?.status !== 'SUCCESS') {
      const status = String(providerResult?.status || '').toUpperCase();
      const message = providerResult?.message || 'Provider did not confirm the payment';
      if (['FAILED', 'DECLINED', 'ERROR', 'REJECTED'].includes(status)) {
        await releaseReservation(message);
        throw new Error(message);
      }
      await updateStatus('UNKNOWN', message);
      throw new Error(`Provider result is uncertain; funds are held under reference ${requestReference}`);
    }
    if (
      (providerResult.amountMinor !== undefined && Number(providerResult.amountMinor) !== amountMinor) ||
      (providerResult.currency !== undefined && String(providerResult.currency).toUpperCase() !== ccy)
    ) {
      const message = `Provider returned mismatched amount or currency; funds are held under reference ${requestReference}`;
      await updateStatus('UNKNOWN', message, providerResult.providerTransactionId || providerResult.reference);
      throw new Error(message);
    }

    const providerReference = String(
      providerResult.providerTransactionId || providerResult.reference || requestReference,
    );
    await updateStatus('PROVIDER_CONFIRMED', undefined, providerReference);

    await db.query('BEGIN IMMEDIATE');
    try {
      const merchantWallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
      const postedAt = new Date().toISOString();
      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [amount, postedAt, merchantWallet.id],
      );
      await db.query(
        `INSERT INTO wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description)
         VALUES (?, ?, 'debit', ?, ?, 'provider_transfer', ?, ?)`,
        [uuidv4(), walletId, amount, ccy, requestReference, params.reason || `Provider transfer to merchant ${merchantId}`],
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'credit', ?, ?, 'customer_provider_transfer', ?, ?, ?)`,
        [uuidv4(), merchantWallet.id, amount, ccy, requestReference, `Provider-confirmed customer transfer ${requestReference}`, postedAt],
      );
      await updateStatus('SUCCEEDED', undefined, providerReference);
      await db.query('COMMIT');
      return {
        success: true,
        reference: requestReference,
        providerReference,
        assetType: 'fiat',
        amount,
        currency: ccy,
        customerId,
        customerName,
        merchantId,
        description: params.reason || `Provider transfer to merchant ${merchantId}`,
      };
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back provider-confirmed wallet posting:', rollbackError);
      }
      throw new Error(
        `Provider confirmed reference ${requestReference}, but merchant wallet posting needs reconciliation`,
      );
    }
  }

  async pullProviderFundsToMerchant(params: {
    customerId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
    endpointUrl: string;
    apiKey: string;
    secretKey: string;
    requestReference: string;
    reason?: string;
  }) {
    const { customerId, merchantId, endpointUrl, apiKey, secretKey, requestReference } = params;
    const amountMinor = Number(params.amountMinor);
    const ccy = this.normalizeCurrency(params.currency);

    if (!customerId || !merchantId || !endpointUrl || !apiKey || !secretKey || !requestReference) {
      throw new Error('customerId, merchantId, endpointUrl, apiKey, secretKey, and requestReference are required');
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('amountMinor must be a positive integer');
    }
    if (!/^[A-Z]{3}$/.test(ccy)) {
      throw new Error('currency must be a three-letter code');
    }
    if (!/^WPP-[A-Z0-9]{8,32}$/.test(requestReference)) {
      throw new Error('requestReference must start with WPP- followed by 8-32 alphanumeric chars');
    }

    let providerUrl: URL;
    try {
      providerUrl = new URL(endpointUrl);
    } catch {
      throw new Error('Provider endpoint URL is invalid');
    }
    const isLoopback = providerUrl.hostname === '127.0.0.1'
      || providerUrl.hostname === 'localhost'
      || providerUrl.hostname === '[::1]';
    if (providerUrl.protocol !== 'https:' && !(providerUrl.protocol === 'http:' && isLoopback)) {
      throw new Error('Provider endpoint must be an HTTPS URL or local loopback HTTP');
    }
    if (providerUrl.username || providerUrl.password) {
      throw new Error('Provider endpoint URL must not contain embedded credentials');
    }
    const allowedHosts = String(process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (allowedHosts.length > 0 && !allowedHosts.includes(providerUrl.hostname.toLowerCase())) {
      throw new Error('Provider endpoint host is not allowlisted by the server');
    }

    const amount = amountMinor / 100;
    const now = new Date().toISOString();

    await db.query(`CREATE TABLE IF NOT EXISTS customer_provider_pulls (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      merchant_wallet_id TEXT,
      amount_minor INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      endpoint_host TEXT NOT NULL,
      provider_reference TEXT,
      provider_response TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    await db.query('BEGIN IMMEDIATE');
    try {
      const previous = await db.query(
        'SELECT * FROM customer_provider_pulls WHERE reference = ?',
        [requestReference],
      );
      if (previous.rows.length) {
        await db.query('ROLLBACK');
        const existing = previous.rows[0] as any;
        if (existing.status === 'MERCHANT_CREDITED' || existing.status === 'SUCCESS') {
          return {
            success: true,
            idempotent: true,
            reference: requestReference,
            providerReference: existing.provider_reference || requestReference,
            amount: Number(existing.amount_minor) / 100,
            currency: existing.currency,
            customerId: existing.customer_id,
            merchantId: existing.merchant_id,
            merchantWalletId: existing.merchant_wallet_id,
          };
        }
        if (existing.status === 'FAILED') {
          throw new Error(`Provider pull ${requestReference} previously failed. Do not retry the same reference.`);
        }
        throw new Error(`Provider pull ${requestReference} is ${existing.status}; reconcile it before starting another pull`);
      }

      const unresolved = await db.query(
        `SELECT reference, status FROM customer_provider_pulls
          WHERE customer_id = ? AND currency = ?
            AND status IN ('CREATED', 'PROVIDER_CALL', 'PROVIDER_CONFIRMED')
          LIMIT 1`,
        [customerId, ccy],
      );
      if (unresolved.rows.length) {
        await db.query('ROLLBACK');
        throw new Error(
          `Provider pull ${unresolved.rows[0].reference} is ${unresolved.rows[0].status}; reconcile it before starting another pull`,
        );
      }

      const customer = await db.query('SELECT id, name FROM customers WHERE id = ?', [customerId]);
      if (!customer.rows.length) {
        await db.query('ROLLBACK');
        throw new Error(`Customer ${customerId} not found`);
      }

      const mw = await db.query('SELECT id FROM merchant_wallets WHERE merchant_id = ? LIMIT 1', [merchantId]);
      if (!mw.rows.length) {
        const merchants = await db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='merchants'`);
        if (merchants.rows.length) {
          const m = await db.query('SELECT id FROM merchants WHERE id = ? LIMIT 1', [merchantId]);
          if (!m.rows.length) {
            await db.query('ROLLBACK');
            throw new Error(`Merchant ${merchantId} not found`);
          }
        }
      }

      const pullId = uuidv4();
      await db.query(
        `INSERT INTO customer_provider_pulls
          (id, reference, customer_id, merchant_id, amount_minor, amount, currency, status, endpoint_host, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?)`,
        [pullId, requestReference, customerId, merchantId, amountMinor, amount, ccy, providerUrl.hostname.toLowerCase(), now, now],
      );
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back provider pull init:', rollbackError);
      }
      throw error;
    }

    const updateStatus = async (status: string, errorMessage?: string, providerReference?: string, providerResponse?: object) => {
      try {
        await db.query(
          `UPDATE customer_provider_pulls
              SET status = ?, error_message = ?, provider_reference = ?, provider_response = ?, updated_at = ?
            WHERE reference = ?`,
          [
            status,
            errorMessage || null,
            providerReference || null,
            providerResponse ? JSON.stringify(providerResponse).slice(0, 8000) : null,
            new Date().toISOString(),
            requestReference,
          ],
        );
      } catch { /* non-critical — status update failure should never block the flow */ }
    };

    try {
      await updateStatus('PROVIDER_CALL');
    } catch { /* non-critical */ }

    const requestBody = {
      action: 'pull_funds',
      customerId,
      merchantId,
      amountMinor,
      amount,
      currency: ccy,
      reference: requestReference,
      processorId: 'PRIMESTACK-B4C329F83258',
      timestamp: Math.floor(Date.now() / 1000),
    };
    const payloadText = JSON.stringify(requestBody);
    const timestamp = String(Date.now());
    const nonce = `${timestamp}-${uuidv4()}`;
    const signature = crypto
      .createHmac('sha512', String(secretKey))
      .update(`${timestamp}.${nonce}.${payloadText}`, 'utf8')
      .digest('hex');

    let providerResponse: any;
    try {
      const response = await axios.post(
        providerUrl.toString(),
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Timestamp': timestamp,
            'X-Nonce': nonce,
            'X-Signature': signature,
            'X-Processor-Id': 'PRIMESTACK-B4C329F83258',
            'Idempotency-Key': requestReference,
          },
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: 64 * 1024,
          maxBodyLength: 64 * 1024,
        },
      );
      providerResponse = response.data;
    } catch (error: unknown) {
      const axiosStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
      const axiosBody = axios.isAxiosError(error) ? error.response?.data : undefined;
      const providerMessage = axiosBody?.message || axiosBody?.error || (error instanceof Error ? error.message : 'Unknown');

      if (axiosStatus && axiosStatus >= 400 && axiosStatus < 500) {
        const message = `Provider rejected the pull (HTTP ${axiosStatus}): ${providerMessage}`;
        try { await updateStatus('FAILED', message, undefined, axiosBody); } catch { /* non-critical */ }
        throw new Error(message);
      }
      const message = `Provider pull result is uncertain; reference ${requestReference}. DO NOT retry with the same reference. Reconcile manually with the provider before proceeding.`;
      try { await updateStatus('UNKNOWN', message, undefined, axiosBody); } catch { /* non-critical */ }
      throw new Error(message);
    }

    try {
      await updateStatus('PROVIDER_CONFIRMED', undefined, undefined, providerResponse);
    } catch { /* non-critical */ }

    const responseStatus = String(providerResponse?.status || providerResponse?.result || '').toUpperCase();
    const confirmed = providerResponse?.success === true
      || providerResponse?.ok === true
      || providerResponse?.confirmed === true
      || ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'CONFIRMED', 'SETTLED', 'POSTED', 'APPROVED', 'PAID'].includes(responseStatus);

    if (!confirmed) {
      const message = providerResponse?.message || providerResponse?.error || `Provider did not confirm the payment (status=${responseStatus || 'UNKNOWN'})`;
      const terminal = ['FAILED', 'DECLINED', 'ERROR', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(responseStatus);
      try { await updateStatus(terminal ? 'FAILED' : 'UNKNOWN', message, providerResponse?.providerTransactionId || providerResponse?.reference, providerResponse); } catch { /* non-critical */ }
      throw new Error(message);
    }

    const responseDump = JSON.stringify(providerResponse).toLowerCase();
    if (/(^|[^a-z0-9])(mock|demo|simulat|sandbox|staging|test[^a-z0-9])/.test(responseDump)) {
      const message = 'Provider response contains mock/sandbox/test indicators. Live real funds are required.';
      try { await updateStatus('FAILED', message, undefined, providerResponse); } catch { /* non-critical */ }
      throw new Error(message);
    }

    if (providerResponse?.amountMinor !== undefined && Number(providerResponse.amountMinor) !== amountMinor) {
      const message = `Provider returned mismatched amountMinor (expected=${amountMinor}, got=${providerResponse.amountMinor})`;
      try { await updateStatus('UNKNOWN', message, providerResponse?.providerTransactionId || providerResponse?.reference, providerResponse); } catch { /* non-critical */ }
      throw new Error(message);
    }
    if (providerResponse?.amount !== undefined) {
      const got = Number(providerResponse.amount);
      const diff = Math.abs(got - amount);
      if (Number.isFinite(got) && diff > 0.009) {
        const message = `Provider returned mismatched amount (expected=${amount}, got=${got})`;
        try { await updateStatus('UNKNOWN', message, providerResponse?.providerTransactionId || providerResponse?.reference, providerResponse); } catch { /* non-critical */ }
        throw new Error(message);
      }
    }
    if (providerResponse?.currency !== undefined && String(providerResponse.currency).toUpperCase() !== ccy) {
      const message = `Provider returned mismatched currency (expected=${ccy}, got=${providerResponse.currency})`;
      try { await updateStatus('UNKNOWN', message, providerResponse?.providerTransactionId || providerResponse?.reference, providerResponse); } catch { /* non-critical */ }
      throw new Error(message);
    }

    const providerReference = String(
      providerResponse?.providerTransactionId
        || providerResponse?.transactionId
        || providerResponse?.reference
        || providerResponse?.id
        || requestReference,
    );

    await db.query('BEGIN IMMEDIATE');
    let merchantWalletId = '';
    try {
      const merchantWallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
      merchantWalletId = String(merchantWallet.id);
      const postedAt = new Date().toISOString();

      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [amount, postedAt, merchantWallet.id],
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'credit', ?, ?, 'provider_real_funds_pull', ?, ?, ?)`,
        [
          uuidv4(),
          merchantWallet.id,
          amount,
          ccy,
          requestReference,
          `REAL withdrawable funds confirmed via customer provider pull ${providerReference}. Ready for vault bank transfer or withdrawal.`,
          postedAt,
        ],
      );
      await db.query(
        'UPDATE customer_provider_pulls SET status = ?, merchant_wallet_id = ?, updated_at = ? WHERE reference = ?',
        ['MERCHANT_CREDITED', merchantWalletId, postedAt, requestReference],
      );
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back merchant wallet credit after provider confirmed:', rollbackError);
      }
      const message = `Provider confirmed reference ${requestReference} (providerRef=${providerReference}), but merchant wallet credit needs manual reconciliation. DO NOT retry.`;
      try { await updateStatus('RECONCILE_NEEDED', message, providerReference, providerResponse); } catch { /* non-critical */ }
      throw new Error(message);
    }

    const customerRow = (await db.query('SELECT name FROM customers WHERE id = ?', [customerId])).rows?.[0] as any;
    return {
      success: true,
      idempotent: false,
      reference: requestReference,
      providerReference,
      assetType: 'fiat' as const,
      amount,
      amountMinor,
      currency: ccy,
      customerId,
      customerName: String(customerRow?.name || ''),
      merchantId,
      merchantWalletId,
      source: 'provider_real_funds_pull',
      realFundsConfirmed: true,
      description: params.reason || `Provider real fund pull → merchant wallet ${merchantId}`,
      nextStep: 'Merchant dashboard → Merchant Wallet → Send to Vault Bank to transfer these real withdrawable funds to Vault Bank omnibus.',
    };
  }

  async walletTransfer(senderCustomerId: string, receiverCustomerId: string, amount: number, note?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    if (!senderCustomerId || !receiverCustomerId) throw new Error('Sender and recipient are required');
    if (senderCustomerId === receiverCustomerId) throw new Error('Cannot transfer to yourself');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      throw new Error('Transfer amount must have no more than two decimal places');
    }

    const customers = await db.query(
      'SELECT id FROM customers WHERE id IN (?, ?)',
      [senderCustomerId, receiverCustomerId],
    );
    if (customers.rows.length !== 2) throw new Error('Sender or recipient customer not found');

    const sender = await this.getOrCreateWallet(senderCustomerId, ccy);
    const receiver = await this.getOrCreateWallet(receiverCustomerId, ccy);
    const transferId = uuidv4();
    const ref = `TRF-${transferId.slice(0, 8).toUpperCase()}`;

    await db.query('BEGIN IMMEDIATE');
    try {
      const debit = await db.query(
        'UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND balance >= ?',
        [amount, sender.id, amount],
      );
      if (debit.rowCount !== 1) throw new Error(`Insufficient ${ccy} balance`);

      await db.query(
        `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'debit', ?, ?, 'wallet_transfer', ?, ?)`,
        [uuidv4(), sender.id, amount, ccy, ref, `Transfer to ${receiverCustomerId}`]
      );

      await db.query(
        'UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [amount, receiver.id],
      );
      await db.query(
        `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'credit', ?, ?, 'wallet_transfer', ?, ?)`,
        [uuidv4(), receiver.id, amount, ccy, ref, `Transfer from ${senderCustomerId}`]
      );

      await db.query(
        `INSERT INTO wallet_transfers (id, sender_customer_id, receiver_customer_id, amount, currency, note, status, fee) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 0)`,
        [transferId, senderCustomerId, receiverCustomerId, amount, ccy, note || null]
      );

      await db.query('COMMIT');
      return { success: true, transferId, reference: ref, amount, currency: ccy };
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[WalletsService] Failed to roll back wallet transfer:', rollbackError);
      }
      throw error;
    }
  }

  // ── Bank accounts ─────────────────────────────────────────────────────────
  async addBankAccount(customerId: string, bankData: {
    bankName: string; accountHolder: string; accountNumber: string;
    routingNumber?: string; iban?: string; swiftCode?: string; currency?: string;
  }) {
    const id = uuidv4();
    const ccy = this.normalizeCurrency(bankData.currency);
    await db.query(
      `INSERT INTO bank_accounts (id, customer_id, bank_name, account_holder, account_number, routing_number, iban, swift_code, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId, bankData.bankName, bankData.accountHolder, bankData.accountNumber,
       bankData.routingNumber || null, bankData.iban || null, bankData.swiftCode || null, ccy]
    );
    return (await db.query('SELECT * FROM bank_accounts WHERE id = ?', [id])).rows[0];
  }

  async getBankAccounts(customerId: string) {
    return (await db.query('SELECT * FROM bank_accounts WHERE customer_id = ? ORDER BY created_at DESC', [customerId])).rows;
  }

  // ── Wallet-to-Bank payout ─────────────────────────────────────────────────
  async bankPayout(customerId: string, bankAccountId: string, amount: number, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    if (amount <= 0) throw new Error('Amount must be positive');

    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);

    const FEE_RATE = 0.005; // 0.5% fee
    const fee = Math.round(amount * FEE_RATE * 100) / 100;
    const netAmount = amount - fee;
    if (balance < amount) throw new Error(`Insufficient ${ccy} balance`);

    const bankRes = await db.query('SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?', [bankAccountId, customerId]);
    if (!bankRes.rows.length) throw new Error('Bank account not found');

    const payoutId = uuidv4();
    const ref = `PAY-${payoutId.slice(0, 8).toUpperCase()}`;

    // Debit wallet
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, wallet.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'debit', ?, ?, 'bank_payout', ?, ?)`,
      [uuidv4(), wallet.id, amount, ccy, ref, `Bank payout to ${bankRes.rows[0].bank_name}`]
    );

    // Record payout (PENDING — real payout requires ACH/SEPA integration)
    await db.query(
      `INSERT INTO bank_payouts (id, customer_id, bank_account_id, amount, currency, fee, net_amount, status, reference, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, datetime('now', '+1 day'))`,
      [payoutId, customerId, bankAccountId, amount, ccy, fee, netAmount, ref]
    );

    // Get customer details for receipt
    const customerRes = await db.query('SELECT * FROM customers WHERE id = ?', [customerId]);
    const customer = customerRes.rows[0];
    const bankAccount = bankRes.rows[0];

    const payoutData: any = { 
      success: true, 
      payoutId, 
      reference: ref, 
      amount, 
      fee, 
      netAmount, 
      status: 'PENDING', 
      eta: '1-2 business days', 
      currency: ccy,
      customer,
      bankAccount
    };

    // Generate receipt text
    payoutData.receipt = this.generateBankPayoutReceipt(payoutData, customer, bankAccount);

    return payoutData;
  }

  // Generate a simple receipt text for bank payout
  generateBankPayoutReceipt(payout: any, customer: any, bankAccount: any): string {
    const now = new Date().toLocaleString();
    return `
═══════════════════════════════════════════
         BANK PAYOUT RECEIPT
═══════════════════════════════════════════

Reference: ${payout.reference}
Date: ${now}
Status: ${payout.status}

CUSTOMER INFORMATION
─────────────────────────────────────────
Name: ${customer.name}
Email: ${customer.email || 'N/A'}
Phone: ${customer.phone || 'N/A'}

BANK ACCOUNT
─────────────────────────────────────────
Bank: ${bankAccount.bank_name}
Account Holder: ${bankAccount.account_holder}
Account Number: ****${String(bankAccount.account_number).slice(-4)}
${bankAccount.routing_number ? `Routing Number: ${bankAccount.routing_number}` : ''}

PAYOUT DETAILS
─────────────────────────────────────────
Amount:          ${payout.currency} $${Number(payout.amount).toFixed(2)}
Processing Fee:  ${payout.currency} $${Number(payout.fee).toFixed(2)}
Net Amount:      ${payout.currency} $${Number(payout.netAmount).toFixed(2)}

ETA: ${payout.eta}

═══════════════════════════════════════════
       Thank you for your business!
═══════════════════════════════════════════

This is a computer-generated receipt.
No signature required.

Generated: ${now}
    `.trim();
  }

  async getBankPayouts(customerId: string) {
    return (await db.query(
      'SELECT p.*, b.bank_name, b.account_number FROM bank_payouts p JOIN bank_accounts b ON b.id = p.bank_account_id WHERE p.customer_id = ? ORDER BY p.created_at DESC LIMIT 50',
      [customerId]
    )).rows;
  }

  // ── Crypto ────────────────────────────────────────────────────────────────
  async getCryptoPrice(cryptoCoin: string): Promise<number> {
    const coin = cryptoCoin.toUpperCase();
    const xr = await import('../../exchange/exchange-router.service');
    const result = await xr.getBestPrice(coin);
    return result.priceUsd;
  }

  async getOrCreateCryptoWallet(customerId: string, cryptoCoin: string) {
    const res = await db.query('SELECT * FROM customer_crypto_wallets WHERE customer_id = ? AND crypto_coin = ?', [customerId, cryptoCoin]);
    if (res.rows.length) return res.rows[0];
    const id = uuidv4();
    await db.query('INSERT INTO customer_crypto_wallets (id, customer_id, crypto_coin, balance) VALUES (?, ?, ?, 0)', [id, customerId, cryptoCoin]);
    return (await db.query('SELECT * FROM customer_crypto_wallets WHERE id = ?', [id])).rows[0];
  }

  async getCustomerCryptoWallets(customerId: string) {
    return (await db.query('SELECT * FROM customer_crypto_wallets WHERE customer_id = ? ORDER BY crypto_coin', [customerId])).rows;
  }

  async getAllCustomersCryptoWallets() {
    const res = await db.query(`
      SELECT c.id AS customer_id, c.name, c.email, c.phone,
             w.id AS wallet_id, w.crypto_coin, w.balance, w.crypto_address, w.status, w.created_at, w.updated_at
      FROM customer_crypto_wallets w
      LEFT JOIN customers c ON c.id = w.customer_id
      ORDER BY w.crypto_coin, datetime(w.created_at) DESC
    `);
    const rows = res.rows;
    const totals: Record<string, { totalBalance: number; customerCount: number; wallets: any[] }> = {};
    rows.forEach((r: any) => {
      const coin = r.crypto_coin;
      if (!totals[coin]) totals[coin] = { totalBalance: 0, customerCount: 0, wallets: [] };
      totals[coin].totalBalance += Number(r.balance || 0);
      totals[coin].wallets.push(r);
    });
    const seen: Record<string, Set<string>> = {};
    Object.keys(totals).forEach(coin => {
      seen[coin] = new Set();
      totals[coin].wallets.forEach((w: any) => {
        if (w.customer_id && !seen[coin].has(w.customer_id)) {
          seen[coin].add(w.customer_id);
          totals[coin].customerCount++;
        }
      });
    });
    return {
      totalWallets: rows.length,
      byCoin: totals,
      wallets: rows,
      generatedAt: new Date().toISOString(),
    };
  }

  async buyCryptoWithMerchant(
    merchantId: string,
    cryptoCoin: string,
    fiatAmount: number,
    network?: string
  ) {
    const coin = cryptoCoin.toUpperCase();
    if (!fiatAmount || fiatAmount <= 0 || !Number.isFinite(fiatAmount)) throw new Error('fiatAmount must be a positive number');
    if (!coin || coin.trim().length === 0) throw new Error('cryptoCoin (symbol) required');

    const merchantWallet = await this.getOrCreateMerchantWallet(merchantId, 'USD');
    const balanceRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id]);
    const balance = Number(balanceRes.rows[0]?.balance ?? 0);
    if (balance < fiatAmount) throw new Error(`Insufficient merchant wallet USD balance. Have $${balance.toFixed(2)}, need $${fiatAmount.toFixed(2)}`);

    let binanceOrderId: string | null = null;
    let providerMode: 'live' | 'sandbox' | 'blocked' = 'live';
    let cryptoAmount = 0;
    let exchangeRate = coin === 'USDT' ? 1.0 : 0;
    let rawOrder: any = null;
    let fills: any[] = [];

    try {
      const bs = await import('../../exchange/binance.service');
      const cfg = bs.getBinanceConfig();
      providerMode = cfg.mode;
      if (providerMode !== 'live' && providerMode !== 'sandbox') {
        throw new Error(`Binance provider mode ${providerMode} not permitted for merchant crypto purchases.`);
      }
      const order = await bs.buyAssetWithUsd(coin, fiatAmount);
      if (!order || !order.ok) throw new Error('Exchange buy order returned not-ok');
      cryptoAmount = Number(order.executedQty ?? 0);
      binanceOrderId = String(order.order_id || `MERCH-BUY-${Date.now()}`);
      fills = order.fills || [];
      rawOrder = order.raw;
      if (cryptoAmount <= 0) throw new Error('Exchange executed 0 quantity (no fills)');
      if (fiatAmount > 0) {
        exchangeRate = coin === 'USDT'
          ? (cryptoAmount / fiatAmount)
          : (fiatAmount / cryptoAmount);
      }
    } catch (exErr: any) {
      const msg = String(exErr?.message || 'Exchange failure').slice(0, 800);
      const isBlocked = /NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED|CRYPTO_PURCHASE_BLOCKED|Binance API keys not configured/.test(msg);
      if (isBlocked) {
        throw new Error(`Merchant crypto purchase blocked. ${msg}`);
      }
      throw new Error(`Merchant crypto purchase aborted. ${msg}`);
    }

    const sourceDesc = 'crypto_purchase';
    const sourceRef = binanceOrderId || uuidv4();

    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        'UPDATE merchant_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [fiatAmount, merchantWallet.id]
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, source, reference, meta) VALUES (?, ?, 'debit', ?, ?, ?, ?)`,
        [uuidv4(), merchantWallet.id, fiatAmount, sourceDesc, sourceRef, JSON.stringify({
          provider_mode: providerMode,
          binance_order_id: binanceOrderId,
          asset: coin,
          crypto_amount: cryptoAmount,
          exchange_rate: exchangeRate,
          network: network || null,
          fills_count: fills.length,
        })]
      );

      const existingCrypto = await db.query(
        'SELECT id, amount FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?',
        [merchantId, coin]
      );
      if (existingCrypto.rows.length > 0) {
        await db.query(
          'UPDATE merchant_crypto_balances SET amount = amount + ?, updated_at = CURRENT_TIMESTAMP, is_mock = 0, meta = COALESCE(meta, ?) WHERE merchant_id = ? AND asset = ?',
          [
            cryptoAmount,
            JSON.stringify({
              last_buy: {
                ts: new Date().toISOString(),
                fiat_spent: fiatAmount,
                crypto_received: cryptoAmount,
                provider_mode: providerMode,
                binance_order_id: binanceOrderId,
                network: network || null,
              }
            }),
            merchantId,
            coin,
          ]
        );
      } else {
        await db.query(
          'INSERT INTO merchant_crypto_balances (id, merchant_id, asset, amount, is_mock, updated_at, meta) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?)',
          [
            uuidv4(),
            merchantId,
            coin,
            cryptoAmount,
            JSON.stringify({
              last_buy: {
                ts: new Date().toISOString(),
                fiat_spent: fiatAmount,
                crypto_received: cryptoAmount,
                provider_mode: providerMode,
                binance_order_id: binanceOrderId,
                network: network || null,
              }
            })
          ]
        );
      }

      // 2-sided ledger (debit fiat USD side + credit crypto asset side)
      {
        const txnUsd = uuidv4();
        const ledgerUsd = createLedgerEntry(
          txnUsd, 'debit', fiatAmount, 'USD', 'AUTHORIZED',
          `Merchant ${merchantId} spent ${fiatAmount} USD to buy ${cryptoAmount} ${coin} [ref:${sourceRef}]`,
          merchantId,
          'crypto',
          sourceRef,
          network || undefined,
          sourceRef
        );
        validateTransition('PENDING', ledgerUsd.status as any);
        await persistLedgerEntry(ledgerUsd, db.query.bind(db));
        await db.query(`UPDATE ledger_entries SET status='CAPTURED' WHERE id=? AND status='AUTHORIZED'`, [txnUsd]);
        await db.query(`UPDATE ledger_entries SET status='SETTLED' WHERE id=? AND status='CAPTURED'`, [txnUsd]);
      }
      {
        const txnCrypto = uuidv4();
        const ledgerCrypto = createLedgerEntry(
          txnCrypto, 'credit', cryptoAmount, coin, 'AUTHORIZED',
          `Merchant ${merchantId} received ${cryptoAmount} ${coin} in exchange for $${fiatAmount} USD [ref:${sourceRef}]`,
          merchantId,
          'crypto',
          sourceRef,
          network || undefined,
          sourceRef
        );
        validateTransition('PENDING', ledgerCrypto.status as any);
        await persistLedgerEntry(ledgerCrypto, db.query.bind(db));
        await db.query(`UPDATE ledger_entries SET status='CAPTURED' WHERE id=? AND status='AUTHORIZED'`, [txnCrypto]);
        await db.query(`UPDATE ledger_entries SET status='SETTLED' WHERE id=? AND status='CAPTURED'`, [txnCrypto]);
      }

      const fillsShort = fills.slice(0, 20);
      const cryptoTxnId = uuidv4();
      await db.query(
        `INSERT INTO crypto_transactions
         (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, reference, status, is_mock, provider_mode, meta, binance_order_id, fills_json)
         VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, 'merchant_wallet', ?, 'completed', 0, ?, ?, ?, ?)`,
        [
          cryptoTxnId,
          merchantId,
          coin,
          fiatAmount,
          cryptoAmount,
          exchangeRate,
          sourceRef,
          providerMode,
          JSON.stringify({ network: network || null, provider: 'binance', raw: typeof rawOrder === 'object' && rawOrder ? '[stripped-raw]' : null }),
          binanceOrderId,
          JSON.stringify(fillsShort),
        ]
      );
      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }

    return {
      success: true,
      mode: providerMode,
      cryptoAmount,
      cryptoCoin: coin,
      exchangeRate,
      fiatAmount,
      merchantId,
      providerMode,
      binanceOrderId: binanceOrderId,
      exchangeOrderId: binanceOrderId,
      network: network || 'primary',
      transactionId: binanceOrderId || sourceRef,
      fills: fills.length,
    };
  }

  async buyCryptoWithWallet(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const coin = cryptoCoin.toUpperCase();
    const cryptoWallet = await this.getOrCreateCryptoWallet(customerId, coin);
    const exchangeRate = await this.getCryptoPrice(coin);
    let cryptoAmount = fiatAmount / exchangeRate;
    let exchangeOrderId: string | null = null;
    let providerMode = 'live';

    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    if (Number(balRes.rows[0]?.balance ?? 0) < fiatAmount) throw new Error(`Insufficient ${ccy} wallet balance`);

    try {
      const xr = await import('../../exchange/exchange-router.service');
      const usdAmount = ccy === 'AED' ? fiatAmount / 3.67 : fiatAmount;
      const order = await xr.buyAssetBestEffort(coin, usdAmount);
      if (order && order.ok) {
        cryptoAmount = parseFloat(String(order.executedQty ?? cryptoAmount));
        exchangeOrderId = String(order.order_id || '');
        providerMode = order.provider;
        console.log(`[Crypto] Customer buy: ${cryptoAmount} ${coin} via ${providerMode} orderId=${exchangeOrderId}`);
      }
    } catch (exErr: any) {
      const message = String(exErr?.message || 'Live crypto purchase failed').slice(0, 500);
      throw new Error(
        /WIDGET_REQUIRED|NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED|LIVE_PRICE_UNAVAILABLE/.test(message)
          ? `Transak checkout required: open the Transak BUY widget to purchase ${coin} with an external payment method.`
          : `Customer crypto purchase aborted: ${message}`
      );
    }
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'debit', ?, ?, 'crypto_purchase', ?, ?)`,
      [uuidv4(), wallet.id, fiatAmount, ccy, exchangeOrderId || uuidv4(), `Bought ${cryptoAmount.toFixed(8)} ${coin} @ ${exchangeRate} [${providerMode}]`]
    );

    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, 'wallet_balance', ?, 'completed')`,
      [uuidv4(), customerId, coin, fiatAmount, cryptoAmount, ccy, exchangeRate, network || providerMode]
    );

    return {
      success: true,
      cryptoAmount,
      cryptoCoin: coin,
      exchangeRate,
      fiatAmount,
      fiat_currency: ccy,
      providerMode,
      binanceOrderId: exchangeOrderId,
      exchangeOrderId,
      network: network || 'primary'
    };
  }

  async buyCryptoDirectBinance(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const coin = cryptoCoin.toUpperCase();
    if (!fiatAmount || fiatAmount <= 0 || !Number.isFinite(fiatAmount)) throw new Error('fiatAmount must be positive');

    const cryptoWallet = await this.getOrCreateCryptoWallet(customerId, coin);
    const wallet = await this.getOrCreateWallet(customerId, ccy);

    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const currentBal = Number(balRes.rows[0]?.balance ?? 0);
    if (currentBal < fiatAmount) throw new Error(`Insufficient ${ccy} wallet balance. Have ${currentBal.toFixed(2)}, need ${fiatAmount.toFixed(2)}`);

    const exchangeRate = coin === 'USDT' ? 1.0 : (await this.getCryptoPrice(coin));
    const usdEquivalent = ccy === 'USD' ? fiatAmount : (ccy === 'AED' ? fiatAmount / 3.67 : fiatAmount);

    let cryptoAmount = usdEquivalent / Math.max(exchangeRate, 1e-9);
    let binanceOrderId: string | null = null;
    let rawOrder: any = null;
    let fills: any[] = [];

    try {
      const bs = await import('../../exchange/binance.service');
      const order = await bs.buyAssetWithUsd(coin, usdEquivalent);
      if (order && order.ok) {
        cryptoAmount = parseFloat(String(order.executedQty ?? cryptoAmount));
        binanceOrderId = String(order.order_id || '');
        fills = order.fills || [];
        rawOrder = order.raw;
        console.log(`[BinanceDirect] Customer ${customerId}: BOUGHT ${cryptoAmount} ${coin} for $${usdEquivalent} USD. orderId=${binanceOrderId}`);
      }
    } catch (binanceErr: any) {
      const message = String(binanceErr?.message || 'Binance purchase failed').slice(0, 500);
      console.error(`[BinanceDirect] FAIL for customer=${customerId} coin=${coin} amount=${usdEquivalent}: ${message}`);
      throw new Error(`Binance Direct buy rejected: ${message}`);
    }

    const description = `Binance Direct: Bought ${cryptoAmount.toFixed(8)} ${coin} @ $${exchangeRate} [orderId=${binanceOrderId}]`;
    const refId = binanceOrderId || uuidv4();

    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'debit', ?, ?, 'binance_direct', ?, ?)`,
      [uuidv4(), wallet.id, fiatAmount, ccy, refId, description]
    );
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [fiatAmount, wallet.id]);

    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, binance_order_id, fills_json)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, 'binance_direct', 'binance_live', 'completed', ?, ?)`,
      [uuidv4(), customerId, coin, fiatAmount, cryptoAmount, ccy, exchangeRate, binanceOrderId || null, JSON.stringify(fills || [])]
    );

    return {
      success: true,
      provider: 'binance',
      cryptoAmount,
      cryptoCoin: coin,
      exchangeRate,
      fiatAmount,
      fiat_currency: ccy,
      usdEquivalent,
      binanceOrderId,
      orderId: binanceOrderId,
      fills,
      raw: rawOrder,
      network: network || 'primary'
    };
  }

  async sellCrypto(customerId: string, cryptoCoin: string, cryptoAmount: number, network?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const cryptoWallet = await this.getOrCreateCryptoWallet(customerId, cryptoCoin);
    if (Number(cryptoWallet.balance) < cryptoAmount) throw new Error('Insufficient crypto balance');

    const exchangeRate = await this.getCryptoPrice(cryptoCoin);
    const fiatAmount = cryptoAmount * exchangeRate;
    const wallet = await this.getOrCreateWallet(customerId, ccy);

    await db.query('UPDATE customer_crypto_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query('UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [fiatAmount, wallet.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, description) VALUES (?, ?, 'credit', ?, ?, 'crypto_sale', ?)`,
      [uuidv4(), wallet.id, fiatAmount, ccy, `Sold ${cryptoAmount} ${cryptoCoin} @ $${exchangeRate}`]
    );
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'sell', ?, ?, ?, ?, 'crypto_wallet', ?, 'completed')`,
      [uuidv4(), customerId, cryptoCoin, fiatAmount, cryptoAmount, ccy, exchangeRate, network || 'primary']
    );

    return { success: true, fiatAmount, exchangeRate, cryptoAmount, network: network || 'primary', fiat_currency: ccy };
  }

  async swapCrypto(
    customerId: string,
    fromCoin: string,
    toCoin: string,
    amount: number,
    opts: {
      amountIsFrom?: boolean;
      mode?: 'internal' | 'binance_live' | 'live_exchange';
      network?: string;
      slippageBps?: number;
    } = {}
  ) {
    const from = fromCoin.toUpperCase();
    const to = toCoin.toUpperCase();
    if (from === to) throw new Error('Cannot swap same coin');
    if (!amount || amount <= 0) throw new Error('Amount must be positive');

    const amountIsFrom = opts.amountIsFrom !== false;
    const mode = opts.mode || 'internal';
    const slippageBps = opts.slippageBps ?? 100;

    const fromWallet = await this.getOrCreateCryptoWallet(customerId, from);
    const toWallet = await this.getOrCreateCryptoWallet(customerId, to);

    const fromPriceUsd = await this.getCryptoPrice(from);
    const toPriceUsd = await this.getCryptoPrice(to);
    if (!toPriceUsd || toPriceUsd <= 0) throw new Error(`Cannot price ${to}`);
    if (!fromPriceUsd || fromPriceUsd <= 0) throw new Error(`Cannot price ${from}`);

    const crossRate = fromPriceUsd / toPriceUsd;

    let fromAmount: number;
    let expectedToAmount: number;

    if (amountIsFrom) {
      fromAmount = amount;
      expectedToAmount = fromAmount * crossRate;
    } else {
      expectedToAmount = amount;
      fromAmount = expectedToAmount / crossRate;
    }

    if (Number(fromWallet.balance) < fromAmount) {
      throw new Error(`Insufficient ${from} balance: have ${Number(fromWallet.balance).toFixed(8)}, need ${fromAmount.toFixed(8)}`);
    }

    let providerMode = 'internal';
    let sellOrderId: string | null = null;
    let buyOrderId: string | null = null;
    let receivedToAmount = expectedToAmount;
    let soldFromAmount = fromAmount;
    let usdtIntermediate = fromAmount * fromPriceUsd;

    if (mode === 'binance_live' || mode === 'live_exchange') {
      try {
        const xr = await import('../../exchange/exchange-router.service');
        if (from !== 'USDT') {
          const sellResp = await xr.sellAssetBestEffort(from, fromAmount);
          if (sellResp && sellResp.ok) {
            soldFromAmount = sellResp.executedQty || soldFromAmount;
            usdtIntermediate = sellResp.usdt_received || usdtIntermediate;
            sellOrderId = sellResp.order_id || null;
            providerMode = sellResp.provider;
          }
        }
        if (to !== 'USDT') {
          const buyResp = await xr.buyAssetBestEffort(to, usdtIntermediate);
          if (buyResp && buyResp.ok) {
            receivedToAmount = buyResp.executedQty || receivedToAmount;
            buyOrderId = buyResp.order_id || null;
            providerMode = buyResp.provider;
          }
        } else {
          receivedToAmount = usdtIntermediate;
        }
      } catch (exErr: any) {
        throw new Error(`Live exchange swap failed (balances unchanged): ${exErr?.message || exErr}`);
      }

      const minExpectedTo = expectedToAmount * (1 - slippageBps / 10000);
      if (receivedToAmount < minExpectedTo) {
        throw new Error(
          `Swap slippage exceeded ${slippageBps} bps: expected ${expectedToAmount.toFixed(8)} ${to}, received ${receivedToAmount.toFixed(8)} ${to}. Refund manually from the exchange if orders executed.`
        );
      }
    }

    await db.query('UPDATE customer_crypto_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [soldFromAmount, fromWallet.id]);
    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [receivedToAmount, toWallet.id]);

    const swapId = uuidv4();
    const swapRef = `SWAP-${swapId.slice(0, 8).toUpperCase()}`;

    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference, tx_hash)
       VALUES (?, ?, ?, 'sell', ?, ?, 'USD', ?, ?, ?, 'completed', ?, ?)`,
      [
        uuidv4(),
        customerId,
        from,
        soldFromAmount * fromPriceUsd,
        soldFromAmount,
        fromPriceUsd,
        `swap:${from}->${to}`,
        providerMode,
        swapRef,
        sellOrderId || null,
      ]
    );

    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference, tx_hash)
       VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, ?, ?, 'completed', ?, ?)`,
      [
        uuidv4(),
        customerId,
        to,
        receivedToAmount * toPriceUsd,
        receivedToAmount,
        toPriceUsd,
        `swap:${from}->${to}`,
        providerMode,
        swapRef,
        buyOrderId || null,
      ]
    );

    return {
      success: true,
      swapId,
      swapRef,
      fromCoin: from,
      toCoin: to,
      fromAmount: soldFromAmount,
      toAmount: receivedToAmount,
      fromPriceUsd,
      toPriceUsd,
      crossRate,
      usdtValue: usdtIntermediate,
      providerMode,
      mode,
      sellOrderId,
      buyOrderId,
      network: opts.network || providerMode,
    };
  }

  async swapCryptoWithMerchant(
    merchantId: string,
    fromCoin: string,
    toCoin: string,
    amount: number,
    opts: {
      amountIsFrom?: boolean;
      mode?: 'internal' | 'binance_live' | 'live_exchange';
      network?: string;
      slippageBps?: number;
    } = {}
  ) {
    const from = fromCoin.toUpperCase();
    const to = toCoin.toUpperCase();
    if (from === to) throw new Error('Cannot swap same coin');
    if (!amount || amount <= 0) throw new Error('Amount must be positive');

    const amountIsFrom = opts.amountIsFrom !== false;
    const mode = opts.mode || 'internal';
    const slippageBps = opts.slippageBps ?? 100;

    const fromBalRes = await db.query(
      'SELECT * FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?',
      [merchantId, from]
    );
    const fromWallet = fromBalRes.rows[0];
    if (!fromWallet || Number(fromWallet.amount) <= 0) throw new Error(`No ${from} balance for merchant`);

    const toBalRes = await db.query(
      'SELECT * FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?',
      [merchantId, to]
    );

    const fromPriceUsd = await this.getCryptoPrice(from);
    const toPriceUsd = await this.getCryptoPrice(to);
    if (!toPriceUsd || toPriceUsd <= 0) throw new Error(`Cannot price ${to}`);
    if (!fromPriceUsd || fromPriceUsd <= 0) throw new Error(`Cannot price ${from}`);

    const crossRate = fromPriceUsd / toPriceUsd;

    let fromAmount: number;
    let expectedToAmount: number;

    if (amountIsFrom) {
      fromAmount = amount;
      expectedToAmount = fromAmount * crossRate;
    } else {
      expectedToAmount = amount;
      fromAmount = expectedToAmount / crossRate;
    }

    if (Number(fromWallet.amount) < fromAmount) {
      throw new Error(`Insufficient ${from} balance: have ${Number(fromWallet.amount).toFixed(8)}, need ${fromAmount.toFixed(8)}`);
    }

    let providerMode = 'internal';
    let sellOrderId: string | null = null;
    let buyOrderId: string | null = null;
    let receivedToAmount = expectedToAmount;
    let soldFromAmount = fromAmount;
    let usdtIntermediate = fromAmount * fromPriceUsd;

    if (mode === 'binance_live' || mode === 'live_exchange') {
      try {
        const xr = await import('../../exchange/exchange-router.service');
        if (from !== 'USDT') {
          const sellResp = await xr.sellAssetBestEffort(from, fromAmount);
          if (sellResp && sellResp.ok) {
            soldFromAmount = sellResp.executedQty || soldFromAmount;
            usdtIntermediate = sellResp.usdt_received || usdtIntermediate;
            sellOrderId = sellResp.order_id || null;
            providerMode = sellResp.provider;
          }
        }
        if (to !== 'USDT') {
          const buyResp = await xr.buyAssetBestEffort(to, usdtIntermediate);
          if (buyResp && buyResp.ok) {
            receivedToAmount = buyResp.executedQty || receivedToAmount;
            buyOrderId = buyResp.order_id || null;
            providerMode = buyResp.provider;
          }
        } else {
          receivedToAmount = usdtIntermediate;
        }
      } catch (exErr: any) {
        throw new Error(`Live exchange swap failed (balances unchanged): ${exErr?.message || exErr}`);
      }

      const minExpectedTo = expectedToAmount * (1 - slippageBps / 10000);
      if (receivedToAmount < minExpectedTo) {
        throw new Error(
          `Swap slippage exceeded ${slippageBps} bps: expected ${expectedToAmount.toFixed(8)} ${to}, received ${receivedToAmount.toFixed(8)} ${to}. Refund manually from the exchange if orders executed.`
        );
      }
    }

    await db.query('UPDATE merchant_crypto_balances SET amount = amount - ?, updated_at = CURRENT_TIMESTAMP WHERE merchant_id = ? AND asset = ?', [soldFromAmount, merchantId, from]);

    if (toBalRes.rows.length > 0) {
      await db.query('UPDATE merchant_crypto_balances SET amount = amount + ?, updated_at = CURRENT_TIMESTAMP WHERE merchant_id = ? AND asset = ?', [receivedToAmount, merchantId, to]);
    } else {
      await db.query('INSERT INTO merchant_crypto_balances (id, merchant_id, asset, amount, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', [uuidv4(), merchantId, to, receivedToAmount]);
    }

    const swapId = uuidv4();
    const swapRef = `MSWAP-${swapId.slice(0, 8).toUpperCase()}`;

    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference, tx_hash)
       VALUES (?, ?, ?, 'sell', ?, ?, 'USD', ?, ?, ?, 'completed', ?, ?)`,
      [
        uuidv4(),
        merchantId,
        from,
        soldFromAmount * fromPriceUsd,
        soldFromAmount,
        fromPriceUsd,
        `merchant_swap:${from}->${to}`,
        providerMode,
        swapRef,
        sellOrderId || null,
      ]
    );

    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference, tx_hash)
       VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, ?, ?, 'completed', ?, ?)`,
      [
        uuidv4(),
        merchantId,
        to,
        receivedToAmount * toPriceUsd,
        receivedToAmount,
        toPriceUsd,
        `merchant_swap:${from}->${to}`,
        providerMode,
        swapRef,
        buyOrderId || null,
      ]
    );

    return {
      success: true,
      swapId,
      swapRef,
      merchantId,
      fromCoin: from,
      toCoin: to,
      fromAmount: soldFromAmount,
      toAmount: receivedToAmount,
      fromPriceUsd,
      toPriceUsd,
      crossRate,
      usdtValue: usdtIntermediate,
      providerMode,
      mode,
      sellOrderId,
      buyOrderId,
      network: opts.network || providerMode,
    };
  }

  async getCryptoTransactions(customerId: string) {
    return (await db.query('SELECT * FROM crypto_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100', [customerId])).rows;
  }

  async debitMerchantWallet(merchantId: string, amount: number, source: string, reference?: string, currency: string = 'USD') {
    if (!merchantId) throw new Error('merchantId required for debitMerchantWallet');
    const amountNum = Number(amount);
    if (!isFinite(amountNum) || amountNum <= 0) throw new Error(`Invalid amount ${amount}`);
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateMerchantWallet(merchantId, ccy);
    const balRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [wallet.id]);
    const currentBalance = Number(balRes.rows[0]?.balance ?? 0);
    if (currentBalance < amountNum) {
      throw new Error(`Insufficient ${ccy} merchant wallet balance. Have ${currentBalance.toFixed(2)}, need ${amountNum.toFixed(2)}.`);
    }
    const transactionId = uuidv4();
    const now = new Date().toISOString();

    await db.query(
      `UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?`,
      [amountNum, now, wallet.id]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, created_at)
       VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)`,
      [transactionId, wallet.id, amountNum, ccy, source || 'merchant_debit', reference || null, now]
    );
    let ledgerEntryId: string | null = null;
    try {
      const ledgerEntry = createLedgerEntry(transactionId, 'debit', amountNum, ccy, 'AUTHORIZED', `Merchant wallet debit: ${reference || source || 'merchant_debit'}`);
      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));
      ledgerEntryId = ledgerEntry.id;
    } catch (err) {
      console.error('Failed to persist ledger entry for merchant debit', err);
    }
    const finalBalance = currentBalance - amountNum;
    return { success: true, transactionId, status: 'COMPLETED', ledgerEntryId, currency: ccy, balanceAfter: finalBalance };
  }
}

export const walletsService = new WalletsService();
