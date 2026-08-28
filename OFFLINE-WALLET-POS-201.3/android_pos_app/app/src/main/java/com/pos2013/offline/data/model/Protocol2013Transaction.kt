package com.pos2013.offline.data.model

/**
 * Protocol 201.3 Transaction Models
 * Supports both CARD and MYFATOORAH_LINK payment methods
 */

data class Protocol2013Transaction(
    val localTxnId: String,
    val stan: String,
    val amountMinor: Int, // Changed back to Int to match SimpleStorage/Repository usage
    val currency: String = "AED",
    val txnType: String = "SALE",
    val entryMode: String = "MANUAL",
    val timestamp: Long = System.currentTimeMillis(),

    // Payment method specific fields
    val paymentMethod: PaymentMethod = PaymentMethod.CARD,

    // For CARD payments
    val cardNumber: String? = null,
    val cardExpiry: String? = null,

    // For MYFATOORAH_LINK payments
    val customerPhone: String? = null,
    val customerName: String? = null,
    val description: String? = null,
    
    // Status fields for storage
    val syncStatus: String = "PENDING",
    val syncedAt: Long? = null
)

enum class PaymentMethod {
    CARD,           // Traditional card processing
    MYFATOORAH_LINK, // MyFatoorah payment link
    CASH            // Cash payment
}

// Batch upload request
data class Protocol2013BatchRequest(
    val protocolVersion: String = "201.3",
    val merchantId: String,
    val terminalId: String,
    val batchId: String,
    val timestamp: Long = System.currentTimeMillis(),
    val nonce: String,
    val signature: String,
    val transactions: List<Protocol2013Transaction>
)

// Response from server
data class Protocol2013BatchResponse(
    val protocolVersion: String,
    val batchId: String,
    val merchantId: String,
    val terminalId: String,
    val timestamp: Long,
    val nonce: String,
    val success: Boolean,
    val processed: Int,
    val failed: Int,
    val settlementCodes: List<String>?,
    val errors: List<String>?
)
