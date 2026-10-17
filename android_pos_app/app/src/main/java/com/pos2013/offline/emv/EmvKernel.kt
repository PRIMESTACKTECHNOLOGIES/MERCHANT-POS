package com.pos2013.offline.emv

import android.nfc.tech.IsoDep
import java.text.SimpleDateFormat
import java.util.*

/**
 * Minimal online-only EMV kernel.
 * Performs: SELECT AID → GPO → READ RECORDS → GENERATE AC (ARQC) → build Field 55
 */
object EmvKernel {

    data class EmvData(
        val pan:        String,
        val expiry:     String,   // YYMM
        val track2:     String?,
        val field55Hex: String,
        val atcHex:     String,
        val unHex:      String,
        val arqcHex:    String,
    )

    private fun sw(resp: ByteArray): String {
        if (resp.size < 2) return "0000"
        val sw1 = resp[resp.size - 2].toInt() and 0xFF
        val sw2 = resp[resp.size - 1].toInt() and 0xFF
        return String.format("%02X%02X", sw1, sw2)
    }

    private fun responseBody(resp: ByteArray): ByteArray =
        if (resp.size >= 2) resp.slice(0 until resp.size - 2).toByteArray() else resp

    fun run(isoDep: IsoDep, amountMinor: Long, currencyCode: String = "0840"): EmvData {
        // Generate Unpredictable Number (4 random bytes)
        val un = ByteArray(4).also { Random().nextBytes(it) }

        // 1. Select PPSE
        val ppseResp = isoDep.transceive(EmvApdu.selectPpse())
        val apps     = EmvPpseParser.parse(responseBody(ppseResp))
        val aid      = EmvPpseParser.selectBestAid(apps)
            ?: throw Exception("NO_SUPPORTED_AID")

        // 2. Select AID
        val aidResp  = isoDep.transceive(EmvApdu.selectAid(aid))
        if (sw(aidResp) != "9000") throw Exception("SELECT_AID_FAILED: ${sw(aidResp)}")
        val aidBody  = responseBody(aidResp)

        // The card publishes its own PDOL (tag 9F38). If we send anything else the card
        // rejects GPO with 6700 and no cryptogram can ever be produced — so honour it.
        val top      = EmvTlv.parse(aidBody)
        val fci      = EmvTlv.get(top, "6F")?.let { EmvTlv.parse(it) } ?: top
        val prop     = EmvTlv.get(fci, "A5")?.let { EmvTlv.parse(it) } ?: fci
        val pdolRaw  = EmvTlv.get(prop, "9F38")

        // 3. GET PROCESSING OPTIONS (GPO)
        val pdolEntries = pdolRaw?.let { parseDol(it) }.orEmpty()
        val pdolData = if (pdolEntries.isNotEmpty())
            buildDolData(pdolEntries, ctx(amountMinor, currencyCode, un, aid = aid))
        else buildPdolData(amountMinor, currencyCode, un)
        val gpoResp = isoDep.transceive(EmvApdu.buildGpo(pdolData))
        if (sw(gpoResp) != "9000") throw Exception("GPO_FAILED: ${sw(gpoResp)}")
        val gpoBody = responseBody(gpoResp)

        // Parse AIP + AFL from GPO.
        //  • Format 1 = template 80 → raw AIP(2) || AFL(n)
        //  • Format 2 = template 77 → BER-TLV containing tag 82 (AIP) + 94 (AFL)
        val gpoNodes = EmvTlv.parse(gpoBody)
        val t80 = EmvTlv.get(gpoNodes, "80")
        val t77 = EmvTlv.get(gpoNodes, "77")
        val aip: ByteArray
        val afl: ByteArray
        when {
            t80 != null && t80.size >= 2 -> {
                aip = t80.copyOfRange(0, 2)
                afl = if (t80.size > 2) t80.copyOfRange(2, t80.size) else ByteArray(0)
            }
            t77 != null -> {
                val fmt2 = EmvTlv.parse(t77)
                aip = EmvTlv.get(fmt2, "82") ?: throw Exception("GPO_AIP_MISSING")
                afl = EmvTlv.get(fmt2, "94") ?: ByteArray(0)
            }
            gpoBody.size >= 2 -> {
                aip = gpoBody.copyOfRange(0, 2)
                afl = if (gpoBody.size > 2) gpoBody.copyOfRange(2, gpoBody.size) else ByteArray(0)
            }
            else -> throw Exception("GPO_FORMAT_UNKNOWN")
        }

        // 4. READ RECORDS based on AFL
        val allRecords = mutableListOf<ByteArray>()
        var aflIdx = 0
        while (aflIdx + 3 < afl.size) {
            val sfi    = (afl[aflIdx].toInt() and 0xFF) shr 3
            val first  = afl[aflIdx + 1].toInt() and 0xFF
            val last   = afl[aflIdx + 2].toInt() and 0xFF
            aflIdx += 4
            for (rec in first..last) {
                val recResp = isoDep.transceive(EmvApdu.readRecord(sfi, rec))
                if (sw(recResp) == "9000") allRecords.add(responseBody(recResp))
            }
        }
        // Fallback: some cards return an empty AFL — sweep the common SFIs.
        if (allRecords.isEmpty()) {
            for (sfi in 1..3) for (rec in 1..5) {
                val recResp = isoDep.transceive(EmvApdu.readRecord(sfi, rec))
                if (sw(recResp) == "9000") allRecords.add(responseBody(recResp))
            }
        }

        // 5. Extract card data from records (deep parse — records are wrapped in template 70)
        val allNodes  = allRecords.flatMap { EmvTlv.parseDeep(it) }
        val track2Hex = EmvTlv.get(allNodes, "57")?.let { EmvTlv.toHex(it) }
        val pan = EmvTlv.get(allNodes, "5A")?.let { panBytesToString(it) }
            ?: track2Hex?.let { panFromTrack2(it) }
            ?: throw Exception("PAN_MISSING")
        if (pan.length < 12) throw Exception("PAN_INVALID")
        val expBcd = EmvTlv.get(allNodes, "5F24")
        val expiry = expBcd?.takeIf { it.size >= 2 }?.let { String.format("%02X%02X", it[0], it[1]) }
            ?: track2Hex?.let { expiryFromTrack2(it) }
            ?: throw Exception("EXPIRY_MISSING")
        val track2 = track2Hex

        // 6. Build CDOL1 data (card-supplied tag 8C when present) and GENERATE AC
        val cdol1Entries = EmvTlv.get(allNodes, "8C")?.let { parseDol(it) }.orEmpty()
        val cdol = if (cdol1Entries.isNotEmpty())
            buildDolData(cdol1Entries, ctx(amountMinor, currencyCode, un, expiry, aid))
        else buildCdolData(amountMinor, currencyCode, un, expiry)
        val genAcResp = isoDep.transceive(EmvApdu.generateAc(cdol))
        if (sw(genAcResp) != "9000") throw Exception("GENERATE_AC_FAILED: ${sw(genAcResp)}")
        val genAcBody = responseBody(genAcResp)
        val genNodes  = EmvTlv.parse(genAcBody)

        val arqc    = EmvTlv.get(genNodes, "9F26") ?: throw Exception("ARQC_MISSING")
        val atc     = EmvTlv.get(genNodes, "9F36") ?: byteArrayOf(0x00, 0x01)
        val iad     = EmvTlv.get(genNodes, "9F10") ?: byteArrayOf(0x07, 0x01)
        val cid     = EmvTlv.get(genNodes, "9F27") ?: byteArrayOf(0x80.toByte())
        val tvr     = byteArrayOf(0x00, 0x00, 0x00, 0x00, 0x00)
        val tsi     = byteArrayOf(0x00, 0x00)
        val txnDate = currentDate()
        val txnType = byteArrayOf(0x00) // Purchase

        // Encode amount as 6 bytes BCD
        val amtBcd  = amountToBcd(amountMinor)
        val ccyBcd  = EmvTlv.fromHex(currencyCode.padStart(4, '0'))
        val termCountry = byteArrayOf(0x08, 0x40.toByte()) // UAE 784 or 0840 USD
        val termCaps    = byteArrayOf(0xE0.toByte(), 0xF8.toByte(), 0xC8.toByte())
        val cvr         = byteArrayOf(0x02, 0x01, 0x02)
        val termType    = byteArrayOf(0x22)
        val ifdSerial   = "T2013001".toByteArray(Charsets.US_ASCII)
        val appVersion  = byteArrayOf(0x01, 0x01)
        val seqCounter  = byteArrayOf(0x00, 0x00, 0x01, 0x00)

        // 7. Build Field 55
        val field55 = EmvField55Builder.build(
            arqc, cid, iad, un, atc, tvr, txnDate, txnType,
            amtBcd, ccyBcd, aip, termCountry, termCaps, cvr,
            termType, ifdSerial, aid, appVersion, seqCounter
        )

        return EmvData(
            pan        = pan,
            expiry     = expiry,
            track2     = track2,
            field55Hex = EmvTlv.toHex(field55),
            atcHex     = EmvTlv.toHex(atc),
            unHex      = EmvTlv.toHex(un),
            arqcHex    = EmvTlv.toHex(arqc),
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOL (Data Object List) handling — PDOL (9F38) and CDOL1 (8C)
    // ─────────────────────────────────────────────────────────────────────────
    private data class DolEntry(val tag: String, val len: Int)

    /** Format of a DOL entry: 'n' = numeric BCD (len = digits), 'b' = binary (len = bytes), 'a' = ASCII. */
    private val DOL_FORMAT: Map<String, Char> = mapOf(
        "9F02" to 'n', "9F03" to 'n', "9F1A" to 'n', "5F2A" to 'n', "9A" to 'n',
        "9C" to 'n', "9F35" to 'n', "9F41" to 'n', "9F15" to 'n', "9F21" to 'n',
        "9F43" to 'n', "9F4D" to 'n', "5F28" to 'n', "9F42" to 'n', "9F51" to 'n',
        "9F52" to 'n', "9F62" to 'n',
        "9F37" to 'b', "95" to 'b', "9F33" to 'b', "9F40" to 'b', "9F09" to 'b',
        "9F66" to 'b', "9F6E" to 'b', "9F6D" to 'b', "9F34" to 'b', "9F10" to 'b',
        "9F26" to 'b', "9F36" to 'b', "9F27" to 'b', "9F45" to 'b', "9F4C" to 'b',
        "82" to 'b', "84" to 'b', "9F1D" to 'b', "9F7A" to 'b',
        "9F1E" to 'a', "9F4E" to 'a', "8A" to 'a', "50" to 'a'
    )

    private class DolContext(
        val amountMinor: Long, val currencyCode: String, val un: ByteArray,
        val expiry: String, val txnDate: ByteArray,
        val aid: ByteArray, val atc: ByteArray, val arqc: ByteArray,
        val iad: ByteArray, val cid: ByteArray
    )

    private fun ctx(
        amountMinor: Long, currencyCode: String, un: ByteArray,
        expiry: String = "", aid: ByteArray = ByteArray(0)
    ) = DolContext(
        amountMinor, currencyCode, un, expiry, currentDate(), aid,
        byteArrayOf(0x00, 0x01), ByteArray(8), byteArrayOf(0x07, 0x01), byteArrayOf(0x80.toByte())
    )

    /** Parses a BER-TLV DOL into (tag, length) entries. */
    private fun parseDol(dol: ByteArray): List<DolEntry> {
        val out = mutableListOf<DolEntry>()
        var i = 0
        while (i < dol.size) {
            val first = dol[i].toInt() and 0xFF
            var tag = String.format("%02X", first); i++
            if ((first and 0x1F) == 0x1F) {
                if (i >= dol.size) break
                tag += String.format("%02X", dol[i].toInt() and 0xFF); i++
            }
            if (i >= dol.size) break
            val lenByte = dol[i].toInt() and 0xFF; i++
            val len = when (lenByte) {
                0x81 -> { if (i >= dol.size) break; val l = dol[i].toInt() and 0xFF; i++; l }
                0x82 -> { if (i + 1 >= dol.size) break
                          val l = ((dol[i].toInt() and 0xFF) shl 8) or (dol[i + 1].toInt() and 0xFF); i += 2; l }
                else -> lenByte
            }
            out.add(DolEntry(tag, len))
        }
        return out
    }

    private fun dolByteLen(e: DolEntry): Int =
        if ((DOL_FORMAT[e.tag.uppercase(Locale.US)] ?: 'b') == 'n') (e.len + 1) / 2 else e.len

    private fun buildDolData(entries: List<DolEntry>, c: DolContext): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        for (e in entries) out.write(dolValue(e, c))
        return out.toByteArray()
    }

    private fun dolValue(e: DolEntry, c: DolContext): ByteArray {
        val v: ByteArray = when (e.tag.uppercase(Locale.US)) {
            "9F02" -> numBcd(c.amountMinor, e.len)
            "9F03" -> ByteArray(dolByteLen(e))
            "9F1A" -> EmvTlv.fromHex("0840")
            "5F2A" -> EmvTlv.fromHex(c.currencyCode.padStart(4, '0'))
            "9A"   -> c.txnDate
            "9C"   -> byteArrayOf(0x00)
            "9F21" -> currentTime()
            "9F35" -> byteArrayOf(0x22)
            "9F41" -> EmvTlv.fromHex("0001")
            "9F15" -> EmvTlv.fromHex("5999")
            "9F37" -> c.un
            "95"   -> ByteArray(5)
            "9F33" -> byteArrayOf(0xE0.toByte(), 0xF8.toByte(), 0xC8.toByte())
            "9F40" -> ByteArray(5)
            "9F09" -> byteArrayOf(0x00, 0x8C.toByte())
            "9F66" -> byteArrayOf(0x36, 0x00, 0x40, 0x00)
            "9F6E" -> byteArrayOf(0x00, 0x00, 0x00, 0x00)
            "9F34" -> byteArrayOf(0x3F, 0x00, 0x00)
            "9F10" -> c.iad
            "9F26" -> c.arqc
            "9F36" -> c.atc
            "9F27" -> c.cid
            "8A"   -> "00".toByteArray(Charsets.US_ASCII)
            "9F45" -> ByteArray(2)
            "9F4C" -> ByteArray(8)
            "84"   -> c.aid
            "9F1E" -> "T2013001".toByteArray(Charsets.US_ASCII)
            "9F4E" -> "PRIMESTACK".toByteArray(Charsets.US_ASCII)
            else   -> ByteArray(dolByteLen(e))
        }
        // Always emit exactly the length the card asked for — otherwise GPO/GENERATE AC
        // answers 6700 and the tap yields no cryptogram.
        val need = dolByteLen(e)
        return when {
            v.size == need -> v
            v.size > need  -> v.copyOfRange(0, need)
            else           -> v + ByteArray(need - v.size)
        }
    }

    /** Numeric value as BCD, left-padded to `digits` digits. */
    private fun numBcd(value: Long, digits: Int): ByteArray {
        val s = value.toString().padStart(digits, '0').takeLast(digits)
        return EmvTlv.fromHex(if (digits % 2 == 1) s.padStart(digits + 1, '0') else s)
    }

    private fun currentTime(): ByteArray =
        EmvTlv.fromHex(SimpleDateFormat("HHmmss", Locale.US).format(Date()))

    private fun panBytesToString(bcd: ByteArray): String =
        EmvTlv.toHex(bcd).trimEnd('F', 'f').filter { it.isDigit() }

    /** Extracts the PAN from Track 2 equivalent data (hex, 'D' separator). */
    private fun panFromTrack2(track2Hex: String): String? {
        val sep = track2Hex.indexOfFirst { it == 'D' || it == 'd' }
        val pan = if (sep >= 0) track2Hex.substring(0, sep) else track2Hex
        return pan.takeIf { it.length >= 12 && it.all { c -> c.isDigit() } }
    }

    /** Extracts the expiry (YYMM) from Track 2 equivalent data (hex). */
    private fun expiryFromTrack2(track2Hex: String): String? {
        val sep = track2Hex.indexOfFirst { it == 'D' || it == 'd' }
        if (sep < 0) return null
        val yymm = track2Hex.substring(sep + 1).take(4)
        return yymm.takeIf { it.length == 4 && it.all { c -> c.isDigit() } }
    }

    /** Converts an EMV expiry (YYMM) to the MM/YY format expected by the processor. */
    fun yyMmToMmyy(yymm: String): String {
        val d = yymm.filter { it.isDigit() }
        if (d.length < 4) return ""
        return "${d.substring(2, 4)}/${d.substring(0, 2)}"
    }

    private fun amountToBcd(amountMinor: Long): ByteArray {
        val s = amountMinor.toString().padStart(12, '0')
        return ByteArray(6) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    private fun currentDate(): ByteArray {
        val sdf = SimpleDateFormat("yyMMdd", Locale.US)
        val hex = sdf.format(Date())
        return EmvTlv.fromHex(hex)
    }

    private fun buildPdolData(amountMinor: Long, currencyCode: String, un: ByteArray): ByteArray {
        // Minimal PDOL: amount (6 bytes) + currency (2 bytes) + UN (4 bytes)
        return amountToBcd(amountMinor) +
               EmvTlv.fromHex(currencyCode.padStart(4, '0')) +
               un
    }

    private fun buildCdolData(amountMinor: Long, currencyCode: String, un: ByteArray, expiry: String): ByteArray {
        val txnDate = currentDate()
        return amountToBcd(amountMinor) +
               byteArrayOf(0x00, 0x00, 0x00, 0x00, 0x00, 0x00) + // amount other
               byteArrayOf(0x08, 0x40.toByte()) + // terminal country UAE/USD
               byteArrayOf(0x00, 0x00, 0x00, 0x00, 0x00) + // TVR
               EmvTlv.fromHex(currencyCode.padStart(4, '0')) +
               txnDate +
               byteArrayOf(0x00) + // txn type purchase
               un +
               byteArrayOf(0x22) + // terminal type
               byteArrayOf(0x00, 0x00) // merchant category
    }
}
