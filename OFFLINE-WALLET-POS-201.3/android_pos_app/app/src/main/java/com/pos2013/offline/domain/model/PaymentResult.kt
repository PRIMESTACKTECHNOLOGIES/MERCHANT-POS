package com.pos2013.offline.domain.model

sealed class PaymentResult {
    data class Success(
        val transactionId: String,
        val authCode: String?,
        val settlementCode: String?,
        val amount: Double,
        val isOffline: Boolean = false
    ) : PaymentResult()

    data class Error(
        val message: String,
        val errorCode: String? = null
    ) : PaymentResult()

    object Loading : PaymentResult()
}
