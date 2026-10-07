package com.pos2013.offline

import android.app.Application
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.workers.SyncWorker
import java.util.concurrent.TimeUnit

class PosApplication : Application() {

    val database: AppDatabase by lazy { AppDatabase.getDatabase(this) }

    override fun onCreate() {
        super.onCreate()
        scheduleSyncWorker()
        // Always lock to the cloud backend URL
        getSharedPreferences("pos_settings", MODE_PRIVATE)
            .edit()
            .putString("server_url", ApiClient.DEFAULT_URL)
            .apply()
    }

    private fun scheduleSyncWorker() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "POS_SYNC_WORKER",
            ExistingPeriodicWorkPolicy.KEEP,
            syncRequest
        )
    }

    companion object {

        suspend fun probeAndResolveUrl(context: Context): String = ApiClient.DEFAULT_URL

        fun getServerUrl(context: Context): String = ApiClient.DEFAULT_URL

        fun getJwtToken(context: Context): String? {
            val prefs = context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            return prefs.getString("jwt_token", null)
        }

        fun saveJwtToken(context: Context, token: String) {
            context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                .edit().putString("jwt_token", token).apply()
        }

        fun clearJwtToken(context: Context) {
            context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                .edit().remove("jwt_token").apply()
        }

        fun isLoggedIn(context: Context): Boolean = !getJwtToken(context).isNullOrBlank()
    }
}
