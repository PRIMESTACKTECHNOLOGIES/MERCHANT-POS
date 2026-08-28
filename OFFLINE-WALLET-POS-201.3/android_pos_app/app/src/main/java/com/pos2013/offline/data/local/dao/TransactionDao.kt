package com.pos2013.offline.data.local.dao

import androidx.room.*
import com.pos2013.offline.data.local.entity.TransactionEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for transactions.
 * Provides CRUD operations and queries for transaction management.
 */
@Dao
interface TransactionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transaction: TransactionEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(transactions: List<TransactionEntity>): List<Long>

    @Update
    suspend fun update(transaction: TransactionEntity)

    @Delete
    suspend fun delete(transaction: TransactionEntity)

    @Query("DELETE FROM transactions WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT * FROM transactions ORDER BY created_at DESC")
    fun getAllTransactions(): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE id = :id LIMIT 1")
    suspend fun getTransactionById(id: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE local_txn_id = :localTxnId LIMIT 1")
    suspend fun getTransactionByLocalId(localTxnId: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE stan = :stan LIMIT 1")
    suspend fun getTransactionByStan(stan: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE batch_id = :batchId ORDER BY txn_timestamp ASC")
    suspend fun getTransactionsByBatch(batchId: String): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE sync_status = :status ORDER BY created_at ASC")
    fun getTransactionsBySyncStatus(status: String): Flow<List<TransactionEntity>>

    @Query("SELECT * FROM transactions WHERE sync_status = 'PENDING' ORDER BY created_at ASC")
    suspend fun getPendingTransactions(): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE sync_status = 'FAILED' AND retry_count < 3 ORDER BY created_at ASC")
    suspend fun getFailedTransactionsForRetry(): List<TransactionEntity>

    @Query("SELECT COUNT(*) FROM transactions WHERE sync_status = 'PENDING'")
    suspend fun getPendingCount(): Int

    @Query("SELECT COUNT(*) FROM transactions WHERE sync_status = 'FAILED'")
    suspend fun getFailedCount(): Int

    @Query("SELECT SUM(amount_minor) FROM transactions WHERE sync_status = 'PENDING'")
    suspend fun getPendingAmount(): Long?

    @Query("SELECT SUM(amount_minor) FROM transactions WHERE sync_status = 'SYNCED' AND DATE(created_at/1000, 'unixepoch') = DATE('now')")
    suspend fun getTodaySyncedAmount(): Long?

    @Query("UPDATE transactions SET sync_status = :status, synced_at = :timestamp, settlement_code = :settlementCode WHERE id = :id")
    suspend fun updateSyncStatus(id: String, status: String, timestamp: Long?, settlementCode: String?)

    @Query("UPDATE transactions SET sync_status = 'FAILED', error_message = :errorMessage, retry_count = retry_count + 1 WHERE id = :id")
    suspend fun markAsFailed(id: String, errorMessage: String?)

    @Query("UPDATE transactions SET status = :status, auth_code = :authCode WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, authCode: String?)

    @Query("DELETE FROM transactions WHERE sync_status = 'SYNCED' AND created_at < :timestamp")
    suspend fun deleteOldSyncedTransactions(timestamp: Long)

    @Query("SELECT * FROM transactions ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecentTransactions(limit: Int): List<TransactionEntity>
}
