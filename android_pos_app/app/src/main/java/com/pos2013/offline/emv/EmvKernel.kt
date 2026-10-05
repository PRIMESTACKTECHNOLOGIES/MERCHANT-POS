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

        // 3. GET PROCESSING OPTIONS (GPO) — build minimal PDOL data
        val pdol = buildPdolData(amountMinor, currencyCode, un)
        val gpoResp = isoDep.transceive(EmvApdu.buildGpo(pdol))
        if (sw(gpoResp) != "9000") throw Exception("GPO_FAILED: ${sw(gpoResp)}")
        val gpoBody = responseBody(gpoResp)

        // Parse AIP + AFL from GPO (80 or 77 template)
        val gpoNodes = EmvTlv.parse(gpoBody)
        val gpoData  = EmvTlv.get(gpoNodes, "80") ?: EmvTlv.get(gpoNodes, "77") ?: gpoBody
        val aip      = gpoData.slice(0..1).toByteArray()
        val afl      = gpoData.slice(2 until gpoData.size).toByteArray()

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

        // 5. Extract card data from records
        val allNodes = allRecords.flatMap { EmvTlv.parse(it) }
        val pan      = EmvTlv.get(allNodes, "5A")?.let { panBytesToString(it) } ?: "0000000000000000"
        val expBcd   = EmvTlv.get(allNodes, "5F24")
        val expiry   = expBcd?.let { String.format("%02X%02X", it[0], it[1]) } ?: "3012" // YYMM
        val track2   = EmvTlv.get(allNodes, "57")?.let { EmvTlv.toHex(it) }

        // 6. Build CDOL1 data and GENERATE AC
        val cdol = buildCdolData(amountMinor, currencyCode, un, expiry)
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

    private fun panBytesToString(bcd: ByteArray): String {
        val hex = EmvTlv.toHex(bcd)
        return hex.trimEnd('F', 'f')
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
