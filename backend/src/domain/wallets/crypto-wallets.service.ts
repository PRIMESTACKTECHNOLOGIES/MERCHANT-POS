import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

export interface CryptoWallet {
  id: string;
  customer_id: string;
  coin: string; // BTC, ETH, USDT, SOL, etc.
  network: string; // bitcoin, ethereum, tron, solana, bsc, polygon
  quantity: number;
  value_usd: number;
  address: string; // blockchain address
  source: string; // transak, stripe, swap, etc.
  updated_at: string;
}

export interface CryptoBalance {
  coin: string;
  network: string;
  quantity: number;
  value_usd: number;
  percent_of_portfolio: number;
  address: string;
}

export interface WalletSnapshot {
  customer_id: string;
  fiat_balance_usd: number;
  crypto_holdings: CryptoBalance[];
  total_value_usd: number;
  breakdown: {
    fiat_percent: number;
    crypto_percent: number;
  };
  last_updated: string;
}

/**
 * Manages customer crypto wallet holdings (real blockchain addresses, real USDT/BTC/ETH holdings)
 */
export class CryptoWalletsService {

  /**
   * Get or create a crypto wallet for a customer on a specific network
   */
  async getOrCreateCryptoWallet(
    customerId: string,
    coin: string,
    network: string,
    address: string,
    source: string = 'manual'
  ): Promise<CryptoWallet> {
    const walletId = uuidv4();
    const coin_upper = coin.toUpperCase();
    const network_lower = network.toLowerCase();

    try {
      // Check if wallet exists
      const existing = await db.query(
        `SELECT * FROM customer_crypto_wallets_v2
         WHERE customer_id = ? AND coin = ? AND network = ? AND address = ?`,
        [customerId, coin_upper, network_lower, address]
      );

      if (existing.rows && existing.rows.length > 0) {
        return existing.rows[0] as CryptoWallet;
      }

      // Create new wallet
      const now = new Date().toISOString();
      await db.query(
        `INSERT INTO customer_crypto_wallets_v2
         (id, customer_id, coin, network, quantity, value_usd, address, source, updated_at, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
        [walletId, customerId, coin_upper, network_lower, address, source, now, now]
      );

      return {
        id: walletId,
        customer_id: customerId,
        coin: coin_upper,
        network: network_lower,
        quantity: 0,
        value_usd: 0,
        address,
        source,
        updated_at: now,
      };
    } catch (err) {
      console.error(`Failed to create crypto wallet for ${customerId}:${coin}:${network}`, err);
      throw err;
    }
  }

  /**
   * Update crypto wallet balance (when crypto is received or bought)
   */
  async updateCryptoBalance(
    customerId: string,
    coin: string,
    network: string,
    address: string,
    quantityDelta: number,
    priceUsd: number,
    source: string = 'manual'
  ): Promise<CryptoWallet> {
    const coin_upper = coin.toUpperCase();
    const network_lower = network.toLowerCase();
    const now = new Date().toISOString();

    try {
      // Get or create wallet
      const wallet = await this.getOrCreateCryptoWallet(customerId, coin_upper, network_lower, address, source);

      const newQuantity = wallet.quantity + quantityDelta;
      const newValueUsd = newQuantity * priceUsd;

      // Update balance
      await db.query(
        `UPDATE customer_crypto_wallets_v2
         SET quantity = ?, value_usd = ?, updated_at = ?
         WHERE id = ?`,
        [newQuantity, newValueUsd, now, wallet.id]
      );

      return {
        ...wallet,
        quantity: newQuantity,
        value_usd: newValueUsd,
        updated_at: now,
      };
    } catch (err) {
      console.error(`Failed to update crypto balance for ${customerId}:${coin}:${network}`, err);
      throw err;
    }
  }

  /**
   * List all crypto holdings for a customer
   */
  async listCryptoHoldings(customerId: string): Promise<CryptoWallet[]> {
    try {
      const result = await db.query(
        `SELECT * FROM customer_crypto_wallets_v2
         WHERE customer_id = ? AND quantity > 0
         ORDER BY value_usd DESC`,
        [customerId]
      );
      return result.rows as CryptoWallet[];
    } catch (err) {
      console.error(`Failed to list crypto holdings for ${customerId}`, err);
      return [];
    }
  }

  /**
   * Get total crypto portfolio value in USD
   */
  async getTotalCryptoValue(customerId: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT SUM(value_usd) as total FROM customer_crypto_wallets_v2
         WHERE customer_id = ? AND quantity > 0`,
        [customerId]
      );

      if (result.rows && result.rows.length > 0 && result.rows[0].total) {
        return Number(result.rows[0].total);
      }
      return 0;
    } catch (err) {
      console.error(`Failed to calculate total crypto value for ${customerId}`, err);
      return 0;
    }
  }

  /**
   * Get complete wallet snapshot (fiat + crypto)
   */
  async getWalletSnapshot(customerId: string): Promise<WalletSnapshot> {
    try {
      // Get fiat balance
      const fiatResult = await db.query(
        `SELECT COALESCE(SUM(balance), 0) as total FROM customer_wallets
         WHERE customer_id = ? AND currency = 'USD'`,
        [customerId]
      );
      const fiatBalance = fiatResult.rows?.[0]?.total || 0;

      // Get crypto holdings
      const cryptoHoldings = await this.listCryptoHoldings(customerId);
      const cryptoValue = cryptoHoldings.reduce((sum, w) => sum + (w.value_usd || 0), 0);
      const totalValue = fiatBalance + cryptoValue;

      const snapshot: WalletSnapshot = {
        customer_id: customerId,
        fiat_balance_usd: fiatBalance,
        crypto_holdings: cryptoHoldings.map(w => ({
          coin: w.coin,
          network: w.network,
          quantity: w.quantity,
          value_usd: w.value_usd,
          percent_of_portfolio: totalValue > 0 ? (w.value_usd / totalValue) * 100 : 0,
          address: w.address,
        })),
        total_value_usd: totalValue,
        breakdown: {
          fiat_percent: totalValue > 0 ? (fiatBalance / totalValue) * 100 : 0,
          crypto_percent: totalValue > 0 ? (cryptoValue / totalValue) * 100 : 0,
        },
        last_updated: new Date().toISOString(),
      };

      return snapshot;
    } catch (err) {
      console.error(`Failed to get wallet snapshot for ${customerId}`, err);
      return {
        customer_id: customerId,
        fiat_balance_usd: 0,
        crypto_holdings: [],
        total_value_usd: 0,
        breakdown: { fiat_percent: 0, crypto_percent: 0 },
        last_updated: new Date().toISOString(),
      };
    }
  }

  /**
   * Record crypto transaction (buy/sell/swap)
   */
  async recordCryptoTransaction(
    customerId: string,
    coin: string,
    network: string,
    transactionType: 'buy' | 'sell' | 'swap' | 'withdraw',
    fromCurrency: string,
    toCurrency: string,
    fromAmount: number,
    toAmount: number,
    exchangeRate: number,
    source: string,
    reference: string
  ): Promise<string> {
    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      await db.query(
        `INSERT INTO crypto_wallet_transactions_v2
         (id, customer_id, coin, network, transaction_type, from_currency, to_currency,
          from_amount, to_amount, exchange_rate, source, reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          id,
          customerId,
          coin.toUpperCase(),
          network.toLowerCase(),
          transactionType,
          fromCurrency.toUpperCase(),
          toCurrency.toUpperCase(),
          fromAmount,
          toAmount,
          exchangeRate,
          source,
          reference,
          now,
        ]
      );

      return id;
    } catch (err) {
      console.error(`Failed to record crypto transaction`, err);
      throw err;
    }
  }
}

export const cryptoWalletsService = new CryptoWalletsService();
