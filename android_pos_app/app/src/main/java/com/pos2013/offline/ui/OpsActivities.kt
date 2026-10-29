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
import androidx.lifecycle.ViewModelProvider
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.data.api.BatchDto
import com.pos2013.offline.data.api.SettlementDto
import com.pos2013.offline.data.api.TransactionDto
import com.pos2013.offline.viewmodel.OperationsViewModel

// ── Batches ──────────────────────────────────────────────────────────────────
class BatchesActivity : BaseListActivity<BatchDto>() {

    override val pageTitle = "Batches"
    override val pageSubtitle = "Open / closed / settlement-pending merchant batches"

    private lateinit var vm: OperationsViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[OperationsViewModel::class.java]
        vm.batches.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
        vm.closeBatchState.observe(this) { state ->
            bindState(state,
                onSuccess = { toast("Batch closed. Settlement: ${it.settlementCode ?: it.settlementId ?: "-"}"); load() }
            )
        }
    }

    override fun load() { vm.loadBatches(PosApplication.getMerchantId(this)) }

    private fun row(b: BatchDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            addView(LinearLayout(this@BatchesActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@BatchesActivity).apply {
                    text = b.batchCode ?: ("#" + b.id.orEmpty().takeLast(6))
                    textSize = 16f; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(b.status))
            }, matchWrap())

            addView(LinearLayout(this@BatchesActivity).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, 10, 0, 0)
                addView(TextView(this@BatchesActivity).apply {
                    text = "${b.transactionCount} txns"
                    textSize = 13f; setTextColor(Color.GRAY)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(this@BatchesActivity).apply {
                    text = fmtAmount(b.totalAmount, b.currency)
                    textSize = 16f; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                })
            }, matchWrap())

            addView(kvRow("Net", fmtAmount(b.netAmount, b.currency)), matchWrap().apply { topMargin = 8 })
            addView(kvRow("Fees", fmtAmount(b.feeAmount, b.currency)), matchWrap())
            b.createdAt?.let { addView(kvRow("Opened", fmtISO(it)), matchWrap()) }
            b.closedAt?.let { addView(kvRow("Closed", fmtISO(it)), matchWrap()) }
            b.settlementId?.let { addView(kvRow("Settlement", it.orEmpty().takeLast(8)), matchWrap()) }

            addView(LinearLayout(this@BatchesActivity).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, 14, 0, 0)
                addView(Button(this@BatchesActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "View txns"
                    setOnClickListener {
                        startActivity(Intent(this@BatchesActivity, TransactionsActivity::class.java).apply {
                            putExtra("batchId", b.id)
                        })
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
                })
                addView(Button(this@BatchesActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Close"
                    isEnabled = (b.status ?: "open").equals("open", true)
                    setOnClickListener { vm.closeBatch(b.id, force = false) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }
}

// ── Settlements ──────────────────────────────────────────────────────────────
class SettlementsActivity : BaseListActivity<SettlementDto>() {
    override val pageTitle = "Settlements"
    override val pageSubtitle = "Net settlement runs, funding status, fees breakdown"

    private lateinit var vm: OperationsViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[OperationsViewModel::class.java]
        vm.settlements.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() { vm.loadSettlements(PosApplication.getMerchantId(this)) }

    private fun row(s: SettlementDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24, 20, 24, 20)
            addView(LinearLayout(this@SettlementsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@SettlementsActivity).apply {
                    text = "REF ${(s.settlementCode ?: s.id).orEmpty().takeLast(8)}"
                    textSize = 14f; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(s.status))
            }, matchWrap())

            val vert = LinearLayout(this@SettlementsActivity).apply {
                orientation = LinearLayout.VERTICAL; setPadding(0, 12, 0, 0)
                addView(kvRow("Gross", fmtAmount(s.grossAmount, s.currency)))
                addView(kvRow("Fees", fmtAmount(s.feeAmount, s.currency)))
                addView(kvRow("Net", fmtAmount(s.netAmount, s.currency)))
                s.interchange?.let { addView(kvRow("Interchange", fmtAmount(it, s.currency))) }
                s.schemeFee?.let { addView(kvRow("Scheme fee", fmtAmount(it, s.currency))) }
                s.createdAt?.let { addView(kvRow("Date", fmtISO(it))) }
                s.fundedAt?.let { addView(kvRow("Funded", fmtISO(it))) }
                s.transactionCount?.let { addView(kvRow("Txns", it.toString())) }
                s.batchId?.let { addView(kvRow("Batch", it.orEmpty().takeLast(8))) }
                s.processorReference?.let { addView(kvRow("Proc ref", it.orEmpty().takeLast(10))) }
                s.reference?.let { addView(kvRow("Ref", it.orEmpty().takeLast(10))) }
            }
            addView(vert, matchWrap())
        }
        return card(wrap)
    }
}

// ── Transactions ─────────────────────────────────────────────────────────────
class TransactionsActivity : BaseListActivity<TransactionDto>() {
    override val pageTitle = "Transactions"
    override val pageSubtitle = "Full transaction ledger \u2014 filter by terminal, status, protocol"

    private lateinit var vm: OperationsViewModel
    private var batchId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        batchId = intent.getStringExtra("batchId")
        vm = ViewModelProvider(this)[OperationsViewModel::class.java]
        vm.transactions.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() { vm.loadTransactions(PosApplication.getMerchantId(this), batchId = batchId) }

    private fun row(t: TransactionDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24, 20, 24, 20)
            addView(LinearLayout(this@TransactionsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@TransactionsActivity).apply {
                    text = t.panMasked ?: (t.brand ?: "CARD")
                    textSize = 14f; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(t.status))
            }, matchWrap())

            addView(LinearLayout(this@TransactionsActivity).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, 8, 0, 0)
                addView(TextView(this@TransactionsActivity).apply {
                    text = fmtAmountMinor(t.amountMinor, t.currency)
                    textSize = 18f; setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                t.protocol?.let { addView(chip(it.uppercase(), R.color.pos_violet_container, R.color.pos_primary)) }
            }, matchWrap())

            t.entryMode?.let { addView(kvRow("Entry", it), matchWrap().apply { topMargin = 6 }) }
            t.stan?.let { addView(kvRow("STAN", it), matchWrap()) }
            t.rrn?.let { addView(kvRow("RRN", it.orEmpty().takeLast(12)), matchWrap()) }
            t.approvalCode?.let { addView(kvRow("Approval", it), matchWrap()) }
            t.authCode?.let { addView(kvRow("Auth", it), matchWrap()) }
            t.authRef?.let { addView(kvRow("AuthRef", it.orEmpty().takeLast(10)), matchWrap()) }
            t.capturedAt?.let { addView(kvRow("Captured", fmtISO(it)), matchWrap()) }
            t.createdAt?.let { addView(kvRow("Created", fmtISO(it)), matchWrap()) }
            t.settlementId?.let { addView(kvRow("Settlement", it.orEmpty().takeLast(8)), matchWrap()) }
            t.batchId?.let { addView(kvRow("Batch", it.orEmpty().takeLast(8)), matchWrap()) }
            t.responseCode?.let { addView(kvRow("Response", it), matchWrap()) }
            t.errorMessage?.let {
                addView(TextView(this@TransactionsActivity).apply {
                    text = "Err: $it"; textSize = 12f; setTextColor(Color.RED)
                    setPadding(0, 6, 0, 0)
                }, matchWrap())
            }

            addView(LinearLayout(this@TransactionsActivity).apply {
                orientation = LinearLayout.HORIZONTAL; setPadding(0, 14, 0, 0)
                addView(Button(this@TransactionsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Receipt"
                    setOnClickListener {
                        startActivity(Intent(this@TransactionsActivity, ReceiptsActivity::class.java).apply {
                            putExtra("transactionId", t.id)
                        })
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
                })
                addView(Button(this@TransactionsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Verify"
                    setOnClickListener {
                        startActivity(Intent(this@TransactionsActivity, VerifyTransactionActivity::class.java).apply {
                            putExtra("transactionId", t.id)
                            putExtra("approvalCode", t.approvalCode)
                            putExtra("stan", t.stan)
                            putExtra("rrn", t.rrn)
                        })
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        return card(wrap)
    }
}

// ── Verify Transaction ───────────────────────────────────────────────────────
class VerifyTransactionActivity : BaseListActivity<Any>() {
    override val pageTitle = "Verify Transaction"
    override val pageSubtitle = "Look up an approved charge by approval code, STAN, or RRN"

    private lateinit var vm: OperationsViewModel
    private lateinit var fApproval: EditText
    private lateinit var fStan: EditText
    private lateinit var fRrn: EditText
    private lateinit var fTxnId: EditText
    private lateinit var resultCard: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[OperationsViewModel::class.java]

        fApproval = addField("Approval code", InputType.TYPE_CLASS_TEXT, intent.getStringExtra("approvalCode"))
        fStan = addField("STAN (6-digit)", InputType.TYPE_CLASS_NUMBER, intent.getStringExtra("stan"))
        fRrn = addField("RRN", InputType.TYPE_CLASS_TEXT, intent.getStringExtra("rrn"))
        fTxnId = addField("Transaction ID", InputType.TYPE_CLASS_TEXT, intent.getStringExtra("transactionId"))

        val btns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@VerifyTransactionActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                text = "Clear"; setOnClickListener { fApproval.setText(""); fStan.setText(""); fRrn.setText(""); fTxnId.setText("") }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            })
            addView(Button(this@VerifyTransactionActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "Verify"; setOnClickListener {
                    vm.verifyTransaction(
                        approvalCode = fApproval.text?.toString()?.takeIf { it.isNotBlank() },
                        stan = fStan.text?.toString()?.takeIf { it.isNotBlank() },
                        rrn = fRrn.text?.toString()?.takeIf { it.isNotBlank() },
                        transactionId = fTxnId.text?.toString()?.takeIf { it.isNotBlank() }
                    )
                }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
        }
        rootLayout.addView(btns, matchWrap().apply { topMargin = 12; bottomMargin = 20 })

        resultCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24, 20, 24, 20)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        val cv = card(resultCard)
        cv.radius = 18f
        rootLayout.addView(cv, matchWrap())

        vm.verifyState.observe(this) { state ->
            bindState(state,
                onSuccess = { resp ->
                    resultCard.removeAllViews()
                    if (resp.found) {
                        val t = resp.transaction
                        resultCard.addView(TextView(this@VerifyTransactionActivity).apply {
                            text = if (resp.approved == true) "\u2713 APPROVED" else "\u25cf FOUND"
                            textSize = 16f; setTypeface(typeface, Typeface.BOLD)
                            setTextColor(if (resp.approved == true) resources.getColor(R.color.pos_success, theme) else resources.getColor(R.color.pos_primary, theme))
                        })
                        t?.let { tx ->
                            resultCard.addView(LinearLayout(this@VerifyTransactionActivity).apply {
                                orientation = LinearLayout.VERTICAL; setPadding(0, 12, 0, 0)
                                addView(kvRow("Amount", fmtAmountMinor(tx.amountMinor, tx.currency)))
                                tx.panMasked?.let { addView(kvRow("Card", it)) }
                                tx.approvalCode?.let { addView(kvRow("Approval", it)) }
                                tx.stan?.let { addView(kvRow("STAN", it)) }
                                tx.rrn?.let { addView(kvRow("RRN", it.orEmpty().takeLast(12))) }
                                tx.status?.let { addView(kvRow("Status", it)) }
                                tx.capturedAt?.let { addView(kvRow("Captured", fmtISO(it))) }
                            })
                        }
                        resp.message?.let { toast(it) }
                    } else {
                        resultCard.addView(TextView(this@VerifyTransactionActivity).apply {
                            text = "\u2717 Not found"
                            textSize = 18f; setTypeface(typeface, Typeface.BOLD)
                            setTextColor(resources.getColor(R.color.pos_error, theme))
                        })
                        resp.message?.let { m ->
                            resultCard.addView(TextView(this@VerifyTransactionActivity).apply {
                                text = m; textSize = 13f; setPadding(0, 8, 0, 0); setTextColor(Color.GRAY)
                            })
                        }
                    }
                },
                onError = { msg -> toast(msg) }
            )
        }
    }

    override fun load() {}

    private fun addField(label: String, type: Int, preset: String?): EditText {
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 4, 0, 4) }
        wrap.addView(TextView(this).apply { text = label; textSize = 12f; setTextColor(Color.GRAY); setPadding(0, 0, 0, 4) })
        val et = EditText(this).apply {
            inputType = type; textSize = 14f
            setPadding(24, 28, 24, 28)
            setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            background = android.content.res.Resources.getSystem().getDrawable(android.R.drawable.edit_text)
            preset?.let { setText(it) }
        }
        wrap.addView(et, matchWrap())
        rootLayout.addView(wrap, matchWrap())
        return et
    }
}
