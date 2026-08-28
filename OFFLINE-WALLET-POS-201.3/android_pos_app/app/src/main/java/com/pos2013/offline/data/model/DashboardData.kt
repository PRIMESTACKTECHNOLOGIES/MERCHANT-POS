package com.pos2013.offline.data.model

/**
 * Dashboard overview statistics.
 */
data class DashboardStats(
    /** Total number of transactions */
    val totalTransactions: Int = 0,
    
    /** Currently pending sync */
    val pendingCount: Int = 0,
    
    /** Successfully synced */
    val syncedCount: Int = 0,
    
    /** Failed to sync */
    val failedCount: Int = 0,
    
    /** Currently syncing (in progress) */
    val syncingCount: Int = 0,
    
    /** Total amount pending sync (in minor units) */
    val pendingAmountMinor: Long = 0,
    
    /** Total amount synced (in minor units) */
    val syncedAmountMinor: Long = 0,
    
    /** Last successful sync timestamp */
    val lastSyncTime: Long? = null,
    
    /** Is sync currently running */
    val isSyncing: Boolean = false,
    
    /** Next scheduled sync time */
    val nextSyncTime: Long? = null
) {
    /** Get pending amount as formatted decimal */
    fun getPendingAmount(currency: String = "USD"): String {
        return formatAmount(pendingAmountMinor, currency)
    }
    
    /** Get synced amount as formatted decimal */
    fun getSyncedAmount(currency: String = "USD"): String {
        return formatAmount(syncedAmountMinor, currency)
    }
    
    private fun formatAmount(minor: Long, currency: String): String {
        val symbol = when (currency) {
            "USD" -> "$"
            "AED" -> "AED"
            "EUR" -> "€"
            "GBP" -> "£"
            else -> currency
        }
        val amount = minor / 100.0
        return "$symbol${String.format("%,.2f", amount)}"
    }
    
    /** Calculate sync success rate */
    fun getSyncSuccessRate(): Int {
        val completed = syncedCount + failedCount
        return if (completed > 0) {
            ((syncedCount.toDouble() / completed) * 100).toInt()
        } else 100
    }
}

/**
 * Transaction item for dashboard list.
 */
data class DashboardTransactionItem(
    val localTxnId: String,
    val stan: String,
    val amount: Double,
    val currency: String,
    val cardLast4: String,
    val timestamp: Long,
    val syncStatus: SyncStatus,
    val txnType: TransactionType,
    val errorMessage: String? = null
) {
    enum class SyncStatus {
        PENDING, SYNCING, SYNCED, FAILED
    }
    
    enum class TransactionType {
        POS_OFFLINE, MYFATOORAH, CASH
    }
    
    fun getFormattedAmount(): String {
        val symbol = when (currency) {
            "USD" -> "$"
            "AED" -> "AED"
            "EUR" -> "€"
            "GBP" -> "£"
            else -> currency
        }
        return "$symbol${String.format("%,.2f", amount)}"
    }
    
    fun getStatusDisplay(): String = when (syncStatus) {
        SyncStatus.PENDING -> "⏳ Pending"
        SyncStatus.SYNCING -> "🔄 Syncing"
        SyncStatus.SYNCED -> "✅ Synced"
        SyncStatus.FAILED -> "❌ Failed"
    }
    
    fun getTypeDisplay(): String = when (txnType) {
        TransactionType.POS_OFFLINE -> "💳 POS"
        TransactionType.MYFATOORAH -> "🔗 MyFatoorah"
        TransactionType.CASH -> "💵 Cash"
    }
}

/**
 * MyFatoorah-specific dashboard data.
 */
data class MyFatoorahDashboardStats(
    val pendingOrders: Int = 0,
    val linkSentCount: Int = 0,
    val paidCount: Int = 0,
    val totalPendingAmount: Double = 0.0,
    val failedPayments: Int = 0
)

/**
 * Complete dashboard state.
 */
data class DashboardState(
    val stats: DashboardStats = DashboardStats(),
    val pendingTransactions: List<DashboardTransactionItem> = emptyList(),
    val recentTransactions: List<DashboardTransactionItem> = emptyList(),
    val failedTransactions: List<DashboardTransactionItem> = emptyList(),
    val myFatoorahStats: MyFatoorahDashboardStats = MyFatoorahDashboardStats(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val lastUpdated: Long = System.currentTimeMillis()
)
