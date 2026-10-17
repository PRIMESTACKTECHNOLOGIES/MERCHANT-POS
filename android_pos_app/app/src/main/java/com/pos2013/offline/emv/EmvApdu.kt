package com.pos2013.offline.emv

/**
 * EMV APDU builder — builds standard EMV command APDUs.
 */
object EmvApdu {

    // SELECT PPSE
    fun selectPpse(): ByteArray {
        val ppse = "2PAY.SYS.DDF01".toByteArray(Charsets.US_ASCII)
        return byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, ppse.size.toByte()) + ppse + byteArrayOf(0x00)
    }

    // SELECT AID
    fun selectAid(aid: ByteArray): ByteArray =
        byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, aid.size.toByte()) + aid + byteArrayOf(0x00)

    // GET PROCESSING OPTIONS — the 83 template carries the PDOL data.
    fun buildGpo(pdolData: ByteArray = byteArrayOf()): ByteArray {
        val body = buildTlv("83", pdolData)
        return byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00, 0x00) + lc(body.size) + body + byteArrayOf(0x00)
    }

    // READ RECORD
    fun readRecord(sfi: Int, record: Int): ByteArray {
        val p2 = ((sfi shl 3) or 0x04).toByte()
        return byteArrayOf(0x00, 0xB2.toByte(), record.toByte(), p2, 0x00)
    }

    // GENERATE AC (ARQC)
    fun generateAc(cdolData: ByteArray): ByteArray =
        byteArrayOf(0x80.toByte(), 0xAE.toByte(), 0x80.toByte(), 0x00) + lc(cdolData.size) + cdolData + byteArrayOf(0x00)

    /** BER length encoding — single byte below 0x80, otherwise 0x81/0x82 prefixed. */
    private fun lc(n: Int): ByteArray = when {
        n < 0x80   -> byteArrayOf(n.toByte())
        n < 0x100  -> byteArrayOf(0x81.toByte(), n.toByte())
        else       -> byteArrayOf(0x82.toByte(), (n shr 8).toByte(), (n and 0xFF).toByte())
    }

    private fun buildTlv(tagHex: String, value: ByteArray): ByteArray =
        EmvTlv.fromHex(tagHex) + lc(value.size) + value
}
