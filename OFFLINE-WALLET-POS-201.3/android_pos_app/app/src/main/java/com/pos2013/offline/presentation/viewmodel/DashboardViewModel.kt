package com.pos2013.offline.presentation.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.pos2013.offline.data.model.DashboardState
import com.pos2013.offline.data.repository.DashboardRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for the Unified Sync Dashboard.
 * 
 * Manages:
 * - Dashboard state (stats, transactions)
 * - Manual sync trigger
 * - Real-time updates
 * - Error handling
 */
class DashboardViewModel(
    private val repository: DashboardRepository
) : ViewModel() {

    private val _state = MutableStateFlow<DashboardState>(DashboardState(isLoading = true))
    val state: StateFlow<DashboardState> = _state

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing

    init {
        loadDashboard()
    }

    /**
     * Load dashboard data.
     */
    fun loadDashboard() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            
            try {
                val dashboardState = repository.loadDashboardState()
                _state.value = dashboardState.copy(isLoading = false)
            } catch (e: Exception) {
                _state.value = DashboardState(
                    isLoading = false,
                    error = e.message ?: "Failed to load dashboard"
                )
            }
        }
    }

    /**
     * Trigger manual sync.
     */
    fun syncNow() {
        if (_isSyncing.value) return
        
        viewModelScope.launch {
            _isSyncing.value = true
            
            when (val result = repository.syncNow()) {
                is DashboardRepository.SyncResult.Success -> {
                    // Reload dashboard to show updated status
                    loadDashboard()
                }
                is DashboardRepository.SyncResult.Error -> {
                    _state.value = _state.value.copy(
                        error = result.message,
                        isLoading = false
                    )
                }
            }
            
            _isSyncing.value = false
        }
    }

    /**
     * Clear old synced transactions.
     */
    fun clearOldData(days: Int = 7) {
        viewModelScope.launch {
            val cleared = repository.clearOldTransactions(days)
            // Reload to show updated counts
            loadDashboard()
        }
    }

    /**
     * Clear error message.
     */
    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    /**
     * Refresh dashboard data.
     */
    fun refresh() {
        loadDashboard()
    }
}

/**
 * Factory for creating DashboardViewModel.
 */
class DashboardViewModelFactory(
    private val context: Context
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val repository = DashboardRepository(context.applicationContext)
        return DashboardViewModel(repository) as T
    }
}
