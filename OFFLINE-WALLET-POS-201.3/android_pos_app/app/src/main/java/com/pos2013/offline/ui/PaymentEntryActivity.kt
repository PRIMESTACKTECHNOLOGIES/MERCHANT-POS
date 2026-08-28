package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.pos2013.offline.R
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.PaymentRepository
import com.pos2013.offline.data.model.PaymentResult
import com.pos2013.offline.databinding.ActivityPaymentEntryBinding
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.*

/**
 * Professional POS Manual Entry Screen.
 * 
 * Real-world terminal interface for entering:
 * - Amount (with currency formatting)
 * - Card number (auto-formatted 4-4-4-4)
 * - Expiry date (MM/YY auto-format)
 * - CVV/CVC (3-4 digits)
 * - Transaction type (Sale, Refund, etc.)
 * 
 * Features:
 * - Real-time validation
 * - Secure input masking
 * - Amount keypad with quick amounts
 * - Card type detection (Visa, MasterCard, etc.)
 * - Luhn algorithm validation
 */
class PaymentEntryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPaymentEntryBinding
    private val currencyFormatter = NumberFormat.getCurrencyInstance(Locale.US)
    
    private var currentAmount = 0.0
    private var transactionType = TransactionType.SALE
    
    enum class TransactionType {
        SALE, REFUND, PREAUTH, VOID
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPaymentEntryBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupToolbar()
        setupAmountInput()
        setupCardNumberInput()
        setupExpiryInput()
        setupCvvInput()
        setupTransactionTypeSelector()
        setupActionButtons()
        
        // Focus on amount first
        binding.etAmount.requestFocus()
    }
    
    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = "Manual Entry"
        supportActionBar?.subtitle = "Terminal: ${GatewayConfig.TERMINAL_ID}"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
    }
    
    private fun setupAmountInput() {
        // Amount display formatting
        binding.etAmount.addTextChangedListener(object : TextWatcher {
            private var current = ""
            
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            
            override fun afterTextChanged(s: Editable?) {
                if (s.toString() != current) {
                    binding.etAmount.removeTextChangedListener(this)
                    
                    val cleanString = s.toString().replace("[^0-9.]".toRegex(), "")
                    val parsed = cleanString.toDoubleOrNull() ?: 0.0
                    currentAmount = parsed
                    
                    current = currencyFormatter.format(parsed)
                    binding.etAmount.setText(current)
                    binding.etAmount.setSelection(current.length)
                    
                    binding.etAmount.addTextChangedListener(this)
                    validateForm()
                }
            }
        })
        
        // Quick amount buttons
        binding.btnQuick10.setOnClickListener { setAmount(10.0) }
        binding.btnQuick20.setOnClickListener { setAmount(20.0) }
        binding.btnQuick50.setOnClickListener { setAmount(50.0) }
        binding.btnQuick100.setOnClickListener { setAmount(100.0) }
        binding.btnQuickExact.setOnClickListener { setAmount(0.0) }
    }
    
    private fun setAmount(amount: Double) {
        currentAmount = amount
        binding.etAmount.setText(currencyFormatter.format(amount))
        binding.etCardNumber.requestFocus()
    }
    
    private fun setupCardNumberInput() {
        binding.etCardNumber.addTextChangedListener(object : TextWatcher {
            private var current = ""
            
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            
            override fun afterTextChanged(s: Editable?) {
                if (s.toString() != current) {
                    val userInput = s.toString().replace(" ", "")
                    
                    if (userInput.length <= 19) {
                        val formatted = formatCardNumber(userInput)
                        current = formatted
                        
                        binding.etCardNumber.removeTextChangedListener(this)
                        binding.etCardNumber.setText(formatted)
                        binding.etCardNumber.setSelection(formatted.length)
                        binding.etCardNumber.addTextChangedListener(this)
                        
                        // Detect card type
                        updateCardType(userInput)
                        validateForm()
                    }
                }
            }
        })
    }
    
    private fun formatCardNumber(number: String): String {
        return number.chunked(4).joinToString(" ")
    }
    
    private fun updateCardType(number: String) {
        val cardType = when {
            number.startsWith("4") -> CardType.VISA
            number.startsWith("5") -> CardType.MASTERCARD
            number.startsWith("34") || number.startsWith("37") -> CardType.AMEX
            number.startsWith("6") -> CardType.DISCOVER
            else -> CardType.UNKNOWN
        }
        
        binding.ivCardType.setImageResource(cardType.iconRes)
        binding.ivCardType.visibility = if (number.isNotEmpty()) View.VISIBLE else View.GONE
        
        // AMEX has 4-digit CVV, others have 3
        val cvvLength = if (cardType == CardType.AMEX) 4 else 3
        binding.etCvv.filters = arrayOf(InputFilter.LengthFilter(cvvLength))
    }
    
    enum class CardType(val iconRes: Int) {
        VISA(R.drawable.ic_card_visa),
        MASTERCARD(R.drawable.ic_card_mastercard),
        AMEX(R.drawable.ic_card_amex),
        DISCOVER(R.drawable.ic_card_discover),
        UNKNOWN(R.drawable.ic_card_generic)
    }
    
    private fun setupExpiryInput() {
        binding.etExpiry.addTextChangedListener(object : TextWatcher {
            private var current = ""
            
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            
            override fun afterTextChanged(s: Editable?) {
                if (s.toString() != current) {
                    val userInput = s.toString().replace("/", "")
                    
                    if (userInput.length <= 4) {
                        val formatted = if (userInput.length >= 2) {
                            "${userInput.substring(0, 2)}/${userInput.substring(2)}"
                        } else userInput
                        
                        current = formatted
                        
                        binding.etExpiry.removeTextChangedListener(this)
                        binding.etExpiry.setText(formatted)
                        binding.etExpiry.setSelection(formatted.length)
                        binding.etExpiry.addTextChangedListener(this)
                        
                        validateForm()
                    }
                }
            }
        })
    }
    
    private fun setupCvvInput() {
        binding.etCvv.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                validateForm()
            }
        })
        
        // CVV help button
        binding.btnCvvHelp.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("CVV/CVC")
                .setMessage("The 3 or 4 digit code on the back of your card (front for AMEX).")
                .setPositiveButton("OK", null)
                .show()
        }
    }
    
    private fun setupTransactionTypeSelector() {
        binding.chipSale.setOnClickListener { transactionType = TransactionType.SALE }
        binding.chipRefund.setOnClickListener { transactionType = TransactionType.REFUND }
        binding.chipPreAuth.setOnClickListener { transactionType = TransactionType.PREAUTH }
        
        // Default to sale
        binding.chipSale.isChecked = true
    }
    
    private fun setupActionButtons() {
        binding.btnProcess.setOnClickListener {
            if (validateForm(showErrors = true)) {
                processPayment()
            }
        }
        
        binding.btnClear.setOnClickListener {
            clearForm()
        }
        
        binding.btnCancel.setOnClickListener {
            finish()
        }
    }
    
    private fun validateForm(showErrors: Boolean = false): Boolean {
        var isValid = true
        
        // Amount validation
        if (currentAmount <= 0) {
            if (showErrors) binding.tilAmount.error = "Enter valid amount"
            isValid = false
        } else {
            binding.tilAmount.error = null
        }
        
        // Card number validation (Luhn algorithm)
        val cardNumber = binding.etCardNumber.text.toString().replace(" ", "")
        if (!isValidCardNumber(cardNumber)) {
            if (showErrors) binding.tilCardNumber.error = "Invalid card number"
            isValid = false
        } else {
            binding.tilCardNumber.error = null
        }
        
        // Expiry validation
        val expiry = binding.etExpiry.text.toString()
        if (!isValidExpiry(expiry)) {
            if (showErrors) binding.tilExpiry.error = "Invalid expiry (MM/YY)"
            isValid = false
        } else {
            binding.tilExpiry.error = null
        }
        
        // CVV validation
        val cvv = binding.etCvv.text.toString()
        if (cvv.length !in 3..4) {
            if (showErrors) binding.tilCvv.error = "Invalid CVV"
            isValid = false
        } else {
            binding.tilCvv.error = null
        }
        
        // Enable/disable process button
        binding.btnProcess.isEnabled = isValid
        
        return isValid
    }
    
    private fun isValidCardNumber(number: String): Boolean {
        if (number.length < 13 || number.length > 19) return false
        
        // Luhn algorithm
        var sum = 0
        var alternate = false
        for (i in number.length - 1 downTo 0) {
            var n = number.substring(i, i + 1).toInt()
            if (alternate) {
                n *= 2
                if (n > 9) n -= 9
            }
            sum += n
            alternate = !alternate
        }
        return sum % 10 == 0
    }
    
    private fun isValidExpiry(expiry: String): Boolean {
        if (!expiry.matches(Regex("^(0[1-9]|1[0-2])/[0-9]{2}$"))) return false
        
        val parts = expiry.split("/")
        val month = parts[0].toInt()
        val year = parts[1].toInt() + 2000
        
        val calendar = Calendar.getInstance()
        val currentMonth = calendar.get(Calendar.MONTH) + 1
        val currentYear = calendar.get(Calendar.YEAR)
        
        return when {
            year < currentYear -> false
            year == currentYear && month < currentMonth -> false
            else -> true
        }
    }
    
    private fun processPayment() {
        val cardNumber = binding.etCardNumber.text.toString().replace(" ", "")
        val expiry = binding.etExpiry.text.toString()
        val cvv = binding.etCvv.text.toString()
        
        // Show confirmation dialog for large amounts
        if (currentAmount >= 1000) {
            AlertDialog.Builder(this)
                .setTitle("Confirm Large Transaction")
                .setMessage("Process ${currencyFormatter.format(currentAmount)}?")
                .setPositiveButton("Confirm") { _, _ ->
                    executePayment(cardNumber, expiry, cvv)
                }
                .setNegativeButton("Cancel", null)
                .show()
        } else {
            executePayment(cardNumber, expiry, cvv)
        }
    }
    
    private fun executePayment(cardNumber: String, expiry: String, cvv: String) {
        binding.progressBar.visibility = View.VISIBLE
        binding.btnProcess.isEnabled = false
        
        lifecycleScope.launch {
            val repository = PaymentRepository(this@PaymentEntryActivity)
            
            val result = repository.processPayment(
                cardNumber = cardNumber,
                cardExpiry = expiry,
                cardCvv = cvv,
                amount = currentAmount
            )
            
            binding.progressBar.visibility = View.GONE
            binding.btnProcess.isEnabled = true
            
            when (result) {
                is PaymentResult.Success -> {
                    navigateToReceipt(result.localTxnId, result.stan, true)
                }
                is PaymentResult.Pending -> {
                    navigateToReceipt(result.localTxnId, result.stan, false)
                }
                is PaymentResult.Error -> {
                    Toast.makeText(
                        this@PaymentEntryActivity,
                        "Payment failed: ${result.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }
    
    private fun navigateToReceipt(txnId: String, stan: String, isOnline: Boolean) {
        val intent = Intent(this, ReceiptActivity::class.java).apply {
            putExtra(ReceiptActivity.EXTRA_LOCAL_TXN_ID, txnId)
            putExtra(ReceiptActivity.EXTRA_AMOUNT, currentAmount)
            putExtra(ReceiptActivity.EXTRA_STAN, stan)
            putExtra(ReceiptActivity.EXTRA_IS_OFFLINE, !isOnline)
        }
        startActivity(intent)
        finish()
    }
    
    private fun clearForm() {
        currentAmount = 0.0
        binding.etAmount.setText("")
        binding.etCardNumber.setText("")
        binding.etExpiry.setText("")
        binding.etCvv.setText("")
        binding.ivCardType.visibility = View.GONE
        binding.chipSale.isChecked = true
        transactionType = TransactionType.SALE
        validateForm()
        binding.etAmount.requestFocus()
    }
    
    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
