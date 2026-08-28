package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.PaymentRepository
import com.pos2013.offline.databinding.ActivitySettingsBinding
import com.pos2013.offline.security.AuthManager
import kotlinx.coroutines.launch

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        AuthManager.ensureDefaults(this)

        binding.etMerchantId.setText(GatewayConfig.MERCHANT_ID)
        binding.etTerminalId.setText(GatewayConfig.TERMINAL_ID)
        binding.etServerUrl.setText(GatewayConfig.SERVER_URL)
        binding.etSecretKey.setText(GatewayConfig.GATEWAY_SECRET_KEY)

        binding.btnTestConnection.setOnClickListener {
            testConnection()
        }

        binding.btnSave.setOnClickListener {
            saveConfig()
        }

        binding.btnLogout.setOnClickListener {
            AuthManager.lock(this)
            startActivity(Intent(this, LoginActivity::class.java))
            finishAffinity()
        }

        binding.btnChangePassword.setOnClickListener {
            val newPassword = binding.etNewPassword.text?.toString()?.trim().orEmpty()
            val confirm = binding.etConfirmPassword.text?.toString()?.trim().orEmpty()
            if (newPassword.length < 6) {
                Toast.makeText(this, "Password must be at least 6 digits", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (newPassword != confirm) {
                Toast.makeText(this, "Passwords do not match", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            AuthManager.changePassword(this, newPassword)
            binding.etNewPassword.setText("")
            binding.etConfirmPassword.setText("")
            Toast.makeText(this, "Password updated", Toast.LENGTH_SHORT).show()
        }

        if (intent.getBooleanExtra("open_security", false)) {
            binding.securityGroup.visibility = View.VISIBLE
        }
    }

    private fun saveConfig() {
        val merchantId = binding.etMerchantId.text?.toString()?.trim().orEmpty()
        val terminalId = binding.etTerminalId.text?.toString()?.trim().orEmpty()
        val serverUrl = binding.etServerUrl.text?.toString()?.trim().orEmpty()
        val secretKey = binding.etSecretKey.text?.toString()?.trim().orEmpty()

        if (merchantId.isEmpty() || terminalId.isEmpty() || serverUrl.isEmpty() || secretKey.isEmpty()) {
            Toast.makeText(this, "Fill all connection fields", Toast.LENGTH_SHORT).show()
            return
        }

        val prefs = getSharedPreferences("pos_prefs", MODE_PRIVATE)
        prefs.edit().apply {
            putString("merchant_id", merchantId)
            putString("terminal_id", terminalId)
            putString("server_url", serverUrl)
            putString("secret_key", secretKey)
            apply()
        }
        GatewayConfig.refreshFromPreferences(this)
        Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
    }

    private fun testConnection() {
        val merchantId = binding.etMerchantId.text?.toString()?.trim().orEmpty()
        val terminalId = binding.etTerminalId.text?.toString()?.trim().orEmpty()
        val serverUrl = binding.etServerUrl.text?.toString()?.trim().orEmpty()
        val secretKey = binding.etSecretKey.text?.toString()?.trim().orEmpty()

        if (merchantId.isEmpty() || terminalId.isEmpty() || serverUrl.isEmpty() || secretKey.isEmpty()) {
            Toast.makeText(this, "Fill all connection fields first", Toast.LENGTH_SHORT).show()
            return
        }

        binding.progressBar.visibility = View.VISIBLE
        binding.btnTestConnection.isEnabled = false

        lifecycleScope.launch {
            try {
                val prefs = getSharedPreferences("pos_prefs", MODE_PRIVATE)
                prefs.edit().apply {
                    putString("merchant_id", merchantId)
                    putString("terminal_id", terminalId)
                    putString("server_url", serverUrl)
                    putString("secret_key", secretKey)
                    apply()
                }
                GatewayConfig.refreshFromPreferences(this@SettingsActivity)

                val reachable = testServerReachable(serverUrl)
                if (!reachable) {
                    Toast.makeText(this@SettingsActivity, "❌ Cannot reach server", Toast.LENGTH_LONG).show()
                    return@launch
                }

                val repository = PaymentRepository(this@SettingsActivity)
                val valid = repository.verifyCredentials(merchantId, terminalId, secretKey)
                if (valid) {
                    Toast.makeText(this@SettingsActivity, "✅ Connected and verified", Toast.LENGTH_LONG).show()
                } else {
                    Toast.makeText(this@SettingsActivity, "⚠️ Server reachable but credentials invalid", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@SettingsActivity, "❌ Error: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                binding.progressBar.visibility = View.GONE
                binding.btnTestConnection.isEnabled = true
            }
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
}
