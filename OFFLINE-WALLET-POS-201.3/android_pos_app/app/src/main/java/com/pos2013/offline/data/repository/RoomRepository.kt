package com.pos2013.offline.data.repository

import android.content.Context
import com.pos2013.offline.data.db.*
import com.pos2013.offline.utils.IdGenerator
import com.pos2013.offline.utils.PanEncryptor
import kotlinx.coroutines.flow.Flow
import java.text.SimpleDateFormat
import java.util.*

/**
 * Repository that uses Room SQL database.
 * 
 * This replaces SimpleStorage (SharedPreferences) with real SQLite.
 * Benefits:
 * - Faster queries (SQL indexes)
 * - Better for large data
 * - Real-time updates with Flow
 * - ACID transactions
 */
class RoomRepository(
    private val context: Context
) {
    private val db = AppDatabase.getDatabase(context)
    private val posDao = db.posTransactionDao()
    private val mfDao = db.myFatoorahTransactionDao()
    
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)

    // POS TRANSACTIONS
    suspend fun savePosTransaction(
        amountMinor: Int,
        currency: String,
        cardNumber: String,
        cardExpiry: String,
        txnType: String = "SALE",
        entryMode: String = "MANUAL"
    ): PosTransactionEntity {
        val localTxnId = IdGenerator.generateLocalTxnId()
        val stan = IdGenerator.generateStan(context)
        
        val encryptedPan = try {
            PanEncryptor.encrypt(context, cardNumber)
        } catch (e: Exception) {
            null
        }
        
        val entity = PosTransactionEntity(
            localTxnId = localTxnId,
            stan = stan,
            amountMinor = amountMinor,
            currency = currency,
            cardLast4 = cardNumber.takeLast(4),
            encryptedPan = encryptedPan,
            cardExpiry = cardExpiry,
            txnType = txnType,
            authMode = "OFFLINE_APPROVED",
            entryMode = entryMode,
            timestamp = System.currentTimeMillis(),
            createdAt = isoFormat.format(Date()),
            syncStatus = "PENDING"
        )
        
        posDao.insert(entity)
        return entity
    }

    suspend fun getPendingTransactions(): List<PosTransactionEntity> = posDao.getPending()
    fun getPendingCountFlow(): Flow<Int> = posDao.getPendingCountFlow()
    suspend fun getTransactionById(id: String): PosTransactionEntity? = posDao.getById(id)
    suspend fun getRecentTransactions(limit: Int = 50): List<PosTransactionEntity> = posDao.getRecent(limit)
    
    suspend fun updateSyncStatus(localTxnId: String, status: String, serverTxnId: String?, settlementCode: String?, error: String?) {
        posDao.updateStatus(localTxnId, status, serverTxnId, settlementCode, error, 
            if (status == "SYNCED") System.currentTimeMillis() else null)
    }

    suspend fun markAsFailed(localTxnId: String, error: String) = posDao.markAsFailed(localTxnId, error)
    suspend fun getTotalPendingAmount(): Long = posDao.getTotalAmountByStatus("PENDING")
    suspend fun getTotalSyncedAmount(): Long = posDao.getTotalAmountByStatus("SYNCED")
    
    suspend fun getDashboardCounts() = DashboardCounts(
        total = posDao.getTotalCount(),
        pending = posDao.countByStatus("PENDING"),
        synced = posDao.countByStatus("SYNCED"),
        failed = posDao.countByStatus("FAILED"),
        pendingAmount = posDao.getTotalAmountByStatus("PENDING"),
        syncedAmount = posDao.getTotalAmountByStatus("SYNCED")
    )

    suspend fun clearOldSynced(days: Int = 7): Int {
        return posDao.deleteOldSynced(System.currentTimeMillis() - (days * 24 * 60 * 60 * 1000))
    }

    // MYFATOORAH
    suspend fun saveMyFatoorahOrder(amountMinor: Int, currency: String, customerName: String?, customerMobile: String?): MyFatoorahTransactionEntity {
        val entity = MyFatoorahTransactionEntity(
            localTxnId = "MF-${System.currentTimeMillis()}",
            amountMinor = amountMinor,
            currency = currency,
            customerName = customerName,
            customerMobile = customerMobile,
            itemName = "Purchase",
            quantity = 1,
            unitPrice = amountMinor,
            orderStatus = "PENDING",
            syncStatus = "PENDING",
            timestamp = System.currentTimeMillis(),
            createdAt = isoFormat.format(Date())
        )
        mfDao.insert(entity)
        return entity
    }

    suspend fun getPendingMyFatoorahOrders(): List<MyFatoorahTransactionEntity> = mfDao.getPendingOrders()
    fun getMyFatoorahPendingCountFlow(): Flow<Int> = mfDao.getPendingCountFlow()
    suspend fun getTotalMyFatoorahPendingAmount(): Long = mfDao.getPendingAmount()

    data class DashboardCounts(
        val total: Int,
        val pending: Int,
        val synced: Int,
        val failed: Int,
        val pendingAmount: Long,
        val syncedAmount: Long
    )
}
