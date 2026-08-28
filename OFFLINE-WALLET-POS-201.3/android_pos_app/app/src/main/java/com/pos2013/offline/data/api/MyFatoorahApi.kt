package com.pos2013.offline.data.api

import com.pos2013.offline.data.model.MyFatoorahInvoiceRequest
import com.pos2013.offline.data.model.MyFatoorahInvoiceResponse
import com.pos2013.offline.data.model.PaymentStatusResponse
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query

interface MyFatoorahApi {
    
    /**
     * Create a new payment invoice/link
     * POST /v2/SendPayment
     */
    @POST("v2/SendPayment")
    suspend fun createPayment(
        @Header("Authorization") authorization: String,
        @Body request: MyFatoorahInvoiceRequest
    ): Response<MyFatoorahInvoiceResponse>
    
    /**
     * Create invoice (alternative endpoint)
     * POST /v2/ExecutePayment
     */
    @POST("v2/ExecutePayment")
    suspend fun executePayment(
        @Header("Authorization") authorization: String,
        @Body request: MyFatoorahInvoiceRequest
    ): Response<MyFatoorahInvoiceResponse>
    
    /**
     * Check payment status
     * GET /v2/GetPaymentStatus
     */
    @GET("v2/GetPaymentStatus")
    suspend fun getPaymentStatus(
        @Header("Authorization") authorization: String,
        @Query("Key") key: String,
        @Query("KeyType") keyType: String = "paymentId"
    ): Response<PaymentStatusResponse>
    
    companion object {
        // UAE Production URL
        const val BASE_URL = "https://api.myfatoorah.com/"
        
        // Test/Sandbox URL (use this for testing)
        const val TEST_BASE_URL = "https://apitest.myfatoorah.com/"
        
        // Direct Payment (Embedded)
        const val DIRECT_PAYMENT_ENDPOINT = "v2/ExecutePayment"
        
        // Payment Link
        const val SEND_PAYMENT_ENDPOINT = "v2/SendPayment"
    }
}

object MyFatoorahClient {
    private var apiInstance: MyFatoorahApi? = null
    private var isTestMode: Boolean = false
    
    fun create(testMode: Boolean = false): MyFatoorahApi {
        isTestMode = testMode
        val baseUrl = if (testMode) {
            MyFatoorahApi.TEST_BASE_URL
        } else {
            MyFatoorahApi.BASE_URL
        }
        
        return apiInstance ?: Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(MyFatoorahApi::class.java)
            .also { apiInstance = it }
    }
    
    fun reset() {
        apiInstance = null
    }
}
