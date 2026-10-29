package com.pos2013.offline.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.pos2013.offline.data.api.OfflineSaleTransaction

// ── Offline transactions: POS sales queued locally before sync ─────────────
@Entity(tableName = "transactions")
data class TransactionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val localTxnId: String,
    val merchantId: String,
    val terminalId: String,
    val stan: String,
    val amountMinor: Long,
    val currency: String,
    val panMasked: String,
    val expiry: String,
    val txnType: String = "SALE",
    val authMode: String = "OFFLINE_APPROVED",
    val entryMode: String = "MANUAL",
    val txnTimestamp: Long = System.currentTimeMillis(),
    val rrn: String? = null,
    val authCode: String? = null,
    val approvalCode: String? = null,
    val protocol: String? = "201.3",
    val emvData: String? = null,
    val settlementId: String? = null,
    val settlementStatus: String? = "PENDING",
    val errorMessage: String? = null,
    val status: String = "PENDING",
    val syncedAt: Long? = null
)

fun TransactionEntity.toOfflineSaleTransaction(): OfflineSaleTransaction = OfflineSaleTransaction(
    localTxnId = this.localTxnId,
    stan = this.stan,
    amountMinor = this.amountMinor,
    currency = this.currency,
    panMasked = this.panMasked,
    expiry = this.expiry,
    entryMode = this.entryMode,
    authMode = this.authMode,
    txnType = this.txnType,
    txnTimestamp = this.txnTimestamp,
    rrn = this.rrn,
    authCode = this.authCode,
    emvData = this.emvData,
    approvalCode = this.approvalCode
)

// ── Wallet topups queued locally (customer load via card) ───────────────────
@Entity(tableName = "wallet_topups")
data class WalletTopupEntity(
    @PrimaryKey val id: String,
    val customerId: String,
    val amountMinor: Long,
    val currency: String = "USD",
    val panMasked: String,
    val expiry: String = "",
    val txnTimestamp: Long = System.currentTimeMillis(),
    val authMode: String = "OFFLINE_APPROVED",
    val entryMode: String = "CHIP",
    val status: String = "PENDING",
    val authCode: String? = null,
    val emvData: String? = null,
    val syncError: String? = null,
    val syncedAt: Long? = null
)

// ── EMV card data captured from reader ─────────────────────────────────────
data class EmvCardData(
    val pan: String,
    val expiryDate: String,
    val cardholderName: String? = null,
    val applicationLabel: String? = null,
    val aid: String? = null,
    val emvData: String? = null,
    val tlvData: String? = null,
    val track2Equivalent: String? = null,
    val readerSource: String = "ACS_READER"
)

// ── Batch ───────────────────────────────────────────────────────────────────
data class Batch(
    val id: String,
    val code: String,
    val status: String,
    val count: Int = 0,
    val totalAmount: Double = 0.0,
    val currency: String = "USD"
)

// ── Dashboard data entity (cached locally for offline display) ──────────────
@Entity(tableName = "dashboard_cache")
data class DashboardCacheEntity(
    @PrimaryKey val id: String = "singleton",
    val statsJson: String,
    val cachedAt: Long = System.currentTimeMillis()
)

// ── Receipt cache ───────────────────────────────────────────────────────────
@Entity(tableName = "receipts_cache")
data class ReceiptCacheEntity(
    @PrimaryKey val id: String,
    val transactionId: String? = null,
    val plainText: String? = null,
    val escpos: String? = null,
    val qrContent: String? = null,
    val generatedAt: Long = System.currentTimeMillis(),
    val printedAt: Long? = null,
    val emailedAt: Long? = null,
    val smsedAt: Long? = null
)

// ── Sync queue for generic operations (retryable payloads) ──────────────────
@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val groupKey: String,
    val endpoint: String,
    val method: String = "POST",
    val payloadJson: String,
    val headersJson: String? = null,
    val status: String = "PENDING",
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val syncedAt: Long? = null,
    val responseRef: String? = null
)

// ── Audit event for local activity (printed receipts, logins, etc) ──────────
@Entity(tableName = "local_audit_events")
data class LocalAuditEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val actor: String,
    val action: String,
    val entityType: String? = null,
    val entityId: String? = null,
    val note: String? = null,
    val ipAddress: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

// ── Terminal pairing record ─────────────────────────────────────────────────
@Entity(tableName = "paired_terminals")
data class PairedTerminalEntity(
    @PrimaryKey val terminalId: String,
    val merchantId: String,
    val name: String? = null,
    val secretKeyHash: String? = null,
    val offlineEnabled: Boolean = true,
    val lastSeenAt: Long? = null,
    val deviceSerial: String? = null,
    val pairedAt: Long = System.currentTimeMillis()
)

// ── Product cache ────────────────────────────────────────────────────────────
@Entity(tableName = "products_cache")
data class ProductCacheEntity(
    @PrimaryKey val id: String,
    val sku: String? = null,
    val name: String,
    val category: String? = null,
    val price: Double = 0.0,
    val stockQty: Int = 0,
    val currency: String = "USD",
    val barcode: String? = null,
    val json: String,
    val syncedAt: Long = System.currentTimeMillis()
)
