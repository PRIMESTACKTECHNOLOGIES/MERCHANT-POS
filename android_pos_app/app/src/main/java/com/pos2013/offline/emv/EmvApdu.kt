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

    // GET PROCESSING OPTIONS
    fun buildGpo(pdolData: ByteArray = byteArrayOf()): ByteArray {
        val data = byteArrayOf(0x83.toByte(), pdolData.size.toByte()) + pdolData
        return byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00, 0x00, data.size.toByte()) + data + byteArrayOf(0x00)
    }

    // READ RECORD
    fun readRecord(sfi: Int, record: Int): ByteArray {
        val p2 = ((sfi shl 3) or 0x04).toByte()
        return byteArrayOf(0x00, 0xB2.toByte(), record.toByte(), p2, 0x00)
    }

    // GENERATE AC (ARQC)
    fun generateAc(cdolData: ByteArray): ByteArray {
        val p1 = 0x80.toByte() // ARQC
        return byteArrayOf(0x80.toByte(), 0xAE.toByte(), p1, 0x00, cdolData.size.toByte()) + cdolData + byteArrayOf(0x00)
    }
}
