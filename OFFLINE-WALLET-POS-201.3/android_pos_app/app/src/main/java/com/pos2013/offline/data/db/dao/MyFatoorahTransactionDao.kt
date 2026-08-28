package com.pos2013.offline.data.db.dao

import androidx.room.*
import com.pos2013.offline.data.db.entities.MyFatoorahTransactionEntity
import kotlinx.coroutines.flow.Flow

/**
 * DAO for MyFatoorah offline orders.
 */
@Dao
interface MyFatoorahTransactionDao {

    // ═══════════════════════════════════════════════════════════════
    // INSERT
    // ═══════════════════════════════════════════════════════════════

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(txn: MyFatoorahTransactionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(txns: List<MyFatoorahTransactionEntity>)

    // ═══════════════════════════════════════════════════════════════
    // QUERY
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT * FROM myfatoorah_transactions WHERE orderStatus = :status ORDER BY createdAt ASC")
    suspend fun getByOrderStatus(status: String): List<MyFatoorahTransactionEntity>

    @Query("SELECT * FROM myfatoorah_transactions WHERE orderStatus = 'PENDING' ORDER BY createdAt ASC")
    suspend fun getPendingOrders(): List<MyFatoorahTransactionEntity>

    @Query("SELECT * FROM myfatoorah_transactions WHERE orderStatus = 'LINK_SENT' ORDER BY createdAt ASC")
    suspend fun getLinkSentOrders(): List<MyFatoorahTransactionEntity>

    @Query("SELECT * FROM myfatoorah_transactions WHERE localTxnId = :id LIMIT 1")
    suspend fun getById(id: String): MyFatoorahTransactionEntity?

    @Query("SELECT * FROM myfatoorah_transactions ORDER BY createdAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<MyFatoorahTransactionEntity>

    // ═══════════════════════════════════════════════════════════════
    // COUNT
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT COUNT(*) FROM myfatoorah_transactions WHERE orderStatus = 'PENDING'")
    suspend fun countPending(): Int

    @Query("SELECT COUNT(*) FROM myfatoorah_transactions WHERE orderStatus = 'LINK_SENT'")
    suspend fun countLinkSent(): Int

    @Query("SELECT COUNT(*) FROM myfatoorah_transactions WHERE orderStatus = 'PENDING'")
    fun countPendingFlow(): Flow<Int>

    @Query("SELECT COUNT(*) FROM myfatoorah_transactions WHERE orderStatus = 'LINK_SENT'")
    fun countLinkSentFlow(): Flow<Int>

    // ═══════════════════════════════════════════════════════════════
    // SUM
    // ═══════════════════════════════════════════════════════════════

    @Query("SELECT COALESCE(SUM(amountMinor), 0) FROM myfatoorah_transactions WHERE orderStatus IN ('PENDING', 'LINK_SENT')")
    suspend fun sumPendingAmount(): Long

    // ═══════════════════════════════════════════════════════════════
    // UPDATE
    // ═══════════════════════════════════════════════════════════════

    @Query("""
        UPDATE myfatoorah_transactions 
        SET orderStatus = :orderStatus,
            invoiceId = :invoiceId,
            paymentUrl = :paymentUrl,
            linkSentAt = :linkSentAt
        WHERE localTxnId = :localTxnId
    """)
    suspend fun updateOrderStatus(
        localTxnId: String,
        orderStatus: String,
        invoiceId: String?,
        paymentUrl: String?,
        linkSentAt: Long?
    )

    @Query("""
        UPDATE myfatoorah_transactions 
        SET orderStatus = 'PAID',
            paymentStatus = :paymentStatus,
            paidAt = :paidAt
        WHERE localTxnId = :localTxnId
    """)
    suspend fun markAsPaid(localTxnId: String, paymentStatus: String, paidAt: Long)

    @Query("""
        UPDATE myfatoorah_transactions 
        SET syncStatus = :syncStatus,
            serverTxnId = :serverTxnId,
            lastError = :error,
            syncedAt = :syncedAt
        WHERE localTxnId = :localTxnId
    """)
    suspend fun updateSyncStatus(
        localTxnId: String,
        syncStatus: String,
        serverTxnId: String?,
        error: String?,
        syncedAt: Long?
    )

    // ═══════════════════════════════════════════════════════════════
    // DELETE
    // ═══════════════════════════════════════════════════════════════

    @Query("DELETE FROM myfatoorah_transactions WHERE orderStatus = 'PAID' AND paidAt < :olderThan")
    suspend fun deleteOldPaid(olderThan: Long): Int
}
