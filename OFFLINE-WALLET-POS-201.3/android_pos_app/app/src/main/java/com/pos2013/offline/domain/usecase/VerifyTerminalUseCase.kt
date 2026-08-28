package com.pos2013.offline.domain.usecase

import android.content.Context
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.api.AuthClient
import com.pos2013.offline.data.api.VerifyRequest
import com.pos2013.offline.data.api.VerifyResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.Response

/**
 * Use case for verifying terminal credentials with the 201.3 backend.
 *
 * This is the **mandatory first step** for any 201.3-compliant POS terminal.
 * The terminal cannot process payments or sync batches until verified.
 *
 * Flow:
 * 1. Send merchantId, terminalId, secretKey to /merchant/v1/terminal/verify
 * 2. Backend validates credentials
 * 3. If valid → save credentials locally → enable payment processing
 * 4. If invalid → reject → terminal remains locked
 */
class VerifyTerminalUseCase(
    private val context: Context
) {

    companion object {
        private const val PREFS_NAME = "pos_prefs"
        private const val KEY_MERCHANT_ID = "merchant_id"
        private const val KEY_TERMINAL_ID = "terminal_id"
        private const val KEY_SECRET_KEY = "secret_key"
        private const val KEY_DEVICE_REGISTERED = "device_registered"
    }

    /**
     * Result of terminal verification.
     */
    sealed class Result {
        data class Success(
            val message: String,
            val merchantId: String,
            val terminalId: String
        ) : Result()

        data class Error(
            val message: String,
            val code: ErrorCode = ErrorCode.UNKNOWN
        ) : Result()
    }

    /**
     * Error codes for specific failure scenarios.
     */
    enum class ErrorCode {
        NETWORK_ERROR,          // No internet connection
        SERVER_ERROR,           // HTTP 5xx
        INVALID_CREDENTIALS,    // HTTP 200 but valid=false
        EMPTY_RESPONSE,         // Response body is null
        UNKNOWN                 // Catch-all
    }

    /**
     * Execute terminal verification.
     *
     * @param merchantId The merchant ID (e.g., "MRC-1001")
     * @param terminalId The terminal ID (e.g., "T2013-001")
     * @param secretKey The secret key for HMAC signing
     * @param serverUrl Optional server URL override (for testing different environments)
     * @return Result.Success if verified, Result.Error otherwise
     */
    suspend operator fun invoke(
        merchantId: String,
        terminalId: String,
        secretKey: String,
        serverUrl: String? = null
    ): Result = withContext(Dispatchers.IO) {
        try {
            // Create API client (with optional custom URL for testing)
            val api = if (!serverUrl.isNullOrBlank()) {
                AuthClient.create(serverUrl)
            } else {
                AuthClient.create()
            }

            // Build request
            val request = VerifyRequest(
                merchantId = merchantId,
                terminalId = terminalId,
                secretKey = secretKey
            )

            // Send verification request
            val response: Response<VerifyResponse> = api.verifyCredentials(request)

            // Handle HTTP errors
            if (!response.isSuccessful) {
                return@withContext Result.Error(
                    message = "Server error: HTTP ${response.code()}",
                    code = ErrorCode.SERVER_ERROR
                )
            }

            // Handle empty response
            val body = response.body()
                ?: return@withContext Result.Error(
                    message = "Empty response from server",
                    code = ErrorCode.EMPTY_RESPONSE
                )

            // Handle invalid credentials
            if (!body.valid) {
                return@withContext Result.Error(
                    message = body.message ?: "Invalid credentials",
                    code = ErrorCode.INVALID_CREDENTIALS
                )
            }

            // Success! Save credentials
            saveCredentials(merchantId, terminalId, secretKey)

            Result.Success(
                message = body.message ?: "Terminal verified successfully",
                merchantId = merchantId,
                terminalId = terminalId
            )

        } catch (e: java.net.UnknownHostException) {
            Result.Error(
                message = "No internet connection",
                code = ErrorCode.NETWORK_ERROR
            )
        } catch (e: java.net.SocketTimeoutException) {
            Result.Error(
                message = "Connection timeout. Please try again.",
                code = ErrorCode.NETWORK_ERROR
            )
        } catch (e: Exception) {
            Result.Error(
                message = e.message ?: "Verification failed",
                code = ErrorCode.UNKNOWN
            )
        }
    }

    /**
     * Save verified credentials to persistent storage.
     */
    private fun saveCredentials(
        merchantId: String,
        terminalId: String,
        secretKey: String
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString(KEY_MERCHANT_ID, merchantId)
            putString(KEY_TERMINAL_ID, terminalId)
            putString(KEY_SECRET_KEY, secretKey)
            putBoolean(KEY_DEVICE_REGISTERED, true)
            apply()
        }

        // Refresh GatewayConfig so it's immediately available
        GatewayConfig.refreshFromPreferences(context)
    }

    /**
     * Check if terminal is already verified.
     */
    fun isVerified(): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_DEVICE_REGISTERED, false)
    }

    /**
     * Clear verification (for logout/reset).
     */
    fun clearVerification() {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putBoolean(KEY_DEVICE_REGISTERED, false)
            apply()
        }
        GatewayConfig.setDeviceRegistered(context, false)
    }
}
