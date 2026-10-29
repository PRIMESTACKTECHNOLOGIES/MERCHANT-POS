package com.pos2013.offline.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.ViewModelProvider
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.data.api.*
import com.pos2013.offline.utils.Formatters
import com.pos2013.offline.utils.ReceiptThermal
import com.pos2013.offline.viewmodel.FinanceViewModel
import com.pos2013.offline.viewmodel.fold

// ── Receipts ─────────────────────────────────────────────────────────────────
class ReceiptsActivity : BaseListActivity<ReceiptDto>() {
    override val pageTitle = "Receipts"
    override val pageSubtitle = "View, print, or share transaction receipts (ESC/POS 58mm + 80mm)"

    private lateinit var vm: FinanceViewModel
    private var onlyForTxn: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onlyForTxn = intent.getStringExtra("transactionId")
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]
        vm.receipts.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() { vm.loadReceipts(PosApplication.getMerchantId(this), onlyForTxn) }

    private fun row(r: ReceiptDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            addView(LinearLayout(this@ReceiptsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@ReceiptsActivity).apply {
                    text = "TXN " + (r.id ?: r.transactionId ?: "-").takeLast(10)
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(this@ReceiptsActivity).apply {
                    text = (r.statusText ?: "OK").uppercase()
                    textSize = 12f
                    setBackgroundColor(resources.getColor(R.color.pos_success_container, theme))
                    setPadding(16, 6, 16, 6)
                })
            }, matchWrap())

            val vert = LinearLayout(this@ReceiptsActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 10, 0, 0)
                r.merchantName?.let { addView(kvRow("Merchant", it)) }
                addView(kvRow("Amount", fmtAmount(r.total ?: r.amount, r.currency)))
                r.tip?.let { if (it > 0.0) addView(kvRow("Tip", fmtAmount(it, r.currency))) }
                r.tax?.let { if (it > 0.0) addView(kvRow("Tax", fmtAmount(it, r.currency))) }
                r.panMasked?.let { addView(kvRow("Card", it)) }
                r.cardBrand?.let { addView(kvRow("Brand", it)) }
                r.entryMode?.let { addView(kvRow("Entry", it)) }
                r.approvalCode?.let { addView(kvRow("Approval", it)) }
                r.authCode?.let { addView(kvRow("Auth", it)) }
                r.stan?.let { addView(kvRow("STAN", it)) }
                r.rrn?.let { addView(kvRow("RRN", it.takeLast(12))) }
                r.txnTime?.let { addView(kvRow("Time", fmtISO(it))) }
                r.created_at?.let { addView(kvRow("Generated", fmtISO(it))) }
            }
            addView(vert, matchWrap())

            addView(LinearLayout(this@ReceiptsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 14, 0, 0)
                addView(Button(this@ReceiptsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "View"
                    setOnClickListener { viewReceipt(r) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 8 }
                })
                addView(Button(this@ReceiptsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Print"
                    setOnClickListener { printReceipt(r) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 8 }
                })
                addView(Button(this@ReceiptsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Share"
                    setOnClickListener { shareReceipt(r) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }

    private fun viewReceipt(r: ReceiptDto) {
        val preview58 = ReceiptThermal.build58(
            merchantName = r.merchantName ?: "Primestack POS",
            merchantAddress = r.merchantAddress,
            merchantPhone = r.merchantPhone,
            mid = r.mid,
            tid = r.tid,
            amountMinor = ((r.total ?: r.amount ?: 0.0) * 100).toLong(),
            currency = r.currency ?: "USD",
            panMasked = r.panMasked,
            brand = r.cardBrand,
            entryMode = r.entryMode,
            approvalCode = r.approvalCode,
            authCode = r.authCode,
            stan = r.stan,
            rrn = r.rrn,
            authRef = r.authRef,
            invoiceNo = r.invoiceNumber,
            cashier = r.cashierName,
            txnTime = r.txnTime ?: r.created_at ?: "-",
            tip = r.tip?.let { (it * 100).toLong() },
            tax = r.tax?.let { (it * 100).toLong() },
            customerName = r.customerName,
            qrContent = r.qrContent
        )
        AlertDialog.Builder(this, R.style.Theme_PosApp).apply {
            setTitle("Receipt \u2014 " + (r.id ?: "-").takeLast(8))
            val scroll = ScrollView(this@ReceiptsActivity)
            val tv = TextView(this@ReceiptsActivity).apply {
                text = preview58
                typeface = Typeface.MONOSPACE
                setPadding(32, 32, 32, 32)
                textSize = 12f
                setBackgroundColor(Color.WHITE)
                setTextColor(Color.BLACK)
            }
            scroll.addView(tv)
            setView(scroll)
            setPositiveButton("Done", null)
            show()
        }
    }

    private fun printReceipt(r: ReceiptDto) {
        val text = r.plainText ?: ReceiptThermal.build58(
            merchantName = r.merchantName ?: "Primestack POS",
            amountMinor = ((r.total ?: r.amount ?: 0.0) * 100).toLong(),
            currency = r.currency ?: "USD",
            panMasked = r.panMasked,
            approvalCode = r.approvalCode,
            stan = r.stan,
            rrn = r.rrn,
            txnTime = r.txnTime ?: r.created_at ?: "-"
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TITLE, "Receipt")
            putExtra(Intent.EXTRA_TEXT, text)
        }
        try {
            startActivity(Intent.createChooser(send, "Print / Send receipt"))
        } catch (t: Throwable) {
            toast("No print app available")
        }
    }

    private fun shareReceipt(r: ReceiptDto) {
        val sb = StringBuilder()
        if (r.plainText != null) {
            sb.append(r.plainText)
        } else {
            sb.append("Receipt ")
                .append(r.id ?: "")
                .append(" ")
                .append(r.total)
                .append(" ")
                .append(r.currency)
                .append("\nPan: ")
                .append(r.panMasked)
                .append("\nApproval: ")
                .append(r.approvalCode)
        }
        val text = sb.toString()
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Receipt " + (r.id ?: ""))
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(send, "Share receipt"))
    }
}

// ── Wallets ─────────────────────────────────────────────────────────────────
class WalletsActivity : BaseListActivity<WalletTransactionDto>() {
    override val pageTitle = "Wallets"
    override val pageSubtitle = "Merchant and customer wallet balances + transactions"

    private lateinit var vm: FinanceViewModel
    private lateinit var balancesCard: LinearLayout
    private var scopeIsMerchant = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]

        val scope = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 8, 0, 16)
            val merchantChip = chip("MERCHANT", R.color.pos_primary, R.color.pos_on_primary)
            val custChip = chip("CUSTOMER", R.color.pos_surface_variant)
            merchantChip.setOnClickListener {
                scopeIsMerchant = true
                setChipState(merchantChip, custChip)
                load()
            }
            custChip.setOnClickListener {
                scopeIsMerchant = false
                setChipState(custChip, merchantChip)
                load()
            }
            addView(merchantChip)
            addView(custChip)
        }
        rootLayout.addView(scope, matchWrap())

        balancesCard = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        rootLayout.addView(card(balancesCard), matchWrap().apply { bottomMargin = 16 })

        vm.walletBalances.observe(this) { state ->
            bindState(state) { list -> renderBalances(list) }
        }
        vm.walletTx.observe(this) { state ->
            bindState(state) { list -> render(list, this::rowTx) }
        }
    }

    private fun setChipState(on: TextView, off: TextView) {
        on.setBackgroundColor(resources.getColor(R.color.pos_primary, theme))
        on.setTextColor(resources.getColor(R.color.pos_on_primary, theme))
        off.setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        off.setTextColor(resources.getColor(R.color.pos_on_surface, theme))
    }

    private fun renderBalances(list: List<WalletBalanceResponse>) {
        balancesCard.removeAllViews()
        if (list.isEmpty()) {
            balancesCard.addView(TextView(this).apply {
                text = "No wallets found"
                textSize = 14f
                setTextColor(Color.GRAY)
                setPadding(24, 40, 24, 40)
                gravity = Gravity.CENTER
            })
            return
        }
        list.forEach { b ->
            val color = when (b.currency?.uppercase()) {
                "USD" -> R.color.pos_primary
                "PHP" -> R.color.pos_accent_teal
                "AED", "EUR", "GBP" -> R.color.pos_accent
                else -> R.color.pos_violet_container
            }
            val tile = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(24, 20, 24, 20)
                setBackgroundColor(resources.getColor(color, theme))
                addView(TextView(this@WalletsActivity).apply {
                    text = b.walletCode ?: b.currency ?: "WALLET"
                    textSize = 18f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(this@WalletsActivity).apply {
                    text = Formatters.formatAmount(b.balance, b.currency ?: "USD")
                    textSize = 20f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_primary, theme))
                })
            }
            balancesCard.addView(tile, matchWrap().apply { bottomMargin = 8 })
        }

        val transferBtn = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Transfer funds"
            setOnClickListener {
                startActivity(Intent(this@WalletsActivity, WalletTransferActivity::class.java))
            }
        }
        balancesCard.addView(transferBtn, matchWrap().apply { topMargin = 8 })
    }

    override fun load() {
        vm.loadWalletBalances(
            merchantId = if (scopeIsMerchant) PosApplication.getMerchantId(this) else null,
            customerId = if (scopeIsMerchant) null else "ALL"
        )
        vm.loadWalletTransactions(
            merchantId = if (scopeIsMerchant) PosApplication.getMerchantId(this) else null,
            customerId = if (scopeIsMerchant) null else "ALL"
        )
    }

    private fun rowTx(t: WalletTransactionDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 16, 20, 16)
            val head = LinearLayout(this@WalletsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@WalletsActivity).apply {
                    text = (t.type ?: "TX").uppercase()
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                val positive = t.amount >= 0
                addView(TextView(this@WalletsActivity).apply {
                    text = (if (positive) "+" else "") + Formatters.formatAmount(t.amount, "USD")
                    textSize = 16f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(
                        if (positive) resources.getColor(R.color.pos_success, theme)
                        else resources.getColor(R.color.pos_error, theme)
                    )
                })
            }
            addView(head, matchWrap())
            val fromView = kvRow("From", (t.customerId ?: t.merchantId ?: t.walletId ?: "-"))
            addView(fromView, matchWrap().apply { topMargin = 6 })
            t.panMasked?.let { addView(kvRow("Card", it), matchWrap()) }
            t.description?.let { addView(kvRow("Note", it), matchWrap()) }
            addView(kvRow("Time", fmtISO(t.createdAt)), matchWrap())
        }
        return card(wrap)
    }
}

// ── Wallet Transfer ────────────────────────────────────────────────────────
class WalletTransferActivity : BaseListActivity<Any>() {
    override val pageTitle = "Wallet Transfer"
    override val pageSubtitle = "Internal transfer, or customer \u2192 merchant funding"

    private lateinit var vm: FinanceViewModel
    private lateinit var rbInternal: RadioButton
    private lateinit var rbCustToMerchant: RadioButton
    private lateinit var fFrom: EditText
    private lateinit var fTo: EditText
    private lateinit var fAmount: EditText
    private lateinit var fCurrency: EditText
    private lateinit var fRef: EditText
    private lateinit var fProvider: EditText
    private lateinit var fApiKey: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]

        val group = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        rbInternal = RadioButton(this).apply { text = "Internal (wallet \u2192 wallet)"; isChecked = true }
        rbCustToMerchant = RadioButton(this).apply { text = "Customer \u2192 Merchant (card fund)" }
        group.addView(rbInternal)
        group.addView(rbCustToMerchant)
        rootLayout.addView(group, matchWrap().apply { bottomMargin = 12 })

        fFrom = addField("From walletId / customerId / merchantId", InputType.TYPE_CLASS_TEXT, null)
        fTo = addField("To walletCode / merchantId / customerId", InputType.TYPE_CLASS_TEXT, null)
        fAmount = addField("Amount", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL, null)
        fCurrency = addField("Currency (USD, PHP, AED, EUR, GBP)", InputType.TYPE_CLASS_TEXT, "USD")
        fRef = addField("Reference (optional)", InputType.TYPE_CLASS_TEXT, null)
        fProvider = addField("Runtime fund-provider endpoint (optional)", InputType.TYPE_CLASS_TEXT, null)
        fApiKey = addField("Runtime fund-provider API key (optional)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD, null)

        val btns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@WalletTransferActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                text = "Save provider creds"
                setOnClickListener { setRuntimeCreds() }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            })
            addView(Button(this@WalletTransferActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "Transfer"
                setOnClickListener { doTransfer() }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
        }
        rootLayout.addView(btns, matchWrap().apply { topMargin = 12 })

        vm.walletTransferState.observe(this) { state ->
            bindState(state,
                onSuccess = { resp ->
                    AlertDialog.Builder(this)
                        .setTitle("Transfer \u2713 Success")
                        .setMessage(
                            "txnId: ${resp.transactionId ?: "-"}\n" +
                                "ref: ${resp.reference ?: "-"}\n" +
                                "From: ${resp.newFromBalance}\n" +
                                "To: ${resp.newToBalance}"
                        )
                        .setPositiveButton("Done", null)
                        .show()
                }
            )
        }
    }

    private fun addField(lbl: String, type: Int, preset: String?): EditText {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 4, 0, 8)
        }
        wrap.addView(TextView(this).apply {
            text = lbl
            textSize = 12f
            setTextColor(Color.GRAY)
            setPadding(0, 0, 0, 4)
        })
        val et = EditText(this).apply {
            inputType = type
            textSize = 14f
            setPadding(24, 24, 24, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            preset?.let { setText(it) }
        }
        wrap.addView(et, matchWrap())
        rootLayout.addView(wrap, matchWrap())
        return et
    }

    private fun setRuntimeCreds() {
        val ep = fProvider.text?.toString()?.takeIf { it.isNotBlank() } ?: run { toast("Enter endpoint first"); return }
        val k = fApiKey.text?.toString() ?: ""
        vm.setRuntimeCreds(ep, k)
        toast("Runtime creds saved")
    }

    private fun doTransfer() {
        val amount = fAmount.text?.toString()?.toDoubleOrNull() ?: run { toast("Enter amount"); return }
        val currency = fCurrency.text?.toString()?.takeIf { it.isNotBlank() } ?: "USD"
        val from = fFrom.text?.toString()?.takeIf { it.isNotBlank() }
        val to = fTo.text?.toString()?.takeIf { it.isNotBlank() }
        val ref = fRef.text?.toString()
        val endpoint = fProvider.text?.toString()?.takeIf { it.isNotBlank() }
        val apiKey = fApiKey.text?.toString()?.takeIf { it.isNotBlank() }
        vm.transfer(
            fromMerchant = if (rbInternal.isChecked) from else null,
            fromCustomer = if (rbCustToMerchant.isChecked) from else null,
            toMerchant = if (rbCustToMerchant.isChecked) to else null,
            toWalletCode = if (rbInternal.isChecked) to else null,
            amount = amount,
            currency = currency,
            reference = ref,
            endpoint = endpoint,
            apiKey = apiKey
        )
    }

    override fun load() {}
}

// ── Customers ───────────────────────────────────────────────────────────────
class CustomersActivity : BaseListActivity<CustomerDto>() {
    override val pageTitle = "Customers"
    override val pageSubtitle = "Merchant customer directory \u2014 view wallets and create new"

    private lateinit var vm: FinanceViewModel
    private lateinit var fSearch: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]

        val headerWrap = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 12)
            fSearch = EditText(this@CustomersActivity).apply {
                hint = "Search name / email / phone"
                inputType = InputType.TYPE_CLASS_TEXT
                textSize = 14f
                setPadding(24, 26, 24, 26)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            addView(fSearch)
            addView(Button(this@CustomersActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "+ Add"
                setOnClickListener { addCustomer() }
            })
        }
        rootLayout.addView(headerWrap, matchWrap().apply { bottomMargin = 12 })

        vm.customers.observe(this) { state ->
            bindState(state) { list ->
                val q = fSearch.text?.toString()?.lowercase() ?: ""
                val filtered = if (q.isBlank()) list else list.filter { c ->
                    c.name.lowercase().contains(q) ||
                        (c.email?.lowercase()?.contains(q) == true) ||
                        (c.phone?.lowercase()?.contains(q) == true)
                }
                render(filtered, this::row)
            }
        }
    }

    override fun load() { vm.loadCustomers(PosApplication.getMerchantId(this)) }

    private fun row(c: CustomerDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 18, 24, 18)
            addView(TextView(this@CustomersActivity).apply {
                text = c.name
                textSize = 16f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
            })
            c.email?.let { addView(kvRow("Email", it), matchWrap().apply { topMargin = 6 }) }
            c.phone?.let { addView(kvRow("Phone", it), matchWrap()) }
            c.walletCode?.let { addView(kvRow("Wallet", it), matchWrap()) }
            c.status?.let { addView(kvRow("Status", it), matchWrap()) }
            c.createdAt?.let { addView(kvRow("Since", fmtISO(it)), matchWrap()) }

            addView(LinearLayout(this@CustomersActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 0)
                addView(Button(this@CustomersActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Wallets"
                    setOnClickListener {
                        startActivity(Intent(this@CustomersActivity, WalletsActivity::class.java))
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
                })
                addView(Button(this@CustomersActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Top-up"
                    setOnClickListener { topup(c) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }

    private fun addCustomer() {
        val ctx = this
        AlertDialog.Builder(ctx).apply {
            setTitle("Add customer")
            val sv = ScrollView(ctx)
            val vert = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val fName = EditText(ctx).apply {
                hint = "Name *"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fEmail = EditText(ctx).apply {
                hint = "Email"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            }
            val fPhone = EditText(ctx).apply {
                hint = "Phone"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                inputType = InputType.TYPE_CLASS_PHONE
            }
            val fCompany = EditText(ctx).apply {
                hint = "Company"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            vert.addView(fName)
            vert.addView(fEmail)
            vert.addView(fPhone)
            vert.addView(fCompany)
            sv.addView(vert)
            setView(sv)
            setPositiveButton("Create") { _, _ ->
                val nm = fName.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: run { toast("Name required"); return@setPositiveButton }
                vm.createCustomer(nm, fEmail.text?.toString(), fPhone.text?.toString(), fCompany.text?.toString())
                load()
            }
            setNegativeButton("Cancel", null)
            show()
        }
    }

    private fun topup(c: CustomerDto) {
        AlertDialog.Builder(this).apply {
            setTitle("Top-up \u2014 " + c.name)
            val vert = LinearLayout(this@CustomersActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val fA = EditText(this@CustomersActivity).apply {
                hint = "Amount"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fC = EditText(this@CustomersActivity).apply {
                hint = "Currency (USD)"
                inputType = InputType.TYPE_CLASS_TEXT
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setText("USD")
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            vert.addView(fA)
            vert.addView(fC)
            setView(vert)
            setPositiveButton("Top-up") { _, _ ->
                val a = fA.text?.toString()?.toDoubleOrNull() ?: run { toast("Enter amount"); return@setPositiveButton }
                val cur = fC.text?.toString()?.takeIf { it.isNotBlank() } ?: "USD"
                vm.topupCustomer(c.id, c.walletCode, a, cur)
                toast("Top-up requested")
            }
            setNegativeButton("Cancel", null)
            show()
        }
    }
}

// ── Products ───────────────────────────────────────────────────────────────
class ProductsActivity : BaseListActivity<ProductDto>() {
    override val pageTitle = "Products"
    override val pageSubtitle = "Product catalogue with pricing + stock levels"

    private lateinit var vm: FinanceViewModel
    private lateinit var fSearch: EditText
    private lateinit var catChip: TextView
    private var filterCat: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            fSearch = EditText(this@ProductsActivity).apply {
                hint = "Search name / SKU"
                inputType = InputType.TYPE_CLASS_TEXT
                textSize = 14f
                setPadding(24, 26, 24, 26)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            addView(fSearch)
            catChip = chip("ALL", R.color.pos_primary, R.color.pos_on_primary)
            addView(catChip)
        }
        rootLayout.addView(header, matchWrap().apply { bottomMargin = 12 })

        val addBtn = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "+ Add product"
            setOnClickListener { addProduct() }
        }
        rootLayout.addView(addBtn, matchWrap().apply { bottomMargin = 12 })

        vm.products.observe(this) { state ->
            bindState(state) { list ->
                val q = fSearch.text?.toString()?.lowercase() ?: ""
                val filtered = list.filter { p ->
                    (filterCat == null || p.category?.equals(filterCat, true) == true) &&
                        (q.isBlank() ||
                            p.name.lowercase().contains(q) ||
                            (p.sku?.lowercase()?.contains(q) == true) ||
                            (p.barcode?.lowercase()?.contains(q) == true))
                }
                render(filtered, this::row)
            }
        }
    }

    override fun load() { vm.loadProducts(PosApplication.getMerchantId(this)) }

    private fun row(p: ProductDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 16, 22, 16)
            addView(LinearLayout(this@ProductsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@ProductsActivity).apply {
                    text = p.name
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(this@ProductsActivity).apply {
                    text = fmtAmount(p.price, p.currency)
                    textSize = 16f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_primary, theme))
                })
            }, matchWrap())
            p.sku?.let { addView(kvRow("SKU", it), matchWrap().apply { topMargin = 6 }) }
            p.category?.let { addView(kvRow("Category", it), matchWrap()) }
            addView(kvRow("Stock", (p.stockQty ?: 0).toString()), matchWrap())
            p.barcode?.let { addView(kvRow("Barcode", it), matchWrap()) }
            addView(LinearLayout(this@ProductsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 0)
                addView(Button(this@ProductsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Stock adj"
                    setOnClickListener {
                        startActivity(
                            Intent(this@ProductsActivity, InventoryActivity::class.java)
                                .putExtra("productId", p.id)
                        )
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
                })
                addView(Button(this@ProductsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Edit"
                    setOnClickListener { editProduct(p) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }

    private fun addProduct() = productDialog(null)
    private fun editProduct(p: ProductDto) = productDialog(p)

    private fun productDialog(edit: ProductDto?) {
        val ctx = this
        AlertDialog.Builder(ctx).apply {
            setTitle(if (edit == null) "Add product" else "Edit product")
            val vert = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val fName = EditText(ctx).apply {
                hint = "Name *"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.name?.let { setText(it) }
            }
            val fSku = EditText(ctx).apply {
                hint = "SKU"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.sku?.let { setText(it) }
            }
            val fCategory = EditText(ctx).apply {
                hint = "Category"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.category?.let { setText(it) }
            }
            val fPrice = EditText(ctx).apply {
                hint = "Price"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.price?.let { setText(it.toString()) }
            }
            val fStock = EditText(ctx).apply {
                hint = "Stock qty"
                inputType = InputType.TYPE_CLASS_NUMBER
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.stockQty?.let { setText(it.toString()) }
            }
            val fCurrency = EditText(ctx).apply {
                hint = "Currency (USD)"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                setText(edit?.currency ?: "USD")
            }
            val fBarcode = EditText(ctx).apply {
                hint = "Barcode"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
                edit?.barcode?.let { setText(it) }
            }
            vert.addView(fName)
            vert.addView(fSku)
            vert.addView(fCategory)
            vert.addView(fPrice)
            vert.addView(fStock)
            vert.addView(fCurrency)
            vert.addView(fBarcode)
            setView(vert)
            setPositiveButton("Save") { _, _ ->
                val name = fName.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: run { toast("Name required"); return@setPositiveButton }
                val price = fPrice.text?.toString()?.toDoubleOrNull() ?: 0.0
                val stock = fStock.text?.toString()?.toIntOrNull() ?: 0
                vm.upsertProduct(
                    id = edit?.id,
                    name = name,
                    sku = fSku.text?.toString(),
                    category = fCategory.text?.toString(),
                    price = price,
                    stockQty = stock,
                    currency = fCurrency.text?.toString()?.takeIf { it.isNotBlank() } ?: "USD",
                    barcode = fBarcode.text?.toString()
                )
                load()
            }
            setNegativeButton("Cancel", null)
            show()
        }
    }
}

// ── Inventory ───────────────────────────────────────────────────────────────
class InventoryActivity : BaseListActivity<Any>() {
    override val pageTitle = "Inventory"
    override val pageSubtitle = "Stock adjustments per product"

    private lateinit var vm: FinanceViewModel
    private lateinit var fProduct: EditText
    private lateinit var fQty: EditText
    private lateinit var fNote: EditText
    private var presetProductId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]
        presetProductId = intent.getStringExtra("productId")

        fProduct = addField("Product ID or SKU", InputType.TYPE_CLASS_TEXT, presetProductId)
        fQty = addField("Quantity delta (+/-)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_SIGNED, null)
        fNote = addField("Note / reason", InputType.TYPE_CLASS_TEXT, null)

        val btn = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Submit adjustment"
            setOnClickListener {
                val p = fProduct.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: run { toast("Product required"); return@setOnClickListener }
                val q = fQty.text?.toString()?.toIntOrNull()
                    ?: run { toast("Enter qty"); return@setOnClickListener }
                vm.adjustStock(p, q, fNote.text?.toString())
                toast("Adjustment submitted")
            }
        }
        rootLayout.addView(btn, matchWrap().apply { topMargin = 12 })
    }

    private fun addField(lbl: String, type: Int, preset: String?): EditText {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 4, 0, 8)
        }
        wrap.addView(TextView(this).apply {
            text = lbl
            textSize = 12f
            setTextColor(Color.GRAY)
            setPadding(0, 0, 0, 4)
        })
        val et = EditText(this).apply {
            inputType = type
            textSize = 14f
            setPadding(24, 24, 24, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            preset?.let { setText(it) }
        }
        wrap.addView(et, matchWrap())
        rootLayout.addView(wrap, matchWrap())
        return et
    }

    override fun load() {}
}

// ── Terminals ───────────────────────────────────────────────────────────────
class TerminalsActivity : BaseListActivity<TerminalDto>() {
    override val pageTitle = "Terminals"
    override val pageSubtitle = "Register, pair, and monitor terminal fleet status"

    private lateinit var vm: FinanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]
        vm.terminals.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }

        val btns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 12)
            addView(Button(this@TerminalsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                text = "Pair terminal"
                setOnClickListener {
                    startActivity(Intent(this@TerminalsActivity, TerminalPairingActivity::class.java))
                }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            })
            addView(Button(this@TerminalsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "Register new"
                setOnClickListener { registerNew() }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
        }
        rootLayout.addView(btns, matchWrap().apply { bottomMargin = 12 })
    }

    private fun registerNew() {
        val ctx = this
        AlertDialog.Builder(ctx).apply {
            setTitle("Register new terminal")
            val vert = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val fN = EditText(ctx).apply {
                hint = "Terminal name *"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fS = EditText(ctx).apply {
                hint = "Device serial"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            vert.addView(fN)
            vert.addView(fS)
            setView(vert)
            setPositiveButton("Register") { _, _ ->
                val nm = fN.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: run { toast("Name required"); return@setPositiveButton }
                vm.registerTerminal(nm, fS.text?.toString())
                load()
            }
            setNegativeButton("Cancel", null)
            show()
        }
    }

    override fun load() { vm.loadTerminals(PosApplication.getMerchantId(this)) }

    private fun row(t: TerminalDto): View {
        val statusLower = (t.status ?: "").lowercase()
        val statusColor = if (statusLower in setOf("online", "active")) R.color.pos_success_container else R.color.pos_warning_container
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 18, 24, 18)
            addView(LinearLayout(this@TerminalsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@TerminalsActivity).apply {
                    text = t.name ?: "Terminal"
                    textSize = 16f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip(t.status ?: "UNKNOWN", statusColor))
            }, matchWrap())
            t.terminalId?.let { addView(kvRow("Terminal ID", it), matchWrap().apply { topMargin = 6 }) }
            t.id?.let { addView(kvRow("ID", it.takeLast(8)), matchWrap()) }
            t.serial?.let { addView(kvRow("Serial", it), matchWrap()) }
            t.lastSeen?.let { addView(kvRow("Last seen", fmtISO(it)), matchWrap()) }
            t.firmwareVersion?.let { addView(kvRow("Firmware", it), matchWrap()) }
            t.createdAt?.let { addView(kvRow("Registered", fmtISO(it)), matchWrap()) }
            addView(LinearLayout(this@TerminalsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 0)
                addView(Button(this@TerminalsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Transactions"
                    setOnClickListener {
                        startActivity(
                            Intent(this@TerminalsActivity, TransactionsActivity::class.java).apply {
                                putExtra("terminalId", t.terminalId ?: t.id)
                            }
                        )
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }
}

// ── Terminal Pairing ────────────────────────────────────────────────────────
class TerminalPairingActivity : BaseListActivity<Any>() {
    override val pageTitle = "Terminal Pairing"
    override val pageSubtitle = "Pair a terminal with a pairing code"

    private lateinit var vm: FinanceViewModel
    private lateinit var fPairing: EditText
    private lateinit var fTerminalId: EditText
    private lateinit var fMerchantId: EditText
    private lateinit var result: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[FinanceViewModel::class.java]

        fPairing = addField("Pairing code", InputType.TYPE_CLASS_TEXT, null)
        fTerminalId = addField("Terminal ID", InputType.TYPE_CLASS_TEXT, PosApplication.getTerminalId(this))
        fMerchantId = addField("Merchant ID", InputType.TYPE_CLASS_TEXT, PosApplication.getMerchantId(this))

        val btn = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Pair"
            setOnClickListener {
                val pc = fPairing.text?.toString()?.takeIf { it.isNotBlank() }
                    ?: run { toast("Pairing code required"); return@setOnClickListener }
                val tid = fTerminalId.text?.toString() ?: ""
                val mid = fMerchantId.text?.toString() ?: ""
                vm.pairTerminal(pc, tid, mid)
            }
        }
        rootLayout.addView(btn, matchWrap().apply { topMargin = 12; bottomMargin = 16 })

        result = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        rootLayout.addView(card(result), matchWrap())

        vm.pairingState.observe(this) { state ->
            bindState(state,
                onSuccess = { r ->
                    result.removeAllViews()
                    val succ = TextView(this).apply {
                        text = if (r.success == true) "\u2713 Paired successfully" else "\u2717 Pairing failed"
                        setTextColor(
                            if (r.success == true) resources.getColor(R.color.pos_success, theme)
                            else resources.getColor(R.color.pos_error, theme)
                        )
                        textSize = 16f
                        setTypeface(typeface, Typeface.BOLD)
                        setPadding(24, 20, 24, 10)
                    }
                    result.addView(succ)
                    r.message?.let {
                        result.addView(kvRow("Message", it), matchWrap())
                    }
                    r.terminal?.let { t ->
                        result.addView(kvRow("Name", t.name ?: "-"), matchWrap())
                        result.addView(kvRow("TID", t.terminalId ?: "-"), matchWrap())
                        result.addView(kvRow("Status", t.status ?: "-"), matchWrap())
                    }
                }
            )
        }
    }

    private fun addField(lbl: String, type: Int, preset: String?): EditText {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 4, 0, 8)
        }
        wrap.addView(TextView(this).apply {
            text = lbl
            textSize = 12f
            setTextColor(Color.GRAY)
            setPadding(0, 0, 0, 4)
        })
        val et = EditText(this).apply {
            inputType = type
            textSize = 14f
            setPadding(24, 24, 24, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            preset?.let { setText(it) }
        }
        wrap.addView(et, matchWrap())
        rootLayout.addView(wrap, matchWrap())
        return et
    }

    override fun load() {}
}
