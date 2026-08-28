package com.pos2013.offline.data.model

data class Batch(
    val protocolVersion: String = "201.3",
    val merchantId: String,
    val terminalId: String,
    val batchId: String,
    val timestamp: Long,
    val nonce: String,
    val transactions: List<Transaction>
)
