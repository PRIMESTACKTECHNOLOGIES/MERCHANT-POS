package com.pos2013.offline.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.pos2013.offline.data.MyFatoorahRepository
import com.pos2013.offline.data.OfflineOrderManager
import com.pos2013.offline.data.SimpleStorage
import com.pos2013.offline.data.model.DashboardStats
import com.pos2013.offline.data.model.DashboardTransactionItem
import com.pos2013.offline.data.model.MyFatoorahDashboardStats
import com.pos2013.offline.data.model.DashboardState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import java.util.Date

/**
 * Repository for aggregating dashboard data from all sources.
 * 
 * Combines:
 * - POS offline transactions (SimpleStorage)
 * - MyFatoorah orders (OfflineOrderManager)
 * - Sync status
 */
class DashboardRepository(
    private val context: Context
) {
    private val storage = SimpleStorage(context)
    private val orderManager = OfflineOrderManager(context)
    private val myFatoorahRepo = MyFatoorahRepository(context)
    private val prefs: SharedPreferences = context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)

    /**
     * Get complete dashboard state as a Flow for real-time updates.
     */
    fun getDashboardState(): Flow<DashboardState> = flow {
        emit(loadDashboardState())
    }.flowOn(Dispatchers.IO)

    /**
     * Load current dashboard state (one-time).
     */
    suspend fun loadDashboardState(): DashboardState {
        val posTransactions = storage.getAllTransactions()
        
        // Calculate stats
        val pending = posTransactions.filter { it.syncStatus == "PENDING" }
        val synced = posTransactions.filter { it.syncStatus == "SYNCED" }
        val failed = posTransactions.filter { it.syncStatus == "FAILED" }
        val syncing = posTransactions.filter { it.syncStatus == "SYNCING" }
        
        val stats = DashboardStats(
            totalTransactions = posTransactions.size,
            pendingCount = pending.size,
            syncedCount = synced.size,
            failedCount = failed.size,
            syncingCount = syncing.size,
            pendingAmountMinor = pending.sumOf { it.amountMinor.toLong() },
            syncedAmountMinor = synced.sumOf { it.amountMinor.toLong() },
            lastSyncTime = prefs.getLong("last_sync_time", 0).takeIf { it > 0 }
        )
        
        // Map to dashboard items
        val pendingItems = pending
            .sortedBy { it.timestamp }
            .map { it.toDashboardItem() }
        
        val recentItems = posTransactions
            .sortedByDescending { it.timestamp }
            .take(20)
            .map { it.toDashboardItem() }
        
        val failedItems = failed
            .sortedByDescending { it.timestamp }
            .map { it.toDashboardItem() }
        
        // MyFatoorah stats
        val myFatoorahStats = MyFatoorahDashboardStats(
            pendingOrders = orderManager.getPendingCount(),
            linkSentCount = orderManager.getLinkSentCount(),
            paidCount = 0, // TODO: Track paid orders
            totalPendingAmount = orderManager.getPendingOrders().sumOf { it.amount },
            failedPayments = 0
        )
        
        return DashboardState(
            stats = stats,
            pendingTransactions = pendingItems,
            recentTransactions = recentItems,
            failedTransactions = failedItems,
            myFatoorahStats = myFatoorahStats,
            lastUpdated = System.currentTimeMillis()
        )
    }

    /**
     * Trigger manual sync and return results.
     */
    suspend fun syncNow(): SyncResult {
        return try {
            val syncRepo = SyncRepositoryImpl(context)
            val summary = syncRepo.syncPending()
            
            // Save last sync time
            prefs.edit().putLong("last_sync_time", System.currentTimeMillis()).apply()
            
            SyncResult.Success(
                synced = summary.synced,
                failed = summary.failed,
                total = summary.total
            )
        } catch (e: Exception) {
            SyncResult.Error(e.message ?: "Sync failed")
        }
    }

    /**
     * Clear old synced transactions.
     */
    fun clearOldTransactions(olderThanDays: Int = 7): Int {
        val cutoff = System.currentTimeMillis() - (olderThanDays * 24 * 60 * 60 * 1000)
        val before = storage.getAllTransactions().size
        storage.clearOldSynced(cutoff)
        val after = storage.getAllTransactions().size
        return before - after
    }

    /**
     * Get transaction details by ID.
     */
    fun getTransactionDetails(localTxnId: String): DashboardTransactionItem? {
        return storage.getAllTransactions()
            .find { it.localTxnId == localTxnId }
            ?.toDashboardItem()
    }

    /**
     * Convert StoredTransaction to DashboardTransactionItem.
     */
    private fun com.pos2013.offline.data.StoredTransaction.toDashboardItem(): DashboardTransactionItem {
        return DashboardTransactionItem(
            localTxnId = localTxnId,
            stan = stan,
            amount = amountMinor / 100.0,
            currency = currency,
            cardLast4 = cardLast4,
            timestamp = timestamp,
            syncStatus = when (syncStatus) {
                "PENDING" -> DashboardTransactionItem.SyncStatus.PENDING
                "SYNCING" -> DashboardTransactionItem.SyncStatus.SYNCING
                "SYNCED" -> DashboardTransactionItem.SyncStatus.SYNCED
                "FAILED" -> DashboardTransactionItem.SyncStatus.FAILED
                else -> DashboardTransactionItem.SyncStatus.PENDING
            },
            txnType = DashboardTransactionItem.TransactionType.POS_OFFLINE,
            errorMessage = lastError
        )
    }

    sealed class SyncResult {
        data class Success(val synced: Int, val failed: Int, val total: Int) : SyncResult()
        data class Error(val message: String) : SyncResult()
    }
}
