package com.pos2013.offline.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.text.format.DateFormat
import java.text.DecimalFormat
import java.text.NumberFormat
import java.util.Currency
import java.util.Date
import java.util.Locale

object Formatters {

    fun formatCurrencyMinor(minorUnits: Long, currencyCode: String = "USD"): String {
        val fmt = NumberFormat.getCurrencyInstance(Locale.getDefault())
        try { fmt.currency = Currency.getInstance(currencyCode) } catch (_: Throwable) {}
        fmt.minimumFractionDigits = 2
        fmt.maximumFractionDigits = 2
        return fmt.format(minorUnits.toDouble() / 100.0)
    }

    fun formatAmountMinor(minorUnits: Long, currencyCode: String = "USD"): String =
        formatCurrencyMinor(minorUnits, currencyCode)

    fun formatAmount(amount: Double, currencyCode: String = "USD"): String {
        val fmt = NumberFormat.getCurrencyInstance(Locale.getDefault())
        try { fmt.currency = Currency.getInstance(currencyCode) } catch (_: Throwable) {}
        fmt.minimumFractionDigits = 2
        fmt.maximumFractionDigits = 2
        return fmt.format(amount)
    }

    fun formatNumberMinor(minorUnits: Long): String = DecimalFormat("0.00").format(minorUnits.toDouble() / 100.0)

    fun formatDateTime(ms: Long): String =
        DateFormat.format("yyyy-MM-dd HH:mm:ss", Date(ms)).toString()

    fun formatDateTimeISO(iso: String?): String {
        if (iso.isNullOrBlank()) return "-"
        return iso.replace('T', ' ').let { if (it.contains('.')) it.substringBefore('.') else it }
    }

    fun maskPan(pan: String?): String {
        val s = (pan ?: "").filter { it.isDigit() }
        return when {
            s.length >= 16 -> s.take(4) + " **** **** " + s.takeLast(4)
            s.length >= 10 -> s.take(2) + " **** " + s.takeLast(2)
            else -> s.ifBlank { "—" }
        }
    }
}

object Connectivity {

    fun isNetworkAvailable(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val nc = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun hasWifi(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val nc = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    fun hasMobile(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val nc = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
    }
}

object ReceiptThermal {

    private const val WIDTH_58 = 32
    private const val WIDTH_80 = 48

    fun center(text: String, width: Int = WIDTH_58): String {
        val t = text.take(width)
        val pad = ((width - t.length) / 2).coerceAtLeast(0)
        return " ".repeat(pad) + t
    }

    fun splitLine(left: String, right: String, width: Int = WIDTH_58): String {
        val lp = left.take(width / 2 - 1)
        val rp = right.take(width / 2 - 1)
        val gap = (width - lp.length - rp.length).coerceAtLeast(1)
        return lp + " ".repeat(gap) + rp
    }

    fun line(char: Char = '-', width: Int = WIDTH_58) = char.toString().repeat(width)

    fun buildEscPos58(
        merchantName: String,
        address: String? = null,
        terminalId: String,
        txnId: String,
        type: String,
        amount: String,
        currency: String,
        panMasked: String,
        expiry: String? = null,
        authCode: String? = null,
        stan: String? = null,
        rrn: String? = null,
        approvalCode: String? = null,
        qrContent: String? = null,
        items: List<Pair<String, String>> = emptyList()
    ): String {
        val w = WIDTH_58
        val sb = StringBuilder()
        sb.append(center(merchantName.uppercase(), w)).append('\n')
        address?.takeIf { it.isNotBlank() }?.also { sb.append(center(it, w)).append('\n') }
        sb.append(splitLine("TERM:$terminalId", "TS:${DateFormat.format("HH:mm:ss", Date())}", w)).append('\n')
        sb.append(line('-', w)).append('\n')
        sb.append(splitLine("TXN ID", txnId.takeLast(12), w)).append('\n')
        sb.append(splitLine("TYPE", type, w)).append('\n')
        stan?.takeIf { it.isNotBlank() }?.also { sb.append(splitLine("STAN", it, w)).append('\n') }
        rrn?.takeIf { it.isNotBlank() }?.also { sb.append(splitLine("RRN", it, w)).append('\n') }
        authCode?.takeIf { it.isNotBlank() }?.also { sb.append(splitLine("AUTH CODE", it, w)).append('\n') }
        approvalCode?.takeIf { it.isNotBlank() }?.also { sb.append(splitLine("APPR CODE", it, w)).append('\n') }
        sb.append(line('-', w)).append('\n')
        if (items.isNotEmpty()) {
            sb.append(center("— ITEMS —", w)).append('\n')
            items.forEach { (name, price) -> sb.append(splitLine(name.take(22), price.take(9), w)).append('\n') }
            sb.append(line('.', w)).append('\n')
        }
        sb.append(splitLine("AMOUNT", "$currency $amount", w)).append('\n')
        sb.append(line('-', w)).append('\n')
        sb.append(splitLine("PAN", panMasked, w)).append('\n')
        expiry?.takeIf { it.isNotBlank() }?.also { sb.append(splitLine("EXP", it, w)).append('\n') }
        sb.append(line('-', w)).append('\n')
        sb.append(center("THANK YOU FOR SHOPPING!", w)).append('\n')
        qrContent?.takeIf { it.isNotBlank() }?.also {
            sb.append('\n').append(center("[ QR: scan for receipt ]", w)).append('\n')
            sb.append(center(it.take(w - 4).ifBlank { "-" }, w)).append('\n')
        }
        sb.append('\n').append('\n').append('\n')
        return sb.toString()
    }

    fun buildEscPos80(
        merchantName: String,
        address: String? = null,
        terminalId: String,
        txnId: String,
        type: String,
        amount: String,
        currency: String,
        panMasked: String,
        expiry: String? = null,
        authCode: String? = null,
        stan: String? = null,
        rrn: String? = null,
        approvalCode: String? = null,
        qrContent: String? = null,
        items: List<Pair<String, String>> = emptyList()
    ) = buildEscPos58(
        merchantName, address, terminalId, txnId, type, amount, currency,
        panMasked, expiry, authCode, stan, rrn, approvalCode, qrContent, items
    ).let { text ->
        text.lines().joinToString("\n") { line ->
            if (line.length < WIDTH_80) line + " ".repeat(WIDTH_80 - line.length) else line.take(WIDTH_80)
        }
    }

    // Simpler helpers used by activities — build 58mm/80mm receipts with a flat named-arg signature
    fun build58(
        merchantName: String,
        merchantAddress: String? = null,
        merchantPhone: String? = null,
        mid: String? = null,
        tid: String? = null,
        amountMinor: Long,
        currency: String,
        panMasked: String? = null,
        brand: String? = null,
        entryMode: String? = null,
        approvalCode: String? = null,
        authCode: String? = null,
        stan: String? = null,
        rrn: String? = null,
        authRef: String? = null,
        invoiceNo: String? = null,
        cashier: String? = null,
        txnTime: String? = null,
        tip: Long? = null,
        tax: Long? = null,
        customerName: String? = null,
        qrContent: String? = null
    ): String {
        val amountStr = Formatters.formatAmountMinor(amountMinor, currency)
        val type = when {
            tip != null || tax != null -> "SALE"
            else -> "SALE"
        }
        val items = mutableListOf<Pair<String, String>>()
        tip?.let { items.add("Tip" to Formatters.formatAmountMinor(it, currency)) }
        tax?.let { items.add("Tax" to Formatters.formatAmountMinor(it, currency)) }
        val headerLines = listOfNotNull(merchantAddress, merchantPhone)
        val address = headerLines.joinToString(" / ").ifBlank { null }
        return buildEscPos58(
            merchantName = merchantName,
            address = address,
            terminalId = tid ?: "-",
            txnId = (invoiceNo ?: authRef ?: System.currentTimeMillis().toString()).takeLast(20),
            type = type,
            amount = amountStr,
            currency = currency,
            panMasked = panMasked ?: "**** **** **** ****",
            expiry = null,
            authCode = authCode,
            stan = stan,
            rrn = rrn,
            approvalCode = approvalCode,
            qrContent = qrContent,
            items = items
        )
    }

    fun build80(
        merchantName: String,
        merchantAddress: String? = null,
        merchantPhone: String? = null,
        mid: String? = null,
        tid: String? = null,
        amountMinor: Long,
        currency: String,
        panMasked: String? = null,
        brand: String? = null,
        entryMode: String? = null,
        approvalCode: String? = null,
        authCode: String? = null,
        stan: String? = null,
        rrn: String? = null,
        authRef: String? = null,
        invoiceNo: String? = null,
        cashier: String? = null,
        txnTime: String? = null,
        tip: Long? = null,
        tax: Long? = null,
        customerName: String? = null,
        qrContent: String? = null
    ): String {
        val items = mutableListOf<Pair<String, String>>()
        tip?.let { items.add("Tip" to Formatters.formatAmountMinor(it, currency)) }
        tax?.let { items.add("Tax" to Formatters.formatAmountMinor(it, currency)) }
        val address = listOfNotNull(merchantAddress, merchantPhone).joinToString(" / ").ifBlank { null }
        return buildEscPos80(
            merchantName = merchantName,
            address = address,
            terminalId = tid ?: "-",
            txnId = (invoiceNo ?: authRef ?: System.currentTimeMillis().toString()).takeLast(20),
            type = "SALE",
            amount = Formatters.formatAmountMinor(amountMinor, currency),
            currency = currency,
            panMasked = panMasked ?: "**** **** **** ****",
            expiry = null,
            authCode = authCode,
            stan = stan,
            rrn = rrn,
            approvalCode = approvalCode,
            qrContent = qrContent,
            items = items
        )
    }
}

object StanGenerator {
    fun nextStan(ctx: Context): String {
        val prefs = ctx.getSharedPreferences("pos_settings", Context.MODE_PRIVATE)
        val last = prefs.getInt("last_stan", 0)
        val next = (last + 1).coerceAtMost(999999)
        prefs.edit().putInt("last_stan", next).apply()
        return next.toString().padStart(6, '0')
    }

    fun reset(ctx: Context) {
        ctx.getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit().putInt("last_stan", 0).apply()
    }
}
