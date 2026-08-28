# Payment Collection Flow - Manual Card Entry

## 🔄 Where Do Manual Card Payments Go?

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  Customer   │────▶│  POS App     │────▶│   Backend    │────▶│   Your       │
│  Pays with  │     │  (SQLite)    │     │  (Render)    │     │   Bank       │
│  Card       │     │              │     │              │     │   Account    │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
                           │                    │
                           │                    ▼
                           │              ┌──────────────┐
                           │              │  Dashboard   │
                           │              │  / Reports   │
                           │              └──────────────┘
                           ▼
                    ┌──────────────┐
                    │ Offline Mode │
                    │ (Auto-sync   │
                    │  when online)│
                    └──────────────┘
```

---

## 📋 Step-by-Step Flow

### Step 1: Manual Card Entry (In App)
```
Merchant enters: Card Number + Expiry + Amount
         ↓
App generates: Transaction ID + STAN + Timestamp
         ↓
Stores in: SQLite Database (syncStatus: PENDING)
```

### Step 2: Sync to Backend
```
When internet available:
         ↓
App sends to: https://pos-offline-sftwr.onrender.com
         ↓
Endpoint: POST /merchant/v1/pos/201.3/offline-batch
         ↓
Backend processes batch → Returns settlement code
```

### Step 3: Backend Processing
```
Backend receives transaction data:
- Card details (encrypted)
- Amount
- Transaction ID
- Merchant credentials
         ↓
Backend sends to payment processor
         ↓
Funds deposited to YOUR merchant account
```

### Step 4: Settlement
```
You receive:
✓ Settlement code (unique per batch)
✓ Transaction reference
✓ Confirmation in app Dashboard
         ↓
Funds available in your bank account
(Typically T+1 or T+2 settlement)
```

---

## 💰 How You Collect Payments

### Option 1: Automated Settlement (Recommended)
**What happens:**
- Customer pays with card
- Transaction syncs to backend
- Backend processes through payment gateway
- Funds auto-deposited to your linked bank account

**You need:**
- Merchant account with payment processor
- Backend configured with your MID (Merchant ID)
- Settlement account linked

### Option 2: Manual Review & Batch
**What happens:**
- Transactions stored in app
- You review in Dashboard
- Sync when ready
- Backend processes as batch

**Good for:**
- End-of-day settlement
- Review before processing
- Offline operations

### Option 3: MyFatoorah Integration
**What happens:**
- App generates payment link
- Link sent to customer (WhatsApp/SMS)
- Customer pays online
- Webhook updates transaction status

**Good for:**
- Remote payments
- No card present
- Invoice-based payments

---

## 🏦 Backend Requirements

### Current Setup
```
Backend URL: https://pos-offline-sftwr.onrender.com
Database: PostgreSQL (on Render)
Storage: All transactions stored
```

### To Collect Real Money, You Need:

| Component | Current | Required |
|-----------|---------|----------|
| Backend API | ✅ Working | ✅ Working |
| Database | ✅ SQLite + PostgreSQL | ✅ Working |
| **Payment Gateway** | ❌ Not connected | ✅ Connect Stripe/Adyen/etc |
| **Merchant Account** | ❌ Not set up | ✅ Need MID from bank |
| **Settlement Config** | ❌ Default | ✅ Configure your bank |

---

## 🔌 Connecting to Payment Gateway

### Option A: MyFatoorah (Already Integrated)
```dart
// In app Settings:
- Enable MyFatoorah Test Mode
- Enter API Token
- Create payment link instead of manual entry
```
**Result:** Customer pays via link → You collect via MyFatoorah dashboard

### Option B: Stripe / Adyen / Other
**Backend changes needed:**
```typescript
// backend/src/domain/payment/payment.service.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async processCardPayment(cardData, amount) {
  // Create payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: 'aed',
    payment_method_data: {
      card: {
        number: cardData.number,
        exp_month: cardData.expMonth,
        exp_year: cardData.expYear,
      },
    },
    confirm: true,
  });
  
  return paymentIntent;
}
```

### Option C: Direct Bank Integration
- Contact your bank for POS API
- Integrate bank's payment SDK
- Transactions go directly to your account

---

## 📊 Tracking Payments

### In App (Dashboard Screen)
```
┌─────────────────────────────┐
│ 📊 Transaction Stats         │
├─────────────────────────────┤
│ Total:        150           │
│ Synced:       145           │
│ Pending:      5             │
│ Failed:       0             │
└─────────────────────────────┘
```

### Settlement Codes
Each batch sync returns a **settlement code**:
```
Format: SETT-XXXXXX
Example: SETT-A7B2C9
```
**Use this code to:**
- Reconcile with bank statement
- Track batch in backend
- Generate reports

---

## 🔐 Security Note

**Current encryption in app:**
- Card data encrypted with AES-GCM before storage
- Only last 4 digits stored in plaintext
- Encrypted data sent to backend

**⚠️ IMPORTANT:**
For production, you need:
- ✅ PCI DSS compliance
- ✅ Tokenization (don't store raw card data)
- ✅ HTTPS/TLS for all communications
- ✅ Secure key management

---

## ✅ Summary

| Question | Answer |
|----------|--------|
| Where do payments go? | SQLite → Backend → Payment Gateway → Your Bank |
| How do I collect? | Settlement to your linked bank account |
| When do I get money? | T+1 or T+2 (depends on gateway) |
| What do I need? | Payment gateway account + Merchant ID |
| Is MyFatoorah ready? | ✅ Yes, just add token in Settings |

---

## 🚀 Next Steps to Go Live

1. **Choose payment gateway** (MyFatoorah, Stripe, etc.)
2. **Create merchant account** with gateway
3. **Configure backend** with gateway credentials
4. **Test in sandbox** mode
5. **Go live** with production credentials
6. **Link settlement account** (your bank)
7. **Start collecting real payments** 💰
