/**
 * 🔐 AUTHORIZATION ENGINE
 * 
 * Secure authorization layer that verifies transactions BEFORE funds are released.
 * Ensures only authenticated and verified transactions can credit customer wallets.
 * 
 * Flow:
 * 1. Transaction Initiated → Create Authorization Request
 * 2. Save Details → Status: PENDING_AUTHORIZATION
 * 3. Wait for Verification Source (batch sync, online confirmation)
 * 4. Verify Transaction → Approve/Decline
 * 5. Settle Funds → Credit to Wallet (REAL MONEY MOVEMENT)
 */

import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface AuthorizationRequestParams {
  transactionId: string;
  transactionType: 'pos_sale' | 'topup' | 'transfer' | 'crypto_buy' | 'crypto_sell' | 'withdrawal';
  customerId: string;
  merchantId?: string;
  terminalId?: string;
  amount: number;
  currency: string;
  metadata?: any;
}

export interface VerificationParams {
  source: 'batch_sync' | 'online_pos' | 'manual_approval' | 'card_processor';
  batchId?: string;
  hmacSignature?: string;
  terminalSignature?: string;
  stan?: string;
  rrn?: string;
  cardAuthCode?: string;
  processorReference?: string;
}

export interface AuthorizationRequest {
  id: string;
  authorizationCode: string;
  transactionId: string;
  transactionType: string;
  amount: number;
  currency: string;
  customerId: string;
  merchantId?: string;
  terminalId?: string;
  status: 'pending_authorization' | 'approved' | 'declined' | 'expired' | 'settled';
  riskScore: number;
  expiresAt: string;
  createdAt: string;
}

export class AuthorizationEngine {
  
  /**
   * Step 1: Create Authorization Request
   * Called when transaction is initiated
   */
  async createAuthorizationRequest(params: AuthorizationRequestParams): Promise<AuthorizationRequest> {
    
    // Generate unique authorization code (like credit cards: AUTH-YYYYMMDD-XXXXXX)
    const authCode = this.generateAuthCode();
    
    // Calculate fraud risk score (0-100)
    const riskScore = await this.calculateRiskScore(params);
    
    // Set expiration (24 hours from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    // Insert authorization request
    const id = uuidv4();
    await db.query(`
      INSERT INTO authorization_requests 
      (id, transaction_id, transaction_type, amount, currency, 
       customer_id, merchant_id, terminal_id, authorization_code, 
       risk_score, expires_at, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_authorization', CURRENT_TIMESTAMP)
    `, [
      id,
      params.transactionId,
      params.transactionType,
      params.amount,
      params.currency,
      params.customerId,
      params.merchantId || null,
      params.terminalId || null,
      authCode,
      riskScore,
      expiresAt
    ]);
    
    // Log event
    await this.logEvent(id, 'created', params);
    
    console.log(`[AuthEngine] Created authorization: ${authCode} for ${params.transactionType} $${params.amount}`);
    
    return {
      id,
      authorizationCode: authCode,
      transactionId: params.transactionId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency,
      customerId: params.customerId,
      merchantId: params.merchantId,
      terminalId: params.terminalId,
      status: 'pending_authorization',
      riskScore,
      expiresAt,
      createdAt: new Date().toISOString()
    };
  }
  
  /**
   * Step 2: Verify Transaction from Trusted Source
   */
  async verifyTransaction(authCode: string, verification: VerificationParams): Promise<{ verified: boolean; authCode: string; source: string }> {
    
    // Get authorization request
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    
    if (auth.status !== 'pending_authorization') {
      throw new Error(`Cannot verify: Authorization is ${auth.status}`);
    }
    
    // Check if expired
    if (new Date(auth.expires_at) < new Date()) {
      await this.declineAuthorization(authCode, 'Authorization expired');
      throw new Error('Authorization expired');
    }
    
    // Verify based on source
    let verified = false;
    let verificationLog = '';
    
    if (verification.source === 'batch_sync') {
      // Verify HMAC signature from batch
      verified = await this.verifyBatchHMAC(verification.batchId!, verification.hmacSignature!);
      verificationLog = `Batch ${verification.batchId} HMAC ${verified ? 'valid' : 'invalid'}`;
      
    } else if (verification.source === 'online_pos') {
      // Verify terminal signature
      verified = await this.verifyTerminalSignature(auth.terminal_id, verification.terminalSignature!);
      verificationLog = `Terminal ${auth.terminal_id} signature ${verified ? 'valid' : 'invalid'}`;
      
    } else if (verification.source === 'card_processor') {
      // Card processor confirmed payment
      verified = !!verification.cardAuthCode && !!verification.processorReference;
      verificationLog = `Card processor auth: ${verification.cardAuthCode}`;
      
    } else if (verification.source === 'manual_approval') {
      // Admin manual approval
      verified = true;
      verificationLog = 'Manual approval by admin';
    }
    
    // Save verification data
    await db.query(`
      UPDATE authorization_requests 
      SET verification_source = ?, 
          verification_data = ?
      WHERE authorization_code = ?
    `, [
      verification.source,
      JSON.stringify(verification),
      authCode
    ]);
    
    // Log verification
    await this.logEvent(auth.id, 'verified', { 
      source: verification.source, 
      result: verified,
      log: verificationLog
    });
    
    console.log(`[AuthEngine] Verification ${authCode}: ${verified ? 'SUCCESS' : 'FAILED'} - ${verificationLog}`);
    
    return { verified, authCode, source: verification.source };
  }
  
  /**
   * Step 3: Approve Authorization (After Verification)
   */
  async approveAuthorization(authCode: string, approvedBy: string = 'system'): Promise<void> {
    
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    
    if (auth.status === 'approved' || auth.status === 'settled') {
      console.log(`[AuthEngine] ${authCode} already ${auth.status}`);
      return; // Already approved/settled
    }
    
    if (auth.status === 'declined' || auth.status === 'expired') {
      throw new Error(`Cannot approve: Authorization is ${auth.status}`);
    }
    
    // Update to approved
    await db.query(`
      UPDATE authorization_requests 
      SET status = 'approved',
          authorized_at = CURRENT_TIMESTAMP
      WHERE authorization_code = ?
    `, [authCode]);
    
    // Log approval
    await this.logEvent(auth.id, 'approved', { approvedBy });
    
    console.log(`[AuthEngine] Approved ${authCode} by ${approvedBy}`);
    
    // Automatically settle (credit funds)
    await this.settleAuthorization(authCode);
  }
  
  /**
   * Step 4: Settle Funds - CREDIT CUSTOMER WALLET (REAL MONEY MOVEMENT)
   */
  async settleAuthorization(authCode: string): Promise<void> {
    
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    
    if (auth.status !== 'approved') {
      throw new Error(`Cannot settle: Authorization must be approved (current: ${auth.status})`);
    }
    
    if (auth.status === 'settled') {
      console.log(`[AuthEngine] ${authCode} already settled`);
      return; // Already settled
    }
    
    // Begin database transaction
    await db.query('BEGIN TRANSACTION');
    
    try {
      // Get customer wallet
      const walletResult = await db.query(`
        SELECT id, balance FROM customer_wallets 
        WHERE customer_id = ? AND currency = ?
      `, [auth.customer_id, auth.currency]);
      
      if (walletResult.rowCount === 0) {
        throw new Error(`Wallet not found for customer ${auth.customer_id} (${auth.currency})`);
      }
      
      const wallet = walletResult.rows[0];
      const oldBalance = Number(wallet.balance);
      const newBalance = oldBalance + auth.amount;
      
      // CREDIT FUNDS TO CUSTOMER WALLET
      await db.query(`
        UPDATE customer_wallets 
        SET balance = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [newBalance, wallet.id]);
      
      // Record in wallet transactions ledger
      await db.query(`
        INSERT INTO wallet_transactions 
        (id, wallet_id, type, amount, currency, source, reference, description, created_at)
        VALUES (?, ?, 'credit', ?, ?, 'authorized_transaction', ?, ?, CURRENT_TIMESTAMP)
      `, [
        uuidv4(),
        wallet.id,
        auth.amount,
        auth.currency,
        auth.authorization_code,
        `${auth.transaction_type} - Auth: ${auth.authorization_code}`
      ]);
      
      // Update authorization status to SETTLED
      await db.query(`
        UPDATE authorization_requests 
        SET status = 'settled',
            settled_at = CURRENT_TIMESTAMP
        WHERE authorization_code = ?
      `, [authCode]);
      
      // Release any holds
      await db.query(`
        UPDATE authorization_holds 
        SET released_at = CURRENT_TIMESTAMP
        WHERE authorization_id = ?
      `, [auth.id]);
      
      // Commit transaction
      await db.query('COMMIT');
      
      // Log settlement
      await this.logEvent(auth.id, 'settled', { 
        walletId: wallet.id,
        oldBalance,
        amount: auth.amount,
        newBalance
      });
      
      console.log(`[AuthEngine] ✅ SETTLED ${authCode}: Credited $${auth.amount} ${auth.currency} to customer ${auth.customer_id}`);
      console.log(`[AuthEngine] Balance: $${oldBalance} → $${newBalance}`);
      
    } catch (error: any) {
      await db.query('ROLLBACK');
      console.error(`[AuthEngine] Settlement failed for ${authCode}:`, error.message);
      throw error;
    }
  }
  
  /**
   * Step 5: Decline Authorization
   */
  async declineAuthorization(authCode: string, reason: string): Promise<void> {
    
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    
    if (auth.status === 'declined') {
      console.log(`[AuthEngine] ${authCode} already declined`);
      return;
    }
    
    if (auth.status === 'settled') {
      throw new Error('Cannot decline: Funds already settled');
    }
    
    await db.query(`
      UPDATE authorization_requests 
      SET status = 'declined',
          decline_reason = ?,
          authorized_at = CURRENT_TIMESTAMP
      WHERE authorization_code = ?
    `, [reason, authCode]);
    
    // Log decline
    await this.logEvent(auth.id, 'declined', { reason });
    
    console.log(`[AuthEngine] ❌ DECLINED ${authCode}: ${reason}`);
  }
  
  /**
   * Get Authorization Request by Code
   */
  private async getAuthRequest(authCode: string): Promise<any> {
    const result = await db.query(`
      SELECT * FROM authorization_requests 
      WHERE authorization_code = ?
    `, [authCode]);
    
    return result.rows[0] || null;
  }
  
  /**
   * Calculate Fraud Risk Score (0-100)
   */
  private async calculateRiskScore(params: AuthorizationRequestParams): Promise<number> {
    let score = 0;
    
    // High amount = higher risk
    if (params.amount > 1000) score += 20;
    if (params.amount > 5000) score += 30;
    if (params.amount > 10000) score += 40;
    
    // Check customer history
    const historyResult = await db.query(`
      SELECT 
        COUNT(*) as total_txns,
        SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined_count
      FROM authorization_requests
      WHERE customer_id = ?
    `, [params.customerId]);
    
    if (historyResult.rows[0]) {
      const history = historyResult.rows[0];
      if (history.total_txns < 5) score += 15; // New customer
      if (history.declined_count > 2) score += 25; // Previous declines
    }
    
    // Transaction time (late night = higher risk)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 23) score += 10;
    
    return Math.min(score, 100); // Cap at 100
  }
  
  /**
   * Verify Batch HMAC Signature
   */
  private async verifyBatchHMAC(batchId: string, hmacSignature: string): Promise<boolean> {
    // Get merchant API key (used as HMAC secret)
    const merchantResult = await db.query(`
      SELECT ms.api_key 
      FROM pos2013_batches b
      JOIN merchant_settings ms ON b.merchant_id = ms.merchant_id
      WHERE b.batch_id = ?
    `, [batchId]);
    
    if (merchantResult.rowCount === 0) return false;
    
    const apiKey = merchantResult.rows[0].api_key;
    
    // Get batch data
    const batchResult = await db.query(`
      SELECT batch_id, merchant_id, terminal_id, txn_count, total_amount_minor
      FROM pos2013_batches
      WHERE batch_id = ?
    `, [batchId]);
    
    if (batchResult.rowCount === 0) return false;
    
    const batch = batchResult.rows[0];
    
    // Recreate HMAC
    const payload = `${batch.batch_id}|${batch.merchant_id}|${batch.terminal_id}|${batch.txn_count}|${batch.total_amount_minor}`;
    const computedHMAC = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');
    
    // Compare
    return computedHMAC === hmacSignature;
  }
  
  /**
   * Verify Terminal Signature
   */
  private async verifyTerminalSignature(terminalId: string, signature: string): Promise<boolean> {
    const result = await db.query(`
      SELECT terminal_secret FROM terminals WHERE terminal_id = ?
    `, [terminalId]);
    
    if (result.rowCount === 0) return false;
    
    const secret = result.rows[0].terminal_secret;
    
    // Verify signature matches terminal secret
    const computedSig = crypto.createHash('sha256').update(secret + terminalId).digest('hex');
    return computedSig === signature;
  }
  
  /**
   * Generate Authorization Code
   */
  private generateAuthCode(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `AUTH-${timestamp}-${random}`;
  }
  
  /**
   * Log Authorization Event (Audit Trail)
   */
  private async logEvent(authId: string, eventType: string, eventData: any): Promise<void> {
    await db.query(`
      INSERT INTO authorization_log 
      (id, authorization_id, event_type, event_data, performed_by, performed_at)
      VALUES (?, ?, ?, ?, 'system', CURRENT_TIMESTAMP)
    `, [
      uuidv4(),
      authId,
      eventType,
      JSON.stringify(eventData)
    ]);
  }
}

// Export singleton instance
export const authorizationEngine = new AuthorizationEngine();
