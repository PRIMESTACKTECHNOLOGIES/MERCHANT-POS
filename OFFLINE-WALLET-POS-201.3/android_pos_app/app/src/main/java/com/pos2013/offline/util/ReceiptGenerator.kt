package com.pos2013.offline.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Environment
import androidx.core.content.FileProvider
import com.pos2013.offline.data.local.entity.TransactionEntity
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*

/**
 * Generates professional PDF receipts for transactions.
 */
class ReceiptGenerator(private val context: Context) {

    companion object {
        private const val RECEIPT_WIDTH = 384 // 80mm receipt printer width in pixels
        private const val RECEIPT_PADDING = 16
        private const val LINE_HEIGHT = 24
        private const val TEXT_SIZE_SMALL = 10f
        private const val TEXT_SIZE_NORMAL = 12f
        private const val TEXT_SIZE_LARGE = 16f
        private const val TEXT_SIZE_HEADER = 20f
    }

    /**
     * Generate a PDF receipt for a transaction
     */
    fun generateReceipt(
        transaction: TransactionEntity,
        merchantName: String = "AM GLOBAL PAYMENT",
        merchantAddress: String = "Dubai, UAE",
        merchantPhone: String = "+971 52 837 3634"
    ): File {
        val pdfDocument = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(RECEIPT_WIDTH, calculateReceiptHeight(transaction), 1).create()
        val page = pdfDocument.startPage(pageInfo)
        val canvas = page.canvas

        var yPosition = RECEIPT_PADDING

        // Paint objects
        val headerPaint = Paint().apply {
            color = Color.BLACK
            textSize = TEXT_SIZE_HEADER
            typeface = Typeface.DEFAULT_BOLD
            textAlign = Paint.Align.CENTER
        }

        val titlePaint = Paint().apply {
            color = Color.BLACK
            textSize = TEXT_SIZE_LARGE
            typeface = Typeface.DEFAULT_BOLD
            textAlign = Paint.Align.CENTER
        }

        val normalPaint = Paint().apply {
            color = Color.BLACK
            textSize = TEXT_SIZE_NORMAL
            typeface = Typeface.DEFAULT
        }

        val boldPaint = Paint().apply {
            color = Color.BLACK
            textSize = TEXT_SIZE_NORMAL
            typeface = Typeface.DEFAULT_BOLD
        }

        val smallPaint = Paint().apply {
            color = Color.DKGRAY
            textSize = TEXT_SIZE_SMALL
            typeface = Typeface.DEFAULT
        }

        val linePaint = Paint().apply {
            color = Color.GRAY
            strokeWidth = 1f
        }

        // Merchant Header
        canvas.drawText(merchantName, RECEIPT_WIDTH / 2f, yPosition.toFloat(), headerPaint)
        yPosition += LINE_HEIGHT
        canvas.drawText(merchantAddress, RECEIPT_WIDTH / 2f, yPosition.toFloat(), smallPaint)
        yPosition += LINE_HEIGHT
        canvas.drawText(merchantPhone, RECEIPT_WIDTH / 2f, yPosition.toFloat(), smallPaint)
        yPosition += (LINE_HEIGHT * 1.5).toInt()

        // Separator line
        canvas.drawLine(RECEIPT_PADDING.toFloat(), yPosition.toFloat(), 
            (RECEIPT_WIDTH - RECEIPT_PADDING).toFloat(), yPosition.toFloat(), linePaint)
        yPosition += LINE_HEIGHT

        // Receipt Title
        canvas.drawText("PAYMENT RECEIPT", RECEIPT_WIDTH / 2f, yPosition.toFloat(), titlePaint)
        yPosition += (LINE_HEIGHT * 1.5).toInt()

        // Transaction Details
        drawKeyValue(canvas, "Date:", formatDate(transaction.txnTimestamp), yPosition, normalPaint, boldPaint)
        yPosition += LINE_HEIGHT
        drawKeyValue(canvas, "Time:", formatTime(transaction.txnTimestamp), yPosition, normalPaint, boldPaint)
        yPosition += LINE_HEIGHT
        drawKeyValue(canvas, "STAN:", transaction.stan, yPosition, normalPaint, boldPaint)
        yPosition += LINE_HEIGHT
        drawKeyValue(canvas, "Terminal:", transaction.terminalId, yPosition, normalPaint, boldPaint)
        yPosition += LINE_HEIGHT
        drawKeyValue(canvas, "Batch:", transaction.batchId, yPosition, normalPaint, boldPaint)
        yPosition += LINE_HEIGHT

        if (transaction.rrn != null) {
            drawKeyValue(canvas, "RRN:", transaction.rrn, yPosition, normalPaint, boldPaint)
            yPosition += LINE_HEIGHT
        }

        // Separator
        yPosition += LINE_HEIGHT / 2
        canvas.drawLine(RECEIPT_PADDING.toFloat(), yPosition.toFloat(), 
            (RECEIPT_WIDTH - RECEIPT_PADDING).toFloat(), yPosition.toFloat(), linePaint)
        yPosition += LINE_HEIGHT

        // Card Details
        if (transaction.panMasked != null) {
            canvas.drawText("CARD DETAILS", RECEIPT_PADDING.toFloat(), yPosition.toFloat(), boldPaint)
            yPosition += LINE_HEIGHT
            drawKeyValue(canvas, "Card:", "${transaction.cardType ?: "CARD"} ${transaction.panMasked}", 
                yPosition, normalPaint, boldPaint)
            yPosition += LINE_HEIGHT
        }

        if (transaction.entryMode != null) {
            drawKeyValue(canvas, "Entry:", transaction.entryMode, yPosition, normalPaint, boldPaint)
            yPosition += LINE_HEIGHT
        }

        // Separator
        yPosition += LINE_HEIGHT / 2
        canvas.drawLine(RECEIPT_PADDING.toFloat(), yPosition.toFloat(), 
            (RECEIPT_WIDTH - RECEIPT_PADDING).toFloat(), yPosition.toFloat(), linePaint)
        yPosition += LINE_HEIGHT

        // Amount Section
        val amountTextPaint = Paint().apply {
            color = Color.BLACK
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
        }

        canvas.drawText("TOTAL AMOUNT", RECEIPT_WIDTH / 2f, yPosition.toFloat(), boldPaint)
        yPosition += (LINE_HEIGHT * 1.5).toInt()

        val amountText = transaction.getAmountDisplay()
        canvas.drawText(amountText, RECEIPT_WIDTH / 2f, yPosition.toFloat(), amountTextPaint)
        yPosition += (LINE_HEIGHT * 1.5).toInt()

        // Status
        val statusColor = when (transaction.status) {
            "APPROVED" -> Color.GREEN
            "DECLINED" -> Color.RED
            else -> Color.GRAY
        }
        val statusPaint = Paint().apply {
            color = statusColor
            textSize = TEXT_SIZE_LARGE
            typeface = Typeface.DEFAULT_BOLD
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText(transaction.status, RECEIPT_WIDTH / 2f, yPosition.toFloat(), statusPaint)
        yPosition += LINE_HEIGHT

        if (transaction.authCode != null) {
            drawKeyValue(canvas, "Auth Code:", transaction.authCode, yPosition, normalPaint, boldPaint)
            yPosition += LINE_HEIGHT
        }

        if (transaction.settlementCode != null) {
            drawKeyValue(canvas, "Settlement:", transaction.settlementCode, yPosition, normalPaint, boldPaint)
            yPosition += LINE_HEIGHT
        }

        // Separator
        yPosition += LINE_HEIGHT / 2
        canvas.drawLine(RECEIPT_PADDING.toFloat(), yPosition.toFloat(), 
            (RECEIPT_WIDTH - RECEIPT_PADDING).toFloat(), yPosition.toFloat(), linePaint)
        yPosition += (LINE_HEIGHT * 1.5).toInt()

        // Footer
        val footerPaint = Paint().apply {
            color = Color.DKGRAY
            textSize = TEXT_SIZE_SMALL
            typeface = Typeface.DEFAULT
            textAlign = Paint.Align.CENTER
        }
        
        canvas.drawText("Thank you for your business!", RECEIPT_WIDTH / 2f, yPosition.toFloat(), footerPaint)
        yPosition += LINE_HEIGHT
        canvas.drawText("Keep this receipt for your records.", RECEIPT_WIDTH / 2f, yPosition.toFloat(), footerPaint)
        yPosition += LINE_HEIGHT
        canvas.drawText("Powered by POS 201.3", RECEIPT_WIDTH / 2f, yPosition.toFloat(), footerPaint)

        pdfDocument.finishPage(page)

        // Save to file
        val fileName = "receipt_${transaction.stan}_${System.currentTimeMillis()}.pdf"
        val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "Receipts")
        if (!directory.exists()) {
            directory.mkdirs()
        }
        
        val file = File(directory, fileName)
        FileOutputStream(file).use { output ->
            pdfDocument.writeTo(output)
        }
        pdfDocument.close()

        return file
    }

    /**
     * Generate a bitmap preview of the receipt (for display)
     */
    fun generateReceiptBitmap(transaction: TransactionEntity): Bitmap {
        val height = calculateReceiptHeight(transaction)
        val bitmap = Bitmap.createBitmap(RECEIPT_WIDTH, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        // This is a simplified version - in production, use the same drawing code as PDF
        val paint = Paint().apply {
            color = Color.BLACK
            textSize = TEXT_SIZE_NORMAL
        }
        canvas.drawText("Receipt Preview - ${transaction.getAmountDisplay()}", 
            20f, 50f, paint)

        return bitmap
    }

    /**
     * Share receipt file
     */
    fun getReceiptUri(file: File) = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        file
    )

    private fun drawKeyValue(
        canvas: Canvas,
        key: String,
        value: String,
        y: Int,
        keyPaint: Paint,
        valuePaint: Paint
    ) {
        canvas.drawText(key, RECEIPT_PADDING.toFloat(), y.toFloat(), keyPaint)
        val valueWidth = valuePaint.measureText(value)
        canvas.drawText(value, (RECEIPT_WIDTH - RECEIPT_PADDING - valueWidth), y.toFloat(), valuePaint)
    }

    private fun calculateReceiptHeight(transaction: TransactionEntity): Int {
        var height = RECEIPT_PADDING * 2
        height += LINE_HEIGHT * 8 // Header + merchant info
        height += LINE_HEIGHT * 6 // Transaction details
        height += LINE_HEIGHT * 3 // Card details
        height += LINE_HEIGHT * 4 // Amount section
        height += LINE_HEIGHT * 4 // Status + footer
        return height
    }

    private fun formatDate(timestamp: Long): String {
        return SimpleDateFormat("dd/MM/yyyy", Locale.US).format(Date(timestamp))
    }

    private fun formatTime(timestamp: Long): String {
        return SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(timestamp))
    }
}
