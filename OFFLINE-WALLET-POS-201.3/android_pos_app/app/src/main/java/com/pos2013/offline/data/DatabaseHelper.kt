package com.pos2013.offline.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.pos2013.offline.data.model.Transaction

class DatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "pos2013.db"
        private const val DATABASE_VERSION = 1
        private const val TABLE_TRANSACTIONS = "transactions"
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTable = """
            CREATE TABLE $TABLE_TRANSACTIONS (
                id TEXT PRIMARY KEY,
                amountMinor INTEGER,
                currency TEXT,
                panMasked TEXT,
                stan TEXT,
                timestamp INTEGER,
                expiry TEXT,
                status TEXT
            )
        """.trimIndent()
        db.execSQL(createTable)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_TRANSACTIONS")
        onCreate(db)
    }

    fun insertTransaction(tx: Transaction): Long {
        val db = this.writableDatabase
        val values = ContentValues().apply {
            put("id", tx.id)
            put("amountMinor", tx.amountMinor)
            put("currency", tx.currency)
            put("panMasked", tx.panMasked)
            put("stan", tx.stan)
            put("timestamp", tx.timestamp)
            put("expiry", tx.expiry)
            put("status", tx.status)
        }
        return db.insert(TABLE_TRANSACTIONS, null, values)
    }

    fun getTransactionsByStatus(status: String): List<Transaction> {
        val transactions = mutableListOf<Transaction>()
        val db = this.readableDatabase
        val cursor = db.query(
            TABLE_TRANSACTIONS,
            null,
            "status = ?",
            arrayOf(status),
            null,
            null,
            "timestamp ASC"
        )

        with(cursor) {
            while (moveToNext()) {
                transactions.add(
                    Transaction(
                        id = getString(getColumnIndexOrThrow("id")),
                        amountMinor = getLong(getColumnIndexOrThrow("amountMinor")),
                        currency = getString(getColumnIndexOrThrow("currency")),
                        panMasked = getString(getColumnIndexOrThrow("panMasked")),
                        stan = getString(getColumnIndexOrThrow("stan")),
                        timestamp = getLong(getColumnIndexOrThrow("timestamp")),
                        expiry = getString(getColumnIndexOrThrow("expiry")),
                        status = getString(getColumnIndexOrThrow("status"))
                    )
                )
            }
            close()
        }
        return transactions
    }

    fun updateTransactionStatus(ids: List<String>, newStatus: String): Int {
        val db = this.writableDatabase
        val placeholders = ids.joinToString(",") { "?" }
        val values = ContentValues().apply {
            put("status", newStatus)
        }
        return db.update(
            TABLE_TRANSACTIONS,
            values,
            "id IN ($placeholders)",
            ids.toTypedArray()
        )
    }

    fun getPendingCount(): Int {
        val db = this.readableDatabase
        val cursor = db.rawQuery(
            "SELECT COUNT(*) FROM $TABLE_TRANSACTIONS WHERE status = 'PENDING'",
            null
        )
        var count = 0
        if (cursor.moveToFirst()) {
            count = cursor.getInt(0)
        }
        cursor.close()
        return count
    }
}
