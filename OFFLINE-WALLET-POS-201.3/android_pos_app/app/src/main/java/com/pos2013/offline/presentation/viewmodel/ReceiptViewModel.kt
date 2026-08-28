package com.pos2013.offline.presentation.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.pos2013.offline.data.model.ReceiptData
import com.pos2013.offline.data.repository.ReceiptRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * UI state for the receipt screen.
 */
sealed class ReceiptState {
    object Loading : ReceiptState()
    data class Success(val receipt: ReceiptData) : ReceiptState()
    data class Error(val message: String) : ReceiptState()
}

/**
 * ViewModel for the receipt screen.
 * 
 * Manages loading and displaying receipt data from storage.
 */
class ReceiptViewModel(
    private val repository: ReceiptRepository
) : ViewModel() {

    private val _state = MutableStateFlow<ReceiptState>(ReceiptState.Loading)
    val state: StateFlow<ReceiptState> = _state

    /**
     * Load receipt data for a specific transaction.
     */
    fun loadReceipt(localTxnId: String) {
        viewModelScope.launch {
            _state.value = ReceiptState.Loading
            
            val receipt = repository.loadReceipt(localTxnId)
            
            _state.value = if (receipt != null) {
                ReceiptState.Success(receipt)
            } else {
                ReceiptState.Error("Receipt not found")
            }
        }
    }

    /**
     * Load the most recent receipt (useful when coming from payment screen).
     */
    fun loadMostRecent() {
        viewModelScope.launch {
            _state.value = ReceiptState.Loading
            
            val receipt = repository.loadMostRecentReceipt()
            
            _state.value = if (receipt != null) {
                ReceiptState.Success(receipt)
            } else {
                ReceiptState.Error("No receipts found")
            }
        }
    }

    /**
     * Refresh the current receipt data (e.g., after sync status changes).
     */
    fun refresh(localTxnId: String) {
        loadReceipt(localTxnId)
    }
}

/**
 * Factory for creating ReceiptViewModel with context.
 */
class ReceiptViewModelFactory(
    private val context: Context
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val repository = ReceiptRepository(context.applicationContext)
        return ReceiptViewModel(repository) as T
    }
}
