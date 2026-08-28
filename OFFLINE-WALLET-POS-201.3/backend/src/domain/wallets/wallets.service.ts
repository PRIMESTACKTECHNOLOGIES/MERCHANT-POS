import { db } from "../../config/db";
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { createOnlineCharge } from '../primestack/primestack.service';
import { validateTransition, createLedgerEntry, persistLedgerEntry, type TransactionState } from '../ledger/ledger.service';

interface VirtualCardDetails {
  cardNumber?: string;
  maskedNumber?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvv?: string;
  cardholderName?: string;
  cardType?: string;
  currency?: string;
  dailyLimit?: number;
}

export class WalletsService {

  // ── Wallet helpers ───────────────────────────────────────────────────────────
  async getOrCreateWallet(customerId: string) {
    const res = await db.query('SELECT * FROM customer_wallets WHERE customer_id = ?', [customerId]);
    if (res.rows.length) return res.rows[0];
    const id = uuidv4();
    // Generate wallet code like PSW-4829-1037
    const walletCode = `PSW-${Math.floor(Math.random() * 9000) + 1000}-${Math.floor(Math.random() * 9000) + 1000}`;
    await db.query(
      `INSERT INTO customer_wallets (id, customer_id, balance, currency, wallet_code) VALUES (?, ?, 0, 'USD', ?)`,
      [id, customerId, walletCode]
    );
    return (await db.query('SELECT * FROM customer_wallets WHERE id = ?', [id])).rows[0];
  }

  async getOrCreateMerchantWallet(merchantId: string) {
    const res = await db.query('SELECT * FROM merchant_wallets WHERE merchant_id = ?', [merchantId]);
    if (res.rows.length) return res.rows[0];
    const id = uuidv4();
    await db.query(
      `INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, 'USD')`,
      [id, merchantId]
    );
    return (await db.query('SELECT * FROM merchant_wallets WHERE id = ?', [id])).rows[0];
  }

  async creditMerchantWallet(merchantId: string, amount: number, source: string, reference?: string) {
    const wallet = await this.getOrCreateMerchantWallet(merchantId);
    const transactionId = uuidv4();
    const now = new Date().toISOString();

    await db.query(
      `UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      [amount, now, wallet.id]
    );
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, source, reference, created_at)
       VALUES (?, ?, 'credit', ?, ?, ?, ?)`,
      [transactionId, wallet.id, amount, source, reference || null, now]
    );
    // Create ledger entry for merchant credit
    let ledgerEntryId: string | null = null;
    try {
      const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, 'USD', 'AUTHORIZED', `POS offline sale: ${reference || source || 'pos_offline'}`);
      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));
      ledgerEntryId = ledgerEntry.id;
    } catch (err) {
      // non-fatal: log and continue
      console.error('Failed to persist ledger entry for merchant credit', err);
    }
    return { success: true, transactionId, status: 'COMPLETED', ledgerEntryId };
  }

  // ── Fiat wallet ops ──────────────────────────────────────────────────────────
  async topupWallet(customerId: string, amount: number, source: string, reference?: string) {
    const wallet = await this.getOrCreateWallet(customerId);
    const transactionId = uuidv4();
    const ledgerEntry = createLedgerEntry(transactionId, 'credit', amount, 'USD', 'AUTHORIZED', `Wallet topup via ${source || 'manual'}`);
    validateTransition('PENDING', ledgerEntry.status as TransactionState);

    await db.query(
      `UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference) VALUES (?, ?, 'credit', ?, ?, ?)`,
      [transactionId, wallet.id, amount, source || 'manual', reference || null]
    );
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));
    return { success: true, transactionId, status: ledgerEntry.status };
  }

  async topupWalletWithCard(customerId: string, amount: number, cardNumber: string, panMasked?: string, expiry?: string, cvv?: string, emvData?: string) {
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

    const charge = await createOnlineCharge({
      amount,
      currency: 'USD',
      pan: sanitizedPan,
      expiry,
      cvv,
      merchantId: customerId,
      terminalId: process.env.TERMINAL_ID || 'wallet-topup',
    });

    if (!charge?.success) {
      throw new Error(charge?.error || 'Card authorization failed');
    }

    const wallet = await this.getOrCreateWallet(customerId);
    await db.query(
      `UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );

    const txnId = uuidv4();
    const maskedPan = panMasked || (cardNumber ? cardNumber.slice(-4) : 'N/A');
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, pan_masked, emv_data, reference) VALUES (?, ?, 'credit', ?, 'card_topup', ?, ?, ?)`,
      [txnId, wallet.id, amount, maskedPan, emvData || null, charge.authCode || 'AUTH']
    );

    return {
      success: true,
      transactionId: txnId,
      authCode: charge.authCode || 'AUTH',
      processorId: charge.paymentIntentId,
      processor: charge.processor,
      walletId: wallet.id,
      expiry,
      cvv,
    };
  }

  async debitWallet(customerId: string, amount: number, source: string, reference?: string) {
    const wallet = await this.getOrCreateWallet(customerId);
    const balanceRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balanceRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error('Insufficient balance');

    const transactionId = uuidv4();
    const ledgerEntry = createLedgerEntry(transactionId, 'debit', amount, 'USD', 'AUTHORIZED', `Wallet debit via ${source || 'pos_offline'}`);
    validateTransition('PENDING', ledgerEntry.status as TransactionState);

    await db.query(
      `UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, wallet.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference) VALUES (?, ?, 'debit', ?, ?, ?)`,
      [transactionId, wallet.id, amount, source || 'pos_offline', reference || null]
    );
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));
    return { success: true, transactionId, status: ledgerEntry.status };
  }

  async getWalletBalance(customerId: string) {
    const res = await db.query('SELECT balance, currency FROM customer_wallets WHERE customer_id = ?', [customerId]);
    return res.rows.length ? res.rows[0] : { balance: 0, currency: 'USD' };
  }

  async getWalletTransactions(customerId: string) {
    const walletRes = await db.query('SELECT id FROM customer_wallets WHERE customer_id = ?', [customerId]);
    if (!walletRes.rows.length) return [];
    return (await db.query(
      'SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 100',
      [walletRes.rows[0].id]
    )).rows;
  }

  // ── Customers ────────────────────────────────────────────────────────────────
  async getCustomers() {
    return (await db.query('SELECT * FROM customers ORDER BY created_at DESC')).rows;
  }

  async createCustomer(name: string, email?: string, phone?: string) {
    const id = uuidv4();
    await db.query(
      'INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)',
      [id, name, email || null, phone || null]
    );
    await this.getOrCreateWallet(id);
    return (await db.query('SELECT * FROM customers WHERE id = ?', [id])).rows[0];
  }

  // ── Wallet-to-Wallet Transfer ─────────────────────────────────────────────
  async walletTransfer(senderCustomerId: string, receiverCustomerId: string, amount: number, note?: string) {
    if (senderCustomerId === receiverCustomerId) throw new Error('Cannot transfer to yourself');
    if (amount <= 0) throw new Error('Amount must be positive');

    const sender = await this.getOrCreateWallet(senderCustomerId);
    const receiver = await this.getOrCreateWallet(receiverCustomerId);

    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [sender.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    if (balance < amount) throw new Error('Insufficient balance');

    const transferId = uuidv4();
    const ref = `TRF-${transferId.slice(0, 8).toUpperCase()}`;

    // Debit sender
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, sender.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description) VALUES (?, ?, 'debit', ?, 'wallet_transfer', ?, ?)`,
      [uuidv4(), sender.id, amount, ref, `Transfer to ${receiverCustomerId}`]
    );

    // Credit receiver
    await db.query('UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, receiver.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description) VALUES (?, ?, 'credit', ?, 'wallet_transfer', ?, ?)`,
      [uuidv4(), receiver.id, amount, ref, `Transfer from ${senderCustomerId}`]
    );

    // Record transfer
    await db.query(
      `INSERT INTO wallet_transfers (id, sender_customer_id, receiver_customer_id, amount, currency, note, status, fee) VALUES (?, ?, ?, ?, 'USD', ?, 'COMPLETED', 0)`,
      [transferId, senderCustomerId, receiverCustomerId, amount, note || null]
    );

    return { success: true, transferId, reference: ref, amount };
  }

  // ── Bank accounts ─────────────────────────────────────────────────────────
  async addBankAccount(customerId: string, bankData: {
    bankName: string; accountHolder: string; accountNumber: string;
    routingNumber?: string; iban?: string; swiftCode?: string; currency?: string;
  }) {
    const id = uuidv4();
    await db.query(
      `INSERT INTO bank_accounts (id, customer_id, bank_name, account_holder, account_number, routing_number, iban, swift_code, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId, bankData.bankName, bankData.accountHolder, bankData.accountNumber,
       bankData.routingNumber || null, bankData.iban || null, bankData.swiftCode || null, bankData.currency || 'USD']
    );
    return (await db.query('SELECT * FROM bank_accounts WHERE id = ?', [id])).rows[0];
  }

  async getBankAccounts(customerId: string) {
    return (await db.query('SELECT * FROM bank_accounts WHERE customer_id = ? ORDER BY created_at DESC', [customerId])).rows;
  }

  // ── Wallet-to-Bank payout ─────────────────────────────────────────────────
  async bankPayout(customerId: string, bankAccountId: string, amount: number) {
    if (amount <= 0) throw new Error('Amount must be positive');

    const wallet = await this.getOrCreateWallet(customerId);
    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);

    const FEE_RATE = 0.005; // 0.5% fee
    const fee = Math.round(amount * FEE_RATE * 100) / 100;
    const netAmount = amount - fee;
    if (balance < amount) throw new Error('Insufficient balance');

    const bankRes = await db.query('SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?', [bankAccountId, customerId]);
    if (!bankRes.rows.length) throw new Error('Bank account not found');

    const payoutId = uuidv4();
    const ref = `PAY-${payoutId.slice(0, 8).toUpperCase()}`;

    // Debit wallet
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, wallet.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description) VALUES (?, ?, 'debit', ?, 'bank_payout', ?, ?)`,
      [uuidv4(), wallet.id, amount, ref, `Bank payout to ${bankRes.rows[0].bank_name}`]
    );

    // Record payout (PENDING — real payout requires ACH/SEPA integration)
    await db.query(
      `INSERT INTO bank_payouts (id, customer_id, bank_account_id, amount, currency, fee, net_amount, status, reference, scheduled_at)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, 'PENDING', ?, datetime('now', '+1 day'))`,
      [payoutId, customerId, bankAccountId, amount, fee, netAmount, ref]
    );

    return { success: true, payoutId, reference: ref, amount, fee, netAmount, status: 'PENDING', eta: '1-2 business days' };
  }

  async getBankPayouts(customerId: string) {
    return (await db.query(
      'SELECT p.*, b.bank_name, b.account_number FROM bank_payouts p JOIN bank_accounts b ON b.id = p.bank_account_id WHERE p.customer_id = ? ORDER BY p.created_at DESC LIMIT 50',
      [customerId]
    )).rows;
  }

  // ── Virtual Cards ─────────────────────────────────────────────────────────
  async generateCardCredentials(cardType: string = 'VISA') {
    const cardNumber = this.generateCardNumber(cardType);
    const masked = '*'.repeat(Math.max(0, cardNumber.length - 4)) + cardNumber.slice(-4);
    const now = new Date();
    const expiryMonth = now.getMonth() + 1;
    const expiryYear = now.getFullYear() + 3;
    const cvv = String(Math.floor(100 + Math.random() * 900));
    return { cardNumber, maskedNumber: masked, expiryMonth, expiryYear, cvv, cardType };
  }

  async issueVirtualCard(customerId: string, details: string | VirtualCardDetails, currency: string = 'USD') {
    const resolved = typeof details === 'string'
      ? { cardholderName: details, currency }
      : { ...details, currency: details.currency || currency };

    const generated = await this.generateCardCredentials(resolved.cardType || 'VISA');
    const cardNumber = resolved.cardNumber || generated.cardNumber;
    const masked = resolved.maskedNumber || generated.maskedNumber;
    const expiryMonth = Number(resolved.expiryMonth ?? generated.expiryMonth);
    const expiryYear = Number(resolved.expiryYear ?? generated.expiryYear);
    const cvv = String(resolved.cvv ?? generated.cvv);
    const cardholderName = resolved.cardholderName || 'Customer';
    const cardType = resolved.cardType || generated.cardType;
    const dailyLimit = Number(resolved.dailyLimit ?? 1000);

    const id = uuidv4();
    await db.query(
      `INSERT INTO virtual_cards (id, customer_id, card_number, masked_number, expiry_month, expiry_year, cvv, cardholder_name, card_type, status, balance, currency, daily_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`,
      [id, customerId, cardNumber, masked, expiryMonth, expiryYear, cvv, cardholderName, cardType, currency, dailyLimit]
    );

    return {
      id, cardNumber, maskedNumber: masked,
      expiryMonth, expiryYear, cvv,
      cardholderName, cardType, status: 'ACTIVE',
      balance: 0, currency, dailyLimit
    };
  }

  async getVirtualCards(customerId: string) {
    const cards = (await db.query(
      'SELECT id, masked_number, expiry_month, expiry_year, cardholder_name, card_type, status, balance, currency, daily_limit, daily_spent, created_at FROM virtual_cards WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId]
    )).rows;
    return cards;
  }

  async topupVirtualCard(customerId: string, cardId: string, amount: number) {
    if (amount <= 0) throw new Error('Amount must be positive');
    const wallet = await this.getOrCreateWallet(customerId);
    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    if (Number(balRes.rows[0]?.balance ?? 0) < amount) throw new Error('Insufficient wallet balance');

    // Debit wallet, credit card
    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, wallet.id]);
    await db.query('UPDATE virtual_cards SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND customer_id = ?', [amount, cardId, customerId]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference) VALUES (?, ?, 'debit', ?, 'virtual_card_topup', ?)`,
      [uuidv4(), wallet.id, amount, cardId]
    );
    return { success: true, amount };
  }

  async freezeVirtualCard(customerId: string, cardId: string) {
    await db.query("UPDATE virtual_cards SET status = 'FROZEN', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND customer_id = ?", [cardId, customerId]);
    return { success: true };
  }

  async unfreezeVirtualCard(customerId: string, cardId: string) {
    await db.query("UPDATE virtual_cards SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND customer_id = ?", [cardId, customerId]);
    return { success: true };
  }

  private generateCardNumber(cardType: string = 'VISA'): string {
    const prefix = cardType.toUpperCase().includes('MASTERCARD') ? '5' : '4';
    let num = prefix + Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join('');
    // Luhn checksum
    let sum = 0;
    for (let i = 0; i < num.length; i++) {
      let d = parseInt(num[num.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    const check = (10 - (sum % 10)) % 10;
    return num + check;
  }

  // ── Crypto ────────────────────────────────────────────────────────────────
  async getCryptoPrice(cryptoCoin: string): Promise<number> {
    const coinMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', SOL: 'solana',
      DOGE: 'dogecoin', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano',
      AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink'
    };
    const id = coinMap[cryptoCoin.toUpperCase()];
    if (!id) return 1;

    try {
      const res = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      return res.data?.[id]?.usd ?? this.getFallbackPrice(cryptoCoin);
    } catch {
      return this.getFallbackPrice(cryptoCoin);
    }
  }

  private getFallbackPrice(coin: string): number {
    const fallback: Record<string, number> = {
      BTC: 67000, ETH: 3400, USDT: 1.00, SOL: 145, DOGE: 0.12,
      BNB: 580, XRP: 0.55, ADA: 0.45, AVAX: 28, DOT: 6.5, MATIC: 0.7, LINK: 14
    };
    return fallback[coin.toUpperCase()] ?? 1;
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

  async buyCryptoWithMerchant(merchantId: string, cryptoCoin: string, fiatAmount: number, network?: string) {
    const merchantWallet = await this.getOrCreateMerchantWallet(merchantId);
    const balanceRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [merchantWallet.id]);
    if (Number(balanceRes.rows[0]?.balance ?? 0) < fiatAmount) throw new Error('Insufficient merchant wallet balance');

    const exchangeRate = await this.getCryptoPrice(cryptoCoin);
    const cryptoAmount = fiatAmount / exchangeRate;
    const cryptoWallet = await this.getOrCreateCryptoWallet(merchantId, cryptoCoin);

    await db.query('UPDATE merchant_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [fiatAmount, merchantWallet.id]);
    await db.query(
      `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, source, reference, description) VALUES (?, ?, 'debit', ?, 'crypto_purchase', ?, ?)`,
      [uuidv4(), merchantWallet.id, fiatAmount, uuidv4(), `Bought ${cryptoAmount.toFixed(8)} ${cryptoCoin} @ $${exchangeRate}`]
    );
    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, 'merchant_wallet', ?, 'completed')`,
      [uuidv4(), merchantId, cryptoCoin, fiatAmount, cryptoAmount, exchangeRate, network || 'primary']
    );

    return { success: true, cryptoAmount, exchangeRate, fiatAmount, merchantId, network: network || 'primary' };
  }

  async buyCryptoWithWallet(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string) {
    const cryptoWallet = await this.getOrCreateCryptoWallet(customerId, cryptoCoin);
    const exchangeRate = await this.getCryptoPrice(cryptoCoin);
    const cryptoAmount = fiatAmount / exchangeRate;

    const wallet = await this.getOrCreateWallet(customerId);
    const balRes = await db.query('SELECT balance FROM customer_wallets WHERE id = ?', [wallet.id]);
    if (Number(balRes.rows[0]?.balance ?? 0) < fiatAmount) throw new Error('Insufficient fiat wallet balance');

    await db.query('UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [fiatAmount, wallet.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description) VALUES (?, ?, 'debit', ?, 'crypto_purchase', ?, ?)`,
      [uuidv4(), wallet.id, fiatAmount, uuidv4(), `Bought ${cryptoAmount.toFixed(8)} ${cryptoCoin} @ $${exchangeRate}`]
    );
    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'buy', ?, ?, 'USD', ?, 'wallet_balance', ?, 'completed')`,
      [uuidv4(), customerId, cryptoCoin, fiatAmount, cryptoAmount, exchangeRate, network || 'primary']
    );

    return { success: true, cryptoAmount, exchangeRate, fiatAmount, network: network || 'primary' };
  }

  async sellCrypto(customerId: string, cryptoCoin: string, cryptoAmount: number, network?: string) {
    const cryptoWallet = await this.getOrCreateCryptoWallet(customerId, cryptoCoin);
    if (Number(cryptoWallet.balance) < cryptoAmount) throw new Error('Insufficient crypto balance');

    const exchangeRate = await this.getCryptoPrice(cryptoCoin);
    const fiatAmount = cryptoAmount * exchangeRate;
    const wallet = await this.getOrCreateWallet(customerId);

    await db.query('UPDATE customer_crypto_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cryptoWallet.id]);
    await db.query('UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [fiatAmount, wallet.id]);
    await db.query(
      `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, description) VALUES (?, ?, 'credit', ?, 'crypto_sale', ?)`,
      [uuidv4(), wallet.id, fiatAmount, `Sold ${cryptoAmount} ${cryptoCoin} @ $${exchangeRate}`]
    );
    await db.query(
      `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status)
       VALUES (?, ?, ?, 'sell', ?, ?, 'USD', ?, 'crypto_wallet', ?, 'completed')`,
      [uuidv4(), customerId, cryptoCoin, fiatAmount, cryptoAmount, exchangeRate, network || 'primary']
    );

    return { success: true, fiatAmount, exchangeRate, cryptoAmount, network: network || 'primary' };
  }

  async getCryptoTransactions(customerId: string) {
    return (await db.query('SELECT * FROM crypto_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100', [customerId])).rows;
  }
}

export const walletsService = new WalletsService();
