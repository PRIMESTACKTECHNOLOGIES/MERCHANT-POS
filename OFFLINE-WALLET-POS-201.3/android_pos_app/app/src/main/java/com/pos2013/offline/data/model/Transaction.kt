package com.pos2013.offline.data.model

data class Transaction(
    val id: String = java.util.UUID.randomUUID().toString(),
    val amountMinor: Long,
    val currency: String,
    val panMasked: String,
    val stan: String,
    val timestamp: Long = System.currentTimeMillis(),
    val expiry: String,
    val status: String = "PENDING"
)
