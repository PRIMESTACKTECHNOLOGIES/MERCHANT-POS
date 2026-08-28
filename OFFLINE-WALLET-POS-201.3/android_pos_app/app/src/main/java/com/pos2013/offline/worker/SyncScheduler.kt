package com.pos2013.offline.worker

import android.content.Context
import androidx.work.*
import com.pos2013.offline.data.worker.SyncWorker
import java.util.concurrent.TimeUnit

/**
 * WorkManager scheduler for the offline sync system.
 * 
 * This scheduler:
 * - Sets up periodic sync every 15 minutes
 * - Only runs when network is available
 * - Persists across device reboots
 * - Avoids duplicate work requests
 */
object SyncScheduler {

    /**
     * Schedule the periodic background sync worker.
     * Call this in Application.onCreate() or MainActivity.onCreate().
     */
    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)  // Don't sync when battery is low
            .build()

        // Periodic work: runs every 15 minutes
        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(
            15, TimeUnit.MINUTES,
            5, TimeUnit.MINUTES  // Flex interval
        )
            .setConstraints(constraints)
            .addTag(SyncWorker.WORK_NAME)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,  // Keep existing if already scheduled
            syncRequest
        )
    }

    /**
     * Trigger an immediate one-time sync.
     * Use this for "Sync Now" button.
     */
    fun syncNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .addTag("manual_sync")
            .build()

        WorkManager.getInstance(context).enqueue(request)
    }

    /**
     * Cancel all scheduled sync work.
     */
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(SyncWorker.WORK_NAME)
    }

    /**
     * Check if sync work is currently scheduled.
     */
    fun isScheduled(context: Context): Boolean {
        val workManager = WorkManager.getInstance(context)
        val workInfos = workManager.getWorkInfosForUniqueWork(SyncWorker.WORK_NAME).get()
        return workInfos.any { !it.state.isFinished }
    }
}
