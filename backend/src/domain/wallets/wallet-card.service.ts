import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { balancedLedgerEngine } from '../ledger/ledger.service';

const normalizeCurrency = (currency: string) => (currency || 'USD').trim().toUpperCase();

export class WalletCardService {
  private verifyMac(secret: string, payload: string, suppliedMac: string) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const suppliedBuffer = Buffer.from(String(suppliedMac || '').toLowerCase(), 'utf8');
    return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  async issueCard(customerId: string, currency = 'USD') {
    if (!customerId) throw new Error('customerId is required');
    const ccy = normalizeCurrency(currency);
    const wallet = await db.query(
      'SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ? LIMIT 1',
      [customerId, ccy]
    );
    if (!wallet.rows.length) throw new Error('Wallet not found');

    const existing = wallet.rows[0];
    if (existing.card_id) {
      return {
        cardId: existing.card_id,
        walletId: existing.id,
        currency: ccy,
        offlineBalance: Number(existing.offline_balance || 0),
        offlineLimit: Number(existing.offline_limit || 0),
        alreadyIssued: true,
      };
    }

    const cardId = `CARD-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const cardMacSecret = crypto.randomBytes(32).toString('hex');
    const issuedAt = new Date().toISOString();
    await db.query(
      `UPDATE customer_wallets
          SET card_id = ?, card_mac_secret = ?, card_issued_at = ?, offline_balance = 0, offline_limit = 0, updated_at = ?
        WHERE id = ?`,
      [cardId, cardMacSecret, issuedAt, issuedAt, existing.id]
    );

    return {
      cardId,
      cardSecret: cardMacSecret,
      walletId: existing.id,
      currency: ccy,
      offlineBalance: 0,
      offlineLimit: 0,
      alreadyIssued: false,
    };
  }

  async issueMerchantCard(merchantId: string, currency = 'USD') {
    if (!merchantId) throw new Error('merchantId is required');
    const ccy = normalizeCurrency(currency);
    const walletRes = await db.query(
      'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
      [merchantId, ccy]
    );
    if (!walletRes.rows.length) throw new Error('Merchant wallet not found');
    const wallet = walletRes.rows[0];
    if (wallet.card_id) {
      return { merchantId, cardId: wallet.card_id, walletId: wallet.id, currency: ccy, authenticated: true, alreadyIssued: true };
    }

    const cardId = `MCARD-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
    const cardMacSecret = crypto.randomBytes(32).toString('hex');
    const issuedAt = new Date().toISOString();
    await db.query(
      `UPDATE merchant_wallets SET card_id = ?, card_mac_secret = ?, card_issued_at = ?, updated_at = ? WHERE id = ?`,
      [cardId, cardMacSecret, issuedAt, issuedAt, wallet.id]
    );
    return { merchantId, cardId, walletId: wallet.id, currency: ccy, authenticated: true, cardSecret: cardMacSecret, alreadyIssued: false };
  }

  async setOfflineLimit(cardId: string, limitMinor: number) {
    if (!cardId) throw new Error('cardId is required');
    if (!Number.isInteger(limitMinor) || limitMinor < 0) {
      throw new Error('limitMinor must be a non-negative integer');
    }

    const wallet = await db.query('SELECT * FROM customer_wallets WHERE card_id = ? LIMIT 1', [cardId]);
    if (!wallet.rows.length) throw new Error('Wallet card not found');
    const row = wallet.rows[0];
    const balanceMinor = Math.round(Number(row.balance || 0) * 100);
    if (limitMinor > balanceMinor) {
      throw new Error('Offline limit cannot exceed wallet balance');
    }

    const offlineBalance = limitMinor;
    await db.query(
      `UPDATE customer_wallets
          SET offline_limit = ?, offline_balance = ?, updated_at = CURRENT_TIMESTAMP
        WHERE card_id = ?`,
      [limitMinor / 100, offlineBalance / 100, cardId]
    );
    return { cardId, currency: row.currency || 'USD', offlineLimitMinor: limitMinor, offlineBalanceMinor: offlineBalance };
  }

  async loadWalletOnline(params: {
    psp: string;
    externalRef: string;
    customerId: string;
    cardId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }) {
    const { psp, externalRef, customerId, cardId, amountMinor, idempotencyKey } = params;
    const currency = normalizeCurrency(params.currency);
    if (!psp || !externalRef || !customerId || !cardId || !idempotencyKey) {
      throw new Error('psp, externalRef, customerId, cardId and idempotencyKey are required');
    }
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('amountMinor must be a positive integer');
    }

    const prior = await db.query(
      `SELECT * FROM wallet_funding_loads WHERE idempotency_key = ? OR external_ref = ? LIMIT 1`,
      [idempotencyKey, externalRef]
    );
    if (prior.rows.length) {
      return { success: true, duplicate: true, ...prior.rows[0] };
    }

    const walletRes = await db.query(
      `SELECT * FROM customer_wallets WHERE id = ? AND customer_id = ? AND card_id = ? AND currency = ? LIMIT 1`,
      [cardId.replace(/^CARD-/, ''), customerId, cardId, currency]
    );
    const wallet = walletRes.rows[0] || (await db.query(
      `SELECT * FROM customer_wallets WHERE customer_id = ? AND card_id = ? AND currency = ? LIMIT 1`,
      [customerId, cardId, currency]
    )).rows[0];
    if (!wallet) throw new Error('Wallet card does not belong to customer or currency');

    const amount = amountMinor / 100;
    const now = new Date().toISOString();
    const loadId = uuidv4();
    const ledger = await balancedLedgerEngine.createBalancedTransaction({
      type: 'settlement_sweep',
      status: 'SETTLED',
      amount,
      currency,
      reference: externalRef,
      metadata: { psp, customerId, cardId, idempotencyKey },
      entries: [
        { account_code: 'VAULT_SETTLEMENT', direction: 'debit', amount, currency, source_type: 'bank', source_reference: externalRef, description: `Funding rail settlement ${externalRef}` },
        { account_code: `WALLET_${cardId}`, direction: 'credit', amount, currency, source_type: 'bank', source_reference: externalRef, description: `Wallet load ${externalRef}` },
      ],
    });

    await db.query(
      `INSERT INTO wallet_funding_loads
       (id, external_ref, idempotency_key, psp, customer_id, card_id, amount_minor, currency, status, ledger_transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SETTLED', ?, ?, ?)`,
      [loadId, externalRef, idempotencyKey, psp, customerId, cardId, amountMinor, currency, ledger.ledger_transaction_id, now, now]
    );
    await db.query(
      `UPDATE customer_wallets
          SET balance = balance + ?, offline_balance = MIN(offline_limit, balance + ?), updated_at = ?
        WHERE id = ?`,
      [amount, amount, now, wallet.id]
    );

    return {
      success: true,
      duplicate: false,
      loadId,
      ledgerTransactionId: ledger.ledger_transaction_id,
      cardId,
      amountMinor,
      currency,
      status: 'SETTLED',
    };
  }

  async syncOfflineTransactions(transactions: Array<{
    localTxnId: string;
    cardId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
    transactionTimestamp: string;
    newOfflineBalanceMinor: number;
    mac: string;
  }>) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error('transactions must be a non-empty array');
    }

    const results = [];
    for (const transaction of transactions) {
      const {
        localTxnId, cardId, merchantId, amountMinor, currency,
        transactionTimestamp, newOfflineBalanceMinor, mac,
      } = transaction;
      if (!localTxnId || !cardId || !merchantId || !transactionTimestamp || !mac) {
        throw new Error('Offline transaction fields are incomplete');
      }
      if (!Number.isInteger(amountMinor) || amountMinor <= 0 || !Number.isInteger(newOfflineBalanceMinor) || newOfflineBalanceMinor < 0) {
        throw new Error('Offline transaction amounts must be non-negative integers');
      }
      const ccy = normalizeCurrency(currency);
      const prior = await db.query(
        'SELECT * FROM wallet_offline_transactions WHERE local_txn_id = ? LIMIT 1',
        [localTxnId]
      );
      if (prior.rows.length) {
        results.push({ localTxnId, duplicate: true, status: prior.rows[0].status });
        continue;
      }

      const walletRes = await db.query(
        'SELECT * FROM customer_wallets WHERE card_id = ? AND currency = ? LIMIT 1',
        [cardId, ccy]
      );
      const wallet = walletRes.rows[0];
      if (!wallet || !wallet.card_mac_secret) throw new Error(`Wallet card ${cardId} not found`);
      const canonical = [
        localTxnId, cardId, amountMinor, merchantId, transactionTimestamp, newOfflineBalanceMinor,
      ].join('|');
      if (!this.verifyMac(String(wallet.card_mac_secret), canonical, mac)) {
        throw new Error(`Invalid MAC for offline transaction ${localTxnId}`);
      }

      const offlineBalanceMinor = Math.round(Number(wallet.offline_balance || 0) * 100);
      const onlineBalanceMinor = Math.round(Number(wallet.balance || 0) * 100);
      if (amountMinor > offlineBalanceMinor || amountMinor > onlineBalanceMinor) {
        throw new Error(`Insufficient wallet funds for offline transaction ${localTxnId}`);
      }
      if (newOfflineBalanceMinor !== offlineBalanceMinor - amountMinor) {
        throw new Error(`Offline balance mismatch for transaction ${localTxnId}`);
      }

      const amount = amountMinor / 100;
      const ledger = await balancedLedgerEngine.createBalancedTransaction({
        type: 'internal_transfer',
        status: 'SETTLED',
        amount,
        currency: ccy,
        reference: localTxnId,
        metadata: { cardId, merchantId, transactionTimestamp, source: 'wallet_offline_sync' },
        entries: [
          { account_code: `WALLET_${cardId}`, direction: 'debit', amount, currency: ccy, source_type: 'pos', source_reference: localTxnId, description: `Offline wallet debit ${localTxnId}` },
          { account_code: `MERCHANT_${merchantId}`, direction: 'credit', amount, currency: ccy, source_type: 'pos', source_reference: localTxnId, description: `Offline merchant credit ${localTxnId}` },
        ],
      });

      const now = new Date().toISOString();
      await db.query(
        `UPDATE customer_wallets
            SET balance = balance - ?, offline_balance = ?, updated_at = ?
          WHERE id = ?`,
        [amount, newOfflineBalanceMinor / 100, now, wallet.id]
      );
      const merchant = await db.query(
        'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
        [merchantId, ccy]
      );
      const merchantIdDb = merchant.rows[0]?.id || uuidv4();
      if (!merchant.rows.length) {
        await db.query(
          `INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, ?, ?)`,
          [merchantIdDb, merchantId, amount, ccy]
        );
      } else {
        await db.query(
          'UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [amount, merchantIdDb]
        );
      }
      await db.query(
        `INSERT INTO merchant_wallet_transactions
         (id, wallet_id, type, amount, currency, source, reference, description)
         VALUES (?, ?, 'credit', ?, ?, 'wallet_offline_sync', ?, ?)`,
        [uuidv4(), merchantIdDb, amount, ccy, localTxnId, `Offline wallet sale ${localTxnId}`]
      );
      await db.query(
        `INSERT INTO wallet_offline_transactions
         (id, local_txn_id, card_id, merchant_id, amount_minor, currency, transaction_timestamp,
          new_offline_balance_minor, mac, status, ledger_transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SETTLED', ?, ?)`,
        [uuidv4(), localTxnId, cardId, merchantId, amountMinor, ccy, transactionTimestamp,
          newOfflineBalanceMinor, mac, ledger.ledger_transaction_id, now]
      );
      results.push({ localTxnId, duplicate: false, status: 'SETTLED', ledgerTransactionId: ledger.ledger_transaction_id });
    }
    return { success: true, results };
  }
}

export const walletCardService = new WalletCardService();
