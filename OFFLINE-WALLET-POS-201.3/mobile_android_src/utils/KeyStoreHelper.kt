package com.pos2013.offline.utils

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import android.util.Base64

object KeyStoreHelper {
    private const val KEY_ALIAS = "POS2013_HMAC_KEY"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    fun generateHmacKeyIfNeeded() {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        // If key already exists, do nothing
        if (keyStore.containsAlias(KEY_ALIAS)) return

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_HMAC_SHA256,
            ANDROID_KEYSTORE
        )

        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setKeySize(256)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .setIsStrongBoxBacked(true)   // Use StrongBox if available
            .build()

        keyGenerator.init(spec)
        keyGenerator.generateKey()
    }

    fun signData(data: String): String {
        // Ensure key exists before signing
        generateHmacKeyIfNeeded()

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        val secretKey = keyStore.getKey(KEY_ALIAS, null) as SecretKey

        val mac = Mac.getInstance("HmacSHA256")
        mac.init(secretKey)

        val signatureBytes = mac.doFinal(data.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(signatureBytes, Base64.NO_WRAP)
    }
}
