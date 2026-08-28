package com.pos2013.offline.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [OfflineTransaction::class, StanCounterEntity::class],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun offlineTransactionDao(): OfflineTransactionDao
    abstract fun stanCounterDao(): StanCounterDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "pos_database_v2"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }

        /**
         * Convenience helper to obtain the StanCounterRepository backed by Room.
         * Call this to get a repository for atomic STAN generation.
         */
        fun getStanCounterRepository(context: Context): StanCounterRepository {
            val db = getDatabase(context)
            return StanCounterRepository(db.stanCounterDao())
        }
    }
}
