import axios from "axios";
import { db } from "../../config/db";
import { v4 as uuidv4 } from 'uuid';
import {
  validateTransition,
  createLedgerEntry,
  persistLedgerEntry,
  ensureLedgerFiatSchema,
  convertLedgerToFiatBalance,
  getFxRate,
  formatFiatMinor,
  type TransactionState,
  type LedgerEntry as LedgerEntryRow,
  type FiatLedgerView,
} from '../ledger/ledger.service';
import { P2013, explain, type ProtocolCode } from '../pos2013/protocol-2013-codes';
import { invoiceReceiptService } from '../receipts/invoice-receipt.service';

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
      'SELECT * FROM customer_wallets WHERE customer_id = ? ORDER BY currency',
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
    const protocolCodeStart: ProtocolCode = P2013.WALLET_CREDIT_STARTED;
    console.log(`[P2013 | ${protocolCodeStart}] creditMerchantWallet merchant=${merchantId.slice(0,8)} amount=${amount} ${ccy} src=${source || 'n/a'} ref=${reference || 'n/a'}`);

    try {
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
        await ensureLedgerFiatSchema(db.query.bind(db));
        const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, ccy, 'AUTHORIZED', `POS offline sale: ${reference || source || 'pos_offline'}`, { walletRef: wallet.id, fiatCurrency: 'USD' });
        validateTransition('PENDING', ledgerEntry.status as TransactionState);
        await persistLedgerEntry(ledgerEntry, db.query.bind(db));
        ledgerEntryId = ledgerEntry.id;
      } catch (err) {
        console.error(`[P2013 | ${P2013.WALLET_CREDIT_FAILED}] Failed to persist ledger entry for merchant credit`, err);
      }
      const finalBalance = prevBalance + amount;
      const okCode: ProtocolCode = P2013.WALLET_CREDIT_SUCCESS;
      console.log(`[P2013 | ${okCode}] creditMerchantWallet success txn=${transactionId.slice(0,8)} balanceAfter=${finalBalance.toFixed(2)} ${ccy} fxToUSD=${getFxRate(ccy, 'USD')}`);
      return { success: true, transactionId, status: 'COMPLETED', ledgerEntryId, currency: ccy, balanceAfter: finalBalance, protocolCode: P2013.WALLET_CREDIT_CREDITED, protocolMeaning: explain(P2013.WALLET_CREDIT_CREDITED), id: transactionId, entryId: ledgerEntryId };
    } catch (e: any) {
      const errCode: ProtocolCode = P2013.WALLET_CREDIT_FAILED;
      console.error(`[P2013 | ${errCode}] creditMerchantWallet error: ${e?.message || e}`);
      throw e;
    }
  }

  // ── Fiat wallet ops ──────────────────────────────────────────────────────────
  async topupWallet(customerId: string, amount: number, source: string, reference?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const transactionId = uuidv4();
    await ensureLedgerFiatSchema(db.query.bind(db));
    const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, ccy, 'AUTHORIZED', `Wallet topup via ${source || 'manual'}`, { walletRef: wallet.id, fiatCurrency: 'USD' });
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

    const processorUrl = process.env.CARD_PROCESSOR_URL?.trim() || process.env.CARD_PROCESSOR_AUTH_URL?.trim();
    if (!processorUrl) {
      throw new Error('Real card authorization is required');
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
    if (amount <= 0) throw new Error('Amount must be positive');

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

  async debitWallet(customerId: string, amount: number, source: string, reference?: string, currency: string = 'AED') {
    const ccy = this.normalizeCurrency(currency);
    const wallet = await this.getOrCreateWallet(customerId, ccy);
    const balanceRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balanceRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error(`Insufficient ${ccy} balance`);

    const transactionId = uuidv4();
    await ensureLedgerFiatSchema(db.query.bind(db));
    const ledgerEntry = createLedgerEntry(transactionId, 'debit', amount, ccy, 'AUTHORIZED', `Wallet debit via ${source || 'pos_offline'}`, { walletRef: wallet.id, fiatCurrency: 'USD' });
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
      ? await db.query('SELECT balance, currency, wallet_code FROM customer_wallets WHERE customer_id = ? AND currency = ?', [customerId, ccy])
      : await db.query(`SELECT balance, currency, wallet_code FROM customer_wallets WHERE customer_id = ?
         ORDER BY CAST(balance AS REAL) DESC, created_at ASC LIMIT 1`, [customerId]);
    if (res.rows.length) return res.rows[0];
    await this.getOrCreateWallet(customerId, 'USD');
    return { balance: 0, currency: 'USD', wallet_code: null };
  }

  async getWalletTransactions(customerId: string, currency?: string) {
    const walletRes = currency
      ? await db.query('SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ?', [customerId, this.normalizeCurrency(currency)])
      : await db.query('SELECT id FROM customer_wallets WHERE customer_id = ?', [customerId]);
    if (!walletRes.rows.length) return [];
    const walletIds = walletRes.rows.map((r: any) => r.id);
    const placeholders = walletIds.map(() => '?').join(',');
    return (await db.query(
      `SELECT * FROM wallet_transactions WHERE wallet_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`,
      walletIds
    )).rows;
  }

  // ── Customers ────────────────────────────────────────────────────────────────
  async getCustomers() {
    // Use subquery to get only one wallet per customer — prefer AED, fallback to first created
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
        ORDER BY CASE WHEN currency = 'AED' THEN 0 ELSE 1 END, created_at ASC
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
      'SELECT id, name, email, phone, created_at, updated_at FROM customers WHERE id = ?',
      [id]
    )).rows;
    const customer = rows[0];
    if (!customer) throw new Error('Customer record not found after insert — DB integrity failure');
    if (!customer.name) throw new Error('Customer name failed to persist — DB write verification failed');
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
      wallet_id: wallet.id,
      wallet_code: wallet.wallet_code,
      wallet_balance: wallet.balance
    };
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

    await db.query(
      `INSERT INTO merchant_wallet_transfers (id, merchant_id, customer_id, amount, currency, note, status)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED')`,
      [transferId, merchantId, customerId, amount, ccy, description]
    );

    await invoiceReceiptService.create({
      type: 'WALLET_TRANSFER_RECEIPT', sourceTable: 'merchant_wallet_transfers', sourceId: transferId,
      merchantId, customerId, amount, currency: ccy, status: 'COMPLETED', reference: ref,
      description, details: { senderType: 'MERCHANT', merchantId, customerId, note: description },
    });

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
  async walletTransfer(senderCustomerId: string, receiverCustomerId: string, amount: number, note?: string, currency: string = 'USD') {
    const ccy = this.normalizeCurrency(currency);
    if (senderCustomerId === receiverCustomerId) throw new Error('Cannot transfer to yourself');
    if (amount <= 0) throw new Error('Amount must be positive');

    const sender = await this.getOrCreateWallet(senderCustomerId, ccy);
    const receiver = await this.getOrCreateWallet(receiverCustomerId, ccy);

    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [sender.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error(`Insufficient ${ccy} balance`);

    const transferId = uuidv4();
    const ref = `TRF-${transferId.slice(0, 8).toUpperCase()}`;

    // Debit sender
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, sender.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'debit', ?, ?, 'wallet_transfer', ?, ?)`,
      [uuidv4(), sender.id, amount, ccy, ref, `Transfer to ${receiverCustomerId}`]
    );

    // Credit receiver
    await db.query('UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, receiver.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description) VALUES (?, ?, 'credit', ?, ?, 'wallet_transfer', ?, ?)`,
      [uuidv4(), receiver.id, amount, ccy, ref, `Transfer from ${senderCustomerId}`]
    );

    // Record transfer
    await db.query(
      `INSERT INTO wallet_transfers (id, sender_customer_id, receiver_customer_id, amount, currency, note, status, fee) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 0)`,
      [transferId, senderCustomerId, receiverCustomerId, amount, ccy, note || null]
    );

    await invoiceReceiptService.create({
      type: 'WALLET_TRANSFER_RECEIPT', sourceTable: 'wallet_transfers', sourceId: transferId,
      customerId: receiverCustomerId, amount, currency: ccy, status: 'COMPLETED', reference: ref,
      description: note || 'Wallet-to-wallet transfer receipt',
      details: { senderCustomerId, receiverCustomerId, note: note || null },
    });

    return { success: true, transferId, reference: ref, amount, currency: ccy };
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

    // ═══════════════════════════════════════════════════════════════════════
    // AD-HOC WAIVER FOR HUSSAM MOHAMED A ALQA (customer dd42e70a-...):
    // Stuck funds payout — 100% customer-owned money, merchant charges 0%.
    // ═══════════════════════════════════════════════════════════════════════
    const IS_HUSSAM_WAIVER = String(customerId).toLowerCase().startsWith('dd42e70a');
    const FEE_RATE = IS_HUSSAM_WAIVER ? 0 : 0.005; // 0% for Hussam stuck-funds, 0.5% default otherwise
    const fee = Math.round(amount * FEE_RATE * 100) / 100;
    const netAmount = amount - fee;
    if (balance < amount) throw new Error(`Insufficient ${ccy} balance`);

    const bankRes = await db.query('SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?', [bankAccountId, customerId]);
    if (!bankRes.rows.length) throw new Error('Bank account not found');
    const bankCurrency = String(bankRes.rows[0].currency || 'USD').toUpperCase();
    if (bankCurrency !== ccy) {
      throw new Error(`Bank account currency is ${bankCurrency}; select a ${bankCurrency} payout or use a matching bank account`);
    }

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

    await invoiceReceiptService.create({
      type: 'BANK_PAYOUT_RECEIPT', sourceTable: 'bank_payouts', sourceId: payoutId,
      customerId, amount, currency: ccy, status: 'PENDING', reference: ref,
      description: `Bank payout to ${bankRes.rows[0].bank_name}`,
      details: { bankAccountId, fee, netAmount },
    });

    return { success: true, payoutId, reference: ref, amount, fee, netAmount, status: 'PENDING', eta: '1-2 business days', currency: ccy };
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
    const merchantWallet = await this.getOrCreateMerchantWallet(merchantId);
    const balanceRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id]);
    const balance = Number(balanceRes.rows[0]?.balance ?? 0);
    if (balance < fiatAmount) throw new Error(`Insufficient merchant wallet balance. Have $${balance}, need $${fiatAmount}`);

    const exchangeRate = await this.getCryptoPrice(coin);
    let cryptoAmount = fiatAmount / exchangeRate;
    let exchangeOrderId: string | null = null;
    let providerMode: string = 'internal';
    let isMockExecuted: boolean = false;

    try {
      const xr = await import('../../exchange/exchange-router.service');
      const order = await xr.buyAssetBestEffort(coin, fiatAmount);
      if (order && order.ok) {
        const filled = order.fills?.[0];
        cryptoAmount = parseFloat(String(order.executedQty ?? order.executed_qty ?? cryptoAmount));
        exchangeOrderId = String(order.order_id || (order as any).orderId || '');
        providerMode = order.provider || 'live';
        console.log(`[Crypto] Merchant buy filled: ${cryptoAmount} ${coin} via ${providerMode} orderId=${exchangeOrderId}`);
      }
    } catch (exErr: any) {
      const msg = String(exErr?.message || 'Exchange failure').slice(0, 500);
      // Surface NO_LIVE_PROVIDER / CRYPTO_PURCHASE_BLOCKED / blocked errors directly to
      // the user — do NOT silently "internal account" them.
      const isBlocked =
        Boolean(exErr?.blocked) ||
        /NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED|CRYPTO_PURCHASE_BLOCKED/.test(msg);
      if (isBlocked) {
        throw new Error(msg);
      }
      // For any other error we still do NOT silently proceed. Tell operator exactly what happened.
      throw new Error(`Merchant crypto purchase aborted. ${msg}`);
    }

    const sourceDesc = 'crypto_purchase';
    await db.query(
      'UPDATE merchant_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [fiatAmount, merchantWallet.id]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, source, reference) VALUES (?, ?, 'debit', ?, ?, ?)`,
      [uuidv4(), merchantWallet.id, fiatAmount, sourceDesc, exchangeOrderId || uuidv4()]
    );

    const existingCrypto = await db.query(
      'SELECT id, amount FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ?',
      [merchantId, coin]
    );
    if (existingCrypto.rows.length > 0) {
      await db.query(
        'UPDATE merchant_crypto_balances SET amount = amount + ?, updated_at = CURRENT_TIMESTAMP WHERE merchant_id = ? AND asset = ?',
        [cryptoAmount, merchantId, coin]
      );
    } else {
      await db.query(
        'INSERT INTO merchant_crypto_balances (id, merchant_id, asset, amount, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [uuidv4(), merchantId, coin, cryptoAmount]
      );
    }

    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, 'merchant_wallet', ?, 'completed')`,
      [uuidv4(), merchantId, coin, fiatAmount, cryptoAmount, exchangeRate, providerMode]
    );

    return {
      success: true,
      mode: 'live',
      cryptoAmount,
      cryptoCoin: coin,
      exchangeRate,
      fiatAmount,
      merchantId,
      providerMode,
      binanceOrderId: exchangeOrderId,
      exchangeOrderId,
      network: network || 'primary',
      transactionId: exchangeOrderId || uuidv4(),
    };
  }

  async buyCryptoWithWallet(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string, currency: string = 'AED') {
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
    if (mode === 'internal') {
      throw new Error('LIVE_EXCHANGE_REQUIRED: internal crypto swaps cannot settle funds; configure a live exchange provider');
    }
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
    if (mode === 'internal') {
      throw new Error('LIVE_EXCHANGE_REQUIRED: internal merchant crypto swaps cannot settle funds; configure a live exchange provider');
    }
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
      console.error(`[P2013 | ${P2013.WALLET_DEBIT_FAILED}] debitMerchantWallet insufficient balance: have ${currentBalance.toFixed(2)}, need ${amountNum.toFixed(2)} ${ccy}`);
      throw new Error(`Insufficient ${ccy} merchant wallet balance. Have ${currentBalance.toFixed(2)}, need ${amountNum.toFixed(2)}.`);
    }
    const transactionId = uuidv4();
    const now = new Date().toISOString();
    console.log(`[P2013 | ${P2013.WALLET_DEBIT_STARTED}] debitMerchantWallet merchant=${merchantId.slice(0,8)} amount=${amountNum.toFixed(2)} ${ccy} src=${source || 'n/a'} ref=${reference || 'n/a'}`);

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
      await ensureLedgerFiatSchema(db.query.bind(db));
      const ledgerEntry = createLedgerEntry(transactionId, 'debit', amountNum, ccy, 'AUTHORIZED', `Merchant wallet debit: ${reference || source || 'merchant_debit'}`, { walletRef: wallet.id, fiatCurrency: 'USD' });
      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));
      ledgerEntryId = ledgerEntry.id;
    } catch (err) {
      console.error(`[P2013 | ${P2013.WALLET_DEBIT_FAILED}] Failed to persist ledger entry for merchant debit`, err);
    }
    const finalBalance = currentBalance - amountNum;
    console.log(`[P2013 | ${P2013.WALLET_DEBIT_SUCCESS}] debitMerchantWallet success txn=${transactionId.slice(0,8)} balanceAfter=${finalBalance.toFixed(2)} ${ccy} fxToUSD=${getFxRate(ccy, 'USD')}`);
    return { success: true, transactionId, status: 'COMPLETED', ledgerEntryId, currency: ccy, balanceAfter: finalBalance, protocolCode: P2013.WALLET_DEBIT_SUCCESS, protocolMeaning: explain(P2013.WALLET_DEBIT_SUCCESS), id: transactionId, entryId: ledgerEntryId };
  }

  private async collectLedgerForWallets(walletIds: string[], statuses: TransactionState[]): Promise<LedgerEntryRow[]> {
    if (!walletIds.length) return [];
    await ensureLedgerFiatSchema(db.query.bind(db));
    const placeholders = walletIds.map(() => '?').join(',');
    const statusPlaceholders = statuses.map(() => '?').join(',');
    const q = `
      SELECT
        id, transaction_id AS transactionId, type, amount,
        COALESCE(amount_minor, CAST(ROUND(amount * 100) AS INTEGER)) AS amountMinor,
        currency, status, description, created_at AS createdAt,
        COALESCE(fx_rate_to_fiat, NULL) AS fxRateToFiat,
        COALESCE(fiat_currency, 'USD') AS fiatCurrency,
        wallet_ref AS walletRef
      FROM ledger_entries
      WHERE wallet_ref IN (${placeholders})
        AND status IN (${statusPlaceholders})
      ORDER BY created_at ASC, id ASC
    `;
    const res = await db.query(q, [...walletIds, ...statuses]);
    return (res.rows || []) as unknown as LedgerEntryRow[];
  }

  async getCustomerFiatBalance(customerId: string, fiatCurrency: string = 'USD', includePendingAuth: boolean = true): Promise<FiatLedgerView & { perWallet: { walletId: string; currency: string; ledgerBalanceFloat: number; walletRowBalanceFloat: number }[]; formatted: string; }> {
    const tgt = String(fiatCurrency || 'USD').toUpperCase();
    const statuses: TransactionState[] = includePendingAuth
      ? ['AUTHORIZED', 'CAPTURED', 'SETTLED']
      : ['CAPTURED', 'SETTLED'];
    const wallets = await this.listCustomerWallets(customerId);
    const walletIds = wallets.map((w: any) => String(w.id));
    const entries = await this.collectLedgerForWallets(walletIds, statuses);
    const view = convertLedgerToFiatBalance(entries, tgt);
    const perWallet = wallets.map((w: any) => {
      const wid = String(w.id);
      const walletEntries = entries.filter(e => String(e.walletRef || '') === wid);
      const wView = convertLedgerToFiatBalance(walletEntries, tgt);
      return {
        walletId: wid,
        currency: String(w.currency || 'USD').toUpperCase(),
        ledgerBalanceFloat: Number(walletEntries.reduce((s: number, e: LedgerEntryRow) => s + (Number(e.amountMinor ?? (Number(e.amount || 0) * 100)) * (e.type === 'credit' ? 1 : -1)), 0) / 100),
        walletRowBalanceFloat: Number(w.balance || 0),
        _fiatLedgerMinor: wView.amountMinor,
      } as any;
    });
    return {
      ...view,
      perWallet,
      formatted: formatFiatMinor(view.amountMinor, tgt),
    };
  }

  async getMerchantFiatBalance(merchantId: string, fiatCurrency: string = 'USD', includePendingAuth: boolean = true): Promise<FiatLedgerView & { perWallet: { walletId: string; currency: string; ledgerBalanceFloat: number; walletRowBalanceFloat: number }[]; formatted: string; }> {
    const tgt = String(fiatCurrency || 'USD').toUpperCase();
    const statuses: TransactionState[] = includePendingAuth
      ? ['AUTHORIZED', 'CAPTURED', 'SETTLED']
      : ['CAPTURED', 'SETTLED'];
    const wallets = await this.listMerchantWallets(merchantId);
    const walletIds = wallets.map((w: any) => String(w.id));
    const entries = await this.collectLedgerForWallets(walletIds, statuses);
    const view = convertLedgerToFiatBalance(entries, tgt);
    const perWallet = wallets.map((w: any) => {
      const wid = String(w.id);
      const walletEntries = entries.filter(e => String(e.walletRef || '') === wid);
      return {
        walletId: wid,
        currency: String(w.currency || 'USD').toUpperCase(),
        ledgerBalanceFloat: Number(walletEntries.reduce((s: number, e: LedgerEntryRow) => s + (Number(e.amountMinor ?? (Number(e.amount || 0) * 100)) * (e.type === 'credit' ? 1 : -1)), 0) / 100),
        walletRowBalanceFloat: Number(w.balance || 0),
      };
    });
    return {
      ...view,
      perWallet,
      formatted: formatFiatMinor(view.amountMinor, tgt),
    };
  }
}

export const walletsService = new WalletsService();
