package com.pos2013.offline.utils

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.pos2013.offline.config.GatewayConfig
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import javax.crypto.KeyGenerator

/**
 * HMAC-SHA256 signature generator for Protocol 201.3
 */
object HmacUtil {

    private const val ALGORITHM = "HmacSHA256"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "POS_HMAC_KEY"

    /**
     * Generate HMAC-SHA256 signature for batch upload
     */
    fun generateSignature(
        protocolVersion: String,
        merchantId: String,
        terminalId: String,
        batchId: String,
        timestamp: Long,
        nonce: String,
        transactionCount: Int = 1,
        secretKey: String = GatewayConfig.GATEWAY_SECRET_KEY
    ): String {
        val payload = "$protocolVersion|$merchantId|$terminalId|$batchId|$timestamp|$nonce|$transactionCount"
        return generateHmac(payload, secretKey)
    }

    /**
     * Generate HMAC-SHA256 for a string payload.
     * Accessible within the package or as public for repositories.
     */
    fun generateHmac(payload: String, secretKey: String): String {
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)

            if (!keyStore.containsAlias(KEY_ALIAS)) {
                try {
                    val keyGenerator = KeyGenerator.getInstance(ALGORITHM, ANDROID_KEYSTORE)
                    val spec = KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                    ).setDigests(KeyProperties.DIGEST_SHA256)
                        .setKeySize(256)
                        .setUserAuthenticationRequired(false)
                        .build()

                    keyGenerator.init(spec)
                    keyGenerator.generateKey()
                } catch (genEx: Exception) {
                }
            }

            val entry = keyStore.getEntry(KEY_ALIAS, null)
            if (entry is KeyStore.SecretKeyEntry) {
                val secret = entry.secretKey
                val mac = Mac.getInstance(ALGORITHM)
                mac.init(secret)
                val signatureBytes = mac.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
                return Base64.encodeToString(signatureBytes, Base64.NO_WRAP)
            }
        } catch (e: Exception) {
        }

        val mac = Mac.getInstance(ALGORITHM)
        val secretKeySpec = SecretKeySpec(secretKey.toByteArray(StandardCharsets.UTF_8), ALGORITHM)
        mac.init(secretKeySpec)

        val signatureBytes = mac.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
        return Base64.encodeToString(signatureBytes, Base64.NO_WRAP)
    }

    fun generateNonce(): String {
        return java.util.UUID.randomUUID().toString().replace("-", "").take(16)
    }
}
