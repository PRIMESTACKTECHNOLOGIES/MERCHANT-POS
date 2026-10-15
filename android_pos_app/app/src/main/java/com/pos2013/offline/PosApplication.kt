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
        val prefs = getSharedPreferences("pos_settings", MODE_PRIVATE)
        val current = prefs.getString("server_url", null)
        if (current.isNullOrBlank()) {
            prefs.edit().putString("server_url", ApiClient.DEFAULT_URL).apply()
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

        private const val PREFS = "pos_settings"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_MERCHANT_ID = "merchant_id"
        private const val KEY_TERMINAL_ID = "terminal_id"
        private const val KEY_SECRET_KEY = "secret_key"
        private const val KEY_TERMINAL_VERIFIED = "terminal_verified"

        suspend fun probeAndResolveUrl(context: Context): String {
            return getServerUrl(context)
        }

        fun getServerUrl(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE)
            val v = prefs.getString(KEY_SERVER_URL, ApiClient.DEFAULT_URL).orEmpty().trim()
            return v.ifBlank { ApiClient.DEFAULT_URL }
        }

        fun saveServerUrl(context: Context, url: String) {
            val cleaned = url.trim().trimEnd('/') + "/"
            context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, cleaned)
                .apply()
        }

        fun getMerchantId(context: Context): String {
            return context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(KEY_MERCHANT_ID, "").orEmpty().trim()
        }

        fun getTerminalId(context: Context): String {
            return context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(KEY_TERMINAL_ID, "").orEmpty().trim()
        }

        fun getSecretKey(context: Context): String {
            return context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(KEY_SECRET_KEY, "").orEmpty().trim()
        }

        fun isTerminalVerified(context: Context): Boolean {
            val mid = getMerchantId(context)
            val tid = getTerminalId(context)
            val sk = getSecretKey(context)
            val explicit = context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .getBoolean(KEY_TERMINAL_VERIFIED, false)
            return explicit || (mid.isNotBlank() && tid.isNotBlank() && sk.isNotBlank())
        }

        fun saveTerminalCredentials(
            context: Context,
            serverUrl: String,
            merchantId: String,
            terminalId: String,
            secretKey: String,
            verified: Boolean = true
        ) {
            saveServerUrl(context, serverUrl)
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(KEY_MERCHANT_ID, merchantId.trim())
                .putString(KEY_TERMINAL_ID, terminalId.trim())
                .putString(KEY_SECRET_KEY, secretKey.trim())
                .putBoolean(KEY_TERMINAL_VERIFIED, verified)
                .apply()
        }

        fun clearTerminalCredentials(context: Context) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .remove(KEY_MERCHANT_ID)
                .remove(KEY_TERMINAL_ID)
                .remove(KEY_SECRET_KEY)
                .putBoolean(KEY_TERMINAL_VERIFIED, false)
                .apply()
        }

        fun getJwtToken(context: Context): String? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return prefs.getString("jwt_token", null)
        }

        fun saveJwtToken(context: Context, token: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString("jwt_token", token).apply()
        }

        fun clearJwtToken(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove("jwt_token").apply()
        }

        fun isLoggedIn(context: Context): Boolean = !getJwtToken(context).isNullOrBlank()
    }
}
