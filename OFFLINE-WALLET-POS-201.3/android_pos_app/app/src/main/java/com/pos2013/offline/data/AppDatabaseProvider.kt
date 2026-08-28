package com.pos2013.offline.data

import android.content.Context

object AppDatabaseProvider {
    @Volatile
    private var INSTANCE: DatabaseHelper? = null

    fun get(context: Context): DatabaseHelper {
        return INSTANCE ?: synchronized(this) {
            INSTANCE ?: DatabaseHelper(context.applicationContext).also { INSTANCE = it }
        }
    }
}
