package com.pos2013.offline.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.card.AndroidBuiltInNfcReaderManager
import com.pos2013.offline.data.api.*
import com.pos2013.offline.data.model.TransactionEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * LIVE PAYMENT TERMINAL
 * ─────────────────────────────────────────────────────────────────────────
 * Full POS terminal with:
 *  • NFC card tap (auto-fills PAN + expiry)
 *  • Protocol selector: Normal / 101.1 / 101.6 / 201.3
 *  • Real charge via POST /merchant/v1/payments/charge
 *  • Offline queue → syncs to dashboard
 *  • Customer-to-Merchant via POST /wallet/send-to-merchant-wallet
 *  • Settings: backend URL, merchant/terminal ID, secret key, API key
 */
class LivePaymentActivity : AppCompatActivity() {

    // ── Payment mode ──────────────────────────────────────────────────────────
    data class PayMode(val label: String, val protocol: String?, val needsAuth: Boolean, val hint: String)
    private val MODES = listOf(
        PayMode("Normal Card Charge",   null,    false, "No auth code needed"),
        PayMode("101.1 — Voice Auth",   "101.1", true,  "Bank gives verbal approval code"),
        PayMode("101.6 — EMV Chip/Tap", "101.6", false, "Chip/NFC — auth code optional"),
        PayMode("201.3 — Offline Batch","201.3", true,  "Pre-auth code + CVV required")
    )
    private var modeIdx = 0

    // ── State ─────────────────────────────────────────────────────────────────
    private var amountBuf    = StringBuilder("0")
    private var selCcy       = "AED"
    private var selCustId    = ""
    private var selCustName  = ""
    private var customers    = mutableListOf<Pair<String,String>>()
    private var jwtToken     = ""
    private var nfcCardPan   = ""
    private var nfcCardExp   = ""

    // ── Views ─────────────────────────────────────────────────────────────────
    private lateinit var tvAmount:  TextView
    private lateinit var tvOnline:  TextView
    private lateinit var tvCust:    TextView
    private lateinit var tvMode:    TextView
    private lateinit var tvNfc:     TextView
    private lateinit var spinnerCcy: Spinner

    // ── NFC ───────────────────────────────────────────────────────────────────
    private lateinit var nfcMgr: AndroidBuiltInNfcReaderManager

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ─────────────────────────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.statusBarColor = Color.parseColor("#0A1628")
        nfcMgr = AndroidBuiltInNfcReaderManager(this)
        setContentView(buildScreen())
        ensureJwt()
        loadCustomers()
        pingServer()
        observeNfc()
    }

    override fun onResume() {
        super.onResume()
        if (nfcMgr.isAvailable()) nfcMgr.enableReaderMode()
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(com.pos2013.offline.utils.LanguageManager.applyTo(newBase))
    }

    override fun onPause() {
        super.onPause()
        if (nfcMgr.isAvailable()) nfcMgr.disableReaderMode()
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        intent?.let { nfcMgr.handleIntent(it) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OBSERVE NFC
    // ─────────────────────────────────────────────────────────────────────────
    private fun observeNfc() {
        lifecycleScope.launch {
            nfcMgr.readerStatus.collectLatest { status ->
                tvNfc.text = "📡  $status"
            }
        }
        lifecycleScope.launch {
            nfcMgr.cardData.collectLatest { card ->
                card ?: return@collectLatest
                val rawPan = card.pan.replace(Regex("\\s"), "")
                if (rawPan.length >= 4) {
                    nfcCardPan = rawPan
                    nfcCardExp = card.expiryDate.ifBlank { "" }
                    val masked = "****${rawPan.takeLast(4)}"
                    tvNfc.text = "✅  Card read: $masked  Exp: ${nfcCardExp.ifBlank { "?" }}"
                    tvNfc.setTextColor(Color.parseColor("#4ADE80"))
                    toast("Card detected — tap PAY NOW to charge")
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD SCREEN
    // ─────────────────────────────────────────────────────────────────────────
    private fun buildScreen(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0A1628"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT)
        }
        root.addView(buildHeader())

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }

        // Amount + currency
        body.addView(buildAmountCard())
        body.addView(sp(10))

        // Keypad
        body.addView(buildKeypad())
        body.addView(sp(12))

        // NFC status bar
        tvNfc = TextView(this).apply {
            text = if (nfcMgr.isAvailable()) "📡  NFC ready — tap card to auto-fill" else "⚠  NFC not available on this device"
            textSize = 11f
            setTextColor(Color.parseColor("#94A3B8"))
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        body.addView(tvNfc)
        body.addView(sp(10))

        // Protocol selector
        body.addView(buildModeRow())
        body.addView(sp(10))

        // Customer row
        body.addView(buildCustomerRow())
        body.addView(sp(16))

        // PAY NOW
        body.addView(Button(this).apply {
            text = "⚡  PAY NOW"
            textSize = 17f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628"))
            setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(0, dp(20), 0, dp(20)); letterSpacing = 0.12f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { onPayNow() }
        })
        body.addView(sp(10))

        // SEND TO MERCHANT
        body.addView(Button(this).apply {
            text = "🏦  SEND TO MERCHANT WALLET"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37"))
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(0, dp(16), 0, dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener { onSendToMerchant() }
        })

        scroll.addView(body)
        root.addView(scroll)
        return root
    }

    private fun buildHeader(): View {
        val h = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(14), dp(14), dp(14), dp(14))
            gravity = Gravity.CENTER_VERTICAL
        }
        h.addView(TextView(this).apply {
            text = "←"; textSize = 20f; setTextColor(Color.parseColor("#D4AF37"))
            setPadding(0, 0, dp(14), 0); isClickable = true; isFocusable = true
            setOnClickListener { finish() }
        })
        h.addView(TextView(this).apply {
            text = "PRIMESTACK POS"
            textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); letterSpacing = 0.1f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        tvOnline = TextView(this).apply {
            text = "● …"; textSize = 10f; setTextColor(Color.parseColor("#FCD34D"))
            setPadding(0, 0, dp(8), 0)
        }
        h.addView(tvOnline)
        h.addView(TextView(this).apply {
            text = "🌐"; textSize = 18f; setTextColor(Color.parseColor("#94A3B8"))
            setPadding(dp(4), 0, dp(2), 0); isClickable = true; isFocusable = true
            setOnClickListener { showLanguagePicker() }
        })
        h.addView(TextView(this).apply {
            text = "⚙"; textSize = 20f; setTextColor(Color.parseColor("#94A3B8"))
            setPadding(dp(4), 0, 0, 0); isClickable = true; isFocusable = true
            setOnClickListener { startActivity(Intent(this@LivePaymentActivity, SettingsActivity::class.java)) }
        })
        return h
    }

    private fun buildAmountCard(): View {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(16), dp(20), dp(16), dp(16))
        }
        tvAmount = TextView(this).apply {
            text = "0.00"; textSize = 56f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); gravity = Gravity.CENTER
        }
        c.addView(tvAmount)
        val ccyList = listOf("AED","USD","EUR","CHF","GBP","JPY")
        spinnerCcy = Spinner(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        spinnerCcy.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, ccyList)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        spinnerCcy.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(p: AdapterView<*>?) {}
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) { selCcy = ccyList[pos] }
        }
        c.addView(spinnerCcy)
        return c
    }

    private fun buildKeypad(): View {
        val kp = GridLayout(this).apply {
            columnCount = 3
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        listOf("1","2","3","4","5","6","7","8","9","⌫","0",".").forEach { k ->
            kp.addView(Button(this).apply {
                text = k; textSize = 24f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (k == "⌫") Color.parseColor("#F87171") else Color.WHITE)
                setBackgroundColor(Color.parseColor("#111D30"))
                layoutParams = GridLayout.LayoutParams().apply {
                    width = 0; height = dp(64)
                    columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    rowSpec    = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                    setMargins(dp(3), dp(3), dp(3), dp(3))
                }
                setOnClickListener { onKey(k) }
            })
        }
        return kp
    }

    private fun buildModeRow(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(14), dp(10), dp(14), dp(10))
            gravity = Gravity.CENTER_VERTICAL
        }
        tvMode = TextView(this).apply {
            text = "💳  ${MODES[0].label}"
            textSize = 12f; setTextColor(Color.parseColor("#D4AF37"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(tvMode)
        row.addView(Button(this).apply {
            text = "CHANGE"; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628")); setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(dp(10), dp(5), dp(10), dp(5))
            setOnClickListener { showModePicker() }
        })
        return row
    }

    private fun buildCustomerRow(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            gravity = Gravity.CENTER_VERTICAL
        }
        tvCust = TextView(this).apply {
            text = "👤  No customer selected"
            textSize = 13f; setTextColor(Color.parseColor("#8892A4"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(tvCust)
        row.addView(Button(this).apply {
            text = "SELECT"; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628")); setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(dp(8), dp(5), dp(8), dp(5)); setOnClickListener { showCustomerPicker() }
        })
        row.addView(Button(this).apply {
            text = "+ NEW"; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); setBackgroundColor(Color.TRANSPARENT)
            setPadding(dp(6), dp(5), 0, dp(5)); setOnClickListener { showNewCustomerDialog() }
        })
        return row
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KEYPAD + HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private fun onKey(k: String) {
        when (k) {
            "⌫" -> amountBuf = if (amountBuf.length > 1) StringBuilder(amountBuf.dropLast(1)) else StringBuilder("0")
            "."  -> if (!amountBuf.contains('.')) amountBuf.append('.')
            else -> {
                if (amountBuf.toString() == "0") amountBuf = StringBuilder(k)
                else { val dot = amountBuf.indexOf('.'); if (dot >= 0 && amountBuf.length - dot > 2) return; amountBuf.append(k) }
            }
        }
        tvAmount.text = amountBuf.toString()
    }

    private fun resetAmount() { amountBuf = StringBuilder("0"); tvAmount.text = "0.00" }
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun sp(dp: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(dp)) }

    // ─────────────────────────────────────────────────────────────────────────
    // PROTOCOL PICKER
    // ─────────────────────────────────────────────────────────────────────────
    private fun showModePicker() {
        AlertDialog.Builder(this)
            .setTitle("Payment Protocol")
            .setSingleChoiceItems(
                MODES.map { "${it.label}\n${it.hint}" }.toTypedArray(), modeIdx
            ) { dlg, which ->
                modeIdx = which
                tvMode.text = "💳  ${MODES[which].label}"
                dlg.dismiss()
            }
            .setNegativeButton("Cancel", null).show()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PAY NOW
    // ─────────────────────────────────────────────────────────────────────────
    private fun onPayNow() {
        val amount = amountBuf.toString().toDoubleOrNull() ?: 0.0
        if (amount <= 0.009) { toast("Enter an amount first"); return }
        if (selCustId.isBlank()) { toast("Select or create a customer first"); return }
        showCardEntryDialog(amount)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CARD ENTRY DIALOG — pre-filled from NFC if available
    // ─────────────────────────────────────────────────────────────────────────
    private fun showCardEntryDialog(amount: Double) {
        val mode = MODES[modeIdx]
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(20), dp(20), dp(12))
        }

        fun lbl(t: String) = TextView(this).apply {
            text = t; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); letterSpacing = 0.15f
            setPadding(0, 0, 0, dp(4))
        }
        fun fld(hint: String, v: String = "", type: Int = InputType.TYPE_CLASS_TEXT, maxLen: Int = 32) = EditText(this).apply {
            this.hint = hint; setText(v); setHintTextColor(Color.parseColor("#3D4F6A"))
            textSize = 15f; setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(12), dp(11), dp(12), dp(11)); inputType = type
            filters = arrayOf(InputFilter.LengthFilter(maxLen))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }

        // Header
        layout.addView(TextView(this).apply {
            text = "$selCcy ${"%.2f".format(amount)}"
            textSize = 28f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(4))
        })
        layout.addView(TextView(this).apply {
            text = "${mode.label}  ·  $selCustName"
            textSize = 10f; setTextColor(Color.parseColor("#8892A4")); gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(14))
        })

        // NFC badge if card already read
        if (nfcCardPan.isNotBlank()) {
            layout.addView(TextView(this).apply {
                text = "📡  NFC card: ****${nfcCardPan.takeLast(4)}  — fields pre-filled"
                textSize = 10f; setTextColor(Color.parseColor("#4ADE80")); gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor("#0F2E1A"))
                setPadding(dp(8), dp(6), dp(8), dp(6))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(12) }
            })
        }

        // Pre-fill from NFC
        val panValue = if (nfcCardPan.isNotBlank()) nfcCardPan.chunked(4).joinToString(" ") else ""
        val expValue = nfcCardExp

        val etPan = fld("Card Number  •••• •••• •••• ••••", panValue, InputType.TYPE_CLASS_NUMBER, 23)
        val etExp = fld("Expiry  MM/YY", expValue, InputType.TYPE_CLASS_NUMBER, 5)
        val etCvv = fld("CVV${if (mode.protocol == "101.1") " (not required for Voice Auth)" else ""}", "", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD, 4)
        val etAuth = fld(
            if (mode.needsAuth) "Auth Code  (required for ${mode.protocol})" else "Auth Code  (optional)",
            "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS, 20
        )

        // PAN auto-format
        etPan.addTextChangedListener(object : android.text.TextWatcher {
            var e = false
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (e) return; e = true
                val d = s.toString().replace(" ","").filter { it.isDigit() }.take(19)
                val f = d.chunked(4).joinToString(" ")
                if (s.toString() != f) { etPan.setText(f); etPan.setSelection(f.length) }
                e = false
            }
        })
        // Expiry auto-format
        etExp.addTextChangedListener(object : android.text.TextWatcher {
            var e = false
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (e) return; e = true
                val r = s.toString().filter { it.isDigit() }.take(4)
                val f = if (r.length >= 3) "${r.take(2)}/${r.drop(2)}" else r
                if (s.toString() != f) { etExp.setText(f); etExp.setSelection(f.length) }
                e = false
            }
        })

        layout.addView(lbl("CARD NUMBER")); layout.addView(etPan)

        val exRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val exW = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) }
        }
        val cvW = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        exW.addView(lbl("EXPIRY")); exW.addView(etExp)
        cvW.addView(lbl("CVV"));    cvW.addView(etCvv)
        exRow.addView(exW); exRow.addView(cvW)
        layout.addView(exRow)
        layout.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(6)) })
        layout.addView(lbl("AUTH CODE")); layout.addView(etAuth)

        val tvErr = TextView(this).apply {
            text = ""; textSize = 11f; setTextColor(Color.parseColor("#F87171")); gravity = Gravity.CENTER; setPadding(0, dp(4), 0, 0)
        }
        layout.addView(tvErr)

        val dialog = AlertDialog.Builder(this)
            .setTitle(null).setView(layout)
            .setPositiveButton("CHARGE NOW", null)
            .setNegativeButton("Cancel", null).create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.let { btn ->
                btn.setTextColor(Color.parseColor("#D4AF37")); btn.textSize = 13f
                btn.setOnClickListener {
                    val pan  = etPan.text.toString().replace(" ","").trim()
                    val exp  = etExp.text.toString().trim()
                    val cvv  = etCvv.text.toString().trim()
                    val auth = etAuth.text.toString().trim()

                    if (pan.length < 13) { tvErr.text = "❌ Enter a valid card number"; return@setOnClickListener }
                    if (exp.length < 4)  { tvErr.text = "❌ Enter expiry MM/YY"; return@setOnClickListener }
                    // CVV required for all protocols EXCEPT 101.1 (voice auth — bank already verified)
                    if (cvv.isBlank() && mode.protocol != "101.1") {
                        tvErr.text = "❌ Enter CVV"; return@setOnClickListener
                    }
                    if (mode.needsAuth && auth.isBlank()) { tvErr.text = "❌ ${mode.label} requires an auth code"; return@setOnClickListener }

                    tvErr.text = "⏳ Processing…"; tvErr.setTextColor(Color.parseColor("#FCD34D"))
                    btn.isEnabled = false

                    submitPayment(amount, pan, exp, cvv, auth, mode, dialog, btn, tvErr)
                }
            }
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.setTextColor(Color.parseColor("#8892A4"))
        }
        dialog.show()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.decorView?.setBackgroundColor(Color.parseColor("#111D30"))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUBMIT PAYMENT — calls real backend, saves offline on failure
    // ─────────────────────────────────────────────────────────────────────────
    private fun submitPayment(
        amount: Double, pan: String, expiry: String, cvv: String,
        authCode: String, mode: PayMode,
        dialog: AlertDialog, submitBtn: android.widget.Button, tvErr: TextView
    ) {
        val serverUrl  = PosApplication.getServerUrl(this)
        val merchantId = PosApplication.getMerchantId(this)
        val terminalId = PosApplication.getTerminalId(this)
        val amountMinor = (amount * 100).toLong()
        val stan        = "STA${System.currentTimeMillis() % 1000000}"

        lifecycleScope.launch {
            var ok = false; var txnId = ""; var approvalCode = authCode; var errMsg = ""
            val entryMode = if (nfcCardPan.isNotBlank() && pan == nfcCardPan) "CHIP_NFC" else "MANUAL"

            try {
                val api  = ApiClient.createPayment2013Api(serverUrl, jwtToken.ifBlank { null })
                val resp = withContext(Dispatchers.IO) {
                    api.chargeOnline(PosChargeRequest(
                        amountMinor    = amountMinor,
                        currency       = selCcy,
                        merchantId     = merchantId,
                        terminalId     = terminalId,
                        pan            = pan,
                        expiry         = expiry,
                        cvv            = cvv,
                        authCode       = authCode.ifBlank { null },
                        stan           = stan,
                        customerId     = selCustId.ifBlank { null },
                        protocol       = mode.protocol,
                        cardholderName = selCustName.ifBlank { null }
                    ))
                }
                val body = resp.body()
                if (resp.isSuccessful && body?.success == true) {
                    ok = true
                    txnId        = body.paymentIntentId ?: UUID.randomUUID().toString()
                    approvalCode = body.authCode ?: authCode
                } else {
                    val eb = resp.errorBody()?.string() ?: ""
                    errMsg = body?.error ?: body?.reason
                        ?: if (eb.contains("\"error\"")) eb.substringAfter("\"error\":\"").substringBefore("\"")
                           else "HTTP ${resp.code()}: $eb"
                }
            } catch (e: Exception) {
                // Network unavailable — save offline for later sync
                try {
                    val db  = (application as com.pos2013.offline.PosApplication).database
                    val tid = UUID.randomUUID().toString()
                    db.transactionDao().insert(TransactionEntity(
                        id = tid, merchantId = merchantId, terminalId = terminalId,
                        localTxnId = tid, stan = stan, amountMinor = amountMinor,
                        currency = selCcy, panMasked = "****${pan.takeLast(4)}",
                        expiry = expiry, txnType = "SALE",
                        authMode  = if (authCode.isNotBlank()) "PRE_AUTHORIZED" else "OFFLINE_APPROVED",
                        entryMode = entryMode, authCode = authCode.ifBlank { null },
                        txnTimestamp = System.currentTimeMillis(), status = "PENDING"
                    ))
                    ok = true; txnId = tid; approvalCode = authCode
                    errMsg = "Saved offline (no network)"
                } catch (e2: Exception) { errMsg = "Error: ${e2.localizedMessage}" }
            }

            // Clear NFC card after use
            nfcCardPan = ""; nfcCardExp = ""
            tvNfc.text = if (nfcMgr.isAvailable()) "📡  NFC ready — tap card to auto-fill" else "⚠  NFC not available"
            tvNfc.setTextColor(Color.parseColor("#94A3B8"))

            if (ok) {
                dialog.dismiss()
                showApproval(amount, approvalCode, txnId, errMsg.contains("offline"))
                resetAmount()
                // Trigger background sync if online
                lifecycleScope.launch {
                    try {
                        val repo = com.pos2013.offline.data.TransactionRepository(
                            dao = (application as com.pos2013.offline.PosApplication).database.transactionDao(),
                            walletTopupDao = (application as com.pos2013.offline.PosApplication).database.walletTopupDao(),
                            api = ApiClient.createPayment2013Api(PosApplication.getServerUrl(this@LivePaymentActivity), jwtToken.ifBlank { null }),
                            walletsApi = ApiClient.createWalletsApi(PosApplication.getServerUrl(this@LivePaymentActivity), jwtToken.ifBlank { null }),
                            merchantId = PosApplication.getMerchantId(this@LivePaymentActivity),
                            terminalId = PosApplication.getTerminalId(this@LivePaymentActivity)
                        )
                        repo.syncPendingTransactions()
                    } catch (_: Exception) {}
                }
            } else {
                submitBtn.isEnabled = true
                tvErr.text = "❌ $errMsg"
                tvErr.setTextColor(Color.parseColor("#F87171"))
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPROVAL SCREEN
    // ─────────────────────────────────────────────────────────────────────────
    private fun showApproval(amount: Double, authCode: String, txnId: String, offline: Boolean) {
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(if (offline) Color.parseColor("#1A1200") else Color.parseColor("#0A2010"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT)
        }
        overlay.addView(TextView(this).apply { text = if (offline) "💾" else "✅"; textSize = 72f; gravity = Gravity.CENTER })
        overlay.addView(TextView(this).apply {
            text = if (offline) "SAVED OFFLINE" else "APPROVED"
            textSize = 30f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (offline) Color.parseColor("#FCD34D") else Color.parseColor("#4ADE80")); gravity = Gravity.CENTER
        })
        overlay.addView(TextView(this).apply {
            text = "$selCcy ${"%.2f".format(amount)}"
            textSize = 40f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(4))
        })
        overlay.addView(TextView(this).apply {
            text = "Customer: $selCustName"
            textSize = 14f; setTextColor(Color.parseColor("#86EFAC")); gravity = Gravity.CENTER
        })
        overlay.addView(TextView(this).apply {
            text = if (offline) "Will sync to dashboard when online" else "Synced to dashboard ✓"
            textSize = 11f; setTextColor(Color.parseColor("#94A3B8")); gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, 0)
        })
        if (authCode.isNotBlank()) overlay.addView(TextView(this).apply {
            text = "Auth: $authCode"; textSize = 12f; typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#4ADE80")); gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0)
        })
        overlay.addView(TextView(this).apply {
            text = "Ref: ${txnId.take(22)}"; textSize = 10f; typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#5B7FA6")); gravity = Gravity.CENTER
        })
        overlay.addView(Button(this).apply {
            text = "NEW PAYMENT"; textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0A1628")); setBackgroundColor(Color.parseColor("#D4AF37"))
            setPadding(dp(32), dp(16), dp(32), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(32) }
            setOnClickListener { setContentView(buildScreen()); loadCustomers(); pingServer(); observeNfc() }
        })
        setContentView(overlay)
        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinishing) { setContentView(buildScreen()); loadCustomers(); pingServer(); observeNfc() }
        }, 8000)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND TO MERCHANT WALLET (C2M)
    // ─────────────────────────────────────────────────────────────────────────
    private fun onSendToMerchant() {
        val amount = amountBuf.toString().toDoubleOrNull() ?: 0.0
        if (selCustId.isBlank()) { toast("Select a customer first"); return }

        val prefs      = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val serverUrl  = PosApplication.getServerUrl(this)
        val merchantId = PosApplication.getMerchantId(this)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111D30"))
            setPadding(dp(20), dp(20), dp(20), dp(12))
        }
        fun lbl(t: String) = TextView(this).apply {
            text = t; textSize = 9f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#D4AF37")); letterSpacing = 0.15f; setPadding(0, 0, 0, dp(4))
        }
        fun fld(hint: String, v: String = "", pwd: Boolean = false) = EditText(this).apply {
            this.hint = hint; setText(v); setHintTextColor(Color.parseColor("#3D4F6A"))
            textSize = 13f; setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#0D1929"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            inputType = if (pwd) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                        else InputType.TYPE_CLASS_TEXT
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }

        layout.addView(TextView(this).apply {
            text = "From: $selCustName  →  Merchant Wallet"
            textSize = 11f; setTextColor(Color.parseColor("#8892A4")); gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(14))
        })

        val etAmt    = fld("Amount", if (amount > 0) "%.2f".format(amount) else "").also {
            it.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        }
        val etMid    = fld("Merchant ID", merchantId)
        val etApiKey = fld("Provider API Key (optional)", prefs.getString("provider_api_key","") ?: "", pwd = true)
        val etSecret = fld("Provider Secret Key (optional)", prefs.getString("provider_secret","") ?: "", pwd = true)

        layout.addView(lbl("AMOUNT ($selCcy)")); layout.addView(etAmt)
        layout.addView(lbl("MERCHANT ID"));     layout.addView(etMid)
        layout.addView(lbl("API KEY (OPT)"));   layout.addView(etApiKey)
        layout.addView(lbl("SECRET (OPT)"));    layout.addView(etSecret)

        val tvErr = TextView(this).apply {
            text = ""; textSize = 11f; setTextColor(Color.parseColor("#F87171")); gravity = Gravity.CENTER
        }
        layout.addView(tvErr)

        val dialog = AlertDialog.Builder(this)
            .setTitle(null).setView(layout)
            .setPositiveButton("SEND TO MERCHANT", null)
            .setNegativeButton("Cancel", null).create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.let { btn ->
                btn.setTextColor(Color.parseColor("#D4AF37")); btn.textSize = 13f
                btn.setOnClickListener {
                    val sendAmt = etAmt.text.toString().toDoubleOrNull() ?: 0.0
                    val mid     = etMid.text.toString().trim().ifBlank { merchantId }
                    val apiKey  = etApiKey.text.toString().trim()
                    val secret  = etSecret.text.toString().trim()

                    if (sendAmt <= 0) { tvErr.text = "❌ Enter a valid amount"; return@setOnClickListener }
                    tvErr.text = "⏳ Sending…"; tvErr.setTextColor(Color.parseColor("#FCD34D"))
                    btn.isEnabled = false

                    prefs.edit().putString("provider_api_key", apiKey).putString("provider_secret", secret).apply()

                    lifecycleScope.launch {
                        var ok = false; var errMsg = ""
                        try {
                            val api  = ApiClient.createWalletsApi(serverUrl, jwtToken.ifBlank { null })
                            val resp = withContext(Dispatchers.IO) {
                                api.sendFundsToMerchantWallet(SendToMerchantRequest(
                                    customerId        = selCustId,
                                    merchantId        = mid,
                                    amount            = sendAmt,
                                    currency          = selCcy,
                                    providerEndpoint  = serverUrl.ifBlank { null },
                                    providerApiKey    = apiKey.ifBlank { null },
                                    providerSecretKey = secret.ifBlank { null }
                                ))
                            }
                            if (resp.isSuccessful && resp.body()?.success == true) ok = true
                            else {
                                val eb = resp.errorBody()?.string() ?: ""
                                errMsg = resp.body()?.error ?: resp.body()?.message
                                    ?: if (eb.contains("\"error\"")) eb.substringAfter("\"error\":\"").substringBefore("\"")
                                       else "HTTP ${resp.code()}"
                            }
                        } catch (e: Exception) { errMsg = e.localizedMessage ?: "Network error" }

                        btn.isEnabled = true
                        if (ok) {
                            dialog.dismiss()
                            toast("✅ $selCcy ${"%.2f".format(sendAmt)} sent to merchant wallet")
                            resetAmount()
                        } else {
                            tvErr.text = "❌ $errMsg"; tvErr.setTextColor(Color.parseColor("#F87171"))
                        }
                    }
                }
            }
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.setTextColor(Color.parseColor("#8892A4"))
        }
        dialog.show()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.decorView?.setBackgroundColor(Color.parseColor("#111D30"))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CUSTOMER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    private fun loadCustomers() {
        val serverUrl  = PosApplication.getServerUrl(this)
        val merchantId = PosApplication.getMerchantId(this)
        lifecycleScope.launch {
            try {
                val api  = ApiClient.createWalletsApi(serverUrl, jwtToken.ifBlank { null })
                val resp = withContext(Dispatchers.IO) {
                    if (merchantId.isNotBlank()) api.getCustomersByMerchant(merchantId) else api.getCustomers()
                }
                if (resp.isSuccessful) {
                    customers.clear()
                    resp.body()?.forEach { c -> customers.add(Pair(c.id, c.name)) }
                }
            } catch (_: Exception) {}
        }
    }

    private fun showCustomerPicker() {
        if (customers.isEmpty()) { toast("No customers — tap + NEW to create one"); return }
        AlertDialog.Builder(this)
            .setTitle("Select Customer")
            .setItems(customers.map { it.second }.toTypedArray()) { _, i ->
                selCustId = customers[i].first; selCustName = customers[i].second
                tvCust.text = "👤  $selCustName"; tvCust.setTextColor(Color.WHITE)
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showNewCustomerDialog() {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(16), dp(20), dp(8)) }
        val etName  = EditText(this).apply { hint = "Full Name *"; textSize = 15f; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS }
        val etEmail = EditText(this).apply { hint = "Email (optional)"; textSize = 14f; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        val etPhone = EditText(this).apply { hint = "Phone (optional)"; textSize = 14f; inputType = InputType.TYPE_CLASS_PHONE }
        layout.addView(etName); layout.addView(sp(8)); layout.addView(etEmail); layout.addView(sp(8)); layout.addView(etPhone)
        AlertDialog.Builder(this).setTitle("New Customer").setView(layout)
            .setPositiveButton("CREATE") { _, _ ->
                val name = etName.text.toString().trim()
                if (name.isBlank()) { toast("Name required"); return@setPositiveButton }
                createCustomer(name, etEmail.text.toString().trim(), etPhone.text.toString().trim())
            }.setNegativeButton("Cancel", null).show()
    }

    private fun createCustomer(name: String, email: String, phone: String) {
        val serverUrl  = PosApplication.getServerUrl(this)
        val merchantId = PosApplication.getMerchantId(this)
        lifecycleScope.launch {
            try {
                val api  = ApiClient.createWalletsApi(serverUrl, jwtToken.ifBlank { null })
                val resp = withContext(Dispatchers.IO) {
                    api.createCustomer(CreateCustomerRequest(name, email.ifBlank { null }, phone.ifBlank { null }, merchantId.ifBlank { null }))
                }
                if (resp.isSuccessful && resp.body() != null) {
                    val c = resp.body()!!
                    customers.add(0, Pair(c.id, c.name))
                    selCustId = c.id; selCustName = c.name
                    tvCust.text = "👤  ${c.name}  ✅"; tvCust.setTextColor(Color.parseColor("#4ADE80"))
                } else toast("Failed to create customer: HTTP ${resp.code()}")
            } catch (e: Exception) { toast("Error: ${e.localizedMessage}") }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LANGUAGE PICKER
    // ─────────────────────────────────────────────────────────────────────────
    private fun showLanguagePicker() {
        val langs = com.pos2013.offline.utils.LanguageManager.LANGUAGES
        val current = com.pos2013.offline.utils.LanguageManager.get(this)
        val currentIdx = langs.indexOfFirst { it.code == current }.coerceAtLeast(0)
        val items = langs.map { "${it.flag}  ${it.label}" }.toTypedArray()

        android.app.AlertDialog.Builder(this)
            .setTitle("🌐  Select Language")
            .setSingleChoiceItems(items, currentIdx) { dlg, which ->
                val selected = langs[which]
                com.pos2013.offline.utils.LanguageManager.save(this, selected.code)
                dlg.dismiss()
                // Restart activity to apply new language
                val i = Intent(this, LivePaymentActivity::class.java)
                i.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(i)
                finish()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JWT + SERVER HEALTH
    // ─────────────────────────────────────────────────────────────────────────
    private fun ensureJwt() {
        jwtToken = PosApplication.getJwtToken(this) ?: ""
        if (jwtToken.isNotBlank()) return
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            try {
                val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
                val api   = ApiClient.createAuthApi(serverUrl)
                val resp  = withContext(Dispatchers.IO) {
                    api.login(LoginRequest(
                        prefs.getString("admin_username","admin") ?: "admin",
                        prefs.getString("admin_password","admin123") ?: "admin123"
                    ))
                }
                if (resp.isSuccessful) {
                    jwtToken = resp.body()?.token ?: ""
                    PosApplication.saveJwtToken(this@LivePaymentActivity, jwtToken)
                }
            } catch (_: Exception) {}
        }
    }

    private fun pingServer() {
        val serverUrl = PosApplication.getServerUrl(this)
        lifecycleScope.launch {
            while (true) {
                try {
                    val r = withContext(Dispatchers.IO) { ApiClient.createPayment2013Api(serverUrl).health() }
                    tvOnline.text = if (r.isSuccessful) "● LIVE" else "● ${r.code()}"
                    tvOnline.setTextColor(if (r.isSuccessful) Color.parseColor("#4ADE80") else Color.parseColor("#FCD34D"))
                } catch (_: Exception) { tvOnline.text = "● OFFLINE"; tvOnline.setTextColor(Color.parseColor("#F87171")) }
                kotlinx.coroutines.delay(20_000)
            }
        }
    }
}
