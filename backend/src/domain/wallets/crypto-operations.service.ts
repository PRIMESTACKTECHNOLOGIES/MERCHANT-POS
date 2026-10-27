import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { cryptoWalletsService } from './crypto-wallets.service';
import { transakService } from './transak.service';
import axios from 'axios';
import { getOrDeriveCustomerWallet, toDerivationNetwork } from '../../utils/walletGen';
import { invoiceReceiptService } from '../receipts/invoice-receipt.service';

export interface BuyCryptoRequest {
  customer_id: string;
  amount_usd: number;
  crypto_currency: string; // BTC, ETH, USDT, SOL, etc.
  network: string; // tron, ethereum, solana, bsc, polygon
  payment_method: 'transak' | 'stripe' | 'wallet_balance'; // How to pay
  wallet_address?: string; // Customer's address (if they provide one)
}

export interface BuyCryptoResult {
  success: boolean;
  transaction_id: string;
  status: string;
  order_id?: string;
  transak_url?: string;
  expected_crypto_amount?: number;
  message?: string;
  error?: string;
}

export interface SwapRequest {
  customer_id: string;
  from_coin: string;
  from_network: string;
  to_coin: string;
  to_network: string;
  amount: number; // Amount of from_coin to swap
}

export interface SwapResult {
  success: boolean;
  transaction_id: string;
  status: string;
  from_coin: string;
  from_amount: number;
  to_coin: string;
  to_amount: number;
  exchange_rate: number;
  price_impact: number; // %
  error?: string;
}

/**
 * Orchestrates buy/sell/swap operations for customers
 * Routes to Transak (fiat on-ramp), Stripe (card top-up), Jupiter (DEX swaps), etc.
 */
export class CryptoOperationsService {

  /**
   * Buy crypto with fiat (via Transak or Stripe)
   */
  async buyCrypto(req: BuyCryptoRequest): Promise<BuyCryptoResult> {
    try {
      const txnId = uuidv4();
      const now = new Date().toISOString();

      // Validate customer exists
      const customerRes = await db.query(
        `SELECT id FROM customers WHERE id = ?`,
        [req.customer_id]
      );

      if (!customerRes.rows || customerRes.rows.length === 0) {
        return {
          success: false,
          transaction_id: txnId,
          status: 'FAILED',
          error: 'Customer not found',
        };
      }

      // Route based on payment method
      if (req.payment_method === 'transak') {
        return await this.buyCryptoWithTransak(req, txnId);
      } else if (req.payment_method === 'wallet_balance') {
        return await this.buyCryptoWithWalletBalance(req, txnId);
      } else if (req.payment_method === 'stripe') {
        return await this.buyCryptoWithStripe(req, txnId);
      }

      return {
        success: false,
        transaction_id: txnId,
        status: 'FAILED',
        error: 'Unknown payment method',
      };
    } catch (err: any) {
      console.error('[CryptoOps] Buy crypto failed:', err);
      return {
        success: false,
        transaction_id: uuidv4(),
        status: 'ERROR',
        error: err.message,
      };
    }
  }

  /**
   * Buy crypto via Transak (fiat on-ramp)
   */
  private async buyCryptoWithTransak(req: BuyCryptoRequest, txnId: string): Promise<BuyCryptoResult> {
    try {
      // Generate customer wallet address if not provided
      const walletAddress = req.wallet_address ||
        await this.getOrCreateWalletAddress(req.customer_id, req.crypto_currency, req.network);

      // Create Transak order
      const order = await transakService.createOrder(
        req.customer_id,
        req.amount_usd,
        'USD',
        req.crypto_currency,
        req.network,
        walletAddress
      );

      // Get widget URL for customer to complete payment
      const widgetUrl = transakService.getWidgetUrl(
        req.customer_id,
        req.crypto_currency,
        req.network
      );

      // Record transaction
      const now = new Date().toISOString();
      await db.query(
        `INSERT INTO crypto_transactions_log_v2
         (id, customer_id, transaction_type, from_currency, to_currency, from_amount, to_amount,
          exchange_rate, source, reference, status, created_at)
         VALUES (?, ?, 'buy', 'USD', ?, 0, ?, 0, 'transak', ?, 'PENDING', ?)`,
        [
          txnId,
          req.customer_id,
          req.crypto_currency,
          0,
          order.order_id,
          now,
        ]
      );

      await invoiceReceiptService.create({
        type: 'CRYPTO_PURCHASE_RECEIPT', sourceTable: 'crypto_transactions_log_v2', sourceId: txnId,
        customerId: req.customer_id, amount: req.amount_usd, currency: 'USD', status: 'PENDING_PAYMENT',
        reference: order.order_id, description: `Crypto purchase order for ${req.crypto_currency}`,
        details: { cryptoCurrency: req.crypto_currency, network: req.network, walletAddress, orderId: order.order_id },
      });

      return {
        success: true,
        transaction_id: txnId,
        status: 'PENDING_PAYMENT',
        order_id: order.order_id,
        transak_url: widgetUrl,
        expected_crypto_amount: 0, // Will be filled after payment
        message: 'Please complete payment in Transak widget',
      };
    } catch (err: any) {
      console.error('[CryptoOps] Transak buy failed:', err);
      return {
        success: false,
        transaction_id: txnId,
        status: 'FAILED',
        error: err.message,
      };
    }
  }

  /**
   * Buy crypto using wallet fiat balance
   */
  private async buyCryptoWithWalletBalance(req: BuyCryptoRequest, txnId: string): Promise<BuyCryptoResult> {
    try {
      // Check wallet balance
      const walletRes = await db.query(
        `SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = 'USD'`,
        [req.customer_id]
      );

      if (!walletRes.rows || walletRes.rows.length === 0) {
        return {
          success: false,
          transaction_id: txnId,
          status: 'FAILED',
          error: 'No USD wallet found',
        };
      }

      const wallet = walletRes.rows[0];
      if (wallet.balance < req.amount_usd) {
        return {
          success: false,
          transaction_id: txnId,
          status: 'FAILED',
          error: 'Insufficient balance',
        };
      }

      // Debit wallet
      const now = new Date().toISOString();
      await db.query(
        `UPDATE customer_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        [req.amount_usd, now, wallet.id]
      );

      // Get current crypto price (from external source like CoinGecko)
      const priceUsd = await this.getCryptoPrice(req.crypto_currency);
      const cryptoAmount = req.amount_usd / priceUsd;

      // Generate wallet address
      const walletAddress = req.wallet_address ||
        await this.getOrCreateWalletAddress(req.customer_id, req.crypto_currency, req.network);

      // Credit crypto wallet
      await cryptoWalletsService.updateCryptoBalance(
        req.customer_id,
        req.crypto_currency,
        req.network,
        walletAddress,
        cryptoAmount,
        priceUsd,
        'wallet_balance'
      );

      // Record transaction
      const txnRes = await db.query(
        `INSERT INTO crypto_transactions_log_v2
         (id, customer_id, transaction_type, from_currency, to_currency, from_amount, to_amount,
          exchange_rate, source, reference, status, created_at)
         VALUES (?, ?, 'buy', 'USD', ?, ?, ?, ?, 'wallet_balance', ?, 'COMPLETED', ?)`,
        [
          txnId,
          req.customer_id,
          req.crypto_currency,
          req.amount_usd,
          cryptoAmount,
          priceUsd,
          walletAddress,
          now,
        ]
      );

      await invoiceReceiptService.create({
        type: 'CRYPTO_PURCHASE_RECEIPT', sourceTable: 'crypto_transactions_log_v2', sourceId: txnId,
        customerId: req.customer_id, amount: req.amount_usd, currency: 'USD', status: 'COMPLETED',
        reference: walletAddress, description: `Crypto purchase of ${req.crypto_currency}`,
        details: { cryptoCurrency: req.crypto_currency, network: req.network, walletAddress, cryptoAmount, priceUsd },
      });

      return {
        success: true,
        transaction_id: txnId,
        status: 'COMPLETED',
        expected_crypto_amount: cryptoAmount,
      };
    } catch (err: any) {
      console.error('[CryptoOps] Wallet balance buy failed:', err);
      return {
        success: false,
        transaction_id: txnId,
        status: 'FAILED',
        error: err.message,
      };
    }
  }

  /**
   * Buy crypto using Stripe
   */
  private async buyCryptoWithStripe(req: BuyCryptoRequest, txnId: string): Promise<BuyCryptoResult> {
    // TODO: Implement Stripe card on-ramp flow
    return {
      success: false,
      transaction_id: txnId,
      status: 'NOT_IMPLEMENTED',
      error: 'Stripe payment method coming soon',
    };
  }

  /**
   * Swap between cryptos (e.g., BTC → ETH via Jupiter)
   */
  async swapCrypto(req: SwapRequest): Promise<SwapResult> {
    try {
      const txnId = uuidv4();
      const now = new Date().toISOString();

      // Get from_coin wallet
      const fromWalletRes = await db.query(
        `SELECT * FROM customer_crypto_wallets_v2
         WHERE customer_id = ? AND coin = ? AND network = ?`,
        [req.customer_id, req.from_coin.toUpperCase(), req.from_network.toLowerCase()]
      );

      if (!fromWalletRes.rows || fromWalletRes.rows.length === 0) {
        return {
          success: false,
          transaction_id: txnId,
          status: 'FAILED',
          from_coin: req.from_coin,
          from_amount: req.amount,
          to_coin: req.to_coin,
          to_amount: 0,
          exchange_rate: 0,
          price_impact: 0,
          error: `No ${req.from_coin} wallet found`,
        };
      }

      const fromWallet = fromWalletRes.rows[0];
      if (fromWallet.quantity < req.amount) {
        return {
          success: false,
          transaction_id: txnId,
          status: 'FAILED',
          from_coin: req.from_coin,
          from_amount: req.amount,
          to_coin: req.to_coin,
          to_amount: 0,
          exchange_rate: 0,
          price_impact: 0,
          error: `Insufficient ${req.from_coin} balance`,
        };
      }

      // Get swap price from Jupiter (for Solana) or CoinGecko
      const fromPrice = await this.getCryptoPrice(req.from_coin);
      const toPrice = await this.getCryptoPrice(req.to_coin);
      const exchangeRate = fromPrice / toPrice;
      const toAmount = req.amount * exchangeRate;
      const priceImpact = 0.5; // Assume 0.5% for DEX swaps

      // Debit from_coin
      await cryptoWalletsService.updateCryptoBalance(
        req.customer_id,
        req.from_coin,
        req.from_network,
        fromWallet.address,
        -req.amount,
        fromPrice,
        'swap'
      );

      // Get or create to_coin wallet
      const toWallet = await cryptoWalletsService.getOrCreateCryptoWallet(
        req.customer_id,
        req.to_coin,
        req.to_network,
        '', // Address would need to be generated for new networks
        'swap'
      );

      // Credit to_coin
      await cryptoWalletsService.updateCryptoBalance(
        req.customer_id,
        req.to_coin,
        req.to_network,
        toWallet.address,
        toAmount,
        toPrice,
        'swap'
      );

      // Record swap transaction
      await db.query(
        `INSERT INTO crypto_transactions_log_v2
         (id, customer_id, transaction_type, from_currency, to_currency, from_amount, to_amount,
          exchange_rate, source, reference, status, created_at)
         VALUES (?, ?, 'swap', ?, ?, ?, ?, ?, 'jupiter', ?, 'COMPLETED', ?)`,
        [
          txnId,
          req.customer_id,
          req.from_coin.toUpperCase(),
          req.to_coin.toUpperCase(),
          req.amount,
          toAmount,
          exchangeRate,
          `${req.from_coin}_to_${req.to_coin}`,
          now,
        ]
      );

      return {
        success: true,
        transaction_id: txnId,
        status: 'COMPLETED',
        from_coin: req.from_coin,
        from_amount: req.amount,
        to_coin: req.to_coin,
        to_amount: toAmount,
        exchange_rate: exchangeRate,
        price_impact: priceImpact,
      };
    } catch (err: any) {
      console.error('[CryptoOps] Swap failed:', err);
      return {
        success: false,
        transaction_id: uuidv4(),
        status: 'ERROR',
        from_coin: req.from_coin,
        from_amount: req.amount,
        to_coin: req.to_coin,
        to_amount: 0,
        exchange_rate: 0,
        price_impact: 0,
        error: err.message,
      };
    }
  }

  /**
   * Get real-time crypto price from CoinGecko or configured provider
   */
  private async getCryptoPrice(coin: string): Promise<number> {
    try {
      const coin_id = this.mapCoinToCoinGeckoId(coin);
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: {
            ids: coin_id,
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      );

      return response.data?.[coin_id]?.usd || 0;
    } catch (err) {
      console.warn(`Failed to get price for ${coin}:`, err);
      return 0;
    }
  }

  /**
   * Generate (or retrieve) a real BIP-44 derived wallet address for a customer.
   * Uses WALLET_MASTER_MNEMONIC from .env to deterministically derive addresses.
   * Falls back to a placeholder if the mnemonic is not configured (dev/test mode).
   */
  private async generateWalletAddress(coin: string, network: string): Promise<string> {
    try {
      const derivationNetwork = toDerivationNetwork(coin, network);
      // We don't have a customerId here — generate a one-off address at index 0
      // (callers that have a customerId should use getOrDeriveCustomerWallet directly)
      const derived = await import('../../utils/walletGen');
      const wallet = await derived.deriveWallet(derivationNetwork, 0, coin);
      return wallet.address;
    } catch (err: any) {
      // Mnemonic not configured in dev — return a clearly-labelled placeholder
      console.warn('[walletGen] Mnemonic not set, returning placeholder address:', err.message);
      return `${coin.toLowerCase()}_${network}_placeholder_${uuidv4().slice(0, 8)}`;
    }
  }

  /**
   * Get or derive a real wallet address for a specific customer+coin+network.
   * Stores the derivation index in customer_crypto_wallets_v2 for future lookups.
   */
  async getOrCreateWalletAddress(customerId: string, coin: string, network: string): Promise<string> {
    try {
      const derivationNetwork = toDerivationNetwork(coin, network);
      const walletGen = await import('../../utils/walletGen');
      const derived = await walletGen.getOrDeriveCustomerWallet(db, customerId, coin, derivationNetwork);

      // Persist the derivation index so we can re-derive the same address later
      const coin_upper = coin.toUpperCase();
      const existing = await db.query(
        `SELECT id FROM customer_crypto_wallets_v2
         WHERE customer_id = ? AND coin = ? AND network = ?`,
        [customerId, coin_upper, network.toLowerCase()]
      );
      if (existing.rows.length > 0) {
        await db.query(
          `UPDATE customer_crypto_wallets_v2 SET address = ?, derivation_index = ?
           WHERE customer_id = ? AND coin = ? AND network = ?`,
          [derived.address, derived.index, customerId, coin_upper, network.toLowerCase()]
        );
      }
      return derived.address;
    } catch (err: any) {
      console.warn('[walletGen] Derivation failed, using placeholder:', err.message);
      return `${coin.toLowerCase()}_${network}_placeholder_${uuidv4().slice(0, 8)}`;
    }
  }

  /**
   * Map coin symbol to CoinGecko ID
   */
  private mapCoinToCoinGeckoId(coin: string): string {
    const map: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      USDT: 'tether',
      USDC: 'usd-coin',
      SOL: 'solana',
      BNB: 'binancecoin',
      MATIC: 'matic-network',
      AVAX: 'avalanche-2',
      XRP: 'ripple',
      ADA: 'cardano',
      DOGE: 'dogecoin',
      LINK: 'chainlink',
    };
    return map[coin.toUpperCase()] || coin.toLowerCase();
  }
}

export const cryptoOpsService = new CryptoOperationsService();
