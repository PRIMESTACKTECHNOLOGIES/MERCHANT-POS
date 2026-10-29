package com.pos2013.offline.ui

import android.content.ClipData
import android.content.ClipboardManager
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
import androidx.cardview.widget.CardView
import androidx.lifecycle.ViewModelProvider
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.data.api.*
import com.pos2013.offline.utils.Formatters
import com.pos2013.offline.utils.ReceiptThermal
import com.pos2013.offline.viewmodel.GovernanceViewModel
import com.pos2013.offline.viewmodel.ReportRunDto
import com.pos2013.offline.viewmodel.AuditEventDto
import com.pos2013.offline.viewmodel.ReconDto

// ── Hot Wallet ───────────────────────────────────────────────────────────────
class HotWalletActivity : BaseListActivity<HotWalletDto>() {
    override val pageTitle = "Hot Wallet"
    override val pageSubtitle = "Live external-funded hot wallets per asset/chain"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.hotWallets.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() {
        vm.loadHotWallets()
    }

    private fun row(h: HotWalletDto): View {
        val bg = when (h.chain?.uppercase()) {
            "BTC" -> R.color.pos_gold_container
            "ETH", "BASE", "ARB" -> R.color.pos_primary_container
            "SOL" -> R.color.pos_violet_container
            "USDT", "USDC" -> R.color.pos_success_container
            else -> R.color.pos_info_container
        }
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            addView(LinearLayout(this@HotWalletActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@HotWalletActivity).apply {
                    text = (h.asset ?: "ASSET") + " / " + (h.chain ?: "CHAIN")
                    textSize = 16f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip(h.id.orEmpty().takeLast(6), bg))
            }, matchWrap())

            addView(kvRow("Address", (h.address ?: "-")), matchWrap().apply { topMargin = 8 })
            addView(kvRow("Balance", Formatters.formatAmount(h.balance ?: 0.0, h.asset ?: "USD")), matchWrap())
            h.balanceUsd?.let { addView(kvRow("Value USD", Formatters.formatAmount(it, "USD")), matchWrap()) }
            h.frozen?.let { addView(kvRow("Frozen", if (it) "YES" else "NO"), matchWrap()) }
            h.lastSyncAt?.let { addView(kvRow("Synced", fmtISO(it)), matchWrap()) }
        }
        return card(wrap)
    }
}

// ── Crypto Wallets ─────────────────────────────────────────────────────────
class CryptoWalletsActivity : BaseListActivity<CryptoWalletDto>() {
    override val pageTitle = "Crypto Wallets"
    override val pageSubtitle = "Merchant and customer custodial crypto wallets"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.cryptoWallets.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() {
        vm.loadCryptoWallets()
    }

    private fun row(c: CryptoWalletDto): View {
        val bg = when (c.chain?.uppercase()) {
            "BTC" -> R.color.pos_gold_container
            "ETH", "BASE", "ARB" -> R.color.pos_primary_container
            "SOL" -> R.color.pos_violet_container
            "USDT", "USDC" -> R.color.pos_success_container
            else -> R.color.pos_info_container
        }
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
            addView(LinearLayout(this@CryptoWalletsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@CryptoWalletsActivity).apply {
                    text = (c.asset ?: "ASSET") + " \u2014 " + (c.ownerType?.uppercase() ?: "OWNER")
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip(c.chain ?: "CHAIN", bg))
            }, matchWrap())

            c.ownerId?.let { addView(kvRow("Owner", it.orEmpty().takeLast(10)), matchWrap().apply { topMargin = 6 }) }
            addView(kvRow("Address", c.address ?: "-"), matchWrap())
            addView(kvRow("Balance", Formatters.formatAmount(c.balance ?: 0.0, c.asset ?: "USD")), matchWrap())
            c.balanceUsd?.let { addView(kvRow("Value USD", Formatters.formatAmount(it, "USD")), matchWrap()) }
        }
        return card(wrap)
    }
}

// ── Payouts ─────────────────────────────────────────────────────────────────
class PayoutsActivity : BaseListActivity<PayoutDto>() {
    override val pageTitle = "Payouts"
    override val pageSubtitle = "Bank transfers, SWIFT MT103, and crypto disbursements"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.payouts.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }

        val btns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 12)
            addView(Button(this@PayoutsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "+ New payout"
                setOnClickListener { payoutDialog() }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            })
        }
        rootLayout.addView(btns, matchWrap().apply { bottomMargin = 12 })
    }

    override fun load() {
        vm.loadPayouts(PosApplication.getMerchantId(this))
    }

    private fun payoutDialog() {
        val ctx = this
        AlertDialog.Builder(ctx).apply {
            setTitle("Create payout")
            val vert = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            val fMerchant = EditText(ctx).apply {
                hint = "Merchant ID"
                setText(PosApplication.getMerchantId(ctx))
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fBeneficiary = EditText(ctx).apply {
                hint = "Beneficiary ID (optional)"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fAmount = EditText(ctx).apply {
                hint = "Amount *"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fCurrency = EditText(ctx).apply {
                hint = "Currency (USD)"
                setText("USD")
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fRef = EditText(ctx).apply {
                hint = "Reference *"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            val fPurpose = EditText(ctx).apply {
                hint = "Purpose / Beneficiary name"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
            }
            vert.addView(fMerchant)
            vert.addView(fBeneficiary)
            vert.addView(fAmount)
            vert.addView(fCurrency)
            vert.addView(fRef)
            vert.addView(fPurpose)
            setView(vert)
            setPositiveButton("Submit") { _, _ ->
                val amount = fAmount.text?.toString()?.toDoubleOrNull() ?: run { toast("Amount required"); return@setPositiveButton }
                val currency = fCurrency.text?.toString()?.takeIf { it.isNotBlank() } ?: "USD"
                val reference = fRef.text?.toString()?.takeIf { it.isNotBlank() } ?: run { toast("Reference required"); return@setPositiveButton }
                vm.submitPayout(
                    beneficiary = fBeneficiary.text?.toString()?.takeIf { it.isNotBlank() } ?: "",
                    bankOrChain = null,
                    account = null,
                    amount = amount,
                    currency = currency,
                    reference = reference
                )
                toast("Payout requested")
                load()
            }
            setNegativeButton("Cancel", null)
            show()
        }
    }

    private fun row(p: PayoutDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
            addView(LinearLayout(this@PayoutsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@PayoutsActivity).apply {
                    text = (p.methodType ?: p.method ?: "BANK") + " \u2014 " + (p.reference ?: "no-ref")
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(p.status))
            }, matchWrap())

            addView(kvRow("Amount", Formatters.formatAmount(p.amount ?: 0.0, p.currency ?: "USD")), matchWrap().apply { topMargin = 8 })
            p.fee?.let { if (it > 0.0) addView(kvRow("Fee", Formatters.formatAmount(it, p.currency ?: "USD")), matchWrap()) }
            p.bankName?.let { addView(kvRow("Bank", it), matchWrap()) }
            p.bankAccountNumberMasked?.let { addView(kvRow("Account", it), matchWrap()) }
            p.beneficiaryName?.let { addView(kvRow("Beneficiary", it), matchWrap()) }
            p.providerReference?.let { addView(kvRow("Proc ref", it.orEmpty().takeLast(12)), matchWrap()) }
            p.createdAt?.let { addView(kvRow("Created", fmtISO(it)), matchWrap()) }
            p.completedAt?.let { addView(kvRow("Completed", fmtISO(it)), matchWrap()) }
            p.errorMessage?.let {
                addView(TextView(this@PayoutsActivity).apply {
                    text = "Error: $it"
                    textSize = 12f
                    setTextColor(resources.getColor(R.color.pos_error, theme))
                    setPadding(0, 6, 0, 0)
                }, matchWrap())
            }
        }
        return card(wrap)
    }
}

// ── Vault Dashboard ─────────────────────────────────────────────────────────
class VaultDashboardActivity : BaseListActivity<VaultAccountDto>() {
    override val pageTitle = "Vault Accounts"
    override val pageSubtitle = "Vault balances, reserved holds, available net"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.vaultAccounts.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() {
        vm.loadVaultAccounts()
    }

    private fun row(v: VaultAccountDto): View {
        val currency = v.currency ?: "USD"
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 22, 24, 22)
            val color = when (currency.uppercase()) {
                "USD" -> R.color.pos_primary
                "PHP" -> R.color.pos_accent_teal
                "AED", "EUR", "GBP" -> R.color.pos_accent
                else -> R.color.pos_violet_container
            }
            setBackgroundColor(resources.getColor(color, theme))
            addView(LinearLayout(this@VaultDashboardActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@VaultDashboardActivity).apply {
                    text = "VAULT $currency"
                    textSize = 16f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_primary, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap())

            addView(TextView(this@VaultDashboardActivity).apply {
                text = Formatters.formatAmount(v.balance ?: 0.0, currency)
                textSize = 28f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(resources.getColor(R.color.pos_on_primary, theme))
                setPadding(0, 12, 0, 0)
            }, matchWrap())
            addView(kvRow("Reserved hold", Formatters.formatAmount(v.reservedHold ?: 0.0, currency)), matchWrap().apply { topMargin = 12 })
            addView(kvRow("Available", Formatters.formatAmount(v.availableBalance ?: 0.0, currency)), matchWrap())
            v.updatedAt?.let { addView(kvRow("Updated", fmtISO(it)), matchWrap()) }
        }
        val cv = card(tile)
        cv.radius = 20f
        cv.setContentPadding(0, 0, 0, 0)
        return cv
    }
}

// ── Virtual Cards ───────────────────────────────────────────────────────────
class VirtualCardsActivity : BaseListActivity<VirtualCardDto>() {
    override val pageTitle = "Virtual Cards"
    override val pageSubtitle = "Issue, freeze, and terminate customer/merchant virtual cards"

    private lateinit var vm: GovernanceViewModel
    private lateinit var fOwner: EditText
    private lateinit var fCardholder: EditText
    private lateinit var fBrand: EditText
    private lateinit var fCurrency: EditText
    private lateinit var fLimit: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.virtualCards.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }

        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, 12)
        }
        fOwner = EditText(this@VirtualCardsActivity).apply {
            hint = "Owner ID (customerId or merchantId) *"
            setText(PosApplication.getMerchantId(this@VirtualCardsActivity))
            textSize = 14f
            setPadding(20, 24, 20, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        fCardholder = EditText(this@VirtualCardsActivity).apply {
            hint = "Cardholder name *"
            textSize = 14f
            setPadding(20, 24, 20, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        fBrand = EditText(this@VirtualCardsActivity).apply {
            hint = "Brand (VISA / MASTERCARD)"
            setText("VISA")
            textSize = 14f
            setPadding(20, 24, 20, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        fCurrency = EditText(this@VirtualCardsActivity).apply {
            hint = "Currency (USD)"
            setText("USD")
            textSize = 14f
            setPadding(20, 24, 20, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        fLimit = EditText(this@VirtualCardsActivity).apply {
            hint = "Spending limit (optional)"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 14f
            setPadding(20, 24, 20, 24)
            setBackgroundColor(resources.getColor(R.color.pos_surface_variant, theme))
        }
        val issueBtn = Button(this@VirtualCardsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "+ Issue card"
            setOnClickListener { issueCard() }
        }
        form.addView(fOwner)
        form.addView(fCardholder)
        form.addView(fBrand)
        form.addView(fCurrency)
        form.addView(fLimit)
        form.addView(issueBtn, matchWrap().apply { topMargin = 8 })
        rootLayout.addView(form, matchWrap().apply { bottomMargin = 12 })
    }

    private fun issueCard() {
        val owner = fOwner.text?.toString()?.takeIf { it.isNotBlank() } ?: run { toast("Owner required"); return }
        val cardholder = fCardholder.text?.toString()?.takeIf { it.isNotBlank() } ?: run { toast("Cardholder name required"); return }
        val brand = fBrand.text?.toString()?.takeIf { it.isNotBlank() } ?: "VISA"
        val currency = fCurrency.text?.toString()?.takeIf { it.isNotBlank() } ?: "USD"
        val limit = fLimit.text?.toString()?.toDoubleOrNull()
        vm.issueVirtualCard(customerId = owner, brand = brand, currency = currency, spendLimit = limit, label = cardholder)
        toast("Card issuance requested")
        load()
    }

    override fun load() {
        vm.loadVirtualCards(PosApplication.getMerchantId(this))
    }

    private fun row(c: VirtualCardDto): View {
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 18, 20, 18)
            val brandBg = when (c.brand?.uppercase()) {
                "VISA" -> R.color.card_visa
                "MASTERCARD", "MC" -> R.color.card_mastercard
                "AMEX" -> R.color.card_amex
                "UNIONPAY" -> R.color.card_unionpay
                else -> R.color.card_default
            }
            setBackgroundColor(resources.getColor(brandBg, theme))
            addView(LinearLayout(this@VirtualCardsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@VirtualCardsActivity).apply {
                    text = c.cardholderName ?: "CARDHOLDER"
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(Color.WHITE)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(c.status))
            }, matchWrap())

            addView(TextView(this@VirtualCardsActivity).apply {
                text = c.panMasked ?: "**** **** **** ****"
                textSize = 22f
                typeface = Typeface.MONOSPACE
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setPadding(0, 16, 0, 8)
            }, matchWrap())

            addView(LinearLayout(this@VirtualCardsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(kvRowLight("Exp", c.expiry ?: "--/--"))
                addView(kvRowLight("CVV", "***"))
                addView(kvRowLight("Limit", Formatters.formatAmount(c.spendingLimit ?: 0.0, c.currency ?: "USD")))
            }, matchWrap())

            addView(kvRowLight("Available", Formatters.formatAmount(c.availableLimit ?: 0.0, c.currency ?: "USD")), matchWrap().apply { topMargin = 4 })

            addView(LinearLayout(this@VirtualCardsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 14, 0, 0)
                addView(Button(this@VirtualCardsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = if (c.status?.equals("ACTIVE", true) == true) "Freeze" else "Unfreeze"
                    setOnClickListener { vm.toggleVirtualCard(c.id.orEmpty(), c.status?.equals("ACTIVE", true) != true); load() }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
                })
                addView(Button(this@VirtualCardsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                    text = "Terminate"
                    setOnClickListener { terminate(c.id.orEmpty()) }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
            }, matchWrap().apply { topMargin = 8 })
        }
        val cv = card(tile)
        cv.setCardBackgroundColor(Color.TRANSPARENT)
        cv.radius = 18f
        return cv
    }

    private fun kvRowLight(k: String, v: String): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 8 }
        }
        wrap.addView(TextView(this).apply {
            text = k.uppercase(); textSize = 10f; setTextColor(Color.argb(200, 255, 255, 255))
        })
        wrap.addView(TextView(this).apply {
            text = v; textSize = 13f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD)
        })
        return wrap
    }

    private fun terminate(id: String) {
        AlertDialog.Builder(this).apply {
            setTitle("Terminate card")
            setMessage("This permanently revokes the card. Continue?")
            setPositiveButton("Terminate") { _, _ -> vm.terminateVirtualCard(id); load() }
            setNegativeButton("Cancel", null)
            show()
        }
    }
}

// ── Audit Trail ─────────────────────────────────────────────────────────────
class AuditTrailActivity : BaseListActivity<AuditEventDto>() {
    override val pageTitle = "Audit Trail"
    override val pageSubtitle = "Tamper-evident, SHA-256 hashed audit records"

    private lateinit var vm: GovernanceViewModel
    private lateinit var fActor: EditText
    private lateinit var fAction: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.auditEvents.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }

        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 12)
            fActor = EditText(this@AuditTrailActivity).apply {
                hint = "Actor name / ID"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            fAction = EditText(this@AuditTrailActivity).apply {
                hint = "Action"
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            addView(fActor)
            addView(fAction)
            addView(Button(this@AuditTrailActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "Filter"
                setOnClickListener { load() }
            })
        }
        rootLayout.addView(head, matchWrap().apply { bottomMargin = 12 })
    }

    override fun load() {
        vm.loadAuditEvents(
            actor = fActor.text?.toString()?.takeIf { it.isNotBlank() },
            action = fAction.text?.toString()?.takeIf { it.isNotBlank() }
        )
    }

    private fun row(a: AuditEventDto): View {
        val severityColor = when ((a.action ?: "").uppercase()) {
            in setOf("LOGIN_FAILED", "ROTATE_KEY", "TERMINATE", "DISABLE") -> R.color.pos_error_container
            in setOf("LOGIN", "AUTHORIZED", "CAPTURE", "SETTLE", "CREATE", "ISSUE") -> R.color.pos_success_container
            else -> R.color.pos_info_container
        }
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 16, 22, 16)
            addView(LinearLayout(this@AuditTrailActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@AuditTrailActivity).apply {
                    text = a.actorName ?: a.actorId ?: "SYSTEM"
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip((a.action ?: "UNKNOWN").uppercase(), severityColor))
            }, matchWrap())

            addView(kvRow("Entity", (a.entityType ?: "-") + " \u2192 " + ((a.entityId ?: "").takeLast(10))), matchWrap().apply { topMargin = 6 })
            a.ipAddress?.let { v -> addView(kvRow("IP", v), matchWrap()) }
            a.actorType?.let { v -> addView(kvRow("Actor type", v), matchWrap()) }
            a.changes?.let { v -> addView(kvRow("Changes hash", v.takeLast(16)), matchWrap()) }
            a.hash?.let { v -> addView(kvRow("Chain hash", v.takeLast(16)), matchWrap()) }
            a.createdAt?.let { v -> addView(kvRow("Timestamp", fmtISO(v)), matchWrap()) }
        }
        return card(wrap)
    }
}

// ── Reconciliation ─────────────────────────────────────────────────────────
class ReconciliationActivity : BaseListActivity<ReconDto>() {
    override val pageTitle = "Reconciliation"
    override val pageSubtitle = "Daily ledger-vs-bank variance tracking per scheme"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.recons.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() {
        vm.loadRecons()
    }

    private fun row(r: ReconDto): View {
        val currency = r.currency ?: "USD"
        val variancePct = if ((r.expectedLedger ?: 0.0) == 0.0) 0.0 else kotlin.math.abs(((r.difference ?: 0.0) / (r.expectedLedger
            ?: 0.0)) * 100)
        val statusColor = when {
            variancePct == 0.0 -> R.color.pos_success_container
            variancePct < 0.5 -> R.color.pos_info_container
            variancePct < 2.0 -> R.color.pos_warning_container
            else -> R.color.pos_error_container
        }
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
            addView(LinearLayout(this@ReconciliationActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@ReconciliationActivity).apply {
                    text = (r.reportId?.orEmpty()?.takeLast(8) ?: "#") + " \u2014 " + (r.scheme ?: "ALL") + " $currency"
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip(r.status ?: "open", statusColor))
            }, matchWrap())

            r.date?.let { addView(kvRow("Date", it), matchWrap().apply { topMargin = 6 }) }
            addView(kvRow("Expected", Formatters.formatAmount(r.expectedLedger ?: 0.0, currency)), matchWrap())
            addView(kvRow("Received", Formatters.formatAmount(r.receivedBank ?: 0.0, currency)), matchWrap())
            addView(kvRow("Variance", Formatters.formatAmount(r.difference ?: 0.0, currency)), matchWrap())
            addView(kvRow("Discrepancies", (r.discrepancies ?: 0).toString() + " discrepancies"), matchWrap())
            r.resolved?.let { addView(kvRow("Resolved", "$it items"), matchWrap()) }
            r.createdAt?.let { addView(kvRow("Generated", fmtISO(it)), matchWrap()) }
        }
        return card(wrap)
    }
}

// ── Reports ─────────────────────────────────────────────────────────────────
class ReportsActivity : BaseListActivity<ReportRunDto>() {
    override val pageTitle = "Reports"
    override val pageSubtitle = "Daily, X-day settlement/transaction/ledger reports (CSV/PDF)"

    private lateinit var vm: GovernanceViewModel
    private lateinit var fDays: EditText
    private lateinit var fFormat: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.reports.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }

        val form = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 12)
            fDays = EditText(this@ReportsActivity).apply {
                hint = "Days (1/7/30)"
                setText("1")
                inputType = InputType.TYPE_CLASS_NUMBER
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            fFormat = EditText(this@ReportsActivity).apply {
                hint = "Format (CSV / PDF / HTML)"
                setText("CSV")
                textSize = 14f
                setPadding(20, 24, 20, 24)
                setBackgroundColor(resources.getColor(R.color.pos_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            addView(fDays)
            addView(fFormat)
            addView(Button(this@ReportsActivity, null, 0, R.style.Widget_PosApp_Button).apply {
                text = "Generate"
                setOnClickListener {
                    val d = fDays.text?.toString()?.toIntOrNull() ?: 1
                    val fmt = fFormat.text?.toString()?.takeIf { it.isNotBlank() } ?: "CSV"
                    vm.generateReport(d, fmt)
                    load()
                }
            })
        }
        rootLayout.addView(form, matchWrap().apply { bottomMargin = 12 })
    }

    override fun load() {
        vm.loadReports(merchantId = PosApplication.getMerchantId(this))
    }

    private fun row(r: ReportRunDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
            addView(LinearLayout(this@ReportsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@ReportsActivity).apply {
                    text = (r.reportType?.uppercase() ?: "DAILY") + " \u2014 " + (r.id.takeLast(8))
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(chip(r.status?.uppercase() ?: "READY", R.color.pos_info_container))
            }, matchWrap())

            r.dayRange?.let { addView(kvRow("Range", "$it day(s)"), matchWrap().apply { topMargin = 6 }) }
            r.recordsCount?.let { addView(kvRow("Records", it.toString() + " records"), matchWrap()) }
            r.format?.let { addView(kvRow("Format", it.uppercase()), matchWrap()) }
            r.generatedBy?.let { addView(kvRow("By", it), matchWrap()) }
            r.generatedAt?.let { addView(kvRow("Generated", fmtISO(it)), matchWrap()) }

            r.downloadUrl?.let { url ->
                addView(Button(this@ReportsActivity, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
                    text = "Download / Copy link"
                    setOnClickListener {
                        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("report", url))
                        toast("Link copied")
                    }
                }, matchWrap().apply { topMargin = 8 })
            }
        }
        return card(wrap)
    }
}

// ── Payment Methods ─────────────────────────────────────────────────────────
class PaymentMethodsActivity : BaseListActivity<PaymentMethodDto>() {
    override val pageTitle = "Payment Methods"
    override val pageSubtitle = "Rails and schemes available at the terminal"

    private lateinit var vm: GovernanceViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(this)[GovernanceViewModel::class.java]
        vm.paymentMethods.observe(this) { state ->
            bindState(state) { list -> render(list, this::row) }
        }
    }

    override fun load() {
        vm.loadPaymentMethods()
    }

    private fun row(pm: PaymentMethodDto): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
            addView(LinearLayout(this@PaymentMethodsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@PaymentMethodsActivity).apply {
                    text = pm.code ?: pm.name ?: "METHOD"
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(statusChip(if (pm.enabled == true) "ENABLED" else "DISABLED"))
            }, matchWrap())

            pm.name?.let { addView(kvRow("Name", it), matchWrap().apply { topMargin = 6 }) }
            pm.brand?.let { addView(kvRow("Rail", it.uppercase()), matchWrap()) }
            pm.type?.let { addView(kvRow("Provider", it.uppercase()), matchWrap()) }
            pm.defaultSurchargePct?.let { addView(kvRow("Fee", "$it %"), matchWrap()) }
            pm.createdAt?.let { addView(kvRow("Added", fmtISO(it)), matchWrap()) }

            addView(LinearLayout(this@PaymentMethodsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 10, 0, 0)
                val swLabel = TextView(this@PaymentMethodsActivity).apply {
                    text = if (pm.enabled == true) "Enabled" else "Disabled"
                    textSize = 14f
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12; gravity = Gravity.CENTER_VERTICAL }
                    setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                }
                val sw = Switch(this@PaymentMethodsActivity).apply {
                    isChecked = pm.enabled == true
                    setOnCheckedChangeListener { _, checked ->
                        swLabel.text = if (checked) "Enabled" else "Disabled"
                        vm.setPaymentMethodEnabled(pm.id ?: pm.code ?: "", checked)
                    }
                }
                addView(swLabel)
                addView(sw)
            }, matchWrap().apply { topMargin = 6 })
        }
        return card(wrap)
    }
}

// ── Printer Preview & Test ─────────────────────────────────────────────────
class PrinterActivity : BaseListActivity<Any>() {
    override val pageTitle = "Printer"
    override val pageSubtitle = "ESC/POS 58mm and 80mm thermal test receipts"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val preview58 = ReceiptThermal.build58(
            merchantName = "PRIMESTACK POS",
            merchantAddress = "123 Ayala Ave",
            merchantPhone = "+63 917 000 0000",
            mid = "MID-00001",
            tid = "TID-00001",
            amountMinor = 12345L,
            currency = "USD",
            panMasked = "4111 **** **** 1111",
            brand = "VISA",
            entryMode = "CHIP",
            approvalCode = "A1B2C3",
            authCode = "Z9Y8X7",
            stan = "000042",
            rrn = "123456789012",
            authRef = "REF-9999",
            invoiceNo = "INV-2026-0042",
            cashier = "LIVE Operator",
            txnTime = "2026-03-18T15:42:10Z",
            tip = 150L,
            tax = 60L,
            customerName = "Jane Doe",
            qrContent = "https://primestack.example/r/INV-2026-0042"
        )
        val preview80 = ReceiptThermal.build80(
            merchantName = "PRIMESTACK POS",
            merchantAddress = "123 Ayala Ave",
            merchantPhone = "+63 917 000 0000",
            mid = "MID-00001",
            tid = "TID-00001",
            amountMinor = 12345L,
            currency = "USD",
            panMasked = "4111 **** **** 1111",
            brand = "VISA",
            entryMode = "CHIP",
            approvalCode = "A1B2C3",
            authCode = "Z9Y8X7",
            stan = "000042",
            rrn = "123456789012",
            authRef = "REF-9999",
            invoiceNo = "INV-2026-0042",
            cashier = "LIVE Operator",
            txnTime = "2026-03-18T15:42:10Z",
            tip = 150L,
            tax = 60L,
            customerName = "Jane Doe",
            qrContent = "https://primestack.example/r/INV-2026-0042"
        )

        val tabs = RadioGroup(this).apply {
            orientation = RadioGroup.HORIZONTAL
            setPadding(0, 0, 0, 12)
        }
        val rb58 = RadioButton(this).apply { text = "58mm"; isChecked = true }
        val rb80 = RadioButton(this).apply { text = "80mm" }
        tabs.addView(rb58)
        tabs.addView(rb80)
        rootLayout.addView(tabs, matchWrap())

        val scroll = ScrollView(this)
        val tv = TextView(this).apply {
            text = preview58
            typeface = Typeface.MONOSPACE
            textSize = 11f
            setPadding(24, 24, 24, 24)
            setBackgroundColor(Color.WHITE)
            setTextColor(Color.BLACK)
        }
        scroll.addView(tv)
        val card = card(scroll)
        card.radius = 14f
        rootLayout.addView(card, matchWrap().apply { bottomMargin = 12 })

        tabs.setOnCheckedChangeListener { _, _ ->
            tv.text = if (rb58.isChecked) preview58 else preview80
        }

        val btns = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 0, 0, 20) }
        btns.addView(Button(this, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
            text = "Copy 58"
            setOnClickListener {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("escpos58", preview58))
                toast("Copied 58mm ESC/POS")
            }
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
        })
        btns.addView(Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Send test"
            setOnClickListener {
                val body = if (rb58.isChecked) preview58 else preview80
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TITLE, "Print test receipt")
                    putExtra(Intent.EXTRA_TEXT, body)
                }
                startActivity(Intent.createChooser(send, "Send to printer app"))
            }
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        rootLayout.addView(btns, matchWrap())
    }

    override fun load() {}
}

// ── Device Security & Session ───────────────────────────────────────────────
class DeviceSecurityActivity : BaseListActivity<Any>() {
    override val pageTitle = "Device Security"
    override val pageSubtitle = "Session, TFA, API key rotation, logout"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 0, 0, 12) }
        val rows = mutableListOf<Pair<String, String>>()
        val prefsUser = getSharedPreferences("pos_settings", Context.MODE_PRIVATE).getString("admin_username", null)
        rows.add("User" to (prefsUser ?: "(not logged in)"))
        rows.add("Merchant" to (PosApplication.getMerchantId(this)?.orEmpty()?.takeLast(10) ?: "-"))
        rows.add("Terminal" to (PosApplication.getTerminalId(this)?.orEmpty()?.takeLast(8) ?: "-"))
        rows.add("Server" to (PosApplication.getServerUrl(this) ?: "-"))
        rows.add("Default currency" to (PosApplication.getCurrency(this) ?: "USD"))
        rows.add("Processor live" to if (PosApplication.isProcessorLive(this)) "YES" else "NO")
        val sessionInfo = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for ((k, v) in rows) {
            sessionInfo.addView(kvRow(k, v), matchWrap().apply { bottomMargin = 4 })
        }
        info.addView(card(sessionInfo), matchWrap())

        val tfa = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(24, 18, 24, 18)
            val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
            val label = TextView(this@DeviceSecurityActivity).apply {
                text = "Two-factor auth (TOTP) required for sensitive actions"
                textSize = 14f
                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 12 }
            }
            val sw = Switch(this@DeviceSecurityActivity).apply {
                isChecked = prefs.getBoolean("tfa_enabled", false)
                setOnCheckedChangeListener { _, v ->
                    getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit().putBoolean("tfa_enabled", v).apply()
                    toast("TFA " + (if (v) "enabled" else "disabled"))
                }
            }
            addView(label)
            addView(sw)
        }
        val tfaCard = card(tfa); tfaCard.radius = 12f
        info.addView(tfaCard, matchWrap().apply { topMargin = 12 })

        val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        actions.addView(Button(this, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
            text = "Rotate API key"
            setOnClickListener { toast("Placeholder \u2014 rotate via governance flow") }
        }, matchWrap().apply { topMargin = 12; bottomMargin = 8 })
        actions.addView(Button(this, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
            text = "Review all sessions"
            setOnClickListener { toast("Placeholder \u2014 list sessions") }
        }, matchWrap().apply { bottomMargin = 8 })
        actions.addView(Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Logout"
            setOnClickListener {
                AlertDialog.Builder(this@DeviceSecurityActivity).apply {
                    setTitle("Logout?")
                    setMessage("This clears all local credentials and cached tokens on this device.")
                    setPositiveButton("Logout") { _, _ ->
                        val sp = getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit()
                        sp.clear().apply()
                        val i = Intent(this@DeviceSecurityActivity, LoginActivity::class.java)
                        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(i)
                        finishAffinity()
                    }
                    setNegativeButton("Cancel", null)
                    show()
                }
            }
        }, matchWrap())
        info.addView(card(actions), matchWrap().apply { topMargin = 12 })
        rootLayout.addView(info, matchWrap())
    }

    override fun load() {}
}

// ── Onboarding ─────────────────────────────────────────────────────────────
class OnboardingActivity : BaseListActivity<Any>() {
    override val pageTitle = "Welcome"
    override val pageSubtitle = "Quick setup for Primestack POS Android"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sp = getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        if (sp.getBoolean("onboarded_v1", false)) {
            if (PosApplication.isLoggedIn(this@OnboardingActivity)) {
                startActivity(Intent(this@OnboardingActivity, DashboardActivity::class.java))
            } else {
                startActivity(Intent(this@OnboardingActivity, LoginActivity::class.java))
            }
            finish()
            return
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        val steps = listOf(
            Triple("Step 1 — Connect backend", "Open Settings and paste the backend URL (http://10.0.2.2:7000 for emulator, or your LAN IP port 7000 for a physical device).", R.color.pos_primary_container),
            Triple("Step 2 — Login", "Use your merchant admin credentials issued via the web dashboard.", R.color.pos_success_container),
            Triple("Step 3 — Run a LIVE charge", "PROCESSOR_ACTIVATED is enabled. Global Payments UCP collects real funds. No TEST_1USD_SANDBOX cap. Unlimited USD processing is active.", R.color.pos_gold_container)
        )
        for ((title, body, color) in steps) root.addView(addStepCard(title, body, color), matchWrap().apply { bottomMargin = 12 })

        val btn = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "Continue to login"
            setOnClickListener {
                val sp = getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit()
                sp.putBoolean("onboarded_v1", true).apply()
                startActivity(Intent(this@OnboardingActivity, LoginActivity::class.java))
                finish()
            }
        }
        root.addView(btn, matchWrap().apply { topMargin = 8 })
        rootLayout.addView(root, matchWrap())
    }

    private fun addStepCard(title: String, body: String, color: Int): CardView {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 18, 20, 18)
            setBackgroundColor(resources.getColor(color, theme))
            addView(TextView(this@OnboardingActivity).apply {
                text = title
                textSize = 16f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
            })
            addView(TextView(this@OnboardingActivity).apply {
                text = body
                textSize = 13f
                setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
                setPadding(0, 6, 0, 0)
            })
        }
        val cv = card(wrap)
        cv.radius = 14f
        return cv
    }

    override fun load() {}
}
