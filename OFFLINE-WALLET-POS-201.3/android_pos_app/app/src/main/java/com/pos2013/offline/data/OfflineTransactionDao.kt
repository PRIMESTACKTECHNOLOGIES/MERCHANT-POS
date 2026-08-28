package com.pos2013.offline.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface OfflineTransactionDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transaction: OfflineTransaction)
    
    @Query("SELECT * FROM offline_transactions WHERE syncStatus = 'PENDING' ORDER BY timestamp ASC")
    suspend fun getPendingTransactions(): List<OfflineTransaction>
    
    @Query("SELECT * FROM offline_transactions WHERE syncStatus = 'PENDING' ORDER BY timestamp ASC")
    fun getPendingTransactionsFlow(): Flow<List<OfflineTransaction>>
    
    @Query("SELECT COUNT(*) FROM offline_transactions WHERE syncStatus = 'PENDING'")
    suspend fun getPendingCount(): Int
    
    @Query("SELECT COUNT(*) FROM offline_transactions WHERE syncStatus = 'PENDING'")
    fun getPendingCountFlow(): Flow<Int>
    
    @Query("UPDATE offline_transactions SET syncStatus = :status WHERE localTxnId = :localTxnId")
    suspend fun updateSyncStatus(localTxnId: String, status: String)
    
    @Query("UPDATE offline_transactions SET syncStatus = 'SYNCED', settlementCode = :settlementCode, syncedAt = :timestamp WHERE localTxnId = :localTxnId")
    suspend fun markAsSynced(localTxnId: String, settlementCode: String, timestamp: Long)
    
    @Query("UPDATE offline_transactions SET syncStatus = 'FAILED', lastError = :error, retryCount = retryCount + 1 WHERE localTxnId = :localTxnId")
    suspend fun markAsFailed(localTxnId: String, error: String)
    
    @Query("UPDATE offline_transactions SET syncStatus = 'SYNCING' WHERE localTxnId = :localTxnId")
    suspend fun markAsSyncing(localTxnId: String)
    
    @Query("DELETE FROM offline_transactions WHERE syncStatus = 'SYNCED' AND syncedAt < :olderThan")
    suspend fun deleteOldSynced(olderThan: Long)
    
    @Query("SELECT * FROM offline_transactions ORDER BY timestamp DESC LIMIT 50")
    suspend fun getRecentTransactions(): List<OfflineTransaction>
    
    @Query("SELECT * FROM offline_transactions WHERE localTxnId = :localTxnId LIMIT 1")
    suspend fun getTransactionById(localTxnId: String): OfflineTransaction?
    
    @Query("SELECT SUM(amountMinor) FROM offline_transactions WHERE syncStatus = 'PENDING'")
    suspend fun getTotalPendingAmount(): Long?
}
