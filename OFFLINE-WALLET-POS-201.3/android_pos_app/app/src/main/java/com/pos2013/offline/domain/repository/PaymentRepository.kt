package com.pos2013.offline.domain.repository

import com.pos2013.offline.domain.model.PaymentResult

interface PaymentRepository {
    suspend fun processCardPayment(
        amountMinor: Long,
        cardLast4: String,
        cardType: String,
        description: String? = null
    ): PaymentResult

    suspend fun redeemVoucher(
        code: String,
        amount: Double
    ): PaymentResult
}
