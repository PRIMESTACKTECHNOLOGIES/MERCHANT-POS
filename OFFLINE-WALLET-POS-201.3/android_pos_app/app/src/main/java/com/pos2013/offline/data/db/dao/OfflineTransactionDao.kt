package com.pos2013.offline.data.db.dao

import androidx.room.*
import com.pos2013.offline.data.db.entities.OfflineTransactionEntity
import kotlinx.coroutines.flow.Flow

/**
 * DAO for offline POS transactions.
 * Provides CRUD operations and queries for the offline_transactions table.
 */
@Dao
interface OfflineTransactionDao {

    // ═══════════════════════════════════════════════════════════════
    // INSERT OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(txn: OfflineTransactionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(txns: List<OfflineTransactionEntity>)

    // ═══════════════════════════════════════════════════════════════
    // QUERY OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT * FROM offline_transactions WHERE syncStatus = :status ORDER BY createdAt ASC")
    suspend fun getByStatus(status: String): List<OfflineTransactionEntity>

    @Query("SELECT * FROM offline_transactions WHERE syncStatus = :status ORDER BY createdAt ASC")
    fun getByStatusFlow(status: String): Flow<List<OfflineTransactionEntity>>

    @Query("SELECT * FROM offline_transactions WHERE syncStatus = 'PENDING' ORDER BY createdAt ASC")
    suspend fun getPending(): List<OfflineTransactionEntity>

    @Query("SELECT * FROM offline_transactions WHERE syncStatus = 'PENDING' ORDER BY createdAt ASC")
    fun getPendingFlow(): Flow<List<OfflineTransactionEntity>>

    @Query("SELECT * FROM offline_transactions WHERE localTxnId = :id LIMIT 1")
    suspend fun getById(id: String): OfflineTransactionEntity?

    @Query("SELECT * FROM offline_transactions ORDER BY createdAt DESC")
    suspend fun getAll(): List<OfflineTransactionEntity>

    @Query("SELECT * FROM offline_transactions ORDER BY createdAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<OfflineTransactionEntity>

    // ═══════════════════════════════════════════════════════════════
    // COUNT OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT COUNT(*) FROM offline_transactions")
    suspend fun countAll(): Int

    @Query("SELECT COUNT(*) FROM offline_transactions WHERE syncStatus = :status")
    suspend fun countByStatus(status: String): Int

    @Query("SELECT COUNT(*) FROM offline_transactions WHERE syncStatus = 'PENDING'")
    fun countPendingFlow(): Flow<Int>

    // ═══════════════════════════════════════════════════════════════
    // SUM OPERATIONS (for dashboard)
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT COALESCE(SUM(amountMinor), 0) FROM offline_transactions WHERE syncStatus = :status")
    suspend fun sumAmountByStatus(status: String): Long

    // ═══════════════════════════════════════════════════════════════
    // UPDATE OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Query("""
        UPDATE offline_transactions 
        SET syncStatus = :status, 
            serverTxnId = :serverTxnId, 
            lastError = :error,
            syncedAt = :syncedAt
        WHERE localTxnId = :localTxnId
    """)
    suspend fun updateStatus(
        localTxnId: String,
        status: String,
        serverTxnId: String?,
        error: String?,
        syncedAt: Long?
    )

    @Query("UPDATE offline_transactions SET syncStatus = 'SYNCING' WHERE localTxnId = :localTxnId")
    suspend fun markAsSyncing(localTxnId: String)

    @Query("""
        UPDATE offline_transactions 
        SET syncStatus = 'FAILED', 
            lastError = :error,
            retryCount = retryCount + 1
        WHERE localTxnId = :localTxnId
    """)
    suspend fun markAsFailed(localTxnId: String, error: String)

    // ═══════════════════════════════════════════════════════════════
    // DELETE OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Query("DELETE FROM offline_transactions WHERE syncStatus = 'SYNCED' AND syncedAt < :olderThan")
    suspend fun deleteOldSynced(olderThan: Long): Int

    @Query("DELETE FROM offline_transactions")
    suspend fun deleteAll()
}
