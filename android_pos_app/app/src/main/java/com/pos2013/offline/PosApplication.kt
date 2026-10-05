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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class PosApplication : Application() {

    val database: AppDatabase by lazy { AppDatabase.getDatabase(this) }

    override fun onCreate() {
        super.onCreate()
        scheduleSyncWorker()
        // Background: probe both IPs at startup and persist the reachable one
        CoroutineScope(Dispatchers.IO).launch {
            val resolved = probeAndResolveUrl(this@PosApplication)
            if (resolved != null) {
                val prefs = getSharedPreferences("pos_settings", MODE_PRIVATE)
                val current = prefs.getString("server_url", null)
                // Only auto-save if the user hasn't manually set a URL already
                if (current.isNullOrBlank() || current == ApiClient.DEFAULT_URL || current == ApiClient.FALLBACK_URL) {
                    prefs.edit().putString("server_url", resolved).apply()
                    android.util.Log.i("PosApplication", "Auto-resolved backend URL: $resolved")
                }
            }
        }
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

        /**
         * Probe both backend IPs and return whichever responds to GET /health first.
         * Order: user-saved URL → PRIMARY (172.16.0.121) → FALLBACK (172.16.0.140)
         * Returns null if neither responds within timeout.
         */
        suspend fun probeAndResolveUrl(context: Context): String? {
            val prefs = context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            val saved = prefs.getString("server_url", null)?.takeIf { it.isNotBlank() }

            // Candidates in priority order — saved URL first, then both IPs
            val candidates = buildList {
                if (saved != null) add(saved)
                if (saved != ApiClient.DEFAULT_URL) add(ApiClient.DEFAULT_URL)
                if (saved != ApiClient.FALLBACK_URL) add(ApiClient.FALLBACK_URL)
            }.distinct()

            for (baseUrl in candidates) {
                val reachable = withTimeoutOrNull(3_000L) {
                    pingHealth(baseUrl)
                } ?: false
                if (reachable) return baseUrl
            }
            return null
        }

        /** Returns true if GET <baseUrl>health returns HTTP 2xx within timeout */
        private fun pingHealth(baseUrl: String): Boolean {
            return try {
                val url = URL("${baseUrl.trimEnd('/')}/health")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 2500
                conn.readTimeout    = 2500
                conn.requestMethod  = "GET"
                conn.connect()
                val code = conn.responseCode
                conn.disconnect()
                code in 200..299
            } catch (_: Exception) {
                false
            }
        }

        /**
         * Read server URL from SharedPrefs — falls back to DEFAULT_URL.
         * Call probeAndResolveUrl() on a background coroutine at startup
         * to auto-detect which IP responds; this is the fast synchronous read.
         */
        fun getServerUrl(context: Context): String {
            val prefs = context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            return prefs.getString("server_url", ApiClient.DEFAULT_URL)
                ?.takeIf { it.isNotBlank() }
                ?: ApiClient.DEFAULT_URL
        }

        /** Read stored JWT token (null if not logged in yet) */
        fun getJwtToken(context: Context): String? {
            val prefs = context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            return prefs.getString("jwt_token", null)
        }

        /** Persist JWT token after successful login */
        fun saveJwtToken(context: Context, token: String) {
            context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                .edit().putString("jwt_token", token).apply()
        }

        /** Clear JWT token on logout */
        fun clearJwtToken(context: Context) {
            context.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                .edit().remove("jwt_token").apply()
        }

        fun isLoggedIn(context: Context): Boolean = !getJwtToken(context).isNullOrBlank()
    }
}
