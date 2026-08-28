# POS Offline Sync System - Production Ready

## Overview

This is the **real offline batch engine** of your 201.3 POS. It makes your POS behave like a true payment terminal (Ingenico, Verifone, PAX, Castles) by:

1. **Storing transactions offline** when there's no internet
2. **Automatically syncing** in the background every 15 minutes
3. **Building signed 201.3 batches** with HMAC-SHA256
4. **Uploading to your backend** with retry logic
5. **Updating SQL status** (PENDING → SYNCING → SYNCED/FAILED)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              YOUR POS APP                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   UI Layer      │    │  Domain Layer   │    │     Data Layer          │  │
│  │                 │    │                 │    │                         │  │
│  │  MainActivity   │◄──►│ SyncRepository  │◄──►│  SyncRepositoryImpl     │  │
│  │                 │    │   (interface)   │    │                         │  │
│  │  [SYNC NOW]     │    │                 │    │  • Build 201.3 batch    │  │
│  │                 │    └─────────────────┘    │  • HMAC signature       │  │
│  └─────────────────┘                           │  • Upload via Retrofit  │  │
│           │                                    │  • Update statuses      │  │
│           │                                    └─────────────────────────┘  │
│           │                                        │                        │
│           │                    ┌───────────────────┘                        │
│           │                    │                                            │
│           │            ┌───────▼────────┐                                   │
│           │            │   SyncWorker   │  ◄── WorkManager                 │
│           │            │                │      (every 15 min)               │
│           │            │  • Background  │                                   │
│           │            │  • Auto-retry  │                                   │
│           │            │  • Network     │                                   │
│           │            └────────────────┘                                   │
│           │                                                                 │
│           └────────►  SyncScheduler.schedule()                              │
│                       SyncScheduler.syncNow()                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
com.pos2013.offline/
├── domain/repository/
│   └── SyncRepository.kt          # Interface: syncPending(), getPendingCount()
│
├── data/repository/
│   └── SyncRepositoryImpl.kt      # Real 201.3 batch implementation
│
├── data/worker/
│   └── SyncWorker.kt              # WorkManager background worker
│
├── worker/
│   └── SyncScheduler.kt           # Helper to schedule/cancel work
│
└── PosApplication.kt              # Schedules sync on app startup
```

---

## How It Works

### 1. Background Sync (Automatic)

When your app starts, `PosApplication` schedules a periodic WorkManager job:

```kotlin
// In PosApplication.onCreate()
SyncScheduler.schedule(this)
```

This runs **every 15 minutes** (only when network is available and battery is not low).

### 2. Manual Sync (User Triggered)

When user clicks **[SYNC NOW]**:

```kotlin
// Immediate sync
SyncScheduler.syncNow(context)

// Or use repository directly for UI feedback
val repo = SyncRepositoryImpl(context)
val summary = repo.syncPending()
```

### 3. The Sync Process

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   START     │────►│ Get PENDING  │────►│  Build Batch    │
│             │     │ transactions │     │                 │
└─────────────┘     └──────────────┘     │ • batchId       │
                                         │ • nonce         │
                                         │ • timestamp     │
                                         │ • transactions  │
                                         └────────┬────────┘
                                                  │
                         ┌────────────────────────┘
                         ▼
                ┌─────────────────┐
                │ Generate HMAC   │
                │                 │
                │ signature =     │
                │ HMAC-SHA256(    │
                │   "201.3|" +    │
                │   merchantId +  │
                │   terminalId +  │
                │   batchId +     │
                │   timestamp +   │
                │   nonce +       │
                │   txnCount      │
                │ )               │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  Upload Batch   │
                │                 │
                │ POST /merchant/ │
                │ v1/pos/201.3/   │
                │ offline-batch   │
                │                 │
                │ Headers:        │
                │ X-Signature     │
                └────────┬────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      ┌─────────┐  ┌─────────┐  ┌─────────┐
      │ SUCCESS │  │  FAIL   │  │  RETRY  │
      │         │  │         │  │         │
      │ Mark    │  │ Mark    │  │ Wait    │
      │ SYNCED  │  │ FAILED  │  │ 1s, 2s  │
      │         │  │         │  │ Retry   │
      └─────────┘  └─────────┘  │ 3x      │
                                └─────────┘
```

---

## 201.3 Protocol Batch Format

### Request

```json
{
  "protocolVersion": "201.3",
  "merchantId": "MRC-1001",
  "terminalId": "T2013-001",
  "batchId": "BATCH-1711206600000-1234",
  "timestamp": 1711206600000,
  "nonce": "a1b2c3d4e5f6g7h8",
  "transactions": [
    {
      "localTxnId": "TXN-LOCAL-001",
      "stan": "123456",
      "amountMinor": 2500,
      "currency": "USD",
      "encryptedPan": "encrypted...",
      "cardLast4": "1111",
      "expiry": "12/25",
      "txnType": "SALE",
      "entryMode": "MANUAL",
      "txnTimestamp": "2026-03-23T14:25:00.000Z"
    }
  ],
  "signature": "base64_hmac_sha256_signature"
}
```

### Signature Construction

```kotlin
val data = "201.3|$merchantId|$terminalId|$batchId|$timestamp|$nonce|$txnCount"
val signature = base64(hmacSha256(data, terminalSecret))
```

Example:
```
data = "201.3|MRC-1001|T2013-001|BATCH-1711206600000-1234|1711206600000|a1b2c3d4e5f6g7h8|2"
```

---

## Status Flow

```
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐
│  NEW    │───►│ PENDING  │───►│ SYNCING │───►│ SYNCED  │
│         │    │          │    │         │    │         │
│ Payment │    │ Stored   │    │ Upload  │    │ Server  │
│ saved   │    │ offline  │    │ in      │    │ ack     │
└─────────┘    └──────────┘    │ progress│    └─────────┘
                               └────┬────┘
                                    │
                                    ▼ (if fail)
                               ┌─────────┐
                               │ FAILED  │
                               │         │
                               │ Retry   │
                               │ later   │
                               └─────────┘
```

---

## Configuration

No additional configuration needed! The system uses existing `GatewayConfig`:

```kotlin
// Already configured in your app
GatewayConfig.MERCHANT_ID       // "MRC-1001"
GatewayConfig.TERMINAL_ID       // "T2013-001"  
GatewayConfig.GATEWAY_SECRET_KEY // For HMAC signing
GatewayConfig.SERVER_URL        // Backend URL
```

---

## API

### SyncRepository (Domain Layer)

```kotlin
interface SyncRepository {
    suspend fun syncPending(): SyncSummary
    fun getPendingCount(): Int
    fun isNetworkAvailable(): Boolean
}
```

### SyncScheduler (Helper)

```kotlin
object SyncScheduler {
    fun schedule(context: Context)      // Auto sync every 15 min
    fun syncNow(context: Context)       // Manual sync
    fun cancel(context: Context)        // Stop all sync
    fun isScheduled(context: Context): Boolean
}
```

### SyncWorker (Background)

```kotlin
// Runs automatically - no manual interaction needed
class SyncWorker(context, params) : CoroutineWorker(context, params)
```

---

## Retry Logic

The sync system has **3 layers of retry protection**:

1. **Per-request retry**: 3 attempts with exponential backoff (1s, 2s, 3s)
2. **WorkManager retry**: If worker fails, WorkManager reschedules
3. **Periodic retry**: Every 15 minutes, all FAILED transactions are retried

---

## Battery & Network Optimization

The sync system respects device resources:

- ✅ Only syncs when **network is available**
- ✅ Only syncs when **battery is not low**
- ✅ Uses **WorkManager** (system-managed, Doze-aware)
- ✅ Batches multiple transactions in **single request**
- ✅ **15-minute interval** prevents excessive wakeups

---

## Testing

### Test Manual Sync

```kotlin
// In MainActivity or test
SyncScheduler.syncNow(context)
```

### Check Pending Count

```kotlin
val repo = SyncRepositoryImpl(context)
val count = repo.getPendingCount()
Timber.d("Pending transactions: $count")
```

### Verify WorkManager

```bash
# Connect to device via ADB
adb shell dumpsys jobscheduler | grep -A 5 "offline_sync_worker"

# Or use Android Studio's WorkManager Inspector
# View → Tool Windows → App Inspection → Background Task Inspector
```

---

## Production Checklist

- [x] WorkManager scheduled in `PosApplication.onCreate()`
- [x] HMAC signature uses correct format
- [x] Batch ID is unique per upload
- [x] Nonce is random 16-char hex
- [x] Timestamp is Unix millis
- [x] Retry logic handles network failures
- [x] Status updates work (PENDING → SYNCING → SYNCED/FAILED)
- [x] Battery constraints applied
- [x] Manual sync button works
- [x] Background sync works when app closed

---

## Next Steps

Your POS now has enterprise-grade offline sync! Next options:

1. **Payment Capture Flow** - Build the UI that creates offline transactions
2. **Terminal Verification** - Add `/terminal/verify` endpoint integration
3. **MyFatoorah 201.3 Support** - Real payment processing via MyFatoorah
4. **Receipt Printing** - Auto-print receipts after sync
5. **Settlement Reports** - Daily batch settlement view

---

## Troubleshooting

### Sync not running?

```kotlin
// Check if scheduled
if (!SyncScheduler.isScheduled(context)) {
    SyncScheduler.schedule(context)
}
```

### Transactions stuck in SYNCING?

They'll be retried on next sync cycle. To force reset:

```kotlin
// Mark all SYNCING back to PENDING
storage.getAllTransactions()
    .filter { it.syncStatus == "SYNCING" }
    .forEach { storage.updateStatus(it.localTxnId, "PENDING") }
```

### HMAC signature failing?

Check logcat for:
```
D/SyncRepositoryImpl: Signature payload: 201.3|MRC-1001|T2013-001|...
```

Verify it matches your backend's expected format.

---

**Your POS is now a real payment terminal! 🎉**
