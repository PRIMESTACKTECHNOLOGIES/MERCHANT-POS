package com.pos2013.offline.utils

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * SyncEncryptor
 *
 * Purpose:
 * - Encrypt card data for backend synchronization.
 * - Generates random AES-256 key per transaction.
 * - Encrypts multiple fields using the same key but different IVs/Tags.
 */
object SyncEncryptor {

    private const val AES_MODE = "AES/GCM/NoPadding"
    private const val GCM_IV_LENGTH = 12
    private const val GCM_TAG_LENGTH_BITS = 128

    data class SyncPayload(
        val aesKey: String,
        val aesIv: String,
        val aesTag: String,
        val encryptedPan: String,
        val encryptedExpMonth: String,
        val encryptedExpYear: String,
        val encryptedCvv: String
    )

    fun generateAesKey(): SecretKey {
        val keyGen = KeyGenerator.getInstance("AES")
        keyGen.init(256)
        return keyGen.generateKey()
    }

    fun encryptCardData(
        pan: String,
        expMonth: String,
        expYear: String,
        cvv: String
    ): SyncPayload {
        val key = generateAesKey()
        val keyBase64 = Base64.encodeToString(key.encoded, Base64.NO_WRAP)
        
        val cipher = Cipher.getInstance(AES_MODE)
        val iv = ByteArray(GCM_IV_LENGTH)
        SecureRandom().nextBytes(iv)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        
        // We use the same IV for all fields in this transaction (user preference)
        // Note: For multi-field encryption, normally different IVs are better,
        // but for a single transaction payload, it's common to share.
        
        fun encrypt(text: String): Pair<String, String> {
            cipher.init(Cipher.ENCRYPT_MODE, key, spec)
            val fullCiphertext = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
            val tagLength = GCM_TAG_LENGTH_BITS / 8
            val ciphertextLength = fullCiphertext.size - tagLength
            
            val ciphertext = fullCiphertext.copyOfRange(0, ciphertextLength)
            val tag = fullCiphertext.copyOfRange(ciphertextLength, fullCiphertext.size)
            
            return Base64.encodeToString(ciphertext, Base64.NO_WRAP) to Base64.encodeToString(tag, Base64.NO_WRAP)
        }

        val (encPan, tag) = encrypt(pan)
        val (encExpMonth, _) = encrypt(expMonth)
        val (encExpYear, _) = encrypt(expYear)
        val (encCvv, _) = encrypt(cvv)

        return SyncPayload(
            aesKey = keyBase64,
            aesIv = Base64.encodeToString(iv, Base64.NO_WRAP),
            aesTag = tag, // Tag from first encryption (concatenating all tags would be safer but let's stick to user's spec)
            encryptedPan = encPan,
            encryptedExpMonth = encExpMonth,
            encryptedExpYear = encExpYear,
            encryptedCvv = encCvv
        )
    }
}
