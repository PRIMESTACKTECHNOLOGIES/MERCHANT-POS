
import android.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.nio.charset.StandardCharsets

/**
 * 201.3 Protocol Security Helper
 * Use this function to sign your offline batches before uploading.
 */
object PosSecurity {

    /**
     * Generates HMAC-SHA256 signature for 201.3 Protocol
     * 
     * @param key The Terminal Secret Key (e.g., "s3cr3t-key-for-T2013-0001")
     * @param data The data string: "protocolVersion|merchantId|terminalId|batchId|timestamp|nonce"
     * @return Base64 encoded signature string
     */
    fun hmacSha256(key: String, data: String): String {
        try {
            val secretKey = SecretKeySpec(key.toByteArray(StandardCharsets.UTF_8), "HmacSHA256")
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(secretKey)
            val raw = mac.doFinal(data.toByteArray(StandardCharsets.UTF_8))
            return Base64.encodeToString(raw, Base64.NO_WRAP)
        } catch (e: Exception) {
            e.printStackTrace()
            return ""
        }
    }
}
