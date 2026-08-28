package com.pos2013.offline.data.model

import com.google.gson.annotations.SerializedName

/**
 * Request model for batch upload with Protocol 201.3
 * Includes all required fields for backend validation
 */
data class BatchUploadRequest(
    @SerializedName("protocolVersion")
    val protocolVersion: String = "201.3",

    @SerializedName("merchantId")
    val merchantId: String,

    @SerializedName("terminalId")
    val terminalId: String,

    @SerializedName("batchId")
    val batchId: String,

    @SerializedName("timestamp")
    val timestamp: Long,

    @SerializedName("nonce")
    val nonce: String,

    @SerializedName("transactions")
    val transactions: List<TransactionRequest>,

    @SerializedName("signature")
    val signature: String  // HMAC-SHA256 signature
)

/**
 * Response from direct settlement
 */
data class SettleResponse(
    @SerializedName("success")
    val success: Boolean,

    @SerializedName("localTxnId")
    val localTxnId: String,

    @SerializedName("status")
    val status: String,

    @SerializedName("invoiceId")
    val invoiceId: String?,

    @SerializedName("paymentId")
    val paymentId: String?,

    @SerializedName("authCode")
    val authCode: String?,

    @SerializedName("cardBrand")
    val cardBrand: String?,

    @SerializedName("amount")
    val amount: Double?,

    @SerializedName("error")
    val error: String?
)

/**
 * Individual transaction in a batch
 */
data class TransactionRequest(
    @SerializedName("localTxnId")
    val localTxnId: String,  // Required for idempotency

    @SerializedName("stan")
    val stan: String,  // 6-digit trace number

    @SerializedName("amountMinor")
    val amountMinor: Int,  // Changed to Int to match StoredTransaction

    @SerializedName("currency")
    val currency: String = "USD",

    @SerializedName("encryptedPan")
    val encryptedPan: String? = null,

    @SerializedName("cardLast4")
    val cardLast4: String? = null,

    @SerializedName("pan")
    val pan: String? = null,

    @SerializedName("expiry")
    val expiry: String?,

    @SerializedName("txnType")
    val txnType: String = "SALE",

    @SerializedName("entryMode")
    val entryMode: String = "MANUAL",

    @SerializedName("txnTimestamp")
    val txnTimestamp: String  // ISO 8601 format
)

/**
 * Response from batch upload
 */
data class BatchUploadResponse(
    @SerializedName("success")
    val success: Boolean,

    @SerializedName("batchId")
    val batchId: String,

    @SerializedName("settlementCode")
    val settlementCode: String?,  // 6-digit code for receipt

    @SerializedName("message")
    val message: String?,

    @SerializedName("processedCount")
    val processedCount: Int,

    @SerializedName("failedCount")
    val failedCount: Int,

    @SerializedName("error")
    val error: String?  // Only present if failed
)
