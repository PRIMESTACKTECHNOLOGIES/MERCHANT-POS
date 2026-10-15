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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * PAGE 3 — PAYMENT PROCESSOR DASHBOARD
 * Amount input, currency selector, customer selector, payment method, PROCESS PAYMENT.
 * On PROCESS PAYMENT → Page 4 (Approval Code Selection).
 */
class POSDashboardActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_AMOUNT    = "amount"
        const val EXTRA_CURRENCY  = "currency"
        const val EXTRA_CUSTOMER  = "customer_id"
        const val EXTRA_CUST_NAME = "customer_name"
        const val EXTRA_METHOD    = "payment_method"
    }

    private val CURRENCIES = listOf("AED", "USD", "EUR", "CHF", "JPY")
    private val METHODS    = listOf("Card (Manual)", "NFC / Tap", "Wallet Debit", "Redeem Code")

    private var selectedCurrency = "AED"
    private var selectedMethod   = "Card (Manual)"
    private var selectedCustomerId   = ""
    private var selectedCustomerName = ""
    private var amountBuffer = StringBuilder("0")
    private var customers: List<Pair<String,String>> = emptyList() // id, name

    private lateinit var tvAmount: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvCustLabel: TextView
    private lateinit var spinnerCurrency: Spinner
    private lateinit var spinnerCustomer: Spinner
    private lateinit var spinnerMethod: Spinner

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")
        setContentView(buildUI())
        loadCustomers()
        pingBackend()
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
        tvStatus = TextView(this).apply {
            text = "● CHECKING"; textSize = 10f
            setTextColor(Color.parseColor("#FCD34D"))
            setPadding(0, 0, dp(12), 0)
        }
        val tvBrand = TextView(this).apply {
            text = "PRIMESTACK POS"
            textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); letterSpacing = 0.08f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnMenu = TextView(this).apply {
            text = "⋮"; textSize = 22f; setTextColor(Color.parseColor("#D4AF37"))
            gravity = Gravity.CENTER; setPadding(dp(12), 0, 0, 0)
            isClickable = true; isFocusable = true
            setOnClickListener { showMenu() }
        }
        header.addView(tvBrand); header.addView(tvStatus); header.addView(btnMenu)
        frame.addView(header)

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        // ── Amount card ───────────────────────────────────────────────────────
        val amtCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(24), dp(20), dp(20))
            elevation = dp(4).toFloat()
        }
        tvCustLabel = TextView(this).apply {
            text = "No customer selected"
            textSize = 11f; setTextColor(Color.parseColor("#5B7FA6"))
            gravity = Gravity.CENTER
        }
        tvAmount = TextView(this).apply {
            text = "0.00"
            textSize = 52f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37"))
            gravity = Gravity.CENTER
        }
        amtCard.addView(tvCustLabel)
        amtCard.addView(tvAmount)
        body.addView(amtCard); body.addView(sp(16))

        // ── Currency selector ─────────────────────────────────────────────────
        body.addView(sectionLabel("CURRENCY"))
        spinnerCurrency = Spinner(this).apply { setPopupBackgroundResource(android.R.color.black) }
        val currAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, CURRENCIES)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        spinnerCurrency.adapter = currAdapter
        spinnerCurrency.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(p: AdapterView<*>?) {}
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                selectedCurrency = CURRENCIES[pos]
            }
        }
        body.addView(spinnerCurrency); body.addView(sp(16))

        // ── Customer selector ─────────────────────────────────────────────────
        body.addView(sectionLabel("CUSTOMER"))
        spinnerCustomer = Spinner(this).apply { setPopupBackgroundResource(android.R.color.black) }
        body.addView(spinnerCustomer); body.addView(sp(16))

        // ── Payment method ────────────────────────────────────────────────────
        body.addView(sectionLabel("PAYMENT METHOD"))
        spinnerMethod = Spinner(this).apply { setPopupBackgroundResource(android.R.color.black) }
        val methodAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, METHODS)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        spinnerMethod.adapter = methodAdapter
        spinnerMethod.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(p: AdapterView<*>?) {}
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                selectedMethod = METHODS[pos]
            }
        }
        body.addView(spinnerMethod); body.addView(sp(20))

        // ── Keypad ────────────────────────────────────────────────────────────
        val keypad = GridLayout(this).apply {
            columnCount = 3
            rowCount = 4
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val keys = listOf("1","2","3","4","5","6","7","8","9","C","0",".")
        keys.forEach { k ->
            val btn = Button(this).apply {
                text = k; textSize = 20f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (k == "C") Color.parseColor("#F87171") else Color.WHITE)
                setBackgroundColor(Color.parseColor("#111D30"))
                layoutParams = GridLayout.LayoutParams().apply {
                    width = 0; height = dp(58)
                    columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    rowSpec    = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    setMargins(dp(3), dp(3), dp(3), dp(3))
                }
                setOnClickListener { onKey(k) }
            }
            keypad.addView(btn)
        }
        body.addView(keypad); body.addView(sp(20))

        // ── Process Payment Button ────────────────────────────────────────────
        val btnProcess = Button(this).apply {
            text = "PROCESS PAYMENT"
            textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628"))
            setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(0, dp(18), 0, dp(18)); letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { onProcessPayment() }
        }
        body.addView(btnProcess)

        scroll.addView(body)
        frame.addView(scroll)

        // ── Bottom nav ────────────────────────────────────────────────────────
        frame.addView(buildBottomNav())

        return frame
    }

    private fun buildBottomNav(): View {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(0, dp(8), 0, dp(8))
            gravity = Gravity.CENTER
        }
        data class NavItem(val icon: String, val label: String, val action: () -> Unit)
        val items = listOf(
            NavItem("🏠", "Home") { },
            NavItem("👤", "Customer") {
                startActivity(Intent(this, CustomerCreationActivity::class.java))
            },
            NavItem("💳", "Wallet") {
                val i = Intent(this, CustomerWalletActivity::class.java)
                if (selectedCustomerId.isNotBlank()) i.putExtra(CustomerWalletActivity.EXTRA_CUSTOMER_ID, selectedCustomerId)
                startActivity(i)
            },
            NavItem("⚙", "Settings") {
                startActivity(Intent(this, SettingsActivity::class.java))
            }
        )
        items.forEach { item ->
            val v = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setPadding(0, dp(4), 0, dp(4))
                isClickable = true; isFocusable = true
                setOnClickListener { item.action() }
            }
            v.addView(TextView(this).apply {
                text = item.icon; textSize = 18f; gravity = Gravity.CENTER
            })
            v.addView(TextView(this).apply {
                text = item.label; textSize = 9f
                setTextColor(Color.parseColor("#5B7FA6")); gravity = Gravity.CENTER
            })
            nav.addView(v)
        }
        return nav
    }

    private fun onKey(k: String) {
        when (k) {
            "C"  -> amountBuffer = StringBuilder("0")
            "."  -> if (!amountBuffer.contains('.')) amountBuffer.append('.')
            else -> {
                if (amountBuffer.toString() == "0") amountBuffer = StringBuilder(k)
                else {
                    val dot = amountBuffer.indexOf('.')
                    if (dot >= 0 && amountBuffer.length - dot > 2) return
                    amountBuffer.append(k)
                }
            }
        }
        tvAmount.text = amountBuffer.toString()
    }

    private fun onProcessPayment() {
        val amount = amountBuffer.toString().toDoubleOrNull() ?: 0.0
        if (amount <= 0) { toast("Enter a valid amount"); return }

        val i = Intent(this, ApprovalCodeActivity::class.java).apply {
            putExtra(EXTRA_AMOUNT,    amount)
            putExtra(EXTRA_CURRENCY,  selectedCurrency)
            putExtra(EXTRA_CUSTOMER,  selectedCustomerId)
            putExtra(EXTRA_CUST_NAME, selectedCustomerName)
            putExtra(EXTRA_METHOD,    selectedMethod)
        }
        startActivity(i)
        overridePendingTransition(android.R.anim.slide_in_left, android.R.anim.slide_out_right)
    }

    private fun loadCustomers() {
        val serverUrl = PosApplication.getServerUrl(this)
        val jwtToken  = PosApplication.getJwtToken(this)
        val merchantId = PosApplication.getMerchantId(this)

        lifecycleScope.launch {
            try {
                val api = ApiClient.createWalletsApi(serverUrl, jwtToken)
                val resp = withContext(Dispatchers.IO) {
                    if (merchantId.isNotBlank())
                        api.getCustomersByMerchant(merchantId)
                    else
                        api.getCustomers()
                }
                if (resp.isSuccessful && resp.body() != null) {
                    val list = resp.body()!!.filter { it.merchant_id == merchantId || merchantId.isBlank() }
                    customers = listOf(Pair("", "— Select Customer —")) +
                        list.map { Pair(it.id, it.name) }
                    updateCustomerSpinner()
                }
            } catch (_: Exception) {
                customers = listOf(Pair("", "— No customers loaded —"))
                updateCustomerSpinner()
            }
        }
    }

    private fun updateCustomerSpinner() {
        val names = customers.map { it.second }
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, names)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        spinnerCustomer.adapter = adapter
        spinnerCustomer.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(p: AdapterView<*>?) {}
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                val c = customers.getOrNull(pos)
                selectedCustomerId   = c?.first ?: ""
                selectedCustomerName = c?.second ?: ""
                tvCustLabel.text = if (selectedCustomerName.isNotBlank() && pos > 0)
                    "Customer: $selectedCustomerName" else "No customer selected"
            }
        }
    }

    private fun pingBackend() {
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            while (true) {
                try {
                    val api  = ApiClient.createPayment2013Api(serverUrl)
                    val resp = withContext(Dispatchers.IO) { api.health() }
                    if (resp.isSuccessful) {
                        tvStatus.text = "● ONLINE"; tvStatus.setTextColor(Color.parseColor("#4ADE80"))
                    } else {
                        tvStatus.text = "● HTTP ${resp.code()}"; tvStatus.setTextColor(Color.parseColor("#FCD34D"))
                    }
                } catch (_: Exception) {
                    tvStatus.text = "● OFFLINE"; tvStatus.setTextColor(Color.parseColor("#F87171"))
                }
                kotlinx.coroutines.delay(15_000)
            }
        }
    }

    private fun showMenu() {
        val opts = arrayOf("Register New Customer", "Transaction History", "Device Registration", "Settings")
        android.app.AlertDialog.Builder(this)
            .setTitle("Menu")
            .setItems(opts) { _, i ->
                when (i) {
                    0 -> startActivity(Intent(this, CustomerCreationActivity::class.java))
                    1 -> startActivity(Intent(this, TransactionHistoryActivity::class.java))
                    2 -> startActivity(Intent(this, DeviceRegistrationActivity::class.java))
                    3 -> startActivity(Intent(this, SettingsActivity::class.java))
                }
            }.show()
    }

    private fun sectionLabel(text: String) = TextView(this).apply {
        this.text = text; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#5B7FA6")); letterSpacing = 0.18f
        setPadding(0, 0, 0, dp(6))
    }
    private fun sp(dp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(dp))
    }
    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
