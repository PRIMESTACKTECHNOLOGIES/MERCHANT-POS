package com.pos2013.offline.config

import android.content.Context
import android.content.SharedPreferences

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * GATEWAY CONFIGURATION - PRODUCTION DEPLOYMENT READY
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * INSTRUCTIONS FOR RENDER DEPLOYMENT:
 * 
 * STEP 1: Deploy backend to Render (see DEPLOY_TO_RENDER.md)
 * STEP 2: Copy your Render URL (e.g., https://pos-offline-xyz.onrender.com)
 * STEP 3: Replace RENDER_URL below with your actual URL
 * STEP 4: Set USE_LOCAL = false
 * STEP 5: Rebuild APK: Build → Build Bundle(s) / APK(s) → Build APK(s)
 * STEP 6: Install APK on your POS devices
 * 
 * ═════════════════════════════════════════════════════════════════════════════
 */
object GatewayConfig {
    
    private var prefs: SharedPreferences? = null
    
    // ═════════════════════════════════════════════════════════════════════════
    // 🔴 PRODUCTION CONFIGURATION - UPDATE THESE VALUES
    // ═════════════════════════════════════════════════════════════════════════
    
    /**
     * YOUR RENDER DEPLOYMENT URL
     * After deploying to Render, copy your URL here
     * Example: "https://pos-offline-abc123.onrender.com/"
     */
    private const val RENDER_URL = "https://pos-offline-sftwr.onrender.com/"
    
    /**
     * Local development URL (for testing only)
     * Uses your PC's IP address for local network testing
     * UPDATE THIS TO YOUR LOCAL PC IP ADDRESS (run 'ipconfig' in terminal)
     * Format: http://[YOUR_PC_IP]:7000/
     */
    private const val LOCAL_URL = "http://192.168.1.160:7000/"
    
    /**
     * SWITCH BETWEEN LOCAL AND PRODUCTION
     * true = Use local server (testing with Android emulator or phone on same network)
     * false = Use Render production server (live deployment)
     */
    private const val USE_LOCAL = false  // Set to true for development, false for production
    
    // ═════════════════════════════════════════════════════════════════════════
    // DEFAULT VALUES - DO NOT CHANGE
    // ═════════════════════════════════════════════════════════════════════════
    
    private const val DEFAULT_MERCHANT_ID = "MRC-1001"
    private const val DEFAULT_TERMINAL_ID = "T2013-001"
    private const val DEFAULT_SECRET_KEY = "sk_test_default_key_123"
    
    // MyFatoorah Configuration for REAL PAYMENTS
    private const val DEFAULT_MYFATOORAH_TOKEN = "" // Set via Settings screen
    private const val DEFAULT_MYFATOORAH_TEST_MODE = false // false = LIVE payments
    
    // ═════════════════════════════════════════════════════════════════════════
    // ACTIVE SERVER URL (Auto-selected based on USE_LOCAL)
    // ═════════════════════════════════════════════════════════════════════════
    
    private val DEFAULT_SERVER_URL = if (USE_LOCAL) LOCAL_URL else RENDER_URL
    
    // Current values (loaded from preferences)
    var MERCHANT_ID: String = DEFAULT_MERCHANT_ID
        private set
    var TERMINAL_ID: String = DEFAULT_TERMINAL_ID
        private set
    var SERVER_URL: String = DEFAULT_SERVER_URL
        private set
    var GATEWAY_SECRET_KEY: String = DEFAULT_SECRET_KEY
        private set
    
    // MyFatoorah values
    var MYFATOORAH_TOKEN: String = DEFAULT_MYFATOORAH_TOKEN
        private set
    var MYFATOORAH_TEST_MODE: Boolean = DEFAULT_MYFATOORAH_TEST_MODE
        private set
    
    val GATEWAY_API_URL: String
        get() = SERVER_URL
    
    /**
     * Get the currently active server URL
     */
    fun getCurrentServerUrl(): String = SERVER_URL
    
    /**
     * Check if using local development server
     */
    fun isLocalMode(): Boolean = USE_LOCAL
    
    /**
     * Sanitize URL - ensures valid Retrofit base URL
     */
    fun sanitizeUrl(url: String?): String {
        var fixed = url?.trim().orEmpty()

        // If empty → use default
        if (fixed.isBlank()) return DEFAULT_SERVER_URL

        // Ensure HTTPS for production
        if (!fixed.startsWith("https://") && !fixed.startsWith("http://")) {
            fixed = "https://$fixed"
        }

        // Ensure trailing slash
        if (!fixed.endsWith("/")) {
            fixed += "/"
        }

        return fixed
    }
    
    /**
     * Get MyFatoorah Authorization Header
     */
    fun getMyFatoorahAuth(): String = "Bearer $MYFATOORAH_TOKEN"
    
    /**
     * Initialize GatewayConfig with context (call in Application or MainActivity)
     */
    fun initialize(context: Context) {
        prefs = context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
        refreshFromPreferences(context)
    }
    
    /**
     * Refresh configuration from SharedPreferences
     */
    fun refreshFromPreferences(context: Context) {
        if (prefs == null) {
            prefs = context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
        }

        prefs?.let {
            MERCHANT_ID = it.getString("merchant_id", DEFAULT_MERCHANT_ID) ?: DEFAULT_MERCHANT_ID
            TERMINAL_ID = it.getString("terminal_id", DEFAULT_TERMINAL_ID) ?: DEFAULT_TERMINAL_ID
            SERVER_URL = sanitizeUrl(it.getString("server_url", DEFAULT_SERVER_URL))
            GATEWAY_SECRET_KEY = it.getString("secret_key", DEFAULT_SECRET_KEY) ?: DEFAULT_SECRET_KEY
            MYFATOORAH_TOKEN = it.getString("myfatoorah_token", DEFAULT_MYFATOORAH_TOKEN) ?: DEFAULT_MYFATOORAH_TOKEN
            MYFATOORAH_TEST_MODE = it.getBoolean("myfatoorah_test_mode", DEFAULT_MYFATOORAH_TEST_MODE)
        }
    }
    
    /**
     * Save server configuration
     */
    fun saveServerConfig(context: Context, serverUrl: String, merchantId: String, secretKey: String) {
        context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("server_url", sanitizeUrl(serverUrl))
            .putString("merchant_id", merchantId)
            .putString("secret_key", secretKey)
            .apply()
        
        SERVER_URL = sanitizeUrl(serverUrl)
        MERCHANT_ID = merchantId
        GATEWAY_SECRET_KEY = secretKey
    }
    
    /**
     * Check if device is registered
     */
    fun isDeviceRegistered(context: Context): Boolean {
        return context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .getBoolean("device_registered", false)
    }
    
    /**
     * Save device registration status
     */
    fun setDeviceRegistered(context: Context, registered: Boolean) {
        context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("device_registered", registered)
            .apply()
    }
    
    /**
     * Save MyFatoorah configuration for LIVE payments
     */
    fun saveMyFatoorahConfig(context: Context, token: String, testMode: Boolean = false) {
        context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("myfatoorah_token", token)
            .putBoolean("myfatoorah_test_mode", testMode)
            .apply()
        
        MYFATOORAH_TOKEN = token
        MYFATOORAH_TEST_MODE = testMode
    }
    
    /**
     * Check if MyFatoorah is configured
     */
    fun isMyFatoorahConfigured(): Boolean = MYFATOORAH_TOKEN.isNotBlank()
    
    /**
     * Clear registration (for logout/reset)
     */
    fun clearRegistration(context: Context) {
        context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("device_registered", false)
            .apply()
    }
    
    /**
     * Reset all configuration to defaults
     */
    fun resetToDefaults(context: Context) {
        context.getSharedPreferences("pos_prefs", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
        
        MERCHANT_ID = DEFAULT_MERCHANT_ID
        TERMINAL_ID = DEFAULT_TERMINAL_ID
        SERVER_URL = DEFAULT_SERVER_URL
        GATEWAY_SECRET_KEY = DEFAULT_SECRET_KEY
        MYFATOORAH_TOKEN = DEFAULT_MYFATOORAH_TOKEN
        MYFATOORAH_TEST_MODE = DEFAULT_MYFATOORAH_TEST_MODE
    }
    
    /**
     * Get configuration summary for debugging
     */
    fun getConfigSummary(): String {
        return """
            Mode: ${if (USE_LOCAL) "LOCAL" else "PRODUCTION"}
            Server: $SERVER_URL
            Merchant: $MERCHANT_ID
            Terminal: $TERMINAL_ID
            MyFatoorah: ${if (isMyFatoorahConfigured()) "Configured" else "Not Configured"}
            Test Mode: $MYFATOORAH_TEST_MODE
        """.trimIndent()
    }
}
