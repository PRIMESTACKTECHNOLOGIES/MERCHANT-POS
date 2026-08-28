package com.pos2013.offline.data.api

import com.google.gson.annotations.SerializedName
import com.pos2013.offline.config.GatewayConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

data class VerifyRequest(
    @SerializedName("merchantId")
    val merchantId: String,
    @SerializedName("terminalId")
    val terminalId: String,
    @SerializedName("secretKey")
    val secretKey: String
)

data class VerifyResponse(
    @SerializedName("valid")
    val valid: Boolean = false,
    @SerializedName("merchantId")
    val merchantId: String? = null,
    @SerializedName("message")
    val message: String? = null,
    @SerializedName("error")
    val error: String? = null
)

interface AuthApi {
    @POST("merchant/v1/terminal/verify")
    suspend fun verifyCredentials(@Body request: VerifyRequest): Response<VerifyResponse>
}

object AuthClient {

    private fun createClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    fun create(): AuthApi {
        val baseUrl = GatewayConfig.sanitizeUrl(GatewayConfig.SERVER_URL)

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(createClient())
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(AuthApi::class.java)
    }

    fun create(baseUrl: String): AuthApi {
        val safeUrl = GatewayConfig.sanitizeUrl(baseUrl)

        return Retrofit.Builder()
            .baseUrl(safeUrl)
            .client(createClient())
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(AuthApi::class.java)
    }
}
