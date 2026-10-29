package com.pos2013.offline.sync

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.pos2013.offline.PosApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

class SyncForegroundService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private var running = false
    private var syncJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Primestack POS sync ready…", 0))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!running) {
            running = true
            startBackgroundLoop()
        }
        return START_STICKY
    }

    private fun startBackgroundLoop() {
        syncJob?.cancel()
        syncJob = scope.launch {
            while (running) {
                try {
                    val app = applicationContext as PosApplication
                    val pending = app.repository.getPendingCount()
                    if (pending > 0) {
                        updateNotification("Syncing $pending records…", 0)
                        val r = app.repository.syncPendingTransactions()
                        updateNotification(
                            if (r.success) "Synced ${r.count} txn + ${r.walletTopupsSynced} topups"
                            else "Sync failed: ${r.errorMessage ?: "unknown"}",
                            r.count + r.walletTopupsSynced
                        )
                    } else {
                        updateNotification("No pending records", 0)
                    }
                } catch (t: Throwable) {
                    Log.e(TAG, "Sync loop error", t)
                    updateNotification("Sync error: ${t.message ?: "-"}", 0)
                }
                delay(60_000L)
            }
        }
    }

    override fun onDestroy() {
        running = false
        syncJob?.cancel()
        super.onDestroy()
    }

    private fun buildNotification(text: String, progress: Int): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Primestack POS Data Sync")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setProgress(0, 0, progress == 0)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    @SuppressLint("MissingPermission")
    private fun updateNotification(text: String, progress: Int) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            androidx.core.content.ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED) {
            nm.notify(NOTIF_ID, buildNotification(text, progress))
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "Primestack POS Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Continuous offline queue sync for POS terminals"
                enableLights(false)
                enableVibration(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(ch)
        }
    }

    companion object {
        private const val CHANNEL_ID = "primestack_pos_sync_channel"
        private const val NOTIF_ID = 1019
        private const val TAG = "SyncForegroundService"
    }
}
