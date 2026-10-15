package com.pos2013.offline.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.TerminalVerifyRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * PAGE 1 — DEVICE REGISTRATION
 * First screen shown when the app opens (if not already registered).
 * Fields: Backend URL, Merchant ID, Terminal ID, Secret Key.
 * On REGISTER DEVICE → POST /merchant/v1/terminal/verify → Page 2.
 */
class DeviceRegistrationActivity : AppCompatActivity() {

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")

        // If already registered, skip straight to live payment terminal
        if (PosApplication.isTerminalVerified(this)) {
            startActivity(Intent(this, LivePaymentActivity::class.java))
            finish()
            return
        }

        setContentView(buildUI())
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(com.pos2013.offline.utils.LanguageManager.applyTo(newBase))
    }

    private fun buildUI(): View {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0A1628"))
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(40), dp(24), dp(32))
        }

        // ── Logo / Brand ──────────────────────────────────────────────────────
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(36))
        }
        brand.addView(TextView(this).apply {
            text = "PRIMESTACK"
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37"))
            gravity = Gravity.CENTER
            letterSpacing = 0.15f
        })
        brand.addView(TextView(this).apply {
            text = "POS TERMINAL"
            textSize = 13f
            setTextColor(Color.parseColor("#8892A4"))
            gravity = Gravity.CENTER
            letterSpacing = 0.25f
            setPadding(0, dp(4), 0, 0)
        })
        brand.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#D4AF37"))
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(2)).apply { topMargin = dp(12) }
        })
        root.addView(brand)

        // ── Card ──────────────────────────────────────────────────────────────
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(24), dp(28), dp(24), dp(28))
            elevation = dp(6).toFloat()
        }

        card.addView(TextView(this).apply {
            text = "DEVICE REGISTRATION"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37"))
            letterSpacing = 0.18f
            setPadding(0, 0, 0, dp(20))
        })

        val etBackend = inputField("Backend URL", "https://merchant-pos-0nno.onrender.com/")
            .also {
                it.setText(PosApplication.getServerUrl(this))
                it.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            }
        val etMerchant = inputField("Merchant ID", "MRC-1001")
            .also {
                it.setText(PosApplication.getMerchantId(this))
                it.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            }
        val etTerminal = inputField("Terminal ID", "T2013-001")
            .also {
                it.setText(PosApplication.getTerminalId(this))
                it.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            }
        val etSecret = inputField("Secret Key", "••••••••••••")
            .also {
                it.setText(PosApplication.getSecretKey(this))
                it.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }

        card.addView(fieldLabel("BACKEND URL")); card.addView(etBackend); card.addView(spacer(14))
        card.addView(fieldLabel("MERCHANT ID")); card.addView(etMerchant); card.addView(spacer(14))
        card.addView(fieldLabel("TERMINAL ID")); card.addView(etTerminal); card.addView(spacer(14))
        card.addView(fieldLabel("SECRET KEY"));  card.addView(etSecret);   card.addView(spacer(20))

        val tvStatus = TextView(this).apply {
            text = ""; textSize = 12f; setPadding(0, 0, 0, dp(16))
        }
        card.addView(tvStatus)

        val btnRegister = primaryButton("REGISTER DEVICE")
        card.addView(btnRegister)

        root.addView(card)

        // ── Already have credentials? ─────────────────────────────────────────
        val btnSkip = TextView(this).apply {
            text = "Already registered? Skip →"
            textSize = 12f
            setTextColor(Color.parseColor("#5B7FA6"))
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
            isClickable = true
            isFocusable = true
            setOnClickListener { goToCustomerCreation() }
        }
        root.addView(btnSkip)

        scroll.addView(root)

        btnRegister.setOnClickListener {
            val backend = etBackend.text.toString().trim()
                .let { if (!it.endsWith("/")) "$it/" else it }
                .ifBlank { ApiClient.DEFAULT_URL }
            val mid  = etMerchant.text.toString().trim().uppercase()
            val tid  = etTerminal.text.toString().trim().uppercase()
            val sk   = etSecret.text.toString().trim()

            if (mid.isBlank() || tid.isBlank() || sk.isBlank()) {
                tvStatus.text = "❌ All fields are required"
                tvStatus.setTextColor(Color.parseColor("#F87171"))
                return@setOnClickListener
            }

            tvStatus.text = "⏳ Registering device…"
            tvStatus.setTextColor(Color.parseColor("#FCD34D"))
            btnRegister.isEnabled = false

            lifecycleScope.launch {
                var ok = false; var msg = ""
                try {
                    val api = ApiClient.createTerminalsApi(backend)
                    val resp = withContext(Dispatchers.IO) {
                        api.verifyTerminal(TerminalVerifyRequest(mid, tid, sk))
                    }
                    val body = resp.body()
                    if (resp.isSuccessful && body?.valid == true) {
                        PosApplication.saveTerminalCredentials(this@DeviceRegistrationActivity, backend, mid, tid, sk, true)
                        ok = true; msg = body.message ?: "Device registered successfully"
                    } else {
                        msg = body?.error ?: body?.message ?: "HTTP ${resp.code()} — registration failed"
                    }
                } catch (e: Exception) {
                    msg = "Network error: ${e.localizedMessage}"
                }
                btnRegister.isEnabled = true
                if (ok) {
                    tvStatus.text = "✅ $msg"
                    tvStatus.setTextColor(Color.parseColor("#4ADE80"))
                    android.os.Handler(mainLooper).postDelayed({ goToCustomerCreation() }, 600)
                } else {
                    tvStatus.text = "❌ $msg"
                    tvStatus.setTextColor(Color.parseColor("#F87171"))
                }
            }
        }

        return scroll
    }

    private fun goToCustomerCreation() {
        startActivity(Intent(this, LivePaymentActivity::class.java))
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    private fun fieldLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize = 9f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#5B7FA6"))
        letterSpacing = 0.18f
        setPadding(0, 0, 0, dp(5))
    }

    private fun inputField(hint: String, placeholder: String) = EditText(this).apply {
        this.hint = placeholder
        setHintTextColor(Color.parseColor("#3D4F6A"))
        textSize = 14f
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#0D1929"))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun primaryButton(text: String) = Button(this).apply {
        this.text = text
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#0A1628"))
        setBackgroundColor(Color.parseColor("#D4AF37"))
        setPadding(0, dp(16), 0, dp(16))
        letterSpacing = 0.12f
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun spacer(dp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(dp))
    }
}
