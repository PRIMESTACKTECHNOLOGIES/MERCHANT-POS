package com.pos2013.offline.data.model

/**
 * Offline Order - Stored when no internet, processed later
 * 
 * IMPORTANT: This does NOT store card data (illegal).
 * It stores customer info so we can send payment link when online.
 */
data class OfflineOrder(
    val orderId: String,
    val amount: Double,
    val customerName: String,
    val customerPhone: String,
    val description: String = "Purchase",
    val createdAt: Long = System.currentTimeMillis(),
    var status: String = "PENDING", // PENDING, LINK_SENT, PAID, CANCELLED
    var myfatoorahInvoiceId: Long? = null,
    var paymentUrl: String? = null,
    var paidAt: Long? = null
)

// Status meanings:
// PENDING     - Order created offline, waiting for internet
// LINK_SENT   - Payment link generated and sent to customer
// PAID        - Customer completed payment
// CANCELLED   - Order cancelled
// EXPIRED     - Link expired (usually 24-48 hours)
