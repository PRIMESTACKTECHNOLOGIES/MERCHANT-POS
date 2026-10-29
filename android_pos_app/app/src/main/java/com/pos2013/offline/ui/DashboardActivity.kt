package com.pos2013.offline.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.lifecycle.ViewModelProvider
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.utils.Formatters
import com.pos2013.offline.viewmodel.DashboardViewModel
import com.pos2013.offline.viewmodel.UiState

class DashboardActivity : AppCompatActivity() {

    private lateinit var vm: DashboardViewModel
    private lateinit var currency: String
    private lateinit var statsGrid: LinearLayout
    private lateinit var pendingBadge: TextView
    private lateinit var recentList: LinearLayout
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var shortcutsGrid: GridLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (LoginActivity.startIfNeeded(this)) { finish(); return }
        currency = PosApplication.getCurrency(this)
        val scroll = ScrollView(this).apply {
            setBackgroundColor(resources.getColor(R.color.pos_background, theme))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 120)
        }
        scroll.addView(root)
        swipe = SwipeRefreshLayout(this).apply { addView(scroll) }

        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            TextView(this@DashboardActivity).apply {
                text = "Dashboard"
                textSize = 28f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }.let { addView(it) }
            Button(this@DashboardActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                text = "Charge"
                setOnClickListener { startActivity(Intent(this@DashboardActivity, MainActivity::class.java)) }
            }.let { addView(it) }
        }.let { root.addView(it, matchWrap()) }

        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(24, 16, 24, 16)
            setBackgroundColor(resources.getColor(R.color.pos_warning_container, theme))
            addView(
                TextView(this@DashboardActivity).apply {
                    text = "Pending offline txns"
                    textSize = 14f
                    setTextColor(Color.BLACK)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
            )
            pendingBadge = TextView(this@DashboardActivity).apply {
                text = "0"
                textSize = 18f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.BLACK)
                setPadding(16, 2, 16, 2)
                setBackgroundColor(Color.WHITE)
            }
            addView(pendingBadge)
        }.let { root.addView(it, matchWrap().apply { topMargin = 16; bottomMargin = 24 }) }

        statsGrid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(statsGrid, matchWrap())

        root.addView(
            sectionHeader("Recent transactions"),
            matchWrap().apply { topMargin = 32; bottomMargin = 12 }
        )
        recentList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(recentList, matchWrap())

        root.addView(
            sectionHeader("Jump to"),
            matchWrap().apply { topMargin = 32; bottomMargin = 12 }
        )
        shortcutsGrid = GridLayout(this).apply {
            columnCount = 3
            rowCount = 8
        }
        root.addView(shortcutsGrid, matchWrap())
        populateShortcuts()

        setContentView(swipe)

        vm = ViewModelProvider(this)[DashboardViewModel::class.java]
        vm.stats.observe(this) { state ->
            when (state) {
                is UiState.Loading -> swipe.isRefreshing = true
                is UiState.Success -> {
                    swipe.isRefreshing = false
                    renderStats(state.data)
                    renderRecent(state.data)
                }
                is UiState.Error -> {
                    swipe.isRefreshing = false
                    toast(state.message)
                }
                else -> swipe.isRefreshing = false
            }
        }
        vm.pendingCount.observe(this) { n -> pendingBadge.text = n.toString() }

        swipe.setOnRefreshListener { refreshAll() }
    }

    override fun onResume() {
        super.onResume()
        refreshAll()
    }

    private fun refreshAll() {
        vm.refresh(PosApplication.getMerchantId(this), currency)
        vm.refreshPendingCount()
    }

    private fun renderStats(s: com.pos2013.offline.data.api.DashboardStats) {
        swipe.isRefreshing = false
        statsGrid.removeAllViews()
        val card = mapOf(
            "Today sales" to (s.totalSalesToday ?: 0.0),
            "Yesterday sales" to (s.totalSalesYesterday ?: 0.0),
            "Today tx count" to (s.txCountToday?.toDouble() ?: 0.0),
            "Pending offline" to (s.pendingOffline?.toDouble() ?: 0.0)
        )
        val cw = (resources.displayMetrics.widthPixels - 96) / 2
        for (i in card.keys.indices step 2) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            listOf(i, i + 1).takeWhile { it < card.size }.forEach { idx ->
                val k = card.keys.elementAt(idx)
                val v = card.values.elementAt(idx)
                row.addView(
                    statCard(k, if (k.contains("count") || k.contains("pending")) v.toInt().toString() else Formatters.formatAmount(v, currency), cw),
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginEnd = if (idx % 2 == 0) 16 else 0
                        topMargin = 16
                    }
                )
            }
            statsGrid.addView(row, matchWrap())
        }

        val balances = listOfNotNull(
            s.merchantUsdBalance?.let { if (it > 0.0) "USD" to it else null },
            s.merchantPhpBalance?.let { if (it > 0.0) "PHP" to it else null },
            s.merchantAedBalance?.let { if (it > 0.0) "AED" to it else null },
            s.merchantEurBalance?.let { if (it > 0.0) "EUR" to it else null },
            s.merchantGbpBalance?.let { if (it > 0.0) "GBP" to it else null }
        )
        if (balances.isNotEmpty()) {
            statsGrid.addView(sectionHeader("Merchant wallets"), matchWrap().apply { topMargin = 32; bottomMargin = 12 })
            balances.forEach { (curr, amt) ->
                LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(32, 24, 32, 24)
                    setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                    addView(
                        TextView(this@DashboardActivity).apply {
                            text = curr
                            textSize = 16f
                            setTypeface(typeface, Typeface.BOLD)
                            setTextColor(resources.getColor(R.color.pos_primary, theme))
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }
                    )
                    addView(
                        TextView(this@DashboardActivity).apply {
                            text = Formatters.formatAmount(amt, curr)
                            textSize = 18f
                            setTypeface(typeface, Typeface.BOLD)
                            setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                        }
                    )
                }.let {
                    statsGrid.addView(it, matchWrap().apply { bottomMargin = 8 })
                }
            }
        }
    }

    private fun renderRecent(s: com.pos2013.offline.data.api.DashboardStats) {
        recentList.removeAllViews()
        val txs = s.recentTx ?: emptyList()
        if (txs.isEmpty()) {
            recentList.addView(
                placeholderCard("No recent transactions yet")
            )
            return
        }
        txs.take(8).forEach { tx ->
            recentList.addView(
                txRow(tx),
                matchWrap().apply { bottomMargin = 8 }
            )
        }
    }

    private fun populateShortcuts() {
        val entries = listOf(
            "Charge" to { open(MainActivity::class.java) },
            "Batches" to { open(BatchesActivity::class.java) },
            "Settlements" to { open(SettlementsActivity::class.java) },
            "Transactions" to { open(TransactionsActivity::class.java) },
            "Verify" to { open(VerifyTransactionActivity::class.java) },
            "Receipts" to { open(ReceiptsActivity::class.java) },
            "Wallets" to { open(WalletsActivity::class.java) },
            "Transfer" to { open(WalletTransferActivity::class.java) },
            "Customers" to { open(CustomersActivity::class.java) },
            "Products" to { open(ProductsActivity::class.java) },
            "Inventory" to { open(InventoryActivity::class.java) },
            "Terminals" to { open(TerminalsActivity::class.java) },
            "Pair" to { open(TerminalPairingActivity::class.java) },
            "Hot Wallet" to { open(HotWalletActivity::class.java) },
            "Crypto" to { open(CryptoWalletsActivity::class.java) },
            "Payouts" to { open(PayoutsActivity::class.java) },
            "Vault" to { open(VaultDashboardActivity::class.java) },
            "Virtual Cards" to { open(VirtualCardsActivity::class.java) },
            "Audit" to { open(AuditTrailActivity::class.java) },
            "Reconcile" to { open(ReconciliationActivity::class.java) },
            "Reports" to { open(ReportsActivity::class.java) },
            "Pay Methods" to { open(PaymentMethodsActivity::class.java) },
            "Printer" to { open(PrinterActivity::class.java) },
            "Security" to { open(DeviceSecurityActivity::class.java) },
            "Settings" to { open(SettingsActivity::class.java) }
        )
        val w = (resources.displayMetrics.widthPixels - 96) / 3
        entries.forEach { (label, onClick) ->
            shortcutsGrid.addView(
                shortcutTile(label, onClick, w),
                GridLayout.LayoutParams().apply {
                    setMargins(8, 8, 8, 8)
                    width = w
                    height = GridLayout.LayoutParams.WRAP_CONTENT
                }
            )
        }
    }

    private fun open(clz: Class<*>) = startActivity(Intent(this, clz))

    private fun statCard(label: String, value: String, w: Int): CardView {
        return CardView(this, null, R.style.Widget_PosApp_CardView).apply {
            setCardBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            radius = 20f
            cardElevation = 4f
            val wrap = LinearLayout(this@DashboardActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 24, 24, 24)
                minimumWidth = w
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = label
                        textSize = 12f
                        setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
                    }
                )
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = value
                        textSize = 22f
                        setTypeface(typeface, Typeface.BOLD)
                        setTextColor(resources.getColor(R.color.pos_primary, theme))
                        setPadding(0, 10, 0, 0)
                    }
                )
            }
            addView(wrap)
        }
    }

    private fun shortcutTile(label: String, onClick: () -> Unit, w: Int): View {
        return CardView(this, null, R.style.Widget_PosApp_CardView).apply {
            radius = 16f
            cardElevation = 2f
            setCardBackgroundColor(resources.getColor(R.color.pos_primary_container, theme))
            val wrap = LinearLayout(this@DashboardActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(16, 24, 16, 24)
                minimumWidth = w
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = label.split(" ").joinToString(" ") { it.take(1) }
                        textSize = 22f
                        setTypeface(typeface, Typeface.BOLD)
                        gravity = Gravity.CENTER
                        setTextColor(resources.getColor(R.color.pos_on_primary_container, theme))
                    }
                )
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = label
                        textSize = 12f
                        gravity = Gravity.CENTER
                        setPadding(0, 4, 0, 0)
                        setTextColor(resources.getColor(R.color.pos_on_primary_container, theme))
                    }
                )
            }
            addView(wrap)
            setOnClickListener { onClick() }
        }
    }

    private fun txRow(tx: com.pos2013.offline.data.api.TransactionDto): View {
        val amount = (tx.amountMinor.toDouble()) / 100.0
        return CardView(this, null, R.style.Widget_PosApp_CardView).apply {
            radius = 16f
            cardElevation = 1f
            setCardBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            val wrap = LinearLayout(this@DashboardActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 20, 24, 20)
                addView(
                    LinearLayout(this@DashboardActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        addView(
                            TextView(this@DashboardActivity).apply {
                                text = (tx.protocol ?: "—") + " · " + (tx.status ?: "")
                                textSize = 12f
                                setTextColor(resources.getColor(R.color.pos_primary, theme))
                                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                            }
                        )
                        addView(
                            TextView(this@DashboardActivity).apply {
                                text = Formatters.formatAmount(amount, tx.currency ?: currency)
                                textSize = 16f
                                setTypeface(typeface, Typeface.BOLD)
                                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                            }
                        )
                    }, matchWrap()
                )
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = "${Formatters.maskPan(tx.panMasked)} · STAN ${tx.stan ?: "-"}"
                        textSize = 12f
                        setPadding(0, 8, 0, 0)
                        setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
                    }, matchWrap()
                )
                addView(
                    TextView(this@DashboardActivity).apply {
                        text = Formatters.formatDateTimeISO(tx.capturedAt ?: tx.createdAt ?: "")
                        textSize = 11f
                        setPadding(0, 4, 0, 0)
                        setTextColor(Color.GRAY)
                    }, matchWrap()
                )
            }
            addView(wrap)
        }
    }

    private fun sectionHeader(title: String): View =
        TextView(this).apply {
            text = title.uppercase()
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
        }

    private fun placeholderCard(msg: String): View =
        CardView(this, null, R.style.Widget_PosApp_CardView).apply {
            radius = 16f
            cardElevation = 1f
            setCardBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            addView(
                TextView(this@DashboardActivity).apply {
                    text = msg
                    setPadding(32, 40, 32, 40)
                    textSize = 14f
                    gravity = Gravity.CENTER
                    setTextColor(Color.GRAY)
                }
            )
        }

    private fun matchWrap() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
