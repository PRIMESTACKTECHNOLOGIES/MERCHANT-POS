package com.pos2013.offline.emv

import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.util.Log

/**
 * NFC EMV Tap Service — implements NfcAdapter.ReaderCallback.
 * Attach to your Activity via NfcAdapter.enableReaderMode().
 *
 * Usage:
 *   nfcAdapter.enableReaderMode(activity, EmvTapService(amount) { result ->
 *       // result.pan, result.field55Hex, result.arqcHex, etc.
 *   }, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B, null)
 */
class EmvTapService(
    private val amountMinor:  Long,
    private val currencyCode: String = "0840",
    private val onResult:     (Result<EmvKernel.EmvData>) -> Unit,
) : NfcAdapter.ReaderCallback {

    companion object { private const val TAG = "EmvTapService" }

    override fun onTagDiscovered(tag: Tag?) {
        val isoDep = IsoDep.get(tag) ?: run {
            Log.w(TAG, "Tag is not IsoDep (not an EMV card)")
            onResult(Result.failure(Exception("NOT_EMV_CARD")))
            return
        }
        try {
            isoDep.connect()
            isoDep.timeout = 10_000 // 10s timeout

            Log.i(TAG, "EMV card detected — running kernel")
            val emvData = EmvKernel.run(isoDep, amountMinor, currencyCode)
            Log.i(TAG, "EMV kernel complete — PAN=****${emvData.pan.takeLast(4)} ARQC=${emvData.arqcHex}")
            onResult(Result.success(emvData))
        } catch (e: Exception) {
            Log.e(TAG, "EMV kernel error: ${e.message}")
            onResult(Result.failure(e))
        } finally {
            runCatching { isoDep.close() }
        }
    }
}
