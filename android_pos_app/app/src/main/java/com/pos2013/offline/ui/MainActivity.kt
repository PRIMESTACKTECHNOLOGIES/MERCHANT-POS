package com.pos2013.offline.ui

import android.R
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.text.method.DigitsKeyListener
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.card.AcsReaderManager
import com.pos2013.offline.card.AndroidBuiltInNfcReaderManager
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.TransactionRepository
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.PosChargeRequest
import com.pos2013.offline.data.model.EmvCardData
import com.pos2013.offline.data.model.WalletTopupEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var acsReaderManager: AcsReaderManager
    private lateinit var androidNfcReaderManager: AndroidBuiltInNfcReaderManager

    // UI refs
    private lateinit var tvAmount: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvResult: TextView
    private lateinit var tvReaderStatus: TextView
    private lateinit var btnCharge: Button
    private lateinit var btnSync: Button
    private lateinit var btnRedeemCode: Button
    private lateinit var btnWalletTopup: Button
    private lateinit var tvPending: TextView

    // Amount state
    private var amountBuffer = StringBuilder("0")

    // Persisted STAN counter (000001–999999)
    private val statePrefs by lazy { getSharedPreferences("pos_state", Context.MODE_PRIVATE) }
    private var lastStan: Int
        get() = statePrefs.getInt("last_stan", 0)
        set(v) = statePrefs.edit().putInt("last_stan", v).apply()


    // ── Lifecycle ─────────────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Hide Action Bar and style Status Bar
        supportActionBar?.hide()
        window.apply {
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            statusBarColor = Color.parseColor("#1E3A5F")
        }

        // Initialize readers
        acsReaderManager = AcsReaderManager(this)
        androidNfcReaderManager = AndroidBuiltInNfcReaderManager(this)

        buildUI()
        refreshPendingCount()
        setStatus("OFFLINE", "#D97706")
        observeReaders()
    }

    override fun onResume() {
        super.onResume()
        refreshPendingCount()
        acsReaderManager.openReader()
        if (androidNfcReaderManager.isAvailable()) {
            androidNfcReaderManager.enableReaderMode()
        }
        startHealthPing()
    }

    override fun onPause() {
        super.onPause()
        healthPingJob?.cancel()
        acsReaderManager.closeReader()
        if (androidNfcReaderManager.isAvailable()) {
            androidNfcReaderManager.disableReaderMode()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let {
            androidNfcReaderManager.handleIntent(it)
        }
    }

    private fun observeReaders() {
        lifecycleScope.launch {
            acsReaderManager.readerStatus.collectLatest { status ->
                updateReaderStatus(status, "📇")
            }
        }

        lifecycleScope.launch {
            androidNfcReaderManager.readerStatus.collectLatest { status ->
                updateReaderStatus(status, "📱")
            }
        }

        lifecycleScope.launch {
            acsReaderManager.cardData.collectLatest { cardData ->
                cardData?.let {
                    showCardDetectedDialog(it)
                }
            }
        }

        lifecycleScope.launch {
            androidNfcReaderManager.cardData.collectLatest { cardData ->
                cardData?.let {
                    showCardDetectedDialog(it)
                }
            }
        }
    }

    private fun updateReaderStatus(status: String, prefix: String) {
        tvReaderStatus.text = "$prefix $status"
    }

    private fun getRepo(): TransactionRepository {
        val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val jwtToken = PosApplication.getJwtToken(this)
        val serverUrl = PosApplication.getServerUrl(this)
        val appDatabase = (application as PosApplication).database
        return TransactionRepository(
            dao = appDatabase.transactionDao(),
            walletTopupDao = appDatabase.walletTopupDao(),
            api = ApiClient.createPayment2013Api(serverUrl, jwtToken),
            walletsApi = ApiClient.createWalletsApi(serverUrl, jwtToken),
            merchantId = prefs.getString("merchant_id", "MERCHANT123") ?: "MERCHANT123",
            terminalId = prefs.getString("terminal_id", "TERM001") ?: "TERM001"
        )
    }

    // ── Build UI ───────────────────────────────────────────────────────────────
    private fun buildUI() {
        // Outer frame: header (fixed) + scrollable content + bottom nav (fixed)
        val frame = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F1F5F9"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        // ── Fixed header ─────────────────────────────────────────────────────
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#1E3A5F"))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            gravity = Gravity.CENTER_VERTICAL
        }
        val tvTitle = TextView(this).apply {
            text = "POS Terminal"
            textSize = 16f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        tvStatus = TextView(this).apply {
            text = "● Checking..."
            textSize = 10f
            setTextColor(Color.parseColor("#93C5FD"))
            setPadding(0, 0, dp(8), 0)
        }
        val btnSettingsIco = TextView(this).apply {
            text = "⚙"; textSize = 22f; setTextColor(Color.WHITE)
            gravity = Gravity.CENTER; setPadding(dp(12), dp(6), dp(12), dp(6))
            isClickable = true; isFocusable = true
            setOnClickListener { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }
        }
        header.addView(tvTitle); header.addView(tvStatus); header.addView(btnSettingsIco)
        frame.addView(header)

        // ── Scrollable body ──────────────────────────────────────────────────
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }

        // Amount display (compact)
        val amountCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(16), dp(10), dp(16), dp(10))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        TextView(this).apply {
            text = "Amount (AED)"
            textSize = 10f
            setTextColor(Color.parseColor("#9CA3AF"))
            gravity = Gravity.CENTER
        }.also { amountCard.addView(it) }
        tvAmount = TextView(this).apply {
            text = "0.00"
            textSize = 40f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#111827"))
            gravity = Gravity.END
        }
        amountCard.addView(tvAmount)
        tvPending = TextView(this).apply {
            text = ""; textSize = 10f
            setTextColor(Color.parseColor("#D97706"))
            gravity = Gravity.CENTER
        }
        amountCard.addView(tvPending)
        body.addView(amountCard)

        // Reader status (single compact line)
        tvReaderStatus = TextView(this).apply {
            text = "📇 Waiting for reader..."
            textSize = 11f
            setTextColor(Color.parseColor("#374151"))
            setPadding(dp(12), dp(5), dp(12), dp(5))
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#FFFBEB"))
        }
        body.addView(tvReaderStatus)

        // Result banner (compact)
        tvResult = TextView(this).apply {
            text = "Ready"
            textSize = 11f
            setTextColor(Color.parseColor("#374151"))
            setPadding(dp(12), dp(6), dp(12), dp(6))
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#EFF6FF"))
        }
        body.addView(tvResult)

        body.addView(buildKeypad())
        body.addView(buildActionRow())

        scroll.addView(body)
        frame.addView(scroll)

        // ── Fixed bottom nav ─────────────────────────────────────────────────
        frame.addView(buildBottomNav())

        setContentView(frame)
    }

    private fun buildKeypad(): GridLayout {
        val grid = GridLayout(this).apply {
            columnCount = 3
            setPadding(dp(6), dp(6), dp(6), dp(2))
            setBackgroundColor(Color.parseColor("#F1F5F9"))
        }
        listOf("1","2","3","4","5","6","7","8","9","C","0",".").forEach { key ->
            val isC = key == "C"
            val btn = Button(this).apply {
                text = key
                textSize = 20f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (isC) Color.parseColor("#DC2626") else Color.parseColor("#1F2937"))
                setBackgroundColor(if (isC) Color.parseColor("#FEE2E2") else Color.WHITE)
                setPadding(0, dp(10), 0, dp(10))
                elevation = 1f
                layoutParams = GridLayout.LayoutParams().apply {
                    width = 0; height = GridLayout.LayoutParams.WRAP_CONTENT
                    columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    setMargins(dp(3), dp(3), dp(3), dp(3))
                }
                setOnClickListener { onKeyPress(key) }
            }
            grid.addView(btn)
        }
        return grid
    }

    private fun buildActionRow(): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(8), dp(6), dp(8), dp(8))
        }

        // Row 1: Charge + Sync
        val topRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        btnCharge = Button(this).apply {
            text = "💳 CHARGE"
            textSize = 14f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#1E3A5F"))
            layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(4) }
            setOnClickListener { onChargeClick() }
        }
        btnSync = Button(this).apply {
            text = "⬆ Sync"
            textSize = 12f; setTextColor(Color.parseColor("#92400E")); typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#FDE68A"))
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(44))
            visibility = View.GONE
            setOnClickListener { onSyncClick() }
        }
        topRow.addView(btnCharge); topRow.addView(btnSync)
        row.addView(topRow)

        // Row 2: Wallet Topup + Redeem (side by side)
        row.addView(space(5))
        val row2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        btnWalletTopup = Button(this).apply {
            text = "💳 Wallet Topup"
            textSize = 12f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#7C3AED"))
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginEnd = dp(4) }
            setOnClickListener { showWalletTopupDialog() }
        }
        btnRedeemCode = Button(this).apply {
            text = "⌨ 6-Digit Code"
            textSize = 12f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#16A34A"))
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f)
            setOnClickListener { showRedeemCodeDialog() }
        }
        row2.addView(btnWalletTopup); row2.addView(btnRedeemCode)
        row.addView(row2)

        // Row 3: Print Receipt button
        row.addView(space(5))
        val btnPrint = Button(this).apply {
            text = "🖨 Print Last Receipt"
            textSize = 12f; setTextColor(Color.parseColor("#1E3A5F")); typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#E0E7FF"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38))
            setOnClickListener { printLastReceipt() }
        }
        row.addView(btnPrint)

        return row
    }

    private fun buildBottomNav(): LinearLayout {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#1E3A5F"))
            setPadding(dp(2), dp(6), dp(2), dp(8))
            elevation = 8f
        }
        fun navBtn(icon: String, label: String, action: () -> Unit) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            isClickable = true; isFocusable = true
            setPadding(0, dp(2), 0, dp(2))
            setOnClickListener { action() }
            addView(TextView(this@MainActivity).apply {
                text = icon; textSize = 18f; gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            })
            addView(TextView(this@MainActivity).apply {
                text = label; textSize = 9f; gravity = Gravity.CENTER
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor("#93C5FD"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            })
        }
        nav.addView(navBtn("🏠", "POS") { /* home */ })
        nav.addView(navBtn("📋", "History") { startActivity(Intent(this, TransactionHistoryActivity::class.java)) })
        nav.addView(navBtn("👥", "Customers") { startActivity(Intent(this, CustomerActivity::class.java)) })
        nav.addView(navBtn("⚙", "Settings") { startActivity(Intent(this, SettingsActivity::class.java)) })
        return nav
    }

    private fun showCardDetectedDialog(cardData: EmvCardData) {
        val amount = getAmount()

        // Auto-format expiry from MMYY → MM/YY
        val expiry = cardData.expiryDate.let {
            val digits = it.replace("/", "").trim()
            if (digits.length >= 4) "${digits.take(2)}/${digits.drop(2).take(2)}" else it
        }

        // If no amount set — show toast and open keypad focus, don't process
        if (amount <= 0) {
            runOnUiThread {
                tvReaderStatus.text = "📱 Card ready — enter amount then tap again"
                tvReaderStatus.setBackgroundColor(Color.parseColor("#EFF6FF"))
            }
            return
        }

        // Use the professional card-detected screen
        val ctx = this
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        // Top bar
        val topBar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
        }
        TextView(ctx).apply {
            text = "NFC CARD DETECTED"
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            letterSpacing = 0.12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }.also { topBar.addView(it) }
        TextView(ctx).apply {
            text = "AED ${"%.2f".format(amount)}"
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }.also { topBar.addView(it) }
        root.addView(topBar)

        // Card info block
        val cardBlock = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            setBackgroundColor(Color.parseColor("#1E40AF"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(dp(20), dp(16), dp(20), dp(8)) }
        }

        // NFC icon
        TextView(ctx).apply {
            text = "📡  CONTACTLESS"
            textSize = 11f
            setTextColor(Color.parseColor("#BFDBFE"))
            letterSpacing = 0.1f
        }.also { cardBlock.addView(it) }

        TextView(ctx).apply {
            text = cardData.pan.chunked(4).joinToString("   ")
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(0, dp(12), 0, dp(4))
        }.also { cardBlock.addView(it) }

        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        TextView(ctx).apply {
            text = if (expiry.isNotBlank()) "Expires: $expiry" else ""
            textSize = 12f
            setTextColor(Color.parseColor("#BFDBFE"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }.also { row.addView(it) }
        TextView(ctx).apply {
            text = cardData.cardholderName ?: (cardData.applicationLabel ?: "CARD HOLDER")
            textSize = 12f
            setTextColor(Color.parseColor("#93C5FD"))
            gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }.also { row.addView(it) }
        cardBlock.addView(row)
        root.addView(cardBlock)

        // Status
        val tvStatus2 = TextView(ctx).apply {
            text = "✅  Card read successful — ready to charge"
            textSize = 13f
            setTextColor(Color.parseColor("#4ADE80"))
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(16), dp(16), dp(8))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }
        root.addView(tvStatus2)

        // Divider
        root.addView(View(ctx).apply {
            setBackgroundColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
        })

        // Buttons
        val btnRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }
        val btnCancel = Button(ctx).apply {
            text = "CANCEL"
            textSize = 14f
            setTextColor(Color.parseColor("#94A3B8"))
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(0, dp(14), 0, dp(14))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(10) }
        }
        val btnCharge2 = Button(ctx).apply {
            text = "CHARGE AED ${"%.2f".format(amount)}"
            textSize = 13f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#16A34A"))
            setPadding(0, dp(14), 0, dp(14))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2f)
        }
        btnRow.addView(btnCancel)
        btnRow.addView(btnCharge2)
        root.addView(btnRow)

        val dialog = AlertDialog.Builder(ctx, android.R.style.Theme_Material_Dialog_NoActionBar)
            .setView(root)
            .create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener { dialog.dismiss() }
        btnCharge2.setOnClickListener {
            dialog.dismiss()
            if (isNetworkAvailable()) {
                submitOnlineCharge(
                    amount = amount,
                    pan = cardData.pan,
                    expiry = expiry,
                    cvv = null,
                    emv = cardData.emvData?.let { mapOf("field55" to it) },
                    tlvRaw = cardData.emvData
                )
            } else {
                processOfflineQueue(amount, cardData.pan, expiry, cardData.readerSource)
            }
        }

        runOnUiThread { dialog.show() }
    }

    private fun showWalletTopupDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }

        val etWalletCode = EditText(this).apply {
            hint = "PSW-XXXX-XXXX"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            textSize = 20f
            typeface = android.graphics.Typeface.MONOSPACE
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#1E3A5F"))
        }
        val etTopupAmount = EditText(this).apply {
            hint = "Topup Amount (AED)"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 16f
        }
        val infoBox = TextView(this).apply {
            text = "💡 Find the Wallet Code on the customer's profile in the dashboard\n   Example: PSW-8604-2781"
            textSize = 11f
            setTextColor(Color.parseColor("#6B7280"))
            setBackgroundColor(Color.parseColor("#F0FDF4"))
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }

        layout.addView(infoBox)
        layout.addView(space(8))
        layout.addView(label("Wallet Code"))
        layout.addView(etWalletCode)
        layout.addView(space(6))
        layout.addView(label("Topup Amount"))
        layout.addView(etTopupAmount)

        AlertDialog.Builder(this)
            .setTitle("💳 Wallet Topup")
            .setView(layout)
            .setPositiveButton("Queue Topup") { _, _ ->
                val walletCode = etWalletCode.text.toString().trim().uppercase()
                val topupAmount = etTopupAmount.text.toString().toDoubleOrNull() ?: 0.0
                if (walletCode.isEmpty() || !walletCode.startsWith("PSW-")) {
                    toast("Enter a valid Wallet Code (PSW-XXXX-XXXX)")
                    return@setPositiveButton
                }
                if (topupAmount <= 0) {
                    toast("Enter valid amount")
                    return@setPositiveButton
                }
                acsReaderManager.cardData.value?.let { cardData ->
                    queueWalletTopupByCode(walletCode, topupAmount, cardData)
                } ?: run {
                    queueWalletTopupByCode(walletCode, topupAmount, null)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun queueWalletTopupByCode(walletCode: String, amount: Double, cardData: EmvCardData?) {
        setResult("⏳ Queueing wallet topup...")
        lifecycleScope.launch {
            try {
                val amountMinor = (amount * 100).toLong()
                val topup = WalletTopupEntity(
                    id = UUID.randomUUID().toString(),
                    customerId = walletCode,   // store walletCode here — backend resolves it
                    amountMinor = amountMinor,
                    currency = "AED",
                    panMasked = cardData?.pan ?: "MANUAL_ENTRY",
                    expiry = cardData?.expiryDate ?: "",
                    txnTimestamp = System.currentTimeMillis(),
                    entryMode = if (cardData != null) "EMV_CHIP" else "MANUAL",
                    emvData = cardData?.emvData
                )
                getRepo().createOfflineWalletTopup(topup)
                setResult("💾 Queued topup: AED ${"%.2f".format(amount)} → $walletCode", "#FEF3C7")
                toast("Queued — tap Sync ↑ to process")
                refreshPendingCount()
                if (isNetworkAvailable()) onSyncClick()
            } catch (e: Exception) {
                setResult("❌ Error: ${e.message}", "#FEE2E2")
            }
        }
    }

    // ── Keypad logic ──────────────────────────────────────────────────────────
    private fun onKeyPress(key: String) {
        when (key) {
            "C" -> amountBuffer = StringBuilder("0")
            "." -> if (!amountBuffer.contains('.')) amountBuffer.append('.')
            else -> {
                if (amountBuffer.toString() == "0") amountBuffer = StringBuilder(key)
                else {
                    val dot = amountBuffer.indexOf('.')
                    if (dot >= 0 && amountBuffer.length - dot > 2) return
                    amountBuffer.append(key)
                }
            }
        }
        tvAmount.text = amountBuffer.toString()
    }

    private fun getAmount(): Double = amountBuffer.toString().toDoubleOrNull() ?: 0.0

    private var healthPingJob: kotlinx.coroutines.Job? = null

    private fun startHealthPing() {
        healthPingJob?.cancel()
        healthPingJob = lifecycleScope.launch {
            while (true) {
                try {
                    val serverUrl = PosApplication.getServerUrl(this@MainActivity)
                    val api = ApiClient.createPayment2013Api(serverUrl)
                    val resp = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        api.health()
                    }
                    if (resp.isSuccessful) {
                        setStatus("ONLINE", "#4ADE80")
                        // Auto-sync pending if we just came online
                        val db = (application as PosApplication).database
                        val pending = db.transactionDao().countByStatus("PENDING")
                        if (pending > 0 && isNetworkAvailable()) onSyncClick()
                    } else {
                        setStatus("HTTP ${resp.code()}", "#FFA000")
                    }
                } catch (e: Exception) {
                    setStatus("OFFLINE", "#FF5252")
                }
                kotlinx.coroutines.delay(15_000) // ping every 15 seconds
            }
        }
    }

    // ── Processor health check ────────────────────────────────────────────────
    private fun setStatus(text: String, hex: String) {
        tvStatus.text = "● $text"
        tvStatus.setTextColor(Color.parseColor(hex))
    }

    // ── Charge click — card PAN dialog → offline queue ────────────────────────
    private fun onChargeClick() {
        val amount = getAmount()
        if (amount <= 0) { toast("Enter a valid amount"); return }
        showCardDialog(amount)
    }

    private fun showCardDialog(amount: Double) {
        // ── Full-screen professional card entry ─────────────────────────────
        val ctx = this
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        // ── Top bar ──────────────────────────────────────────────────────────
        val topBar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
        }
        val tvTitle = TextView(ctx).apply {
            text = "CARD PAYMENT"
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            letterSpacing = 0.15f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvAmt = TextView(ctx).apply {
            text = "AED ${"%.2f".format(amount)}"
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        topBar.addView(tvTitle); topBar.addView(tvAmt)
        root.addView(topBar)

        // ── Card preview graphic ──────────────────────────────────────────────
        val cardPreview = FrameLayout(ctx).apply {
            setPadding(dp(20), dp(16), dp(20), dp(8))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }
        val cardBg = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E40AF"))
            setPadding(dp(20), dp(18), dp(20), dp(18))
            elevation = 8f
        }
        val tvCardLabel = TextView(ctx).apply {
            text = "● ● ● ●   ● ● ● ●   ● ● ● ●   ● ● ● ●"
            textSize = 14f
            setTextColor(Color.parseColor("#93C5FD"))
            typeface = android.graphics.Typeface.MONOSPACE
        }
        val tvCardExpiry = TextView(ctx).apply {
            text = "MM/YY"
            textSize = 12f
            setTextColor(Color.parseColor("#BFDBFE"))
            setPadding(0, dp(8), 0, 0)
        }
        val tvCardType = TextView(ctx).apply {
            text = "VISA / MASTERCARD"
            textSize = 11f
            setTextColor(Color.parseColor("#93C5FD"))
            gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        cardBg.addView(tvCardLabel)
        cardBg.addView(tvCardExpiry)
        cardBg.addView(tvCardType)
        cardPreview.addView(cardBg)
        root.addView(cardPreview)

        // ── Input section ────────────────────────────────────────────────────
        val inputSection = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(12))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        fun fieldLabel(text: String) = TextView(ctx).apply {
            this.text = text
            textSize = 10f
            setTextColor(Color.parseColor("#64748B"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            letterSpacing = 0.12f
            setPadding(0, 0, 0, dp(4))
        }

        fun styledInput(hint: String, isPassword: Boolean = false) = EditText(ctx).apply {
            this.hint = hint
            this.setHintTextColor(Color.parseColor("#475569"))
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            if (isPassword) inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else inputType = InputType.TYPE_CLASS_NUMBER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }

        val etPan = styledInput("•••• •••• •••• ••••")
        etPan.filters = arrayOf(InputFilter.LengthFilter(23)) // 19 digits + 4 spaces
        etPan.inputType = InputType.TYPE_CLASS_NUMBER

        // Auto-format PAN with spaces
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
                    etPan.setText(formatted)
                    etPan.setSelection(formatted.length)
                }
                tvCardLabel.text = if (digits.isNotEmpty())
                    digits.chunked(4).joinToString("   ")
                else "● ● ● ●   ● ● ● ●   ● ● ● ●   ● ● ● ●"
                editing = false
            }
        })

        val expiryRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }

        val etExpiry = styledInput("MM/YY")
        etExpiry.filters = arrayOf(InputFilter.LengthFilter(5))
        etExpiry.inputType = InputType.TYPE_CLASS_NUMBER
        etExpiry.addTextChangedListener(object : android.text.TextWatcher {
            var editing = false
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing) return
                editing = true
                val raw = s.toString().filter { it.isDigit() }.take(4)
                val fmt = when {
                    raw.length >= 3 -> "${raw.take(2)}/${raw.drop(2)}"
                    raw.length == 2 -> raw
                    else -> raw
                }
                if (s.toString() != fmt) {
                    etExpiry.setText(fmt)
                    etExpiry.setSelection(fmt.length)
                }
                tvCardExpiry.text = if (fmt.length == 5) "Expires: $fmt" else "MM/YY"
                editing = false
            }
        })
        etExpiry.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        )

        val etCvv = styledInput("CVV", isPassword = true)
        etCvv.filters = arrayOf(InputFilter.LengthFilter(4))
        etCvv.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        etCvv.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        )

        val expiryWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(10) }
        }
        val cvvWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        expiryWrap.addView(fieldLabel("EXPIRY DATE"))
        expiryWrap.addView(etExpiry)
        cvvWrap.addView(fieldLabel("SECURITY CODE"))
        cvvWrap.addView(etCvv)
        expiryRow.addView(expiryWrap)
        expiryRow.addView(cvvWrap)

        val etAuthCode = styledInput("OPTIONAL CODE").apply {
            filters = arrayOf(InputFilter.LengthFilter(12), InputFilter.AllCaps())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val authCodeWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
        }
        authCodeWrap.addView(fieldLabel("AUTHORIZATION CODE (OPTIONAL)"))
        authCodeWrap.addView(etAuthCode)

        inputSection.addView(fieldLabel("CARD NUMBER"))
        inputSection.addView(etPan)
        inputSection.addView(expiryRow)
        inputSection.addView(authCodeWrap)
        root.addView(inputSection)

        // ── Divider ───────────────────────────────────────────────────────────
        root.addView(View(ctx).apply {
            setBackgroundColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
        })

        // ── Buttons ───────────────────────────────────────────────────────────
        val btnRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        val btnCancel = Button(ctx).apply {
            text = "CANCEL"
            textSize = 14f
            setTextColor(Color.parseColor("#94A3B8"))
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(0, dp(14), 0, dp(14))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(10) }
        }

        val btnPay = Button(ctx).apply {
            text = "PROCESS PAYMENT"
            textSize = 14f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#1D4ED8"))
            setPadding(0, dp(14), 0, dp(14))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2f)
        }

        btnRow.addView(btnCancel)
        btnRow.addView(btnPay)
        root.addView(btnRow)

        // ── Show as dialog covering most of screen ───────────────────────────
        val scrollView = ScrollView(ctx).apply {
            isFillViewport = true
            addView(root)
        }

        val dialog = AlertDialog.Builder(ctx, android.R.style.Theme_Material_Dialog_NoActionBar)
            .setView(scrollView)
            .create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        )
        dialog.window?.setLayout(
            android.view.WindowManager.LayoutParams.MATCH_PARENT,
            android.view.WindowManager.LayoutParams.MATCH_PARENT
        )

        btnCancel.setOnClickListener { dialog.dismiss() }

        btnPay.setOnClickListener {
            val rawPan = etPan.text.toString().replace(" ", "").trim()
            val expiry = etExpiry.text.toString().trim()
            val cvv = etCvv.text.toString().trim()
            val authCode = etAuthCode.text.toString().trim().ifEmpty { null }

            if (rawPan.length < 13) { toast("Invalid card number"); return@setOnClickListener }
            if (!expiry.matches(Regex("\\d{2}/\\d{2}"))) { toast("Enter expiry MM/YY"); return@setOnClickListener }
            if (cvv.length < 3) { toast("Enter CVV"); return@setOnClickListener }
            if (authCode.isNullOrBlank()) {
                toast("Enter Authorization Code first (required for card registration)")
                return@setOnClickListener
            }

            val panMasked = "*".repeat(rawPan.length - 4) + rawPan.takeLast(4)
            dialog.dismiss()

            // ── STEP 1: Validate & register card via backend BEFORE charge ──
            if (isNetworkAvailable()) {
                lifecycleScope.launch {
                    setResult("⏳ Step 1/3: Validating card & registering auth code...", "#FEF3C7")
                    try {
                        val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                        val mid = prefs.getString("merchant_id", "")?.trim().orEmpty()
                        val walletsApi = ApiClient.createWalletsApi(PosApplication.getServerUrl(this@MainActivity))
                        val valResp = withContext(kotlinx.coroutines.Dispatchers.IO) {
                            walletsApi.validateCard(
                                com.pos2013.offline.data.api.CardValidationRequest(
                                    pan = rawPan,
                                    expiry = expiry,
                                    cvv = cvv,
                                    authCode = authCode,
                                    merchantId = mid.ifBlank { null }
                                )
                            )
                        }
                        if (!valResp.isSuccessful || valResp.body()?.valid != true) {
                            val err = valResp.body()?.error ?: valResp.body()?.message ?: "HTTP ${valResp.code()}"
                            setResult("❌ CARD VALIDATION FAILED\n$err\nCharge not attempted.", "#FEE2E2")
                            toast("Card validation declined")
                            return@launch
                        }
                        setResult("✅ Card registered — Step 2/3: Authorizing charge...", "#FEF3C7")

                        // ── STEP 2/3: Submit charge to online processor ──
                        submitOnlineCharge(amount, rawPan, expiry, cvv, authCode = authCode,
                            panMaskedExtra = panMasked,
                            brandExtra = valResp.body()?.cardBrand)
                    } catch (e: Exception) {
                        setResult("❌ Validation error: ${e.localizedMessage ?: e.message}", "#FEE2E2")
                        toast("Card validation error")
                    }
                }
            } else {
                // Offline: skip validation (cannot reach validator) → queue as pending
                setResult("⚠ Offline mode — card validation skipped. Will be validated at next sync.", "#FEF3C7")
                processOfflineQueue(amount, panMasked, expiry, authCode = authCode)
            }
        }

        dialog.show()
        dialog.window?.setLayout(
            android.view.WindowManager.LayoutParams.MATCH_PARENT,
            android.view.WindowManager.LayoutParams.MATCH_PARENT
        )
    }

    private fun submitOnlineCharge(
        amount: Double,
        pan: String,
        expiry: String?,
        cvv: String?,
        emv: Map<String, Any?>? = null,
        tlvRaw: String? = null,
        authCode: String? = null,
        panMaskedExtra: String? = null,
        brandExtra: String? = null
    ) {
        val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val merchantId = prefs.getString("merchant_id", "")?.trim().orEmpty()
        val terminalId = prefs.getString("terminal_id", "")?.trim().orEmpty()
        val merchantName = prefs.getString("merchant_name", "").orEmpty().ifBlank { "Merchant" }
        val merchantAddress = prefs.getString("merchant_address", "").orEmpty()
        val merchantPhone   = prefs.getString("merchant_phone", "").orEmpty()
        val buildVersion    = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
        val buildCode       = packageManager.getPackageInfo(packageName, 0).versionCode ?: 1

        if (merchantId.isBlank() || terminalId.isBlank()) {
            setResult("❌ Configure Merchant ID and Terminal ID in Settings", "#FEE2E2")
            return
        }

        val stan = generateNextStan()
        val panMasked = panMaskedExtra
            ?: if (pan.length >= 4) "*".repeat(pan.length - 4) + pan.takeLast(4) else "****-****"
        val txnId = lastTransactionId
        val ts = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date())

        setResult("⏳ Step 2/3: Sending online authorization...", "#FEF3C7")
        lifecycleScope.launch {
            try {
                val api = ApiClient.createPayment2013Api(PosApplication.getServerUrl(this@MainActivity))
                val response = api.chargeOnline(
                    PosChargeRequest(
                        amountMinor = (amount * 100).toLong(),
                        currency = "AED",
                        merchantId = merchantId,
                        terminalId = terminalId,
                        pan = pan,
                        expiry = expiry,
                        cvv = cvv,
                        authCode = authCode,
                        emv = emv,
                        tlvRaw = tlvRaw,
                        stan = stan
                    )
                )
                val body = response.body()
                if (response.isSuccessful && body?.status == "APPROVED" && !body.authCode.isNullOrBlank()) {
                    lastTransactionId = body.paymentIntentId
                    setResult(
                        "✅ APPROVED (Step 3/3)\nApproval code: ${body.authCode}\nRef: ${body.paymentIntentId ?: "-"}",
                        "#DCFCE7"
                    )
                    resetAmount()
                    toast("Payment approved — Receipt ready")

                    // ── Show thermal receipt dialog with full metadata + download/share ──
                    val receiptText = buildThermalReceiptText(
                        merchantName = merchantName,
                        merchantAddress = merchantAddress,
                        merchantPhone = merchantPhone,
                        merchantId = merchantId,
                        terminalId = terminalId,
                        stan = stan,
                        authCode = body.authCode,
                        txnRef = body.paymentIntentId ?: txnId.orEmpty(),
                        amountStr = "AED ${String.format("%.2f", amount)}",
                        panMasked = panMasked,
                        expiry = expiry,
                        brand = (brandExtra ?: body.brand ?: detectBrand(pan)).uppercase(),
                        entryMode = if (emv != null) "EMV CONTACTLESS" else "MANUAL KEY ENTRY",
                        protocol = "ONLINE / ISO8583-1993:2003 (EMV 2000)",
                        processor = "PRIMESTACK VAULT-BANK ACQUIRER",
                        softwareName = "Primestack POS Merchant",
                        softwareVer = buildVersion,
                        buildNo = "#$buildCode",
                        ts = ts,
                        currency = "AED",
                        responseCode = body.responseCode ?: "00"
                    )
                    showThermalReceiptDialog(receiptText, body.paymentIntentId ?: "txn-${System.currentTimeMillis()}")
                } else if (response.isSuccessful && body?.status == "PENDING") {
                    setResult(
                        "⏳ ACCEPTED FOR BANK BATCH\nReference: ${body.paymentIntentId ?: "-"}\nApproval code will be returned after bank authorization",
                        "#FEF3C7"
                    )
                    resetAmount()
                    toast("Accepted for bank batch")
                } else {
                    val reason = body?.reason ?: body?.error ?: response.errorBody()?.string() ?: "Online payment declined"
                    setResult("❌ DECLINED\n$reason", "#FEE2E2")
                    toast("Payment declined")
                }
            } catch (e: Exception) {
                setResult("❌ Online authorization failed\n${e.localizedMessage ?: e.message}", "#FEE2E2")
            }
        }
    }

    private fun detectBrand(pan: String): String {
        val d = pan.replace(" ", "")
        return when {
            d.startsWith("4") -> "VISA"
            d.startsWith("5") || d.startsWith("2") -> "MASTERCARD"
            d.startsWith("34") || d.startsWith("37") -> "AMEX"
            d.startsWith("6") -> "DISCOVER"
            else -> "CARD"
        }
    }

    private fun buildThermalReceiptText(
        merchantName: String, merchantAddress: String, merchantPhone: String,
        merchantId: String, terminalId: String, stan: String,
        authCode: String, txnRef: String, amountStr: String,
        panMasked: String, expiry: String?, brand: String, entryMode: String,
        protocol: String, processor: String, softwareName: String,
        softwareVer: String, buildNo: String, ts: String,
        currency: String, responseCode: String
    ): String {
        val line = "----------------------------------------"
        val star = "****************************************"
        val pan4 = panMasked.takeLast(4)
        val width = 40
        fun pad(l: String, r: String) =
            l.take(width - r.length - 1) + " ".repeat((width - r.length - 1 - l.length).coerceAtLeast(1)) + r
        fun center(s: String): String {
            val padlen = ((width - s.length) / 2).coerceAtLeast(0)
            return " ".repeat(padlen) + s
        }
        fun big(s: String): String {
            val padlen = ((width - s.length) / 2).coerceAtLeast(0)
            return " ".repeat(padlen) + s
        }
        return buildString {
            appendLine(center(merchantName.uppercase()))
            if (merchantAddress.isNotBlank()) appendLine(center(merchantAddress))
            if (merchantPhone.isNotBlank())   appendLine(center("Tel: $merchantPhone"))
            appendLine(line)
            appendLine(pad("MID", merchantId))
            appendLine(pad("TID", terminalId))
            appendLine(pad("STAN", stan.padStart(6, '0')))
            appendLine(pad("DATE/TIME", ts))
            appendLine(line)
            appendLine(center("*** SALES RECEIPT ***"))
            appendLine(star)
            appendLine(pad("TXN REF", txnRef.takeLast(16)))
            appendLine(pad("AUTH CODE", authCode))
            appendLine(pad("RESPONSE", "RC $responseCode  APPROVED"))
            appendLine(pad("AMOUNT", amountStr))
            appendLine(pad("CURRENCY", currency))
            appendLine(star)
            appendLine(pad("CARD BRAND", brand))
            appendLine(pad("CARD NO.", "****-****-****-$pan4"))
            if (!expiry.isNullOrBlank()) appendLine(pad("EXPIRY", expiry))
            appendLine(pad("ENTRY MODE", entryMode))
            appendLine(line)
            appendLine(center("PROTOCOL & AQUIRING INFO"))
            appendLine(pad("PROTOCOL", protocol))
            appendLine(pad("PROCESSOR", processor))
            appendLine(pad("ACQUIRER HOST", "vault-bank-9000"))
            appendLine(pad("ACQUIRER PORT", "9000/TCP"))
            appendLine(pad("ISO8583 VER", "ISO8583:2003"))
            appendLine(line)
            appendLine(center("SOFTWARE & TERMINAL INFO"))
            appendLine(pad("SOFTWARE", softwareName))
            appendLine(pad("VERSION", softwareVer))
            appendLine(pad("BUILD", buildNo))
            appendLine(pad("VENDOR", "PRIMESTACK FZCO"))
            appendLine(line)
            appendLine()
            appendLine(center("**** CUSTOMER COPY ****"))
            appendLine()
            appendLine(center("Thank you for your purchase!"))
            appendLine(center("Please retain for your records."))
            appendLine()
            appendLine()
            appendLine()
            appendLine(center("-------- SIGNATURE --------"))
            appendLine()
        }
    }

    private fun showThermalReceiptDialog(receiptText: String, txnRef: String) {
        val ctx = this
        val scroll = ScrollView(ctx)
        val outer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        // ── Paper-like receipt box (monospace, 80-char thermal look) ──
        val receiptTv = TextView(ctx).apply {
            text = receiptText
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(dp(14), dp(16), dp(14), dp(16))
            elevation = 3f
            setShadowLayer(2f, 0f, 1f, Color.parseColor("#94A3B8"))
            letterSpacing = -0.01f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        outer.addView(receiptTv)

        // ── Row 1: Download + Print ────────────────────────────────────
        val row1 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(14), 0, 0)
        }
        val btnDownload = Button(ctx).apply {
            text = "📥  Save to Downloads"
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(12), 0, dp(12))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
        }
        val btnPrint = Button(ctx).apply {
            text = "🖨  Print"
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#64748B"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(12), 0, dp(12))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(6) }
        }
        row1.addView(btnDownload); row1.addView(btnPrint)
        outer.addView(row1)

        // ── Row 2: Share + Close ───────────────────────────────────────
        val row2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
        }
        val btnShare = Button(ctx).apply {
            text = "📤  Share Receipt"
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#16A34A"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(12), 0, dp(12))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
        }
        val btnClose = Button(ctx).apply {
            text = "✓  Close"
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(12), 0, dp(12))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(6) }
        }
        row2.addView(btnShare); row2.addView(btnClose)
        outer.addView(row2)

        scroll.addView(outer)

        val dialog = AlertDialog.Builder(ctx, R.style.Theme_Material_Dialog_NoActionBar)
            .setTitle(null)
            .setView(scroll)
            .setCancelable(true)
            .create()

        val safeRef = txnRef.filter { it.isLetterOrDigit() }.take(24).ifBlank { "receipt-${System.currentTimeMillis()}" }

        btnClose.setOnClickListener { dialog.dismiss() }

        btnDownload.setOnClickListener {
            try {
                val filename = "POS_RECEIPT_${safeRef}_${System.currentTimeMillis()}.txt"
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename)
                        put(android.provider.MediaStore.Downloads.MIME_TYPE, "text/plain")
                        put(android.provider.MediaStore.Downloads.RELATIVE_PATH,
                            android.os.Environment.DIRECTORY_DOWNLOADS + "/PrimestackPOS")
                    }
                    val uri = ctx.contentResolver.insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    if (uri != null) {
                        ctx.contentResolver.openOutputStream(uri).use { os ->
                            os?.write(receiptText.toByteArray(Charsets.UTF_8))
                        }
                        toast("✅ Receipt saved: Downloads/PrimestackPOS/$filename")
                    } else toast("❌ Could not create file")
                } else {
                    @Suppress("DEPRECATION")
                    val dir = android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_DOWNLOADS)
                    if (dir != null) {
                        dir.mkdirs()
                        val f = java.io.File(dir, filename)
                        f.writeText(receiptText, Charsets.UTF_8)
                        toast("✅ Receipt saved to: ${f.absolutePath}")
                    } else toast("❌ Could not save to Downloads")
                }
            } catch (e: Exception) {
                toast("❌ Save failed: ${e.message?.take(60)}")
            }
        }

        btnShare.setOnClickListener {
            try {
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "Primestack POS Receipt $safeRef")
                    putExtra(Intent.EXTRA_TEXT, receiptText)
                }
                ctx.startActivity(Intent.createChooser(share, "Share Receipt"))
            } catch (e: Exception) { toast("Share error: ${e.message}") }
        }

        btnPrint.setOnClickListener {
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
                    val mgr = getSystemService(Context.PRINT_SERVICE) as android.print.PrintManager
                    val adapter = object : android.print.PrintDocumentAdapter() {
                        override fun onStart() { super.onStart() }
                        override fun onFinish() { super.onFinish() }
                        override fun onLayout(
                            old: android.print.PrintAttributes?, new: android.print.PrintAttributes?,
                            cancel: android.os.CancellationSignal,
                            cb: LayoutResultCallback, extras: android.os.Bundle?
                        ) {
                            val info = android.print.PrintDocumentInfo.Builder("receipt_$safeRef.pdf")
                                .setContentType(android.print.PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                                .setPageCount(1)
                                .build()
                            cb.onLayoutFinished(info, true)
                        }
                        override fun onWrite(
                            pages: Array<android.print.PageRange>?,
                            dest: android.os.ParcelFileDescriptor,
                            cancel: android.os.CancellationSignal,
                            cb: WriteResultCallback
                        ) {
                            try {
                                java.io.FileOutputStream(dest.fileDescriptor).use { os ->
                                    os.write(receiptText.toByteArray(Charsets.UTF_8))
                                }
                                cb.onWriteFinished(arrayOf(android.print.PageRange.ALL_PAGES))
                            } catch (e: Exception) { cb.onWriteFailed(e.message) }
                        }
                    }
                    mgr.print("Receipt $safeRef", adapter, null)
                } else toast("Print not available on this device")
            } catch (e: Exception) { toast("Print error: ${e.message}") }
        }

        runOnUiThread { dialog.show() }
    }

    // ── Store offline transaction in Room ─────────────────────────────────────
    private fun processOfflineQueue(
        amount: Double,
        panMasked: String,
        expiry: String,
        entryMode: String = "MANUAL",
        authCode: String? = null
    ) {
        val nextStan = generateNextStan()
        val amountMinor = (amount * 100).toLong()

        setResult("⏳ Saving transaction...")
        lifecycleScope.launch {
            try {
                getRepo().createOfflineTransaction(
                    amountMinor = amountMinor,
                    currency = "AED",
                    panMasked = panMasked,
                    expiry = expiry,
                    stan = nextStan,
                    entryMode = entryMode,
                    txnType = "SALE",
                    authMode = if (!authCode.isNullOrBlank()) "PRE_AUTHORIZED" else "OFFLINE_APPROVED",
                    authCode = authCode
                )
                setResult("💾 Queued  STAN: $nextStan  AED ${"%.2f".format(amount)}", "#FEF3C7")
                resetAmount()
                refreshPendingCount()
                toast("Saved — press Sync ↑ to upload")

                // Auto-sync if online
                if (isNetworkAvailable()) onSyncClick()
            } catch (e: Exception) {
                setResult("❌ Save failed: ${e.message}", "#FEE2E2")
            }
        }
    }

    // ── Sync → upload batch → receive 6-digit settlement code ─────────────────
    private fun onSyncClick() {
        if (!isNetworkAvailable()) { toast("No internet"); return }
        setResult("🔄 Uploading batch and wallet topups...")
        btnSync.isEnabled = false

        lifecycleScope.launch {
            try {
                val result = getRepo().syncPendingTransactions()
                if (result.success) {
                    refreshPendingCount()
                    val message = buildString {
                        append("✅ Sync complete")
                        if (result.count > 0) append(" (${result.count} tx)")
                        if (result.walletTopupsSynced > 0) append(" (${result.walletTopupsSynced} wallet topups)")
                    }
                    setResult(message, "#D1FAE5")
                } else {
                    setResult("⚠ Sync error: ${result.errorMessage}", "#FEE2E2")
                }
            } catch (e: Exception) {
                setResult("❌ Sync failed: ${e.message}", "#FEE2E2")
            } finally {
                btnSync.isEnabled = true
            }
        }
    }

    // ── Redeem 6-digit code dialog ────────────────────────────────────────────
    private fun showRedeemCodeDialog() {
        val amount = getAmount()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(8))
        }

        val infoBox = TextView(this).apply {
            text = "Customer enters their 6-digit payment code below.\nAmount must match the code's value."
            textSize = 12f
            setTextColor(Color.parseColor("#374151"))
            setBackgroundColor(Color.parseColor("#F0FDF4"))
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        layout.addView(infoBox)
        layout.addView(space(10))

        if (amount > 0) {
            layout.addView(label("Amount to charge: AED ${"%.2f".format(amount)}"))
            layout.addView(space(6))
        }

        val etCode = EditText(this).apply {
            hint = "6-digit code"
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 28f
            typeface = android.graphics.Typeface.MONOSPACE
            setTextColor(Color.parseColor("#1E3A5F"))
            gravity = Gravity.CENTER
            filters = arrayOf(android.text.InputFilter.LengthFilter(6))
        }
        layout.addView(label("Payment Code")); layout.addView(etCode)

        // If no amount entered, show amount field too
        var etAmount: EditText? = null
        if (amount <= 0) {
            layout.addView(space(6))
            layout.addView(label("Amount (AED)"))
            etAmount = EditText(this).apply {
                hint = "0.00"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                textSize = 18f
            }
            layout.addView(etAmount)
        }

        AlertDialog.Builder(this)
            .setTitle("⌨  Redeem Payment Code")
            .setView(layout)
            .setPositiveButton("Redeem") { _, _ ->
                val code = etCode.text.toString().trim()
                if (code.length != 6) { toast("Code must be exactly 6 digits"); return@setPositiveButton }
                val chargeAmount = if (amount > 0) amount
                    else etAmount?.text?.toString()?.toDoubleOrNull() ?: 0.0
                if (chargeAmount <= 0) { toast("Enter a valid amount"); return@setPositiveButton }
                processRedemption(code, chargeAmount)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun processRedemption(code: String, amount: Double) {
        setResult("⏳ Redeeming code $code...")
        btnRedeemCode.isEnabled = false

        lifecycleScope.launch {
            try {
                val (success, message, reference) = getRepo().redeemCode(code, amount)
                if (success) {
                    setResult("✅ Code $code APPROVED\nAED ${"%.2f".format(amount)}\nRef: $reference", "#D1FAE5")
                    resetAmount()
                    toast("Payment approved!")
                } else {
                    setResult("❌ Code $code REJECTED\n$message", "#FEE2E2")
                    toast("Redemption failed")
                }
            } catch (e: Exception) {
                setResult("❌ Error: ${e.message}", "#FEE2E2")
            } finally {
                btnRedeemCode.isEnabled = true
            }
        }
    }

    // ── Thermal receipt printer (Bluetooth ESC/POS) ───────────────────────────
    private var lastReceiptText: String? = null
    private var lastTransactionId: String? = null

    private fun printLastReceipt() {
        val token = PosApplication.getJwtToken(this)
        val serverUrl = PosApplication.getServerUrl(this)
        val txId = lastTransactionId

        if (txId == null) {
            toast("No transaction to print — process a payment first")
            return
        }
        if (token.isNullOrBlank()) {
            toast("Login required — go to Settings")
            return
        }

        setResult("🖨 Fetching receipt...", "#EFF6FF")
        lifecycleScope.launch {
            try {
                val api = ApiClient.createReceiptApi(serverUrl, token)
                val resp = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    api.generateReceipt(txId)
                }
                if (resp.isSuccessful) {
                    val text = resp.body()?.plainCustomer ?: resp.body()?.browserCustomer ?: ""
                    lastReceiptText = text
                    showPrintDialog(text)
                } else {
                    toast("Receipt not available: HTTP ${resp.code()}")
                }
            } catch (e: Exception) {
                toast("Receipt error: ${e.message}")
            }
        }
    }

    private fun showPrintDialog(receiptText: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
        }

        // Preview
        val tv = TextView(this).apply {
            text = receiptText.take(500) + if (receiptText.length > 500) "\n..." else ""
            textSize = 9f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#1F2937"))
            setBackgroundColor(Color.parseColor("#F9FAFB"))
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        val sv = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(200))
        }
        sv.addView(tv)
        layout.addView(sv)

        // Bluetooth device address input
        layout.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#E5E7EB"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(8); bottomMargin = dp(8) }
        })
        layout.addView(TextView(this).apply {
            text = "Bluetooth Printer MAC Address"
            textSize = 11f; setTextColor(Color.parseColor("#6B7280"))
            typeface = Typeface.DEFAULT_BOLD
        })
        val etMac = EditText(this).apply {
            hint = "e.g. 00:11:22:33:44:55"
            textSize = 13f
            typeface = Typeface.MONOSPACE
            val savedMac = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                .getString("printer_mac", "") ?: ""
            setText(savedMac)
        }
        layout.addView(etMac)

        AlertDialog.Builder(this)
            .setTitle("🖨 Print Receipt")
            .setView(layout)
            .setPositiveButton("Print via Bluetooth") { _, _ ->
                val mac = etMac.text.toString().trim()
                if (mac.isBlank()) {
                    // Show receipt as text if no printer
                    showReceiptAsText(receiptText)
                    return@setPositiveButton
                }
                // Save MAC for next time
                getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                    .edit().putString("printer_mac", mac).apply()
                printViaBluetooth(mac, receiptText)
            }
            .setNeutralButton("View on Screen") { _, _ -> showReceiptAsText(receiptText) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun printViaBluetooth(macAddress: String, text: String) {
        // Request BLUETOOTH_CONNECT permission on Android 12+
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.BLUETOOTH_CONNECT), 1001)
                toast("Bluetooth permission requested — try printing again")
                return
            }
        }
        setResult("🖨 Connecting to printer...", "#EFF6FF")
        lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()
                if (adapter == null || !adapter.isEnabled) {
                    runOnUiThread { toast("Bluetooth is off — turn it on first") }
                    return@launch
                }

                val device = try {
                    adapter.getRemoteDevice(macAddress.uppercase().trim())
                } catch (e: Exception) {
                    runOnUiThread { toast("Invalid MAC address: $macAddress") }
                    return@launch
                }

                val socket = try {
                    device.createRfcommSocketToServiceRecord(
                        java.util.UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
                    )
                } catch (e: Exception) {
                    runOnUiThread { toast("Could not create Bluetooth socket: ${e.message}") }
                    return@launch
                }

                try {
                    socket.connect()

                    val out = socket.outputStream

                    // ESC/POS init
                    out.write(byteArrayOf(0x1B, 0x40)) // ESC @ — initialize printer

                    // Print text as UTF-8
                    // Clean control chars but keep newlines
                    val clean = text.replace(Regex("[\\x00-\\x09\\x0B-\\x1F\\x7F]"), "")
                    out.write(clean.toByteArray(Charsets.UTF_8))

                    // Feed and cut
                    out.write(byteArrayOf(0x0A, 0x0A, 0x0A)) // 3 line feeds
                    out.write(byteArrayOf(0x1D, 0x56, 0x00)) // GS V 0 — full cut

                    out.flush()
                    socket.close()

                    runOnUiThread {
                        setResult("✅ Receipt printed successfully", "#DCFCE7")
                        toast("Printed!")
                    }
                } catch (e: Exception) {
                    try { socket.close() } catch (_: Exception) {}
                    runOnUiThread {
                        setResult("❌ Print failed: ${e.message}", "#FEE2E2")
                        toast("Print failed — check printer is on and paired")
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Bluetooth error: ${e.message}") }
            }
        }
    }

    private fun showReceiptAsText(text: String) {
        val tv = TextView(this).apply {
            this.text = text
            textSize = 10f
            typeface = Typeface.MONOSPACE
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val sv = ScrollView(this).also { it.addView(tv) }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Receipt")
            .setView(sv)
            .setPositiveButton("Close", null)
            .show()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private fun refreshPendingCount() {
        lifecycleScope.launch {
            try {
                val db = (application as PosApplication).database
                val pendingTx = db.transactionDao().countByStatus("PENDING")
                val pendingWalletTopups = db.walletTopupDao().countPendingTopups()
                val totalPending = pendingTx + pendingWalletTopups

                if (totalPending > 0) {
                    val message = buildString {
                        append("⚠ ")
                        if (pendingTx > 0) append("$pendingTx tx")
                        if (pendingTx > 0 && pendingWalletTopups > 0) append(" + ")
                        if (pendingWalletTopups > 0) append("$pendingWalletTopups wallet topup${if (pendingWalletTopups > 1) "s" else ""}")
                        append(" pending — tap Sync ↑")
                    }
                    tvPending.text = message
                    btnSync.visibility = View.VISIBLE
                } else {
                    tvPending.text = ""
                    btnSync.visibility = View.GONE
                }
            } catch (_: Exception) {}
        }
    }

    private fun generateNextStan(): String {
        val next = if (lastStan >= 999_999) 1 else lastStan + 1
        lastStan = next
        return String.format("%06d", next)
    }

    private fun setResult(msg: String, bgHex: String = "#EFF6FF") {
        tvResult.text = msg
        tvResult.setBackgroundColor(Color.parseColor(bgHex))
    }

    private fun resetAmount() {
        amountBuffer = StringBuilder("0")
        tvAmount.text = "0.00"
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun label(text: String) = TextView(this).apply {
        this.text = text; textSize = 11f
        setTextColor(Color.parseColor("#6B7280"))
        setPadding(0, dp(4), 0, dp(2))
    }

    private fun space(dpVal: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(dpVal))
    }
}
