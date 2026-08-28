package com.pos2013.offline.data.model

/**
 * Receipt data model for display in the UI.
 * This is the "face" of the transaction - what the customer sees.
 */
data class ReceiptData(
    /** Transaction amount in decimal format (e.g., 25.00) */
    val amount: Double,
    
    /** Currency code (e.g., "USD", "AED") */
    val currency: String,
    
    /** Masked PAN showing last 4 digits (e.g., "4111********1111") */
    val panMasked: String,
    
    /** Last 4 digits of card (extracted from panMasked) */
    val last4: String = panMasked.takeLast(4).takeIf { it.length == 4 } ?: "****",
    
    /** 6-digit System Trace Audit Number */
    val stan: String,
    
    /** Local transaction ID (e.g., "TXN-LOCAL-001") */
    val localTxnId: String,
    
    /** Transaction timestamp in ISO format */
    val timestamp: String,
    
    /** Formatted date for display */
    val displayDate: String,
    
    /** Formatted time for display */
    val displayTime: String,
    
    /** Whether this was an offline approval (no real-time auth) */
    val offlineApproved: Boolean,
    
    /** Authorization mode: "OFFLINE_APPROVED", "ONLINE_APPROVED", etc. */
    val authMode: String,
    
    /** Current sync status: "PENDING", "SYNCING", "SYNCED", "FAILED" */
    val syncStatus: String,
    
    /** Human-readable status for display */
    val statusDisplay: String = when (syncStatus) {
        "SYNCED" -> "✅ Synced"
        "PENDING" -> "⏳ Pending Sync"
        "SYNCING" -> "🔄 Syncing..."
        "FAILED" -> "❌ Sync Failed"
        else -> syncStatus
    },
    
    /** Entry mode: "CHIP", "CONTACTLESS", "MANUAL", etc. */
    val entryMode: String? = null,
    
    /** Authorization code from issuer (if online) */
    val authCode: String? = null,
    
    /** Retrieval Reference Number (if online) */
    val rrn: String? = null,
    
    /** Settlement code from batch upload */
    val settlementCode: String? = null,
    
    /** Transaction type: "SALE", "REFUND", etc. */
    val txnType: String = "SALE"
) {
    /**
     * Get formatted amount with currency symbol.
     */
    fun getFormattedAmount(): String {
        val symbol = when (currency) {
            "USD" -> "$"
            "AED" -> "AED"
            "EUR" -> "€"
            "GBP" -> "£"
            else -> currency
        }
        return "$symbol${String.format("%.2f", amount)}"
    }
    
    /**
     * Get masked card display for receipt.
     */
    fun getCardDisplay(): String {
        return if (panMasked.length >= 4) {
            "**** **** **** ${panMasked.takeLast(4)}"
        } else {
            "**** **** **** $last4"
        }
    }
    
    /**
     * Check if transaction is still pending sync.
     */
    fun isPending(): Boolean = syncStatus == "PENDING"
    
    /**
     * Check if transaction has been successfully synced.
     */
    fun isSynced(): Boolean = syncStatus == "SYNCED"
}
