package com.pos2013.offline.data

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.api.RetrofitClient
import com.pos2013.offline.data.model.*
import com.pos2013.offline.utils.HmacUtil
import com.pos2013.offline.utils.IdGenerator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Protocol 201.3 Repository
 * Handles both CARD and MYFATOORAH_LINK payment methods
 */
class Protocol2013Repository(private val context: Context) {

    private val TAG = "Protocol2013Repository"
    private val storage = SimpleStorage(context)
    private val apiService = RetrofitClient.getApiService()
    private val gson = Gson()

    /**
     * Create a new transaction (offline storage)
     */
    suspend fun createTransaction(
        amount: Double,
        paymentMethod: PaymentMethod,
        cardNumber: String? = null,
        cardExpiry: String? = null,
        customerPhone: String? = null,
        customerName: String? = null,
        description: String? = null
    ): Protocol2013Transaction = withContext(Dispatchers.IO) {

        val amountMinorLong = BigDecimal.valueOf(amount)
            .multiply(BigDecimal.valueOf(100))
            .setScale(0, RoundingMode.HALF_UP)
            .longValueExact()
        val localTxnId = IdGenerator.generateLocalTxnId()
        val stan = IdGenerator.generateStan(context)

        val amountMinor = if (amountMinorLong > Int.MAX_VALUE) {
            throw IllegalArgumentException("Converted amountMinor exceeds integer range: $amountMinorLong")
        } else {
            amountMinorLong.toInt()
        }

        val transaction = Protocol2013Transaction(
            localTxnId = localTxnId,
            stan = stan,
            amountMinor = amountMinor,
            currency = "AED",
            paymentMethod = paymentMethod,
            cardNumber = cardNumber?.let { maskPan(it) },
            cardExpiry = cardExpiry,
            customerPhone = customerPhone,
            customerName = customerName,
            description = description
        )

        storage.saveProtocol2013Transaction(transaction)

        Log.d(TAG, "Created ${paymentMethod.name} transaction: $localTxnId")
        transaction
    }

    /**
     * Sync all pending transactions to backend
     */
    suspend fun syncPendingTransactions(): ProtocolSyncResult = withContext(Dispatchers.IO) {
        try {
            val pending = storage.getPendingProtocol2013Transactions()

            if (pending.isEmpty()) {
                return@withContext ProtocolSyncResult.Success(0, emptyList())
            }

            val cardTransactions = pending.filter { it.paymentMethod == PaymentMethod.CARD }
            val myfatoorahTransactions = pending.filter { it.paymentMethod == PaymentMethod.MYFATOORAH_LINK }

            var totalProcessed = 0
            val allSettlementCodes = mutableListOf<String>()
            val allErrors = mutableListOf<String>()

            if (cardTransactions.isNotEmpty()) {
                val response = uploadCardBatch(cardTransactions)
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    totalProcessed += body.processed
                    body.settlementCodes?.let { allSettlementCodes.addAll(it) }
                    markTransactionsSynced(cardTransactions)
                } else {
                    allErrors.add("Card batch failed: ${response.body()?.errors?.firstOrNull() ?: response.message()}")
                }
            }

            if (myfatoorahTransactions.isNotEmpty()) {
                val response = uploadMyFatoorahBatch(myfatoorahTransactions)
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    totalProcessed += body.processed
                    body.settlementCodes?.let { allSettlementCodes.addAll(it) }
                    markTransactionsSynced(myfatoorahTransactions)
                } else {
                    allErrors.add("MyFatoorah batch failed: ${response.body()?.errors?.firstOrNull() ?: response.message()}")
                }
            }

            ProtocolSyncResult.Success(
                synced = totalProcessed,
                settlementCodes = allSettlementCodes,
                errors = if (allErrors.isEmpty()) null else allErrors
            )

        } catch (e: Exception) {
            Log.e(TAG, "Sync failed", e)
            ProtocolSyncResult.Error(e.message ?: "Sync failed")
        }
    }

    private suspend fun uploadCardBatch(
        transactions: List<Protocol2013Transaction>
    ) = withContext(Dispatchers.IO) {
        val batchId = IdGenerator.generateBatchId()
        val nonce = HmacUtil.generateNonce()
        val timestamp = System.currentTimeMillis()

        val request = Protocol2013BatchRequest(
            merchantId = GatewayConfig.MERCHANT_ID,
            terminalId = GatewayConfig.TERMINAL_ID,
            batchId = batchId,
            timestamp = timestamp,
            nonce = nonce,
            signature = HmacUtil.generateSignature("201.3", GatewayConfig.MERCHANT_ID, GatewayConfig.TERMINAL_ID, batchId, timestamp, nonce, transactions.size),
            transactions = transactions
        )

        apiService.uploadProtocol2013Batch(request)
    }

    private suspend fun uploadMyFatoorahBatch(
        transactions: List<Protocol2013Transaction>
    ) = withContext(Dispatchers.IO) {
        val batchId = IdGenerator.generateBatchId()
        val nonce = HmacUtil.generateNonce()
        val timestamp = System.currentTimeMillis()

        val request = Protocol2013BatchRequest(
            merchantId = GatewayConfig.MERCHANT_ID,
            terminalId = GatewayConfig.TERMINAL_ID,
            batchId = batchId,
            timestamp = timestamp,
            nonce = nonce,
            signature = HmacUtil.generateSignature("201.3", GatewayConfig.MERCHANT_ID, GatewayConfig.TERMINAL_ID, batchId, timestamp, nonce, transactions.size),
            transactions = transactions
        )

        apiService.uploadMyFatoorahBatch(request)
    }

    private fun markTransactionsSynced(transactions: List<Protocol2013Transaction>) {
        transactions.forEach {
            storage.markProtocol2013TransactionSynced(it.localTxnId)
        }
    }

    private fun maskPan(pan: String): String {
        return if (pan.length > 8) {
            pan.take(4) + "****" + pan.takeLast(4)
        } else {
            "****"
        }
    }

    fun getPendingCount(): Int = storage.getPendingProtocol2013Count()

    fun isNetworkAvailable(): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}

sealed class ProtocolSyncResult {
    data class Success(val synced: Int, val settlementCodes: List<String>, val errors: List<String>? = null) : ProtocolSyncResult()
    data class Error(val message: String) : ProtocolSyncResult()
}
