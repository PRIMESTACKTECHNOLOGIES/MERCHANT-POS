package com.pos2013.offline.data.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.repository.SyncRepositoryImpl
import timber.log.Timber

/**
 * WorkManager worker for background sync of offline transactions.
 * 
 * This worker:
 * - Runs every 15 minutes (configured in MainActivity/PosApplication)
 * - Syncs pending transactions to the server
 * - Retries automatically on failure
 * - Works even when app is closed
 * - Respects network constraints (only runs when online)
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val WORK_NAME = "offline_sync_worker"
        const val TAG = "SyncWorker"
    }

    override suspend fun doWork(): Result {
        Timber.tag(TAG).d("Starting background sync work")
        
        // Refresh config from preferences to ensure latest credentials
        GatewayConfig.refreshFromPreferences(applicationContext)
        
        val repository = SyncRepositoryImpl(applicationContext)
        
        // Don't run if no network
        if (!repository.isNetworkAvailable()) {
            Timber.tag(TAG).d("No network available, skipping sync")
            return Result.retry()
        }

        // Don't run if no pending transactions
        if (repository.getPendingCount() == 0) {
            Timber.tag(TAG).d("No pending transactions, nothing to sync")
            return Result.success()
        }

        return try {
            val summary = repository.syncPending()
            
            Timber.tag(TAG).d("Sync complete: ${summary.synced}/${summary.total} synced, ${summary.failed} failed")
            
            when {
                summary.failed == 0 -> {
                    // All synced successfully
                    Result.success()
                }
                summary.synced > 0 -> {
                    // Partial success - some synced, some failed
                    // We consider this a success since we made progress
                    Result.success()
                }
                else -> {
                    // All failed - retry later
                    Result.retry()
                }
            }
        } catch (e: Exception) {
            Timber.tag(TAG).e(e, "Sync failed with exception")
            Result.retry()
        }
    }
}
