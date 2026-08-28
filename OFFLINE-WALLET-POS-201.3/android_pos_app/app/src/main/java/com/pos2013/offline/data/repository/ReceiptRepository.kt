package com.pos2013.offline.data.repository

import android.content.Context
import com.pos2013.offline.data.SimpleStorage
import com.pos2013.offline.data.model.ReceiptData
import java.text.SimpleDateFormat
import java.util.*

/**
 * Repository for loading receipt data from storage.
 * 
 * This bridges the storage layer (SimpleStorage) with the presentation layer (ReceiptViewModel).
 */
class ReceiptRepository(
    private val context: Context
) {
    private val storage = SimpleStorage(context)
    private val displayDateFormat = SimpleDateFormat("dd/MM/yyyy", Locale.US)
    private val displayTimeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)

    /**
     * Load receipt data for a transaction by its local ID.
     * 
     * @param localTxnId The local transaction ID (e.g., "TXN-LOCAL-001")
     * @return ReceiptData if found, null otherwise
     */
    fun loadReceipt(localTxnId: String): ReceiptData? {
        // Find transaction in storage
        val transaction = storage.getAllTransactions()
            .find { it.localTxnId == localTxnId }
            ?: return null

        // Parse timestamp
        val timestamp = transaction.timestamp
        val date = Date(timestamp)
        
        // Format display date/time
        val displayDate = displayDateFormat.format(date)
        val displayTime = displayTimeFormat.format(date)
        
        // Format ISO timestamp
        val isoTimestamp = isoFormat.format(date)

        return ReceiptData(
            amount = transaction.amountMinor / 100.0,
            currency = transaction.currency,
            panMasked = transaction.cardLast4.let { "**** **** **** $it" },
            last4 = transaction.cardLast4,
            stan = transaction.stan,
            localTxnId = transaction.localTxnId,
            timestamp = isoTimestamp,
            displayDate = displayDate,
            displayTime = displayTime,
            offlineApproved = !transaction.synced && transaction.syncStatus == "PENDING",
            authMode = if (transaction.synced) "ONLINE_APPROVED" else "OFFLINE_APPROVED",
            syncStatus = transaction.syncStatus,
            settlementCode = transaction.settlementCode
        )
    }

    /**
     * Load receipt data for the most recent transaction.
     * Useful when navigating from payment screen without knowing the ID.
     */
    fun loadMostRecentReceipt(): ReceiptData? {
        val transactions = storage.getAllTransactions()
            .sortedByDescending { it.timestamp }
        
        return transactions.firstOrNull()?.let { txn ->
            loadReceipt(txn.localTxnId)
        }
    }

    /**
     * Get all receipts (for history view).
     */
    fun loadAllReceipts(): List<ReceiptData> {
        return storage.getAllTransactions()
            .sortedByDescending { it.timestamp }
            .mapNotNull { loadReceipt(it.localTxnId) }
    }

    /**
     * Get pending receipts that need sync.
     */
    fun loadPendingReceipts(): List<ReceiptData> {
        return storage.getPendingTransactions()
            .sortedBy { it.timestamp }
            .mapNotNull { loadReceipt(it.localTxnId) }
    }
}
