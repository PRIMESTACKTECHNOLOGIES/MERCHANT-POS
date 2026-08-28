package com.pos2013.offline.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.pos2013.offline.data.local.AppDatabase
import com.pos2013.offline.data.local.SecureStorage
import com.pos2013.offline.data.local.entity.SyncStatus
import com.pos2013.offline.data.local.entity.TransactionEntity
import com.pos2013.offline.data.local.entity.TransactionStatus
import com.pos2013.offline.data.repository.TransactionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

/**
 * ViewModel for POS (Point of Sale) operations.
 * Manages UI state and business logic for transaction processing.
 */
class PosViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: TransactionRepository
    private val secureStorage: SecureStorage

    // UI State
    private val _uiState = MutableStateFlow(PosUiState())
    val uiState: StateFlow<PosUiState> = _uiState

    // Current transaction amount
    private val _currentAmount = MutableLiveData("0.00")
    val currentAmount: LiveData<String> = _currentAmount

    // Pending sync count
    private val _pendingCount = MutableLiveData(0)
    val pendingCount: LiveData<Int> = _pendingCount

    // Recent transactions
    private val _recentTransactions = MutableLiveData<List<TransactionEntity>>()
    val recentTransactions: LiveData<List<TransactionEntity>> = _recentTransactions

    // Sync status
    private val _syncStatus = MutableLiveData<SyncResult>()
    val syncStatus: LiveData<SyncResult> = _syncStatus

    init {
        val database = AppDatabase.getInstance(application)
        repository = TransactionRepository(database.transactionDao())
        secureStorage = SecureStorage(application)

        // Collect pending count
        viewModelScope.launch {
            repository.pendingTransactions.collectLatest { pending ->
                _pendingCount.postValue(pending.size)
            }
        }

        // Collect recent transactions
        viewModelScope.launch {
            repository.allTransactions.collectLatest { transactions ->
                _recentTransactions.postValue(transactions.take(10))
            }
        }

        // Load initial stats
        loadStats()
    }

    fun appendDigit(digit: String) {
        val current = _currentAmount.value ?: "0.00"
        if (current == "0.00") {
            _currentAmount.value = "0.0$digit"
        } else if (current.length < 10) {
            _currentAmount.value = current + digit
        }
    }

    fun backspace() {
        val current = _currentAmount.value ?: "0.00"
        if (current.length > 1) {
            _currentAmount.value = current.dropLast(1)
        } else {
            _currentAmount.value = "0.00"
        }
    }

    fun clearAmount() {
        _currentAmount.value = "0.00"
    }

    fun setAmount(amount: String) {
        _currentAmount.value = amount
    }

    fun processPayment(
        cardNumber: String? = null,
        expiryDate: String? = null,
        cvv: String? = null,
        customerName: String? = null,
        customerMobile: String? = null,
        description: String? = null
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isProcessing = true, error = null)

            try {
                val amountStr = _currentAmount.value ?: "0.00"
                val amount = amountStr.toDoubleOrNull() ?: 0.0
                val amountMinor = (amount * 100).toLong()

                if (amountMinor <= 0) {
                    _uiState.value = _uiState.value.copy(
                        isProcessing = false,
                        error = "Invalid amount"
                    )
                    return@launch
                }

                val transaction = createTransaction(
                    amountMinor = amountMinor,
                    cardNumber = cardNumber,
                    expiryDate = expiryDate,
                    cvv = cvv,
                    customerName = customerName,
                    customerMobile = customerMobile,
                    description = description
                )

                repository.insert(transaction)

                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    lastTransaction = transaction,
                    showReceipt = true
                )

                // Reset amount after successful transaction
                clearAmount()

            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isProcessing = false,
                    error = e.message ?: "Transaction failed"
                )
            }
        }
    }

    fun syncPendingTransactions() {
        viewModelScope.launch {
            _syncStatus.value = SyncResult.InProgress

            try {
                val pending = repository.getPendingTransactions()
                
                if (pending.isEmpty()) {
                    _syncStatus.value = SyncResult.Success(0, "No pending transactions")
                    return@launch
                }

                var synced = 0
                var failed = 0

                for (transaction in pending) {
                    try {
                        repository.markAsSyncing(transaction.id)
                        
                        // Simulate API call - replace with actual sync logic
                        // val result = apiService.syncTransaction(transaction)
                        
                        // Mark as synced
                        repository.markAsSynced(transaction.id, generateSettlementCode())
                        synced++

                    } catch (e: Exception) {
                        repository.markAsFailed(transaction.id, e.message)
                        failed++
                    }
                }

                _syncStatus.value = SyncResult.Success(synced, 
                    "Synced $synced, Failed $failed")
                secureStorage.setLastSync(System.currentTimeMillis())

            } catch (e: Exception) {
                _syncStatus.value = SyncResult.Error(e.message ?: "Sync failed")
            }
        }
    }

    private fun createTransaction(
        amountMinor: Long,
        cardNumber: String?,
        expiryDate: String?,
        cvv: String?,
        customerName: String?,
        customerMobile: String?,
        description: String?
    ): TransactionEntity {
        val id = UUID.randomUUID().toString()
        val localTxnId = "TXN-${System.currentTimeMillis()}"
        val stan = generateStan()
        val batchId = "BATCH-${SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())}"
        val maskedPan = cardNumber?.let { maskPan(it) }

        return TransactionEntity(
            id = id,
            localTxnId = localTxnId,
            batchId = batchId,
            merchantId = secureStorage.getMerchantId().ifEmpty { "MRC-1001" },
            terminalId = secureStorage.getTerminalId().ifEmpty { "TERM-001" },
            stan = stan,
            amountMinor = amountMinor,
            currency = "AED",
            panMasked = maskedPan,
            cardType = detectCardType(cardNumber),
            txnType = "SALE",
            authMode = if (secureStorage.isOfflineMode()) "OFFLINE_APPROVED" else "ONLINE",
            entryMode = if (cardNumber != null) "KEYED" else "MANUAL",
            rrn = generateRrn(),
            authCode = generateAuthCode(),
            settlementCode = null,
            status = TransactionStatus.APPROVED.name,
            syncStatus = SyncStatus.PENDING.name,
            errorMessage = null,
            emvData = null,
            receiptData = null,
            customerName = customerName,
            customerMobile = customerMobile,
            description = description ?: "POS Transaction",
            txnTimestamp = System.currentTimeMillis()
        )
    }

    private fun generateStan(): String {
        return String.format("%06d", (100000..999999).random())
    }

    private fun generateRrn(): String {
        return String.format("%012d", System.currentTimeMillis() % 1000000000000)
    }

    private fun generateAuthCode(): String {
        return String.format("%06d", (100000..999999).random())
    }

    private fun generateSettlementCode(): String {
        return String.format("%06d", (100000..999999).random())
    }

    private fun maskPan(pan: String): String {
        if (pan.length < 4) return pan
        return "****" + pan.takeLast(4)
    }

    private fun detectCardType(cardNumber: String?): String? {
        if (cardNumber.isNullOrEmpty()) return null
        return when {
            cardNumber.startsWith("4") -> "VISA"
            cardNumber.startsWith("5") -> "MASTERCARD"
            cardNumber.startsWith("34") || cardNumber.startsWith("37") -> "AMEX"
            cardNumber.startsWith("6") -> "DISCOVER"
            else -> "UNKNOWN"
        }
    }

    private fun loadStats() {
        viewModelScope.launch {
            val pendingCount = repository.getPendingCount()
            val pendingAmount = repository.getPendingAmount()
            val todayAmount = repository.getTodaySyncedAmount()

            _uiState.value = _uiState.value.copy(
                pendingCount = pendingCount,
                pendingAmount = pendingAmount,
                todayAmount = todayAmount
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun receiptShown() {
        _uiState.value = _uiState.value.copy(showReceipt = false)
    }
}

/**
 * UI State for POS screen
 */
data class PosUiState(
    val isProcessing: Boolean = false,
    val error: String? = null,
    val lastTransaction: TransactionEntity? = null,
    val showReceipt: Boolean = false,
    val pendingCount: Int = 0,
    val pendingAmount: Long = 0,
    val todayAmount: Long = 0
)

/**
 * Sync result sealed class
 */
sealed class SyncResult {
    object InProgress : SyncResult()
    data class Success(val count: Int, val message: String) : SyncResult()
    data class Error(val message: String) : SyncResult()
}
