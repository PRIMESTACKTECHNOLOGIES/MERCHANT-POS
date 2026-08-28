# 🖨️ THERMAL PRINTER RECEIPT DESIGN (58mm / 80mm)

## Receipt Layout for Thermal Printer (58mm width)

```
--------------------------------
     AM GLOBAL PAYMENT
      Dubai, UAE
    +971 52 837 3634
--------------------------------
        SALE RECEIPT
--------------------------------
DATE:       22/03/2026
TIME:       14:35:22
STAN:       000847
TERM ID:    TERM-001
BATCH:      batch_1711114522
MERCHANT:   MRC-1001
--------------------------------
CARD:       VISA ****1111
ENTRY:      CONTACTLESS
--------------------------------
TOTAL:          AED 150.00

STATUS:     ✅ APPROVED
AUTH CODE:  123456
SETTLEMENT: SET-9847
--------------------------------

  Thank you for your business!
    Keep this receipt for
         your records

   Powered by POS 201.3

--------------------------------
```

## Receipt Layout (Compact Version for 58mm)

```
--------------------------------
   AM GLOBAL PAYMENT
   Dubai, UAE | MRC-1001
--------------------------------
       SALE RECEIPT
--------------------------------
DATE: 22/03/26  TIME: 14:35
STAN: 000847    TERM: TERM-001
CARD: VISA ****1111
--------------------------------
TOTAL:        AED 150.00
APPROVED - Auth: 123456
Settlement: SET-9847
--------------------------------
Thank you! Keep this receipt.
```

## ESC/POS Commands for Thermal Printer

```kotlin
object ThermalReceiptGenerator {
    
    // ESC/POS Command Constants
    private val ESC = 0x1B.toByte()
    private val GS = 0x1D.toByte()
    private val LF = 0x0A.toByte()
    private val CENTER = byteArrayOf(ESC, 0x61, 0x01)  // Center align
    private val LEFT = byteArrayOf(ESC, 0x61, 0x00)    // Left align
    private val BOLD_ON = byteArrayOf(ESC, 0x45, 0x01) // Bold on
    private val BOLD_OFF = byteArrayOf(ESC, 0x45, 0x00) // Bold off
    private val DOUBLE_HEIGHT = byteArrayOf(ESC, 0x21, 0x10) // Double height
    private val NORMAL_SIZE = byteArrayOf(ESC, 0x21, 0x00)   // Normal size
    private val CUT_PAPER = byteArrayOf(GS, 0x56, 0x00)      // Cut paper
    
    fun generateThermalReceipt(
        transaction: TransactionEntity,
        merchantName: String = "AM GLOBAL PAYMENT",
        merchantAddress: String = "Dubai, UAE",
        merchantPhone: String = "+971 52 837 3634"
    ): ByteArray {
        val receipt = StringBuilder()
        
        // Header - Centered & Bold
        receipt.append(ESC_POS_Constants.CENTER)
        receipt.append(ESC_POS_Constants.BOLD_ON)
        receipt.append("AM GLOBAL PAYMENT\n")
        receipt.append(ESC_POS_Constants.BOLD_OFF)
        receipt.append("Dubai, UAE\n")
        receipt.append("+971 52 837 3634\n")
        receipt.append(ESC_POS_Constants.LEFT)
        receipt.append("--------------------------------\n")
        
        // Title
        receipt.append(ESC_POS_Constants.CENTER)
        receipt.append(ESC_POS_Constants.BOLD_ON)
        receipt.append("SALE RECEIPT\n")
        receipt.append(ESC_POS_Constants.BOLD_OFF)
        receipt.append(ESC_POS_Constants.LEFT)
        receipt.append("--------------------------------\n")
        
        // Transaction Details
        receipt.append("DATE: ${formatDate(transaction.timestamp)}\n")
        receipt.append("TIME: ${formatTime(transaction.timestamp)}\n")
        receipt.append("STAN: ${transaction.stan}\n")
        receipt.append("TERM: ${transaction.terminalId}\n")
        receipt.append("BATCH: ${transaction.batchId?.take(15) ?: "N/A"}\n")
        receipt.append("MERCHANT: ${transaction.merchantId ?: "MRC-1001"}\n")
        receipt.append("--------------------------------\n")
        
        // Card Details
        transaction.panMasked?.let {
            receipt.append("CARD: ${transaction.cardType ?: "CARD"} $it\n")
        }
        transaction.entryMode?.let {
            receipt.append("ENTRY: $it\n")
        }
        receipt.append("--------------------------------\n")
        
        // Amount - Double Height
        receipt.append(ESC_POS_Constants.DOUBLE_HEIGHT)
        receipt.append(ESC_POS_Constants.BOLD_ON)
        receipt.append("TOTAL: ${transaction.getAmountDisplay().padStart(24)}\n")
        receipt.append(ESC_POS_Constants.BOLD_OFF)
        receipt.append(ESC_POS_Constants.NORMAL_SIZE)
        receipt.append("\n")
        
        // Status
        receipt.append(ESC_POS_Constants.CENTER)
        receipt.append(ESC_POS_Constants.BOLD_ON)
        val status = if (transaction.status == "APPROVED") "✅ APPROVED" else "❌ ${transaction.status}"
        receipt.append("$status\n")
        receipt.append(ESC_POS_Constants.BOLD_OFF)
        receipt.append(ESC_POS_Constants.LEFT)
        
        transaction.authCode?.let {
            receipt.append("AUTH CODE: $it\n")
        }
        transaction.settlementCode?.let {
            receipt.append("SETTLEMENT: $it\n")
        }
        receipt.append("--------------------------------\n")
        
        // Footer
        receipt.append(ESC_POS_Constants.CENTER)
        receipt.append("\n")
        receipt.append("Thank you for your business!\n")
        receipt.append("Keep this receipt for your\n")
        receipt.append("records\n")
        receipt.append("\n")
        receipt.append("Powered by POS 201.3\n")
        receipt.append(ESC_POS_Constants.LEFT)
        receipt.append("--------------------------------\n")
        receipt.append("\n\n\n") // Feed paper
        receipt.append(ESC_POS_Constants.CUT_PAPER)
        
        return receipt.toString().toByteArray(Charsets.UTF_8)
    }
}
```

## Recommended Thermal Printers

| Printer | Width | Connection | Price | Best For |
|---------|-------|------------|-------|----------|
| **EPSON TM-T20II** | 80mm | USB/Ethernet | $200 | High volume |
| **Xprinter XP-58IIH** | 58mm | USB/Bluetooth | $50 | Budget friendly |
| **GOOJPRT MTP-3** | 80mm | Bluetooth/USB | $80 | Mobile/POS |
| **Zjiang ZJ-58** | 58mm | USB/Bluetooth | $40 | Basic use |

## Android Integration

```kotlin
// In your ReceiptActivity.kt or MainActivity.kt

fun printThermalReceipt(transaction: TransactionEntity) {
    try {
        // 1. Get Bluetooth Printer
        val bluetoothAdapter = BluetoothAdapter.getDefaultAdapter()
        val printerDevice = bluetoothAdapter?.bondedDevices?.find { 
            it.name.contains("Printer") || it.name.contains("POS") 
        }
        
        if (printerDevice == null) {
            Toast.makeText(this, "Printer not paired", Toast.LENGTH_SHORT).show()
            return
        }
        
        // 2. Connect via Bluetooth
        val socket = printerDevice.createRfcommSocketToServiceRecord(
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        )
        socket.connect()
        
        // 3. Generate & Send Receipt
        val receiptData = ThermalReceiptGenerator.generateThermalReceipt(transaction)
        socket.outputStream.write(receiptData)
        socket.outputStream.flush()
        
        // 4. Close Connection
        socket.close()
        Toast.makeText(this, "Receipt printed!", Toast.LENGTH_SHORT).show()
        
    } catch (e: Exception) {
        Toast.makeText(this, "Print failed: ${e.message}", Toast.LENGTH_SHORT).show()
    }
}
```

## Receipt Paper Specifications

| Paper Type | Width | Length | Use Case |
|------------|-------|--------|----------|
| **58mm Thermal** | 57.5mm | 30m | Compact receipts |
| **80mm Thermal** | 79.5mm | 80m | Full-size receipts |
| **Black Mark** | 80mm | Varies | Label printing |

## QR Code on Receipt (Optional)

Add QR code for digital receipt verification:
```
--------------------------------
Scan for digital receipt:
   [QR CODE HERE]
https://your-pos.com/verify/123
--------------------------------
```
