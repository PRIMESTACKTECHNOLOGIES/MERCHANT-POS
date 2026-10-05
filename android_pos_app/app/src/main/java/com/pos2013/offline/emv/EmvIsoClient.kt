package com.pos2013.offline.emv

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sends EMV authorization request to the backend ISO 8583 endpoint.
 * The backend handles ARQC validation via IssuerEmvValidator + HSM.
 */
class EmvIsoClient(private val backendBaseUrl: String, private val apiKey: String) {

    companion object { private const val TAG = "EmvIsoClient" }

    data class IsoAuthResponse(
        val approved:    Boolean,
        val arc:         String,   // DE39 response code
        val approvalCode:String,   // DE38
        val field55Hex:  String?,  // DE55 issuer scripts
        val error:       String?,
    )

    suspend fun authorize(emvData: EmvKernel.EmvData, amountMinor: Long, currency: String = "840", merchantId: String, terminalId: String): IsoAuthResponse =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("mti",           "0100")
                put("pan",           emvData.pan)
                put("amountMinor",   amountMinor)
                put("currency",      currency)
                put("expiry",        emvData.expiry)
                put("field55Hex",    emvData.field55Hex)
                put("atcHex",        emvData.atcHex)
                put("arqcHex",       emvData.arqcHex)
                put("merchantId",    merchantId)
                put("terminalId",    terminalId)
                put("entryMode",     "CHIP_NFC")
            }.toString()

            val url = URL("$backendBaseUrl/api/issuer/emv/authorize-iso8583")
            val conn = url.openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type",  "application/json")
                conn.setRequestProperty("Authorization", "Bearer $apiKey")
                conn.doOutput = true
                conn.connectTimeout = 15_000
                conn.readTimeout    = 15_000
                OutputStreamWriter(conn.outputStream).use { it.write(body) }

                val respCode = conn.responseCode
                val respBody = (if (respCode < 400) conn.inputStream else conn.errorStream)
                    .bufferedReader().readText()

                Log.d(TAG, "ISO auth response HTTP $respCode: $respBody")
                val json = JSONObject(respBody)
                IsoAuthResponse(
                    approved     = json.optBoolean("approved", false),
                    arc          = json.optString("arc", "05"),
                    approvalCode = json.optString("approvalCode", ""),
                    field55Hex   = json.optString("field55Hex").takeIf { it.isNotEmpty() },
                    error        = json.optString("error").takeIf { it.isNotEmpty() },
                )
            } finally {
                conn.disconnect()
            }
        }
}
