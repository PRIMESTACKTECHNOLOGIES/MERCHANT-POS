package com.pos2013.offline.card

import android.app.Activity
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.util.Log
import com.pos2013.offline.data.model.EmvCardData
import com.pos2013.offline.emv.EmvApdu
import com.pos2013.offline.emv.EmvKernel
import com.pos2013.offline.emv.EmvTlv
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Reads contactless EMV cards through the device's built-in NFC radio.
 *
 * Tap flow:
 *   1. Reader mode is enabled by the host activity (onResume).
 *   2. On tap, the full EMV kernel runs (SELECT PPSE → AID → GPO → READ RECORDS →
 *      GENERATE AC) to produce the real PAN, expiry and Field 55 (ARQC).
 *   3. If the kernel cannot complete (unsupported card), a lightweight reader
 *      fallback returns the PAN + expiry so the tap still produces a chargeable card.
 *
 * All card I/O runs on a background thread — the ReaderCallback is delivered on the
 * main thread and blocking APDU exchange there would drop reads / trigger an ANR.
 */
class AndroidBuiltInNfcReaderManager(private val activity: Activity) {

    companion object {
        private const val TAG = "AndroidNfcReader"

        // Lightweight reader fallback APDUs
        private val SELECT_PPSE = byteArrayOf(0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x00.toByte(), 0x0E.toByte(), 0x32.toByte(), 0x50.toByte(), 0x41.toByte(), 0x59.toByte(), 0x2E.toByte(), 0x53.toByte(), 0x59.toByte(), 0x53.toByte(), 0x2E.toByte(), 0x44.toByte(), 0x44.toByte(), 0x46.toByte(), 0x30.toByte(), 0x31.toByte(), 0x00.toByte())
        private val SELECT_VISA = byteArrayOf(0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x00.toByte(), 0x07.toByte(), 0xA0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x00.toByte(), 0x03.toByte(), 0x10.toByte(), 0x10.toByte(), 0x00.toByte())
        private val SELECT_MC = byteArrayOf(0x00.toByte(), 0xA4.toByte(), 0x04.toByte(), 0x00.toByte(), 0x07.toByte(), 0xA0.toByte(), 0x00.toByte(), 0x00.toByte(), 0x00.toByte(), 0x04.toByte(), 0x10.toByte(), 0x10.toByte(), 0x00.toByte())
        private val GET_PROCESSING_OPTIONS = byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00.toByte(), 0x00.toByte(), 0x02.toByte(), 0x83.toByte(), 0x00.toByte(), 0x00.toByte())

        /** Maps an alpha currency to its ISO 4217 numeric code (4 digits). */
        fun numericCurrency(alpha: String): String = when (alpha.uppercase(Locale.US)) {
            "AED" -> "0784"
            "USD" -> "0840"
            "EUR" -> "0978"
            "CHF" -> "0756"
            "GBP" -> "0826"
            "JPY" -> "0392"
            "SAR" -> "0682"
            else  -> "0784"
        }
    }

    private val nfcAdapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
    private val io = Executors.newSingleThreadExecutor()
    private var readerModeOn = false

    // Amount/currency context for the EMV kernel (set by the host activity).
    @Volatile private var amountMinor: Long = 0L
    @Volatile private var currencyNumeric: String = "0784"

    private val _cardData = MutableStateFlow<EmvCardData?>(null)
    val cardData: StateFlow<EmvCardData?> = _cardData

    private val _readerStatus = MutableStateFlow<String>("Waiting for NFC tag...")
    val readerStatus: StateFlow<String> = _readerStatus

    /** Supplies the amount/currency used to build the EMV PDOL/CDOL for the next tap. */
    fun setTapContext(amountMinor: Long, currencyAlpha: String) {
        this.amountMinor = amountMinor
        this.currencyNumeric = numericCurrency(currencyAlpha)
    }

    /** NFC hardware present AND switched on in system settings. */
    fun isAvailable(): Boolean = nfcAdapter != null && nfcAdapter.isEnabled

    /** True when the device physically has an NFC radio (regardless of the on/off setting). */
    fun hasNfcHardware(): Boolean = nfcAdapter != null

    /** Opens the system NFC settings screen so the user can switch NFC on. */
    fun openNfcSettings() {
        try {
            activity.startActivity(
                Intent(android.provider.Settings.ACTION_NFC_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Unable to open NFC settings", e)
            _readerStatus.value = "⚠ Enable NFC in Settings → Connected devices"
        }
    }

    fun enableReaderMode() {
        val adapter = nfcAdapter
        // Fail loudly instead of claiming "reader active" when there is no radio to read with.
        if (adapter == null) {
            Log.e(TAG, "enableReaderMode: NfcAdapter is null — device has no NFC hardware")
            _readerStatus.value = "❌ This device has no NFC hardware"
            return
        }
        if (!adapter.isEnabled) {
            readerModeOn = false
            Log.w(TAG, "enableReaderMode: NFC is switched off in system settings")
            _readerStatus.value = "⚠ NFC is turned OFF — tap here to enable it"
            return
        }
        try {
            _readerStatus.value = "Enabling NFC reader..."
            val flags = NfcAdapter.FLAG_READER_NFC_A or
                        NfcAdapter.FLAG_READER_NFC_B or
                        NfcAdapter.FLAG_READER_NFC_F or
                        NfcAdapter.FLAG_READER_NFC_V or
                        NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
                        NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
            adapter.enableReaderMode(
                activity,
                { tag ->
                    Log.d(TAG, "Tag discovered: ${tag.id.joinToString("") { "%02x".format(it) }} | ${tag.techList.joinToString(", ")}")
                    _readerStatus.value = "🔍 Tag detected — reading…"
                    io.execute { handleTagDiscovered(tag) }
                },
                flags,
                null
            )
            readerModeOn = true
            _readerStatus.value = "📱 NFC reader active — tap a card!"
            Log.i(TAG, "Reader mode enabled (flags=0x${Integer.toHexString(flags)})")
        } catch (e: Exception) {
            readerModeOn = false
            Log.e(TAG, "Error enabling reader mode", e)
            _readerStatus.value = "❌ NFC error: ${e.message}"
        }
    }

    fun disableReaderMode() {
        if (!readerModeOn) return
        try {
            nfcAdapter?.disableReaderMode(activity)
        } catch (e: Exception) {
            Log.e(TAG, "Error disabling reader mode", e)
        } finally {
            readerModeOn = false
        }
    }

    fun handleIntent(intent: Intent) {
        val tag = intent.getParcelableExtra<Tag>(NfcAdapter.EXTRA_TAG) ?: return
        io.execute { handleTagDiscovered(tag) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core read — runs on the background executor
    // ─────────────────────────────────────────────────────────────────────────
    private fun handleTagDiscovered(tag: Tag) {
        val isoDep = IsoDep.get(tag)
        if (isoDep == null) {
            Log.w(TAG, "Unsupported NFC tag (not IsoDep)")
            _readerStatus.value = "❌ Unsupported NFC tag"
            return
        }
        try {
            isoDep.connect()
            isoDep.timeout = 10_000

            // 1) Full EMV kernel — yields PAN + Field 55 (ARQC) for real capture.
            var kernelError: String? = null
            val kernelCard = try {
                val emv = EmvKernel.run(isoDep, amountMinor, currencyNumeric)
                EmvCardData(
                    pan            = emv.pan,
                    expiryDate     = EmvKernel.yyMmToMmyy(emv.expiry),
                    cardholderName = null,
                    serviceCode    = null,
                    applicationLabel = null,
                    emvData        = emv.field55Hex,
                    readerSource   = "EMV_TAP",
                    cardBrand      = brandOf(emv.pan),
                    track2         = emv.track2,
                    arqc           = emv.arqcHex,
                    entryMode      = "CHIP_NFC",
                    tapId          = System.currentTimeMillis()
                )
            } catch (e: Exception) {
                kernelError = e.message
                Log.w(TAG, "EMV kernel failed (${e.message}) — falling back to basic read")
                null
            }

            val card = kernelCard ?: basicRead(isoDep)
            if (card == null) {
                // Surface the kernel's status word (SELECT_AID_FAILED: 6A82, GPO_FAILED: 6700, …)
                // so a failed tap is diagnosable instead of an opaque "read failed".
                _readerStatus.value = if (kernelError != null)
                    "❌ Tap failed — EMV: $kernelError"
                else
                    "❌ NFC card read failed — no PAN in card response"
                return
            }

            _cardData.value = card
            _readerStatus.value = if (card.emvData.isNullOrBlank())
                "✅ Card read: ****${card.pan.takeLast(4)} (no cryptogram)"
            else
                "✅ Card read: ****${card.pan.takeLast(4)}"
            Log.i(TAG, "Tap OK — PAN=****${card.pan.takeLast(4)} field55=${card.emvData?.length ?: 0} chars arqc=${card.arqc ?: "none"}")

            // Clear this tap after a short window so the card doesn't linger and
            // re-fire on the next screen rebuild. Repeated taps always carry a new tapId.
            val tapId = card.tapId
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (_cardData.value?.tapId == tapId) {
                    _cardData.value = null
                    _readerStatus.value = "📱 NFC reader active — tap a card!"
                }
            }, 6000)
        } catch (e: Exception) {
            Log.e(TAG, "Error reading tag", e)
            _readerStatus.value = "❌ NFC read error: ${e.message}"
        } finally {
            runCatching { isoDep.close() }
        }
    }

    /**
     * Lightweight fallback: select PPSE/AID, GPO, then sweep records for tags 5A/57/5F24.
     * No cryptogram — used only when the full kernel cannot complete.
     */
    private fun basicRead(isoDep: IsoDep): EmvCardData? {
        try {
            var resp = sendApdu(isoDep, SELECT_PPSE)
            if (!isSuccess(resp)) resp = sendApdu(isoDep, SELECT_VISA)
            if (!isSuccess(resp)) resp = sendApdu(isoDep, SELECT_MC)
            if (!isSuccess(resp)) return null

            runCatching { sendApdu(isoDep, GET_PROCESSING_OPTIONS) }

            val records = mutableListOf<ByteArray>()
            for (sfi in 1..3) for (rec in 1..5) {
                val r = sendApdu(isoDep, EmvApdu.readRecord(sfi, rec))
                if (isSuccess(r) && r.size > 2) records.add(r.copyOf(r.size - 2))
            }

            // Records are wrapped in template 70 — parse deeply so the inner tags are visible.
            val nodes = records.flatMap { EmvTlv.parseDeep(it) }
            fun tag(h: String): String? = EmvTlv.get(nodes, h)?.let { EmvTlv.toHex(it) }

            val track2Hex = tag("57")
            val pan = tag("5A")?.trimEnd('F', 'f')?.filter { it.isDigit() }
                ?: track2Hex?.let { it.substringBefore('D').filter { c -> c.isDigit() } }
            if (pan.isNullOrBlank() || pan.length < 12) return null

            val expiryBcd = tag("5F24")
            val expiryYymm = expiryBcd?.take(4)
                ?: track2Hex?.let { it.substringAfter('D', "").take(4) }
                ?: ""
            val expiry = EmvKernel.yyMmToMmyy(expiryYymm)

            return EmvCardData(
                pan              = pan,
                expiryDate       = expiry,
                cardholderName   = tag("5F20")?.let { hexToAscii(it) },
                serviceCode      = tag("5F30"),
                applicationLabel = tag("50")?.let { hexToAscii(it) },
                emvData          = null,
                readerSource     = "EMV_TAP",
                cardBrand        = brandOf(pan),
                track2           = track2Hex,
                arqc             = null,
                entryMode        = "CHIP_NFC",
                tapId            = System.currentTimeMillis()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Basic read failed", e)
            return null
        }
    }

    private fun brandOf(pan: String): String = when {
        pan.startsWith("4") -> "VISA"
        pan.startsWith("34") || pan.startsWith("37") -> "AMEX"
        pan.startsWith("62") || pan.startsWith("81") -> "UNIONPAY"
        pan.startsWith("5") || pan.startsWith("2") -> "MASTERCARD"
        else -> "CARD"
    }

    private fun sendApdu(isoDep: IsoDep, apdu: ByteArray): ByteArray = isoDep.transceive(apdu)

    private fun isSuccess(resp: ByteArray): Boolean {
        if (resp.size < 2) return false
        val sw1 = resp[resp.size - 2].toInt() and 0xFF
        val sw2 = resp[resp.size - 1].toInt() and 0xFF
        return (sw1 == 0x90 && sw2 == 0x00) || sw1 == 0x61
    }

    private fun hexToAscii(hex: String): String = runCatching {
        String(EmvTlv.fromHex(hex), Charsets.ISO_8859_1).trim()
    }.getOrDefault("")
}
