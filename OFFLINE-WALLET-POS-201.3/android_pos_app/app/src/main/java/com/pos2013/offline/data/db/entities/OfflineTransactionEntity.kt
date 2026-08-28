package com.pos2013.offline.data.db.entities

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room Entity for offline POS transactions.
 * Maps to 'offline_transactions' table in SQLite.
 */
@Entity(
    tableName = "offline_transactions",
    indices = [
        Index(value = ["syncStatus"]),
        Index(value = ["txnTimestamp"]),
        Index(value = ["localTxnId"], unique = true)
    ]
)
data class OfflineTransactionEntity(
    @PrimaryKey
    val localTxnId: String,          // "TXN-LOCAL-001"
    
    val stan: String,                // "000001" (6-digit STAN)
    val amountMinor: Long,           // 2500 ($25.00)
    val currency: String,            // "USD", "AED", etc.
    
    // Card information (masked for display)
    val panMasked: String,           // "4111********1111"
    
    // Transaction details
    val txnType: String,             // "SALE", "REFUND", "PREAUTH"
    val authMode: String,            // "OFFLINE_APPROVED", "ONLINE_APPROVED"
    val entryMode: String,           // "MANUAL", "CHIP", "CONTACTLESS", "SWIPE"
    
    // Optional authorization data
    val rrn: String?,                // Retrieval Reference Number
    val authCode: String?,           // Authorization Code from issuer
    val emvDataJson: String?,        // EMV tag data as JSON string
    
    // Timestamps
    val txnTimestamp: String,        // ISO 8601 format: "2026-03-24T10:00:00Z"
    val createdAt: Long,             // System.currentTimeMillis()
    
    // Sync tracking
    val syncStatus: String,          // "PENDING", "SYNCING", "SYNCED", "FAILED"
    val serverTxnId: String?,        // ID assigned by server after sync
    val lastError: String?,          // Last sync error message
    val retryCount: Int = 0,         // Number of sync attempts
    val syncedAt: Long? = null       // When successfully synced
)
