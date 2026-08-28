package com.pos2013.offline.presentation.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pos2013.offline.domain.usecase.VerifyTerminalUseCase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * UI state for terminal verification.
 */
sealed class TerminalVerificationState {
    object Idle : TerminalVerificationState()
    object Loading : TerminalVerificationState()
    data class Success(
        val message: String,
        val merchantId: String,
        val terminalId: String
    ) : TerminalVerificationState()
    data class Error(
        val message: String,
        val code: VerifyTerminalUseCase.ErrorCode
    ) : TerminalVerificationState()
}

/**
 * ViewModel for terminal verification screen.
 *
 * Manages the verification flow:
 * - Input validation
 * - API call
 * - State management
 * - Error handling
 */
class TerminalViewModel(
    private val context: Context
) : ViewModel() {

    private val verifyUseCase = VerifyTerminalUseCase(context)

    private val _state = MutableStateFlow<TerminalVerificationState>(TerminalVerificationState.Idle)
    val state: StateFlow<TerminalVerificationState> = _state

    private val _isVerified = MutableStateFlow(verifyUseCase.isVerified())
    val isVerified: StateFlow<Boolean> = _isVerified

    /**
     * Verify terminal with provided credentials.
     */
    fun verifyTerminal(
        merchantId: String,
        terminalId: String,
        secretKey: String,
        serverUrl: String? = null
    ) {
        // Validation
        val validationError = validateInput(merchantId, terminalId, secretKey)
        if (validationError != null) {
            _state.value = TerminalVerificationState.Error(
                message = validationError,
                code = VerifyTerminalUseCase.ErrorCode.UNKNOWN
            )
            return
        }

        // Start loading
        _state.value = TerminalVerificationState.Loading

        // Launch verification
        viewModelScope.launch {
            val result = verifyUseCase(
                merchantId = merchantId.trim(),
                terminalId = terminalId.trim(),
                secretKey = secretKey.trim(),
                serverUrl = serverUrl?.trim()
            )

            _state.value = when (result) {
                is VerifyTerminalUseCase.Result.Success -> {
                    _isVerified.value = true
                    TerminalVerificationState.Success(
                        message = result.message,
                        merchantId = result.merchantId,
                        terminalId = result.terminalId
                    )
                }
                is VerifyTerminalUseCase.Result.Error -> {
                    TerminalVerificationState.Error(
                        message = result.message,
                        code = result.code
                    )
                }
            }
        }
    }

    /**
     * Reset state to idle (e.g., after showing error).
     */
    fun resetState() {
        _state.value = TerminalVerificationState.Idle
    }

    /**
     * Clear verification (logout).
     */
    fun logout() {
        verifyUseCase.clearVerification()
        _isVerified.value = false
        _state.value = TerminalVerificationState.Idle
    }

    /**
     * Validate input fields.
     */
    private fun validateInput(
        merchantId: String,
        terminalId: String,
        secretKey: String
    ): String? {
        return when {
            merchantId.isBlank() -> "Merchant ID is required"
            terminalId.isBlank() -> "Terminal ID is required"
            secretKey.isBlank() -> "Secret Key is required"
            merchantId.length < 3 -> "Merchant ID too short"
            terminalId.length < 3 -> "Terminal ID too short"
            else -> null
        }
    }
}

/**
 * Factory for creating TerminalViewModel with context.
 */
class TerminalViewModelFactory(
    private val context: Context
) : androidx.lifecycle.ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return TerminalViewModel(context.applicationContext) as T
    }
}
