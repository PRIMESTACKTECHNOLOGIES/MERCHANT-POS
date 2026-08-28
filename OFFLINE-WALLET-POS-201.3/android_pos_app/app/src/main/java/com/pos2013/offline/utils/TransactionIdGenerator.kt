package com.pos2013.offline.utils

import android.content.Context
import java.util.UUID

/**
 * Generates unique transaction identifiers
 * Required for idempotency and duplicate prevention
 */
object TransactionIdGenerator {
    
    /**
     * Generate a unique local transaction ID
     * Format: txn_{uuid}
     * This prevents duplicate transactions when retrying
     */
    fun generateLocalTxnId(): String {
        return "txn_${UUID.randomUUID().toString().replace("-", "")}"
    }
    
    /**
     * Generate a unique batch ID
     * Format: batch_{timestamp}_{random}
     */
    fun generateBatchId(): String {
        val timestamp = System.currentTimeMillis()
        val random = (1000..9999).random()
        return "batch_${timestamp}_$random"
    }
    
    /**
     * Generate STAN (System Trace Audit Number)
     * 6-digit number for transaction tracking
     */
    fun generateStan(context: Context): String {
        // Get last used STAN from preferences or start at 0
        val prefs = context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
        var lastStan = prefs.getInt("last_stan", 0)
        
        // Increment and wrap at 999999
        lastStan = (lastStan + 1) % 1000000
        
        // Save for next time
        prefs.edit().putInt("last_stan", lastStan).apply()
        
        // Format as 6-digit string with leading zeros
        return lastStan.toString().padStart(6, '0')
    }
    
    /**
     * Generate a unique terminal ID if not already set
     * Format: TERM-{8 random chars}
     */
    fun generateTerminalId(): String {
        val random = UUID.randomUUID().toString()
            .replace("-", "")
            .substring(0, 8)
            .uppercase()
        return "TERM-$random"
    }
}
