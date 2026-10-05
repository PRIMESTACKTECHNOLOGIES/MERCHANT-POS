package com.pos2013.offline.data

import com.pos2013.offline.data.api.Payment2013Api
import com.pos2013.offline.data.api.RedeemRequest
import com.pos2013.offline.data.api.WalletsApi
import com.pos2013.offline.data.api.WalletTopupRequest
import com.pos2013.offline.data.dao.TransactionDao
import com.pos2013.offline.data.dao.WalletTopupDao
import com.pos2013.offline.data.model.OfflineSaleRequest
import com.pos2013.offline.data.model.TransactionEntity
import com.pos2013.offline.data.model.WalletTopupEntity
import com.pos2013.offline.data.model.toOfflineSaleTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * Sync result returned from [syncPendingTransactions].
 * @param success        true if all transactions were uploaded
 * @param settlementCode the 6-digit code returned by the server (if batch was accepted)
 * @param count          number of transactions synced
 * @param errorMessage   human-readable error if success == false
 */
data class SyncResult(
    val success: Boolean,
    val count: Int = 0,
    val walletTopupsSynced: Int = 0,
    val errorMessage: String? = null
)

class TransactionRepository(
    private val dao: TransactionDao,
    private val walletTopupDao: WalletTopupDao,
    private val api: Payment2013Api,
    private val walletsApi: WalletsApi,
    private val merchantId: String,
    private val terminalId: String
) {

    /**
     * Save a new offline transaction to the local Room database.
     */
    suspend fun createOfflineTransaction(
        amountMinor: Long,
        currency: String,
        panMasked: String,
        expiry: String,
        stan: String,
        entryMode: String = "MANUAL",
        txnType: String = "SALE",
        authMode: String = "OFFLINE_APPROVED",
        authCode: String? = null,
        timestamp: Long = System.currentTimeMillis()
    ) = withContext(Dispatchers.IO) {
        val tx = TransactionEntity(
            merchantId = merchantId,
            terminalId = terminalId,
            localTxnId = UUID.randomUUID().toString(),
            amountMinor = amountMinor,
            currency = currency,
            panMasked = panMasked,
            stan = stan,
            expiry = expiry,
            txnType = txnType,
            authMode = authMode,
            entryMode = entryMode,
            authCode = authCode,
            txnTimestamp = timestamp,
            status = "PENDING"
        )
        dao.insert(tx)
    }

    /**
     * Save a new wallet topup to the local Room database.
     */
    suspend fun createOfflineWalletTopup(topup: WalletTopupEntity) = withContext(Dispatchers.IO) {
        walletTopupDao.insert(topup)
    }

    /**
     * Upload all PENDING transactions and wallet topups to the server.
     * Returns a [SyncResult] with the 6-digit settlement code on success.
     */
    suspend fun syncPendingTransactions(): SyncResult = withContext(Dispatchers.IO) {
        // First sync transactions
        val transactionSyncResult = syncTransactions()
        if (!transactionSyncResult.success) {
            return@withContext transactionSyncResult
        }

        // Then sync wallet topups
        val walletTopupsSynced = syncWalletTopups()

        return@withContext transactionSyncResult.copy(
            walletTopupsSynced = walletTopupsSynced
        )
    }

    private suspend fun syncTransactions(): SyncResult = withContext(Dispatchers.IO) {
        val pending = dao.getByStatus("PENDING")
        if (pending.isEmpty()) {
            return@withContext SyncResult(success = true, count = 0)
        }

        val request = OfflineSaleRequest(
            merchant_id = merchantId,
            terminal_id = terminalId,
            transactions = pending.map { it.toOfflineSaleTransaction() }
        )

        return@withContext try {
            val response = api.submitOfflineSale(request)
            if (response.isSuccessful && response.body() != null) {
                val body = response.body()!!
                if (body.ok) {
                    val ids = pending.map { it.id }
                    ids.forEach { dao.markSynced(it) }
                    SyncResult(success = true, count = body.count ?: pending.size)
                } else {
                    SyncResult(success = false, errorMessage = body.message ?: "Server rejected transaction sync")
                }
            } else {
                val code = response.code()
                val errBody = response.errorBody()?.string() ?: "Unknown error"
                SyncResult(success = false, errorMessage = "HTTP $code: $errBody")
            }
        } catch (e: Exception) {
            SyncResult(success = false, errorMessage = e.message)
        }
    }

    private suspend fun syncWalletTopups(): Int = withContext(Dispatchers.IO) {
        val pendingTopups = walletTopupDao.getPendingTopups()
        var syncedCount = 0

        pendingTopups.forEach { topup ->
            try {
                // topup.customerId may hold either a real UUID or a wallet code (PSW-xxxx-xxxx)
                val isWalletCode = topup.customerId.startsWith("PSW-", ignoreCase = true)
                val request = WalletTopupRequest(
                    customerId = if (!isWalletCode) topup.customerId else null,
                    walletCode = if (isWalletCode) topup.customerId.uppercase() else null,
                    amount = topup.amountMinor / 100.0,
                    panMasked = topup.panMasked,
                    expiry = topup.expiry,
                    emvData = topup.emvData,
                    source = "card_offline"
                )

                val response = walletsApi.topupWithCard(request)
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    walletTopupDao.markSynced(topup.id, body.authCode)
                    syncedCount++
                } else {
                    walletTopupDao.markFailed(topup.id, response.errorBody()?.string() ?: "Failed to sync")
                }
            } catch (e: Exception) {
                walletTopupDao.markFailed(topup.id, e.message ?: "Network error")
            }
        }

        syncedCount
    }

    /**
     * Redeem a 6-digit payment code at the terminal.
     * Returns (success, message, reference).
     */
    suspend fun redeemCode(code: String, amount: Double): Triple<Boolean, String, String?> =
        withContext(Dispatchers.IO) {
            return@withContext try {
                val response = api.redeemCode(
                    RedeemRequest(code = code, amount = amount, merchantId = merchantId)
                )
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    Triple(true, body.message ?: "Payment successful", body.reference)
                } else {
                    val msg = response.body()?.message
                        ?: response.body()?.error
                        ?: "Code rejected (HTTP ${response.code()})"
                    Triple(false, msg, null)
                }
            } catch (e: Exception) {
                Triple(false, "Network error: ${e.message}", null)
            }
        }

    suspend fun getPendingCount(): Int = withContext(Dispatchers.IO) {
        dao.countByStatus("PENDING")
    }
}
