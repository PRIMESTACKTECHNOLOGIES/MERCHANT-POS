package com.pos2013.offline.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.pos2013.offline.data.db.converters.DateConverter
import com.pos2013.offline.data.db.dao.MyFatoorahTransactionDao
import com.pos2013.offline.data.db.dao.OfflineTransactionDao
import com.pos2013.offline.data.db.entities.MyFatoorahTransactionEntity
import com.pos2013.offline.data.db.entities.OfflineTransactionEntity

/**
 * Main Room Database for POS 201.3 application.
 * 
 * Contains tables:
 * - offline_transactions: POS card transactions
 * - myfatoorah_transactions: MyFatoorah payment orders
 * 
 * Version: 1
 * Export schema: true (for migrations)
 */
@Database(
    entities = [
        OfflineTransactionEntity::class,
        MyFatoorahTransactionEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(DateConverter::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun offlineTransactionDao(): OfflineTransactionDao
    abstract fun myFatoorahTransactionDao(): MyFatoorahTransactionDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        /**
         * Get singleton database instance.
         * Thread-safe with double-checked locking.
         */
        fun get(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        /**
         * Build database with production settings.
         */
        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "pos2013_offline.db"
            )
                .fallbackToDestructiveMigration()
                .enableMultiInstanceInvalidation()
                .build()
        }

        /**
         * Create in-memory database for testing.
         */
        fun createInMemory(context: Context): AppDatabase {
            return Room.inMemoryDatabaseBuilder(
                context.applicationContext,
                AppDatabase::class.java
            ).build()
        }

        /**
         * Clear singleton instance (for testing).
         */
        fun clearInstance() {
            INSTANCE = null
        }
    }
}
