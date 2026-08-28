# 🚀 How to Use the New Secure Dashboard POS

## ✅ What's New

The dashboard now has **TWO** POS terminals:

| Terminal | Purpose | Security | Use For |
|----------|---------|----------|---------|
| **POS Terminal (Legacy)** | Old version | Basic | Testing only |
| **POS Terminal (Secure)** ✅ | New version | Full HMAC | Production |

---

## 🎯 Quick Start

### Step 1: Start Everything

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Dashboard
cd client
npm run dev
```

### Step 2: Open Dashboard

1. Open browser: http://localhost:5173
2. Login: `admin` / `admin123`
3. Look for **"POS Terminal (Secure)"** in sidebar
4. Click it

---

## 💳 How to Process a Payment

### 1. Enter Amount
```
Click number pad buttons:
[2] [5] [.] [0] [0]

Display shows: $25.00
```

### 2. Click "Charge"

### 3. Enter Card Details
```
Card Number: 4111111111111111
Expiry: 12/25
CVV: 123
```

### 4. Click "Pay $25.00"

### 5. See Receipt
```
✓ Payment Successful!

Amount: $25.00
Card: ****1111
STAN: 000042
Settlement: 789123 ← This is important!
Time: 2:30 PM

[Close] [Print Receipt]
```

---

## 📊 What's Different (Secure vs Legacy)

### Secure POS Has:

| Feature | Secure | Legacy |
|---------|--------|--------|
| **HMAC Signature** | ✅ Yes | ❌ No |
| **localTxnId** | ✅ Yes | ❌ No |
| **Settlement Code** | ✅ Yes | ❌ No |
| **Transaction History** | ✅ Sidebar | ❌ None |
| **Card Validation** | ✅ Full | ⚠️ Basic |
| **Receipt Modal** | ✅ Yes | ❌ Toast only |
| **Print Receipt** | ✅ Yes | ❌ No |
| **Merchant Config** | ✅ From API | ❌ Hardcoded |

---

## 🔐 Security Features Explained

### HMAC Signature
```
Every payment gets a cryptographic signature:

Payload: "201.3|MRC-1001|WEB-TERM|batch_xxx|123456|nonce|1"
         ↓
HMAC-SHA256 + Secret Key
         ↓
Signature: "a3f7b2..."

Backend verifies signature before processing.
```

### localTxnId (Duplicate Prevention)
```
Every transaction gets unique ID:
localTxnId: "txn_1709836800000_abc123"

If same ID sent twice → Backend rejects duplicate
```

### Settlement Code
```
Backend returns 6-digit code:
Settlement: 789123

This is proof of payment for receipts.
```

---

## 📋 Transaction History Sidebar

The right side shows all today's transactions:

```
┌─────────────────────────┐
│ Today's Transactions    │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ $25.00  ****1111   │ │
│ │ STAN: 000042       │ │
│ │ ✅ SYNCED          │ │
│ │ Settlement: 789123 │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ $50.00  ****2222   │ │
│ │ STAN: 000043       │ │
│ │ ❌ FAILED          │ │
│ │ Network error      │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

**Colors:**
- 🟢 Green = SYNCED (successful)
- 🔴 Red = FAILED (error)
- 🟡 Yellow = PENDING (offline)

---

## 🖨️ Printing Receipts

### Option 1: Print Button
```
1. Complete payment
2. Receipt modal appears
3. Click "Print Receipt"
4. Browser print dialog opens
5. Select printer
6. Print
```

### Option 2: Reprint Later
```
Not implemented yet - but transaction history shows all details
```

---

## ⚠️ Error Messages

### Card Validation Errors:
```
❌ "Card number must be 13-19 digits"
❌ "Expiry must be in MM/YY format"
❌ "Card has expired"
❌ "CVV must be at least 3 digits"
```

### Payment Errors:
```
❌ "Invalid signature" - Check API key
❌ "Merchant not found" - Check merchant ID
❌ "Network error" - Check internet/backend
```

---

## 🧪 Test Cards

Use these for testing:

| Card Number | Expiry | CVV | Result |
|-------------|--------|-----|--------|
| 4111111111111111 | 12/25 | 123 | ✅ Success |
| 4000000000000002 | 12/25 | 123 | ❌ Declined |
| 123 | 12/25 | 123 | ❌ Invalid (too short) |
| 4111111111111111 | 01/20 | 123 | ❌ Expired |

---

## 🎯 When to Use Which POS

### Use Secure POS For:
- ✅ Real customer payments
- ✅ Production environment
- ✅ When you need receipts
- ✅ When tracking settlements

### Use Legacy POS For:
- ⚠️ Quick testing only
- ⚠️ Development/debugging
- ❌ NOT for real payments

---

## 🚀 Production Checklist

Before using Secure POS in production:

- [ ] Backend running and accessible
- [ ] Merchant settings configured
- [ ] API key set correctly
- [ ] Test payment works
- [ ] Settlement code displays
- [ ] Receipt prints correctly
- [ ] Transaction history shows

---

## 💡 Tips

1. **Always use Secure POS for real money**
2. **Check settlement code on receipt**
3. **Monitor transaction history for failures**
4. **Print receipts for customers**
5. **Clear old transactions periodically**

---

## 🎉 You Now Have:

- ✅ Secure dashboard POS
- ✅ Android POS app
- ✅ Backend API
- ✅ Complete payment system

**Both dashboard and Android use same security!**

---

*Ready to process payments!* 💳
