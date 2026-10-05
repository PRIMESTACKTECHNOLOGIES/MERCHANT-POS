package com.pos2013.offline.emv

/**
 * Builds EMV Field 55 (DE55) TLV block from individual EMV tags.
 * This is sent in ISO 8583 DE55 to the issuer for online authorization.
 */
object EmvField55Builder {

    fun build(
        arqc:    ByteArray,        // 9F26
        cid:     ByteArray,        // 9F27
        iad:     ByteArray,        // 9F10
        un:      ByteArray,        // 9F37
        atc:     ByteArray,        // 9F36
        tvr:     ByteArray,        // 95
        txnDate: ByteArray,        // 9A
        txnType: ByteArray,        // 9C
        amount:  ByteArray,        // 9F02
        currency:ByteArray,        // 5F2A
        aip:     ByteArray,        // 82
        termCountry: ByteArray,    // 9F1A
        termCaps:    ByteArray,    // 9F33
        cvr:     ByteArray,        // 9F34
        termType:    ByteArray,    // 9F35
        ifdSerial:   ByteArray,    // 9F1E
        aid:     ByteArray,        // 84
        appVersion:  ByteArray,    // 9F09
        seqCounter:  ByteArray,    // 9F41
    ): ByteArray {
        return EmvTlv.buildTlv("9F26", arqc) +
               EmvTlv.buildTlv("9F27", cid) +
               EmvTlv.buildTlv("9F10", iad) +
               EmvTlv.buildTlv("9F37", un) +
               EmvTlv.buildTlv("9F36", atc) +
               EmvTlv.buildTlv("95", tvr) +
               EmvTlv.buildTlv("9A", txnDate) +
               EmvTlv.buildTlv("9C", txnType) +
               EmvTlv.buildTlv("9F02", amount) +
               EmvTlv.buildTlv("5F2A", currency) +
               EmvTlv.buildTlv("82", aip) +
               EmvTlv.buildTlv("9F1A", termCountry) +
               EmvTlv.buildTlv("9F33", termCaps) +
               EmvTlv.buildTlv("9F34", cvr) +
               EmvTlv.buildTlv("9F35", termType) +
               EmvTlv.buildTlv("9F1E", ifdSerial) +
               EmvTlv.buildTlv("84", aid) +
               EmvTlv.buildTlv("9F09", appVersion) +
               EmvTlv.buildTlv("9F41", seqCounter)
    }
}
