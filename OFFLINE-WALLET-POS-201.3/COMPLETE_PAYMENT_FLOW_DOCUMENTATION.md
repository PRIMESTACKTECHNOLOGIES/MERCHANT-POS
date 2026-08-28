# 💳 COMPLETE PAYMENT FLOW DOCUMENTATION

## POS Offline Software - Money Flow Guide

**Created:** March 8, 2026  
**Version:** 1.0  
**Project:** POS OFFLINE SFTWR

---

## 🔄 FULL TRANSACTION LIFECYCLE

### STEP 1: CUSTOMER PAYMENT (POS App)

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  CUSTOMER    │────────→│ ANDROID POS  │────────→│   LOCAL      │
│              │         │     APP      │         │  STORAGE     │
│              │         │              │         │  (Room DB)   │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                        │
       │ 1. Swipe/Enter Card    │                        │
       │ 2. Enter Amount        │                        │
       │                        │                        │
       │         OFFLINE MODE (No WiFi)                  │
       │         ─────────────────────────               │
       │         • Generate STAN: 000042                 │
       │         • Mask PAN: ****1111    ────────────────→│
       │         • Store encrypted       │   pending_txn  │
       │         • Show: "Saved Offline" │   table        │
       │                        │                        │
       │         ONLINE MODE (WiFi ON)                   │
       │         ─────────────────────────               │
       │         POST /api/payment2013/batch ────────────→│
       │                        │         (then delete)  │
       │                        │                        │
```

### Step 1 Details:
- **STAN**: System Trace Audit Number (6-digit tracking code)
- **Masked PAN**: Card number hidden (e.g., ****1111)
- **Offline Storage**: Encrypted in Android Room SQLite database

---

## 💾 STEP 2: DATABASE STORAGE (Your Server)

### pos2013_transactions TABLE

| id | merchant_id | amount_minor | pan_masked | status | stan | created_at |
|----|-------------|--------------|------------|--------|------|------------|
| txn_001 | MRC-1001 | 10000 | ****1111 | PENDING_SYNC | 000042 | 2026-03-08 |
| txn_002 | MRC-1001 | 5050 | ****2222 | PENDING_SYNC | 000043 | 2026-03-08 |
| txn_003 | MRC-1001 | 2500 | ****3333 | SETTLED | 000044 | 2026-03-08 |

**Total Stored:** $175.50 (Pending Gateway Transfer)

### pos2013_batches TABLE

| batch_id | merchant_id | status | settlement_code | txn_count | total_amount |
|----------|-------------|--------|-----------------|-----------|--------------|
| batch_001 | MRC-1001 | UPLOADED | SETT-789123 | 3 | 17550 |
| batch_002 | MRC-1001 | SETTLED | SETT-456789 | 5 | 25000 |

### Database Schema Overview:

```sql
-- Main transaction table
CREATE TABLE pos2013_transactions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,  -- Amount in cents (10000 = $100.00)
  currency TEXT NOT NULL,
  pan_masked TEXT,                -- Masked card number (****1111)
  stan TEXT,                      -- 6-digit tracking code
  auth_code TEXT,
  status TEXT,                    -- PENDING_SYNC, SETTLED, FAILED
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Batch tracking table
CREATE TABLE pos2013_batches (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  status TEXT NOT NULL,           -- UPLOADED, SETTLED, CASHED_OUT
  settlement_code TEXT,           -- Reference from gateway
  txn_count INTEGER,
  batch_file TEXT,                -- JSON data
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🌐 STEP 3: PAYMENT GATEWAY TRANSFER

### Gateway Integration Flow:

```
┌──────────────┐         ┌──────────────────────┐
│   BACKEND    │────────→│   PAYMENT GATEWAY    │
│   (Node.js)  │         │  (Braintree/Stripe)  │
└──────────────┘         └──────────────────────┘
       │                          │
       │ POST /cashout/braintree  │
       │ {                        │
       │   "batches": [{          │
       │     "amount": 10000,     │
       │     "card": "411111...", │
       │     "txn_id": "txn_001"  │
       │   }]                     │
       │ }                        │
       │                          │
       │←─────────────────────────│
       │ Response:                │
       │ {                        │
       │   "synced": 3,           │
       │   "failed": 0,           │
       │   "gateway_txn_ids": [   │
       │     "bt_abc123",         │
       │     "bt_def456",         │
       │     "bt_ghi789"          │
       │   ]                      │
       │ }                        │
       │                          │
```

### Gateway Processing Steps:
1. **Receive** batch data from your backend
2. **Validate** card numbers and amounts
3. **Process** payments through card networks
4. **Move** funds to your merchant account
5. **Return** confirmation with gateway transaction IDs

---

## 🏦 STEP 4: CASHOUT TO BANK

### Settlement Timeline:

```
┌────────────────────┐         ┌────────────────────┐
│   PAYMENT GATEWAY  │────────→│   BANK ACCOUNT     │
│                    │         │                    │
└────────────────────┘         └────────────────────┘
         │                              │
         │ Automated Transfer           │
         │ T+2 Business Days            │
         │                              │
         │ Amount: $175.50              │
         │ Fees: -$5.27 (3%)            │
         │ Net: $170.23 ────────────────→│ Deposit: +$170.23
         │                              │ Reference: SETT-789123
```

### Bank Statement Entry:
```
Date: 2026-03-10
Description: BRAINTREE PAYOUT / SETT-789123
Amount: +$170.23
Reference: Batch batch_001, 3 transactions
```

---

## 📊 COMPLETE FLOW TABLE

| Step | Action | Location | Data | Status |
|------|--------|----------|------|--------|
| 1 | Customer pays $100 | POS App | Card: 411111..., Amount: $100 | `PENDING` |
| 2 | Store offline | Android Room DB | STAN: 000042, Encrypted | `STORED_LOCALLY` |
| 3 | Sync to server | Backend API | POST /api/payment2013/batch | `UPLOADING` |
| 4 | Save to database | SQLite | txn_001, ****1111, 10000 | `PENDING_SYNC` |
| 5 | Batch to Gateway | Braintree API | Batch ID: batch_001 | `PROCESSING` |
| 6 | Gateway processes | Braintree | txn bt_abc123 created | `PROCESSED` |
| 7 | Update database | SQLite | status = "SETTLED" | `SETTLED` |
| 8 | T+2 Settlement | Bank Transfer | $170.23 deposited | `PAID_OUT` |

---

## 💰 MONEY FLOW DIAGRAM

```
                    CUSTOMER
                       │
                       │ Pays $100
                       ▼
            ┌─────────────────────┐
            │  ANDROID POS APP    │
            │  • Card entered     │
            │  • Stored offline   │
            │  • Syncs when WiFi  │
            └──────────┬──────────┘
                       │ Uploads batch
                       ▼
            ┌─────────────────────┐      ┌─────────────────────┐
            │  YOUR DATABASE      │      │  DASHBOARD          │
            │  • Transactions     │◄────►│  • View transactions│
            │  • Batches          │      │  • Generate reports │
            │  • Settlement codes │      │  • Monitor status   │
            └──────────┬──────────┘      └─────────────────────┘
                       │ Cashout Button
                       ▼
            ┌─────────────────────┐
            │  PAYMENT GATEWAY    │
            │  (Braintree/Stripe) │
            │  • Process cards    │
            │  • Merchant account │
            │  • Hold funds       │
            └──────────┬──────────┘
                       │ T+2 Days settlement
                       ▼
            ┌─────────────────────┐
            │  YOUR BANK ACCOUNT  │
            │  • Net deposit      │
            │  • Minus fees (3%)  │
            │  • Available cash   │
            └─────────────────────┘
```

---

## 🔢 TRANSACTION STATE LIFECYCLE

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  ENTERED │───→│  STORED  │───→│ UPLOADED │───→│ SETTLED  │───→│  PAID    │
│   (POS)  │    │  (Local) │    │  (Server)│    │ (Gateway)│    │  (Bank)  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │               │
     ▼               ▼               ▼               ▼               ▼
  Card swiped    No WiFi:      Batch sent     Gateway        Bank deposit
  Amount set     Saved in       to backend    processed      confirmed
  STAN:000042    Room DB        HMAC signed   Ref: bt_xxx    $170.23 net
```

### Status Definitions:

| Status | Meaning | Location |
|--------|---------|----------|
| `PENDING` | Customer just entered data | POS App |
| `STORED_LOCALLY` | Saved on phone (offline) | Android Room DB |
| `PENDING_SYNC` | Uploaded to your server | Your SQLite DB |
| `UPLOADED` | Sent to payment gateway | Gateway processing |
| `SETTLED` | Gateway confirmed | Gateway account |
| `PAID_OUT` | Money in your bank | Bank account |

---

## 💸 FEE BREAKDOWN (Per $100 Transaction)

| Party | Fee Type | Amount | You Receive |
|-------|----------|--------|-------------|
| **Customer** | Pays | $100.00 | - |
| **Payment Gateway** | Processing (2.9% + $0.30) | -$3.20 | $96.80 |
| **Your Platform** | Service fee (optional) | $0.00 | $96.80 |
| **Bank Deposit** | Transfer fee | $0.00 | **$96.80** |

> **Note:** Actual fees vary by gateway provider:
> - Braintree: 2.9% + $0.30
> - Stripe: 2.9% + $0.30
> - PayPal: 2.9% + $0.30

---

## 🎯 WHO HOLDS THE MONEY WHEN?

| Stage | Money Location | Timeframe | Your Access |
|-------|---------------|-----------|-------------|
| Customer pays | POS App (offline) | Immediate | Not yet |
| Stored locally | Android Room DB | Until sync | Not yet |
| Uploaded to you | Your SQLite DB | After sync | Visible only |
| Sent to gateway | Payment Gateway | T+0 (instant) | Pending settlement |
| Settled | Gateway account | T+2 days | Available for payout |
| In your bank | Bank account | T+2 to T+3 | **Full access** |

---

## 🔧 API ENDPOINTS FOR THIS FLOW

### 1. Upload Batch (Android → Backend)
```http
POST http://192.168.1.160:3000/merchant/v1/api/payment2013/batch
Content-Type: application/json

{
  "protocolVersion": "201.3",
  "merchantId": "MRC-1001",
  "terminalId": "TERM001",
  "batchId": "batch-123456",
  "timestamp": "2026-03-08T10:30:00Z",
  "nonce": "random-string",
  "transactions": [
    {
      "amountMinor": 10000,
      "currency": "USD",
      "pan": "4111111111111111",
      "stan": "000042"
    }
  ],
  "signature": "hmac-sha256-signature"
}
```

### 2. Cashout to Gateway (Dashboard → Backend → Gateway)
```http
POST http://192.168.1.160:3000/merchant/v1/cashout/braintree
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "batches": [
    {
      "batchId": "batch-123456",
      "transactions": [...]
    }
  ]
}
```

---

## 📋 DATABASE QUICK REFERENCE

### Check Pending Transactions:
```sql
SELECT 
  id,
  pan_masked,
  amount_minor / 100.0 as amount,
  status,
  stan,
  created_at
FROM pos2013_transactions
WHERE status = 'PENDING_SYNC';
```

### Check Total Pending Amount:
```sql
SELECT 
  COUNT(*) as transaction_count,
  SUM(amount_minor) / 100.0 as total_pending
FROM pos2013_transactions
WHERE status = 'PENDING_SYNC';
```

### Check Settled Batches:
```sql
SELECT 
  batch_id,
  settlement_code,
  txn_count,
  status,
  created_at
FROM pos2013_batches
WHERE status = 'SETTLED'
ORDER BY created_at DESC;
```

---

## ✅ PRE-LAUNCH CHECKLIST

### Setup Phase:
- [ ] Backend running on port 3000
- [ ] Database initialized with tables
- [ ] Default merchant created (MRC-1001)
- [ ] API key generated (sk_test_default_key_123)
- [ ] Payment gateway account configured

### Android App:
- [ ] App configured with correct server IP
- [ ] App can connect to backend
- [ ] Offline mode tested
- [ ] Sync function working

### Dashboard:
- [ ] Can view transactions
- [ ] Can see pending batches
- [ ] Cashout button functional
- [ ] Receipts generating

### Gateway Integration:
- [ ] Braintree/Stripe credentials added
- [ ] Test transaction processed
- [ ] Webhook configured (optional)
- [ ] Settlement reporting working

---

## 🆘 TROUBLESHOOTING

### Problem: Transactions not syncing
**Check:**
1. Phone has WiFi connection
2. Backend server is running
3. Correct IP address in app config
4. API key is valid

### Problem: Gateway rejecting batches
**Check:**
1. Gateway credentials in settings
2. Test mode vs Live mode
3. Card numbers are valid format
4. Batch signature is correct

### Problem: No money in bank
**Check:**
1. T+2 days have passed
2. Gateway account has positive balance
3. Bank account linked correctly
4. No holds or freezes on account

---

## 📞 SUPPORT CONTACTS

| Component | File Location | Purpose |
|-----------|---------------|---------|
| Backend API | `backend/src/domain/batches/batches.controller.ts` | Batch processing |
| Android Sync | `android_pos_app/app/src/main/java/com/pos2013/offline/workers/SyncWorker.kt` | Background sync |
| Database | `backend/src/domain/setup/init_tables.ts` | Table schema |
| Gateway Config | `backend/src/domain/settings/settings.service.ts` | API credentials |

---

**Document Version:** 1.0  
**Last Updated:** March 8, 2026  
**Project:** POS Offline Software - Protocol 201.3

---

*Save this file for reference. All transaction flows, database schemas, and API endpoints documented above.*
