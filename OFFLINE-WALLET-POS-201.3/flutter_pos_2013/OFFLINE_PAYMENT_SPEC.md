# Offline Payment Implementation - Protocol 201.3

## ✅ Complete Implementation Summary

The Flutter POS app now fully implements the Kotlin specification for offline manual entry card transactions.

---

## 📊 Database Schema (SQLite)

### Table: `transactions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Server transaction ID |
| `localTxnId` | TEXT UNIQUE | Local TXN-XXX identifier |
| `stan` | TEXT | 6-digit STAN (000001-999999) |
| `amountMinor` | INTEGER | Amount in cents (2500 = $25.00) |
| `currency` | TEXT | USD, AED, etc. |
| `encryptedPan` | TEXT | AES encrypted full PAN |
| `cardLast4` | TEXT | Last 4 digits |
| `panMasked` | TEXT | Full masked "4111********1111" |
| `cardExpiry` | TEXT | MM/YY format |
| `txnType` | TEXT | SALE, REFUND, VOID |
| `entryMode` | TEXT | MANUAL, CHIP, CONTACTLESS |
| `authMode` | TEXT | OFFLINE_APPROVED, ONLINE_APPROVED |
| `rrn` | TEXT | Retrieval Reference Number (12 digits) |
| `authCode` | TEXT | 6-digit authorization code |
| `emvDataJson` | TEXT | EMV tags as JSON |
| `timestamp` | INTEGER | Unix timestamp (ms) |
| `txnTimestamp` | TEXT | ISO 8601 timestamp |
| `syncStatus` | TEXT | PENDING, SYNCING, SYNCED, FAILED |
| `synced` | INTEGER | 0/1 boolean |
| `settlementCode` | TEXT | From server after sync |
| `errorMessage` | TEXT | Last sync error |

---

## 🔐 Security Features

### 1. PAN Masking
```dart
// Full masked PAN: "4111********1111"
String _maskFullPan(String pan) {
  final first4 = pan.substring(0, 4);
  final last4 = pan.substring(pan.length - 4);
  final stars = '*' * (pan.length - 8);
  return '$first4$stars$last4';
}
```

### 2. AES Encryption
```dart
// Encrypt full PAN before storage
final encUtil = EncryptionUtil();
encryptedPan = encUtil.encrypt(cardNumber);
```

### 3. HMAC Signature
```dart
// Protocol 201.3 signature format:
data = "201.3|MRC-1001|T2013-0001|BATCH-xxx|1711206600000|nonce|2"
signature = base64(hmac-sha256(data, secret))
```

---

## 🔄 Sync Flow

### Single Transaction Sync
```
1. Update status: PENDING → SYNCING
2. Generate batch metadata (batchId, nonce, timestamp)
3. Build TransactionRequest with all fields
4. Generate HMAC signature
5. POST /merchant/v1/pos/201.3/offline-batch
6. Process response:
   - ACCEPTED → SYNCED + settlementCode
   - REJECTED → FAILED + errorMessage
```

### Batch Sync (Multiple Transactions)
```
1. Get all PENDING transactions
2. Build batch with multiple TransactionRequests
3. Single HMAC signature for entire batch
4. Upload batch
5. Process individual results
6. Update each transaction status
```

---

## 📡 API Endpoints

### Batch Upload
```http
POST /merchant/v1/pos/201.3/offline-batch
Headers:
  X-Merchant-Id: MRC-1001
  X-Terminal-Id: T2013-0001
  X-Signature: <hmac-signature>

Body:
{
  "protocolVersion": "201.3",
  "merchantId": "MRC-1001",
  "terminalId": "T2013-0001",
  "batchId": "BATCH-1711206600000-1234",
  "batchCreatedAt": "2024-03-23T14:25:00Z",
  "nonce": "a1b2c3d4e5f6g7h8",
  "timestamp": "1711206600000",
  "signature": "base64_hmac",
  "transactions": [
    {
      "localTxnId": "TXN-LOCAL-001",
      "stan": "123456",
      "amountMinor": 2500,
      "currency": "USD",
      "panMasked": "4111********1111",
      "txnType": "SALE",
      "authMode": "OFFLINE_APPROVED",
      "entryMode": "MANUAL",
      "rrn": "123456240323",
      "authCode": "789012",
      "emvData": null,
      "txnTimestamp": "2024-03-23T14:25:00Z"
    }
  ]
}
```

### Response
```http
200 OK
{
  "protocolVersion": "201.3",
  "merchantId": "MRC-1001",
  "terminalId": "T2013-0001",
  "batchId": "BATCH-1711206600000-1234",
  "settlementCode": "SETT-A7B2C9",
  "results": [
    {
      "localTxnId": "TXN-LOCAL-001",
      "serverTxnId": "TXN-SRV-789",
      "status": "ACCEPTED",
      "message": null
    }
  ]
}
```

---

## 🔢 ID Generation

### STAN (System Trace Audit Number)
```dart
// 6-digit, incremental, wraps at 999999
Format: "000001" to "999999"
Storage: SharedPreferences
```

### RRN (Retrieval Reference Number)
```dart
// 12 digits: STAN (6) + Date (6)
Format: "123456240323"
Example: STAN 123456 + Date Mar 23, 2024
```

### Local Transaction ID
```dart
// Unique local identifier
Format: "TXN-{timestamp}-{uuid}"
Example: "TXN-1711206600000-a1b2c3d4"
```

### Batch ID
```dart
// Unique batch identifier
Format: "BATCH-{timestamp}-{random}"
Example: "BATCH-1711206600000-5678"
```

---

## 📱 Usage Example

### Process Payment
```dart
final result = await paymentRepository.processPayment(
  cardNumber: '4111111111111111',
  expiry: '12/25',
  cvv: '123',
  amount: 25.00,
  entryMode: 'MANUAL',
  authMode: 'OFFLINE_APPROVED',
);

// Result: PaymentSuccess, PaymentPending, or PaymentError
```

### Sync Pending Transactions
```dart
final summary = await paymentRepository.syncPendingTransactions();

print('Total: ${summary.total}');
print('Synced: ${summary.synced}');
print('Failed: ${summary.failed}');
print('Settlement Codes: ${summary.settlementCodes}');
```

### Get Dashboard Stats
```dart
final stats = await paymentRepository.getDashboardStats();

print('Pending: ${stats['pending']}');
print('Synced: ${stats['synced']}');
print('Pending Amount: ${stats['pendingAmount'] / 100}');
```

---

## 🆚 Comparison with Kotlin Spec

| Feature | Kotlin Spec | Flutter Implementation | Status |
|---------|-------------|----------------------|--------|
| Room Entity | ✅ `OfflineTransactionEntity` | ✅ `TransactionModel` | ✅ Match |
| DAO | ✅ `OfflineTransactionDao` | ✅ `DatabaseHelper` | ✅ Match |
| HMAC Signing | ✅ `HmacUtil` | ✅ `HmacUtil` | ✅ Match |
| STAN Generation | ✅ 6-digit incremental | ✅ 6-digit incremental | ✅ Match |
| Batch Upload | ✅ `OfflineBatchRequest` | ✅ `BatchUploadRequest` | ✅ Match |
| EMV Data | ✅ `EmvDataDto` | ✅ `EmvDataDto` | ✅ Match |
| RRN | ✅ 12 digits | ✅ 12 digits | ✅ Match |
| Auth Code | ✅ 6 digits | ✅ 6 digits | ✅ Match |
| Sync Logic | ✅ `syncPending()` | ✅ `syncPendingTransactions()` | ✅ Match |
| Full PAN Mask | ✅ `panMasked` | ✅ `panMasked` | ✅ Match |

---

## ✅ Summary

**The Flutter POS app now fully implements the Kotlin specification for Protocol 201.3 offline card transactions!**

### What's Implemented:
- ✅ Complete database schema with all fields
- ✅ AES encryption for card data
- ✅ Full PAN masking (4111********1111)
- ✅ 6-digit STAN generation
- ✅ 12-digit RRN generation
- ✅ 6-digit Auth Code generation
- ✅ HMAC-SHA256 signing
- ✅ Batch upload with multiple transactions
- ✅ EMV data support (for future chip card integration)
- ✅ Comprehensive sync status tracking
- ✅ Settlement code handling

### Next Steps:
1. Build and test the app
2. Configure backend with payment gateway
3. Test end-to-end flow
4. Add chip card reader support (for EMV data)
