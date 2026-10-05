/**
 * 💰 PAYOUT ENGINE
 * 
 * Manages merchant payouts to bank accounts and crypto addresses.
 * NO AUTO TRANSFERS - All payouts require admin manual approval.
 * 
 * Flow:
 * 1. Merchant requests payout
 * 2. System creates payout record (PENDING_APPROVAL)
 * 3. Admin manually sends bank transfer / crypto
 * 4. Admin marks payout as COMPLETED
 * 5. System debits merchant ledger balance
 */

import { db } from '../../config/db';
import { ledgerService } from '../ledger/ledger.service';
import { v4 as uuidv4 } from 'uuid';

export interface PayoutRequest {
  merchantId: string;
  amount: number;
  currency: string;
  payoutMethod: 'bank' | 'usdt_tron' | 'usdt_bsc' | 'usdt_polygon';
  note?: string;
}

export interface PayoutRecord {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  destination: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  provider: string;
  reference: string;
  approvedBy?: string;
  approvedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export class PayoutEngine {
  
  /**
   * Request Merchant Bank Payout
   * Creates payout request (NO MONEY SENT YET - admin approves manually)
   */
  async requestBankPayout(request: PayoutRequest): Promise<PayoutRecord> {
    
    const { merchantId, amount, currency } = request;
    
    // Get merchant bank details
    const merchantSettings = await db.query(`
      SELECT 
        merchant_name,
        bank_name, 
        bank_account_holder, 
        bank_account_number, 
        bank_routing_number
      FROM merchant_settings
      WHERE merchant_id = ?
    `, [merchantId]);
    
    if (!merchantSettings.rows[0]?.bank_account_number) {
      throw new Error('Merchant bank account not configured. Please add bank details in Settings.');
    }
    
    const settings = merchantSettings.rows[0];
    
    // Check ledger balance
    const balance = await ledgerService.getSettledBalance(merchantId, currency);
    if (balance < amount) {
      throw new Error(`Insufficient balance: merchant has $${balance} ${currency}, requested $${amount}`);
    }
    
    // Create payout record (PENDING_APPROVAL)
    const payoutId = uuidv4();
    const reference = `PAYOUT-${Date.now()}`;
    
    const destination = {
      merchantName: settings.merchant_name,
      bankName: settings.bank_name,
      accountHolder: settings.bank_account_holder,
      accountNumber: settings.bank_account_number,
      routingNumber: settings.bank_routing_number,
      country: 'South Africa'
    };
    
    await db.query(`
      INSERT INTO merchant_payouts
      (id, merchant_id, amount, currency, destination, status, provider, reference, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', 'manual_bank', ?, CURRENT_TIMESTAMP)
    `, [
      payoutId,
      merchantId,
      amount,
      currency,
      JSON.stringify(destination),
      reference
    ]);
    
    console.log(`[PayoutEngine] 📋 Payout request created: ${reference} - $${amount} ${currency}`);
    console.log(`[PayoutEngine] Bank: ${settings.bank_name} - Account: ${settings.bank_account_number}`);
    console.log(`[PayoutEngine] Status: PENDING_APPROVAL (admin must manually send transfer)`);
    
    return {
      id: payoutId,
      merchantId,
      amount,
      currency,
      destination: JSON.stringify(destination),
      status: 'PENDING_APPROVAL',
      provider: 'manual_bank',
      reference,
      createdAt: new Date().toISOString()
    };
  }
  
  /**
   * Request Merchant Crypto Payout (USDT)
   */
  async requestCryptoPayout(request: PayoutRequest): Promise<PayoutRecord> {
    
    const { merchantId, amount, currency, payoutMethod } = request;
    
    if (currency !== 'USDT' && currency !== 'USD') {
      throw new Error('Crypto payouts only support USDT');
    }
    
    // Get merchant crypto address
    const merchantSettings = await db.query(`
      SELECT 
        merchant_name,
        usdt_address_tron,
        usdt_address_bsc,
        usdt_address_polygon
      FROM merchant_settings
      WHERE merchant_id = ?
    `, [merchantId]);
    
    if (!merchantSettings.rows[0]) {
      throw new Error('Merchant settings not found');
    }
    
    const settings = merchantSettings.rows[0];
    let cryptoAddress: string | null = null;
    let network: string = '';
    
    if (payoutMethod === 'usdt_tron') {
      cryptoAddress = settings.usdt_address_tron;
      network = 'TRON (TRC-20)';
    } else if (payoutMethod === 'usdt_bsc') {
      cryptoAddress = settings.usdt_address_bsc;
      network = 'BSC (BEP-20)';
    } else if (payoutMethod === 'usdt_polygon') {
      cryptoAddress = settings.usdt_address_polygon;
      network = 'Polygon (ERC-20)';
    }
    
    if (!cryptoAddress) {
      throw new Error(`${network} address not configured. Please add in Settings.`);
    }
    
    // Check ledger balance
    const balance = await ledgerService.getSettledBalance(merchantId, currency);
    if (balance < amount) {
      throw new Error(`Insufficient balance: merchant has $${balance} ${currency}, requested $${amount}`);
    }
    
    // Create payout record
    const payoutId = uuidv4();
    const reference = `USDT-${Date.now()}`;
    
    const destination = {
      merchantName: settings.merchant_name,
      cryptoAddress,
      network,
      coin: 'USDT'
    };
    
    await db.query(`
      INSERT INTO merchant_crypto_withdrawals
      (id, merchant_id, crypto_coin, amount, destination_address, network, status, reference, created_at)
      VALUES (?, ?, 'USDT', ?, ?, ?, 'PENDING_MERCHANT', ?, CURRENT_TIMESTAMP)
    `, [
      payoutId,
      merchantId,
      amount,
      cryptoAddress,
      network,
      reference
    ]);
    
    console.log(`[PayoutEngine] 📋 Crypto payout request: ${reference} - ${amount} USDT`);
    console.log(`[PayoutEngine] Network: ${network}`);
    console.log(`[PayoutEngine] Address: ${cryptoAddress}`);
    console.log(`[PayoutEngine] Status: PENDING_MERCHANT (merchant arranges own transfer)`);
    
    return {
      id: payoutId,
      merchantId,
      amount,
      currency: 'USDT',
      destination: JSON.stringify(destination),
      status: 'PENDING_APPROVAL',
      provider: `manual_crypto_${payoutMethod}`,
      reference,
      createdAt: new Date().toISOString()
    };
  }
  
  /**
   * Admin Approves Bank Payout
   * (Called AFTER admin manually sent bank transfer)
   */
  async approveBankPayout(
    payoutId: string,
    approvedBy: string,
    externalReference?: string,
    txProof?: string
  ): Promise<void> {
    
    // Get payout details
    const payout = await db.query(`
      SELECT * FROM merchant_payouts WHERE id = ?
    `, [payoutId]);
    
    if (!payout.rows[0]) {
      throw new Error('Payout not found');
    }
    
    const p = payout.rows[0];
    
    if (p.status !== 'PENDING_APPROVAL') {
      throw new Error(`Cannot approve: payout status is ${p.status}`);
    }
    
    // Update payout status
    await db.query(`
      UPDATE merchant_payouts
      SET status = 'COMPLETED',
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP,
          provider_reference = ?,
          completed_at = CURRENT_TIMESTAMP,
          meta = ?
      WHERE id = ?
    `, [
      approvedBy, 
      externalReference || 'manual_transfer', 
      txProof ? JSON.stringify({ txProof }) : null,
      payoutId
    ]);
    
    // Debit merchant ledger balance
    await ledgerService.debitMerchantBalance(
      p.merchant_id,
      Number(p.amount),
      p.currency,
      p.reference,
      `Bank payout approved by ${approvedBy} - ${externalReference || 'manual'}`
    );
    
    console.log(`[PayoutEngine] ✅ Payout APPROVED: ${p.reference}`);
    console.log(`[PayoutEngine] Amount: $${p.amount} ${p.currency}`);
    console.log(`[PayoutEngine] Approved by: ${approvedBy}`);
    console.log(`[PayoutEngine] External ref: ${externalReference || 'N/A'}`);
    console.log(`[PayoutEngine] Ledger debited: -$${p.amount}`);
  }
  
  /**
   * Admin Rejects Payout
   */
  async rejectPayout(
    payoutId: string,
    rejectedBy: string,
    reason: string
  ): Promise<void> {
    
    const payout = await db.query(`
      SELECT * FROM merchant_payouts WHERE id = ?
    `, [payoutId]);
    
    if (!payout.rows[0]) {
      throw new Error('Payout not found');
    }
    
    const p = payout.rows[0];
    
    if (p.status !== 'PENDING_APPROVAL') {
      throw new Error(`Cannot reject: payout status is ${p.status}`);
    }
    
    await db.query(`
      UPDATE merchant_payouts
      SET status = 'REJECTED',
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP,
          error_message = ?
      WHERE id = ?
    `, [rejectedBy, reason, payoutId]);
    
    console.log(`[PayoutEngine] ❌ Payout REJECTED: ${p.reference}`);
    console.log(`[PayoutEngine] Rejected by: ${rejectedBy}`);
    console.log(`[PayoutEngine] Reason: ${reason}`);
  }
  
  /**
   * Get All Pending Payouts (for admin approval)
   */
  async getPendingPayouts(): Promise<PayoutRecord[]> {
    
    const result = await db.query(`
      SELECT 
        id,
        merchant_id,
        amount,
        currency,
        destination,
        status,
        provider,
        reference,
        created_at
      FROM merchant_payouts
      WHERE status = 'PENDING_APPROVAL'
      ORDER BY created_at DESC
    `);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      merchantId: row.merchant_id,
      amount: Number(row.amount),
      currency: row.currency,
      destination: row.destination,
      status: row.status,
      provider: row.provider,
      reference: row.reference,
      createdAt: row.created_at
    }));
  }
  
  /**
   * Get Merchant Payout History
   */
  async getMerchantPayouts(merchantId: string, limit: number = 50): Promise<PayoutRecord[]> {
    
    const result = await db.query(`
      SELECT 
        id,
        merchant_id,
        amount,
        currency,
        destination,
        status,
        provider,
        reference,
        approved_by,
        approved_at,
        completed_at,
        created_at
      FROM merchant_payouts
      WHERE merchant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [merchantId, limit]);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      merchantId: row.merchant_id,
      amount: Number(row.amount),
      currency: row.currency,
      destination: row.destination,
      status: row.status,
      provider: row.provider,
      reference: row.reference,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      completedAt: row.completed_at,
      createdAt: row.created_at
    }));
  }
  
  /**
   * Get Merchant Available Balance (from ledger)
   */
  async getMerchantAvailableBalance(merchantId: string, currency: string = 'USD'): Promise<number> {
    return await ledgerService.getSettledBalance(merchantId, currency);
  }
}

// Export singleton instance
export const payoutEngine = new PayoutEngine();
