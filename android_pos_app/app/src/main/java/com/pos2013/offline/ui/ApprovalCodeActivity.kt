package com.pos2013.offline.ui

import android.content.Intent
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
import com.pos2013.offline.data.TransactionRepository
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.PosChargeRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * PAGE 4 — APPROVAL CODE SELECTION
 * Lets the cashier choose the protocol: 101.1, 101.6, or 201.3.
 * Also shows card entry fields (PAN, Expiry, CVV).
 * On CONFIRM APPROVAL CODE → executes transaction.
 *   Success → Page 5 (Customer Wallet)
 *   Failure → back to Page 3 (Dashboard)
 */
class ApprovalCodeActivity : AppCompatActivity() {

    companion object {
        const val RESULT_TXN_ID   = "txn_id"
        const val RESULT_AUTH_CODE = "auth_code"
    }

    private var selectedProtocol = "201.3"
    private var amount   = 0.0
    private var currency = "AED"
    private var customerId   = ""
    private var customerName = ""
    private var paymentMethod = ""

    private lateinit var tvProtocolInfo: TextView
    private lateinit var etPan: android.widget.EditText
    private lateinit var etExpiry: android.widget.EditText
    private lateinit var etCvv: android.widget.EditText
    private lateinit var etAuthCode: android.widget.EditText
    private lateinit var tvStatus: TextView

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")

        amount       = intent.getDoubleExtra(POSDashboardActivity.EXTRA_AMOUNT, 0.0)
        currency     = intent.getStringExtra(POSDashboardActivity.EXTRA_CURRENCY) ?: "AED"
        customerId   = intent.getStringExtra(POSDashboardActivity.EXTRA_CUSTOMER) ?: ""
        customerName = intent.getStringExtra(POSDashboardActivity.EXTRA_CUST_NAME) ?: ""
        paymentMethod = intent.getStringExtra(POSDashboardActivity.EXTRA_METHOD) ?: ""

        setContentView(buildUI())
    }

    private fun buildUI(): View {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0A1628")); isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(0), dp(24), dp(32))
        }

        // ── Top bar ───────────────────────────────────────────────────────────
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(14), 0, dp(14)); gravity = Gravity.CENTER_VERTICAL
        }
        topBar.addView(TextView(this).apply {
            text = "←"; textSize = 22f; setTextColor(Color.parseColor("#D4AF37"))
            setPadding(0, 0, dp(16), 0); isClickable = true; isFocusable = true
            setOnClickListener { finish() }
        })
        topBar.addView(TextView(this).apply {
            text = "APPROVAL CODE"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); letterSpacing = 0.18f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        root.addView(topBar)

        // ── Amount summary ────────────────────────────────────────────────────
        val amtSummary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(18), dp(20), dp(18))
            gravity = Gravity.CENTER; elevation = dp(4).toFloat()
        }
        amtSummary.addView(TextView(this).apply {
            text = "$currency ${"%.2f".format(amount)}"
            textSize = 36f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); gravity = Gravity.CENTER
        })
        if (customerName.isNotBlank()) amtSummary.addView(TextView(this).apply {
            text = "Customer: $customerName"
            textSize = 12f; setTextColor(Color.parseColor("#8892A4")); gravity = Gravity.CENTER
        })
        root.addView(amtSummary); root.addView(sp(20))

        // ── Protocol selector ─────────────────────────────────────────────────
        root.addView(label("SELECT PROTOCOL"))
        root.addView(sp(10))

        val protocols = listOf(
            Triple("101.1", "Voice Auth",     "Bank gives verbal approval code. Any 4-6 digit code accepted."),
            Triple("101.6", "EMV Online",     "Chip card online authorization. CVV optional."),
            Triple("201.3", "Offline Batch",  "Pre-auth code + CVV. Stored offline, synced later.")
        )

        val radioGroup = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
        }
        protocols.forEach { (proto, name, desc) ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#111D30"))
                setPadding(dp(16), dp(14), dp(16), dp(14))
                elevation = dp(2).toFloat()
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(8) }
            }
            val rb = RadioButton(this).apply {
                text = "$proto  —  $name"
                textSize = 13f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
                buttonTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#D4AF37"))
                id = proto.replace(".", "").toInt()
                isChecked = proto == selectedProtocol
            }
            val tvDesc = TextView(this).apply {
                text = desc; textSize = 10f
                setTextColor(Color.parseColor("#5B7FA6"))
                setPadding(dp(28), dp(4), 0, 0)
            }
            row.addView(rb); row.addView(tvDesc)
            radioGroup.addView(row)
        }
        radioGroup.setOnCheckedChangeListener { _, id ->
            selectedProtocol = when (id) {
                1011 -> "101.1"
                1016 -> "101.6"
                else -> "201.3"
            }
            updateProtocolInfo()
        }
        root.addView(radioGroup); root.addView(sp(20))

        // ── Protocol info box ─────────────────────────────────────────────────
        tvProtocolInfo = TextView(this).apply {
            textSize = 11f; setTextColor(Color.parseColor("#8892A4"))
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        updateProtocolInfo()
        root.addView(tvProtocolInfo); root.addView(sp(20))

        // ── Card fields ───────────────────────────────────────────────────────
        root.addView(label("CARD DETAILS"))
        root.addView(sp(10))

        val cardCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(18), dp(18), dp(18), dp(18))
            elevation = dp(4).toFloat()
        }

        etPan = editField("Card Number  •••• •••• •••• ••••")
        etPan.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        etPan.filters = arrayOf(android.text.InputFilter.LengthFilter(23))
        etPan.addTextChangedListener(object : android.text.TextWatcher {
            var editing = false
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing) return; editing = true
                val d = s.toString().replace(" ","").filter { it.isDigit() }.take(19)
                val f = d.chunked(4).joinToString(" ")
                if (s.toString() != f) { etPan.setText(f); etPan.setSelection(f.length) }
                editing = false
            }
        })

        etExpiry = editField("Expiry  MM/YY")
        etExpiry.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        etExpiry.filters = arrayOf(android.text.InputFilter.LengthFilter(5))
        etExpiry.addTextChangedListener(object : android.text.TextWatcher {
            var editing = false
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (editing) return; editing = true
                val r = s.toString().filter { it.isDigit() }.take(4)
                val f = if (r.length >= 3) "${r.take(2)}/${r.drop(2)}" else r
                if (s.toString() != f) { etExpiry.setText(f); etExpiry.setSelection(f.length) }
                editing = false
            }
        })

        etCvv = editField("CVV / Security Code")
        etCvv.inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        etCvv.filters = arrayOf(android.text.InputFilter.LengthFilter(4))

        etAuthCode = editField("Approval / Auth Code (required for 101.x)")
        etAuthCode.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS

        val expiryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val expiryWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(8) }
        }
        val cvvWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        expiryWrap.addView(miniLabel("EXPIRY")); expiryWrap.addView(etExpiry)
        cvvWrap.addView(miniLabel("CVV"));       cvvWrap.addView(etCvv)
        expiryRow.addView(expiryWrap); expiryRow.addView(cvvWrap)

        cardCard.addView(miniLabel("CARD NUMBER")); cardCard.addView(etPan); cardCard.addView(sp(12))
        cardCard.addView(expiryRow); cardCard.addView(sp(12))
        cardCard.addView(miniLabel("AUTH CODE")); cardCard.addView(etAuthCode)
        root.addView(cardCard); root.addView(sp(20))

        // ── Status ────────────────────────────────────────────────────────────
        tvStatus = TextView(this).apply {
            text = ""; textSize = 12f; gravity = Gravity.CENTER
        }
        root.addView(tvStatus); root.addView(sp(8))

        // ── Confirm button ────────────────────────────────────────────────────
        val btnConfirm = Button(this).apply {
            text = "CONFIRM APPROVAL CODE"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628"))
            setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(0, dp(18), 0, dp(18)); letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { onConfirm(this) }
        }
        root.addView(btnConfirm)

        scroll.addView(root)
        return scroll
    }

    private fun updateProtocolInfo() {
        tvProtocolInfo.text = when (selectedProtocol) {
            "101.1" -> "📞 Voice Auth — Call your bank, provide amount & card details. Bank gives verbal approval code. Enter it in the Auth Code field above."
            "101.6" -> "💳 EMV Online — Chip card inserted/tapped. System sends authorization to acquirer in real-time. CVV optional."
            else    -> "📦 201.3 Offline Batch — Enter pre-authorized code + CVV. Transaction stored locally and uploaded in next sync batch."
        }
    }

    private fun onConfirm(btn: Button) {
        val pan    = etPan.text.toString().replace(" ", "").trim()
        val expiry = etExpiry.text.toString().trim()
        val cvv    = etCvv.text.toString().trim()
        val auth   = etAuthCode.text.toString().trim()

        if (pan.length < 13) { tvStatus.text = "❌ Enter a valid card number"; tvStatus.setTextColor(Color.parseColor("#F87171")); return }
        if (expiry.length < 4) { tvStatus.text = "❌ Enter expiry (MM/YY)"; tvStatus.setTextColor(Color.parseColor("#F87171")); return }
        if (selectedProtocol == "201.3" && cvv.isBlank()) { tvStatus.text = "❌ CVV is required for 201.3"; tvStatus.setTextColor(Color.parseColor("#F87171")); return }
        if ((selectedProtocol == "101.1" || selectedProtocol == "101.6") && auth.isBlank()) {
            tvStatus.text = "❌ Approval code required for ${selectedProtocol}"; tvStatus.setTextColor(Color.parseColor("#F87171")); return
        }

        tvStatus.text = "⏳ Processing transaction…"
        tvStatus.setTextColor(Color.parseColor("#FCD34D"))
        btn.isEnabled = false

        val serverUrl  = PosApplication.getServerUrl(this)
        val jwtToken   = PosApplication.getJwtToken(this)
        val merchantId = PosApplication.getMerchantId(this)
        val terminalId = PosApplication.getTerminalId(this)
        val amountMinor = (amount * 100).toLong()
        val stan = "STA${System.currentTimeMillis() % 1000000}"

        lifecycleScope.launch {
            var success = false; var txnId = ""; var authCode = auth; var errMsg = ""
            try {
                val api = ApiClient.createPayment2013Api(serverUrl, jwtToken)
                val resp = withContext(Dispatchers.IO) {
                    api.chargeOnline(
                        PosChargeRequest(
                            amountMinor   = amountMinor,
                            currency      = currency,
                            merchantId    = merchantId,
                            terminalId    = terminalId,
                            pan           = pan,
                            expiry        = expiry,
                            cvv           = cvv.ifBlank { null },
                            authCode      = auth.ifBlank { null },
                            stan          = stan,
                            customerId    = customerId.ifBlank { null },   // ← real wallet credit
                            protocol      = selectedProtocol,              // ← 101.1 / 101.6 / 201.3
                            cardholderName = customerName.ifBlank { null }
                        )
                    )
                }
                val body = resp.body()
                if (resp.isSuccessful && body?.success == true) {
                    success  = true
                    txnId    = body.paymentIntentId ?: UUID.randomUUID().toString()
                    authCode = body.authCode ?: auth
                } else {
                    errMsg = body?.error ?: body?.reason ?: "HTTP ${resp.code()}"
                }
            } catch (e: Exception) {
                // Offline fallback — save to Room
                try {
                    val db  = (application as com.pos2013.offline.PosApplication).database
                    val tid = UUID.randomUUID().toString()
                    db.transactionDao().insert(
                        com.pos2013.offline.data.model.TransactionEntity(
                            id = tid, merchantId = merchantId, terminalId = terminalId,
                            localTxnId = tid, stan = stan,
                            amountMinor = amountMinor, currency = currency,
                            panMasked = "****${pan.takeLast(4)}",
                            expiry = expiry, txnType = "SALE",
                            authMode = "OFFLINE_APPROVED",
                            entryMode = "MANUAL",
                            authCode = auth.ifBlank { null },
                            txnTimestamp = System.currentTimeMillis(),
                            status = "PENDING"
                        )
                    )
                    success = true; txnId = tid
                    authCode = auth
                } catch (e2: Exception) {
                    errMsg = "Offline save failed: ${e2.localizedMessage}"
                }
            }

            btn.isEnabled = true
            if (success) {
                tvStatus.text = "✅ APPROVED  Code: $authCode"
                tvStatus.setTextColor(Color.parseColor("#4ADE80"))
                android.os.Handler(mainLooper).postDelayed({
                    val i = Intent(this@ApprovalCodeActivity, CustomerWalletActivity::class.java).apply {
                        putExtra(CustomerWalletActivity.EXTRA_CUSTOMER_ID, customerId)
                        putExtra(CustomerWalletActivity.EXTRA_TXN_ID,      txnId)
                        putExtra(CustomerWalletActivity.EXTRA_AUTH_CODE,   authCode)
                        putExtra(CustomerWalletActivity.EXTRA_AMOUNT,      amount)
                        putExtra(CustomerWalletActivity.EXTRA_CURRENCY,    currency)
                    }
                    startActivity(i)
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                }, 700)
            } else {
                tvStatus.text = "❌ DECLINED: $errMsg"
                tvStatus.setTextColor(Color.parseColor("#F87171"))
                android.os.Handler(mainLooper).postDelayed({ finish() }, 2500)
            }
        }
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#5B7FA6")); letterSpacing = 0.18f
    }
    private fun miniLabel(text: String) = TextView(this).apply {
        this.text = text; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.parseColor("#5B7FA6")); letterSpacing = 0.12f
        setPadding(0, 0, 0, dp(4))
    }
    private fun editField(hint: String) = android.widget.EditText(this).apply {
        this.hint = hint; setHintTextColor(Color.parseColor("#3D4F6A"))
        textSize = 14f; setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#0D1929"))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    private fun sp(dp: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(dp))
    }
}
