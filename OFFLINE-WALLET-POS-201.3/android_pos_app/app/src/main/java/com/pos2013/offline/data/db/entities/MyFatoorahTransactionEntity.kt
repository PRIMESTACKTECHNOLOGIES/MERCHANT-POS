package com.pos2013.offline.data.db.entities

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room Entity for MyFatoorah offline orders.
 * Maps to 'myfatoorah_transactions' table in SQLite.
 */
@Entity(
    tableName = "myfatoorah_transactions",
    indices = [
        Index(value = ["syncStatus"]),
        Index(value = ["orderStatus"]),
        Index(value = ["localTxnId"], unique = true)
    ]
)
data class MyFatoorahTransactionEntity(
    @PrimaryKey
    val localTxnId: String,          // Local order ID: "MF-ORDER-123456"
    
    // MyFatoorah-specific fields
    val invoiceId: String?,          // MyFatoorah InvoiceId after creation
    val paymentUrl: String?,         // Payment link URL
    val mfReference: String?,        // MyFatoorah reference number
    
    // Amount
    val amountMinor: Long,           // Amount in minor units
    val currency: String,            // "AED", "USD", etc.
    
    // Customer details
    val customerName: String?,
    val customerMobile: String?,
    val customerEmail: String?,
    
    // Item details
    val itemName: String,            // Product/service description
    val quantity: Int,
    val unitPrice: Long,
    
    // Status tracking
    val orderStatus: String,         // "PENDING", "LINK_SENT", "PAID", "EXPIRED"
    val paymentStatus: String?,      // MyFatoorah payment status
    
    // Sync tracking
    val syncStatus: String,          // "PENDING", "SYNCING", "SYNCED", "FAILED"
    val serverTxnId: String?,        // Server-assigned ID
    val lastError: String?,          // Last error message
    val retryCount: Int = 0,
    
    // Timestamps
    val txnTimestamp: String,        // ISO format
    val createdAt: Long,             // System time
    val linkSentAt: Long? = null,    // When payment link was sent
    val paidAt: Long? = null,        // When payment was received
    val syncedAt: Long? = null       // When synced to server
)
