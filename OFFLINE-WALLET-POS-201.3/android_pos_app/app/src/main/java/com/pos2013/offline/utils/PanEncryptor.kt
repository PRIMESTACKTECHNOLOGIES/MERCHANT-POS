package com.pos2013.offline.utils

import android.content.Context
import android.os.Build
import android.util.Base64
import androidx.annotation.RequiresApi
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * PanEncryptor
 *
 * Purpose:
 * - Provide AES/GCM encryption/decryption of PAN for safe at-rest storage.
 * - Uses AndroidKeyStore AES key when available (API >= 23). The key alias is fixed.
 * - Encrypted payload format (Base64): [IV (12 bytes)] + [ciphertext]
 */
object PanEncryptor {

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "PAN_ENC_KEY"
    private const val AES_MODE = "AES/GCM/NoPadding"
    private const val GCM_IV_LENGTH = 12 // 96 bits, recommended for GCM
    private const val GCM_TAG_LENGTH_BITS = 128

    @Throws(Exception::class)
    fun encrypt(context: Context, pan: String): String {
        require(pan.isNotEmpty()) { "PAN must not be empty" }

        val secretKey = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(AES_MODE)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)

        val iv = cipher.iv ?: generateRandomIv()
        val cipherBytes = cipher.doFinal(pan.toByteArray(Charsets.UTF_8))

        val output = ByteArray(iv.size + cipherBytes.size)
        System.arraycopy(iv, 0, output, 0, iv.size)
        System.arraycopy(cipherBytes, 0, output, iv.size, cipherBytes.size)

        return Base64.encodeToString(output, Base64.NO_WRAP)
    }

    @Throws(Exception::class)
    fun decrypt(context: Context, encryptedBase64: String): String {
        require(encryptedBase64.isNotEmpty()) { "Encrypted payload must not be empty" }

        val decoded = Base64.decode(encryptedBase64, Base64.NO_WRAP)
        if (decoded.size < GCM_IV_LENGTH) {
            throw IllegalArgumentException("Invalid encrypted payload")
        }

        val iv = decoded.copyOfRange(0, GCM_IV_LENGTH)
        val ciphertext = decoded.copyOfRange(GCM_IV_LENGTH, decoded.size)

        val secretKey = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(AES_MODE)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)

        val plainBytes = cipher.doFinal(ciphertext)
        return String(plainBytes, Charsets.UTF_8)
    }

    fun isKeyStoreSupported(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
    }

    @Throws(Exception::class)
    private fun getOrCreateSecretKey(): SecretKey {
        if (!isKeyStoreSupported()) {
            throw IllegalStateException("AndroidKeyStore AES keys require API level 23+")
        }

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        val existing = keyStore.getEntry(KEY_ALIAS, null)
        if (existing != null && existing is KeyStore.SecretKeyEntry) {
            return existing.secretKey
        }

        generateKeyInKeyStore()
        val created = keyStore.getEntry(KEY_ALIAS, null)
        if (created is KeyStore.SecretKeyEntry) {
            return created.secretKey
        }

        throw IllegalStateException("Failed to create or retrieve KeyStore key")
    }

    @Suppress("NewApi")
    @RequiresApi(Build.VERSION_CODES.M)
    private fun generateKeyInKeyStore() {
        val keyGenerator = KeyGenerator.getInstance(
            "AES",
            ANDROID_KEYSTORE
        )

        val keyGenParameterSpec = android.security.keystore.KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setKeySize(256)
            .build()

        keyGenerator.init(keyGenParameterSpec)
        keyGenerator.generateKey()
    }

    private fun generateRandomIv(): ByteArray {
        val iv = ByteArray(GCM_IV_LENGTH)
        SecureRandom().nextBytes(iv)
        return iv
    }

    fun deleteKey() {
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            keyStore.deleteEntry(KEY_ALIAS)
        } catch (ignored: Exception) {
        }
    }
}
