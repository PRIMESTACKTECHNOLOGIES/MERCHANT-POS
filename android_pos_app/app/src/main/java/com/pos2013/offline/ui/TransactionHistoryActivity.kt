package com.pos2013.offline.ui

import android.content.Context
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
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.api.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

class TransactionHistoryActivity : AppCompatActivity() {

    private lateinit var listContainer: LinearLayout
    private lateinit var tvStatus: TextView
    private lateinit var btnRefresh: Button
    private lateinit var tabLocal: Button
    private lateinit var tabBackend: Button
    private var showingLocal = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "Transaction History"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F5F7FA"))
        }

        // ── Tabs ─────────────────────────────────────────────────────────────
        val tabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            elevation = 4f
        }
        tabLocal = Button(this).apply {
            text = "LOCAL (PENDING)"
            setBackgroundColor(Color.parseColor("#1565C0"))
            setTextColor(Color.WHITE)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginEnd = dp(6) }
        }
        tabBackend = Button(this).apply {
            text = "BACKEND SYNC"
            setBackgroundColor(Color.parseColor("#455A64"))
            setTextColor(Color.WHITE)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginStart = dp(6) }
        }
        btnRefresh = Button(this).apply {
            text = "↻"
            setBackgroundColor(Color.parseColor("#00897B"))
            setTextColor(Color.WHITE)
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(40)).apply { marginStart = dp(6) }
        }
        tabRow.addView(tabLocal)
        tabRow.addView(tabBackend)
        tabRow.addView(btnRefresh)
        root.addView(tabRow)

        // ── Status bar ───────────────────────────────────────────────────────
        tvStatus = TextView(this).apply {
            text = "Loading..."
            textSize = 11f
            setTextColor(Color.parseColor("#78909C"))
            setPadding(dp(16), dp(6), dp(16), dp(6))
            setBackgroundColor(Color.parseColor("#ECEFF1"))
        }
        root.addView(tvStatus)

        // ── Scrollable list ──────────────────────────────────────────────────
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

        tabLocal.setOnClickListener { showingLocal = true; updateTabs(); loadLocalTransactions() }
        tabBackend.setOnClickListener { showingLocal = false; updateTabs(); loadBackendTransactions() }
        btnRefresh.setOnClickListener { if (showingLocal) loadLocalTransactions() else loadBackendTransactions() }

        loadLocalTransactions()
    }

    private fun updateTabs() {
        tabLocal.setBackgroundColor(if (showingLocal) Color.parseColor("#1565C0") else Color.parseColor("#90A4AE"))
        tabBackend.setBackgroundColor(if (!showingLocal) Color.parseColor("#1565C0") else Color.parseColor("#90A4AE"))
    }

    private fun loadLocalTransactions() {
        tvStatus.text = "Loading local transactions..."
        lifecycleScope.launch {
            val db = AppDatabase.getDatabase(this@TransactionHistoryActivity)
            val txns = withContext(Dispatchers.IO) { db.transactionDao().getRecent(100) }
            listContainer.removeAllViews()
            if (txns.isEmpty()) {
                listContainer.addView(emptyView("No local transactions found"))
            } else {
                tvStatus.text = "${txns.size} local transaction(s)"
                txns.forEach { tx ->
                    listContainer.addView(buildTxnCard(
                        id = tx.id,
                        stan = tx.stan,
                        amount = tx.amountMinor / 100.0,
                        currency = tx.currency,
                        pan = tx.panMasked,
                        status = tx.status,
                        authMode = tx.authMode,
                        timestamp = tx.txnTimestamp,
                        authCode = tx.authCode,
                        isLocal = true
                    ))
                }
            }
        }
    }

    private fun loadBackendTransactions() {
        tvStatus.text = "Fetching from backend..."
        val serverUrl = PosApplication.getServerUrl(this)
        val token = PosApplication.getJwtToken(this)
        if (token.isNullOrBlank()) {
            tvStatus.text = "Not logged in — go to Settings to login"
            listContainer.removeAllViews()
            listContainer.addView(emptyView("Login required to view backend transactions"))
            return
        }
        lifecycleScope.launch {
            try {
                val api = ApiClient.createDashboardApi(serverUrl, token)
                val resp = withContext(Dispatchers.IO) { api.getTransactions(limit = 50) }
                listContainer.removeAllViews()
                if (resp.isSuccessful) {
                    val txns = resp.body()?.transactions ?: emptyList()
                    if (txns.isEmpty()) {
                        listContainer.addView(emptyView("No backend transactions found"))
                        tvStatus.text = "0 transactions on backend"
                    } else {
                        tvStatus.text = "${txns.size} backend transaction(s)"
                        txns.forEach { tx ->
                            listContainer.addView(buildTxnCard(
                                id = tx.id,
                                stan = tx.stan ?: "—",
                                amount = (tx.amountMinor ?: 0) / 100.0,
                                currency = tx.currency ?: "USD",
                                pan = tx.panMasked ?: "****",
                                status = tx.status ?: "—",
                                authMode = tx.authMode ?: "—",
                                timestamp = null,
                                timestampStr = tx.txnTimestamp ?: tx.createdAt,
                                authCode = tx.authCode,
                                isLocal = false
                            ))
                        }
                    }
                } else {
                    tvStatus.text = "Backend error: HTTP ${resp.code()}"
                    listContainer.addView(emptyView("Could not load: HTTP ${resp.code()}"))
                }
            } catch (e: Exception) {
                tvStatus.text = "Error: ${e.message}"
                listContainer.addView(emptyView("Connection failed: ${e.message}"))
            }
        }
    }

    private fun buildTxnCard(
        id: String,
        stan: String,
        amount: Double,
        currency: String,
        pan: String,
        status: String,
        authMode: String,
        timestamp: Long? = null,
        timestampStr: String? = null,
        authCode: String? = null,
        isLocal: Boolean
    ): View {
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

        val statusColor = when {
            status.contains("APPROVED", ignoreCase = true) || status.contains("SYNCED", ignoreCase = true) -> "#388E3C"
            status.contains("DECLINED", ignoreCase = true) || status.contains("FAILED", ignoreCase = true) -> "#C62828"
            status.contains("PENDING", ignoreCase = true) -> "#F57F17"
            else -> "#546E7A"
        }

        // Top row: amount + status badge
        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        topRow.addView(TextView(this).apply {
            text = "$currency ${String.format("%.2f", amount)}"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#1A237E"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        topRow.addView(TextView(this).apply {
            text = status.uppercase()
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(statusColor))
            setPadding(dp(8), dp(3), dp(8), dp(3))
            background = androidx.appcompat.content.res.AppCompatResources.getDrawable(
                this@TransactionHistoryActivity, android.R.drawable.editbox_background_normal
            )
        })
        card.addView(topRow)

        card.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#E3F2FD"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(8); bottomMargin = dp(8)
            }
        })

        // Details
        val details = listOf(
            "STAN" to stan,
            "CARD" to pan,
            "MODE" to authMode,
            if (!authCode.isNullOrBlank()) "AUTH CODE" to authCode else null,
            "TXN ID" to id.take(16) + "...",
            "TIME" to (timestampStr?.take(19) ?: timestamp?.let {
                SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(it))
            } ?: "—"),
            "SOURCE" to if (isLocal) "LOCAL DB" else "BACKEND"
        ).filterNotNull()

        details.forEach { (label, value) ->
            card.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(2) }
                addView(TextView(this@TransactionHistoryActivity).apply {
                    text = label
                    textSize = 11f
                    setTextColor(Color.parseColor("#78909C"))
                    setTypeface(null, Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(dp(90), LinearLayout.LayoutParams.WRAP_CONTENT)
                })
                addView(TextView(this@TransactionHistoryActivity).apply {
                    text = value
                    textSize = 11f
                    setTextColor(Color.parseColor("#263238"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            })
        }

        // Receipt button for backend transactions
        if (!isLocal) {
            val btnReceipt = Button(this).apply {
                text = "📄 View Receipt"
                textSize = 11f
                setBackgroundColor(Color.parseColor("#E3F2FD"))
                setTextColor(Color.parseColor("#1565C0"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(36)
                ).apply { topMargin = dp(8) }
            }
            btnReceipt.setOnClickListener { fetchAndShowReceipt(id) }
            card.addView(btnReceipt)
        }

        return card
    }

    private fun fetchAndShowReceipt(transactionId: String) {
        val serverUrl = PosApplication.getServerUrl(this)
        val token = PosApplication.getJwtToken(this) ?: return
        lifecycleScope.launch {
            try {
                tvStatus.text = "Loading receipt..."
                val api = ApiClient.createReceiptApi(serverUrl, token)
                val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                val merchantId = prefs.getString("merchant_id", "MRC-1001") ?: "MRC-1001"

                // Try generate first, then get
                val resp = withContext(Dispatchers.IO) {
                    try { api.generateReceipt(transactionId) }
                    catch (e: Exception) { api.getReceipt("RCP-$transactionId") }
                }
                if (resp.isSuccessful) {
                    val receipt = resp.body()
                    val text = receipt?.plainCustomer ?: receipt?.browserCustomer ?: "No receipt data"
                    showReceiptDialog(text)
                    tvStatus.text = "Receipt loaded"
                } else {
                    tvStatus.text = "Receipt not found"
                    showReceiptDialog("Receipt not available for this transaction.\nTransaction ID: $transactionId")
                }
            } catch (e: Exception) {
                tvStatus.text = "Receipt error: ${e.message}"
            }
        }
    }

    private fun showReceiptDialog(receiptText: String) {
        val tv = TextView(this).apply {
            text = receiptText
            textSize = 11f
            setTextColor(Color.parseColor("#263238"))
            typeface = Typeface.MONOSPACE
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val scroll = ScrollView(this).also { it.addView(tv) }
        AlertDialog.Builder(this)
            .setTitle("Transaction Receipt")
            .setView(scroll)
            .setPositiveButton("Close", null)
            .show()
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

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
