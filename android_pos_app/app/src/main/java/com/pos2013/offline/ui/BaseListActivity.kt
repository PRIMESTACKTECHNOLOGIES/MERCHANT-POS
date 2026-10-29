package com.pos2013.offline.ui

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.utils.Formatters
import com.pos2013.offline.viewmodel.UiState
import com.pos2013.offline.viewmodel.fold

abstract class BaseListActivity<T> : AppCompatActivity() {

    protected lateinit var listContainer: LinearLayout
    protected lateinit var empty: TextView
    protected lateinit var swipe: SwipeRefreshLayout
    protected lateinit var titleText: TextView
    protected lateinit var subtitle: TextView
    protected lateinit var rootLayout: LinearLayout

    open val pageTitle: String = "Primestack POS"
    open val pageSubtitle: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (LoginActivity.startIfNeeded(this)) { finish(); return }
        val sv = ScrollView(this).apply {
            setBackgroundColor(resources.getColor(R.color.pos_background, theme))
        }
        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 40, 24, 120)
        }
        sv.addView(rootLayout)
        swipe = SwipeRefreshLayout(this).apply { addView(sv) }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val back = Button(this@BaseListActivity, null, 0).apply {
                text = "\u2190"
                textSize = 24f
                setOnClickListener { finish() }
            }
            addView(back)
            titleText = TextView(this@BaseListActivity).apply {
                text = pageTitle
                textSize = 22f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(resources.getColor(R.color.pos_on_surface, theme))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .apply { marginStart = 16 }
            }
            addView(titleText)
        }
        rootLayout.addView(topBar, matchWrap().apply { bottomMargin = 8 })

        if (pageSubtitle.isNotBlank()) {
            subtitle = TextView(this).apply {
                text = pageSubtitle
                textSize = 13f
                setTextColor(Color.GRAY)
                setPadding(8, 0, 8, 24)
            }
            rootLayout.addView(subtitle, matchWrap())
        }

        listContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        rootLayout.addView(listContainer, matchWrap())

        empty = TextView(this).apply {
            text = "No data yet \u2014 pull to refresh"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.GRAY)
            setPadding(0, 80, 0, 0)
        }
        rootLayout.addView(empty, matchWrap())

        setContentView(swipe)
        swipe.setOnRefreshListener { load() }
    }

    override fun onResume() {
        super.onResume()
        if (!LoginActivity.startIfNeeded(this)) load()
    }

    abstract fun load()

    fun <S> bindState(state: UiState<S>?, onLoading: () -> Unit = { swipe.isRefreshing = true }, onError: (String) -> Unit = { swipe.isRefreshing = false; toast(it) }, onSuccess: (S) -> Unit) {
        state ?: return
        state.fold(
            idle = {},
            loading = { onLoading() },
            success = { swipe.isRefreshing = false; onSuccess(it) },
            error = { onError(it) }
        )
    }

    fun render(items: List<T>, toView: (T) -> View) {
        swipe.isRefreshing = false
        listContainer.removeAllViews()
        if (items.isEmpty()) { empty.visibility = View.VISIBLE; return }
        empty.visibility = View.GONE
        items.forEachIndexed { i, item ->
            listContainer.addView(
                toView(item),
                matchWrap().apply { bottomMargin = if (i == items.lastIndex) 0 else 10 }
            )
        }
    }

    fun card(inside: View, onClick: (() -> Unit)? = null): CardView {
        return CardView(this, null, R.style.Widget_PosApp_CardView).apply {
            radius = 18f
            cardElevation = 2f
            setCardBackgroundColor(resources.getColor(R.color.pos_surface, theme))
            addView(inside)
            onClick?.let { h -> setOnClickListener { h() } }
        }
    }

    fun matchWrap() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    )

    fun LinearLayout.LayoutParams.bm(v: Int): LinearLayout.LayoutParams { bottomMargin = v; return this }

    fun kvRow(k: String, v: String): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, 4, 0, 4)
        addView(TextView(this@BaseListActivity).apply {
            text = k
            textSize = 13f
            setTextColor(Color.GRAY)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        addView(TextView(this@BaseListActivity).apply {
            text = v
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(resources.getColor(R.color.pos_on_surface, theme))
        })
    }

    fun fmtAmount(v: Double?, currency: String? = PosApplication.getCurrency(this)) =
        Formatters.formatAmount(v ?: 0.0, currency ?: "USD")

    fun fmtAmountMinor(v: Long?, currency: String? = PosApplication.getCurrency(this)) =
        Formatters.formatAmountMinor(v ?: 0L, currency ?: "USD")

    fun fmtISO(v: String?) = v?.let { Formatters.formatDateTimeISO(it) } ?: "-"

    fun chip(text: String, colorBg: Int, colorFg: Int = R.color.pos_on_surface): TextView =
        TextView(this).apply {
            this.text = text.uppercase()
            textSize = 12f
            setBackgroundColor(resources.getColor(colorBg, theme))
            setPadding(16, 6, 16, 6)
            setTextColor(resources.getColor(colorFg, theme))
        }

    fun statusChip(status: String?): TextView {
        val s = (status ?: "-").lowercase()
        return when {
            s in setOf("open", "pending", "processing") -> chip(status ?: "-", R.color.pos_info_container)
            s in setOf("closed", "settled", "funded", "approved", "success", "synced") -> chip(status ?: "-", R.color.pos_success_container)
            s in setOf("failed", "rejected", "declined", "error") -> chip(status ?: "-", R.color.pos_error_container)
            s in setOf("settling", "queued") -> chip(status ?: "-", R.color.pos_gold_container)
            else -> chip(status ?: "-", R.color.pos_surface_variant)
        }
    }

    fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
