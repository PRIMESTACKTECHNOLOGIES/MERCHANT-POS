/**
 * PAYOUT PROCESSOR SERVICE
 * 
 * Converts ledger balances to actual payouts (crypto or bank)
 * This is the bridge between your payment processor and customers
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import axios from 'axios';

const TronWeb = require('tronweb');

// USDT TRC-20 Contract
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

export interface PayoutRequest {
  customer_id: string;
  amount: number;
  currency: string; // EUR, USD, etc.
  method: 'crypto' | 'bank';
  destination: string; // Crypto address OR bank account ID
  reference?: string;
}

export interface PayoutResult {
  success: boolean;
  payout_id: string;
  reference: string;
  amount: number;
  net_amount: number;
  fee: number;
  method: 'crypto' | 'bank';
  status: string;
  transaction_hash?: string; // For crypto
  estimated_arrival?: string;
  error?: string;
}

export class PayoutProcessorService {

  /**
   * Process a payout from ledger balance to customer
   */
  async processPayout(request: PayoutRequest): Promise<PayoutResult> {
    const payoutId = uuidv4();
    const reference = `PAYOUT-${payoutId.slice(0, 8).toUpperCase()}`;

    try {
      // Validate customer
      const customerRes = await db.query(
        'SELECT * FROM customers WHERE id = ?',
        [request.customer_id]
      );

      if (!customerRes.rows || customerRes.rows.length === 0) {
        return {
          success: false,
          payout_id: payoutId,
          reference,
          amount: request.amount,
          net_amount: 0,
          fee: 0,
          method: request.method,
          status: 'FAILED',
          error: 'Customer not found'
        };
      }

      // Check merchant wallet balance
      const walletRes = await db.query(
        'SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ?',
        ['MRC-1001', request.currency]
      );

      const balance = walletRes.rows[0]?.balance || 0;
      if (balance < request.amount) {
        return {
          success: false,
          payout_id: payoutId,
          reference,
          amount: request.amount,
          net_amount: 0,
          fee: 0,
          method: request.method,
          status: 'FAILED',
          error: `Insufficient balance. Have ${balance}, need ${request.amount}`
        };
      }

      // Route to crypto or bank payout
      if (request.method === 'crypto') {
        return await this.processCryptoPayout(payoutId, reference, request, balance);
      } else {
        return await this.processBankPayout(payoutId, reference, request, balance);
      }

    } catch (error: any) {
      console.error('[PayoutProcessor] Error:', error);
      return {
        success: false,
        payout_id: payoutId,
        reference,
        amount: request.amount,
        net_amount: 0,
        fee: 0,
        method: request.method,
        status: 'ERROR',
        error: error.message
      };
    }
  }

  /**
   * Process crypto payout (USDT TRC-20)
   */
  private async processCryptoPayout(
    payoutId: string,
    reference: string,
    request: PayoutRequest,
    currentBalance: number
  ): Promise<PayoutResult> {

    const timestamp = new Date().toISOString();

    // Calculate amounts
    const exchangeRate = request.currency === 'EUR' ? 1.08 : 1.0; // EUR to USD
    const amountUSD = request.amount * exchangeRate;
    const cryptoFee = amountUSD * 0.001; // 0.1%
    const networkFee = 1.50; // TRC-20 fee
    const totalFee = cryptoFee + networkFee;
    const netUSDT = amountUSD - totalFee;

    try {
      // Initialize TronWeb
      const TRON_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY;
      const TRON_FULL_NODE = process.env.TRON_FULL_NODE || 'https://api.trongrid.io';
      const TRON_API_KEY = process.env.TRON_API_KEY;

      if (!TRON_PRIVATE_KEY) {
        throw new Error('TRON_PRIVATE_KEY not configured');
      }

      const tronWeb = new TronWeb({
        fullHost: TRON_FULL_NODE,
        headers: TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {},
        privateKey: TRON_PRIVATE_KEY
      });

      const fromAddress = tronWeb.defaultAddress.base58;
      const toAddress = request.destination;

      // Validate destination address
      if (!toAddress.startsWith('T') || toAddress.length !== 34) {
        throw new Error('Invalid Tron address format');
      }

      // Check USDT balance
      const usdtContract = await tronWeb.contract().at(USDT_CONTRACT);
      const usdtBalance = await usdtContract.balanceOf(fromAddress).call();
      const usdtAmount = parseFloat(usdtBalance.toString()) / 1e6;

      if (usdtAmount < netUSDT) {
        throw new Error(`Insufficient USDT. Have ${usdtAmount}, need ${netUSDT}`);
      }

      // Send USDT
      const amountSun = Math.floor(netUSDT * 1e6);
      const txHash = await usdtContract.transfer(toAddress, amountSun).send({
        feeLimit: 100_000_000,
        callValue: 0,
        shouldPollResponse: true
      });

      // Debit merchant wallet
      await db.query(
        'UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE merchant_id = ? AND currency = ?',
        [request.amount, timestamp, 'MRC-1001', request.currency]
      );

      // Record payout
      await db.query(
        `INSERT INTO merchant_payouts (
          id, merchant_id, amount, currency, bank_account,
          status, reference, provider_reference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [payoutId, 'MRC-1001', netUSDT, 'USDT', toAddress, 'COMPLETED', reference, txHash, timestamp, timestamp]
      );

      // Record ledger entry
      await db.query(
        `INSERT INTO ledger_entries (
          id, transaction_id, merchant_id, type, amount, currency,
          status, description, reference, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          payoutId,
          'MRC-1001',
          'CRYPTO_PAYOUT',
          -request.amount,
          request.currency,
          'COMPLETED',
          `Crypto payout: ${request.amount} ${request.currency} → ${netUSDT.toFixed(2)} USDT to ${toAddress}`,
          reference,
          timestamp
        ]
      );

      return {
        success: true,
        payout_id: payoutId,
        reference,
        amount: request.amount,
        net_amount: netUSDT,
        fee: totalFee,
        method: 'crypto',
        status: 'COMPLETED',
        transaction_hash: txHash,
        estimated_arrival: 'Immediate (1-5 minutes)'
      };

    } catch (error: any) {
      // Record failed payout
      await db.query(
        `INSERT INTO merchant_payouts (
          id, merchant_id, amount, currency, bank_account,
          status, reference, provider_reference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [payoutId, 'MRC-1001', netUSDT, 'USDT', request.destination, 'FAILED', reference, error.message, timestamp, timestamp]
      );

      return {
        success: false,
        payout_id: payoutId,
        reference,
        amount: request.amount,
        net_amount: netUSDT,
        fee: totalFee,
        method: 'crypto',
        status: 'FAILED',
        error: error.message
      };
    }
  }

  /**
   * Process bank payout
   */
  private async processBankPayout(
    payoutId: string,
    reference: string,
    request: PayoutRequest,
    currentBalance: number
  ): Promise<PayoutResult> {

    const timestamp = new Date().toISOString();
    const fee = request.amount * 0.005; // 0.5% fee
    const netAmount = request.amount - fee;

    try {
      // Get bank account details
      const bankRes = await db.query(
        'SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?',
        [request.destination, request.customer_id]
      );

      if (!bankRes.rows || bankRes.rows.length === 0) {
        throw new Error('Bank account not found');
      }

      const bankAccount = bankRes.rows[0];

      // Debit merchant wallet
      await db.query(
        'UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE merchant_id = ? AND currency = ?',
        [request.amount, timestamp, 'MRC-1001', request.currency]
      );

      // Record payout (PENDING - requires manual wire transfer)
      await db.query(
        `INSERT INTO merchant_payouts (
          id, merchant_id, amount, currency, bank_account,
          status, reference, provider_reference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payoutId,
          'MRC-1001',
          netAmount,
          request.currency,
          bankAccount.account_number,
          'PENDING',
          reference,
          'WIRE_TRANSFER_REQUIRED',
          timestamp,
          timestamp
        ]
      );

      // Record ledger entry
      await db.query(
        `INSERT INTO ledger_entries (
          id, transaction_id, merchant_id, type, amount, currency,
          status, description, reference, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          payoutId,
          'MRC-1001',
          'BANK_PAYOUT',
          -request.amount,
          request.currency,
          'PENDING',
          `Bank payout to ${bankAccount.bank_name} ${bankAccount.account_number}`,
          reference,
          timestamp
        ]
      );

      // Generate wire transfer instructions
      const instructions = this.generateWireInstructions(
        reference,
        netAmount,
        request.currency,
        bankAccount
      );

      return {
        success: true,
        payout_id: payoutId,
        reference,
        amount: request.amount,
        net_amount: netAmount,
        fee,
        method: 'bank',
        status: 'PENDING',
        estimated_arrival: '1-3 business days (after wire transfer)',
        error: instructions
      };

    } catch (error: any) {
      return {
        success: false,
        payout_id: payoutId,
        reference,
        amount: request.amount,
        net_amount: netAmount,
        fee,
        method: 'bank',
        status: 'FAILED',
        error: error.message
      };
    }
  }

  /**
   * Generate wire transfer instructions
   */
  private generateWireInstructions(
    reference: string,
    amount: number,
    currency: string,
    bankAccount: any
  ): string {
    return `
WIRE TRANSFER REQUIRED

Reference: ${reference}
Amount: ${amount.toLocaleString('en-US', {minimumFractionDigits: 2})} ${currency}

Beneficiary: ${bankAccount.account_holder}
Bank: ${bankAccount.bank_name}
Account: ${bankAccount.account_number}
SWIFT: ${bankAccount.swift_code || 'N/A'}
Routing: ${bankAccount.routing_number || 'N/A'}

Please execute this wire transfer manually through your bank.
After completion, update payout status to COMPLETED with bank reference number.
    `.trim();
  }

  /**
   * Quick crypto payout (simplified API)
   */
  async payoutCrypto(
    customerId: string,
    amount: number,
    currency: string,
    cryptoAddress: string
  ): Promise<PayoutResult> {
    return this.processPayout({
      customer_id: customerId,
      amount,
      currency,
      method: 'crypto',
      destination: cryptoAddress
    });
  }

  /**
   * Quick bank payout (simplified API)
   */
  async payoutBank(
    customerId: string,
    amount: number,
    currency: string,
    bankAccountId: string
  ): Promise<PayoutResult> {
    return this.processPayout({
      customer_id: customerId,
      amount,
      currency,
      method: 'bank',
      destination: bankAccountId
    });
  }
}

export const payoutProcessorService = new PayoutProcessorService();
