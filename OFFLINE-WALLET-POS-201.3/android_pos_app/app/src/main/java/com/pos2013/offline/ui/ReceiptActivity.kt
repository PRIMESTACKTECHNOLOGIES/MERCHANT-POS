package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.pos2013.offline.R
import com.pos2013.offline.data.model.ReceiptData
import com.pos2013.offline.databinding.ActivityReceiptBinding
import com.pos2013.offline.presentation.viewmodel.ReceiptState
import com.pos2013.offline.presentation.viewmodel.ReceiptViewModel
import com.pos2013.offline.presentation.viewmodel.ReceiptViewModelFactory
import kotlinx.coroutines.launch

/**
 * Receipt Activity - Displays transaction receipt like a real POS terminal.
 * 
 * This is the "face" of the transaction. It shows:
 * - Amount with currency
 * - Masked card number (last 4 digits)
 * - STAN (System Trace Audit Number)
 * - Local Transaction ID
 * - Timestamp
 * - Sync status (Pending / Synced / Failed)
 * - Offline approval indicator
 * 
 * The receipt can be printed, shared, or saved.
 */
class ReceiptActivity : AppCompatActivity() {

    private lateinit var binding: ActivityReceiptBinding
    
    private val viewModel: ReceiptViewModel by viewModels {
        ReceiptViewModelFactory(this)
    }

    companion object {
        /** Intent extra: Local Transaction ID */
        const val EXTRA_LOCAL_TXN_ID = "localTxnId"
        
        /** Intent extra: Amount (for immediate display before loading) */
        const val EXTRA_AMOUNT = "amount"
        
        /** Intent extra: STAN */
        const val EXTRA_STAN = "stan"
        
        /** Intent extra: Whether this was an offline transaction */
        const val EXTRA_IS_OFFLINE = "isOffline"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityReceiptBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupUI()
        observeViewModel()
        loadReceipt()
    }

    private fun setupUI() {
        // Done button - close receipt
        binding.btnDone.setOnClickListener {
            finish()
        }

        // Share button - share receipt as text
        binding.btnShare.setOnClickListener {
            shareReceipt()
        }

        // Print button - print receipt (if printer connected)
        binding.btnPrint.setOnClickListener {
            printReceipt()
        }

        // New Transaction button - go back to main
        binding.btnNewTransaction.setOnClickListener {
            navigateToMain()
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    when (state) {
                        is ReceiptState.Loading -> showLoading()
                        is ReceiptState.Success -> displayReceipt(state.receipt)
                        is ReceiptState.Error -> showError(state.message)
                    }
                }
            }
        }
    }

    private fun loadReceipt() {
        val localTxnId = intent.getStringExtra(EXTRA_LOCAL_TXN_ID)
        
        if (localTxnId != null) {
            viewModel.loadReceipt(localTxnId)
        } else {
            // Fallback to most recent
            viewModel.loadMostRecent()
        }
    }

    private fun showLoading() {
        binding.progressBar.visibility = View.VISIBLE
        binding.receiptCard.visibility = View.GONE
        binding.errorContainer.visibility = View.GONE
    }

    private fun displayReceipt(receipt: ReceiptData) {
        binding.progressBar.visibility = View.GONE
        binding.receiptCard.visibility = View.VISIBLE
        binding.errorContainer.visibility = View.GONE

        // Amount (large, prominent)
        binding.tvAmount.text = receipt.getFormattedAmount()
        
        // Currency
        binding.tvCurrency.text = receipt.currency
        
        // Status badge
        binding.tvStatus.apply {
            text = receipt.statusDisplay
            setBackgroundResource(
                when (receipt.syncStatus) {
                    "SYNCED" -> R.drawable.bg_status_success
                    "PENDING" -> R.drawable.bg_status_pending
                    "FAILED" -> R.drawable.bg_status_failed
                    else -> R.drawable.bg_status_pending
                }
            )
        }

        // Card info
        binding.tvCard.text = receipt.getCardDisplay()
        binding.tvCardLabel.text = "Card"

        // STAN
        binding.tvStan.text = receipt.stan
        binding.tvStanLabel.text = "STAN"

        // Transaction ID
        binding.tvTxnId.text = receipt.localTxnId
        binding.tvTxnIdLabel.text = "Transaction ID"

        // Date & Time
        binding.tvDate.text = receipt.displayDate
        binding.tvTime.text = receipt.displayTime

        // Offline indicator
        if (receipt.offlineApproved) {
            binding.tvOfflineIndicator.visibility = View.VISIBLE
            binding.tvOfflineIndicator.text = "OFFLINE APPROVED"
        } else {
            binding.tvOfflineIndicator.visibility = View.GONE
        }

        // Settlement code (if synced)
        if (receipt.settlementCode != null) {
            binding.tvSettlement.visibility = View.VISIBLE
            binding.tvSettlementLabel.visibility = View.VISIBLE
            binding.tvSettlement.text = receipt.settlementCode
        } else {
            binding.tvSettlement.visibility = View.GONE
            binding.tvSettlementLabel.visibility = View.GONE
        }

        // Entry mode (if available)
        receipt.entryMode?.let { entryMode ->
            binding.tvEntryMode.visibility = View.VISIBLE
            binding.tvEntryModeLabel.visibility = View.VISIBLE
            binding.tvEntryMode.text = entryMode
        } ?: run {
            binding.tvEntryMode.visibility = View.GONE
            binding.tvEntryModeLabel.visibility = View.GONE
        }
    }

    private fun showError(message: String) {
        binding.progressBar.visibility = View.GONE
        binding.receiptCard.visibility = View.GONE
        binding.errorContainer.visibility = View.VISIBLE
        binding.tvError.text = message
    }

    private fun shareReceipt() {
        val state = viewModel.state.value
        if (state !is ReceiptState.Success) return
        
        val receipt = state.receipt
        
        val shareText = buildString {
            appendLine("🧾 PAYMENT RECEIPT")
            appendLine("==================")
            appendLine()
            appendLine("Amount: ${receipt.getFormattedAmount()}")
            appendLine("Card: ${receipt.getCardDisplay()}")
            appendLine("STAN: ${receipt.stan}")
            appendLine("Transaction ID: ${receipt.localTxnId}")
            appendLine("Date: ${receipt.displayDate}")
            appendLine("Time: ${receipt.displayTime}")
            appendLine()
            appendLine("Status: ${receipt.statusDisplay}")
            if (receipt.offlineApproved) {
                appendLine("Note: This was an offline approval")
            }
            receipt.settlementCode?.let {
                appendLine("Settlement Code: $it")
            }
        }

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Payment Receipt - ${receipt.localTxnId}")
            putExtra(Intent.EXTRA_TEXT, shareText)
        }
        
        startActivity(Intent.createChooser(intent, "Share Receipt"))
    }

    private fun printReceipt() {
        // TODO: Implement thermal printer integration
        // For now, just show a toast
        Toast.makeText(this, "Printing feature coming soon", Toast.LENGTH_SHORT).show()
    }

    private fun navigateToMain() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(intent)
        finish()
    }

    override fun onBackPressed() {
        // Go back to main instead of closing app
        navigateToMain()
    }
}
