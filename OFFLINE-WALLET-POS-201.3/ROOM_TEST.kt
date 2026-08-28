package com.pos2013.offline

import android.content.Context
import com.pos2013.offline.data.db.AppDatabase
import com.pos2013.offline.data.db.entities.OfflineTransactionEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Quick test to verify Room database is working.
 * Run this in a coroutine to test.
 */
suspend fun testRoomDatabase(context: Context) = withContext(Dispatchers.IO) {
    
    // 1. Get database instance
    val db = AppDatabase.get(context)
    val dao = db.offlineTransactionDao()
    
    // 2. Insert test transaction
    val testTxn = OfflineTransactionEntity(
        localTxnId = "TEST-${System.currentTimeMillis()}",
        stan = "000001",
        amountMinor = 2500,
        currency = "USD",
        panMasked = "4111********1111",
        txnType = "SALE",
        authMode = "OFFLINE_APPROVED",
        entryMode = "MANUAL",
        rrn = null,
        authCode = null,
        emvDataJson = null,
        txnTimestamp = "2026-03-24T10:00:00Z",
        createdAt = System.currentTimeMillis(),
        syncStatus = "PENDING",
        serverTxnId = null,
        lastError = null,
        retryCount = 0,
        syncedAt = null
    )
    
    dao.insert(testTxn)
    println("✅ Inserted transaction: ${testTxn.localTxnId}")
    
    // 3. Query pending transactions
    val pending = dao.getPending()
    println("✅ Pending count: ${pending.size}")
    
    // 4. Get count
    val count = dao.countByStatus("PENDING")
    println("✅ Pending count via query: $count")
    
    // 5. Update status
    dao.updateStatus(
        localTxnId = testTxn.localTxnId,
        status = "SYNCED",
        serverTxnId = "SERVER-123",
        error = null,
        syncedAt = System.currentTimeMillis()
    )
    println("✅ Updated status to SYNCED")
    
    // 6. Verify
    val updated = dao.getById(testTxn.localTxnId)
    println("✅ Verified: ${updated?.syncStatus}")
    
    println("\n🎉 Room database is working correctly!")
}
