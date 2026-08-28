package com.pos2013.offline.utils

import android.content.Context
import java.util.UUID

/**
 * Generates unique identifiers for transactions and batches
 * REQUIRED for Protocol 201.3 compliance
 */
object IdGenerator {

    private const val PREFS_NAME = "pos_id_prefs"
    private const val KEY_LAST_STAN = "last_stan"

    /**
     * Generate unique local transaction ID
     * Format: txn_{uuid}
     * Used for idempotency - prevents duplicate transactions
     */
    fun generateLocalTxnId(): String {
        return "txn_${UUID.randomUUID().toString().replace("-", "")}"
    }

    /**
     * Generate unique batch ID
     * Format: batch_{timestamp}_{random}
     */
    fun generateBatchId(): String {
        val timestamp = System.currentTimeMillis()
        val random = (1000..9999).random()
        return "batch_${timestamp}_$random"
    }

    /**
     * Generate STAN (System Trace Audit Number)
     * 6-digit number (000001 - 999999) for transaction tracking
     * Uses DB-backed StanCounterRepository when available for atomic increments.
     * Falls back to SharedPreferences-based increment if DB is unavailable.
     */
    suspend fun generateStan(context: Context): String {
        return try {
            // Use DB-backed atomic counter (preferred)
            val repo = com.pos2013.offline.data.AppDatabase.getStanCounterRepository(context)
            repo.nextStanString()
        } catch (e: Exception) {
            // Fallback: prefs-based increment for backward compatibility
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            var lastStan = prefs.getInt(KEY_LAST_STAN, 0)

            // Increment and wrap at 999999
            lastStan = (lastStan + 1) % 1_000_000
            if (lastStan == 0) lastStan = 1 // Never use 000000

            // Save for next time
            prefs.edit().putInt(KEY_LAST_STAN, lastStan).apply()

            // Format as 6-digit with leading zeros
            lastStan.toString().padStart(6, '0')
        }
    }

    /**
     * Generate terminal ID
     * Format: TERM-{8 random chars}
     */
    fun generateTerminalId(): String {
        val random = UUID.randomUUID().toString()
            .replace("-", "")
            .take(8)
            .uppercase()
        return "TERM-$random"
    }

    /**
     * Generate merchant ID
     * Format: MRC-{4 digit random}
     */
    fun generateMerchantId(): String {
        val random = (1000..9999).random()
        return "MRC-$random"
    }
}
