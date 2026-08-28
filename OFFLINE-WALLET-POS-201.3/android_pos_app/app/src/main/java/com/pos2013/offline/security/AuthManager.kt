package com.pos2013.offline.security

import android.content.Context
import java.security.MessageDigest

object AuthManager {
    private const val KEY_USERNAME = "auth_username"
    private const val KEY_PASSWORD_HASH = "auth_password_hash"
    private const val KEY_SESSION_UNLOCKED_AT = "session_unlocked_at"
    private const val KEY_REQUIRE_PASSWORD_CHANGE = "require_password_change"

    private const val DEFAULT_USERNAME = "Merchant"
    private const val DEFAULT_PASSWORD = "920791"

    private const val SESSION_TIMEOUT_MS = 5 * 60 * 1000L

    fun ensureDefaults(context: Context) {
        val prefs = SecurePrefs.get(context)
        if (!prefs.contains(KEY_USERNAME) || !prefs.contains(KEY_PASSWORD_HASH)) {
            prefs.edit()
                .putString(KEY_USERNAME, DEFAULT_USERNAME)
                .putString(KEY_PASSWORD_HASH, hash(DEFAULT_PASSWORD))
                .putBoolean(KEY_REQUIRE_PASSWORD_CHANGE, true)
                .apply()
        }
    }

    fun validate(context: Context, username: String, password: String): Boolean {
        ensureDefaults(context)
        val prefs = SecurePrefs.get(context)
        val u = prefs.getString(KEY_USERNAME, DEFAULT_USERNAME) ?: DEFAULT_USERNAME
        val h = prefs.getString(KEY_PASSWORD_HASH, "") ?: ""
        return username == u && hash(password) == h
    }

    fun markUnlocked(context: Context) {
        SecurePrefs.get(context).edit()
            .putLong(KEY_SESSION_UNLOCKED_AT, System.currentTimeMillis())
            .apply()
    }

    fun isUnlocked(context: Context): Boolean {
        ensureDefaults(context)
        val ts = SecurePrefs.get(context).getLong(KEY_SESSION_UNLOCKED_AT, 0L)
        if (ts <= 0L) return false
        return System.currentTimeMillis() - ts <= SESSION_TIMEOUT_MS
    }

    fun lock(context: Context) {
        SecurePrefs.get(context).edit()
            .putLong(KEY_SESSION_UNLOCKED_AT, 0L)
            .apply()
    }

    fun requiresPasswordChange(context: Context): Boolean {
        ensureDefaults(context)
        return SecurePrefs.get(context).getBoolean(KEY_REQUIRE_PASSWORD_CHANGE, true)
    }

    fun changePassword(context: Context, newPassword: String) {
        ensureDefaults(context)
        SecurePrefs.get(context).edit()
            .putString(KEY_PASSWORD_HASH, hash(newPassword))
            .putBoolean(KEY_REQUIRE_PASSWORD_CHANGE, false)
            .apply()
        markUnlocked(context)
    }

    private fun hash(value: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

