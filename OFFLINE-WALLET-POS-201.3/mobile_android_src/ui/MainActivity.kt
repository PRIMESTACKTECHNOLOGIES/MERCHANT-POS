package com.pos2013.offline.ui

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.data.AppDatabase
import com.pos2013.offline.data.TransactionRepository
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.data.api.RedeemRequest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private lateinit var repository: TransactionRepository
    private val api = ApiClient.create()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize database and repository
        val db = AppDatabase.getDatabase(this)
        repository = TransactionRepository(
            db.transactionDao(), 
            api, 
            "MERCHANT123", 
            "TERM001", 
            "MY_SUPER_SECRET_KEY_12345"
        )

        // Bind UI elements
        val edtCode = findViewById<EditText>(R.id.edtCode)
        val edtAmount = findViewById<EditText>(R.id.edtAmount)
        val btnPay = findViewById<Button>(R.id.btnPay)
        val btnSync = findViewById<Button>(R.id.btnSync)
        val txtResult = findViewById<TextView>(R.id.txtResult)
        val txtStatus = findViewById<TextView>(R.id.txtStatus)

        // Display current status
        updateStatus("Ready - Protocol 201.3")

        // Pay Button - Live Redemption
        btnPay.setOnClickListener {
            val code = edtCode.text.toString().trim()
            val amountText = edtAmount.text.toString().trim()

            if (code.length != 6) {
                txtResult.text = "⚠️ Enter 6-digit code"
                return@setOnClickListener
            }

            if (amountText.isEmpty()) {
                txtResult.text = "⚠️ Enter amount"
                return@setOnClickListener
            }

            val amount = amountText.toDoubleOrNull()
            if (amount == null || amount <= 0) {
                txtResult.text = "⚠️ Invalid amount"
                return@setOnClickListener
            }

            // Process live redemption
            processLiveRedemption(code, amount, txtResult)
        }

        // Sync Button - Upload Offline Batches
        btnSync.setOnClickListener {
            syncOfflineTransactions(txtResult)
        }
    }

    private fun processLiveRedemption(code: String, amount: Double, resultView: TextView) {
        resultView.text = "⏳ Processing..."
        updateStatus("Connecting to server...")

        lifecycleScope.launch {
            try {
                val request = RedeemRequest(
                    code = code,
                    amount = amount,
                    merchantId = "MERCHANT123"
                )

                val response = api.redeem(request)
                
                if (response.isSuccessful && response.body() != null) {
                    val redeemResponse = response.body()!!
                    
                    if (redeemResponse.success) {
                        resultView.text = "✅ Payment Successful!\n\nReference: ${redeemResponse.reference}\nTime: ${formatTime(redeemResponse.time)}"
                        updateStatus("Last tx: $amount USD")
                        Toast.makeText(this@MainActivity, "Payment successful!", Toast.LENGTH_LONG).show()
                    } else {
                        resultView.text = "❌ ${redeemResponse.message}"
                        updateStatus("Payment failed")
                    }
                } else {
                    resultView.text = "❌ Server Error: ${response.code()}"
                    updateStatus("Connection failed")
                }
            } catch (e: Exception) {
                resultView.text = "❌ Network Error: ${e.message}"
                updateStatus("Offline mode")
                
                // Offer to save offline
                saveTransactionOffline(code, amount, resultView)
            }
        }
    }

    private fun saveTransactionOffline(code: String, amount: Double, resultView: TextView) {
        lifecycleScope.launch {
            try {
                repository.createOfflineTransaction(
                    amountMinor = (amount * 100).toLong(),
                    currency = "USD",
                    panMasked = code,
                    expiry = "",
                    stan = generateStan()
                )
                resultView.text = "💾 Saved Offline\n\nWill sync when online"
                updateStatus("${(amount * 100).toLong()} minor units stored")
                Toast.makeText(this@MainActivity, "Transaction saved offline", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                resultView.text = "❌ Error: ${e.message}"
                updateStatus("Save failed")
            }
        }
    }

    private fun syncOfflineTransactions(resultView: TextView) {
        resultView.text = "🔄 Syncing..."
        updateStatus("Uploading pending transactions")

        lifecycleScope.launch {
            try {
                val success = repository.syncPendingTransactions()
                
                if (success) {
                    resultView.text = "✅ Sync Successful!\n\nAll pending transactions uploaded"
                    updateStatus("Sync complete")
                    Toast.makeText(this@MainActivity, "Sync successful!", Toast.LENGTH_LONG).show()
                } else {
                    resultView.text = "⚠️ Sync Partial\n\nSome transactions failed"
                    updateStatus("Sync incomplete")
                }
            } catch (e: Exception) {
                resultView.text = "❌ Sync Failed: ${e.message}"
                updateStatus("Sync error")
                Toast.makeText(this@MainActivity, "Sync failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun generateStan(): String {
        val prefs = getSharedPreferences("pos_prefs", MODE_PRIVATE)
        val lastStan = prefs.getInt("last_stan", 0)
        val nextStan = (lastStan + 1) % 1_000_000
        
        prefs.edit().putInt("last_stan", nextStan).apply()
        
        return String.format("%06d", nextStan)
    }

    private fun formatTime(timeString: String?): String {
        return try {
            val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            val outputFormat = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault())
            val date = inputFormat.parse(timeString ?: "")
            outputFormat.format(date)
        } catch (e: Exception) {
            timeString ?: "N/A"
        }
    }

    private fun updateStatus(status: String) {
        findViewById<TextView>(R.id.txtStatus).text = "📡 $status"
    }
}
