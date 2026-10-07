package com.pos2013.offline.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.CardValidationRequest
import com.pos2013.offline.data.api.CreateCustomerRequest
import com.pos2013.offline.data.api.SendToMerchantRequest
import com.pos2013.offline.data.api.WalletTopupRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CustomerActivity : AppCompatActivity() {

    private lateinit var listContainer: LinearLayout
    private lateinit var tvStatus: TextView
    private lateinit var fabAdd: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "My Customers"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B1220"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        // ── Header bar ───────────────────────────────────────────────────────
        val headerBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(dp(16), dp(14), dp(16), dp(10))
            elevation = 4f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val tvTitle = TextView(this).apply {
            text = "👥  My Customers"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val btnRefresh = Button(this).apply {
            text = "↻"
            textSize = 14f
            setBackgroundColor(Color.parseColor("#0EA5E9"))
            setTextColor(Color.WHITE)
            setPadding(dp(10), 0, dp(10), 0)
            layoutParams = LinearLayout.LayoutParams(dp(52), dp(40))
        }

        titleRow.addView(tvTitle)
        titleRow.addView(btnRefresh)
        headerBar.addView(titleRow)

        headerBar.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
            ).apply { topMargin = dp(10) }
            setBackgroundColor(Color.parseColor("#1E293B"))
        })

        tvStatus = TextView(this).apply {
            text = "Loading customers..."
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(8), 0, 0)
        }
        headerBar.addView(tvStatus)
        root.addView(headerBar)

        // ── Scrollable list ─────────────────────────────────────────────────
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            isFillViewport = true
            clipToPadding = false
        }
        listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(100))
        }
        scroll.addView(listContainer)
        root.addView(scroll)

        // ── Floating Add Customer button ───────────────────────────────────
        fabAdd = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        val fabBtn = TextView(this).apply {
            text = "+  New Customer"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#16A34A"))
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(14), dp(20), dp(14))
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                leftMargin = dp(16)
                rightMargin = dp(16)
                bottomMargin = dp(16)
            }
            layoutParams = lp
            elevation = 8f
            isClickable = true
            isFocusable = true
        }
        fabBtn.setOnClickListener { showCreateCustomerDialog() }
        fabAdd.addView(fabBtn)

        val frame = FrameLayout(this)
        frame.addView(root)
        frame.addView(fabAdd)

        setContentView(frame)

        btnRefresh.setOnClickListener { loadCustomers() }
        loadCustomers()
    }

    private fun merchantId(): String =
        (getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            .getString("merchant_id", "") ?: "").trim()

    private fun loadCustomers() {
        val serverUrl = PosApplication.getServerUrl(this)
        val merchant = merchantId()
        listContainer.removeAllViews()
        listContainer.addView(loadingRow("Loading my customers..."))
        tvStatus.setTextColor(Color.parseColor("#F59E0B"))
        tvStatus.text = "Scoped: merchant_id = $merchant"

        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl)
                val resp = if (merchant.isNotBlank()) {
                    withContext(Dispatchers.IO) { api.getCustomersByMerchant(merchant) }
                } else {
                    withContext(Dispatchers.IO) { api.getCustomers() }
                }
                listContainer.removeAllViews()
                if (resp.isSuccessful) {
                    val rawCustomers = resp.body() ?: emptyList()
                    // Strict scoping: if merchant set, only return customers whose merchant_id EXACTLY matches
                    val customers = if (merchant.isNotBlank()) {
                        rawCustomers.filter { c ->
                            val mid = c.merchant_id
                            mid == merchant || mid == null
                        }
                    } else rawCustomers

                    tvStatus.text = "${customers.size} customer(s)  (scope: ${if (merchant.isNotBlank()) merchant else "all"})"
                    tvStatus.setTextColor(Color.parseColor("#22C55E"))
                    if (customers.isEmpty()) {
                        listContainer.addView(emptyView("No customers yet.\nTap \"+ New Customer\" below to register your first customer."))
                    } else {
                        customers.forEach { c ->
                            val id = c.id
                            val name = c.name
                            val email = c.email
                            val phone = c.phone
                            val walletBalance = c.wallet_balance ?: 0.0
                            val walletCurrency = c.wallet_currency ?: "USD"
                            val walletCode = c.wallet_code ?: ""
                            listContainer.addView(buildCustomerCard(id, name, email, phone, walletBalance, walletCurrency, walletCode))
                        }
                    }
                } else {
                    tvStatus.text = "Error HTTP ${resp.code()}"
                    tvStatus.setTextColor(Color.parseColor("#EF4444"))
                    listContainer.addView(emptyView("Could not load customers. Check network."))
                }
            } catch (e: Exception) {
                tvStatus.text = "Error: ${e.message?.take(60)}"
                tvStatus.setTextColor(Color.parseColor("#EF4444"))
                listContainer.addView(emptyView("Connection failed — check internet."))
            }
        }
    }

    private fun buildCustomerCard(
        id: String,
        name: String,
        email: String?,
        phone: String?,
        walletBalance: Double,
        walletCurrency: String,
        walletCode: String
    ): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(dp(14), dp(14), dp(14), dp(14))
            elevation = 3f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }
        card.setBackgroundColor(Color.parseColor("#111827"))

        // ── Top row: name + avatar ──────────────────────────────────────
        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        topRow.addView(TextView(this).apply {
            text = name
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        topRow.addView(TextView(this).apply {
            text = name.firstOrNull()?.uppercase() ?: "?"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#3B82F6"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
        })
        card.addView(topRow)

        card.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
            ).apply { topMargin = dp(10); bottomMargin = dp(10) }
            setBackgroundColor(Color.parseColor("#1E293B"))
        })

        // ── Wallet balance box ──────────────────────────────────────────
        val balanceBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setBackgroundColor(Color.parseColor("#14532D"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        balanceBox.addView(TextView(this).apply {
            text = "WALLET BALANCE (${if (walletCode.isNotBlank()) walletCode else "PSW-XXXX-XXXX"})"
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            letterSpacing = 0.08f
            setTextColor(Color.parseColor("#86EFAC"))
        })
        balanceBox.addView(TextView(this).apply {
            text = "$walletCurrency ${String.format("%.2f", walletBalance)}"
            textSize = 22f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dp(2), 0, 0)
        })
        card.addView(balanceBox)

        // Contact details
        if (!email.isNullOrBlank()) card.addView(detailRow("✉", email))
        if (!phone.isNullOrBlank()) card.addView(detailRow("☎", phone))
        card.addView(detailRow("ID", id.take(12) + "..."))

        card.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
            ).apply { topMargin = dp(10); bottomMargin = dp(10) }
            setBackgroundColor(Color.parseColor("#1E293B"))
        })

        // ── Action buttons row 1 ────────────────────────────────────────
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            weightSum = 3f
        }
        row1.addView(actionBtn("💰 Balance", "#0EA5E9") {
            showWalletBalance(id, name, walletCurrency, walletBalance)
        })
        row1.addView(actionBtn("⬆ Top Up", "#3B82F6") {
            showTopupDialog(id, name)
        })
        row1.addView(actionBtn("📋 History", "#475569") {
            loadWalletHistory(id, name)
        })
        card.addView(row1)

        // ── Action buttons row 2 (always visible & clickable — NO overlap)
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            weightSum = 2f
            setPadding(0, dp(8), 0, 0)
        }
        row2.addView(actionBtn("💳 Validate Card", "#7C3AED") {
            showCardValidationDialog(id, name)
        })
        row2.addView(actionBtn("🏪 → Merchant Wallet", "#16A34A") {
            showSendToMerchantDialog(id, name, walletBalance, walletCurrency)
        })
        card.addView(row2)

        return card
    }

    private fun actionBtn(label: String, bgHex: String, click: () -> Unit) = Button(this).apply {
        text = label
        textSize = 10f
        setTypeface(null, Typeface.BOLD)
        setBackgroundColor(Color.parseColor(bgHex))
        setTextColor(Color.WHITE)
        setPadding(0, dp(8), 0, dp(8))
        isClickable = true
        isFocusable = true
        layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f).apply {
            marginEnd = dp(5)
            marginStart = dp(2)
        }
        setOnClickListener { click() }
    }

    // ── Balance popup ────────────────────────────────────────────────────
    private fun showWalletBalance(id: String, name: String, currency: String, fallbackBalance: Double) {
        val token = PosApplication.getJwtToken(this)
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            var bal = fallbackBalance
            var cur = currency
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) { api.getBalance(id) }
                if (resp.isSuccessful && resp.body() != null) {
                    bal = resp.body()!!.balance
                    cur = resp.body()!!.currency
                }
            } catch (_: Exception) { /* use fallback */ }
            AlertDialog.Builder(this@CustomerActivity)
                .setTitle("$name — Wallet")
                .setMessage("$cur ${String.format("%.2f", bal)}")
                .setPositiveButton("OK", null)
                .show()
        }
    }

    // ── Top up ───────────────────────────────────────────────────────────
    private fun showTopupDialog(customerId: String, name: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }
        layout.addView(TextView(this).apply {
            text = "Top up wallet for $name\n(Captured funds are credited to this wallet)"
            textSize = 13f
            setTextColor(Color.parseColor("#CBD5E1"))
            setPadding(0, 0, 0, dp(8))
        })
        val etAmount = EditText(this).apply {
            hint = "Amount (e.g. 100.00)"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 18f
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        layout.addView(etAmount)
        layout.addView(TextView(this).apply {
            text = "💡 Use this for manual credits. Real card charges via CHARGE auto-credit the wallet."
            textSize = 10f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(6), 0, dp(4))
        })

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
        val token = PosApplication.getJwtToken(this)
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) {
                    api.topup(
                        WalletTopupRequest(
                            customerId = customerId,
                            amount = amount,
                            source = "merchant_manual"
                        )
                    )
                }
                if (resp.isSuccessful && resp.body()?.success == true) {
                    Toast.makeText(this@CustomerActivity, "✓ $name topped up +$amount", Toast.LENGTH_SHORT).show()
                    loadCustomers()
                } else {
                    Toast.makeText(this@CustomerActivity, "Top up failed: ${resp.body()?.error ?: "HTTP ${resp.code()}"}", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) { Toast.makeText(this@CustomerActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show() }
        }
    }

    // ── History ──────────────────────────────────────────────────────────
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
                    if (txns.isEmpty()) sb.appendLine("No transactions yet.")
                    else txns.take(20).forEach { t ->
                        val sign = if (t.type == "credit") "+" else "-"
                        sb.appendLine("${sign}${String.format("%.2f", t.amount)}  ${t.type.uppercase()}")
                        sb.appendLine("  ${t.source}  |  ${t.createdAt.take(16)}")
                        t.reference?.let { sb.appendLine("  ref: $it") }
                        sb.appendLine()
                    }
                    AlertDialog.Builder(this@CustomerActivity)
                        .setTitle("$name — Wallet History (last 20)")
                        .setMessage(sb.toString())
                        .setPositiveButton("Close", null)
                        .show()
                } else Toast.makeText(this@CustomerActivity, "History not available", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { Toast.makeText(this@CustomerActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show() }
        }
    }

    // ── Card validation ──────────────────────────────────────────────────
    private fun showCardValidationDialog(customerId: String, customerName: String) {
        val ctx = this
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(12))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(12))
        }
        header.addView(TextView(ctx).apply {
            text = "🔐  Validate & Register Card"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(TextView(ctx).apply {
            text = customerName.take(16)
            textSize = 11f
            setTextColor(Color.parseColor("#93C5FD"))
        })
        root.addView(header)

        fun fieldLabel(s: String) = TextView(ctx).apply {
            text = s; textSize = 10f; letterSpacing = 0.1f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 0, 0, dp(4))
        }

        fun fieldInput(hint: String, pwd: Boolean = false, maxLen: Int = 24) = EditText(ctx).apply {
            this.hint = hint
            setHintTextColor(Color.parseColor("#475569"))
            textSize = 16f
            setTextColor(Color.WHITE)
            typeface = Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            inputType = when {
                pwd -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                else -> InputType.TYPE_CLASS_NUMBER
            }
            filters = arrayOf(InputFilter.LengthFilter(maxLen))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }

        root.addView(fieldLabel("CARD NUMBER (PAN)"))
        val etPan = fieldInput("•••• •••• •••• ••••", maxLen = 24)
        etPan.inputType = InputType.TYPE_CLASS_NUMBER
        // Pan auto-format
        etPan.addTextChangedListener(object : android.text.TextWatcher {
            var editing = false
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing) return
                editing = true
                val digits = s.toString().replace(" ", "").filter { it.isDigit() }.take(19)
                val formatted = digits.chunked(4).joinToString(" ")
                if (s.toString() != formatted) {
                    etPan.setText(formatted); etPan.setSelection(formatted.length)
                }
                editing = false
            }
        })
        root.addView(etPan)

        val expRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val expWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(8) }
        }
        expWrap.addView(fieldLabel("EXPIRY  MM/YY"))
        val etExp = fieldInput("MM/YY", maxLen = 5)
        etExp.addTextChangedListener(object : android.text.TextWatcher {
            var editing = false
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing) return; editing = true
                val raw = s.toString().filter { it.isDigit() }.take(4)
                val fmt = when {
                    raw.length >= 3 -> "${raw.take(2)}/${raw.drop(2)}"
                    else -> raw
                }
                if (s.toString() != fmt) { etExp.setText(fmt); etExp.setSelection(fmt.length) }
                editing = false
            }
        })
        expWrap.addView(etExp); expRow.addView(expWrap)

        val cvvWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        cvvWrap.addView(fieldLabel("CVV"))
        val etCvv = fieldInput("CVV", pwd = true, maxLen = 4)
        cvvWrap.addView(etCvv); expRow.addView(cvvWrap)
        root.addView(expRow)

        root.addView(fieldLabel("AUTHORIZATION CODE"))
        val etAuth = EditText(ctx).apply {
            hint = "6-12 char Auth Code (required to register card)"
            setHintTextColor(Color.parseColor("#475569"))
            textSize = 16f
            setTextColor(Color.WHITE)
            setAllCaps(true)
            typeface = Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            filters = arrayOf(InputFilter.LengthFilter(12), InputFilter.AllCaps())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }
        root.addView(etAuth)

        val tvResult = TextView(ctx).apply {
            text = ""
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(6), 0, dp(6))
        }
        root.addView(tvResult)

        val scroll = ScrollView(ctx).apply { addView(root) }

        val dialog = AlertDialog.Builder(ctx, android.R.style.Theme_Material_Dialog_NoActionBar)
            .setTitle(null)
            .setView(scroll)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("✅ Validate & Register", null)
            .create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply {
                setBackgroundColor(Color.parseColor("#7C3AED"))
                setTextColor(Color.WHITE)
                setOnClickListener {
                    val pan = etPan.text.toString().replace(" ", "").filter { it.isDigit() }
                    val exp = etExp.text.toString().trim()
                    val cvv = etCvv.text.toString().trim()
                    val auth = etAuth.text.toString().trim().ifBlank { null }

                    if (pan.length < 13) { tvResult.text = "❌ Enter a valid card number (min 13 digits)"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }
                    if (!exp.matches(Regex("\\d{2}/\\d{2}"))) { tvResult.text = "❌ Enter expiry in MM/YY format"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }
                    if (cvv.length < 3) { tvResult.text = "❌ Enter 3-4 digit CVV"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }
                    if (auth == null) { tvResult.text = "❌ Authorization Code required to register"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }

                    this@CustomerActivity.lifecycleScope.launch {
                        dialog.setCancelable(false)
                        tvResult.text = "⏳ Validating & registering card..."
                        tvResult.setTextColor(Color.parseColor("#F59E0B"))
                        try {
                            val serverUrl = PosApplication.getServerUrl(this@CustomerActivity)
                            val api = ApiClient.createWalletsApi(serverUrl)
                            val resp = withContext(Dispatchers.IO) {
                                api.validateCard(
                                    CardValidationRequest(
                                        pan = pan,
                                        expiry = exp,
                                        cvv = cvv,
                                        authCode = auth,
                                        merchantId = merchantId().ifBlank { null }
                                    )
                                )
                            }
                            if (resp.isSuccessful && resp.body() != null) {
                                val b = resp.body()!!
                                if (b.valid) {
                                    tvResult.text = buildString {
                                        append("✅ ${b.message ?: "Card registered"}")
                                        b.cardBrand?.let { append("\nBrand: $it") }
                                        b.panMasked?.let { append("  |  $it") }
                                    }
                                    tvResult.setTextColor(Color.parseColor("#22C55E"))
                                    android.os.Handler(android.os.Looper.getMainLooper())
                                        .postDelayed({ dialog.dismiss() }, 1500)
                                } else {
                                    tvResult.text = "❌ ${b.error ?: b.message ?: "Invalid card"}"
                                    tvResult.setTextColor(Color.parseColor("#EF4444"))
                                }
                            } else {
                                tvResult.text = "❌ Validation failed (HTTP ${resp.code()})"
                                tvResult.setTextColor(Color.parseColor("#EF4444"))
                            }
                        } catch (e: Exception) {
                            tvResult.text = "❌ ${e.message?.take(80)}"
                            tvResult.setTextColor(Color.parseColor("#EF4444"))
                        } finally {
                            dialog.setCancelable(true)
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    // ── Send funds to merchant wallet ───────────────────────────────────
    private fun showSendToMerchantDialog(customerId: String, name: String, balance: Double, currency: String) {
        val merchant = merchantId()
        if (merchant.isBlank()) {
            Toast.makeText(this, "Register terminal in Settings first", Toast.LENGTH_LONG).show(); return
        }

        // Check provider verified first
        val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val provVerified = prefs.getBoolean("provider_verified", false)
        val provEndpoint = prefs.getString("provider_endpoint", "")?.trim().orEmpty()
        val provApiKey   = prefs.getString("provider_api_key", "")?.trim().orEmpty()
        val provSecret   = prefs.getString("provider_secret", "")?.trim().orEmpty()

        if (!provVerified || provEndpoint.isEmpty() || provApiKey.isEmpty() || provSecret.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("⚠ Provider Verification Required")
                .setMessage(
                    "Before transferring funds to your merchant wallet,\n" +
                            "you must verify real provider credentials.\n\n" +
                            "Go to → Settings → Provider Credentials\n" +
                            "Fill Endpoint URL + API Key + Secret Key, then tap\n" +
                            "\"Test Provider Connection\" and ensure it shows ✅ Verified."
                )
                .setPositiveButton("OK, go to Settings") { _, _ ->
                    startActivity(android.content.Intent(this, SettingsActivity::class.java))
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }

        val ctx = this
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(12))
        }

        root.addView(TextView(ctx).apply {
            text = buildString {
                append("Customer:  $name\n")
                append("Customer Wallet:  $currency ${String.format("%.2f", balance)}\n")
                append("Destination:  Merchant Wallet $merchant")
            }
            textSize = 12f
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, 0, 0, dp(10))
        })

        root.addView(TextView(ctx).apply {
            text = "🔒 REAL PROVIDER PULL REQUIRED\n" +
                    "Funds will ONLY move after a successful live call to:\n" +
                    "$provEndpoint/pull-funds\n" +
                    "If provider does not confirm the pull, wallet balances WILL NOT change."
            textSize = 10f
            setTextColor(Color.parseColor("#B91C1C"))
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#FEF2F2"))
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setPadding(0, 0, 0, dp(12))
        })

        val etAmount = EditText(ctx).apply {
            hint = "Amount to send to merchant wallet"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 20f
            typeface = Typeface.MONOSPACE
        }
        root.addView(etAmount)

        val tvResult = TextView(ctx).apply {
            text = ""; textSize = 12f
            setPadding(0, dp(8), 0, dp(4))
        }
        root.addView(tvResult)

        AlertDialog.Builder(ctx)
            .setTitle("🏪 Send to Merchant Wallet")
            .setView(root)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("✅ Call Provider & Send", null)
            .create().apply {
                setOnShowListener {
                    getButton(AlertDialog.BUTTON_POSITIVE).apply {
                        setBackgroundColor(Color.parseColor("#16A34A"))
                        setTextColor(Color.WHITE)
                        setOnClickListener {
                            val amt = etAmount.text.toString().toDoubleOrNull() ?: return@setOnClickListener
                            if (amt <= 0) { tvResult.text = "❌ Enter positive amount"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }
                            if (amt > balance) { tvResult.text = "❌ Insufficient customer wallet"; tvResult.setTextColor(Color.parseColor("#EF4444")); return@setOnClickListener }

                            this@CustomerActivity.lifecycleScope.launch {
                                setCancelable(false)
                                tvResult.text = "⏳ Calling provider & pulling real funds..."
                                tvResult.setTextColor(Color.parseColor("#F59E0B"))
                                try {
                                    val serverUrl = PosApplication.getServerUrl(this@CustomerActivity)
                                    val api = ApiClient.createWalletsApi(serverUrl, PosApplication.getJwtToken(this@CustomerActivity))
                                    val resp = withContext(Dispatchers.IO) {
                                        api.sendFundsToMerchantWallet(
                                            SendToMerchantRequest(
                                                customerId = customerId,
                                                merchantId = merchant,
                                                amount = amt,
                                                currency = currency,
                                                providerEndpoint = provEndpoint,
                                                providerApiKey = provApiKey,
                                                providerSecretKey = provSecret
                                            )
                                        )
                                    }
                                    if (resp.isSuccessful && resp.body() != null && resp.body()!!.success) {
                                        val b = resp.body()!!
                                        tvResult.text = "✅ ${b.message ?: "Sent!"}${b.authCode?.let { "\nRef: $it" } ?: ""}"
                                        tvResult.setTextColor(Color.parseColor("#16A34A"))
                                        android.os.Handler(android.os.Looper.getMainLooper())
                                            .postDelayed({ dismiss(); loadCustomers() }, 1600)
                                    } else {
                                        val err = resp.body()?.error ?: "HTTP ${resp.code()} — try again"
                                        tvResult.text = "❌ $err"
                                        tvResult.setTextColor(Color.parseColor("#EF4444"))
                                    }
                                } catch (e: Exception) {
                                    tvResult.text = "❌ ${e.message?.take(100)}"
                                    tvResult.setTextColor(Color.parseColor("#EF4444"))
                                } finally {
                                    setCancelable(true)
                                }
                            }
                        }
                    }
                }
                show()
            }
    }

    // ── Create customer ──────────────────────────────────────────────────
    private fun showCreateCustomerDialog() {
        val ctx = this
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }
        val title = TextView(ctx).apply {
            text = "Register New Customer"
            textSize = 16f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, 0, 0, dp(10))
        }
        root.addView(title)

        val hintBox = TextView(ctx).apply {
            text = "ℹ  Only customers registered by YOU will be visible\n" +
                    "   in your customer list. Other merchants cannot see them.\n" +
                    "   merchant_id = ${if (merchantId().isNotBlank()) merchantId() else "NOT SET (register terminal first)"}"
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            setBackgroundColor(Color.parseColor("#F0FDFA"))
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setPadding(0, 0, 0, dp(10))
        }
        root.addView(hintBox)

        val etName = EditText(ctx).apply {
            hint = "Full customer name *"
            textSize = 16f
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val etEmail = EditText(ctx).apply {
            hint = "Email address (optional)"
            textSize = 14f
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val etPhone = EditText(ctx).apply {
            hint = "Phone number (optional)"
            textSize = 14f
            inputType = InputType.TYPE_CLASS_PHONE
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        root.addView(etName); root.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(1,1,1f).apply { height = dp(6) } })
        root.addView(etEmail); root.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(1,1,1f).apply { height = dp(6) } })
        root.addView(etPhone)

        AlertDialog.Builder(ctx)
            .setTitle(null)
            .setView(root)
            .setPositiveButton("✅ Register Customer") { _, _ ->
                val name = etName.text.toString().trim()
                if (name.isBlank()) { Toast.makeText(ctx, "Customer name is required", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                createCustomer(
                    name,
                    etEmail.text.toString().trim().ifBlank { null },
                    etPhone.text.toString().trim().ifBlank { null }
                )
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun createCustomer(name: String, email: String?, phone: String?) {
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl)
                val resp = withContext(Dispatchers.IO) {
                    api.createCustomer(
                        CreateCustomerRequest(
                            name = name,
                            email = email,
                            phone = phone,
                            merchantId = merchantId().ifBlank { null }
                        )
                    )
                }
                if (resp.isSuccessful) {
                    val body = resp.body()
                    Toast.makeText(this@CustomerActivity,
                        "✅ Customer registered: $name${body?.wallet_code?.let { " (Wallet: $it)" } ?: ""}",
                        Toast.LENGTH_LONG).show()
                    loadCustomers()
                } else {
                    Toast.makeText(this@CustomerActivity, "Failed: HTTP ${resp.code()}", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) { Toast.makeText(this@CustomerActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show() }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    private fun detailRow(label: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(4) }
        addView(TextView(this@CustomerActivity).apply {
            text = label
            textSize = 11f
            setTextColor(Color.parseColor("#64748B"))
            layoutParams = LinearLayout.LayoutParams(dp(34), LinearLayout.LayoutParams.WRAP_CONTENT)
        })
        addView(TextView(this@CustomerActivity).apply {
            text = value
            textSize = 12f
            setTextColor(Color.parseColor("#CBD5E1"))
        })
    }

    private fun emptyView(msg: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(30), dp(60), dp(30), dp(60))
        addView(TextView(this@CustomerActivity).apply {
            text = "👥"
            textSize = 36f
            gravity = Gravity.CENTER
        })
        addView(TextView(this@CustomerActivity).apply {
            text = msg
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(14), 0, 0)
        })
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    private fun loadingRow(msg: String) = TextView(this).apply {
        text = msg
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(Color.parseColor("#94A3B8"))
        setPadding(dp(16), dp(32), dp(16), dp(32))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
