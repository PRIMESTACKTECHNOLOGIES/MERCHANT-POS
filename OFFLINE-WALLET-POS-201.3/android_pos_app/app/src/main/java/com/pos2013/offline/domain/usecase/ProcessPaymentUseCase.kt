package com.pos2013.offline.domain.usecase

import com.pos2013.offline.domain.model.PaymentResult
import com.pos2013.offline.domain.repository.PaymentRepository

/**
 * Business logic for processing a payment.
 * Handles validation and interacts with the repository.
 */
class ProcessPaymentUseCase(
    private val paymentRepository: PaymentRepository
) {
    /**
     * Executes the payment process.
     * 
     * @param amountMinor Amount in cents (e.g., 100 for 1.00 AED)
     * @param cardLast4 Last 4 digits of the card
     * @param cardType Card network (VISA, MASTERCARD, etc.)
     * @param description Optional description
     * @return PaymentResult (Success/Error)
     */
    suspend operator fun invoke(
        amountMinor: Long,
        cardLast4: String,
        cardType: String,
        description: String? = null
    ): PaymentResult {
        // 1. Business Rules Validation
        if (amountMinor <= 0) {
            return PaymentResult.Error("Amount must be greater than zero")
        }

        if (cardLast4.length != 4) {
            return PaymentResult.Error("Invalid card details")
        }

        // 2. Delegate to Repository for the actual processing logic
        // (The repository will decide if it needs to be saved offline or sent online)
        return paymentRepository.processCardPayment(
            amountMinor = amountMinor,
            cardLast4 = cardLast4,
            cardType = cardType,
            description = description
        )
    }
}
