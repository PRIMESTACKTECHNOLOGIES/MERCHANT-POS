package com.pos2013.offline.ui

import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.pos2013.offline.R
import com.pos2013.offline.data.local.AppDatabase
import com.pos2013.offline.data.local.entity.TransactionEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

/**
 * Transaction History Activity
 * Displays list of all transactions
 */
class HistoryActivity : AppCompatActivity() {

    private lateinit var recyclerView: RecyclerView
    private lateinit var emptyState: View
    private lateinit var tvTotalCount: TextView
    private lateinit var tvTotalAmount: TextView
    
    private val dateFormat = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_history)

        // Setup toolbar
        supportActionBar?.apply {
            setDisplayHomeAsUpEnabled(true)
            title = "Transaction History"
        }

        // Initialize views
        recyclerView = findViewById(R.id.recyclerView)
        emptyState = findViewById(R.id.emptyState)
        tvTotalCount = findViewById(R.id.tvTotalCount)
        tvTotalAmount = findViewById(R.id.tvTotalAmount)

        recyclerView.layoutManager = LinearLayoutManager(this)
        
        loadTransactions()
    }

    private fun loadTransactions() {
        lifecycleScope.launch {
            val db = AppDatabase.getInstance(this@HistoryActivity)
            val transactions = db.transactionDao().getAllTransactions().first()
            
            updateUI(transactions)
        }
    }

    private fun updateUI(transactions: List<TransactionEntity>) {
        if (transactions.isEmpty()) {
            recyclerView.visibility = View.GONE
            emptyState.visibility = View.VISIBLE
            tvTotalCount.text = "0"
            tvTotalAmount.text = "AED 0.00"
        } else {
            recyclerView.visibility = View.VISIBLE
            emptyState.visibility = View.GONE
            
            tvTotalCount.text = transactions.size.toString()
            val totalAmount = transactions.sumOf { it.amountMinor }
            tvTotalAmount.text = String.format("AED %.2f", totalAmount / 100.0)
            
            // Simple adapter - you can enhance this
            recyclerView.adapter = SimpleTransactionAdapter(transactions)
        }
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            android.R.id.home -> {
                finish()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    /**
     * Simple adapter for transactions
     */
    inner class SimpleTransactionAdapter(
        private val transactions: List<TransactionEntity>
    ) : RecyclerView.Adapter<SimpleTransactionAdapter.ViewHolder>() {

        inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val tvAmount: TextView = itemView.findViewById(android.R.id.text1)
            val tvDetails: TextView = itemView.findViewById(android.R.id.text2)
        }

        override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): ViewHolder {
            val view = android.view.LayoutInflater.from(parent.context)
                .inflate(android.R.layout.simple_list_item_2, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val transaction = transactions[position]
            val amount = transaction.amountMinor / 100.0
            holder.tvAmount.text = String.format("AED %.2f - %s", 
                amount, 
                transaction.status.uppercase()
            )
            holder.tvDetails.text = "${transaction.localTxnId} | ${dateFormat.format(Date(transaction.createdAt))}"
            
            // Color code based on status
            val color = when (transaction.status) {
                "approved" -> android.graphics.Color.GREEN
                "pending" -> android.graphics.Color.YELLOW
                else -> android.graphics.Color.RED
            }
            holder.tvAmount.setTextColor(color)
        }

        override fun getItemCount() = transactions.size
    }
}
