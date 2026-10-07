package com.pos2013.offline.data.api

import com.google.gson.annotations.SerializedName
import com.pos2013.offline.data.model.OfflineSaleRequest
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// ════════════════════════════════════════════════════════════════════════════
// Request / Response models
// ════════════════════════════════════════════════════════════════════════════

data class HealthResponse(val status: String, val timestamp: String? = null)

data class OfflineSaleResponse(
    val ok: Boolean,
    val count: Int? = null,
    val message: String? = null
)

data class RedeemRequest(
    val code: String,
    val amount: Double,
    val merchantId: String
)

// ── Dashboard / Stats ─────────────────────────────────────────────────────────
data class VaultStatsResponse(
    val totalVaultBalance: Double? = null,
    val totalMerchantBalances: Double? = null,
    val totalPendingSettlement: Double? = null,
    val totalPendingPayouts: Double? = null,
    val totalOfflineApprovals: Int? = null,
    val vaultBalancesByCurrency: Map<String, Double>? = null
)

data class MerchantBalanceResponse(
    val balance: Double,
    val currency: String
)

// ── Transactions from backend ─────────────────────────────────────────────────
data class BackendTransactionResponse(
    val id: String,
    val merchantId: String? = null,
    val terminalId: String? = null,
    val stan: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    val panMasked: String? = null,
    val txnType: String? = null,
    val authMode: String? = null,
    val entryMode: String? = null,
    val authCode: String? = null,
    val status: String? = null,
    val txnTimestamp: String? = null,
    val createdAt: String? = null
)

data class BackendTransactionsResponse(
    val transactions: List<BackendTransactionResponse>? = null,
    val total: Int? = null
)

// ── Receipt ───────────────────────────────────────────────────────────────────
data class ReceiptGenerateResponse(
    val receiptId: String? = null,
    val browserCustomer: String? = null,
    val browserMerchant: String? = null,
    val plainCustomer: String? = null,
    val plainMerchant: String? = null
)

// ── Settings sync ─────────────────────────────────────────────────────────────
data class MerchantSettingsResponse(
    val merchantId: String? = null,
    val merchantName: String? = null,
    val terminalId: String? = null,
    val apiKey: String? = null,
    val offlineMode: Boolean? = null,
    val floorLimit: Double? = null,
    val currency: String? = null
)

data class RedeemResponse(
    val success: Boolean,
    val message: String?,
    val reference: String?,
    val time: String?,
    val error: String?
)

// ── Auth ──────────────────────────────────────────────────────────────────────
data class LoginRequest(val username: String, val password: String)
data class LoginResponse(val token: String)

// ── Wallet models ─────────────────────────────────────────────────────────────
data class WalletTopupRequest(
    val customerId: String? = null,
    val walletCode: String? = null,   // PSW-xxxx-xxxx — easier for cashier to enter
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
    val error: String? = null,
    val message: String? = null
)

data class WalletBalanceResponse(val balance: Double, val currency: String)

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

data class CreateCustomerRequest(
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val merchantId: String? = null
)

data class ProviderCredentialsTestRequest(
    val endpoint: String,
    val apiKey: String,
    val secretKey: String,
    val merchantId: String? = null
)

data class ProviderCredentialsTestResponse(
    val success: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val availableBalance: Double? = null,
    val currency: String? = null
)

data class CardValidationRequest(
    val pan: String,
    val expiry: String,
    val cvv: String,
    val authCode: String? = null,
    val merchantId: String? = null
)

data class CardValidationResponse(
    val valid: Boolean,
    val message: String? = null,
    val error: String? = null,
    val cardBrand: String? = null,
    val cardholderName: String? = null,
    val panMasked: String? = null,
    val btcustomerId: String? = null
)

data class CustomerResponse(
    val id: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val createdAt: String? = null,
    @SerializedName("wallet_code")
    val wallet_code: String? = null,
    @SerializedName("wallet_balance")
    val wallet_balance: Double? = null,
    @SerializedName("wallet_currency")
    val wallet_currency: String? = null,
    @SerializedName("merchant_id")
    val merchant_id: String? = null
)

// ── Terminal models ────────────────────────────────────────────────────────────
data class TerminalRegisterRequest(val terminalName: String, val deviceSerial: String? = null)
data class TerminalRegisterResponse(
    val merchantId: String,
    val terminalId: String,
    val terminalSecret: String,
    val name: String? = null,
    val offlineEnabled: Boolean? = null
)

data class TerminalVerifyRequest(val merchantId: String, val terminalId: String, val secretKey: String)
data class TerminalVerifyResponse(
    val valid: Boolean,
    val message: String? = null,
    val name: String? = null,
    val offlineEnabled: Boolean? = null,
    val error: String? = null
)

data class PosChargeRequest(
    val amountMinor: Long,
    val currency: String,
    val merchantId: String,
    val terminalId: String,
    val pan: String? = null,
    val expiry: String? = null,
    val cvv: String? = null,
    val authCode: String? = null,
    val emv: Map<String, Any?>? = null,
    val tlvRaw: String? = null,
    val stan: String? = null
)

data class PosChargeResponse(
    val success: Boolean = false,
    val status: String? = null,
    val paymentIntentId: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    val processor: String? = null,
    val authCode: String? = null,
    val settlementId: String? = null,
    val reason: String? = null,
    val error: String? = null,
    val brand: String? = null,
    val responseCode: String? = null
)

// ════════════════════════════════════════════════════════════════════════════
// API Interfaces
// ════════════════════════════════════════════════════════════════════════════

/** Auth — public, no token needed */
interface AuthApi {
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>
}

/** Public POS endpoints — no JWT needed */
interface Payment2013Api {
    @GET("health")
    suspend fun health(): Response<HealthResponse>

    /** Offline sale sync — maps to batch upload on backend */
    @POST("api/pos/offline-sale")
    suspend fun submitOfflineSale(@Body request: OfflineSaleRequest): Response<OfflineSaleResponse>

    /** Redeem 6-digit payment code */
    @POST("api/payment2013/redeem")
    suspend fun redeemCode(@Body request: RedeemRequest): Response<RedeemResponse>

    @POST("merchant/v1/payments/payments/charge")
    suspend fun chargeOnline(@Body request: PosChargeRequest): Response<PosChargeResponse>
}

/** Terminal endpoints — public, no JWT needed for register/verify */
interface TerminalsApi {
    @POST("merchant/v1/terminal/register")
    suspend fun registerTerminal(@Body request: TerminalRegisterRequest): Response<TerminalRegisterResponse>

    @POST("merchant/v1/terminal/verify")
    suspend fun verifyTerminal(@Body request: TerminalVerifyRequest): Response<TerminalVerifyResponse>
}

/** Wallet endpoints — requires JWT bearer token */
interface WalletsApi {
    @POST("wallet/customers")
    suspend fun createCustomer(@Body request: CreateCustomerRequest): Response<CustomerResponse>

    @GET("wallet/customers")
    suspend fun getCustomers(): Response<List<CustomerResponse>>

    @GET("wallet/customers-by-merchant/{merchantId}")
    suspend fun getCustomersByMerchant(@Path("merchantId") merchantId: String): Response<List<CustomerResponse>>

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

    @POST("wallet/validate-card")
    suspend fun validateCard(@Body request: CardValidationRequest): Response<CardValidationResponse>

    @POST("wallet/test-provider-credentials")
    suspend fun testProviderCredentials(@Body request: ProviderCredentialsTestRequest): Response<ProviderCredentialsTestResponse>

    @POST("wallet/send-to-merchant-wallet")
    suspend fun sendFundsToMerchantWallet(@Body request: SendToMerchantRequest): Response<WalletTopupResponse>
}

data class SendToMerchantRequest(
    val customerId: String,
    val merchantId: String,
    val amount: Double,
    val currency: String? = null,
    val providerEndpoint: String? = null,
    val providerApiKey: String? = null,
    val providerSecretKey: String? = null
)

/** Dashboard / Stats endpoints — requires JWT */
interface DashboardApi {
    @GET("api/vault/stats")
    suspend fun getVaultStats(): Response<VaultStatsResponse>

    @GET("wallet/merchant-balance/{merchantId}")
    suspend fun getMerchantBalance(@Path("merchantId") merchantId: String): Response<MerchantBalanceResponse>

    @GET("merchant/v1/transactions")
    suspend fun getTransactions(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): Response<BackendTransactionsResponse>
}

/** Receipt endpoints — requires JWT */
interface ReceiptApi {
    @POST("merchant/v1/receipts/generate/{transactionId}")
    suspend fun generateReceipt(@Path("transactionId") transactionId: String): Response<ReceiptGenerateResponse>

    @GET("merchant/v1/receipts/{receiptId}")
    suspend fun getReceipt(@Path("receiptId") receiptId: String): Response<ReceiptGenerateResponse>
}

/** Settings sync endpoint — requires JWT */
interface SettingsApi {
    @GET("merchant/v1/settings")
    suspend fun getSettings(): Response<MerchantSettingsResponse>
}

// ════════════════════════════════════════════════════════════════════════════
// Retrofit client factory
// ════════════════════════════════════════════════════════════════════════════

object ApiClient {

    const val DEFAULT_URL  = "https://merchant-pos-0nno.onrender.com/"
    const val FALLBACK_URL = "https://merchant-pos-0nno.onrender.com/"

    /** OkHttpClient — attaches JWT bearer token when provided */
    private fun buildOkHttp(jwtToken: String? = null): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)

        if (!jwtToken.isNullOrBlank()) {
            builder.addInterceptor(Interceptor { chain ->
                val req = chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $jwtToken")
                    .build()
                chain.proceed(req)
            })
        }

        // Logging — only in debug builds
        if (android.util.Log.isLoggable("POS_HTTP", android.util.Log.DEBUG)) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY }
            )
        }

        return builder.build()
    }

    private fun retrofit(baseUrl: String, jwtToken: String? = null): Retrofit =
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(buildOkHttp(jwtToken))
            .addConverterFactory(GsonConverterFactory.create())
            .build()

    fun createAuthApi(baseUrl: String = DEFAULT_URL): AuthApi =
        retrofit(baseUrl).create(AuthApi::class.java)

    fun createPayment2013Api(baseUrl: String = DEFAULT_URL, jwtToken: String? = null): Payment2013Api =
        retrofit(baseUrl, jwtToken).create(Payment2013Api::class.java)

    fun createWalletsApi(baseUrl: String = DEFAULT_URL, jwtToken: String? = null): WalletsApi =
        retrofit(baseUrl, jwtToken).create(WalletsApi::class.java)

    fun createTerminalsApi(baseUrl: String = DEFAULT_URL): TerminalsApi =
        retrofit(baseUrl).create(TerminalsApi::class.java)

    fun createDashboardApi(baseUrl: String = DEFAULT_URL, jwtToken: String? = null): DashboardApi =
        retrofit(baseUrl, jwtToken).create(DashboardApi::class.java)

    fun createReceiptApi(baseUrl: String = DEFAULT_URL, jwtToken: String? = null): ReceiptApi =
        retrofit(baseUrl, jwtToken).create(ReceiptApi::class.java)

    fun createSettingsApi(baseUrl: String = DEFAULT_URL, jwtToken: String? = null): SettingsApi =
        retrofit(baseUrl, jwtToken).create(SettingsApi::class.java)
}
