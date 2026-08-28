package com.pos2013.offline.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.pos2013.offline.R
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.worker.SyncScheduler

import com.pos2013.offline.data.MyFatoorahRepository
import com.pos2013.offline.data.OfflineOrderManager
import com.pos2013.offline.data.PaymentRepository
import com.pos2013.offline.data.model.InvoiceItem
import com.pos2013.offline.data.model.MyFatoorahResult
import com.pos2013.offline.data.model.PaymentResult
import com.pos2013.offline.data.model.RedeemResult
import com.pos2013.offline.databinding.ActivityMainBinding
import com.pos2013.offline.security.AuthManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.*

class MainActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivityMainBinding
    private lateinit var repository: PaymentRepository
    private lateinit var myfatoorahRepository: MyFatoorahRepository
    private lateinit var offlineOrderManager: OfflineOrderManager
    private val currencyFormatter = NumberFormat.getCurrencyInstance(Locale.US)
    private val pendingCountFlow = MutableStateFlow(0)
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Check if device is registered
        if (!GatewayConfig.isDeviceRegistered(this)) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        if (!AuthManager.isUnlocked(this)) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        // Initialize repositories
        repository = PaymentRepository(this)
        myfatoorahRepository = MyFatoorahRepository(this)
        offlineOrderManager = OfflineOrderManager(this)
        
        setupUI()
        
        // Auto-process offline orders when coming online
        checkAndProcessOfflineOrders()
        observePendingTransactions()
        
        // New: Schedule background sync and monitor network
        scheduleBackgroundSync()
    }
    
    private fun scheduleBackgroundSync() {
        // Use the new SyncScheduler
        SyncScheduler.schedule(this)
        
        // Observe the sync status to refresh the UI
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("offline_sync_worker")
            .observe(this) { workInfos ->
                val workInfo = workInfos.firstOrNull()
                if (workInfo?.state == WorkInfo.State.SUCCEEDED || workInfo?.state == WorkInfo.State.ENQUEUED) {
                    refreshPendingCount()
                }
            }
    }
    
    private fun setupUI() {
        // Display merchant info
        binding.tvMerchantInfo.text = "Merchant: ${GatewayConfig.MERCHANT_ID}"
        binding.tvTerminalInfo.text = "Terminal: ${GatewayConfig.TERMINAL_ID}"
        
        // Amount input buttons
        setupNumberPad()
        
        // Process payment button - Launch new Payment Entry screen
        binding.btnProcessPayment.setOnClickListener {
            startActivity(Intent(this, PaymentEntryActivity::class.java))
        }
        
        // Redeem code button
        binding.btnRedeemCode.setOnClickListener {
            showRedeemDialog()
        }
        
        // Sync button
        binding.btnSync.setOnClickListener {
            syncPendingTransactions()
        }
        
        // Dashboard button
        binding.btnDashboard?.setOnClickListener {
            startActivity(Intent(this, DashboardActivity::class.java))
        }
        
        // Settings button
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        
        // Update connection status
        updateConnectionStatus()
    }

    override fun onResume() {
        super.onResume()
        if (!AuthManager.isUnlocked(this)) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        updateConnectionStatus()
        refreshPendingCount()
    }
    
    private fun setupNumberPad() {
        val buttons = listOf(
            binding.btn0, binding.btn1, binding.btn2,
            binding.btn3, binding.btn4, binding.btn5,
            binding.btn6, binding.btn7, binding.btn8,
            binding.btn9
        )
        
        buttons.forEachIndexed { index, button ->
            button.setOnClickListener {
                appendAmount(index.toString())
            }
        }
        
        binding.btnDot.setOnClickListener {
            appendAmount(".")
        }
        
        binding.btnClear.setOnClickListener {
            binding.tvAmount.text = "0.00"
        }
        
        binding.btnBackspace.setOnClickListener {
            val current = binding.tvAmount.text.toString()
            if (current.length > 1) {
                binding.tvAmount.text = current.dropLast(1)
            } else {
                binding.tvAmount.text = "0"
            }
        }
    }
    
    private fun appendAmount(digit: String) {
        val current = binding.tvAmount.text.toString()
        
        if (current == "0" && digit != ".") {
            binding.tvAmount.text = digit
        } else {
            // Prevent multiple decimals
            if (digit == "." && current.contains(".")) return
            
            // Limit to 2 decimal places
            if (current.contains(".")) {
                val decimalPart = current.substringAfter(".")
                if (decimalPart.length >= 2) return
            }
            
            binding.tvAmount.text = current + digit
        }
    }
    
    private fun processPayment() {
        val amountStr = binding.tvAmount.text.toString()
        val amount = amountStr.toDoubleOrNull() ?: 0.0
        
        if (amount <= 0) {
            Toast.makeText(this, "Please enter a valid amount", Toast.LENGTH_SHORT).show()
            return
        }
        
        // Show payment method choice
        showPaymentMethodChoice(amount)
    }
    
    private fun showPaymentMethodChoice(amount: Double) {
        val isOnline = repository.isNetworkAvailable()
        
        if (isOnline) {
            // Online mode - show all options
            val options = arrayOf(
                "💳 Card Payment (Manual Entry)", 
                "🔗 MyFatoorah (Send Payment Link)", 
                "💵 Cash",
                "📋 View Pending Offline Orders"
            )
            
            AlertDialog.Builder(this)
                .setTitle("Select Payment Method - ${currencyFormatter.format(amount)}")
                .setItems(options) { _, which ->
                    when (which) {
                        0 -> startActivity(Intent(this, PaymentEntryActivity::class.java))
                        1 -> processMyFatoorahPayment(amount)
                        2 -> processCashPayment(amount)
                        3 -> showOfflineOrders()
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        } else {
            // Offline mode - show all options including Card Entry
            val options = arrayOf(
                "💳 Card Payment (Store Offline)",
                "📝 Create Offline Order (Send Link Later)",
                "💵 Cash",
                "⏰ Pay Later (Customer pays when ready)"
            )
            
            AlertDialog.Builder(this)
                .setTitle("⚠️ OFFLINE MODE - ${currencyFormatter.format(amount)}")
                .setMessage("No internet connection. Card payments will be stored securely and processed automatically when you go online.")
                .setItems(options) { _, which ->
                    when (which) {
                        0 -> startActivity(Intent(this, PaymentEntryActivity::class.java))
                        1 -> createOfflineOrder(amount)
                        2 -> processCashPayment(amount)
                        3 -> createOfflineOrder(amount)
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }
    
    /**
     * Create an offline order - no card data stored!
     * Just customer info so we can send payment link later
     */
    private fun createOfflineOrder(amount: Double) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_card_entry, null)
        
        dialogView.findViewById<android.widget.EditText>(R.id.etCardNumber).hint = "Customer Phone* (+971...)"
        dialogView.findViewById<android.widget.EditText>(R.id.etExpiry).hint = "Customer Name"
        dialogView.findViewById<android.widget.EditText>(R.id.etCvv).visibility = View.GONE
        
        AlertDialog.Builder(this)
            .setTitle("Offline Order - ${currencyFormatter.format(amount)}")
            .setMessage("Enter customer details. Payment link will be sent when internet returns.")
            .setView(dialogView)
            .setPositiveButton("Save Order") { _, _ ->
                val phone = dialogView.findViewById<android.widget.EditText>(R.id.etCardNumber).text.toString()
                val name = dialogView.findViewById<android.widget.EditText>(R.id.etExpiry).text.toString()
                
                if (phone.isBlank()) {
                    Toast.makeText(this, "Phone number required", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                
                lifecycleScope.launch {
                    val order = offlineOrderManager.createOfflineOrder(
                        amount = amount,
                        customerName = name.ifBlank { "Customer" },
                        customerPhone = phone
                    )
                    
                    showSuccessDialog(
                        "✅ Offline Order Saved",
                        "Order ID: ${order.orderId}\n" +
                        "Amount: ${currencyFormatter.format(amount)}\n" +
                        "Customer: ${order.customerPhone}\n\n" +
                        "Payment link will be sent automatically when internet returns."
                    )
                    binding.tvAmount.text = "0.00"
                    refreshPendingCount()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    /**
     * Show offline orders and their status
     */
    private fun showOfflineOrders() {
        val pending = offlineOrderManager.getPendingOrders()
        val linkSent = offlineOrderManager.getLinkSentOrders()
        
        val message = buildString {
            if (pending.isNotEmpty()) {
                appendLine("📦 PENDING (Waiting for internet):")
                pending.forEach { 
                    appendLine("• ${it.orderId}: ${currencyFormatter.format(it.amount)} - ${it.customerPhone}")
                }
                appendLine()
            }
            
            if (linkSent.isNotEmpty()) {
                appendLine("⏳ LINK SENT (Waiting for payment):")
                linkSent.forEach {
                    appendLine("• ${it.orderId}: ${currencyFormatter.format(it.amount)} - ${it.customerPhone}")
                }
            }
            
            if (pending.isEmpty() && linkSent.isEmpty()) {
                appendLine("No offline orders")
            }
        }
        
        AlertDialog.Builder(this)
            .setTitle("Offline Orders")
            .setMessage(message)
            .setPositiveButton("Process Pending") { _, _ ->
                lifecycleScope.launch {
                    processOfflineOrdersNow()
                }
            }
            .setNeutralButton("Check Payments") { _, _ ->
                lifecycleScope.launch {
                    checkOfflinePayments()
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }
    
    /**
     * Check and process offline orders when coming online
     */
    private fun checkAndProcessOfflineOrders() {
        if (repository.isNetworkAvailable()) {
            lifecycleScope.launch {
                // 1. Sync card transactions
                if (repository.getPendingCount() > 0) {
                    repository.syncPendingTransactions()
                }
                
                // 2. Process offline orders
                if (offlineOrderManager.getPendingCount() > 0) {
                    processOfflineOrdersNow()
                }
                
                refreshPendingCount()
            }
        }
    }
    
    private suspend fun processOfflineOrdersNow() {
        if (!repository.isNetworkAvailable()) {
            Toast.makeText(this, "No internet connection", Toast.LENGTH_SHORT).show()
            return
        }
        
        binding.progressBar.visibility = View.VISIBLE
        val processed = offlineOrderManager.processPendingOrders()
        binding.progressBar.visibility = View.GONE
        
        if (processed.isNotEmpty()) {
            Toast.makeText(
                this, 
                "Sent ${processed.size} payment link(s) to customers", 
                Toast.LENGTH_LONG
            ).show()
        }
        
        refreshPendingCount()
    }
    
    private suspend fun checkOfflinePayments() {
        binding.progressBar.visibility = View.VISIBLE
        val paid = offlineOrderManager.checkPendingPayments()
        binding.progressBar.visibility = View.GONE
        
        if (paid.isNotEmpty()) {
            showSuccessDialog(
                "💰 Payments Received!",
                "${paid.size} order(s) paid:\n" +
                paid.joinToString("\n") { "• ${it.orderId}: ${currencyFormatter.format(it.amount)}" }
            )
        } else {
            Toast.makeText(this, "No new payments yet", Toast.LENGTH_SHORT).show()
        }
        
        refreshPendingCount()
    }
    
    private fun processCashPayment(amount: Double) {
        showSuccessDialog(
            "Cash Payment",
            "Amount: ${currencyFormatter.format(amount)}\n\nPlease collect cash from customer."
        )
        binding.tvAmount.text = "0.00"
    }
    
    private fun processMyFatoorahPayment(amount: Double = 0.0) {
        val finalAmount = if (amount > 0) amount else {
            binding.tvAmount.text.toString().toDoubleOrNull() ?: 0.0
        }
        
        if (finalAmount <= 0) {
            Toast.makeText(this, "Please enter a valid amount", Toast.LENGTH_SHORT).show()
            return
        }
        
        if (!GatewayConfig.isMyFatoorahConfigured()) {
            Toast.makeText(this, "MyFatoorah not configured. Please add API token in Settings.", Toast.LENGTH_LONG).show()
            return
        }
        
        if (!repository.isNetworkAvailable()) {
            Toast.makeText(this, "Internet required for MyFatoorah payments", Toast.LENGTH_SHORT).show()
            return
        }
        
        // Show dialog for customer details
        showMyFatoorahDialog(finalAmount)
    }
    
    private fun showMyFatoorahDialog(amount: Double) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_card_entry, null)
        
        // Change hint for phone number
        dialogView.findViewById<android.widget.EditText>(R.id.etCardNumber).hint = "Customer Phone (+971...)"
        dialogView.findViewById<android.widget.EditText>(R.id.etExpiry).hint = "Customer Name (Optional)"
        dialogView.findViewById<android.widget.EditText>(R.id.etCvv).visibility = View.GONE
        
        AlertDialog.Builder(this)
            .setTitle("MyFatoorah Payment - ${currencyFormatter.format(amount)}")
            .setMessage("Enter customer details to send payment link")
            .setView(dialogView)
            .setPositiveButton("Create Payment Link") { _, _ ->
                val phone = dialogView.findViewById<android.widget.EditText>(R.id.etCardNumber).text.toString()
                val name = dialogView.findViewById<android.widget.EditText>(R.id.etExpiry).text.toString()
                
                createMyFatoorahPayment(amount, phone, name)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun createMyFatoorahPayment(amount: Double, phone: String, name: String) {
        binding.progressBar.visibility = View.VISIBLE
        
        lifecycleScope.launch {
            val customerName = name.ifBlank { "Customer" }
            val customerPhone = phone.ifBlank { null }
            
            val result = myfatoorahRepository.createPaymentLink(
                amount = amount,
                customerName = customerName,
                customerMobile = customerPhone,
                reference = "POS-${System.currentTimeMillis()}",
                items = listOf(
                    InvoiceItem(
                        itemName = "Purchase",
                        quantity = 1,
                        unitPrice = amount
                    )
                )
            )
            
            binding.progressBar.visibility = View.GONE
            
            when (result) {
                is MyFatoorahResult.Success -> {
                    showMyFatoorahSuccessDialog(result.paymentUrl, customerPhone)
                    binding.tvAmount.text = "0.00"
                }
                is MyFatoorahResult.Error -> {
                    showErrorDialog("MyFatoorah Error", result.message)
                }
            }
        }
    }
    
    private fun showMyFatoorahSuccessDialog(paymentUrl: String, customerPhone: String?) {
        AlertDialog.Builder(this)
            .setTitle("Payment Link Created")
            .setMessage("Payment link generated successfully!\n\nSend to customer via WhatsApp/SMS or let them scan QR code.")
            .setPositiveButton("Send to Customer") { _, _ ->
                myfatoorahRepository.sharePaymentLink(paymentUrl, customerPhone)
            }
            .setNeutralButton("Open in Browser") { _, _ ->
                myfatoorahRepository.openPaymentInBrowser(paymentUrl)
            }
            .setNegativeButton("Copy Link") { _, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = android.content.ClipData.newPlainText("Payment Link", paymentUrl)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "Link copied to clipboard", Toast.LENGTH_SHORT).show()
            }
            .show()
    }
    
    // Card entry now handled by PaymentEntryActivity
    private fun showCardEntryDialogLegacy(amount: Double) {
        // Legacy method - now redirects to PaymentEntryActivity
        startActivity(Intent(this, PaymentEntryActivity::class.java))
    }
    
    // Keeping old method for reference
    private fun showCardEntryDialogOld(amount: Double) {
        /* Old implementation replaced by PaymentEntryActivity */
            .setPositiveButton("Process") { _, _ ->
                val cardNumber = dialogView.findViewById<android.widget.EditText>(R.id.etCardNumber).text.toString()
                val expiry = dialogView.findViewById<android.widget.EditText>(R.id.etExpiry).text.toString()
                val cvv = dialogView.findViewById<android.widget.EditText>(R.id.etCvv).text.toString()
                
                if (validateCardInput(cardNumber, expiry)) {
                    processCardPayment(cardNumber, expiry, cvv, amount)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun validateCardInput(cardNumber: String, expiry: String): Boolean {
        if (cardNumber.length < 13) {
            Toast.makeText(this, "Invalid card number", Toast.LENGTH_SHORT).show()
            return false
        }
        if (expiry.length != 5 || !expiry.contains("/")) {
            Toast.makeText(this, "Invalid expiry format (MM/YY)", Toast.LENGTH_SHORT).show()
            return false
        }
        return true
    }
    
    private fun processCardPayment(cardNumber: String, expiry: String, cvv: String, amount: Double) {
        binding.progressBar.visibility = View.VISIBLE
        binding.btnProcessPayment.isEnabled = false
        
        lifecycleScope.launch {
            val result = repository.processPayment(cardNumber, expiry, cvv, amount)
            
            binding.progressBar.visibility = View.GONE
            binding.btnProcessPayment.isEnabled = true
            
            when (result) {
                is PaymentResult.Success -> {
                    showReceipt(amount, result.stan, result.localTxnId, result.settlementCode, "APPROVED", false)
                    binding.tvAmount.text = "0.00"
                    refreshPendingCount()
                }
                is PaymentResult.Pending -> {
                    showReceipt(amount, result.stan, result.localTxnId, null, "STORED OFFLINE", true)
                    binding.tvAmount.text = "0.00"
                    refreshPendingCount()
                }
                is PaymentResult.Error -> {
                    showErrorDialog("Payment Failed", result.message)
                }
            }
        }
    }
    
    private fun showRedeemDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_redeem, null)
        
        AlertDialog.Builder(this)
            .setTitle("Redeem Payment Code")
            .setView(dialogView)
            .setPositiveButton("Redeem") { _, _ ->
                val code = dialogView.findViewById<android.widget.EditText>(R.id.etCode).text.toString()
                val amountStr = dialogView.findViewById<android.widget.EditText>(R.id.etAmount).text.toString()
                val amount = amountStr.toDoubleOrNull() ?: 0.0
                
                if (code.length == 6 && amount > 0) {
                    redeemCode(code, amount)
                } else {
                    Toast.makeText(this, "Invalid code or amount", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun redeemCode(code: String, amount: Double) {
        binding.progressBar.visibility = View.VISIBLE
        
        lifecycleScope.launch {
            val result = repository.redeemCode(code, amount)
            
            binding.progressBar.visibility = View.GONE
            
            when (result) {
                is RedeemResult.Success -> {
                    showSuccessDialog(
                        "Code Redeemed",
                        "Code: $code\n" +
                        "Amount: ${currencyFormatter.format(amount)}\n" +
                        "Reference: ${result.reference ?: "N/A"}\n" +
                        "Settlement: ${result.settlementCode ?: "N/A"}"
                    )
                }
                is RedeemResult.Error -> {
                    showErrorDialog("Redemption Failed", result.message)
                }
            }
        }
    }
    
    private fun syncPendingTransactions() {
        if (!repository.isNetworkAvailable()) {
            Toast.makeText(this, "No internet connection", Toast.LENGTH_SHORT).show()
            return
        }
        
        binding.progressBar.visibility = View.VISIBLE
        binding.btnSync.isEnabled = false
        
        lifecycleScope.launch {
            // Use the new SyncRepositoryImpl for immediate sync
            val syncRepo = com.pos2013.offline.data.repository.SyncRepositoryImpl(this@MainActivity)
            val summary = syncRepo.syncPending()
            
            binding.progressBar.visibility = View.GONE
            binding.btnSync.isEnabled = true
            
            val message = buildString {
                appendLine("Sync Complete")
                appendLine("Total: ${summary.total}")
                appendLine("Synced: ${summary.synced}")
                appendLine("Failed: ${summary.failed}")
                if (summary.settlementCodes.isNotEmpty()) {
                    appendLine("\nSettlement Codes:")
                    summary.settlementCodes.forEach {
                        appendLine("- $it")
                    }
                }
            }
            
            AlertDialog.Builder(this@MainActivity)
                .setTitle("Sync Results")
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show()
            
            refreshPendingCount()
        }
    }
    
    private fun observePendingTransactions() {
        lifecycleScope.launch {
            pendingCountFlow.collectLatest { count ->
                if (count > 0) {
                    binding.tvPendingCount.visibility = View.VISIBLE
                    binding.tvPendingCount.text = "$count pending"
                    binding.btnSync.visibility = View.VISIBLE
                } else {
                    binding.tvPendingCount.visibility = View.GONE
                    binding.btnSync.visibility = View.GONE
                }
            }
        }
        refreshPendingCount()
    }
    
    private fun refreshPendingCount() {
        lifecycleScope.launch {
            val txnCount = repository.getPendingCount()
            val orderCount = offlineOrderManager.getPendingCount() + offlineOrderManager.getLinkSentCount()
            pendingCountFlow.value = txnCount + orderCount
        }
    }
    
    private fun updateConnectionStatus() {
        val isOnline = repository.isNetworkAvailable()
        binding.tvConnectionStatus.text = if (isOnline) "🟢 Online" else "🔴 Offline"
        binding.tvConnectionStatus.setTextColor(
            if (isOnline) getColor(android.R.color.holo_green_dark)
            else getColor(android.R.color.holo_red_dark)
        )
    }

    private fun showReceipt(amount: Double, stan: String, txnId: String, settlementCode: String?, status: String, isOffline: Boolean) {
        val intent = Intent(this, ReceiptActivity::class.java).apply {
            putExtra(ReceiptActivity.EXTRA_LOCAL_TXN_ID, txnId)
            putExtra(ReceiptActivity.EXTRA_AMOUNT, amount)
            putExtra(ReceiptActivity.EXTRA_STAN, stan)
            putExtra(ReceiptActivity.EXTRA_IS_OFFLINE, isOffline)
        }
        startActivity(intent)
    }
    
    private fun showSettingsDialog() {
        val myfatoorahStatus = if (GatewayConfig.isMyFatoorahConfigured()) "✅" else "❌"
        val pendingOrders = offlineOrderManager.getPendingCount()
        val linkSent = offlineOrderManager.getLinkSentCount()
        
        val options = arrayOf(
            "View Pending Transactions",
            "View Offline Orders ($pendingOrders pending, $linkSent waiting)",
            "Clear Old Data",
            "Configure MyFatoorah $myfatoorahStatus",
            "Logout"
        )
        
        AlertDialog.Builder(this)
            .setTitle("Settings")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> showPendingTransactions()
                    1 -> showOfflineOrders()
                    2 -> clearOldData()
                    3 -> showMyFatoorahConfigDialog()
                    4 -> logout()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun showMyFatoorahConfigDialog() {
        val input = android.widget.EditText(this).apply {
            hint = "Enter MyFatoorah API Token"
            setText(GatewayConfig.MYFATOORAH_TOKEN)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        
        val testModeCheckbox = android.widget.CheckBox(this).apply {
            text = "Test Mode (Sandbox)"
            isChecked = GatewayConfig.MYFATOORAH_TEST_MODE
        }
        
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 20, 50, 20)
            addView(input)
            addView(testModeCheckbox)
        }
        
        AlertDialog.Builder(this)
            .setTitle("MyFatoorah Configuration")
            .setView(layout)
            .setPositiveButton("Save") { _, _ ->
                val token = input.text.toString().trim()
                if (token.isNotBlank()) {
                    GatewayConfig.saveMyFatoorahConfig(this, token, testModeCheckbox.isChecked)
                    Toast.makeText(this, "MyFatoorah configured successfully", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Token cannot be empty", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun showPendingTransactions() {
        lifecycleScope.launch {
            val pending = repository.getPendingTransactions()
            if (pending.isEmpty()) {
                Toast.makeText(this@MainActivity, "No pending transactions", Toast.LENGTH_SHORT).show()
                return@launch
            }
            
            val message = pending.joinToString("\n\n") { txn ->
                "STAN: ${txn.stan}\n" +
                "Amount: ${currencyFormatter.format(txn.amountMinor / 100.0)}\n" +
                "Status: ${txn.syncStatus}"
            }
            
            AlertDialog.Builder(this@MainActivity)
                .setTitle("Pending Transactions (${pending.size})")
                .setMessage(message)
                .setPositiveButton("Sync Now") { _, _ -> syncPendingTransactions() }
                .setNegativeButton("Close", null)
                .show()
        }
    }
    
    private fun clearOldData() {
        lifecycleScope.launch {
            repository.clearOldTransactions(7 * 24 * 60 * 60 * 1000) // 7 days
            offlineOrderManager.clearOldOrders(7) // 7 days
            Toast.makeText(this@MainActivity, "Old data cleared", Toast.LENGTH_SHORT).show()
            refreshPendingCount()
        }
    }
    
    private fun logout() {
        AlertDialog.Builder(this)
            .setTitle("Logout")
            .setMessage("Are you sure you want to logout?")
            .setPositiveButton("Yes") { _, _ ->
                GatewayConfig.clearRegistration(this)
                startActivity(Intent(this, SetupActivity::class.java))
                finish()
            }
            .setNegativeButton("No", null)
            .show()
    }
    
    private fun showSuccessDialog(title: String, message: String) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK") { _, _ ->
                // Print receipt option could go here
            }
            .setNeutralButton("Print Receipt") { _, _ ->
                Toast.makeText(this, "Receipt printed", Toast.LENGTH_SHORT).show()
            }
            .show()
    }
    
    private fun showPendingDialog(title: String, message: String) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .setNeutralButton("Sync Now") { _, _ -> syncPendingTransactions() }
            .show()
    }
    
    private fun showErrorDialog(title: String, message: String) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }
}
