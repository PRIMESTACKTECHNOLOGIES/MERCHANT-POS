package com.pos2013.offline.ui

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
import com.pos2013.offline.data.api.CreateCustomerRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * PAGE 2 — CUSTOMER CREATION
 * Shown after successful device registration.
 * Fields: Name, Email, Phone, Passport No, Country, State, District.
 * On REGISTER CUSTOMER → POST /wallet/customers → Page 3.
 */
class CustomerCreationActivity : AppCompatActivity() {

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")
        setContentView(buildUI())
    }

    private fun buildUI(): View {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0A1628"))
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(0), dp(24), dp(32))
        }

        // ── Top bar ───────────────────────────────────────────────────────────
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0A1628"))
            setPadding(0, dp(14), 0, dp(14))
            gravity = Gravity.CENTER_VERTICAL
        }
        val btnBack = TextView(this).apply {
            text = "←"
            textSize = 22f
            setTextColor(Color.parseColor("#D4AF37"))
            setPadding(0, 0, dp(16), 0)
            isClickable = true; isFocusable = true
            setOnClickListener { finish() }
        }
        val tvTitle = TextView(this).apply {
            text = "NEW CUSTOMER"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            letterSpacing = 0.18f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        topBar.addView(btnBack); topBar.addView(tvTitle)
        root.addView(topBar)

        // ── Subtitle ──────────────────────────────────────────────────────────
        root.addView(TextView(this).apply {
            text = "Register a new customer to the POS wallet system"
            textSize = 11f
            setTextColor(Color.parseColor("#5B7FA6"))
            setPadding(0, 0, 0, dp(20))
        })

        // ── Card ──────────────────────────────────────────────────────────────
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(24), dp(20), dp(24))
            elevation = dp(4).toFloat()
        }

        val etName     = input("Full Name *", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        val etEmail    = input("Email Address", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val etPhone    = input("Phone Number", InputType.TYPE_CLASS_PHONE)
        val etPassport = input("Passport / ID Number", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        val etCountry  = input("Country", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        val etState    = input("State / Province", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        val etDistrict = input("District / City", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)

        card.addView(sectionLabel("PERSONAL DETAILS"))
        card.addView(fieldLabel("FULL NAME *")); card.addView(etName); card.addView(sp(12))
        card.addView(fieldLabel("EMAIL"));       card.addView(etEmail); card.addView(sp(12))
        card.addView(fieldLabel("PHONE"));       card.addView(etPhone); card.addView(sp(20))

        card.addView(sectionLabel("IDENTIFICATION"))
        card.addView(fieldLabel("PASSPORT / ID NO.")); card.addView(etPassport); card.addView(sp(20))

        card.addView(sectionLabel("LOCATION"))
        card.addView(fieldLabel("COUNTRY"));  card.addView(etCountry);  card.addView(sp(12))
        card.addView(fieldLabel("STATE"));    card.addView(etState);    card.addView(sp(12))
        card.addView(fieldLabel("DISTRICT")); card.addView(etDistrict); card.addView(sp(20))

        val tvStatus = TextView(this).apply {
            text = ""; textSize = 12f; setPadding(0, 0, 0, dp(16))
        }
        card.addView(tvStatus)

        val btnCreate = goldButton("REGISTER CUSTOMER")
        val btnSkip   = ghostButton("SKIP — GO TO PAYMENT TERMINAL →")
        card.addView(btnCreate)
        card.addView(sp(10))
        card.addView(btnSkip)

        root.addView(card)
        scroll.addView(root)

        btnCreate.setOnClickListener {
            val name = etName.text.toString().trim()
            if (name.isBlank()) {
                tvStatus.text = "❌ Full name is required"
                tvStatus.setTextColor(Color.parseColor("#F87171"))
                return@setOnClickListener
            }

            tvStatus.text = "⏳ Registering customer…"
            tvStatus.setTextColor(Color.parseColor("#FCD34D"))
            btnCreate.isEnabled = false

            val merchantId = PosApplication.getMerchantId(this)
            val serverUrl  = PosApplication.getServerUrl(this)
            val jwtToken   = PosApplication.getJwtToken(this)

            lifecycleScope.launch {
                // If no JWT, attempt silent login first
                val token = if (jwtToken.isNullOrBlank()) {
                    tryLogin(serverUrl) ?: ""
                } else jwtToken

                var ok = false; var msg = ""; var walletCode = ""
                try {
                    val api = ApiClient.createWalletsApi(serverUrl, token.ifBlank { null })
                    val resp = withContext(Dispatchers.IO) {
                        api.createCustomer(
                            CreateCustomerRequest(
                                name = name,
                                email = etEmail.text.toString().trim().ifBlank { null },
                                phone = etPhone.text.toString().trim().ifBlank { null },
                                merchantId = merchantId.ifBlank { null }
                            )
                        )
                    }
                    val body = resp.body()
                    if (resp.isSuccessful && body != null) {
                        ok = true
                        walletCode = body.wallet_code ?: ""
                        msg = "Customer registered! Wallet: $walletCode"
                    } else {
                        val errStr = resp.errorBody()?.string() ?: "HTTP ${resp.code()}"
                        msg = "Registration failed: $errStr"
                    }
                } catch (e: Exception) {
                    msg = "Error: ${e.localizedMessage}"
                }

                btnCreate.isEnabled = true
                if (ok) {
                    tvStatus.text = "✅ $msg"
                    tvStatus.setTextColor(Color.parseColor("#4ADE80"))
                    android.os.Handler(mainLooper).postDelayed({ goToDashboard() }, 900)
                } else {
                    tvStatus.text = "❌ $msg"
                    tvStatus.setTextColor(Color.parseColor("#F87171"))
                }
            }
        }

        btnSkip.setOnClickListener { goToDashboard() }

        return scroll
    }

    private suspend fun tryLogin(serverUrl: String): String? {
        return try {
            val prefs = getSharedPreferences("pos_settings", MODE_PRIVATE)
            val user = prefs.getString("admin_username", "admin") ?: "admin"
            val pass = prefs.getString("admin_password", "admin123") ?: "admin123"
            val api  = ApiClient.createAuthApi(serverUrl)
            val resp = withContext(Dispatchers.IO) {
                api.login(com.pos2013.offline.data.api.LoginRequest(user, pass))
            }
            if (resp.isSuccessful) {
                val token = resp.body()?.token ?: return null
                PosApplication.saveJwtToken(this, token)
                token
            } else null
        } catch (_: Exception) { null }
    }

    private fun goToDashboard() {
        val i = Intent(this, POSDashboardActivity::class.java)
        i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(i)
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    private fun sectionLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize = 9f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#D4AF37"))
        letterSpacing = 0.22f
        setPadding(0, dp(4), 0, dp(10))
    }
    private fun fieldLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize = 9f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#5B7FA6"))
        letterSpacing = 0.15f
        setPadding(0, 0, 0, dp(4))
    }
    private fun input(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        setHintTextColor(Color.parseColor("#3D4F6A"))
        textSize = 14f
        setTextColor(Color.WHITE)
        inputType = type
        setBackgroundColor(Color.parseColor("#0D1929"))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    private fun goldButton(text: String) = Button(this).apply {
        this.text = text; textSize = 13f; typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#0A1628"))
        setBackgroundColor(Color.parseColor("#D4AF37"))
        setPadding(0, dp(16), 0, dp(16)); letterSpacing = 0.1f
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    private fun ghostButton(text: String) = Button(this).apply {
        this.text = text; textSize = 11f
        setTextColor(Color.parseColor("#5B7FA6"))
        setBackgroundColor(Color.TRANSPARENT)
        setPadding(0, dp(10), 0, dp(10))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    private fun sp(dp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(dp))
    }
}
