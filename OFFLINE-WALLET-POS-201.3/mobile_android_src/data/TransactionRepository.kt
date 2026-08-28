package com.pos2013.offline.data

import com.pos2013.offline.data.api.Payment2013Api
import com.pos2013.offline.data.dao.TransactionDao
import com.pos2013.offline.data.model.Batch
import com.pos2013.offline.data.model.TransactionEntity
import com.pos2013.offline.utils.KeyStoreHelper
import com.pos2013.offline.utils.Protocol2013Helper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

class TransactionRepository(
    private val dao: TransactionDao,
    private val api: Payment2013Api,
    private val merchantId: String,
    private val terminalId: String,
    private val secretKey: String
) {

    // Called when user does an offline payment
    suspend fun createOfflineTransaction(
        amountMinor: Long,
        currency: String,
        panMasked: String,
        expiry: String,
        stan: String,
        timestamp: Long = System.currentTimeMillis()
    ) = withContext(Dispatchers.IO) {
        val tx = TransactionEntity(
            amountMinor = amountMinor,
            currency = currency,
            panMasked = panMasked,
            stan = stan,
            timestamp = timestamp,
            expiry = expiry,
            status = "PENDING"
        )
        dao.insert(tx)
    }

    // Called by sync worker when internet is available
    suspend fun syncPendingTransactions(): Boolean = withContext(Dispatchers.IO) {
        val pending = dao.getByStatus("PENDING")
        if (pending.isEmpty()) return@withContext true

        val batchId = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val nonce = UUID.randomUUID().toString()

        val batch = Batch(
            merchantId = merchantId,
            terminalId = terminalId,
            batchId = batchId,
            timestamp = timestamp,
            nonce = nonce,
            transactions = pending
        )

        // Use TEE (Android Keystore) for signing
        // This ensures the key never leaves the secure hardware
        val signature = KeyStoreHelper.signData(
            "$merchantId|$terminalId|$batchId|$timestamp|$nonce"
        )

        val response = api.uploadBatch(signature, listOf(batch))

        if (response.isSuccessful) {
            dao.updateStatus(pending.map { it.id }, "SYNCED")
            true
        } else {
            false
        }
    }
}
