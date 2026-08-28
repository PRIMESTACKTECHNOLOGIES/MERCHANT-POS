package com.pos2013.offline.utils 
 
import android.util.Base64 
import javax.crypto.Mac 
import javax.crypto.spec.SecretKeySpec 
 
object Protocol2013Helper { 
 
    // In real app, persist last STAN in SharedPreferences or DB 
    fun generateStan(lastStan: Int): String { 
        val nextStan = (lastStan + 1) % 1_000_000 
        return String.format("%06d", nextStan) 
    } 
 
    fun generateSignature( 
        protocolVersion: String, 
        merchantId: String, 
        terminalId: String, 
        batchId: String, 
        timestamp: Long, 
        nonce: String, 
        secretKey: String 
    ): String { 
        val data = "$protocolVersion|$merchantId|$terminalId|$batchId|$timestamp|$nonce" 
        val hmacSha256 = "HmacSHA256" 
        val secretKeySpec = SecretKeySpec(secretKey.toByteArray(), hmacSha256) 
        val mac = Mac.getInstance(hmacSha256) 
        mac.init(secretKeySpec) 
        val signatureBytes = mac.doFinal(data.toByteArray()) 
        return Base64.encodeToString(signatureBytes, Base64.NO_WRAP) 
    } 
}
