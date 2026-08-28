package com.pos2013.offline.data.model 
 
import androidx.room.Entity 
import androidx.room.PrimaryKey 
import java.util.UUID 
 
@Entity(tableName = "transactions") 
data class TransactionEntity( 
    @PrimaryKey val id: String = UUID.randomUUID().toString(), 
    val amountMinor: Long, 
    val currency: String = "USD", 
    val panMasked: String, 
    val stan: String, 
    val timestamp: Long, 
    val expiry: String, 
    val status: String = "PENDING" // PENDING, SYNCED 
)
