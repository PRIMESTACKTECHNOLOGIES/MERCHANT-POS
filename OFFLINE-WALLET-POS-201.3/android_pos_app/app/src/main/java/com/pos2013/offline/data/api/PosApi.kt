package com.pos2013.offline.data.api

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import com.pos2013.offline.data.model.OfflineSaleRequest
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// ════════════════════════════════════════════════════════════════════════════
// Request / Response models
// ════════════════════════════════════════════════════════════════════════════

data class ChargeRequest(
    val amount: Double,
    val currency: String = "AED"
)

data class ChargeResponse(
    val success: Boolean,
    val clientSecret: String?,
    val paymentIntentId: String?,
    val error: String?,
    val message: String?
)

data class OfflineQueueRequest(
    val amount: Double,
    val currency: String = "AED",
    val cardLast4: String,
    val cardBrand: String,
    val offlineRef: String,
    val capturedAt: String,
    val terminalId: String
)

data class OfflineQueueResponse(
    val success: Boolean,
    val queueId: String?,
    val status: String?,
    val error: String?,
    val message: String?
)

data class SyncResponse(
    val success: Boolean,
    val approved: Int,
    val declined: Int,
    val error: String?,
    val message: String?
)

data class HealthResponse(
    val status: String
)

data class OfflineSaleResponse(
    val ok: Boolean,
    val count: Int? = null,
    val message: String? = null
)

/**
 * Request for POST /api/payment2013/redeem
 * Used to redeem a 6-digit payment code at the merchant terminal.
 */
data class RedeemRequest(
    val code: String,       // 6-digit code
    val amount: Double,     // must match code amount
    val merchantId: String
)

/**
 * Response from POST /api/payment2013/redeem
 */
data class RedeemResponse(
    val success: Boolean,
    val message: String?,
    val reference: String?,   // server transaction reference
    val time: String?,         // timestamp
    val error: String?
)

// ════════════════════════════════════════════════════════════════════════════
// PrimestackApi  — used by MainActivity for live/online charge + offline queue
// ════════════════════════════════════════════════════════════════════════════

interface PrimestackApi {

    @GET("primestack/status")
    suspend fun health(): Response<HealthResponse>

    @POST("primestack/charge")
    suspend fun charge(@Body body: ChargeRequest): Response<ChargeResponse>

    @POST("primestack/offline/queue")
    suspend fun queueOffline(@Body body: OfflineQueueRequest): Response<OfflineQueueResponse>

    @POST("primestack/offline/sync")
    suspend fun sync(): Response<SyncResponse>
}

// ════════════════════════════════════════════════════════════════════════════
// Payment2013Api — used by TransactionRepository + SyncWorker for offline sale syncing
// ════════════════════════════════════════════════════════════════════════════

// Wallet Topup Request/Response
data class WalletTopupRequest(
    val customerId: String,
    val amount: Double,
    val panMasked: String? = null,
    val expiry: String? = null,
    val emvData: String? = null,
    val source: String = "card"
)

data class WalletTopupResponse(
    val success: Boolean,
    val transactionId: String? = null,
    val authCode: String? = null,
    val error: String? = null
)

interface WalletsApi {
    @POST("wallet/customers")
    suspend fun createCustomer(@Body request: CreateCustomerRequest): Response<CustomerResponse>

    @GET("wallet/customers")
    suspend fun getCustomers(): Response<List<CustomerResponse>>

    @POST("wallet/topup")
    suspend fun topup(@Body request: WalletTopupRequest): Response<WalletTopupResponse>

    @POST("wallet/topup/card")
    suspend fun topupWithCard(@Body request: WalletTopupRequest): Response<WalletTopupResponse>

    @POST("wallet/debit")
    suspend fun debit(@Body request: WalletTopupRequest): Response<WalletTopupResponse>

    @GET("wallet/balance/{customerId}")
    suspend fun getBalance(@Path("customerId") customerId: String): Response<WalletBalanceResponse>

    @GET("wallet/transactions/{customerId}")
    suspend fun getTransactions(@Path("customerId") customerId: String): Response<List<WalletTransactionResponse>>
}

data class CreateCustomerRequest(
    val name: String,
    val email: String? = null,
    val phone: String? = null
)

data class CustomerResponse(
    val id: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val createdAt: String? = null
)

data class WalletBalanceResponse(
    val balance: Double,
    val currency: String
)

data class WalletTransactionResponse(
    val id: String,
    val walletId: String,
    val type: String,
    val amount: Double,
    val source: String,
    val reference: String? = null,
    val panMasked: String? = null,
    val emvData: String? = null,
    val createdAt: String
)

interface Payment2013Api {

    @GET("health")
    suspend fun health(): Response<HealthResponse>

    @POST("api/pos/offline-sale")
    suspend fun submitOfflineSale(@Body request: OfflineSaleRequest): Response<OfflineSaleResponse>

    /**
     * Redeem a 6-digit payment code.
     * Used for real-world code-based payments.
     */
    @POST("api/payment2013/redeem")
    suspend fun redeemCode(@Body request: RedeemRequest): Response<RedeemResponse>
}

data class TerminalRegisterRequest(
    val terminalName: String,
    val deviceSerial: String? = null
)

data class TerminalRegisterResponse(
    val merchantId: String,
    val terminalId: String,
    val terminalSecret: String,
    val name: String? = null,
    val offlineEnabled: Boolean? = null
)

data class TerminalVerifyRequest(
    val merchantId: String,
    val terminalId: String,
    val secretKey: String
)

data class TerminalVerifyResponse(
    val valid: Boolean,
    val message: String? = null,
    val name: String? = null,
    val offlineEnabled: Boolean? = null,
    val error: String? = null
)

interface TerminalsApi {
    @POST("terminal/register")
    suspend fun registerTerminal(@Body request: TerminalRegisterRequest): Response<TerminalRegisterResponse>

    @POST("terminal/verify")
    suspend fun verifyTerminal(@Body request: TerminalVerifyRequest): Response<TerminalVerifyResponse>
}

data class GenerateCodeResponse(
    val code: String?,
    val amount: Double,
    val reference: String?,
    val createdAt: String?
)

// ════════════════════════════════════════════════════════════════════════════
// Retrofit client factory
// ════════════════════════════════════════════════════════════════════

object ApiClient {

    /**
     * Default backend base URL.
     *   Emulator  → http://10.0.2.2:7000/
     *   Real Wi-Fi → set via Settings screen, e.g. http://192.168.1.x:7000/
     *   Cloud      → https://pos-201-3-offline-6-digit-1.onrender.com/
     */
    const val DEFAULT_URL = "http://localhost:7000/"

    private fun buildOkHttp(debug: Boolean = false): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)

        if (debug) {
            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }
            builder.addInterceptor(logging)
        }
        return builder.build()
    }

    private fun retrofit(baseUrl: String): Retrofit =
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(buildOkHttp(debug = true))
            .addConverterFactory(GsonConverterFactory.create())
            .build()

    fun create(baseUrl: String = DEFAULT_URL): PrimestackApi =
        retrofit(baseUrl).create(PrimestackApi::class.java)

    fun createPayment2013Api(baseUrl: String = DEFAULT_URL): Payment2013Api =
        retrofit(baseUrl).create(Payment2013Api::class.java)

    fun createWalletsApi(baseUrl: String = DEFAULT_URL): WalletsApi =
        retrofit(baseUrl).create(WalletsApi::class.java)

    fun createTerminalsApi(baseUrl: String = DEFAULT_URL): TerminalsApi =
        retrofit(baseUrl).create(TerminalsApi::class.java)
}
