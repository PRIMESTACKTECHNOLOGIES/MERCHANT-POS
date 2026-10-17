package com.pos2013.offline.data.model

data class EmvCardData(
    val pan: String,
    val expiryDate: String, // Format: MM/YY
    val cardholderName: String? = null,
    val serviceCode: String? = null,
    val applicationLabel: String? = null,
    val emvData: String? = null, // Field 55 (DE55) TLV hex when available
    val readerSource: String = "EMV_CHIP",
    val cardBrand: String? = null,
    val cvmResult: String? = null,
    val pinVerified: Boolean? = null,
    val track2: String? = null,   // Track 2 equivalent data (hex)
    val arqc: String? = null,     // Application cryptogram (hex)
    val entryMode: String? = null, // CHIP_NFC for contactless taps
    val tapId: Long = 0L          // unique per tap so repeated taps re-emit
)
