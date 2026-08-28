package com.pos2013.offline.data.api

import com.google.gson.annotations.SerializedName
import com.pos2013.offline.data.model.BatchUploadRequest
import com.pos2013.offline.data.model.BatchUploadResponse
import com.pos2013.offline.data.model.Protocol2013BatchRequest
import com.pos2013.offline.data.model.Protocol2013BatchResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

// Models for Redeem action
data class RedeemRequest(
    @SerializedName("code") val code: String,
    @SerializedName("amount") val amount: Double,
    @SerializedName("merchantId") val merchantId: String
)

data class RedeemResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String? = null,
    @SerializedName("reference") val reference: String? = null,
    @SerializedName("time") val time: String? = null,
    @SerializedName("settlementCode") val settlementCode: String? = null
)

// API Interface
interface ApiService {
    
    @POST("merchant/v1/terminal/verify")
    suspend fun verifyCredentials(
        @Body request: VerifyRequest
    ): Response<VerifyResponse>
    
    @POST("api/myfatoorah/settle")
    suspend fun settleTransaction(
        @Header("Authorization") token: String,
        @Body request: Map<String, Any?>
    ): Response<SettleResponse>

    @POST("merchant/v1/pos/201.3/offline-batch")
    suspend fun uploadBatch(
        @Header("X-Signature") signature: String,
        @Body request: BatchUploadRequest
    ): Response<BatchUploadResponse>

    @POST("merchant/v1/pos/201.3/protocol-batch")
    suspend fun uploadProtocol2013Batch(
        @Body request: Protocol2013BatchRequest
    ): Response<Protocol2013BatchResponse>

    @POST("merchant/v1/pos/201.3/myfatoorah-batch")
    suspend fun uploadMyFatoorahBatch(
        @Body request: Protocol2013BatchRequest
    ): Response<Protocol2013BatchResponse>
    
    @POST("merchant/v1/api/payment2013/redeem")
    suspend fun redeemPaymentCode(
        @Body request: RedeemRequest
    ): Response<RedeemResponse>
}
