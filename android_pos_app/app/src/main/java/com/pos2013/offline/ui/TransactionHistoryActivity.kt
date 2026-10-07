package com.pos2013.offline.ui

import android.R
import android.content.Context
import android.content.Intent
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

        // ── Action buttons: Thermal Receipt (Download + Share) for EVERY txn ──
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
            weightSum = 2f
        }

        val btnView = Button(this).apply {
            text = "📄  Receipt"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#1565C0"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(10), 0, dp(10))
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginEnd = dp(6) }
        }
        val btnSaveShare = Button(this).apply {
            text = "📥  Download"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#16A34A"))
            setTextColor(Color.WHITE)
            setPadding(0, dp(10), 0, dp(10))
            layoutParams = LinearLayout.LayoutParams(0, dp(42), 1f).apply { marginStart = dp(6) }
        }
        btnRow.addView(btnView); btnRow.addView(btnSaveShare); card.addView(btnRow)

        val safeId = id.filter { it.isLetterOrDigit() }.take(20).ifBlank { "txn-${System.currentTimeMillis()}" }
        val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val buildVersion = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
        val buildCode = packageManager.getPackageInfo(packageName, 0).versionCode ?: 1
        val merchantName = prefs.getString("merchant_name", "").orEmpty().ifBlank { "Merchant" }
        val merchantAddress = prefs.getString("merchant_address", "").orEmpty()
        val merchantPhone = prefs.getString("merchant_phone", "").orEmpty()
        val mid = prefs.getString("merchant_id", "").orEmpty()
        val tid = prefs.getString("terminal_id", "").orEmpty()

        val ts = timestampStr?.take(19) ?: timestamp?.let {
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(it))
        } ?: "—"

        val thermalText = buildFullThermalReceipt(
            merchantName = merchantName, merchantAddress = merchantAddress, merchantPhone = merchantPhone,
            merchantId = mid, terminalId = tid, stan = stan,
            authCode = authCode ?: "AUTH-", txnRef = id,
            amountStr = "$currency ${String.format("%.2f", amount)}",
            panMasked = pan, expiry = null, brand = detectBrandSimple(pan),
            entryMode = authMode,
            protocol = if (isLocal) "OFFLINE / ISO8583 STORE & FORWARD" else "ONLINE / ISO8583:2003 (EMV 2000)",
            processor = "PRIMESTACK VAULT-BANK ACQUIRER",
            softwareName = "Primestack POS Merchant",
            softwareVer = buildVersion, buildNo = "#$buildCode",
            ts = ts, currency = currency,
            responseCode = if (status.contains("APPROV", ignoreCase = true)) "00" else "NA",
            statusStr = status.uppercase(Locale.US)
        )

        btnView.setOnClickListener { showThermalReceiptFull(thermalText, safeId) }
        btnSaveShare.setOnClickListener { downloadOrShareReceipt(thermalText, safeId) }

        return card
    }

    private fun detectBrandSimple(pan: String): String {
        val d = pan.replace("*", "").replace("-", "").replace(" ", "").trim()
        val firstDigit = d.firstOrNull()?.toString() ?: ""
        val first2 = d.take(2)
        return when {
            firstDigit == "4" -> "VISA"
            firstDigit == "5" || first2 == "22" || first2 == "23" || first2 == "24" || first2 == "25" || first2 == "26" || first2 == "27" -> "MASTERCARD"
            first2 == "34" || first2 == "37" -> "AMEX"
            firstDigit == "6" -> "DISCOVER"
            else -> "CARD"
        }
    }

    private fun buildFullThermalReceipt(
        merchantName: String, merchantAddress: String, merchantPhone: String,
        merchantId: String, terminalId: String, stan: String,
        authCode: String, txnRef: String, amountStr: String,
        panMasked: String, expiry: String?, brand: String, entryMode: String,
        protocol: String, processor: String, softwareName: String,
        softwareVer: String, buildNo: String, ts: String,
        currency: String, responseCode: String, statusStr: String
    ): String {
        val line = "----------------------------------------"
        val star = "****************************************"
        val pan4 = if (panMasked.length >= 4) panMasked.takeLast(4) else panMasked
        val width = 40
        fun pad(l: String, r: String) =
            l.take(width - r.length - 1) + " ".repeat((width - r.length - 1 - l.length).coerceAtLeast(1)) + r
        fun center(s: String): String {
            val padlen = ((width - s.length) / 2).coerceAtLeast(0)
            return " ".repeat(padlen) + s
        }
        return buildString {
            appendLine(center(merchantName.uppercase()))
            if (merchantAddress.isNotBlank()) appendLine(center(merchantAddress))
            if (merchantPhone.isNotBlank())   appendLine(center("Tel: $merchantPhone"))
            appendLine(line)
            appendLine(pad("MID", merchantId.ifBlank { "N/A" }))
            appendLine(pad("TID", terminalId.ifBlank { "N/A" }))
            appendLine(pad("STAN", stan.padStart(6, '0')))
            appendLine(pad("DATE/TIME", ts))
            appendLine(line)
            appendLine(center("*** SALES RECEIPT ***"))
            appendLine(star)
            appendLine(pad("STATUS", statusStr.take(18)))
            appendLine(pad("TXN REF", txnRef.takeLast(16)))
            appendLine(pad("AUTH CODE", authCode.take(10)))
            appendLine(pad("RESPONSE", "RC $responseCode"))
            appendLine(pad("AMOUNT", amountStr))
            appendLine(pad("CURRENCY", currency))
            appendLine(star)
            appendLine(pad("CARD BRAND", brand))
            appendLine(pad("CARD NO.", panMasked.take(22)))
            if (!expiry.isNullOrBlank()) appendLine(pad("EXPIRY", expiry))
            appendLine(pad("ENTRY MODE", entryMode.take(20)))
            appendLine(line)
            appendLine(center("PROTOCOL & AQUIRING INFO"))
            appendLine(pad("PROTOCOL", protocol.take(32)))
            appendLine(pad("PROCESSOR", processor.take(28)))
            appendLine(pad("ACQUIRER HOST", "vault-bank-9000"))
            appendLine(pad("ACQUIRER PORT", "9000/TCP"))
            appendLine(pad("ISO8583 VER", "ISO8583:2003"))
            appendLine(line)
            appendLine(center("SOFTWARE & TERMINAL INFO"))
            appendLine(pad("SOFTWARE", softwareName.take(26)))
            appendLine(pad("VERSION", softwareVer.take(20)))
            appendLine(pad("BUILD", buildNo.take(20)))
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

    private fun showThermalReceiptFull(text: String, safeRef: String) {
        val ctx = this
        val scroll = ScrollView(ctx)
        val outer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val receiptTv = TextView(ctx).apply {
            this.text = text
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setBackgroundColor(Color.parseColor("#FFFDF7"))
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(dp(14), dp(16), dp(14), dp(16))
            elevation = 3f
            letterSpacing = -0.01f
        }
        outer.addView(receiptTv)

        val row1 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(12), 0, 0)
        }
        val btnDownload = Button(ctx).apply {
            this.text = "📥  Save to Downloads"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
            setPadding(0, dp(10), 0, dp(10))
        }
        val btnPrint = Button(ctx).apply {
            this.text = "🖨  Print"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#64748B"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(6) }
            setPadding(0, dp(10), 0, dp(10))
        }
        row1.addView(btnDownload); row1.addView(btnPrint); outer.addView(row1)

        val row2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
        }
        val btnShare = Button(ctx).apply {
            this.text = "📤  Share Receipt"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#16A34A"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
            setPadding(0, dp(10), 0, dp(10))
        }
        val btnClose = Button(ctx).apply {
            this.text = "✓  Close"
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#0F172A"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(6) }
            setPadding(0, dp(10), 0, dp(10))
        }
        row2.addView(btnShare); row2.addView(btnClose); outer.addView(row2)
        scroll.addView(outer)

        val dialog = AlertDialog.Builder(ctx, R.style.Theme_Material_Dialog_NoActionBar)
            .setTitle(null)
            .setView(scroll)
            .setCancelable(true)
            .create()

        btnClose.setOnClickListener { dialog.dismiss() }
        btnDownload.setOnClickListener { downloadOrShareReceipt(text, safeRef) }
        btnShare.setOnClickListener {
            try {
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "Primestack POS Receipt $safeRef")
                    putExtra(Intent.EXTRA_TEXT, text)
                }
                ctx.startActivity(Intent.createChooser(share, "Share Receipt"))
            } catch (e: Exception) { Toast.makeText(ctx, "Share error: ${e.message}", Toast.LENGTH_SHORT).show() }
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
                                    os.write(text.toByteArray(Charsets.UTF_8))
                                }
                                cb.onWriteFinished(arrayOf(android.print.PageRange.ALL_PAGES))
                            } catch (e: Exception) { cb.onWriteFailed(e.message) }
                        }
                    }
                    mgr.print("Receipt $safeRef", adapter, null)
                } else Toast.makeText(ctx, "Print unavailable", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { Toast.makeText(ctx, "Print error: ${e.message}", Toast.LENGTH_SHORT).show() }
        }
        dialog.show()
    }

    private fun downloadOrShareReceipt(receiptText: String, safeRef: String) {
        val ctx = this
        val filename = "POS_RECEIPT_${safeRef}_${System.currentTimeMillis()}.txt"
        try {
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
                    Toast.makeText(ctx, "✅ Saved: Downloads/PrimestackPOS/$filename", Toast.LENGTH_LONG).show()
                } else Toast.makeText(ctx, "❌ Could not create file", Toast.LENGTH_SHORT).show()
            } else {
                @Suppress("DEPRECATION")
                val dir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DOWNLOADS)
                if (dir != null) {
                    dir.mkdirs()
                    val f = java.io.File(dir, filename)
                    f.writeText(receiptText, Charsets.UTF_8)
                    Toast.makeText(ctx, "✅ Saved: ${f.absolutePath}", Toast.LENGTH_LONG).show()
                } else Toast.makeText(ctx, "❌ Save failed", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(ctx, "❌ Save error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
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
