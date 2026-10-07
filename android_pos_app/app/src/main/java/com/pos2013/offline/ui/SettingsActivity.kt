package com.pos2013.offline.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputFilter
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.ProviderCredentialsTestRequest
import com.pos2013.offline.data.api.TerminalRegisterRequest
import com.pos2013.offline.data.api.TerminalVerifyRequest
import com.pos2013.offline.utils.DeviceUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : AppCompatActivity() {

    private val prefsName = "pos_settings"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "Terminal Settings"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)

        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(40))
            setBackgroundColor(Color.parseColor("#F5F7FA"))
        }

        // ── Section: Backend URL (locked, read-only) ────────────────────────
        root.addView(sectionLabel("Backend Server URL"))
        root.addView(hintLabel("Locked to production cloud endpoint"))
        val lockedUrl = readOnlyField(ApiClient.DEFAULT_URL)
        root.addView(lockedUrl)
        root.addView(spacer(16))

        // ── Section: Merchant / Terminal credentials ────────────────────────
        root.addView(sectionLabel("Merchant / Terminal Credentials"))
        root.addView(hintLabel("Register your terminal first to receive credentials."))

        root.addView(fieldLabel("Merchant ID"))
        val etMerchant = editField(hint = "MRC-XXXX", value = prefs.getString("merchant_id", "") ?: "")
        root.addView(etMerchant)
        root.addView(spacer(10))

        root.addView(fieldLabel("Terminal ID"))
        val etTerminal = editField(hint = "T2013-XXXX", value = prefs.getString("terminal_id", "") ?: "")
        root.addView(etTerminal)
        root.addView(spacer(10))

        root.addView(fieldLabel("Terminal Secret Key"))
        val etSecret = editField(hint = "terminal secret key", value = prefs.getString("secret_key", "") ?: "", password = true)
        root.addView(etSecret)
        root.addView(spacer(16))

        // ── Section: Provider Credentials ───────────────────────────────────
        root.addView(sectionLabel("Fund Provider Credentials"))
        root.addView(hintLabel("Required to send captured funds to your merchant wallet.\nProvider credentials are verified before any fund movement."))

        root.addView(fieldLabel("Provider Endpoint URL"))
        val etProviderEndpoint = editField(
            hint = "https://provider.example.com/api",
            value = prefs.getString("provider_endpoint", "") ?: ""
        )
        root.addView(etProviderEndpoint)
        root.addView(spacer(10))

        root.addView(fieldLabel("Provider API Key"))
        val etProviderApiKey = editField(
            hint = "pk_live_...",
            value = prefs.getString("provider_api_key", "") ?: ""
        )
        root.addView(etProviderApiKey)
        root.addView(spacer(10))

        root.addView(fieldLabel("Provider Secret Key"))
        val etProviderSecret = editField(
            hint = "sk_live_...",
            value = prefs.getString("provider_secret", "") ?: "",
            password = true
        )
        root.addView(etProviderSecret)
        root.addView(spacer(8))

        val tvProviderTestStatus = statusLabel("")
        val btnTestProvider = Button(this).apply {
            text = "🔒  Test Provider Connection"
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#7C3AED"))
            setPadding(0, dp(12), 0, dp(12))
            gravity = Gravity.CENTER
            setOnClickListener {
                val endpoint = etProviderEndpoint.text.toString().trim()
                val apiKey = etProviderApiKey.text.toString().trim()
                val secret = etProviderSecret.text.toString().trim()
                if (endpoint.isEmpty() || apiKey.isEmpty() || secret.isEmpty()) {
                    Toast.makeText(this@SettingsActivity, "Fill all provider fields first", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                testProviderCredentials(endpoint, apiKey, secret, tvProviderTestStatus, this)
            }
        }
        root.addView(btnTestProvider)
        root.addView(spacer(4))
        root.addView(tvProviderTestStatus)
        root.addView(spacer(20))

        // ── Section: Connection Mode ────────────────────────────────────────
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
            text = " Require backend connection to charge"
            isChecked = prefs.getBoolean("require_backend_connection", true)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0F172A"))
            scaleX = 1.2f
            scaleY = 1.2f
        }
        switchCard.addView(chkRequireBackend)
        root.addView(switchCard)
        root.addView(spacer(20))

        // ── Section: Terminal Registration + Verify ─────────────────────────
        val tvCredStatus = statusLabel("")
        val savedMerchant = prefs.getString("merchant_id", "")?.trim().orEmpty()
        val savedTerminal = prefs.getString("terminal_id", "")?.trim().orEmpty()
        val savedSecret = prefs.getString("secret_key", "")?.trim().orEmpty()
        if (savedMerchant.isNotBlank() && savedTerminal.isNotBlank() && savedSecret.isNotBlank()) {
            tvCredStatus.text = "✅ Credentials saved — tap Verify to check"
            tvCredStatus.setTextColor(Color.parseColor("#16A34A"))
        }

        val btnRegister = Button(this).apply {
            text = "📝 Register New Terminal"
            textSize = 15f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0F766E"))
            setPadding(0, dp(14), 0, dp(14))
            gravity = Gravity.CENTER
            setOnClickListener {
                registerTerminal(
                    etMerchant, etTerminal, etSecret, tvCredStatus, this
                )
            }
        }
        root.addView(btnRegister)
        root.addView(spacer(8))

        val btnVerify = Button(this).apply {
            text = "✅ Verify Terminal Credentials"
            textSize = 14f
            setTextColor(Color.parseColor("#1E3A5F"))
            setBackgroundColor(Color.parseColor("#DBEAFE"))
            setPadding(0, dp(12), 0, dp(12))
            gravity = Gravity.CENTER
            setOnClickListener {
                verifyCredentials(
                    etMerchant.text.toString().trim(),
                    etTerminal.text.toString().trim(),
                    etSecret.text.toString().trim(),
                    tvCredStatus, this
                )
            }
        }
        root.addView(btnVerify)
        root.addView(spacer(8))
        root.addView(tvCredStatus)
        root.addView(spacer(24))

        // ── Save Settings ────────────────────────────────────────────────────
        val btnSave = Button(this).apply {
            text = "💾  Save All Settings"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1D4ED8"))
            setPadding(0, dp(16), 0, dp(16))
            gravity = Gravity.CENTER
            setOnClickListener {
                val merchant = etMerchant.text.toString().trim()
                val terminal = etTerminal.text.toString().trim()
                val secret   = etSecret.text.toString().trim()
                val provEndpoint = etProviderEndpoint.text.toString().trim()
                val provApiKey   = etProviderApiKey.text.toString().trim()
                val provSecret   = etProviderSecret.text.toString().trim()

                if (merchant.isEmpty() || terminal.isEmpty() || secret.isEmpty()) {
                    Toast.makeText(
                        this@SettingsActivity,
                        "Register Terminal first or fill Merchant/Terminal/Secret.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@setOnClickListener
                }

                prefs.edit()
                    .putString("server_url",   ApiClient.DEFAULT_URL)
                    .putString("merchant_id",  merchant)
                    .putString("terminal_id",  terminal)
                    .putString("secret_key",   secret)
                    .putString("provider_endpoint", provEndpoint)
                    .putString("provider_api_key",   provApiKey)
                    .putString("provider_secret",    provSecret)
                    .putBoolean("require_backend_connection", chkRequireBackend.isChecked)
                    .apply()

                Toast.makeText(this@SettingsActivity, "✅ Settings saved", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
        root.addView(btnSave)

        scroll.addView(root)
        setContentView(scroll)
    }

    // ── Registration logic ─────────────────────────────────────────────────

    private fun registerTerminal(
        etMerchant: EditText,
        etTerminal: EditText,
        etSecret:   EditText,
        tvStatus:   TextView,
        btnRegister: Button
    ) {
        btnRegister.isEnabled = false
        btnRegister.text = "Registering..."
        tvStatus.text = "⏳ Contacting server..."
        tvStatus.setTextColor(Color.parseColor("#D97706"))

        lifecycleScope.launch {
            try {
                val api        = ApiClient.createTerminalsApi(ApiClient.DEFAULT_URL)
                val deviceName = android.os.Build.MODEL ?: "Android POS"
                val response   = withContext(Dispatchers.IO) {
                    api.registerTerminal(
                        TerminalRegisterRequest(
                            terminalName = deviceName,
                            deviceSerial = DeviceUtils.getDeviceSerialNumber(this@SettingsActivity)
                        )
                    )
                }

                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    etMerchant.setText(body.merchantId)
                    etTerminal.setText(body.terminalId)
                    etSecret.setText(body.terminalSecret)
                    tvStatus.text = "✅ Registered! Merchant: ${body.merchantId}  Terminal: ${body.terminalId}"
                    tvStatus.setTextColor(Color.parseColor("#16A34A"))
                    Toast.makeText(this@SettingsActivity, "✅ Terminal registered!", Toast.LENGTH_LONG).show()
                } else {
                    tvStatus.text = "❌ Registration failed (HTTP ${response.code()}): ${response.errorBody()?.string()?.take(80)}"
                    tvStatus.setTextColor(Color.parseColor("#DC2626"))
                }
            } catch (e: Exception) {
                tvStatus.text = when (e) {
                    is java.net.SocketTimeoutException -> "❌ Timeout — is the server running?"
                    is java.net.ConnectException      -> "❌ Cannot connect — check Wi-Fi"
                    else -> "❌ ${e.localizedMessage?.take(80) ?: e.message?.take(80)}"
                }
                tvStatus.setTextColor(Color.parseColor("#DC2626"))
            } finally {
                btnRegister.isEnabled = true
                if (btnRegister.text?.startsWith("Reg") == true) btnRegister.text = "📝 Register New Terminal"
            }
        }
    }

    // ── Verify terminal credentials ────────────────────────────────────────

    private fun verifyCredentials(
        merchantId: String,
        terminalId: String,
        secretKey:  String,
        tvStatus:   TextView,
        btnVerify:  Button
    ) {
        if (merchantId.isEmpty() || terminalId.isEmpty() || secretKey.isEmpty()) {
            Toast.makeText(this, "Fill all credential fields first", Toast.LENGTH_SHORT).show()
            return
        }
        btnVerify.isEnabled = false
        btnVerify.text = "Verifying..."
        tvStatus.text = "⏳ Verifying terminal credentials..."
        tvStatus.setTextColor(Color.parseColor("#D97706"))

        lifecycleScope.launch {
            try {
                val api      = ApiClient.createTerminalsApi(ApiClient.DEFAULT_URL)
                val response = withContext(Dispatchers.IO) {
                    api.verifyTerminal(TerminalVerifyRequest(merchantId, terminalId, secretKey))
                }
                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    if (body.valid) {
                        tvStatus.text = "✅ Verified! Terminal: ${body.name ?: terminalId}. Ready to capture funds trustfully."
                        tvStatus.setTextColor(Color.parseColor("#16A34A"))
                        Toast.makeText(this@SettingsActivity, "✅ Credentials verified — ready to process payments", Toast.LENGTH_SHORT).show()
                    } else {
                        tvStatus.text = "❌ Invalid: ${body.message ?: "Verification failed"}"
                        tvStatus.setTextColor(Color.parseColor("#DC2626"))
                    }
                } else {
                    tvStatus.text = "❌ Verify failed (HTTP ${response.code()})"
                    tvStatus.setTextColor(Color.parseColor("#DC2626"))
                }
            } catch (e: Exception) {
                tvStatus.text = when (e) {
                    is java.net.SocketTimeoutException -> "❌ Timeout"
                    is java.net.ConnectException      -> "❌ Cannot connect"
                    else -> "❌ ${e.localizedMessage?.take(60) ?: e.message?.take(60)}"
                }
                tvStatus.setTextColor(Color.parseColor("#DC2626"))
            } finally {
                btnVerify.isEnabled = true
                if (btnVerify.text?.startsWith("Ver") == true) btnVerify.text = "✅ Verify Terminal Credentials"
            }
        }
    }

    // ── Test provider credentials ──────────────────────────────────────────

    private fun testProviderCredentials(
        endpoint: String,
        apiKey:   String,
        secret:   String,
        tvStatus: TextView,
        btn:      Button
    ) {
        btn.isEnabled = false
        val prevText = btn.text
        btn.text = "Testing..."
        tvStatus.text = "⏳ Testing provider credentials..."
        tvStatus.setTextColor(Color.parseColor("#D97706"))

        lifecycleScope.launch {
            try {
                // First: check backend health to confirm we have connectivity
                val healthApi = ApiClient.createPayment2013Api(ApiClient.DEFAULT_URL)
                val health = withContext(Dispatchers.IO) { runCatching { healthApi.health() }.getOrNull() }
                val backendUp = health?.isSuccessful == true

                val walletsApi = ApiClient.createWalletsApi(ApiClient.DEFAULT_URL, PosApplication.getJwtToken(this@SettingsActivity))
                val response = withContext(Dispatchers.IO) {
                    runCatching {
                        walletsApi.testProviderCredentials(
                            ProviderCredentialsTestRequest(
                                endpoint = endpoint,
                                apiKey = apiKey,
                                secretKey = secret,
                                merchantId = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                                    .getString("merchant_id", "") ?: ""
                            )
                        )
                    }.getOrNull()
                }

                val body = response?.body()
                if (response != null && response.isSuccessful && body != null && body.success) {
                    // Save credentials on successful test
                    getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
                        .putString("provider_endpoint", endpoint)
                        .putString("provider_api_key",   apiKey)
                        .putString("provider_secret",    secret)
                        .putBoolean("provider_verified", true)
                        .apply()

                    tvStatus.text = buildString {
                        append("✅ Connection verified! ")
                        append("Backend: ${if (backendUp) "UP" else "DOWN"}. ")
                        append("Provider balance: ${body.currency ?: ""} ${String.format("%.2f", body.availableBalance ?: 0.0)}")
                    }
                    tvStatus.setTextColor(Color.parseColor("#16A34A"))
                    Toast.makeText(
                        this@SettingsActivity,
                        "✅ Provider credentials verified — can send funds to merchant wallet",
                        Toast.LENGTH_LONG
                    ).show()
                } else {
                    val errMsg = body?.message ?: body?.error ?: response?.errorBody()?.string()?.take(60)
                    ?: "Connection failed — double-check endpoint, API key, and secret."
                    tvStatus.text = "❌ $errMsg"
                    tvStatus.setTextColor(Color.parseColor("#DC2626"))
                }
            } catch (e: Exception) {
                tvStatus.text = "❌ Test error: ${e.localizedMessage?.take(80) ?: e.message?.take(80)}"
                tvStatus.setTextColor(Color.parseColor("#DC2626"))
            } finally {
                btn.isEnabled = true
                btn.text = prevText
            }
        }
    }

    private fun formatServerUrl(input: String): String {
        var url = input.trim()
        if (url.isEmpty()) return ""
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
        if (!url.endsWith("/")) url = "$url/"
        return url
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressedDispatcher.onBackPressed()
        return true
    }

    // ── UI helpers ──────────────────────────────────────────────────────────

    private fun sectionLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 13f
        setTextColor(Color.parseColor("#374151"))
        typeface  = Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(6))
    }

    private fun fieldLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 11f
        setTextColor(Color.parseColor("#6B7280"))
        typeface  = Typeface.DEFAULT_BOLD
        letterSpacing = 0.08f
        setPadding(0, 0, 0, dp(4))
    }

    private fun hintLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 11f
        setTextColor(Color.parseColor("#9CA3AF"))
        setPadding(0, 0, 0, dp(8))
    }

    private fun statusLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize  = 12f
        setTextColor(Color.parseColor("#374151"))
        setPadding(dp(8), dp(6), dp(8), dp(6))
        typeface = Typeface.DEFAULT_BOLD
    }

    private fun readOnlyField(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(Color.parseColor("#1F2937"))
        setBackgroundColor(Color.parseColor("#E5E7EB"))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        typeface = Typeface.MONOSPACE
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    private fun editField(hint: String, value: String, password: Boolean = false) =
        EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 15f
            setTextColor(Color.parseColor("#111827"))
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            if (password) {
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            filters = arrayOf(InputFilter.LengthFilter(120))
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
