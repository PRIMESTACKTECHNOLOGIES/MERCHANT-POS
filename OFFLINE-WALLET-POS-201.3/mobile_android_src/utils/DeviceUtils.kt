package com.pos2013.utils

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import java.util.UUID

object DeviceUtils {

    /**
     * Retrieves a unique identifier for the device.
     * 
     * Prioritizes:
     * 1. Android ID (Secure Settings) - Most reliable for app installs
     * 2. Build.SERIAL (Deprecated in newer Android, but useful for older POS)
     * 3. UUID fallback (If all else fails)
     */
    @SuppressLint("HardwareIds")
    fun getDeviceSerialNumber(context: Context): String {
        return try {
            // 1. Try Android ID (Best for modern Android)
            val androidId = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID
            )
            
            if (!androidId.isNullOrEmpty() && androidId != "9774d56d682e549c") { // "9774d56d682e549c" is a known emulator bug ID
                return androidId.uppercase()
            }

            // 2. Try Build Serial (Legacy POS devices often use this)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                return Build.SERIAL.uppercase()
            } else {
                 try {
                     // On Android 8+, this requires permission READ_PHONE_STATE, which is hard to get.
                     // So we usually skip to Android ID or UUID.
                     return Build.getSerial().uppercase()
                 } catch (e: SecurityException) {
                     // Permission denied, fallback
                 }
            }

            // 3. Fallback: Generate a random UUID and store it locally
            // This effectively becomes the "Serial" for this installation
            getOrGenerateUUID(context)

        } catch (e: Exception) {
            getOrGenerateUUID(context)
        }
    }

    private fun getOrGenerateUUID(context: Context): String {
        val prefs = context.getSharedPreferences("pos_device_prefs", Context.MODE_PRIVATE)
        var uuid = prefs.getString("device_uuid", null)
        
        if (uuid == null) {
            uuid = UUID.randomUUID().toString().replace("-", "").substring(0, 16).uppercase()
            prefs.edit().putString("device_uuid", uuid).apply()
        }
        return uuid
    }
}
