package com.pos2013.offline.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.pos2013.offline.data.model.*

@Dao
interface TransactionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: TransactionEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(entities: List<TransactionEntity>)

    @Update
    suspend fun update(entity: TransactionEntity)

    @Query("SELECT * FROM transactions ORDER BY txnTimestamp DESC LIMIT :limit")
    suspend fun getAll(limit: Int = 500): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE status = :status ORDER BY txnTimestamp ASC")
    suspend fun getByStatus(status: String): List<TransactionEntity>

    @Query("SELECT * FROM transactions WHERE localTxnId = :localTxnId LIMIT 1")
    suspend fun getByLocalId(localTxnId: String): TransactionEntity?

    @Query("SELECT * FROM transactions WHERE stan = :stan LIMIT 1")
    suspend fun getByStan(stan: String): TransactionEntity?

    @Query("SELECT COUNT(*) FROM transactions WHERE status = :status")
    suspend fun countByStatus(status: String): Int

    @Query("UPDATE transactions SET status = 'SYNCED', syncedAt = :ts, settlementId = :settlementId WHERE localTxnId = :localTxnId")
    suspend fun markSyncedWithSettlement(localTxnId: String, ts: Long, settlementId: String?)

    @Query("UPDATE transactions SET status = 'SYNCED', syncedAt = :ts WHERE localTxnId = :localTxnId")
    suspend fun markSynced(localTxnId: String, ts: Long)

    @Query("UPDATE transactions SET status = 'FAILED', errorMessage = :msg WHERE localTxnId = :localTxnId")
    suspend fun markFailed(localTxnId: String, msg: String)

    @Query("DELETE FROM transactions WHERE status = 'SYNCED' AND syncedAt < :ts")
    suspend fun purgeOlderThan(ts: Long)

    @Query("SELECT COALESCE(SUM(amountMinor), 0) FROM transactions WHERE status = 'PENDING'")
    suspend fun pendingAmountMinorSum(): Long

    @Query("SELECT COUNT(*) FROM transactions WHERE txnTimestamp >= :fromTs")
    suspend fun countSince(fromTs: Long): Int
}

@Dao
interface WalletTopupDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: WalletTopupEntity)

    @Query("SELECT * FROM wallet_topups WHERE status = 'PENDING' ORDER BY txnTimestamp ASC")
    suspend fun getPendingTopups(): List<WalletTopupEntity>

    @Query("SELECT COUNT(*) FROM wallet_topups WHERE status = 'PENDING'")
    suspend fun countPendingTopups(): Int

    @Query("UPDATE wallet_topups SET status = 'SYNCED', syncedAt = :ts, authCode = :authCode, syncError = NULL WHERE id = :id")
    suspend fun markSyncedWithTs(id: String, authCode: String?, ts: Long)

    @Query("UPDATE wallet_topups SET status = 'FAILED', syncError = :msg WHERE id = :id")
    suspend fun markFailed(id: String, msg: String)

    @Query("SELECT * FROM wallet_topups ORDER BY txnTimestamp DESC LIMIT :limit")
    suspend fun getAll(limit: Int = 500): List<WalletTopupEntity>
}

@Dao
interface DashboardCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DashboardCacheEntity)

    @Query("SELECT * FROM dashboard_cache WHERE id = 'singleton' LIMIT 1")
    suspend fun getSingleton(): DashboardCacheEntity?
}

@Dao
interface ReceiptCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ReceiptCacheEntity)

    @Query("SELECT * FROM receipts_cache WHERE transactionId = :transactionId LIMIT 1")
    suspend fun getByTransactionId(transactionId: String): ReceiptCacheEntity?

    @Query("SELECT * FROM receipts_cache ORDER BY generatedAt DESC LIMIT :limit")
    suspend fun recent(limit: Int = 100): List<ReceiptCacheEntity>

    @Query("UPDATE receipts_cache SET printedAt = :ts WHERE id = :id")
    suspend fun markPrinted(id: String, ts: Long)

    @Query("UPDATE receipts_cache SET emailedAt = :ts WHERE id = :id")
    suspend fun markEmailed(id: String, ts: Long)

    @Query("UPDATE receipts_cache SET smsedAt = :ts WHERE id = :id")
    suspend fun markSmsed(id: String, ts: Long)
}

@Dao
interface SyncQueueDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: SyncQueueEntity): Long

    @Query("SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getPending(limit: Int = 50): List<SyncQueueEntity>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'PENDING'")
    suspend fun countPending(): Int

    @Query("UPDATE sync_queue SET status = 'SYNCED', syncedAt = :ts, responseRef = :ref WHERE id = :id")
    suspend fun markSynced(id: Long, ts: Long, ref: String?)

    @Query("UPDATE sync_queue SET retryCount = retryCount + 1, lastError = :msg WHERE id = :id")
    suspend fun markRetry(id: Long, msg: String)
}

@Dao
interface LocalAuditDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: LocalAuditEntity): Long

    @Query("SELECT * FROM local_audit_events ORDER BY createdAt DESC LIMIT :limit")
    suspend fun recent(limit: Int = 500): List<LocalAuditEntity>
}

@Dao
interface PairedTerminalsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: PairedTerminalEntity)

    @Query("SELECT * FROM paired_terminals ORDER BY pairedAt DESC")
    suspend fun getAll(): List<PairedTerminalEntity>

    @Query("SELECT * FROM paired_terminals WHERE terminalId = :id LIMIT 1")
    suspend fun getById(id: String): PairedTerminalEntity?

    @Query("UPDATE paired_terminals SET lastSeenAt = :ts WHERE terminalId = :id")
    suspend fun touch(id: String, ts: Long)

    @Query("DELETE FROM paired_terminals WHERE terminalId = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface ProductCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ProductCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<ProductCacheEntity>)

    @Query("SELECT * FROM products_cache ORDER BY name ASC")
    suspend fun getAll(): List<ProductCacheEntity>

    @Query("SELECT * FROM products_cache WHERE name LIKE '%' || :q || '%' OR sku LIKE '%' || :q || '%' ORDER BY name ASC")
    suspend fun search(q: String): List<ProductCacheEntity>

    @Query("SELECT * FROM products_cache WHERE sku = :sku LIMIT 1")
    suspend fun getBySku(sku: String): ProductCacheEntity?
}
