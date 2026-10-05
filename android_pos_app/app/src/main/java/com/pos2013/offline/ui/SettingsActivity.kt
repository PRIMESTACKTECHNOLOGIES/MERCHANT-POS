package com.pos2013.offline.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.LoginRequest
import com.pos2013.offline.data.api.TerminalRegisterRequest
import com.pos2013.offline.data.api.TerminalVerifyRequest
import kotlinx.coroutines.launch
import com.pos2013.offline.utils.DeviceUtils

class SettingsActivity : AppCompatActivity() {

    private val prefsName = "pos_settings"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "POS Settings"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            setBackgroundColor(Color.parseColor("#F5F7FA"))
        }

        // ── Section: Backend URL ──────────────────────────────────────────────
        root.addView(sectionLabel("Backend Server URL"))
        root.addView(hintLabel(
            "This PC: http://172.16.0.210:7000/  |  " +
            "Emulator: http://10.0.2.2:7000/"
        ))
        val etUrl = editField(
            hint = "http://172.16.0.210:7000/",
            value = prefs.getString("server_url", ApiClient.DEFAULT_URL) ?: ApiClient.DEFAULT_URL
        )
        root.addView(etUrl)
        root.addView(spacer(4))

        // Auto-detect button — probes both IPs and fills the URL field
        val tvAutoDetectStatus = statusLabel("")
        val btnAutoDetect = Button(this).apply {
            text = "🔍 Auto-Detect Server"
            textSize = 13f
            setTextColor(Color.parseColor("#1D4ED8"))
            setBackgroundColor(Color.parseColor("#EFF6FF"))
            setPadding(0, dp(10), 0, dp(10))
            gravity = Gravity.CENTER
            setOnClickListener {
                isEnabled = false
                text = "Detecting..."
                tvAutoDetectStatus.text = "⏳ Probing 172.16.0.121 and 172.16.0.140..."
                tvAutoDetectStatus.setTextColor(Color.parseColor("#D97706"))
                lifecycleScope.launch {
                    val resolved = PosApplication.probeAndResolveUrl(this@SettingsActivity)
                    if (resolved != null) {
                        etUrl.setText(resolved)
                        tvAutoDetectStatus.text = "✅ Found: $resolved"
                        tvAutoDetectStatus.setTextColor(Color.parseColor("#16A34A"))
                    } else {
                        tvAutoDetectStatus.text = "❌ Neither IP responded — check Wi-Fi and backend"
                        tvAutoDetectStatus.setTextColor(Color.parseColor("#DC2626"))
                    }
                    isEnabled = true
                    text = "🔍 Auto-Detect Server"
                }
            }
        }
        root.addView(btnAutoDetect)
        root.addView(spacer(4))
        root.addView(tvAutoDetectStatus)
        root.addView(spacer(16))

        // ── Section: Admin Login ──────────────────────────────────────────────
        root.addView(sectionLabel("Admin Login"))
        root.addView(hintLabel("Login to get a JWT token — required for wallet operations."))

        val etUsername = editField(
            hint = "admin",
            value = prefs.getString("admin_username", "admin") ?: "admin"
        )
        root.addView(etUsername)
        root.addView(spacer(8))

        val etPassword = editField(
            hint = "password",
            value = "",
            password = true
        )
        root.addView(etPassword)
        root.addView(spacer(8))

        val tvLoginStatus = statusLabel("")
        val isLoggedIn = PosApplication.isLoggedIn(this)
        if (isLoggedIn) {
            tvLoginStatus.text = "✅ Logged in — JWT token stored"
            tvLoginStatus.setTextColor(Color.parseColor("#16A34A"))
        }

        val btnLogin = Button(this).apply {
            text = if (isLoggedIn) "Re-Login" else "Login"
            textSize = 15f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1D4ED8"))
            setPadding(0, dp(12), 0, dp(12))
            gravity = Gravity.CENTER
            setOnClickListener {
                val serverUrl = formatServerUrl(etUrl.text.toString())
                val username  = etUsername.text.toString().trim()
                val password  = etPassword.text.toString()

                if (serverUrl.isEmpty() || username.isEmpty() || password.isEmpty()) {
                    Toast.makeText(this@SettingsActivity, "Enter URL, username and password", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                isEnabled = false
                text = "Logging in..."
                tvLoginStatus.text = "⏳ Contacting server..."
                tvLoginStatus.setTextColor(Color.parseColor("#D97706"))

                lifecycleScope.launch {
                    try {
                        val authApi = ApiClient.createAuthApi(serverUrl)
                        val response = authApi.login(LoginRequest(username, password))

                        if (response.isSuccessful && response.body() != null) {
                            val token = response.body()!!.token
                            PosApplication.saveJwtToken(this@SettingsActivity, token)
                            prefs.edit()
                                .putString("server_url", serverUrl)
                                .putString("admin_username", username)
                                .apply()

                            tvLoginStatus.text = "✅ Login successful — JWT token saved"
                            tvLoginStatus.setTextColor(Color.parseColor("#16A34A"))
                            Toast.makeText(this@SettingsActivity, "Logged in!", Toast.LENGTH_SHORT).show()
                            text = "Re-Login"
                        } else {
                            val err = response.errorBody()?.string() ?: "Login failed (${response.code()})"
                            tvLoginStatus.text = "❌ $err"
                            tvLoginStatus.setTextColor(Color.parseColor("#DC2626"))
                        }
                    } catch (e: Exception) {
                        val msg = when (e) {
                            is java.net.SocketTimeoutException -> "❌ Timeout — is the server running?"
                            is java.net.ConnectException      -> "❌ Cannot connect — check URL and Wi-Fi"
                            else -> "❌ ${e.localizedMessage ?: e.message}"
                        }
                        tvLoginStatus.text = msg
                        tvLoginStatus.setTextColor(Color.parseColor("#DC2626"))
                    } finally {
                        isEnabled = true
                        if (text == "Logging in...") text = "Login"
                    }
                }
            }
        }
        root.addView(btnLogin)
        root.addView(spacer(4))
        root.addView(tvLoginStatus)
        root.addView(spacer(20))

        // ── Section: Merchant / Terminal credentials ──────────────────────────
        root.addView(sectionLabel("Merchant ID"))
        val etMerchant = editField(
            hint = "MRC-1001",
            value = prefs.getString("merchant_id", "") ?: ""
        )
        root.addView(etMerchant)
        root.addView(spacer(12))

        root.addView(sectionLabel("Terminal ID"))
        val etTerminal = editField(
            hint = "T2013-XXXX",
            value = prefs.getString("terminal_id", "") ?: ""
        )
        root.addView(etTerminal)
        root.addView(spacer(12))

        root.addView(sectionLabel("Secret Key"))
        root.addView(hintLabel("Generated automatically when you tap Register Terminal."))
        val etSecret = editField(
            hint = "terminal secret key",
            value = prefs.getString("secret_key", "") ?: "",
            password = true
        )
        root.addView(etSecret)
        root.addView(spacer(12))

        root.addView(sectionLabel("Connection Mode"))
        val switchCard = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            setPadding(dp(16), dp(16), dp(16), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val chkRequireBackend = Switch(this).apply {
            text = " Require backend connection"
            isChecked = prefs.getBoolean("require_backend_connection", true)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
            scaleX = 1.3f
            scaleY = 1.3f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        switchCard.addView(chkRequireBackend)
        root.addView(switchCard)
        root.addView(spacer(16))

        // ── Section: Terminal registration ────────────────────────────────────
        val tvRegisterStatus = statusLabel("")

        val btnRegister = Button(this).apply {
            text = "Register Terminal"
            textSize = 15f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0F766E"))
            setPadding(0, dp(14), 0, dp(14))
            gravity = Gravity.CENTER
            setOnClickListener {
                val serverUrl = formatServerUrl(etUrl.text.toString())
                if (serverUrl.isEmpty()) {
                    Toast.makeText(this@SettingsActivity, "Enter server URL first", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                isEnabled = false
                text = "Registering..."
                tvRegisterStatus.text = "⏳ Contacting server..."
                tvRegisterStatus.setTextColor(Color.parseColor("#D97706"))

                lifecycleScope.launch {
                    try {
                        val api        = ApiClient.createTerminalsApi(serverUrl)
                        val deviceName = android.os.Build.MODEL ?: "Android POS"
                        val response   = api.registerTerminal(
                            TerminalRegisterRequest(
                                terminalName = deviceName,
                                deviceSerial = DeviceUtils.getDeviceSerialNumber(this@SettingsActivity)
                            )
                        )

                        if (response.isSuccessful && response.body() != null) {
                            val body = response.body()!!
                            etMerchant.setText(body.merchantId)
                            etTerminal.setText(body.terminalId)
                            etSecret.setText(body.terminalSecret)

                            prefs.edit()
                                .putString("server_url",   serverUrl)
                                .putString("merchant_id",  body.merchantId)
                                .putString("terminal_id",  body.terminalId)
                                .putString("secret_key",   body.terminalSecret)
                                .putBoolean("require_backend_connection", chkRequireBackend.isChecked)
                                .apply()

                            tvRegisterStatus.text = "✅ Registered! Merchant: ${body.merchantId}  Terminal: ${body.terminalId}"
                            tvRegisterStatus.setTextColor(Color.parseColor("#16A34A"))
                            Toast.makeText(this@SettingsActivity, "Terminal registered!", Toast.LENGTH_LONG).show()
                        } else {
                            tvRegisterStatus.text = "❌ Registration failed (HTTP ${response.code()}): ${response.errorBody()?.string()}"
                            tvRegisterStatus.setTextColor(Color.parseColor("#DC2626"))
                        }
                    } catch (e: Exception) {
                        tvRegisterStatus.text = when (e) {
                            is java.net.SocketTimeoutException -> "❌ Timeout — is the server running?"
                            is java.net.ConnectException      -> "❌ Cannot connect — check URL and Wi-Fi"
                            else -> "❌ ${e.localizedMessage ?: e.message}"
                        }
                        tvRegisterStatus.setTextColor(Color.parseColor("#DC2626"))
                    } finally {
                        isEnabled = true
                        text = "Register Terminal"
                    }
                }
            }
        }
        root.addView(btnRegister)
        root.addView(spacer(4))

        val btnVerify = Button(this).apply {
            text = "Verify Credentials"
            textSize = 14f
            setTextColor(Color.parseColor("#1E3A5F"))
            setBackgroundColor(Color.parseColor("#DBEAFE"))
            setPadding(0, dp(12), 0, dp(12))
            gravity = Gravity.CENTER
            setOnClickListener {
                val serverUrl  = formatServerUrl(etUrl.text.toString())
                val merchantId = etMerchant.text.toString().trim()
                val terminalId = etTerminal.text.toString().trim()
                val secretKey  = etSecret.text.toString().trim()

                if (serverUrl.isEmpty() || merchantId.isEmpty() || terminalId.isEmpty() || secretKey.isEmpty()) {
                    Toast.makeText(this@SettingsActivity, "Fill all fields first", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                isEnabled = false
                text = "Verifying..."

                lifecycleScope.launch {
                    try {
                        val api      = ApiClient.createTerminalsApi(serverUrl)
                        val response = api.verifyTerminal(
                            TerminalVerifyRequest(merchantId, terminalId, secretKey)
                        )

                        if (response.isSuccessful && response.body() != null) {
                            val body = response.body()!!
                            if (body.valid) {
                                tvRegisterStatus.text = "✅ Verified! Terminal: ${body.name ?: terminalId}  Offline: ${body.offlineEnabled}"
                                tvRegisterStatus.setTextColor(Color.parseColor("#16A34A"))
                            } else {
                                tvRegisterStatus.text = "❌ Invalid: ${body.message ?: "Verification failed"}"
                                tvRegisterStatus.setTextColor(Color.parseColor("#DC2626"))
                            }
                        } else {
                            tvRegisterStatus.text = "❌ Verify failed (HTTP ${response.code()})"
                            tvRegisterStatus.setTextColor(Color.parseColor("#DC2626"))
                        }
                    } catch (e: Exception) {
                        tvRegisterStatus.text = when (e) {
                            is java.net.SocketTimeoutException -> "❌ Timeout"
                            is java.net.ConnectException      -> "❌ Cannot connect"
                            else -> "❌ ${e.localizedMessage ?: e.message}"
                        }
                        tvRegisterStatus.setTextColor(Color.parseColor("#DC2626"))
                    } finally {
                        isEnabled = true
                        text = "Verify Credentials"
                    }
                }
            }
        }
        root.addView(btnVerify)
        root.addView(spacer(8))
        root.addView(tvRegisterStatus)
        root.addView(spacer(20))

        // ── Save Settings ─────────────────────────────────────────────────────
        val btnSave = Button(this).apply {
            text = "Save Settings"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1D4ED8"))
            setPadding(0, dp(16), 0, dp(16))
            gravity = Gravity.CENTER
            setOnClickListener {
                val url      = formatServerUrl(etUrl.text.toString())
                val merchant = etMerchant.text.toString().trim()
                val terminal = etTerminal.text.toString().trim()
                val secret   = etSecret.text.toString().trim()

                if (url.isEmpty() || merchant.isEmpty() || terminal.isEmpty() || secret.isEmpty()) {
                    Toast.makeText(
                        this@SettingsActivity,
                        "Complete all fields before saving. Secret Key is required.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@setOnClickListener
                }

                prefs.edit()
                    .putString("server_url",   url)
                    .putString("merchant_id",  merchant)
                    .putString("terminal_id",  terminal)
                    .putString("secret_key",   secret)
                    .putBoolean("require_backend_connection", chkRequireBackend.isChecked)
                    .apply()

                Toast.makeText(this@SettingsActivity, "Settings saved ✅", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
        root.addView(btnSave)

        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun formatServerUrl(input: String): String {
        var url = input.trim()
        if (url.isEmpty()) return ""
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://$url"
        if (!url.endsWith("/")) url = "$url/"
        return url
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressedDispatcher.onBackPressed()
        return true
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun sectionLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 13f
        setTextColor(Color.parseColor("#374151"))
        typeface  = android.graphics.Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(4))
    }

    private fun hintLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 11f
        setTextColor(Color.parseColor("#9CA3AF"))
        setPadding(0, 0, 0, dp(6))
    }

    private fun statusLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 12f
        setTextColor(Color.parseColor("#374151"))
        setPadding(dp(8), dp(4), dp(8), dp(4))
    }

    private fun editField(hint: String, value: String, password: Boolean = false) =
        EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 15f
            setTextColor(Color.parseColor("#111827"))
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            if (password) {
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

    private fun spacer(dpVal: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(dpVal))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
