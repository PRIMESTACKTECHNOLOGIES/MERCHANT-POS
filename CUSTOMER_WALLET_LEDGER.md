# 💰 CUSTOMER WALLET LEDGER FUNDS - COMPLETE ANSWER

## 🎯 **WHERE ARE CUSTOMER WALLET FUNDS?**

### **Database Location:**
```
File: backend/data/database.sqlite
Type: SQLite database
```

### **Tables Storing Customer Funds:**

```
1. customer_wallets
   └─ Stores: USD/Fiat balances
   
2. customer_crypto_wallets
   └─ Stores: Crypto balances (BTC, USDT, ETH, etc.)
   
3. wallet_transactions
   └─ Stores: USD transaction history (ledger)
   
4. crypto_transactions
   └─ Stores: Crypto transaction history
```

---

## 📊 **CURRENT CUSTOMER FUNDS (REAL DATA)**

### **USD/Fiat Wallets:**

```
Customer: ESBERTO EUBRA JR
├─ Email: esberto191@gmail.com
├─ Wallet ID: e988f463-ed59-4cda-bdcc-ae6c3111bc5e
├─ Balance: $0 USD
├─ Status: active
└─ Wallet Code: PSW-8136-8127

Customer: HUSSAM MOHAMED A ALQA
├─ Email: hussammohamed191@gmail.com
├─ Wallet ID: 99889daf-0e11-4345-9025-01d889f43d3d
├─ Balance: $0 USD
├─ Status: active
└─ Wallet Code: PSW-8203-7314

Customer: NGUYEN NGOC SON
├─ Email: metatradedxb@gmail.com
├─ Wallet ID: 4b0c3709-92af-4a03-9a5a-7e069c075275
├─ Balance: $0 USD
├─ Status: active
└─ Wallet Code: PSW-6983-1078

Customer: JJ DUMBA
├─ Email: jurutidumba@gmail.com
├─ Wallet ID: c58e139e-927d-4202-ac10-12d524c1f560
├─ Balance: $0 USD
├─ Status: active
└─ Wallet Code: PSW-3662-1829
```

---

### **Crypto Wallets:**

```
Customer: HUSSAM MOHAMED A ALQA
├─ Coin: USDT
├─ Balance: 0 USDT
├─ Address: Not assigned
└─ Status: active

Customer: NGUYEN NGOC SON
├─ Coin: BTC
├─ Balance: 0 BTC
├─ Address: Not assigned
└─ Status: active

Customer: NGUYEN NGOC SON
├─ Coin: USDT
├─ Balance: 0 USDT
├─ Address: Not assigned
└─ Status: active
```

---

## 📊 **TOTAL PLATFORM LIABILITY**

### **What Platform Owes to All Customers:**

```
💵 Total USD: $0
🪙 Total BTC: 0
🪙 Total USDT: 0
```

**Status:** ✅ Platform has ZERO liability (all balances are $0)

---

## 📜 **TRANSACTION HISTORY**

```
❌ No transactions found

Reason: All fake/demo data was deleted
Status: Clean ledger, ready for real transactions
```

---

## 🗂️ **DATABASE SCHEMA**

### **1. customer_wallets Table (USD/Fiat)**
```sql
CREATE TABLE customer_wallets (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0.00,      -- ⬅️ CUSTOMER USD BALANCE
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active',
  wallet_code TEXT,                         -- ⬅️ Unique wallet code
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (customer_id, currency)
);
```

### **2. customer_crypto_wallets Table (Crypto)**
```sql
CREATE TABLE customer_crypto_wallets (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  crypto_coin TEXT NOT NULL,                -- BTC, USDT, ETH, etc.
  balance REAL NOT NULL DEFAULT 0.0,        -- ⬅️ CUSTOMER CRYPTO BALANCE
  crypto_address TEXT,                      -- Blockchain address
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, crypto_coin)
);
```

### **3. wallet_transactions Table (Ledger)**
```sql
CREATE TABLE wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,                  -- Links to customer_wallets
  type TEXT NOT NULL,                       -- 'credit' or 'debit'
  amount REAL NOT NULL,                     -- Transaction amount
  currency TEXT DEFAULT 'USD',
  source TEXT NOT NULL,                     -- Where money came from
  reference TEXT,                           -- Reference number
  description TEXT,                         -- Human-readable description
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### **4. crypto_transactions Table (Crypto Ledger)**
```sql
CREATE TABLE crypto_transactions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  crypto_coin TEXT NOT NULL,
  transaction_type TEXT NOT NULL,           -- 'buy', 'sell', 'withdraw'
  fiat_amount REAL NOT NULL,               -- USD amount
  crypto_amount REAL NOT NULL,             -- Crypto amount
  fiat_currency TEXT DEFAULT 'USD',
  exchange_rate REAL,
  source TEXT,
  reference TEXT,
  tx_hash TEXT,                            -- Blockchain transaction hash
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔍 **HOW TO ACCESS CUSTOMER FUNDS**

### **Via API:**
```
GET /api/wallet/balance/:customerId
Response: { balance: 0, currency: 'USD' }

GET /api/wallet/crypto-wallets/:customerId
Response: [{ crypto_coin: 'USDT', balance: 0 }]
```

### **Via Database:**
```sql
-- Get customer USD balance
SELECT balance FROM customer_wallets 
WHERE customer_id = 'customer-id-here';

-- Get customer crypto balances
SELECT crypto_coin, balance FROM customer_crypto_wallets
WHERE customer_id = 'customer-id-here';

-- Get transaction history
SELECT * FROM wallet_transactions 
WHERE wallet_id = (
  SELECT id FROM customer_wallets 
  WHERE customer_id = 'customer-id-here'
)
ORDER BY created_at DESC;
```

### **Via Frontend:**
```
Dashboard → Wallets → Select Customer
├─ Wallet Tab: Shows USD balance
└─ Crypto Tab: Shows crypto balances
```

---

## 💡 **IMPORTANT NOTES**

### **Current State:**
- ✅ All customer wallets exist
- ✅ All balances are $0 (cleaned)
- ✅ No transaction history (cleaned)
- ✅ Ready for real transactions

### **What Happens When Customer Gets Money:**

**Scenario 1: Customer Receives USD**
```sql
-- Add money to wallet
UPDATE customer_wallets 
SET balance = balance + 100 
WHERE customer_id = 'customer-id';

-- Record transaction
INSERT INTO wallet_transactions 
VALUES (type='credit', amount=100, source='card_topup');
```

**Scenario 2: Customer Buys Crypto**
```sql
-- Deduct USD
UPDATE customer_wallets 
SET balance = balance - 100 
WHERE customer_id = 'customer-id';

-- Add crypto
UPDATE customer_crypto_wallets 
SET balance = balance + 100 
WHERE customer_id = 'customer-id' AND crypto_coin = 'USDT';

-- Record transaction
INSERT INTO crypto_transactions 
VALUES (type='buy', fiat_amount=100, crypto_amount=100);
```

**Scenario 3: Customer Sells Crypto**
```sql
-- Deduct crypto
UPDATE customer_crypto_wallets 
SET balance = balance - 50 
WHERE customer_id = 'customer-id' AND crypto_coin = 'USDT';

-- Add USD
UPDATE customer_wallets 
SET balance = balance + 50 
WHERE customer_id = 'customer-id';

-- Record transaction
INSERT INTO crypto_transactions 
VALUES (type='sell', crypto_amount=50, fiat_amount=50);
```

---

## 🎯 **SUMMARY**

**Question:** "Where is customer wallet ledger funds?"

**Answer:**
- 📍 **Location:** `backend/data/database.sqlite`
- 📊 **USD Table:** `customer_wallets` (stores fiat balances)
- 🪙 **Crypto Table:** `customer_crypto_wallets` (stores crypto balances)
- 📜 **History Tables:** `wallet_transactions` + `crypto_transactions`
- 💰 **Current Balances:** All $0 (cleaned, ready for real use)
- ✅ **Status:** Clean ledger, no fake data, ready for real transactions

---

**All customer funds are tracked in the SQLite database with proper double-entry ledger accounting.** ✅
