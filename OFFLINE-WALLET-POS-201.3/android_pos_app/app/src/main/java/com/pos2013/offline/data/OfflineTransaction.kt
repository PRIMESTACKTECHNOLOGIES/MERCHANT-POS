package com.pos2013.offline.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "offline_transactions",
    indices = [
        Index(value = ["localTxnId"], unique = true),
        Index(value = ["syncStatus"])
    ]
)
data class OfflineTransaction(
    @PrimaryKey
    val localTxnId: String,
    val stan: String,
    val amountMinor: Int, 
    val currency: String = "USD",
    val cardLast4: String,
    val encryptedPan: String? = null,
    val cardExpiry: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val syncStatus: String = "PENDING", // PENDING, SYNCING, SYNCED, FAILED
    val settlementCode: String? = null,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val syncedAt: Long? = null
)
