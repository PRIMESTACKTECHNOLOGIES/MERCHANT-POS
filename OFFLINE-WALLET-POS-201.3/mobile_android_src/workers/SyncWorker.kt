package com.pos2013.offline.workers

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.TransactionRepository
import com.pos2013.offline.data.api.ApiClient

class SyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            val db = AppDatabase.getDatabase(applicationContext)
            val dao = db.transactionDao()
            
            // Use the correct backend URL for batch uploads
            val api = ApiClient.create("https://pos-201-3-offline-6-digit-1.onrender.com/")

            val repo = TransactionRepository(
                dao = dao,
                api = api,
                merchantId = "MERCHANT123",
                terminalId = "TERM001",
                secretKey = "YOUR_SECRET_KEY"
            )

            val ok = repo.syncPendingTransactions()
            if (ok) Result.success() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
