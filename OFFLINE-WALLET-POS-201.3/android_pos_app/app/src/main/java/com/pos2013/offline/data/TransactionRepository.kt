package com.pos2013.offline.data

import android.content.Context
import android.content.SharedPreferences
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.api.RetrofitClient
import com.pos2013.offline.data.model.*
import com.pos2013.offline.utils.HmacUtil
import com.pos2013.offline.utils.IdGenerator
import com.pos2013.offline.utils.PanEncryptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

/**
 * Repository for transaction operations
 */
class TransactionRepository(
    private val context: Context,
    private val transactionDao: OfflineTransactionDao
) {

    private val prefs: SharedPreferences = context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)

    /**
     * Process a new payment
     */
    suspend fun processPayment(
        cardNumber: String,
        expiry: String,
        amountDollars: Double
    ): PaymentResult = withContext(Dispatchers.IO) {
        try {
            val localTxnId = IdGenerator.generateLocalTxnId()
            val stan = IdGenerator.generateStan(context)
            
            val amountMinor = try {
                java.math.BigDecimal.valueOf(amountDollars)
                    .multiply(java.math.BigDecimal.valueOf(100))
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .intValueExact()
            } catch (e: Exception) {
                0
            }
            
            val timestamp = System.currentTimeMillis()

            val transaction = OfflineTransaction(
                localTxnId = localTxnId,
                stan = stan,
                amountMinor = amountMinor,
                currency = "USD",
                cardLast4 = if (cardNumber.length >= 4) cardNumber.takeLast(4) else cardNumber,
                encryptedPan = try {
                    PanEncryptor.encrypt(context, cardNumber)
                } catch (e: Exception) {
                    null
                },
                cardExpiry = expiry,
                syncStatus = "PENDING",
                timestamp = timestamp
            )

            transactionDao.insert(transaction)

            if (isOnline()) {
                val result = syncTransaction(transaction)
                if (result is SyncResult.Success) {
                    PaymentResult.Success(
                        localTxnId = localTxnId,
                        stan = stan,
                        amount = amountDollars,
                        settlementCode = result.settlementCode,
                        message = "Payment processed successfully"
                    )
                } else {
                    PaymentResult.Pending(
                        localTxnId = localTxnId,
                        stan = stan,
                        amount = amountDollars,
                        message = "Saved offline - will sync when online"
                    )
                }
            } else {
                PaymentResult.Pending(
                    localTxnId = localTxnId,
                    stan = stan,
                    amount = amountDollars,
                    message = "Saved offline - will sync when online"
                )
            }
        } catch (e: Exception) {
            PaymentResult.Error("Failed to process: ${e.message}")
        }
    }

    private suspend fun syncTransaction(transaction: OfflineTransaction): SyncResult {
        return try {
            val batchId = IdGenerator.generateBatchId()
            val nonce = HmacUtil.generateNonce()
            val timestamp = System.currentTimeMillis()

            val txnRequest = TransactionRequest(
                localTxnId = transaction.localTxnId,
                stan = transaction.stan,
                amountMinor = transaction.amountMinor,
                currency = transaction.currency,
                encryptedPan = transaction.encryptedPan,
                cardLast4 = transaction.cardLast4,
                expiry = transaction.cardExpiry,
                txnTimestamp = formatTimestamp(transaction.timestamp)
            )

            val signature = HmacUtil.generateSignature(
                protocolVersion = "201.3",
                merchantId = GatewayConfig.MERCHANT_ID,
                terminalId = GatewayConfig.TERMINAL_ID,
                batchId = batchId,
                timestamp = timestamp,
                nonce = nonce,
                transactionCount = 1
            )

            val request = BatchUploadRequest(
                protocolVersion = "201.3",
                merchantId = GatewayConfig.MERCHANT_ID,
                terminalId = GatewayConfig.TERMINAL_ID,
                batchId = batchId,
                timestamp = timestamp,
                nonce = nonce,
                transactions = listOf(txnRequest),
                signature = signature
            )

            val apiService = RetrofitClient.getApiService()
            val response = apiService.uploadBatch(signature, request)

            if (response.isSuccessful) {
                val body = response.body()
                if (body?.success == true) {
                    transactionDao.markAsSynced(transaction.localTxnId, body.settlementCode ?: "BATCH-$batchId", System.currentTimeMillis())
                    SyncResult.Success(settlementCode = body.settlementCode ?: "BATCH-$batchId")
                } else {
                    SyncResult.Failed(body?.error ?: "Transaction rejected")
                }
            } else {
                SyncResult.Failed("Server error: ${response.code()}")
            }
        } catch (e: Exception) {
            SyncResult.Failed(e.message ?: "Network error")
        }
    }

    suspend fun syncAllPending(): SyncSummary = withContext(Dispatchers.IO) {
        val pending = transactionDao.getPendingTransactions()
        var successCount = 0
        var failedCount = 0
        val settlementCodes = mutableListOf<String>()

        for (transaction in pending) {
            val result = syncTransaction(transaction)
            if (result is SyncResult.Success) {
                successCount++
                result.settlementCode?.let { settlementCodes.add(it) }
            } else {
                failedCount++
            }
        }

        SyncSummary(
            total = pending.size,
            synced = successCount,
            failed = failedCount,
            settlementCodes = settlementCodes
        )
    }

    suspend fun getPendingTransactions(): List<OfflineTransaction> {
        return transactionDao.getPendingTransactions()
    }

    suspend fun getPendingCount(): Int {
        return transactionDao.getPendingCount()
    }

    suspend fun clearSyncedTransactions() {
        val cutoff = System.currentTimeMillis() - (24 * 60 * 60 * 1000)
        transactionDao.deleteOldSynced(cutoff)
    }

    private fun isOnline(): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
            as android.net.ConnectivityManager
        val networkInfo = connectivityManager.activeNetworkInfo
        return networkInfo != null && networkInfo.isConnected
    }

    private fun formatTimestamp(timestamp: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(timestamp))
    }
}
