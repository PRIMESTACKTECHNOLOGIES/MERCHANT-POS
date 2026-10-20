package com.pos2013.offline.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.SendToMerchantRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * PAGE 5 — CUSTOMER WALLET
 * Shows customer name, balance, transaction history.
 * SEND TO MERCHANT button — prompts for merchant credentials modal.
 * After send or decline → back to Page 3 (POSDashboardActivity).
 */
class CustomerWalletActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_CUSTOMER_ID = "customer_id"
        const val EXTRA_TXN_ID      = "txn_id"
        const val EXTRA_AUTH_CODE   = "auth_code"
        const val EXTRA_AMOUNT      = "amount"
        const val EXTRA_CURRENCY    = "currency"
    }

    private var customerId  = ""
    private var txnId       = ""
    private var authCode    = ""
    private var lastAmount  = 0.0
    private var lastCurrency = "AED"

    private lateinit var tvName:    TextView
    private lateinit var tvBalance: TextView
    private lateinit var tvStatus:  TextView
    private lateinit var llHistory: LinearLayout

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")

        customerId   = intent.getStringExtra(EXTRA_CUSTOMER_ID) ?: ""
        txnId        = intent.getStringExtra(EXTRA_TXN_ID) ?: ""
        authCode     = intent.getStringExtra(EXTRA_AUTH_CODE) ?: ""
        lastAmount   = intent.getDoubleExtra(EXTRA_AMOUNT, 0.0)
        lastCurrency = intent.getStringExtra(EXTRA_CURRENCY) ?: "AED"

        setContentView(buildUI())

        if (customerId.isBlank()) {
            tvName.text = "No customer selected"
            tvBalance.text = "—"
        }
    }

    // Reload on every visit — the wallet is credited by the charge that just happened, so
    // the balance must not be a stale snapshot from the first time this screen opened.
    override fun onResume() {
        super.onResume()
        if (customerId.isNotBlank()) loadWallet()
    }

    private fun buildUI(): View {
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0A1628"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT)
        }

        // ── Header ────────────────────────────────────────────────────────────
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(16), dp(14), dp(16), dp(14))
            gravity = Gravity.CENTER_VERTICAL
        }
        val btnBack = TextView(this).apply {
            text = "←"; textSize = 22f; setTextColor(Color.parseColor("#D4AF37"))
            setPadding(0, 0, dp(16), 0); isClickable = true; isFocusable = true
            setOnClickListener { backToDashboard() }
        }
        val tvTitle = TextView(this).apply {
            text = "CUSTOMER WALLET"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); letterSpacing = 0.15f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        header.addView(btnBack); header.addView(tvTitle)
        frame.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        // ── Last transaction badge ─────────────────────────────────────────────
        if (txnId.isNotBlank() || authCode.isNotBlank()) {
            val badge = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#0F2E1A"))
                setPadding(dp(16), dp(14), dp(16), dp(14))
                elevation = dp(3).toFloat()
            }
            badge.addView(TextView(this).apply {
                text = "✅  TRANSACTION APPROVED"
                textSize = 12f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#4ADE80"))
            })
            if (lastAmount > 0) badge.addView(TextView(this).apply {
                text = "$lastCurrency ${"%.2f".format(lastAmount)}"
                textSize = 22f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE); setPadding(0, dp(4), 0, 0)
            })
            if (authCode.isNotBlank()) badge.addView(TextView(this).apply {
                text = "Auth Code: $authCode"
                textSize = 11f; setTextColor(Color.parseColor("#4ADE80"))
            })
            if (txnId.isNotBlank()) badge.addView(TextView(this).apply {
                text = "Ref: ${txnId.take(24)}"
                textSize = 10f; setTextColor(Color.parseColor("#5B7FA6"))
                typeface = Typeface.MONOSPACE
            })
            body.addView(badge); body.addView(sp(20))
        }

        // ── Wallet card ───────────────────────────────────────────────────────
        val walletCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(24), dp(20), dp(24))
            gravity = Gravity.CENTER; elevation = dp(4).toFloat()
        }
        tvStatus = TextView(this).apply {
            text = "Loading…"; textSize = 11f
            setTextColor(Color.parseColor("#5B7FA6")); gravity = Gravity.CENTER
        }
        tvName = TextView(this).apply {
            text = "—"
            textSize = 18f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
        }
        tvBalance = TextView(this).apply {
            text = "—"
            textSize = 42f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); gravity = Gravity.CENTER
        }
        val tvBalLabel = TextView(this).apply {
            text = "WALLET BALANCE"
            textSize = 9f; setTextColor(Color.parseColor("#5B7FA6"))
            gravity = Gravity.CENTER; letterSpacing = 0.18f; setPadding(0, dp(4), 0, 0)
        }

        val btnRefresh = Button(this).apply {
            text = "↻  REFRESH"
            textSize = 11f; setTextColor(Color.parseColor("#D4AF37"))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.CENTER_HORIZONTAL }
            setOnClickListener { loadWallet() }
        }

        walletCard.addView(tvStatus)
        walletCard.addView(tvName)
        walletCard.addView(tvBalance)
        walletCard.addView(tvBalLabel)
        walletCard.addView(sp(12))
        walletCard.addView(btnRefresh)
        body.addView(walletCard); body.addView(sp(20))

        // ── Send to Merchant button ────────────────────────────────────────────
        val btnSend = Button(this).apply {
            text = "SEND TO MERCHANT"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628"))
            setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(0, dp(18), 0, dp(18)); letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { showSendToMerchantModal() }
        }
        body.addView(btnSend); body.addView(sp(12))

        // ── Back to terminal button ────────────────────────────────────────────
        val btnBack2 = Button(this).apply {
            text = "← BACK TO PAYMENT TERMINAL"
            textSize = 11f
            setTextColor(Color.parseColor("#5B7FA6"))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { backToDashboard() }
        }
        body.addView(btnBack2); body.addView(sp(20))

        // ── Transaction history ────────────────────────────────────────────────
        body.addView(TextView(this).apply {
            text = "TRANSACTION HISTORY"
            textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#5B7FA6")); letterSpacing = 0.18f
            setPadding(0, 0, 0, dp(10))
        })
        llHistory = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        body.addView(llHistory)

        scroll.addView(body)
        frame.addView(scroll)
        return frame
    }

    private fun loadWallet() {
        if (customerId.isBlank()) return
        val serverUrl = PosApplication.getServerUrl(this)
        val jwtToken  = PosApplication.getJwtToken(this)

        tvStatus.text = "Loading…"
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, jwtToken)
                val balResp = withContext(Dispatchers.IO) { api.getBalance(customerId) }
                val txnResp = withContext(Dispatchers.IO) { api.getTransactions(customerId) }

                if (balResp.isSuccessful && balResp.body() != null) {
                    val b = balResp.body()!!
                    tvBalance.text = "${b.currency} ${"%.2f".format(b.balance)}"
                    tvStatus.text = ""
                }

                // Load customer name from transactions or use ID
                if (txnResp.isSuccessful && txnResp.body() != null) {
                    val txns = txnResp.body()!!
                    buildHistory(txns)
                }

                tvName.text = "Customer Wallet"

            } catch (e: Exception) {
                tvStatus.text = "❌ ${e.localizedMessage?.take(60)}"
                tvStatus.setTextColor(Color.parseColor("#F87171"))
            }
        }
    }

    private fun buildHistory(txns: List<com.pos2013.offline.data.api.WalletTransactionResponse>) {
        llHistory.removeAllViews()
        if (txns.isEmpty()) {
            llHistory.addView(TextView(this).apply {
                text = "No transactions yet"; textSize = 12f
                setTextColor(Color.parseColor("#5B7FA6")); gravity = Gravity.CENTER
                setPadding(0, dp(12), 0, 0)
            })
            return
        }
        txns.take(20).forEach { t ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setBackgroundColor(Color.parseColor("#111D30"))
                setPadding(dp(16), dp(12), dp(16), dp(12))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(6) }
            }
            val isCredit = t.type.lowercase() == "credit"
            val left = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            left.addView(TextView(this).apply {
                text = t.source.replace("_"," ").uppercase()
                textSize = 11f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
            })
            left.addView(TextView(this).apply {
                text = t.createdAt.take(16).replace("T", " ")
                textSize = 9f; setTextColor(Color.parseColor("#5B7FA6"))
            })
            val tvAmt = TextView(this).apply {
                text = "${if (isCredit) "+" else "-"} ${"%.2f".format(t.amount)}"
                textSize = 15f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (isCredit) Color.parseColor("#4ADE80") else Color.parseColor("#F87171"))
                gravity = Gravity.END
            }
            row.addView(left); row.addView(tvAmt)
            llHistory.addView(row)
        }
    }

    private fun showSendToMerchantModal() {
        val ctx = this
        val layout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
            setBackgroundColor(Color.parseColor("#111D30"))
        }

        fun label(t: String) = TextView(ctx).apply {
            text = t; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); letterSpacing = 0.15f
            setPadding(0, 0, 0, dp(4))
        }
        fun field(hint: String, pwd: Boolean = false) = EditText(ctx).apply {
            this.hint = hint; setHintTextColor(Color.parseColor("#3D4F6A"))
            textSize = 13f; setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            inputType = if (pwd) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                        else InputType.TYPE_CLASS_TEXT
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }

        val prefs      = getSharedPreferences("pos_settings", MODE_PRIVATE)
        val serverUrl  = PosApplication.getServerUrl(this)
        val merchantId = PosApplication.getMerchantId(this)

        val etApiKey     = field("API Key").also { it.setText(prefs.getString("api_key", "") ?: "") }
        val etEndpoint   = field("Endpoint URL").also { it.setText(serverUrl) }
        val etSecretKey  = field("Secret Key", pwd = true).also { it.setText(prefs.getString("secret_key", "") ?: "") }
        val etMerchantId = field("Merchant ID").also { it.setText(merchantId) }
        val etAmount     = field("Transfer Amount").also {
            it.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            if (lastAmount > 0) it.setText("%.2f".format(lastAmount))
        }

        layout.addView(label("API KEY"));      layout.addView(etApiKey)
        layout.addView(label("ENDPOINT URL")); layout.addView(etEndpoint)
        layout.addView(label("SECRET KEY"));   layout.addView(etSecretKey)
        layout.addView(label("MERCHANT ID"));  layout.addView(etMerchantId)
        layout.addView(label("AMOUNT"));       layout.addView(etAmount)

        val dialog = AlertDialog.Builder(this)
            .setTitle("Send to Merchant Wallet")
            .setView(layout)
            .setPositiveButton("SEND") { _, _ ->
                val amount = etAmount.text.toString().toDoubleOrNull() ?: 0.0
                if (amount <= 0) { toast("Enter a valid amount"); return@setPositiveButton }

                val apiKey    = etApiKey.text.toString().trim()
                val endpoint  = etEndpoint.text.toString().trim()
                val secretKey = etSecretKey.text.toString().trim()
                val mid       = etMerchantId.text.toString().trim()

                // Save credentials for next time
                prefs.edit()
                    .putString("api_key", apiKey)
                    .putString("secret_key", secretKey)
                    .apply()

                val jwtToken = PosApplication.getJwtToken(this)
                lifecycleScope.launch {
                    try {
                        val api = ApiClient.createWalletsApi(endpoint.ifBlank { serverUrl }, jwtToken)
                        val resp = withContext(Dispatchers.IO) {
                            api.sendFundsToMerchantWallet(
                                SendToMerchantRequest(
                                    customerId = customerId,
                                    merchantId = mid,
                                    amount = amount,
                                    currency = lastCurrency,
                                    providerEndpoint = endpoint.ifBlank { null },
                                    providerApiKey   = apiKey.ifBlank { null },
                                    providerSecretKey = secretKey.ifBlank { null }
                                )
                            )
                        }
                        if (resp.isSuccessful && resp.body()?.success == true) {
                            toast("✅ Sent ${"%.2f".format(amount)} $lastCurrency to merchant wallet")
                            loadWallet()
                        } else {
                            toast("❌ Transfer failed: ${resp.body()?.error ?: resp.code()}")
                        }
                    } catch (e: Exception) {
                        toast("Error: ${e.localizedMessage}")
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .create()
        dialog.show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(Color.parseColor("#D4AF37"))
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.setTextColor(Color.parseColor("#5B7FA6"))
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.decorView?.setBackgroundColor(Color.parseColor("#111D30"))
    }

    private fun backToDashboard() {
        val i = Intent(this, POSDashboardActivity::class.java)
        i.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        startActivity(i)
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    private fun sp(dp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(dp))
    }
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
