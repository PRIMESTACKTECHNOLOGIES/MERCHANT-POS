package com.pos2013.offline.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.pos2013.offline.data.model.*

/**
 * Simple storage using SharedPreferences - no Room/kapt needed
 */
class SimpleStorage(context: Context) {

    private val appContext: Context = context.applicationContext
    private val prefs: SharedPreferences = appContext.getSharedPreferences("pos_storage", Context.MODE_PRIVATE)
    private val gson = Gson()

    // Save a transaction
    fun saveTransaction(transaction: StoredTransaction) {
        val transactions = getAllTransactions().toMutableList()
        transactions.add(transaction)
        saveAllTransactions(transactions)
    }

    // Get all transactions
    fun getAllTransactions(): List<StoredTransaction> {
        val json = prefs.getString("transactions", "[]") ?: "[]"
        val type = object : TypeToken<List<StoredTransaction>>() {}.type
        return gson.fromJson(json, type) ?: emptyList()
    }

    // Get pending (not synced) transactions
    fun getPendingTransactions(): List<StoredTransaction> {
        return getAllTransactions().filter { !it.synced }
    }

    // Get pending count
    fun getPendingCount(): Int {
        return getPendingTransactions().size
    }

    // Mark transaction as synced
    fun markAsSynced(
        localTxnId: String, 
        settlementCode: String,
        invoiceId: String? = null,
        paymentId: String? = null,
        authCode: String? = null,
        cardBrand: String? = null
    ) {
        val transactions = getAllTransactions().map {
            if (it.localTxnId == localTxnId) {
                it.copy(
                    synced = true, 
                    settlementCode = settlementCode, 
                    invoiceId = invoiceId,
                    paymentId = paymentId,
                    authCode = authCode,
                    cardBrand = cardBrand,
                    syncedAt = System.currentTimeMillis()
                )
            } else {
                it
            }
        }
        saveAllTransactions(transactions)
    }

    // Update transaction status
    fun updateStatus(localTxnId: String, status: String, error: String? = null) {
        val transactions = getAllTransactions().map {
            if (it.localTxnId == localTxnId) {
                it.copy(syncStatus = status, lastError = error)
            } else {
                it
            }
        }
        saveAllTransactions(transactions)
    }

    // Clear old synced transactions
    fun clearOldSynced(olderThanMillis: Long) {
        val cutoff = System.currentTimeMillis() - olderThanMillis
        val transactions = getAllTransactions().filter {
            !(it.synced && it.syncedAt != null && it.syncedAt < cutoff)
        }
        saveAllTransactions(transactions)
    }

    // Delete all transactions
    fun clearAll() {
        prefs.edit().remove("transactions").apply()
    }

    private fun saveAllTransactions(transactions: List<StoredTransaction>) {
        val json = gson.toJson(transactions)
        prefs.edit().putString("transactions", json).apply()
    }

    // --- Protocol 201.3 Storage ---

    fun saveProtocol2013Transaction(transaction: Protocol2013Transaction) {
        val txns = getAllProtocol2013Transactions().toMutableList()
        txns.add(transaction)
        saveAllProtocol2013Transactions(txns)
    }

    fun getAllProtocol2013Transactions(): List<Protocol2013Transaction> {
        val json = prefs.getString("protocol_2013_txns", "[]") ?: "[]"
        val type = object : TypeToken<List<Protocol2013Transaction>>() {}.type
        return gson.fromJson(json, type) ?: emptyList()
    }

    fun getPendingProtocol2013Transactions(): List<Protocol2013Transaction> {
        return getAllProtocol2013Transactions().filter { it.syncStatus == "PENDING" }
    }

    fun getPendingProtocol2013Count(): Int {
        return getPendingProtocol2013Transactions().size
    }

    fun markProtocol2013TransactionSynced(localTxnId: String) {
        val txns = getAllProtocol2013Transactions().map {
            if (it.localTxnId == localTxnId) {
                it.copy(syncStatus = "SYNCED", syncedAt = System.currentTimeMillis())
            } else {
                it
            }
        }
        saveAllProtocol2013Transactions(txns)
    }

    private fun saveAllProtocol2013Transactions(txns: List<Protocol2013Transaction>) {
        val json = gson.toJson(txns)
        prefs.edit().putString("protocol_2013_txns", json).apply()
    }

    // --- Settlement history ---

    fun getSettlementHistory(): List<SettlementRecord> {
        val json = prefs.getString("settlements", "[]") ?: "[]"
        val type = object : TypeToken<List<SettlementRecord>>() {}.type
        return gson.fromJson(json, type) ?: emptyList()
    }

    fun addSettlement(record: SettlementRecord) {
        val settlements = getSettlementHistory().toMutableList()
        settlements.add(record)
        val json = gson.toJson(settlements)
        prefs.edit().putString("settlements", json).apply()
    }
}

data class StoredTransaction(
    val localTxnId: String,
    val stan: String,
    val amountMinor: Long,
    val currency: String = "AED",
    val cardLast4: String,
    val encryptedPan: com.pos2013.offline.utils.SyncEncryptor.EncryptedResult? = null,
    val encryptedExpMonth: com.pos2013.offline.utils.SyncEncryptor.EncryptedResult? = null,
    val encryptedExpYear: com.pos2013.offline.utils.SyncEncryptor.EncryptedResult? = null,
    val encryptedCvv: com.pos2013.offline.utils.SyncEncryptor.EncryptedResult? = null,
    val aesKey: String? = null,
    val cardExpiry: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val syncStatus: String = "PENDING",
    val synced: Boolean = false,
    val settlementCode: String? = null,
    val invoiceId: String? = null,
    val paymentId: String? = null,
    val authCode: String? = null,
    val cardBrand: String? = null,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val syncedAt: Long? = null
)

data class SettlementRecord(
    val settlementCode: String,
    val amount: String,
    val timestamp: Long,
    val batchId: String
)
