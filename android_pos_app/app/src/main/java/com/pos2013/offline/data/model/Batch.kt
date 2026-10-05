package com.pos2013.offline.data.model

data class OfflineSaleTransaction(
    val localTxnId: String,
    val stan: String,
    val amount: Double,
    val currency: String = "AED",
    val card_masked: String,
    val expiry: String? = null,
    val txn_type: String = "SALE",
    val auth_mode: String = "OFFLINE_APPROVED",
    val entry_mode: String = "MANUAL",
    val auth_code: String? = null,
    val txn_timestamp: Long,
    val rrn: String? = null
)

data class OfflineSaleRequest(
    val merchant_id: String,
    val terminal_id: String,
    val transactions: List<OfflineSaleTransaction>
)

fun TransactionEntity.toOfflineSaleTransaction() = OfflineSaleTransaction(
    localTxnId = localTxnId,
    stan = stan,
    amount = amountMinor / 100.0,
    currency = currency,
    card_masked = panMasked,
    expiry = expiry.ifEmpty { null },
    txn_type = txnType,
    auth_mode = authMode,
    entry_mode = entryMode,
    auth_code = authCode,
    txn_timestamp = txnTimestamp,
    rrn = rrn
)
