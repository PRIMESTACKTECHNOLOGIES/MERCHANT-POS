package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.pos2013.offline.R
import com.pos2013.offline.data.model.DashboardStats
import com.pos2013.offline.data.model.DashboardTransactionItem
import com.pos2013.offline.databinding.ActivityDashboardBinding
import com.pos2013.offline.presentation.viewmodel.DashboardViewModel
import com.pos2013.offline.presentation.viewmodel.DashboardViewModelFactory
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

/**
 * Unified Sync Dashboard - Operational command center for the POS.
 * 
 * Shows:
 * - Summary statistics (total, pending, synced, failed)
 * - Pending transactions list
 * - Failed transactions list
 * - MyFatoorah order status
 * - Manual sync controls
 * - Data management tools
 */
class DashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDashboardBinding
    
    private val viewModel: DashboardViewModel by viewModels {
        DashboardViewModelFactory(this)
    }
    
    private lateinit var pendingAdapter: TransactionAdapter
    private lateinit var failedAdapter: TransactionAdapter
    
    private val dateFormat = SimpleDateFormat("MMM dd, HH:mm", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupToolbar()
        setupUI()
        setupRecyclerViews()
        observeViewModel()
    }
    
    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = "Sync Dashboard"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
    }
    
    private fun setupUI() {
        // Swipe to refresh
        binding.swipeRefresh.setOnRefreshListener {
            viewModel.refresh()
        }
        
        // Sync now button
        binding.fabSync.setOnClickListener {
            viewModel.syncNow()
        }
        
        // View all pending
        binding.btnViewAllPending.setOnClickListener {
            scrollToSection(R.id.sectionPending)
        }
        
        // View all failed
        binding.btnViewAllFailed.setOnClickListener {
            scrollToSection(R.id.sectionFailed)
        }
        
        // Clear old data button
        binding.btnClearOld.setOnClickListener {
            showClearDataDialog()
        }
    }
    
    private fun setupRecyclerViews() {
        // Pending transactions
        pendingAdapter = TransactionAdapter { transaction ->
            onTransactionClick(transaction)
        }
        binding.recyclerPending.apply {
            layoutManager = LinearLayoutManager(this@DashboardActivity)
            adapter = pendingAdapter
        }
        
        // Failed transactions
        failedAdapter = TransactionAdapter { transaction ->
            onTransactionClick(transaction)
        }
        binding.recyclerFailed.apply {
            layoutManager = LinearLayoutManager(this@DashboardActivity)
            adapter = failedAdapter
        }
    }
    
    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    updateUI(state)
                }
            }
        }
        
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.isSyncing.collect { isSyncing ->
                    binding.swipeRefresh.isRefreshing = isSyncing
                    binding.fabSync.isEnabled = !isSyncing
                    if (isSyncing) {
                        binding.fabSync.setImageResource(R.drawable.ic_sync_anim)
                    } else {
                        binding.fabSync.setImageResource(R.drawable.ic_sync)
                    }
                }
            }
        }
    }
    
    private fun updateUI(state: com.pos2013.offline.data.model.DashboardState) {
        // Hide loading
        binding.swipeRefresh.isRefreshing = state.isLoading
        
        // Update stats cards
        updateStatsCards(state.stats)
        
        // Update pending list
        pendingAdapter.submitList(state.pendingTransactions.take(10))
        binding.tvPendingCount.text = "${state.pendingTransactions.size} pending"
        binding.sectionPending.visibility = 
            if (state.pendingTransactions.isEmpty()) View.GONE else View.VISIBLE
        
        // Update failed list
        failedAdapter.submitList(state.failedTransactions.take(10))
        binding.tvFailedCount.text = "${state.failedTransactions.size} failed"
        binding.sectionFailed.visibility = 
            if (state.failedTransactions.isEmpty()) View.GONE else View.VISIBLE
        
        // Update MyFatoorah section
        updateMyFatoorahSection(state.myFatoorahStats)
        
        // Show error if any
        state.error?.let { error ->
            Toast.makeText(this, error, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
        
        // Update last updated time
        binding.tvLastUpdated.text = "Updated: ${dateFormat.format(Date(state.lastUpdated))}"
    }
    
    private fun updateStatsCards(stats: DashboardStats) {
        // Total transactions
        binding.tvTotalCount.text = stats.totalTransactions.toString()
        
        // Pending card
        binding.tvPendingAmount.text = stats.getPendingAmount()
        binding.tvPendingNumber.text = stats.pendingCount.toString()
        
        // Synced card
        binding.tvSyncedAmount.text = stats.getSyncedAmount()
        binding.tvSyncedNumber.text = stats.syncedCount.toString()
        
        // Failed card
        binding.tvFailedNumber.text = stats.failedCount.toString()
        
        // Success rate
        val successRate = stats.getSyncSuccessRate()
        binding.tvSuccessRate.text = "$successRate%"
        binding.progressSuccessRate.progress = successRate
        
        // Last sync
        stats.lastSyncTime?.let { time ->
            binding.tvLastSync.text = "Last sync: ${dateFormat.format(Date(time))}"
        } ?: run {
            binding.tvLastSync.text = "Last sync: Never"
        }
    }
    
    private fun updateMyFatoorahSection(stats: com.pos2013.offline.data.model.MyFatoorahDashboardStats) {
        binding.tvMyFatoorahPending.text = stats.pendingOrders.toString()
        binding.tvMyFatoorahLinks.text = stats.linkSentCount.toString()
        binding.tvMyFatoorahAmount.text = "AED ${String.format("%.2f", stats.totalPendingAmount)}"
        
        binding.sectionMyFatoorah.visibility = 
            if (stats.pendingOrders + stats.linkSentCount > 0) View.VISIBLE else View.GONE
    }
    
    private fun onTransactionClick(transaction: DashboardTransactionItem) {
        // Navigate to receipt
        val intent = Intent(this, ReceiptActivity::class.java).apply {
            putExtra(ReceiptActivity.EXTRA_LOCAL_TXN_ID, transaction.localTxnId)
        }
        startActivity(intent)
    }
    
    private fun scrollToSection(sectionId: Int) {
        when (sectionId) {
            R.id.sectionPending -> binding.scrollView.smoothScrollTo(0, binding.sectionPending.top)
            R.id.sectionFailed -> binding.scrollView.smoothScrollTo(0, binding.sectionFailed.top)
        }
    }
    
    private fun showClearDataDialog() {
        AlertDialog.Builder(this)
            .setTitle("Clear Old Data")
            .setMessage("This will delete all synced transactions older than 7 days. Continue?")
            .setPositiveButton("Clear") { _, _ ->
                viewModel.clearOldData(7)
                Toast.makeText(this, "Old data cleared", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_dashboard, menu)
        return true
    }
    
    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            android.R.id.home -> {
                finish()
                true
            }
            R.id.action_refresh -> {
                viewModel.refresh()
                true
            }
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }
    
    override fun onResume() {
        super.onResume()
        viewModel.refresh()
    }
}

/**
 * RecyclerView Adapter for transaction lists.
 */
class TransactionAdapter(
    private val onClick: (DashboardTransactionItem) -> Unit
) : androidx.recyclerview.widget.ListAdapter<DashboardTransactionItem, TransactionAdapter.ViewHolder>(
    DiffCallback()
) {
    
    override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): ViewHolder {
        val binding = com.pos2013.offline.databinding.ItemTransactionDashboardBinding.inflate(
            android.view.LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }
    
    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
    
    inner class ViewHolder(
        private val binding: com.pos2013.offline.databinding.ItemTransactionDashboardBinding
    ) : androidx.recyclerview.widget.RecyclerView.ViewHolder(binding.root) {
        
        fun bind(transaction: DashboardTransactionItem) {
            binding.tvAmount.text = transaction.getFormattedAmount()
            binding.tvCard.text = "•••• ${transaction.cardLast4}"
            binding.tvStan.text = "STAN: ${transaction.stan}"
            binding.tvStatus.text = transaction.getStatusDisplay()
            binding.tvType.text = transaction.getTypeDisplay()
            binding.tvTime.text = SimpleDateFormat("HH:mm", Locale.getDefault())
                .format(Date(transaction.timestamp))
            
            transaction.errorMessage?.let {
                binding.tvError.text = it
                binding.tvError.visibility = View.VISIBLE
            } ?: run {
                binding.tvError.visibility = View.GONE
            }
            
            binding.root.setOnClickListener { onClick(transaction) }
        }
    }
    
    class DiffCallback : androidx.recyclerview.widget.DiffUtil.ItemCallback<DashboardTransactionItem>() {
        override fun areItemsTheSame(oldItem: DashboardTransactionItem, newItem: DashboardTransactionItem): Boolean {
            return oldItem.localTxnId == newItem.localTxnId
        }
        
        override fun areContentsTheSame(oldItem: DashboardTransactionItem, newItem: DashboardTransactionItem): Boolean {
            return oldItem == newItem
        }
    }
}
