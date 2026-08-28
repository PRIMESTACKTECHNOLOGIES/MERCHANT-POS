package com.pos2013.offline.data.api

import com.pos2013.offline.config.GatewayConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private var retrofit: Retrofit? = null
    private var apiService: ApiService? = null

    private fun createClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        return OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun getApiService(): ApiService {
        val currentUrl = GatewayConfig.sanitizeUrl(GatewayConfig.SERVER_URL)

        if (apiService == null || retrofit?.baseUrl().toString() != currentUrl) {

            retrofit = Retrofit.Builder()
                .baseUrl(currentUrl)
                .client(createClient())
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            apiService = retrofit!!.create(ApiService::class.java)
        }

        return apiService!!
    }

    fun reset() {
        retrofit = null
        apiService = null
    }
}
