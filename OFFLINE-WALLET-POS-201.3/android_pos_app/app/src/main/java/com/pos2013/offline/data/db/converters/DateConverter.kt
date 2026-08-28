package com.pos2013.offline.data.db.converters

import androidx.room.TypeConverter
import java.time.Instant
import java.util.*

/**
 * Type converters for Room database.
 * Handles conversion between complex types and database primitives.
 */
class DateConverter {

    @TypeConverter
    fun fromInstant(value: Instant?): Long? {
        return value?.toEpochMilli()
    }

    @TypeConverter
    fun toInstant(value: Long?): Instant? {
        return value?.let { Instant.ofEpochMilli(it) }
    }

    @TypeConverter
    fun fromDate(value: Date?): Long? {
        return value?.time
    }

    @TypeConverter
    fun toDate(value: Long?): Date? {
        return value?.let { Date(it) }
    }
}
