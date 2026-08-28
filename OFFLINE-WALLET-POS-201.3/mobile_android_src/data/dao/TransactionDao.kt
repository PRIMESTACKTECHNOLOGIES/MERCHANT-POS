package com.pos2013.offline.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pos2013.offline.data.model.TransactionEntity

@Dao
interface TransactionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transaction: TransactionEntity)

    @Query("SELECT * FROM transactions WHERE status = :status")
    suspend fun getByStatus(status: String): List<TransactionEntity>

    @Query("UPDATE transactions SET status = :newStatus WHERE id IN (:ids)")
    suspend fun updateStatus(ids: List<String>, newStatus: String)
}
