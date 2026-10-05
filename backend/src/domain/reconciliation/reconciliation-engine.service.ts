/**
 * 🔍 RECONCILIATION ENGINE
 * 
 * Matches internal payout records against external confirmation.
 * Ensures payouts actually completed and flags discrepancies.
 * 
 * Functions:
 * 1. Reconcile crypto payouts (check blockchain)
 * 2. Reconcile bank payouts (manual verification)
 * 3. Generate reconciliation reports
 */

import { db } from '../../config/db';
import axios from 'axios';

export interface ReconciliationResult {
  totalChecked: number;
  matched: number;
  unmatched: number;
  failed: number;
  details: Array<{
    payoutId: string;
    reference: string;
    status: 'matched' | 'unmatched' | 'failed';
    note: string;
  }>;
}

export class ReconciliationEngine {
  
  /**
   * Reconcile Crypto Payouts (Check TRON blockchain)
   */
  async reconcileCryptoPayouts(date: string): Promise<ReconciliationResult> {
    
    console.log(`[Reconciliation] 🔍 Checking crypto payouts for ${date}...`);
    
    // Get crypto payouts for the date
    const payouts = await db.query(`
      SELECT * FROM merchant_crypto_withdrawals
      WHERE DATE(created_at) = ?
        AND status IN ('BROADCASTED', 'PENDING_CONFIRMATION', 'PENDING_MERCHANT')
    `, [date]);
    
    const result: ReconciliationResult = {
      totalChecked: payouts.rows.length,
      matched: 0,
      unmatched: 0,
      failed: 0,
      details: []
    };
    
    for (const payout of payouts.rows) {
      
      // If no tx_id, mark as pending merchant action
      if (!payout.tx_id) {
        await db.query(`
          UPDATE merchant_crypto_withdrawals
          SET reconciliation_status = 'PENDING_MERCHANT_ACTION',
              reconciliation_note = 'No transaction ID - merchant needs to send crypto'
          WHERE id = ?
        `, [payout.id]);
        
        result.unmatched++;
        result.details.push({
          payoutId: payout.id,
          reference: payout.reference,
          status: 'unmatched',
          note: 'No TX ID - pending merchant action'
        });
        
        console.log(`[Reconciliation] ⚠️ ${payout.reference}: No TX ID`);
        continue;
      }
      
      // Check TRON blockchain
      if (payout.network === 'TRON (TRC-20)' || payout.network === 'tron') {
        try {
          const response = await axios.get(
            `https://api.trongrid.io/v1/transactions/${payout.tx_id}`,
            {
              headers: {
                'TRON-PRO-API-KEY': process.env.TRON_API_KEY || ''
              },
              timeout: 10000
            }
          );
          
          const tx = response.data;
          
          // Check if transaction is successful
          if (tx.ret && tx.ret[0]?.contractRet === 'SUCCESS') {
            // Transaction confirmed on blockchain
            await db.query(`
              UPDATE merchant_crypto_withdrawals
              SET status = 'COMPLETED',
                  confirmed_at = CURRENT_TIMESTAMP,
                  reconciliation_status = 'MATCHED'
              WHERE id = ?
            `, [payout.id]);
            
            result.matched++;
            result.details.push({
              payoutId: payout.id,
              reference: payout.reference,
              status: 'matched',
              note: `Confirmed on TRON: ${payout.tx_id}`
            });
            
            console.log(`[Reconciliation] ✅ ${payout.reference}: Confirmed on blockchain`);
            
          } else {
            // Transaction failed on blockchain
            await db.query(`
              UPDATE merchant_crypto_withdrawals
              SET status = 'FAILED',
                  reconciliation_status = 'FAILED',
                  error_message = ?
              WHERE id = ?
            `, [JSON.stringify(tx.ret), payout.id]);
            
            result.failed++;
            result.details.push({
              payoutId: payout.id,
              reference: payout.reference,
              status: 'failed',
              note: `Blockchain failure: ${JSON.stringify(tx.ret)}`
            });
            
            console.log(`[Reconciliation] ❌ ${payout.reference}: Failed on blockchain`);
          }
          
        } catch (error: any) {
          // Transaction not found or API error
          await db.query(`
            UPDATE merchant_crypto_withdrawals
            SET reconciliation_status = 'UNMATCHED',
                reconciliation_note = ?
            WHERE id = ?
          `, [`TX not found: ${error.message}`, payout.id]);
          
          result.unmatched++;
          result.details.push({
            payoutId: payout.id,
            reference: payout.reference,
            status: 'unmatched',
            note: `TX not found: ${error.message}`
          });
          
          console.log(`[Reconciliation] ⚠️ ${payout.reference}: TX not found on blockchain`);
        }
      } else {
        // Other networks (BSC, Polygon) - mark for manual verification
        await db.query(`
          UPDATE merchant_crypto_withdrawals
          SET reconciliation_status = 'PENDING_MANUAL_VERIFICATION'
          WHERE id = ?
        `, [payout.id]);
        
        result.unmatched++;
        result.details.push({
          payoutId: payout.id,
          reference: payout.reference,
          status: 'unmatched',
          note: `Network ${payout.network} - manual check required`
        });
      }
    }
    
    console.log(`[Reconciliation] 📊 Crypto payouts: ${result.matched} matched, ${result.unmatched} unmatched, ${result.failed} failed`);
    
    return result;
  }
  
  /**
   * Reconcile Bank Payouts (Manual verification markers)
   */
  async reconcileBankPayouts(date: string): Promise<ReconciliationResult> {
    
    console.log(`[Reconciliation] 🔍 Checking bank payouts for ${date}...`);
    
    // Get bank payouts for the date
    const payouts = await db.query(`
      SELECT * FROM merchant_payouts
      WHERE DATE(created_at) = ?
        AND status = 'COMPLETED'
        AND (reconciliation_status IS NULL OR reconciliation_status = 'PENDING_VERIFICATION')
    `, [date]);
    
    const result: ReconciliationResult = {
      totalChecked: payouts.rows.length,
      matched: 0,
      unmatched: 0,
      failed: 0,
      details: []
    };
    
    for (const payout of payouts.rows) {
      
      // Mark as pending manual reconciliation
      await db.query(`
        UPDATE merchant_payouts
        SET reconciliation_status = 'PENDING_VERIFICATION',
            reconciliation_note = 'Bank transfer completed - verify receipt with merchant'
        WHERE id = ?
      `, [payout.id]);
      
      result.unmatched++;
      result.details.push({
        payoutId: payout.id,
        reference: payout.reference,
        status: 'unmatched',
        note: 'Pending manual verification with merchant'
      });
      
      console.log(`[Reconciliation] 📋 ${payout.reference}: Needs manual verification`);
    }
    
    console.log(`[Reconciliation] 📊 Bank payouts: ${result.unmatched} pending verification`);
    
    return result;
  }
  
  /**
   * Admin Manually Confirms Bank Payout Receipt
   */
  async confirmBankPayoutReceipt(
    payoutId: string,
    confirmedBy: string,
    merchantConfirmation: string
  ): Promise<void> {
    
    await db.query(`
      UPDATE merchant_payouts
      SET reconciliation_status = 'MATCHED',
          reconciliation_note = ?,
          meta = ?
      WHERE id = ?
    `, [
      `Confirmed by ${confirmedBy}: ${merchantConfirmation}`,
      JSON.stringify({ confirmedBy, merchantConfirmation, confirmedAt: new Date().toISOString() }),
      payoutId
    ]);
    
    console.log(`[Reconciliation] ✅ Bank payout confirmed: ${payoutId}`);
    console.log(`[Reconciliation] Confirmed by: ${confirmedBy}`);
    console.log(`[Reconciliation] Merchant confirmation: ${merchantConfirmation}`);
  }
  
  /**
   * Flag Discrepancy for Investigation
   */
  async flagDiscrepancy(
    payoutId: string,
    discrepancyType: 'amount_mismatch' | 'not_received' | 'wrong_account' | 'other',
    details: string
  ): Promise<void> {
    
    const payout = await db.query(`
      SELECT * FROM merchant_payouts WHERE id = ?
    `, [payoutId]);
    
    if (!payout.rows[0]) {
      throw new Error('Payout not found');
    }
    
    const p = payout.rows[0];
    
    // Create discrepancy record
    await db.query(`
      INSERT INTO settlement_discrepancies
      (id, merchant_id, provider_ref, local_settlement_id, amount, currency, discrepancy_type, status, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved', ?, CURRENT_TIMESTAMP)
    `, [
      `DISC-${Date.now()}`,
      p.merchant_id,
      p.provider_reference,
      payoutId,
      p.amount,
      p.currency,
      discrepancyType,
      details
    ]);
    
    // Update payout status
    await db.query(`
      UPDATE merchant_payouts
      SET reconciliation_status = 'DISCREPANCY',
          reconciliation_note = ?
      WHERE id = ?
    `, [`Discrepancy flagged: ${discrepancyType} - ${details}`, payoutId]);
    
    console.log(`[Reconciliation] 🚨 Discrepancy flagged: ${p.reference}`);
    console.log(`[Reconciliation] Type: ${discrepancyType}`);
    console.log(`[Reconciliation] Details: ${details}`);
  }
  
  /**
   * Get Reconciliation Summary for Date Range
   */
  async getReconciliationSummary(startDate: string, endDate: string): Promise<any> {
    
    const bankPayouts = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reconciliation_status = 'MATCHED' THEN 1 ELSE 0 END) as matched,
        SUM(CASE WHEN reconciliation_status = 'PENDING_VERIFICATION' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN reconciliation_status = 'DISCREPANCY' THEN 1 ELSE 0 END) as discrepancies,
        SUM(amount) as total_amount
      FROM merchant_payouts
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
    `, [startDate, endDate]);
    
    const cryptoPayouts = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reconciliation_status = 'MATCHED' THEN 1 ELSE 0 END) as matched,
        SUM(CASE WHEN reconciliation_status = 'UNMATCHED' THEN 1 ELSE 0 END) as unmatched,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(amount) as total_amount
      FROM merchant_crypto_withdrawals
      WHERE DATE(created_at) BETWEEN ? AND ?
    `, [startDate, endDate]);
    
    return {
      period: { startDate, endDate },
      bankPayouts: {
        total: bankPayouts.rows[0]?.total || 0,
        matched: bankPayouts.rows[0]?.matched || 0,
        pending: bankPayouts.rows[0]?.pending || 0,
        discrepancies: bankPayouts.rows[0]?.discrepancies || 0,
        totalAmount: Number(bankPayouts.rows[0]?.total_amount || 0)
      },
      cryptoPayouts: {
        total: cryptoPayouts.rows[0]?.total || 0,
        matched: cryptoPayouts.rows[0]?.matched || 0,
        unmatched: cryptoPayouts.rows[0]?.unmatched || 0,
        failed: cryptoPayouts.rows[0]?.failed || 0,
        totalAmount: Number(cryptoPayouts.rows[0]?.total_amount || 0)
      }
    };
  }
}

// Export singleton instance
export const reconciliationEngine = new ReconciliationEngine();
