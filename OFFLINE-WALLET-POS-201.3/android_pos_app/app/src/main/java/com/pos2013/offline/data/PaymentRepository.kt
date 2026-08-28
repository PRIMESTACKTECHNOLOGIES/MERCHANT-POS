package com.pos2013.offline.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.api.*
import com.pos2013.offline.data.model.*
import com.pos2013.offline.utils.HmacUtil
import com.pos2013.offline.utils.IdGenerator
import com.pos2013.offline.utils.PanEncryptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.*

class PaymentRepository(
    private val context: Context
) {
    private val TAG = "PaymentRepository"
    private val storage = SimpleStorage(context)
    private val apiService = RetrofitClient.getApiService()
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    // Process a new payment
    suspend fun processPayment(
        cardNumber: String,
        cardExpiry: String,
        cardCvv: String?,
        amount: Double
    ): PaymentResult = withContext(Dispatchers.IO) {
        try {
            // Use BigDecimal to avoid floating point rounding issues when converting to minor units.
            val amountMinor = try {
                java.math.BigDecimal.valueOf(amount)
                    .multiply(java.math.BigDecimal.valueOf(100))
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .intValueExact()
            } catch (e: ArithmeticException) {
                Int.MAX_VALUE
            }
            val localTxnId = IdGenerator.generateLocalTxnId()
            val stan = IdGenerator.generateStan(context)
            val timestamp = System.currentTimeMillis()

            // NEW OFFLINE ENCRYPTION FOR SYNC
            val expiryParts = cardExpiry.split("/")
            val expMonth = if (expiryParts.size >= 1) expiryParts[0] else "01"
            val expYear = if (expiryParts.size >= 2) "20" + expiryParts[1] else "2026"

            val syncPayload = try {
                com.pos2013.offline.utils.SyncEncryptor.encryptCardData(
                    pan = cardNumber,
                    expMonth = expMonth,
                    expYear = expYear,
                    cvv = cardCvv ?: "000"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Sync encryption failed", e)
                null
            }
            
            val cardLast4 = cardNumber.takeLast(4)

            val transaction = StoredTransaction(
                localTxnId = localTxnId,
                stan = stan,
                amountMinor = amountMinor.toLong(),
                cardLast4 = cardLast4,
                encryptedPan = syncPayload?.encryptedPan,
                encryptedExpMonth = syncPayload?.encryptedExpMonth,
                encryptedExpYear = syncPayload?.encryptedExpYear,
                encryptedCvv = syncPayload?.encryptedCvv,
                aesKey = syncPayload?.aesKey,
                cardExpiry = cardExpiry,
                timestamp = timestamp,
                syncStatus = "PENDING",
                synced = false
            )

            // Save to storage immediately
            storage.saveTransaction(transaction)

            // Try to sync immediately if online
            if (isNetworkAvailable()) {
                val syncResult = syncTransaction(transaction)

                if (syncResult is SyncResult.Success) {
                    PaymentResult.Success(
                        localTxnId = localTxnId,
                        stan = stan,
                        amount = amount,
                        settlementCode = syncResult.settlementCode,
                        message = "Payment processed successfully"
                    )
                } else {
                    PaymentResult.Pending(
                        localTxnId = localTxnId,
                        stan = stan,
                        amount = amount,
                        message = "Saved offline. Will sync when online."
                    )
                }
            } else {
                PaymentResult.Pending(
                    localTxnId = localTxnId,
                    stan = stan,
                    amount = amount,
                    message = "No internet. Payment saved and will sync when online."
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing payment", e)
            PaymentResult.Error("Failed to process: ${e.message}")
        }
    }

    // Sync a single transaction
    private suspend fun syncTransaction(transaction: StoredTransaction): SyncResult {
        return try {
            storage.updateStatus(transaction.localTxnId, "SYNCING")

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
                txnType = "SALE",
                entryMode = "MANUAL",
                txnTimestamp = isoFormat.format(Date(transaction.timestamp))
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

            val response = apiService.uploadBatch(signature, request)

            if (response.isSuccessful) {
                val body = response.body()
                if (body?.success == true) {
                    storage.markAsSynced(transaction.localTxnId, body.settlementCode ?: "")
                    SyncResult.Success(body.settlementCode)
                } else {
                    val error = body?.error ?: "Unknown error"
                    handleSyncFailure(transaction, error)
                    SyncResult.Failed(error)
                }
            } else {
                val error = "Server error: ${response.code()}"
                handleSyncFailure(transaction, error)
                SyncResult.Failed(error)
            }
        } catch (e: Exception) {
            handleSyncFailure(transaction, e.message ?: "Sync failed")
            SyncResult.Failed(e.message ?: "Sync failed")
        }
    }

    private suspend fun handleSyncFailure(transaction: StoredTransaction, error: String) {
        storage.updateStatus(transaction.localTxnId, "FAILED", error)
    }

    suspend fun syncPendingTransactions(): SyncSummary = withContext(Dispatchers.IO) {
        val pending = storage.getPendingTransactions()
        var successCount = 0
        var failedCount = 0
        val settlementCodes = mutableListOf<String>()

        for (transaction in pending) {
            when (val result = syncTransaction(transaction)) {
                is SyncResult.Success -> {
                    successCount++
                    result.settlementCode?.let { settlementCodes.add(it) }
                }
                is SyncResult.Failed -> {
                    failedCount++
                }
            }
            delay(100)
        }

        SyncSummary(
            total = pending.size,
            synced = successCount,
            failed = failedCount,
            settlementCodes = settlementCodes
        )
    }

    // Redeem code
    suspend fun redeemCode(code: String, amount: Double): RedeemResult = withContext(Dispatchers.IO) {
        try {
            val request = RedeemRequest(
                code = code,
                amount = amount,
                merchantId = GatewayConfig.MERCHANT_ID
            )
            val response = apiService.redeemPaymentCode(request)
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.success == true) {
                    RedeemResult.Success(
                        message = body.message ?: "Payment successful",
                        reference = body.reference,
                        settlementCode = body.settlementCode
                    )
                } else {
                    RedeemResult.Error(body?.message ?: "Redemption failed")
                }
            } else {
                RedeemResult.Error("Server error: ${response.code()}")
            }
        } catch (e: Exception) {
            RedeemResult.Error("Error: ${e.message}")
        }
    }

    // Verify credentials
    suspend fun verifyCredentials(merchantId: String, terminalId: String, secretKey: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = VerifyRequest(merchantId, terminalId, secretKey)
            val response = apiService.verifyCredentials(request)
            response.isSuccessful && response.body()?.valid == true
        } catch (e: Exception) {
            false
        }
    }

    fun getPendingCount(): Int = storage.getPendingCount()

    fun getPendingTransactions(): List<StoredTransaction> = storage.getPendingTransactions()

    fun clearOldTransactions(olderThanMillis: Long) {
        storage.clearOldSynced(olderThanMillis)
    }

    fun isNetworkAvailable(): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}

sealed class SyncResult {
    data class Success(val settlementCode: String?) : SyncResult()
    data class Failed(val error: String) : SyncResult()
}
