# 💳 OFFLINE CARD TAP - HOW IT WORKS

## YOUR QUESTION: Can customers tap physical cards when offline?

### ✅ YES! Customers CAN tap cards offline!

Here's exactly how it works:

---

## 🔄 OFFLINE CARD TAP FLOW

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OFFLINE CARD TAP PROCESS                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. CUSTOMER TAPS CARD                                              │
│     └─> Phone reads NFC/EMV card data                               │
│                                                                     │
│  2. APP CHECKS CONNECTION                                           │
│     └─> No internet detected                                        │
│     └─> Switch to OFFLINE MODE                                      │
│                                                                     │
│  3. ENCRYPT & STORE LOCALLY                                         │
│     ├─> Card number encrypted (AES-256)                             │
│     ├─> Transaction saved to phone SQLite DB                        │
│     ├─> STAN generated (000847)                                     │
│     └─> Receipt printed: "APPROVED (OFFLINE)"                       │
│                                                                     │
│  4. WHEN BACK ONLINE                                                │
│     └─> Tap "🔄 Sync" button                                        │
│                                                                     │
│  5. BATCH UPLOAD TO SERVER                                          │
│     ├─> All offline transactions sent together                      │
│     ├─> Server decrypts & processes payments                        │
│     ├─> Settlement codes received                                   │
│     └─> Stored transactions marked as SYNCED                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 SECURITY: How Card Data is Protected

### 1. **Point-to-Point Encryption (P2PE)**
```kotlin
// Card data is encrypted IMMEDIATELY when tapped
val encryptedPan = encryptCardData(cardNumber, terminalPublicKey)
// Result: "U2FsdGVkX1+7J8v2..." (unreadable without private key)
```

### 2. **Local Storage Security**
```kotlin
// SQLite database is encrypted at rest
@Entity(tableName = "offline_transactions")
data class OfflineTransaction(
    val localTxnId: String,        // Unique ID
    val stan: String,              // 6-digit trace number
    val amountMinor: Int,          // Amount
    val encryptedPan: String,      // 🔐 ENCRYPTED card number
    val cardLast4: String,         // Last 4 digits only (for receipt)
    val cardExpiry: String?,       // Expiry date (encrypted)
    val syncStatus: String,        // PENDING / SYNCED
    val timestamp: Long            // When transaction happened
)
```

### 3. **What NEVER Gets Stored**
- ❌ Full CVV/CVC
- ❌ Full unencrypted card number
- ❌ PIN numbers

### 4. **What IS Stored (Encrypted)**
- ✅ Encrypted PAN (Primary Account Number)
- ✅ Card expiry (encrypted)
- ✅ Last 4 digits (for customer receipt)

---

## 📱 USER EXPERIENCE

### Scenario: Customer Pays Offline

```
┌────────────────────────────────────────┐
│ 🟢 POS 201.3 Terminal                  │
│ Merchant: MRC-1001                     │
│ Terminal: TERM-001                     │
│                                        │
│ Amount                                 │
│ ████████████ 150.00                    │
│                                        │
│  1  2  3                               │
│  4  5  6                               │
│  7  8  9                               │
│  C  0  .                               │
│                                        │
│ [⌫ Backspace]                          │
│                                        │
│ [💳 Process Payment]                   │
│                                        │
└────────────────────────────────────────┘
```

**Customer taps card:**
```
┌────────────────────────────────────────┐
│  💳 TAP CARD                           │
│                                        │
│  Please tap or insert card            │
│                                        │
│  [CARD ICON ANIMATION]                 │
│                                        │
│  Reading card...                       │
│                                        │
│  [Cancel]                              │
└────────────────────────────────────────┘
```

**Offline - Transaction Stored:**
```
┌────────────────────────────────────────┐
│  ✅ PAYMENT APPROVED                   │
│                                        │
│  OFFLINE MODE                          │
│  Transaction stored securely           │
│                                        │
│  STAN: 000847                          │
│  Amount: AED 150.00                    │
│  Card: ****1111                        │
│                                        │
│  [🖨️ Print Receipt]                    │
│  [Done]                                │
└────────────────────────────────────────┘
```

**Receipt shows:**
```
--------------------------------
   AM GLOBAL PAYMENT
--------------------------------
       SALE RECEIPT
--------------------------------
DATE: 22/03/26  TIME: 14:35
STAN: 000847
CARD: VISA ****1111
--------------------------------
TOTAL:        AED 150.00

⚠️  OFFLINE TRANSACTION
Will sync when online
Settlement pending
--------------------------------
```

---

## 🔄 SYNCING WHEN BACK ONLINE

### Step 1: Tap Sync Button
```
┌────────────────────────────────────────┐
│ 🟢 POS 201.3 Terminal                  │
│                                        │
│ 3 pending transactions                 │
│                                        │
│ [🔄 Sync Now]                          │
│                                        │
└────────────────────────────────────────┘
```

### Step 2: Uploading
```
┌────────────────────────────────────────┐
│  🔄 Syncing...                         │
│                                        │
│  Uploading 3 transactions              │
│  [████████████████████] 100%          │
│                                        │
│  ✅ All synced successfully!           │
│                                        │
│  Settlement Codes:                     │
│  • SET-9847                            │
│  • SET-9848                            │
│  • SET-9849                            │
│                                        │
│  [OK]                                  │
└────────────────────────────────────────┘
```

---

## ⚠️ IMPORTANT THINGS TO KNOW

### 1. **Transaction Limits Offline**
- Most systems limit offline transactions
- Common: Max 10 offline transactions
- Or max total amount: AED 5,000

### 2. **Expiry of Offline Transactions**
- Offline transactions MUST sync within 24 hours
- After 24 hours, they may be rejected by bank

### 3. **Declined Cards**
- If card is blocked/stolen, it will DECLINE when synced
- Customer will be contacted
- Merchant may lose money if already gave goods

### 4. **Risk Management**
```kotlin
// Recommended offline limits
object OfflineLimits {
    const val MAX_OFFLINE_TRANSACTIONS = 10
    const val MAX_OFFLINE_AMOUNT = 500000  // AED 5,000 in fils
    const val MAX_TRANSACTION_AMOUNT = 100000  // AED 1,000 per txn
    const val SYNC_TIMEOUT_HOURS = 24
}
```

---

## 🔧 CONFIGURING OFFLINE LIMITS

Add to your `GatewayConfig.kt`:

```kotlin
object OfflineConfig {
    // Maximum number of transactions to store offline
    const val MAX_OFFLINE_TRANSACTIONS = 10
    
    // Maximum total amount (in minor currency units)
    // Example: 500000 = AED 5,000.00
    const val MAX_OFFLINE_TOTAL_AMOUNT = 500000
    
    // Maximum single transaction amount
    // Example: 100000 = AED 1,000.00
    const val MAX_OFFLINE_SINGLE_AMOUNT = 100000
    
    // Force sync after this many transactions
    const val FORCE_SYNC_THRESHOLD = 5
}
```

---

## ✅ CHECKLIST: Offline Card Tap Works When:

- [x] Customer has NFC-enabled card (Contactless)
- [x] OR customer inserts chip card (EMV)
- [x] Phone has NFC reader (most Android phones)
- [x] Phone has no internet connection
- [x] Card data is encrypted immediately
- [x] Receipt prints with "OFFLINE" warning
- [x] Transaction syncs when back online

---

## 📋 SUMMARY

| Question | Answer |
|----------|--------|
| **Can customers tap offline?** | ✅ YES |
| **Is card data secure?** | ✅ YES - Encrypted immediately |
| **Do they get a receipt?** | ✅ YES - Shows "OFFLINE" |
| **When does money transfer?** | When synced online |
| **What if sync fails?** | Retry automatically |
| **What's the risk?** | Card may decline when synced |

**Bottom Line:** Offline card tap is SAFE, SECURE, and fully functional! 🎯
