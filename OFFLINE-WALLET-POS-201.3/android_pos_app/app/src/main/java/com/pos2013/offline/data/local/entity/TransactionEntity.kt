package com.pos2013.offline.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity for storing POS transactions offline.
 * Supports Protocol 201.3 with comprehensive transaction data.
 */
@Entity(
    tableName = "transactions",
    indices = [
        Index(value = ["batch_id"]),
        Index(value = ["stan"]),
        Index(value = ["status"]),
        Index(value = ["sync_status"]),
        Index(value = ["local_txn_id"], unique = true)
    ]
)
data class TransactionEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "local_txn_id")
    val localTxnId: String,

    @ColumnInfo(name = "batch_id")
    val batchId: String,

    @ColumnInfo(name = "merchant_id")
    val merchantId: String,

    @ColumnInfo(name = "terminal_id")
    val terminalId: String,

    @ColumnInfo(name = "stan")
    val stan: String, // System Trace Audit Number (6-digit)

    @ColumnInfo(name = "amount_minor")
    val amountMinor: Long, // Amount in minor units (cents)

    @ColumnInfo(name = "currency")
    val currency: String = "AED",

    @ColumnInfo(name = "pan_masked")
    val panMasked: String?, // Masked card number

    @ColumnInfo(name = "encrypted_pan")
    val encryptedPan: String?, // JSON or Base64 ciphertext

    @ColumnInfo(name = "encrypted_exp_month")
    val encryptedExpMonth: String?,

    @ColumnInfo(name = "encrypted_exp_year")
    val encryptedExpYear: String?,

    @ColumnInfo(name = "encrypted_cvv")
    val encryptedCvv: String?,

    @ColumnInfo(name = "aes_key")
    val aesKey: String?,

    @ColumnInfo(name = "aes_iv")
    val aesIv: String?,

    @ColumnInfo(name = "aes_tag")
    val aesTag: String?,

    @ColumnInfo(name = "invoice_id")
    var invoiceId: String?,

    @ColumnInfo(name = "payment_id")
    var paymentId: String?,

    @ColumnInfo(name = "card_brand")
    var cardBrand: String?,

    @ColumnInfo(name = "card_type")
    val cardType: String?, // VISA, MASTERCARD, etc.

    @ColumnInfo(name = "txn_type")
    val txnType: String = "SALE", // SALE, REFUND, VOID

    @ColumnInfo(name = "auth_mode")
    val authMode: String = "OFFLINE_APPROVED", // OFFLINE_APPROVED, ONLINE

    @ColumnInfo(name = "entry_mode")
    val entryMode: String = "KEYED", // KEYED, SWIPE, CHIP, CONTACTLESS

    @ColumnInfo(name = "rrn")
    val rrn: String?, // Retrieval Reference Number

    @ColumnInfo(name = "auth_code")
    val authCode: String?, // Authorization code from bank

    @ColumnInfo(name = "settlement_code")
    val settlementCode: String?, // 6-digit settlement code

    @ColumnInfo(name = "status")
    val status: String = TransactionStatus.PENDING.name,

    @ColumnInfo(name = "sync_status")
    val syncStatus: String = SyncStatus.PENDING.name,

    @ColumnInfo(name = "error_message")
    val errorMessage: String?,

    @ColumnInfo(name = "emv_data")
    val emvData: String?, // JSON EMV data

    @ColumnInfo(name = "receipt_data")
    val receiptData: String?, // JSON receipt data

    @ColumnInfo(name = "customer_name")
    val customerName: String?,

    @ColumnInfo(name = "customer_mobile")
    val customerMobile: String?,

    @ColumnInfo(name = "description")
    val description: String?,

    @ColumnInfo(name = "txn_timestamp")
    val txnTimestamp: Long, // Transaction timestamp

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),

    @ColumnInfo(name = "synced_at")
    val syncedAt: Long? = null,

    @ColumnInfo(name = "retry_count")
    val retryCount: Int = 0
) {
    fun getAmountDisplay(): String {
        val amount = amountMinor / 100.0
        return String.format("%,.2f %s", amount, currency)
    }

    fun isPending(): Boolean = syncStatus == SyncStatus.PENDING.name
    fun isSynced(): Boolean = syncStatus == SyncStatus.SYNCED.name
    fun isFailed(): Boolean = syncStatus == SyncStatus.FAILED.name
}

enum class TransactionStatus {
    PENDING,      // Transaction created, not yet processed
    APPROVED,     // Approved (offline or online)
    DECLINED,     // Declined by bank/gateway
    SETTLED,      // Successfully settled
    REVERSED,     // Reversed/voided
    REFUNDED      // Refunded
}

enum class SyncStatus {
    PENDING,      // Waiting to sync
    SYNCING,      // Currently syncing
    SYNCED,       // Successfully synced
    FAILED,       // Sync failed
    DUPLICATE     // Duplicate transaction detected
}
