package com.pos2013.offline.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import com.pos2013.offline.data.model.Batch

data class RedeemRequest(
    val code: String,
    val amount: Double,
    val merchantId: String
)

data class RedeemResponse(
    val success: Boolean,
    val message: String,
    val reference: String?,
    val time: String?
)

interface Payment2013Api {
    // Legacy offline endpoint
    @POST("merchant/v1/cashout/braintree")
    suspend fun uploadBatch(
        @Header("X-Signature") signature: String,
        @Body batch: List<Batch>
    ): Response<Unit>

    // New Live Redemption Endpoint
    @POST("api/payment2013/redeem")
    suspend fun redeem(@Body body: RedeemRequest): Response<RedeemResponse>
}

object ApiClient {
    // Production Render backend URL
    private const val DEFAULT_BASE_URL = "https://pos-201-3-offline-6-digit-1.onrender.com/"
    
    fun create(baseUrl: String = DEFAULT_BASE_URL): Payment2013Api {
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(Payment2013Api::class.java)
    }
}
