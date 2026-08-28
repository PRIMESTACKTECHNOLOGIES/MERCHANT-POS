package com.pos2013.offline.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * StanCounter entity and DAO for atomic, persistent STAN generation.
 *
 * This provides a single-row table (`stan_counter`) which stores the last used
 * STAN (System Trace Audit Number). Use the DAO's `incrementAndGet()` method
 * inside a Room @Transaction to atomically increment and persist the STAN.
 *
 * STAN range: 000001 - 999999 (we never return 000000; wrap goes to 000001).
 */

/**
 * Single-row entity storing the last used STAN value.
 * We use a fixed primary key (1) so the table contains at most one row.
 */
@Entity(tableName = "stan_counter")
data class StanCounterEntity(
    @PrimaryKey
    val id: Int = 1,

    /**
     * Last used STAN as integer (0..999999). 0 means not initialized.
     */
    val lastStan: Int = 0
)

/**
 * DAO for reading/updating the STAN counter.
 *
 * The convenient `incrementAndGet()` method is annotated with @Transaction so
 * the read + write happen atomically in Room.
 */
@Dao
interface StanCounterDao {

    @Query("SELECT lastStan FROM stan_counter WHERE id = 1")
    suspend fun getLastStan(): Int?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(counter: StanCounterEntity)

    @Query("DELETE FROM stan_counter")
    suspend fun clearAll()

    /**
     * Atomically increments the stored STAN and returns the new value (1..999999).
     * If no row exists yet, treat the lastStan as 0, increment to 1 and insert row.
     *
     * NOTE: annotated with @Transaction to ensure atomicity when Room generates code.
     */
    @Transaction
    suspend fun incrementAndGet(): Int {
        val current = getLastStan() ?: 0
        var next = (current + 1) % 1_000_000
        if (next == 0) next = 1 // never return 000000
        insert(StanCounterEntity(id = 1, lastStan = next))
        return next
    }

    /**
     * Convenience: returns a Flow of the current lastStan (nullable) — useful for UI or debugging.
     */
    @Query("SELECT lastStan FROM stan_counter WHERE id = 1")
    fun observeLastStan(): Flow<Int?>
}

/**
 * Repository wrapper providing a small, testable API around the DAO.
 * Consumers can call `nextStanString()` to get a zero-padded 6-digit STAN.
 */
class StanCounterRepository(private val dao: StanCounterDao) {

    /**
     * Returns the next STAN as an integer (1..999999).
     * This calls the DAO transactionally.
     */
    suspend fun nextStanInt(): Int {
        return dao.incrementAndGet()
    }

    /**
     * Returns the next STAN formatted as a 6-digit zero-padded String (e.g., "000123").
     */
    suspend fun nextStanString(): String {
        val next = nextStanInt()
        return String.format("%06d", next)
    }

    /**
     * Initialize the counter row if it doesn't exist. Does not change value if already present.
     * Call this once at app/db initialization if desired.
     */
    suspend fun ensureInitialized() {
        val current = dao.getLastStan()
        if (current == null) {
            dao.insert(StanCounterEntity(id = 1, lastStan = 0))
        }
    }
}
