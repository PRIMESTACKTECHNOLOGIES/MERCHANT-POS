package com.pos2013.offline.util

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.widget.Toast
import com.pos2013.offline.data.local.entity.TransactionEntity
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.*

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THERMAL PRINTER RECEIPT GENERATOR (58mm / 80mm)
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * This class generates receipts formatted for thermal printers.
 * Supports both 58mm and 80mm paper widths.
 * 
 * COMPATIBLE PRINTERS:
 * - EPSON TM-T20II (80mm, USB/Ethernet)
 * - Xprinter XP-58IIH (58mm, USB/Bluetooth)
 * - GOOJPRT MTP-3 (80mm, Bluetooth/USB)
 * - Zjiang ZJ-58 (58mm, USB/Bluetooth)
 * 
 * ═════════════════════════════════════════════════════════════════════════════
 */
object ThermalReceiptGenerator {

    // ESC/POS Command Constants
    private const val ESC = 0x1B.toChar()
    private const val GS = 0x1D.toChar()
    private const val LF = '\n'
    
    // Alignment commands
    private val ALIGN_CENTER = "$ESC\u0061\u0001"  // ESC a 1
    private val ALIGN_LEFT = "$ESC\u0061\u0000"    // ESC a 0
    private val ALIGN_RIGHT = "$ESC\u0061\u0002"   // ESC a 2
    
    // Text formatting
    private val BOLD_ON = "$ESC\u0045\u0001"       // ESC E 1
    private val BOLD_OFF = "$ESC\u0045\u0000"      // ESC E 0
    private val DOUBLE_HEIGHT = "$ESC\u0021\u0010" // ESC ! 16
    private val DOUBLE_WIDTH = "$ESC\u0021\u0020"  // ESC ! 32
    private val NORMAL_SIZE = "$ESC\u0021\u0000"   // ESC ! 0
    
    // Paper commands
    private val CUT_PAPER = "$GS\u0056\u0000"      // GS V 0 (full cut)
    private val PARTIAL_CUT = "$GS\u0056\u0001"    // GS V 1 (partial cut)
    private val LINE_FEED = "$LF"
    
    // Barcode/QR (optional)
    private val BARCODE_HEIGHT = "$GS\u0068\u0064" // GS h 100
    private val BARCODE_WIDTH = "$GS\u0077\u0002"  // GS w 2

    /**
     * Generate thermal receipt for 58mm printer
     * 
     * @param transaction The transaction to print
     * @param merchantName Your business name
     * @param merchantAddress Your business address
     * @param merchantPhone Your business phone
     * @param isOffline Whether this was an offline transaction
     * @return Byte array ready to send to printer
     */
    fun generate58mmReceipt(
        transaction: TransactionEntity,
        merchantName: String = "AM GLOBAL PAYMENT",
        merchantAddress: String = "Dubai, UAE",
        merchantPhone: String = "+971 52 837 3634",
        isOffline: Boolean = false
    ): ByteArray {
        val sb = StringBuilder()
        
        // Initialize printer
        sb.append(ALIGN_LEFT)
        sb.append(NORMAL_SIZE)
        
        // Header - Centered
        sb.append(ALIGN_CENTER)
        sb.append(BOLD_ON)
        sb.append(merchantName.take(16)) // Max 16 chars for 58mm
        sb.append(LINE_FEED)
        sb.append(BOLD_OFF)
        sb.append(merchantAddress)
        sb.append(LINE_FEED)
        sb.append(merchantPhone)
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Separator line
        sb.append("--------------------------------")
        sb.append(LINE_FEED)
        
        // Title
        sb.append(BOLD_ON)
        sb.append("     SALE RECEIPT")
        sb.append(LINE_FEED)
        sb.append(BOLD_OFF)
        sb.append("--------------------------------")
        sb.append(LINE_FEED)
        
        // Transaction details - Left aligned
        sb.append(ALIGN_LEFT)
        sb.append("DATE: ${formatDate(transaction.txnTimestamp)}")
        sb.append(LINE_FEED)
        sb.append("TIME: ${formatTime(transaction.txnTimestamp)}")
        sb.append(LINE_FEED)
        sb.append("STAN: ${transaction.stan}")
        sb.append(LINE_FEED)
        sb.append("TERM: ${transaction.terminalId}")
        sb.append(LINE_FEED)
        sb.append("BATCH: ${transaction.batchId?.take(12) ?: "N/A"}")
        sb.append(LINE_FEED)
        sb.append("--------------------------------")
        sb.append(LINE_FEED)
        
        // Card details
        transaction.panMasked?.let {
            sb.append("CARD: ${transaction.cardType ?: "CARD"} $it")
            sb.append(LINE_FEED)
        }
        transaction.entryMode?.let {
            sb.append("ENTRY: $it")
            sb.append(LINE_FEED)
        }
        sb.append("--------------------------------")
        sb.append(LINE_FEED)
        
        // Amount - Big and bold
        sb.append(BOLD_ON)
        sb.append(DOUBLE_HEIGHT)
        sb.append("TOTAL:")
        sb.append(NORMAL_SIZE)
        sb.append(BOLD_OFF)
        sb.append(LINE_FEED)
        
        sb.append(ALIGN_CENTER)
        sb.append(BOLD_ON)
        sb.append(DOUBLE_HEIGHT)
        sb.append(transaction.getAmountDisplay())
        sb.append(NORMAL_SIZE)
        sb.append(BOLD_OFF)
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Status
        sb.append(ALIGN_CENTER)
        val status = if (transaction.status == "APPROVED") "✓ APPROVED" else "✗ ${transaction.status}"
        sb.append(BOLD_ON)
        sb.append(status)
        sb.append(BOLD_OFF)
        sb.append(LINE_FEED)
        
        // Offline warning
        if (isOffline) {
            sb.append(LINE_FEED)
            sb.append("⚠ OFFLINE TRANSACTION")
            sb.append(LINE_FEED)
            sb.append("Will sync when online")
            sb.append(LINE_FEED)
        }
        
        // Auth & Settlement
        sb.append(ALIGN_LEFT)
        transaction.authCode?.let {
            sb.append("AUTH: $it")
            sb.append(LINE_FEED)
        }
        transaction.settlementCode?.let {
            sb.append("SETTLEMENT: $it")
            sb.append(LINE_FEED)
        }
        sb.append("--------------------------------")
        sb.append(LINE_FEED)
        
        // Footer
        sb.append(ALIGN_CENTER)
        sb.append(LINE_FEED)
        sb.append("Thank you!")
        sb.append(LINE_FEED)
        sb.append("Keep this receipt")
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        sb.append("POS 201.3")
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Cut paper
        sb.append(CUT_PAPER)
        
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Generate thermal receipt for 80mm printer (wider format)
     */
    fun generate80mmReceipt(
        transaction: TransactionEntity,
        merchantName: String = "AM GLOBAL PAYMENT",
        merchantAddress: String = "Dubai, UAE",
        merchantPhone: String = "+971 52 837 3634",
        isOffline: Boolean = false
    ): ByteArray {
        val sb = StringBuilder()
        
        // Initialize
        sb.append(ALIGN_LEFT)
        sb.append(NORMAL_SIZE)
        
        // Header
        sb.append(ALIGN_CENTER)
        sb.append(BOLD_ON)
        sb.append(merchantName)
        sb.append(LINE_FEED)
        sb.append(BOLD_OFF)
        sb.append(merchantAddress)
        sb.append(LINE_FEED)
        sb.append("Tel: $merchantPhone")
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Separator
        sb.append("----------------------------------------")
        sb.append(LINE_FEED)
        
        // Title
        sb.append(BOLD_ON)
        sb.append("          SALE RECEIPT")
        sb.append(LINE_FEED)
        sb.append(BOLD_OFF)
        sb.append("----------------------------------------")
        sb.append(LINE_FEED)
        
        // Transaction details in columns
        sb.append(ALIGN_LEFT)
        sb.append(String.format("%-12s %s", "DATE:", formatDate(transaction.txnTimestamp)))
        sb.append(LINE_FEED)
        sb.append(String.format("%-12s %s", "TIME:", formatTime(transaction.txnTimestamp)))
        sb.append(LINE_FEED)
        sb.append(String.format("%-12s %s", "STAN:", transaction.stan))
        sb.append(LINE_FEED)
        sb.append(String.format("%-12s %s", "TERMINAL:", transaction.terminalId))
        sb.append(LINE_FEED)
        sb.append(String.format("%-12s %s", "BATCH:", transaction.batchId?.take(20) ?: "N/A"))
        sb.append(LINE_FEED)
        sb.append(String.format("%-12s %s", "MERCHANT:", transaction.merchantId ?: "MRC-1001"))
        sb.append(LINE_FEED)
        sb.append("----------------------------------------")
        sb.append(LINE_FEED)
        
        // Card details
        transaction.panMasked?.let {
            sb.append(String.format("%-12s %s %s", "CARD:", transaction.cardType ?: "CARD", it))
            sb.append(LINE_FEED)
        }
        transaction.entryMode?.let {
            sb.append(String.format("%-12s %s", "ENTRY MODE:", it))
            sb.append(LINE_FEED)
        }
        sb.append("----------------------------------------")
        sb.append(LINE_FEED)
        
        // Amount
        sb.append(ALIGN_CENTER)
        sb.append(BOLD_ON)
        sb.append("TOTAL AMOUNT")
        sb.append(LINE_FEED)
        sb.append(DOUBLE_HEIGHT)
        sb.append(transaction.getAmountDisplay())
        sb.append(NORMAL_SIZE)
        sb.append(BOLD_OFF)
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Status
        val status = if (transaction.status == "APPROVED") "✓ APPROVED" else "✗ ${transaction.status}"
        sb.append(BOLD_ON)
        sb.append(status)
        sb.append(BOLD_OFF)
        sb.append(LINE_FEED)
        
        if (isOffline) {
            sb.append(LINE_FEED)
            sb.append("⚠ OFFLINE TRANSACTION")
            sb.append(LINE_FEED)
            sb.append("This transaction will be processed when online")
            sb.append(LINE_FEED)
        }
        
        // Auth codes
        sb.append(ALIGN_LEFT)
        transaction.authCode?.let {
            sb.append(String.format("%-12s %s", "AUTH CODE:", it))
            sb.append(LINE_FEED)
        }
        transaction.settlementCode?.let {
            sb.append(String.format("%-12s %s", "SETTLEMENT:", it))
            sb.append(LINE_FEED)
        }
        sb.append("----------------------------------------")
        sb.append(LINE_FEED)
        
        // Footer
        sb.append(ALIGN_CENTER)
        sb.append(LINE_FEED)
        sb.append("Thank you for your business!")
        sb.append(LINE_FEED)
        sb.append("Keep this receipt for your records")
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        sb.append("Powered by POS 201.3")
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        sb.append(LINE_FEED)
        
        // Cut
        sb.append(CUT_PAPER)
        
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Print receipt via Bluetooth thermal printer
     * 
     * @param context Android context
     * @param printerName Name of paired Bluetooth printer (e.g., "XP-58", "Printer")
     * @param receiptData Byte array from generate58mmReceipt() or generate80mmReceipt()
     * @return true if successful, false otherwise
     */
    fun printViaBluetooth(
        context: Context,
        printerName: String = "Printer",
        receiptData: ByteArray
    ): Boolean {
        var bluetoothSocket: BluetoothSocket? = null
        var outputStream: OutputStream? = null
        
        try {
            // Get Bluetooth adapter
            val bluetoothAdapter = BluetoothAdapter.getDefaultAdapter()
                ?: throw Exception("Bluetooth not supported")
            
            if (!bluetoothAdapter.isEnabled) {
                throw Exception("Bluetooth is disabled")
            }
            
            // Find paired printer
            val pairedDevices = bluetoothAdapter.bondedDevices
            val printer = pairedDevices.find { 
                it.name.contains(printerName, ignoreCase = true) ||
                it.name.contains("POS", ignoreCase = true) ||
                it.name.contains("Printer", ignoreCase = true)
            } ?: throw Exception("Printer not found. Please pair your thermal printer first.")
            
            // Connect to printer
            val uuid = java.util.UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
            bluetoothSocket = printer.createRfcommSocketToServiceRecord(uuid)
            bluetoothSocket.connect()
            
            // Send data
            outputStream = bluetoothSocket.outputStream
            outputStream.write(receiptData)
            outputStream.flush()
            
            // Small delay to ensure data is sent
            Thread.sleep(500)
            
            Toast.makeText(context, "Receipt printed!", Toast.LENGTH_SHORT).show()
            return true
            
        } catch (e: Exception) {
            Toast.makeText(context, "Print failed: ${e.message}", Toast.LENGTH_LONG).show()
            return false
        } finally {
            try {
                outputStream?.close()
                bluetoothSocket?.close()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    /**
     * Check if Bluetooth printer is paired
     */
    fun isPrinterPaired(printerName: String = "Printer"): Boolean {
        val bluetoothAdapter = BluetoothAdapter.getDefaultAdapter() ?: return false
        if (!bluetoothAdapter.isEnabled) return false
        
        return bluetoothAdapter.bondedDevices.any { 
            it.name.contains(printerName, ignoreCase = true) ||
            it.name.contains("POS", ignoreCase = true) ||
            it.name.contains("Printer", ignoreCase = true)
        }
    }

    /**
     * Get list of paired printers
     */
    fun getPairedPrinters(): List<String> {
        val bluetoothAdapter = BluetoothAdapter.getDefaultAdapter() ?: return emptyList()
        if (!bluetoothAdapter.isEnabled) return emptyList()
        
        return bluetoothAdapter.bondedDevices
            .filter { it.name.contains("Print", ignoreCase = true) }
            .map { it.name }
    }

    // Helper functions
    private fun formatDate(timestamp: Long): String {
        return SimpleDateFormat("dd/MM/yyyy", Locale.US).format(Date(timestamp))
    }

    private fun formatTime(timestamp: Long): String {
        return SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(timestamp))
    }

    // UUID for Bluetooth SPP
    private val DEFAULT_UUID = java.util.UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
}

/**
 * Extension function for easy printing from TransactionEntity
 */
fun TransactionEntity.printThermalReceipt(
    context: Context,
    isOffline: Boolean = false,
    printerName: String = "Printer"
) {
    val receiptData = ThermalReceiptGenerator.generate58mmReceipt(
        transaction = this,
        isOffline = isOffline
    )
    ThermalReceiptGenerator.printViaBluetooth(context, printerName, receiptData)
}
