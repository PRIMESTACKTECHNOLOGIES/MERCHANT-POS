# Room SQL Database Setup - Complete Guide

## Overview

You now have a **real SQLite database** using Room instead of SharedPreferences!

**What's the difference?**

| Feature | SimpleStorage (Old) | Room (New) |
|---------|-------------------|------------|
| Type | SharedPreferences | SQLite database |
| Speed | Slow for many items | Fast with indexes |
| Queries | Load all, filter in code | SQL queries |
| Real-time updates | Manual | Flow (automatic) |
| Large data | Bad | Excellent |
| Relationships | No | Yes |

---

## Files Created

```
data/db/
├── PosTransactionEntity.kt         # POS transactions table
├── PosTransactionDao.kt            # POS queries
├── MyFatoorahTransactionEntity.kt  # MyFatoorah table  
├── MyFatoorahTransactionDao.kt     # MyFatoorah queries
├── AppDatabase.kt                  # Database setup
└──

data/repository/
└── RoomRepository.kt               # Repository to use Room
```

---

## Database Tables

### 1. pos_transactions (POS Transactions)

| Column | Type | Description |
|--------|------|-------------|
| localTxnId | String (PK) | "TXN-LOCAL-001" |
| stan | String | "000001" |
| amountMinor | Int | 2500 ($25.00) |
| currency | String | "USD" |
| cardLast4 | String | "1111" |
| encryptedPan | String? | Encrypted full card |
| cardExpiry | String? | "12/25" |
| txnType | String | "SALE", "REFUND" |
| authMode | String | "OFFLINE_APPROVED" |
| entryMode | String | "MANUAL" |
| syncStatus | String | "PENDING" |
| serverTxnId | String? | From server |
| settlementCode | String? | "ABC123" |
| lastError | String? | Error message |
| retryCount | Int | 0 |
| timestamp | Long | System time |
| syncedAt | Long? | When synced |

### 2. myfatoorah_transactions (MyFatoorah Orders)

| Column | Type | Description |
|--------|------|-------------|
| localTxnId | String (PK) | Order ID |
| invoiceId | String? | MyFatoorah ID |
| paymentUrl | String? | Payment link |
| amountMinor | Int | Amount |
| customerName | String? | Customer name |
| customerMobile | String? | Phone |
| orderStatus | String | "PENDING", "LINK_SENT", "PAID" |
| syncStatus | String | Sync status |
| timestamp | Long | Created time |

---

## How to Use

### 1. Save Transaction (in PaymentRepository)

```kotlin
// OLD (SimpleStorage)
val storage = SimpleStorage(context)
storage.saveTransaction(transaction)

// NEW (Room)
val roomRepo = RoomRepository(context)
val entity = roomRepo.savePosTransaction(
    amountMinor = 2500,
    currency = "USD",
    cardNumber = "4111111111111111",
    cardExpiry = "12/25",
    txnType = "SALE"
)
// Returns: PosTransactionEntity with localTxnId, stan, etc.
```

### 2. Get Pending (for SyncWorker)

```kotlin
// OLD
val pending = storage.getPendingTransactions()

// NEW
val pending = roomRepo.getPendingTransactions()
// Returns: List<PosTransactionEntity>
```

### 3. Update After Sync

```kotlin
// OLD
storage.markAsSynced(txnId, settlementCode)

// NEW
roomRepo.updateSyncStatus(
    localTxnId = txnId,
    status = "SYNCED",
    serverTxnId = "SERVER-123",
    settlementCode = "ABC123",
    error = null
)
```

### 4. Real-time Count (in Dashboard)

```kotlin
// Get Flow that updates automatically
roomRepo.getPendingCountFlow().collect { count ->
    // UI updates automatically when data changes!
    binding.tvPendingCount.text = "$count pending"
}
```

### 5. Get Dashboard Stats

```kotlin
val counts = roomRepo.getDashboardCounts()
// Returns: DashboardCounts(total, pending, synced, failed, pendingAmount, syncedAmount)
```

---

## DAO Queries Available

### PosTransactionDao

```kotlin
// Get by status
suspend fun getByStatus(status: String): List<PosTransactionEntity>
fun getByStatusFlow(status: String): Flow<List<PosTransactionEntity>>

// Get pending
suspend fun getPending(): List<PosTransactionEntity>
fun getPendingFlow(): Flow<List<PosTransactionEntity>>

// Get single
suspend fun getById(id: String): PosTransactionEntity?

// Get all/recent
suspend fun getAll(): List<PosTransactionEntity>
suspend fun getRecent(limit: Int): List<PosTransactionEntity>

// Counts
suspend fun countByStatus(status: String): Int
fun getPendingCountFlow(): Flow<Int>

// Sums
suspend fun getTotalAmountByStatus(status: String): Long

// Updates
suspend fun updateStatus(...)
suspend fun markAsFailed(localTxnId: String, error: String)
suspend fun incrementRetry(localTxnId: String)

// Delete
suspend fun deleteOldSynced(olderThan: Long): Int
```

---

## Migration from SimpleStorage to Room

### Step 1: Update PaymentRepository

In `PaymentRepository.processPayment()`, replace:

```kotlin
// OLD
val storage = SimpleStorage(context)
storage.saveTransaction(transaction)

// NEW
val roomRepo = RoomRepository(context)
val entity = roomRepo.savePosTransaction(
    amountMinor = amountMinor,
    currency = "USD",
    cardNumber = cardNumber,
    cardExpiry = cardExpiry,
    txnType = "SALE"
)
```

### Step 2: Update SyncWorker

In `SyncWorker.doWork()`, replace:

```kotlin
// OLD
val pending = storage.getPendingTransactions()

// NEW
val roomRepo = RoomRepository(context)
val pending = roomRepo.getPendingTransactions()
```

### Step 3: Update DashboardRepository

Replace SimpleStorage calls with RoomRepository calls.

---

## Gradle Dependencies

Already in your `app/build.gradle.kts`:

```kotlin
// Room
val roomVersion = "2.7.0-rc01"
implementation(libs.androidx.room.runtime)
implementation(libs.androidx.room.ktx)
ksp(libs.androidx.room.compiler)
```

---

## Benefits of Room

1. **Indexes** - Fast queries on syncStatus, timestamp
2. **Flow** - Automatic UI updates
3. **Type Safety** - Compile-time SQL checking
4. **Migrations** - Easy database versioning
5. **Coroutines** - Built-in suspend functions

---

## Summary

**You now have:**
- ✅ Real SQLite database
- ✅ POS transactions table
- ✅ MyFatoorah orders table
- ✅ Fast queries with indexes
- ✅ Real-time Flow updates
- ✅ Repository pattern

**Next:** Replace SimpleStorage calls with RoomRepository in your existing code!

**Your data is now in a real database! 🎉**
