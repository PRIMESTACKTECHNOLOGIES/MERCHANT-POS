package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.databinding.ActivitySetupBinding
import com.pos2013.offline.domain.usecase.VerifyTerminalUseCase
import com.pos2013.offline.presentation.viewmodel.TerminalVerificationState
import com.pos2013.offline.presentation.viewmodel.TerminalViewModel
import com.pos2013.offline.presentation.viewmodel.TerminalViewModelFactory
import kotlinx.coroutines.launch

/**
 * Terminal Verification Activity.
 *
 * This is the **mandatory first step** for any 201.3-compliant POS terminal.
 * The terminal must be verified before it can:
 * - Process payments
 * - Store offline transactions
 * - Sync batches to the server
 * - Generate HMAC signatures
 *
 * Flow:
 * 1. User enters merchantId, terminalId, secretKey, serverUrl
 * 2. User taps "Verify Terminal"
 * 3. App sends /merchant/v1/terminal/verify request
 * 4. If valid → credentials saved → navigate to LoginActivity
 * 5. If invalid → show error → stay on screen
 */
class SetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySetupBinding

    private val viewModel: TerminalViewModel by viewModels {
        TerminalViewModelFactory(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Check if already registered
        if (GatewayConfig.isDeviceRegistered(this)) {
            navigateToLogin()
            return
        }

        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupUI()
        loadDeviceInfo()
        observeViewModel()
    }

    private fun setupUI() {
        // Pre-fill with defaults for easier testing
        binding.etServerUrl.setText(GatewayConfig.SERVER_URL)

        // Verify button
        binding.btnRegister.setOnClickListener {
            verifyTerminal()
        }

        // Test connection button
        binding.btnTestConnection.setOnClickListener {
            testConnection()
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is TerminalVerificationState.Idle -> {
                            showLoading(false)
                        }
                        is TerminalVerificationState.Loading -> {
                            showLoading(true)
                        }
                        is TerminalVerificationState.Success -> {
                            showLoading(false)
                            showSuccess("✅ ${state.message}")
                            navigateToLogin()
                        }
                        is TerminalVerificationState.Error -> {
                            showLoading(false)
                            val errorIcon = when (state.code) {
                                VerifyTerminalUseCase.ErrorCode.NETWORK_ERROR -> "📡"
                                VerifyTerminalUseCase.ErrorCode.INVALID_CREDENTIALS -> "🔐"
                                VerifyTerminalUseCase.ErrorCode.SERVER_ERROR -> "🔧"
                                else -> "❌"
                            }
                            showError("$errorIcon ${state.message}")
                            viewModel.resetState()
                        }
                    }
                }
            }
        }
    }

    private fun verifyTerminal() {
        val merchantId = binding.etMerchantId.text.toString()
        val terminalId = binding.etTerminalId.text.toString()
        val secretKey = binding.etSecretKey.text.toString()
        val serverUrl = binding.etServerUrl.text.toString()

        viewModel.verifyTerminal(
            merchantId = merchantId,
            terminalId = terminalId,
            secretKey = secretKey,
            serverUrl = serverUrl.takeIf { it.isNotBlank() }
        )
    }

    private fun testConnection() {
        val serverUrl = binding.etServerUrl.text.toString().trim()

        if (serverUrl.isEmpty()) {
            binding.etServerUrl.error = "Enter server URL"
            return
        }

        showLoading(true)

        lifecycleScope.launch {
            try {
                // Temporarily set URL for testing
                val prefs = getSharedPreferences("pos_prefs", MODE_PRIVATE)
                prefs.edit().putString("server_url", serverUrl).apply()
                GatewayConfig.refreshFromPreferences(this@SetupActivity)

                val isReachable = testServerReachable(serverUrl)

                if (isReachable) {
                    showSuccess("✅ Server reachable!")
                } else {
                    showError("❌ Cannot reach server")
                }
            } catch (e: Exception) {
                showError("❌ Error: ${e.message}")
            }

            showLoading(false)
        }
    }

    private fun testServerReachable(serverUrl: String): Boolean {
        return try {
            val base = if (serverUrl.endsWith("/")) serverUrl else "$serverUrl/"
            val url = java.net.URL(base + "api/health")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                requestMethod = "GET"
            }
            conn.connect()
            val ok = conn.responseCode in 200..299
            conn.disconnect()
            ok
        } catch (e: Exception) {
            false
        }
    }

    private fun loadDeviceInfo() {
        val deviceInfo = buildString {
            appendLine("📱 Device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
            appendLine("🤖 Android: ${android.os.Build.VERSION.RELEASE}")
            appendLine("🔢 Serial: ${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID).takeLast(8)}")
        }
        binding.tvDeviceInfo.text = deviceInfo
    }

    private fun showLoading(show: Boolean) {
        binding.progressBar.visibility = if (show) View.VISIBLE else View.GONE
        binding.btnRegister.isEnabled = !show
        binding.btnTestConnection.isEnabled = !show
    }

    private fun showError(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun showSuccess(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun navigateToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
