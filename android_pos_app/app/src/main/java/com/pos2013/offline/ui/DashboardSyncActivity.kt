package com.pos2013.offline.ui

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.api.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DashboardSyncActivity : AppCompatActivity() {

    private lateinit var tvConnStatus: TextView
    private lateinit var statsContainer: LinearLayout
    private lateinit var tvLastSync: TextView
    private lateinit var btnRefresh: Button
    private lateinit var btnSyncNow: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.title = "Dashboard & Sync"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0D1B2A"))
        }

        // ── Connection header ─────────────────────────────────────────────────
        val connHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#1A2A3A"))
            setPadding(dp(16), dp(14), dp(16), dp(14))
            gravity = Gravity.CENTER_VERTICAL
            elevation = 6f
        }
        val dot = View(this).apply {
            setBackgroundColor(Color.parseColor("#FFA000"))
            layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(10) }
        }
        connHeader.addView(dot)
        tvConnStatus = TextView(this).apply {
            text = "Checking connection..."
            textSize = 13f
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        btnRefresh = Button(this).apply {
            text = "↻ Refresh"
            textSize = 11f
            setBackgroundColor(Color.parseColor("#00897B"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36))
        }
        connHeader.addView(tvConnStatus)
        connHeader.addView(btnRefresh)
        root.addView(connHeader)

        // ── Stats grid ────────────────────────────────────────────────────────
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0, 1f
            )
        }
        statsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(80))
        }
        scroll.addView(statsContainer)
        root.addView(scroll)

        // ── Bottom bar ────────────────────────────────────────────────────────
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#1A2A3A"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            gravity = Gravity.CENTER_VERTICAL
        }
        tvLastSync = TextView(this).apply {
            text = "Last sync: —"
            textSize = 11f
            setTextColor(Color.parseColor("#90A4AE"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        btnSyncNow = Button(this).apply {
            text = "⬆ Sync Now"
            textSize = 11f
            setBackgroundColor(Color.parseColor("#1565C0"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40))
        }
        bottomBar.addView(tvLastSync)
        bottomBar.addView(btnSyncNow)
        root.addView(bottomBar)

        setContentView(root)

        btnRefresh.setOnClickListener { loadDashboard() }
        btnSyncNow.setOnClickListener { syncNow() }

        loadDashboard()
    }

    private fun loadDashboard() {
        val serverUrl = PosApplication.getServerUrl(this)
        val token = PosApplication.getJwtToken(this)
        statsContainer.removeAllViews()
        statsContainer.addView(loadingRow("Loading dashboard..."))
        tvConnStatus.text = "Connecting to $serverUrl..."

        lifecycleScope.launch {
            // 1. Health check
            try {
                val api = ApiClient.createPayment2013Api(serverUrl, token)
                val health = withContext(Dispatchers.IO) { api.health() }
                if (health.isSuccessful) {
                    tvConnStatus.text = "● Connected — ${serverUrl.take(30)}"
                    tvConnStatus.setTextColor(Color.parseColor("#69F0AE"))
                } else {
                    tvConnStatus.text = "⚠ HTTP ${health.code()}"
                    tvConnStatus.setTextColor(Color.parseColor("#FFD740"))
                }
            } catch (e: Exception) {
                tvConnStatus.text = "✗ Offline — ${e.message?.take(40)}"
                tvConnStatus.setTextColor(Color.parseColor("#FF5252"))
            }

            statsContainer.removeAllViews()
            statsContainer.addView(sectionHeader("LOCAL STATUS"))

            // 2. Local pending count
            val db = AppDatabase.getDatabase(this@DashboardSyncActivity)
            val localPending = withContext(Dispatchers.IO) { db.transactionDao().countByStatus("PENDING") }
            val localSynced  = withContext(Dispatchers.IO) { db.transactionDao().countByStatus("SYNCED") }
            statsContainer.addView(statCard("📥 Pending Transactions", localPending.toString(), "#F57F17"))
            statsContainer.addView(statCard("✅ Synced Transactions", localSynced.toString(), "#388E3C"))

            if (token.isNullOrBlank()) {
                statsContainer.addView(sectionHeader("BACKEND STATS"))
                statsContainer.addView(infoCard("Login in Settings to view backend stats", "#546E7A"))
                return@launch
            }

            statsContainer.addView(sectionHeader("BACKEND STATS"))

            // 3. Vault stats
            try {
                val dashApi = ApiClient.createDashboardApi(serverUrl, token)
                val vaultResp = withContext(Dispatchers.IO) { dashApi.getVaultStats() }
                if (vaultResp.isSuccessful) {
                    val s = vaultResp.body()
                    statsContainer.addView(statCard("🏦 Vault USD Balance",
                        "\$${String.format("%.2f", s?.vaultBalancesByCurrency?.get("USD") ?: s?.totalVaultBalance ?: 0.0)}", "#1565C0"))
                    statsContainer.addView(statCard("💼 Merchant Balances",
                        "\$${String.format("%.2f", s?.totalMerchantBalances ?: 0.0)}", "#6A1B9A"))
                    statsContainer.addView(statCard("⏳ Pending Settlement",
                        "\$${String.format("%.2f", s?.totalPendingSettlement ?: 0.0)}", "#E65100"))
                    statsContainer.addView(statCard("📊 Offline Approvals",
                        "${s?.totalOfflineApprovals ?: 0}", "#00695C"))
                }
            } catch (e: Exception) {
                statsContainer.addView(infoCard("Vault stats unavailable: ${e.message?.take(60)}", "#B71C1C"))
            }

            // 4. Merchant wallet balance
            try {
                val prefs = getSharedPreferences("pos_settings", android.content.Context.MODE_PRIVATE)
                val merchantId = prefs.getString("merchant_id", "MRC-1001") ?: "MRC-1001"
                val dashApi = ApiClient.createDashboardApi(serverUrl, token)
                val mwResp = withContext(Dispatchers.IO) { dashApi.getMerchantBalance(merchantId) }
                if (mwResp.isSuccessful) {
                    val b = mwResp.body()
                    statsContainer.addView(statCard("🏪 Merchant Wallet",
                        "${b?.currency ?: "USD"} ${String.format("%.2f", b?.balance ?: 0.0)}", "#004D40"))
                }
            } catch (e: Exception) { /* non-critical */ }

            tvLastSync.text = "Last refresh: ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}"
        }
    }

    private fun syncNow() {
        btnSyncNow.isEnabled = false
        btnSyncNow.text = "Syncing..."
        val serverUrl = PosApplication.getServerUrl(this)
        val token = PosApplication.getJwtToken(this)
        lifecycleScope.launch {
            try {
                val db = AppDatabase.getDatabase(this@DashboardSyncActivity)
                val api = ApiClient.createPayment2013Api(serverUrl, token)
                val walletsApi = ApiClient.createWalletsApi(serverUrl, token)
                val repo = com.pos2013.offline.data.TransactionRepository(
                    dao = db.transactionDao(),
                    walletTopupDao = db.walletTopupDao(),
                    api = api,
                    walletsApi = walletsApi,
                    merchantId = getSharedPreferences("pos_settings", android.content.Context.MODE_PRIVATE)
                        .getString("merchant_id", "MRC-1001") ?: "MRC-1001",
                    terminalId = getSharedPreferences("pos_settings", android.content.Context.MODE_PRIVATE)
                        .getString("terminal_id", "T2013-001") ?: "T2013-001"
                )
                val result = withContext(Dispatchers.IO) { repo.syncPendingTransactions() }
                if (result.success) {
                    Toast.makeText(this@DashboardSyncActivity,
                        "✓ Synced ${result.count} txn(s), ${result.walletTopupsSynced} topup(s)",
                        Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@DashboardSyncActivity,
                        "Sync failed: ${result.errorMessage}", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@DashboardSyncActivity, "Sync error: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                btnSyncNow.isEnabled = true
                btnSyncNow.text = "⬆ Sync Now"
                loadDashboard()
            }
        }
    }

    private fun statCard(title: String, value: String, color: String): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1A2A3A"))
            setPadding(dp(16), dp(14), dp(16), dp(14))
            elevation = 3f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }
        }
        card.addView(TextView(this).apply {
            text = title
            textSize = 12f
            setTextColor(Color.parseColor("#B0BEC5"))
        })
        card.addView(TextView(this).apply {
            text = value
            textSize = 26f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(color))
        })
        return card
    }

    private fun sectionHeader(title: String) = TextView(this).apply {
        text = title
        textSize = 10f
        setTypeface(null, Typeface.BOLD)
        setTextColor(Color.parseColor("#546E7A"))
        letterSpacing = 0.15f
        setPadding(0, dp(16), 0, dp(6))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    private fun infoCard(msg: String, color: String) = TextView(this).apply {
        text = msg
        textSize = 12f
        setTextColor(Color.parseColor(color))
        setBackgroundColor(Color.parseColor("#1A2A3A"))
        setPadding(dp(16), dp(12), dp(16), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(8) }
    }

    private fun loadingRow(msg: String) = TextView(this).apply {
        text = msg
        textSize = 13f
        setTextColor(Color.parseColor("#90A4AE"))
        gravity = Gravity.CENTER
        setPadding(dp(16), dp(32), dp(16), dp(32))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
