package com.pos2013.offline.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure storage for sensitive data using AndroidX Security library.
 * All API tokens, secrets, and credentials are encrypted at rest.
 */
class SecureStorage(context: Context) {
    
    companion object {
        private const val PREFS_FILE = "secure_pos_prefs"
        private const val KEY_API_TOKEN = "api_token"
        private const val KEY_MERCHANT_ID = "merchant_id"
        private const val KEY_TERMINAL_ID = "terminal_id"
        private const val KEY_TERMINAL_SECRET = "terminal_secret"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_MYFATOORAH_TOKEN = "myfatoorah_token"
        private const val KEY_IS_CONFIGURED = "is_configured"
        private const val KEY_LAST_SYNC = "last_sync"
        private const val KEY_OFFLINE_MODE = "offline_mode"
        private const val KEY_TEST_MODE = "test_mode"
    }

    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val securePrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        PREFS_FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    // API Token
    fun getApiToken(): String? = securePrefs.getString(KEY_API_TOKEN, null)
    fun setApiToken(token: String?) {
        securePrefs.edit().putString(KEY_API_TOKEN, token).apply()
    }

    // Merchant ID
    fun getMerchantId(): String = securePrefs.getString(KEY_MERCHANT_ID, "") ?: ""
    fun setMerchantId(id: String) {
        securePrefs.edit().putString(KEY_MERCHANT_ID, id).apply()
    }

    // Terminal ID
    fun getTerminalId(): String = securePrefs.getString(KEY_TERMINAL_ID, "") ?: ""
    fun setTerminalId(id: String) {
        securePrefs.edit().putString(KEY_TERMINAL_ID, id).apply()
    }

    // Terminal Secret (for HMAC)
    fun getTerminalSecret(): String = securePrefs.getString(KEY_TERMINAL_SECRET, "") ?: ""
    fun setTerminalSecret(secret: String) {
        securePrefs.edit().putString(KEY_TERMINAL_SECRET, secret).apply()
    }

    // Server URL
    fun getServerUrl(): String = securePrefs.getString(KEY_SERVER_URL, "") ?: ""
    fun setServerUrl(url: String) {
        securePrefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    // MyFatoorah Token
    fun getMyFatoorahToken(): String = securePrefs.getString(KEY_MYFATOORAH_TOKEN, "") ?: ""
    fun setMyFatoorahToken(token: String) {
        securePrefs.edit().putString(KEY_MYFATOORAH_TOKEN, token).apply()
    }

    // Configuration status
    fun isConfigured(): Boolean = securePrefs.getBoolean(KEY_IS_CONFIGURED, false)
    fun setConfigured(configured: Boolean) {
        securePrefs.edit().putBoolean(KEY_IS_CONFIGURED, configured).apply()
    }

    // Last sync timestamp
    fun getLastSync(): Long = securePrefs.getLong(KEY_LAST_SYNC, 0)
    fun setLastSync(timestamp: Long) {
        securePrefs.edit().putLong(KEY_LAST_SYNC, timestamp).apply()
    }

    // Offline mode
    fun isOfflineMode(): Boolean = securePrefs.getBoolean(KEY_OFFLINE_MODE, true)
    fun setOfflineMode(enabled: Boolean) {
        securePrefs.edit().putBoolean(KEY_OFFLINE_MODE, enabled).apply()
    }

    // Test mode
    fun isTestMode(): Boolean = securePrefs.getBoolean(KEY_TEST_MODE, true)
    fun setTestMode(enabled: Boolean) {
        securePrefs.edit().putBoolean(KEY_TEST_MODE, enabled).apply()
    }

    // Clear all data
    fun clearAll() {
        securePrefs.edit().clear().apply()
    }

    // Check if terminal is registered
    fun isTerminalRegistered(): Boolean {
        return isConfigured() && 
               getTerminalId().isNotEmpty() && 
               getMerchantId().isNotEmpty() &&
               getTerminalSecret().isNotEmpty()
    }
}
