package com.pos2013.offline.ui

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.CreateCustomerRequest
import com.pos2013.offline.data.api.WalletTopupRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CustomerActivity : AppCompatActivity() {

    private lateinit var listContainer: LinearLayout
    private lateinit var tvStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "Customers & Wallets"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F5F7FA"))
        }

        // ── Header bar ───────────────────────────────────────────────────────
        val headerBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            elevation = 4f
            gravity = Gravity.CENTER_VERTICAL
        }
        tvStatus = TextView(this).apply {
            text = "Loading customers..."
            textSize = 12f
            setTextColor(Color.parseColor("#546E7A"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnAdd = Button(this).apply {
            text = "+ New Customer"
            textSize = 11f
            setBackgroundColor(Color.parseColor("#1565C0"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38))
        }
        val btnRefresh = Button(this).apply {
            text = "↻"
            textSize = 14f
            setBackgroundColor(Color.parseColor("#00897B"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(38)).apply { marginStart = dp(6) }
        }
        headerBar.addView(tvStatus)
        headerBar.addView(btnAdd)
        headerBar.addView(btnRefresh)
        root.addView(headerBar)

        // ── List ─────────────────────────────────────────────────────────────
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }
        listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(80))
        }
        scroll.addView(listContainer)
        root.addView(scroll)

        setContentView(root)

        btnAdd.setOnClickListener { showCreateCustomerDialog() }
        btnRefresh.setOnClickListener { loadCustomers() }
        loadCustomers()
    }

    private fun loadCustomers() {
        val token = PosApplication.getJwtToken(this)
        val serverUrl = PosApplication.getServerUrl(this)
        if (token.isNullOrBlank()) {
            tvStatus.text = "Not logged in"
            listContainer.removeAllViews()
            listContainer.addView(emptyView("Login in Settings to manage customers"))
            return
        }
        tvStatus.text = "Loading..."
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) { api.getCustomers() }
                listContainer.removeAllViews()
                if (resp.isSuccessful) {
                    val customers = resp.body() ?: emptyList()
                    tvStatus.text = "${customers.size} customer(s)"
                    if (customers.isEmpty()) {
                        listContainer.addView(emptyView("No customers yet — tap + New Customer"))
                    } else {
                        customers.forEach { c -> listContainer.addView(buildCustomerCard(c.id, c.name, c.email, c.phone)) }
                    }
                } else {
                    tvStatus.text = "Error HTTP ${resp.code()}"
                    listContainer.addView(emptyView("Could not load customers"))
                }
            } catch (e: Exception) {
                tvStatus.text = "Error: ${e.message}"
                listContainer.addView(emptyView("Connection failed"))
            }
        }
    }

    private fun buildCustomerCard(id: String, name: String, email: String?, phone: String?): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            elevation = 2f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        topRow.addView(TextView(this).apply {
            text = name
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1A237E"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })

        // Avatar initial
        topRow.addView(TextView(this).apply {
            text = name.firstOrNull()?.uppercase() ?: "?"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1565C0"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
        })
        card.addView(topRow)

        if (!email.isNullOrBlank()) card.addView(detailRow("✉", email))
        if (!phone.isNullOrBlank()) card.addView(detailRow("☎", phone))
        card.addView(detailRow("ID", id.take(16) + "..."))

        card.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#E3F2FD"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(8); bottomMargin = dp(8)
            }
        })

        // Action buttons
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        fun actionBtn(label: String, color: String) = Button(this).apply {
            text = label
            textSize = 10f
            setBackgroundColor(Color.parseColor(color))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, dp(34), 1f).apply {
                marginEnd = dp(4)
            }
        }
        val btnBalance = actionBtn("💰 Balance", "#00897B")
        val btnTopup   = actionBtn("⬆ Top Up", "#1565C0")
        val btnHistory = actionBtn("📋 History", "#546E7A")
        btnRow.addView(btnBalance)
        btnRow.addView(btnTopup)
        btnRow.addView(btnHistory)
        card.addView(btnRow)

        btnBalance.setOnClickListener { loadWalletBalance(id, name) }
        btnTopup.setOnClickListener   { showTopupDialog(id, name) }
        btnHistory.setOnClickListener { loadWalletHistory(id, name) }

        return card
    }

    private fun loadWalletBalance(customerId: String, name: String) {
        val token = PosApplication.getJwtToken(this) ?: return
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) { api.getBalance(customerId) }
                if (resp.isSuccessful) {
                    val b = resp.body()
                    AlertDialog.Builder(this@CustomerActivity)
                        .setTitle("$name — Wallet Balance")
                        .setMessage("${b?.currency ?: "USD"} ${String.format("%.2f", b?.balance ?: 0.0)}")
                        .setPositiveButton("OK", null)
                        .show()
                } else {
                    showToast("Balance not available")
                }
            } catch (e: Exception) { showToast("Error: ${e.message}") }
        }
    }

    private fun showTopupDialog(customerId: String, name: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }
        layout.addView(TextView(this).apply {
            text = "Top up wallet for $name"
            textSize = 13f
            setTextColor(Color.parseColor("#37474F"))
            setPadding(0, 0, 0, dp(8))
        })
        val etAmount = EditText(this).apply {
            hint = "Amount (e.g. 100.00)"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
        }
        layout.addView(etAmount)

        AlertDialog.Builder(this)
            .setTitle("Top Up Wallet")
            .setView(layout)
            .setPositiveButton("Top Up") { _, _ ->
                val amount = etAmount.text.toString().toDoubleOrNull() ?: return@setPositiveButton
                executeTopup(customerId, name, amount)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun executeTopup(customerId: String, name: String, amount: Double) {
        val token = PosApplication.getJwtToken(this) ?: return
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) {
                    api.topup(WalletTopupRequest(customerId = customerId, amount = amount, source = "manual_topup"))
                }
                if (resp.isSuccessful && resp.body()?.success == true) {
                    showToast("✓ Wallet topped up: $name +$amount")
                } else {
                    showToast("Top up failed: ${resp.body()?.error ?: "HTTP ${resp.code()}"}")
                }
            } catch (e: Exception) { showToast("Error: ${e.message}") }
        }
    }

    private fun loadWalletHistory(customerId: String, name: String) {
        val token = PosApplication.getJwtToken(this) ?: return
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) { api.getTransactions(customerId) }
                if (resp.isSuccessful) {
                    val txns = resp.body() ?: emptyList()
                    val sb = StringBuilder()
                    if (txns.isEmpty()) {
                        sb.append("No transactions yet.")
                    } else {
                        txns.take(20).forEach { t ->
                            val sign = if (t.type == "credit") "+" else "-"
                            sb.appendLine("$sign${String.format("%.2f", t.amount)} ${t.type.uppercase()}")
                            sb.appendLine("  ${t.source} | ${t.createdAt.take(16)}")
                            sb.appendLine()
                        }
                    }
                    AlertDialog.Builder(this@CustomerActivity)
                        .setTitle("$name — Wallet History")
                        .setMessage(sb.toString())
                        .setPositiveButton("Close", null)
                        .show()
                }
            } catch (e: Exception) { showToast("Error: ${e.message}") }
        }
    }

    private fun showCreateCustomerDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(8))
        }
        val etName  = EditText(this).apply { hint = "Full name *" }
        val etEmail = EditText(this).apply { hint = "Email (optional)"; inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        val etPhone = EditText(this).apply { hint = "Phone (optional)"; inputType = android.text.InputType.TYPE_CLASS_PHONE }
        layout.addView(etName)
        layout.addView(etEmail)
        layout.addView(etPhone)

        AlertDialog.Builder(this)
            .setTitle("New Customer")
            .setView(layout)
            .setPositiveButton("Create") { _, _ ->
                val name = etName.text.toString().trim()
                if (name.isBlank()) { showToast("Name is required"); return@setPositiveButton }
                createCustomer(name, etEmail.text.toString().trim().ifBlank { null }, etPhone.text.toString().trim().ifBlank { null })
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun createCustomer(name: String, email: String?, phone: String?) {
        val token = PosApplication.getJwtToken(this) ?: return
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) {
                    api.createCustomer(CreateCustomerRequest(name = name, email = email, phone = phone))
                }
                if (resp.isSuccessful) {
                    showToast("✓ Customer created: $name")
                    loadCustomers()
                } else {
                    showToast("Failed: HTTP ${resp.code()}")
                }
            } catch (e: Exception) { showToast("Error: ${e.message}") }
        }
    }

    private fun detailRow(label: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(3) }
        addView(TextView(this@CustomerActivity).apply {
            text = label
            textSize = 11f
            setTextColor(Color.parseColor("#90A4AE"))
            layoutParams = LinearLayout.LayoutParams(dp(30), LinearLayout.LayoutParams.WRAP_CONTENT)
        })
        addView(TextView(this@CustomerActivity).apply {
            text = value
            textSize = 12f
            setTextColor(Color.parseColor("#37474F"))
        })
    }

    private fun emptyView(msg: String) = TextView(this).apply {
        text = msg
        textSize = 14f
        setTextColor(Color.parseColor("#90A4AE"))
        gravity = Gravity.CENTER
        setPadding(dp(20), dp(40), dp(20), dp(40))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    private fun showToast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
