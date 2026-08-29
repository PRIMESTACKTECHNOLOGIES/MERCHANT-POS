# 🔐 AUTHORIZATION ENGINE - Complete Specification

## 🎯 **OBJECTIVE**
Create a secure authorization layer that verifies transactions BEFORE funds are released, ensuring only authenticated and verified transactions can credit customer wallets.

---

## 📋 **TRANSACTION FLOW**

### **Current Flow (BEFORE Authorization Engine):**
```
POS Transaction → Direct Database Update → Funds Credited ❌
Problem: No verification, no security, instant credit without validation
```

### **New Flow (WITH Authorization Engine):**
```
1. Transaction Initiated (POS/Dashboard)
   ↓
2. AUTHORIZATION ENGINE
   ├─ Save transaction details
   ├─ Status: PENDING_AUTHORIZATION
   ├─ Wait for verification source
   └─ Hold funds (not credited yet)
   ↓
3. Verification Process
   ├─ Offline transaction syncs
   ├─ Batch HMAC signature verified
   ├─ Terminal authentication checked
   ├─ Merchant credentials validated
   └─ Transaction amount matches
   ↓
4. Authorization Decision
   ├─ APPROVED → Credit funds to wallet
   ├─ DECLINED → Reject transaction
   └─ PENDING → Manual review required
   ↓
5. Settlement (Real Money Movement)
   ├─ Update customer wallet balance
   ├─ Record in ledger
   ├─ Status: SETTLED
   └─ Send notification to customer
```

---

## 🗂️ **DATABASE SCHEMA**

### **1. authorization_requests Table**
```sql
CREATE TABLE authorization_requests (
  id TEXT PRIMARY KEY,
  
  -- Transaction Info
  transaction_id TEXT UNIQUE NOT NULL,
  transaction_type TEXT NOT NULL,  -- 'pos_sale', 'topup', 'transfer', 'crypto_buy'
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  
  -- Source Info
  customer_id TEXT NOT NULL,
  merchant_id TEXT,
  terminal_id TEXT,
  
  -- Authorization Details
  status TEXT NOT NULL DEFAULT 'pending_authorization',  
  -- Status: pending_authorization, approved, declined, expired, settled
  
  authorization_code TEXT,         -- Generated auth code (like credit cards)
  verification_source TEXT,        -- 'batch_sync', 'online_pos', 'manual_approval'
  verification_data TEXT,          -- JSON: {batch_id, hmac, terminal_sig, etc}
  
  -- Security
  risk_score REAL DEFAULT 0.0,     -- 0-100 fraud risk score
  fraud_flags TEXT,                -- JSON array of fraud indicators
  
  -- Timestamps
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  authorized_at TEXT,
  settled_at TEXT,
  expires_at TEXT,                 -- Auto-decline after X hours
  
  -- Notes
  decline_reason TEXT,
  notes TEXT,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (merchant_id) REFERENCES merchant_settings(merchant_id),
  FOREIGN KEY (terminal_id) REFERENCES terminals(id)
);

CREATE INDEX idx_auth_status ON authorization_requests(status);
CREATE INDEX idx_auth_customer ON authorization_requests(customer_id);
CREATE INDEX idx_auth_transaction ON authorization_requests(transaction_id);
```

### **2. authorization_holds Table** (Funds on Hold)
```sql
CREATE TABLE authorization_holds (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  hold_type TEXT NOT NULL,         -- 'pending_settlement', 'fraud_review'
  released_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (authorization_id) REFERENCES authorization_requests(id),
  FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id)
);
```

### **3. authorization_log Table** (Audit Trail)
```sql
CREATE TABLE authorization_log (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL,
  event_type TEXT NOT NULL,        -- 'created', 'approved', 'declined', 'settled'
  event_data TEXT,                 -- JSON
  performed_by TEXT,               -- User/System who triggered event
  performed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (authorization_id) REFERENCES authorization_requests(id)
);
```

---

## 🔧 **AUTHORIZATION ENGINE COMPONENTS**

### **Component 1: Authorization Request Handler**
```typescript
class AuthorizationEngine {
  
  /**
   * Step 1: Create Authorization Request
   * Called when transaction is initiated (POS/Dashboard)
   */
  async createAuthorizationRequest(params: {
    transactionId: string;
    transactionType: 'pos_sale' | 'topup' | 'transfer' | 'crypto_buy';
    customerId: string;
    merchantId?: string;
    terminalId?: string;
    amount: number;
    currency: string;
    metadata?: any;
  }): Promise<AuthorizationRequest> {
    
    // Generate unique authorization code
    const authCode = this.generateAuthCode(); // e.g., "AUTH-20260825-123456"
    
    // Calculate risk score (fraud detection)
    const riskScore = await this.calculateRiskScore(params);
    
    // Set expiration (default: 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Save to database
    await db.query(`
      INSERT INTO authorization_requests 
      (id, transaction_id, transaction_type, amount, currency, 
       customer_id, merchant_id, terminal_id, authorization_code, 
       risk_score, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_authorization')
    `, [
      uuidv4(), params.transactionId, params.transactionType,
      params.amount, params.currency, params.customerId,
      params.merchantId, params.terminalId, authCode,
      riskScore, expiresAt.toISOString()
    ]);
    
    // Log event
    await this.logEvent(authCode, 'created', params);
    
    // Return authorization request
    return {
      authorizationCode: authCode,
      status: 'pending_authorization',
      amount: params.amount,
      expiresAt: expiresAt.toISOString()
    };
  }
  
  /**
   * Step 2: Verify Transaction from Source
   * Called when offline batch syncs or online POS confirms
   */
  async verifyTransaction(authCode: string, verification: {
    source: 'batch_sync' | 'online_pos' | 'manual_approval';
    batchId?: string;
    hmacSignature?: string;
    terminalSignature?: string;
    stan?: string;
    rrn?: string;
  }): Promise<VerificationResult> {
    
    // Get authorization request
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    if (auth.status !== 'pending_authorization') {
      throw new Error(`Cannot verify: Status is ${auth.status}`);
    }
    
    // Verify based on source
    let verified = false;
    
    if (verification.source === 'batch_sync') {
      // Verify HMAC signature from batch
      verified = await this.verifyBatchHMAC(
        verification.batchId, 
        verification.hmacSignature
      );
    } else if (verification.source === 'online_pos') {
      // Verify terminal signature
      verified = await this.verifyTerminalSignature(
        auth.terminalId,
        verification.terminalSignature
      );
    } else if (verification.source === 'manual_approval') {
      // Manual approval by admin
      verified = true; // Already approved by admin
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
    
    return { verified, authCode, source: verification.source };
  }
  
  /**
   * Step 3: Approve Authorization (After Verification)
   */
  async approveAuthorization(authCode: string, approvedBy?: string): Promise<void> {
    
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    
    // Check if already approved/settled
    if (auth.status === 'approved' || auth.status === 'settled') {
      throw new Error('Already approved');
    }
    
    // Check if expired
    if (new Date(auth.expires_at) < new Date()) {
      await this.declineAuthorization(authCode, 'Authorization expired');
      throw new Error('Authorization expired');
    }
    
    // Update status to approved
    await db.query(`
      UPDATE authorization_requests 
      SET status = 'approved',
          authorized_at = CURRENT_TIMESTAMP
      WHERE authorization_code = ?
    `, [authCode]);
    
    // Log approval
    await this.logEvent(authCode, 'approved', { approvedBy });
    
    // Trigger settlement (move funds)
    await this.settleAuthorization(authCode);
  }
  
  /**
   * Step 4: Settle Funds (Credit Customer Wallet)
   */
  async settleAuthorization(authCode: string): Promise<void> {
    
    const auth = await this.getAuthRequest(authCode);
    if (!auth) throw new Error('Authorization not found');
    if (auth.status !== 'approved') {
      throw new Error('Must be approved before settlement');
    }
    
    // Begin transaction
    await db.query('BEGIN TRANSACTION');
    
    try {
      // Get customer wallet
      const wallet = await db.query(`
        SELECT id, balance FROM customer_wallets 
        WHERE customer_id = ? AND currency = ?
      `, [auth.customer_id, auth.currency]);
      
      if (!wallet.rows[0]) throw new Error('Wallet not found');
      
      // Credit funds to customer wallet (REAL MONEY MOVEMENT)
      await db.query(`
        UPDATE customer_wallets 
        SET balance = balance + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [auth.amount, wallet.rows[0].id]);
      
      // Record in wallet transactions ledger
      await db.query(`
        INSERT INTO wallet_transactions 
        (id, wallet_id, type, amount, currency, source, reference, description)
        VALUES (?, ?, 'credit', ?, ?, 'authorized_transaction', ?, ?)
      `, [
        uuidv4(),
        wallet.rows[0].id,
        auth.amount,
        auth.currency,
        auth.authorization_code,
        `${auth.transaction_type} - Auth: ${auth.authorization_code}`
      ]);
      
      // Update authorization status
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
        WHERE authorization_id = (
          SELECT id FROM authorization_requests 
          WHERE authorization_code = ?
        )
      `, [authCode]);
      
      // Commit transaction
      await db.query('COMMIT');
      
      // Log settlement
      await this.logEvent(authCode, 'settled', { 
        walletId: wallet.rows[0].id,
        amount: auth.amount,
        newBalance: wallet.rows[0].balance + auth.amount
      });
      
      // Send notification to customer
      await this.notifyCustomer(auth.customer_id, {
        type: 'funds_credited',
        amount: auth.amount,
        authCode: authCode
      });
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
  
  /**
   * Step 5: Decline Authorization
   */
  async declineAuthorization(authCode: string, reason: string): Promise<void> {
    
    await db.query(`
      UPDATE authorization_requests 
      SET status = 'declined',
          decline_reason = ?,
          authorized_at = CURRENT_TIMESTAMP
      WHERE authorization_code = ?
    `, [reason, authCode]);
    
    // Log decline
    await this.logEvent(authCode, 'declined', { reason });
    
    // Notify customer
    const auth = await this.getAuthRequest(authCode);
    await this.notifyCustomer(auth.customer_id, {
      type: 'transaction_declined',
      reason: reason,
      authCode: authCode
    });
  }
  
  /**
   * Helper: Calculate Fraud Risk Score
   */
  private async calculateRiskScore(params: any): Promise<number> {
    let score = 0;
    
    // Check transaction amount (high amounts = higher risk)
    if (params.amount > 1000) score += 20;
    if (params.amount > 5000) score += 30;
    
    // Check customer history
    const customerHistory = await this.getCustomerHistory(params.customerId);
    if (customerHistory.totalTransactions < 5) score += 15; // New customer
    if (customerHistory.declinedCount > 2) score += 25; // Previous declines
    
    // Check terminal history (if POS)
    if (params.terminalId) {
      const terminalHistory = await this.getTerminalHistory(params.terminalId);
      if (terminalHistory.suspiciousActivity) score += 30;
    }
    
    // Check time of transaction
    const hour = new Date().getHours();
    if (hour < 6 || hour > 23) score += 10; // Late night = higher risk
    
    return Math.min(score, 100); // Cap at 100
  }
  
  /**
   * Helper: Generate Authorization Code
   */
  private generateAuthCode(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `AUTH-${timestamp}-${random}`;
  }
}
```

---

## 🔄 **INTEGRATION EXAMPLES**

### **Example 1: POS Offline Transaction**

```typescript
// Step 1: POS initiates transaction (offline)
const posTransaction = {
  stan: '000123',
  amount: 50.00,
  merchantId: 'MRC-1001',
  terminalId: 'TERM-01',
  customerId: 'cust_001',
  timestamp: Date.now()
};

// Step 2: Create authorization request
const auth = await authEngine.createAuthorizationRequest({
  transactionId: posTransaction.stan,
  transactionType: 'pos_sale',
  customerId: posTransaction.customerId,
  merchantId: posTransaction.merchantId,
  terminalId: posTransaction.terminalId,
  amount: posTransaction.amount,
  currency: 'USD'
});

console.log(`Authorization created: ${auth.authorizationCode}`);
console.log(`Status: ${auth.status}`); // pending_authorization
console.log(`Funds NOT credited yet - waiting for verification`);

// Step 3: Later, batch syncs with HMAC signature
const batchSync = {
  batchId: 'BATCH-001',
  hmacSignature: 'abc123...',
  transactions: [posTransaction]
};

// Step 4: Verify transaction from batch
const verification = await authEngine.verifyTransaction(
  auth.authorizationCode,
  {
    source: 'batch_sync',
    batchId: batchSync.batchId,
    hmacSignature: batchSync.hmacSignature
  }
);

if (verification.verified) {
  // Step 5: Approve and settle
  await authEngine.approveAuthorization(auth.authorizationCode);
  console.log('Funds credited to customer wallet!');
}
```

### **Example 2: Online Card Top-Up**

```typescript
// Step 1: Customer initiates top-up
const topup = {
  customerId: 'cust_001',
  amount: 100.00,
  cardNumber: '4111********1111'
};

// Step 2: Create authorization
const auth = await authEngine.createAuthorizationRequest({
  transactionId: `TOPUP-${Date.now()}`,
  transactionType: 'topup',
  customerId: topup.customerId,
  amount: topup.amount,
  currency: 'USD'
});

// Step 3: Process card payment
const paymentResult = await cardProcessor.charge({
  amount: topup.amount,
  card: topup.cardNumber
});

// Step 4: Verify payment success
if (paymentResult.success) {
  await authEngine.verifyTransaction(auth.authorizationCode, {
    source: 'online_pos',
    terminalSignature: paymentResult.authCode
  });
  
  // Step 5: Approve and credit funds
  await authEngine.approveAuthorization(auth.authorizationCode);
  console.log(`$${topup.amount} credited to customer wallet`);
}
```

---

## 📊 **DASHBOARD FEATURES**

### **Authorization Dashboard UI**
```
Authorization Engine Dashboard
├─ Pending Authorizations (awaiting verification)
├─ Recent Approvals (last 24 hours)
├─ Declined Transactions (fraud/errors)
├─ Manual Review Queue (high risk)
└─ Settlement Report (funds credited today)
```

### **Admin Actions**
```
1. View Authorization Details
2. Manually Approve (emergency override)
3. Decline with Reason
4. Add to Fraud Review
5. Release Holds
6. View Audit Trail
```

---

## 🎯 **BENEFITS**

✅ **Security**: Funds only credited after verification  
✅ **Fraud Prevention**: Risk scoring prevents suspicious transactions  
✅ **Audit Trail**: Complete log of every authorization decision  
✅ **Compliance**: Meets payment processing regulations  
✅ **Flexibility**: Works with online and offline transactions  
✅ **Real Money**: Treats digital funds like real fiat currency  

---

## 📋 **NEXT STEPS**

1. ✅ Review this specification
2. Create database tables for authorization engine
3. Implement AuthorizationEngine class in backend
4. Update POS flow to use authorization
5. Create authorization dashboard UI
6. Test with real transactions
7. Deploy to production

---

**This creates a professional-grade payment authorization system like Visa/Mastercard use.** 🏦✅
