package com.pos2013.offline.data.model

sealed class PaymentResult {
    data class Success(
        val localTxnId: String,
        val stan: String,
        val amount: Double = 0.0,
        val settlementCode: String?,
        val message: String
    ) : PaymentResult()
    
    data class Pending(
        val localTxnId: String,
        val stan: String,
        val amount: Double = 0.0,
        val message: String
    ) : PaymentResult()
    
    data class Error(val message: String) : PaymentResult()
}

sealed class SyncResult {
    data class Success(val settlementCode: String?) : SyncResult()
    data class Failed(val error: String) : SyncResult()
    val success: Boolean get() = this is Success
}

data class SyncSummary(
    val total: Int,
    val synced: Int,
    val failed: Int,
    val settlementCodes: List<String>
)

sealed class RedeemResult {
    data class Success(val message: String, val reference: String?, val settlementCode: String?) : RedeemResult()
    data class Error(val message: String) : RedeemResult()
}

data class StoredTransaction(
    val localTxnId: String,
    val stan: String,
    val amountMinor: Int,
    val cardLast4: String,
    val encryptedPan: String?,
    val cardExpiry: String,
    val timestamp: Long,
    val syncStatus: String = "PENDING",
    val synced: Boolean = false,
    val settlementCode: String? = null,
    val syncedAt: Long? = null,
    val lastError: String? = null
)

data class SettlementRecord(
    val settlementCode: String,
    val timestamp: Long,
    val totalAmountMinor: Int,
    val txCount: Int,
    val status: String = "SUCCESS"
)
