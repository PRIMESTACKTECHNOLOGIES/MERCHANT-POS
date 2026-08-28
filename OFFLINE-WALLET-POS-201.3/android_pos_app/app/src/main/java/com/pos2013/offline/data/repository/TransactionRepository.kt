package com.pos2013.offline.data.repository

import com.pos2013.offline.data.local.dao.TransactionDao
import com.pos2013.offline.data.local.entity.SyncStatus
import com.pos2013.offline.data.local.entity.TransactionEntity
import com.pos2013.offline.data.local.entity.TransactionStatus
import kotlinx.coroutines.flow.Flow
import java.util.*

/**
 * Repository for transaction operations.
 * Provides clean API for ViewModels to interact with transaction data.
 */
class TransactionRepository(private val transactionDao: TransactionDao) {

    val allTransactions: Flow<List<TransactionEntity>> = transactionDao.getAllTransactions()

    val pendingTransactions: Flow<List<TransactionEntity>> = 
        transactionDao.getTransactionsBySyncStatus(SyncStatus.PENDING.name)

    suspend fun insert(transaction: TransactionEntity): Long {
        return transactionDao.insert(transaction)
    }

    suspend fun insertAll(transactions: List<TransactionEntity>): List<Long> {
        return transactionDao.insertAll(transactions)
    }

    suspend fun update(transaction: TransactionEntity) {
        transactionDao.update(transaction)
    }

    suspend fun delete(transaction: TransactionEntity) {
        transactionDao.delete(transaction)
    }

    suspend fun getTransactionById(id: String): TransactionEntity? {
        return transactionDao.getTransactionById(id)
    }

    suspend fun getTransactionByStan(stan: String): TransactionEntity? {
        return transactionDao.getTransactionByStan(stan)
    }

    suspend fun getPendingTransactions(): List<TransactionEntity> {
        return transactionDao.getPendingTransactions()
    }

    suspend fun getFailedTransactionsForRetry(): List<TransactionEntity> {
        return transactionDao.getFailedTransactionsForRetry()
    }

    suspend fun getPendingCount(): Int {
        return transactionDao.getPendingCount()
    }

    suspend fun getFailedCount(): Int {
        return transactionDao.getFailedCount()
    }

    suspend fun getPendingAmount(): Long {
        return transactionDao.getPendingAmount() ?: 0L
    }

    suspend fun getTodaySyncedAmount(): Long {
        return transactionDao.getTodaySyncedAmount() ?: 0L
    }

    suspend fun markAsSynced(
        id: String, 
        settlementCode: String? = null
    ) {
        transactionDao.updateSyncStatus(
            id, 
            SyncStatus.SYNCED.name, 
            System.currentTimeMillis(),
            settlementCode
        )
    }

    suspend fun markAsFailed(id: String, errorMessage: String?) {
        transactionDao.markAsFailed(id, errorMessage)
    }

    suspend fun markAsSyncing(id: String) {
        transactionDao.updateSyncStatus(id, SyncStatus.SYNCING.name, null, null)
    }

    suspend fun approveTransaction(id: String, authCode: String?) {
        transactionDao.updateStatus(id, TransactionStatus.APPROVED.name, authCode)
    }

    suspend fun getRecentTransactions(limit: Int = 50): List<TransactionEntity> {
        return transactionDao.getRecentTransactions(limit)
    }

    suspend fun cleanupOldTransactions(daysToKeep: Int = 30) {
        val cutoffTime = System.currentTimeMillis() - (daysToKeep * 24 * 60 * 60 * 1000)
        transactionDao.deleteOldSyncedTransactions(cutoffTime)
    }
}
