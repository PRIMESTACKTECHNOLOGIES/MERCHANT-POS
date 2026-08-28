package com.pos2013.offline.domain.repository

import com.pos2013.offline.data.model.SyncSummary

/**
 * Repository interface for syncing offline transactions to the server.
 * Implements the 201.3 protocol batch upload specification.
 */
interface SyncRepository {
    
    /**
     * Sync all pending transactions to the server.
     * This method:
     * 1. Fetches all PENDING transactions from local storage
     * 2. Builds a 201.3 protocol batch request
     * 3. Generates HMAC-SHA256 signature
     * 4. Uploads to the server
     * 5. Updates transaction status based on server response
     * 
     * @return SyncSummary with sync results
     * @throws Exception if sync fails critically
     */
    suspend fun syncPending(): SyncSummary
    
    /**
     * Get the count of pending transactions.
     */
    fun getPendingCount(): Int
    
    /**
     * Check if network is available.
     */
    fun isNetworkAvailable(): Boolean
}
