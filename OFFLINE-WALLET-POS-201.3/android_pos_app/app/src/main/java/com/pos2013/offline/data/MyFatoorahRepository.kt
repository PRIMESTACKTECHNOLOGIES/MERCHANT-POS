package com.pos2013.offline.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.pos2013.offline.config.GatewayConfig
import com.pos2013.offline.data.api.MyFatoorahClient
import com.pos2013.offline.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class MyFatoorahRepository(private val context: Context) {
    
    private val TAG = "MyFatoorahRepository"
    private val api = MyFatoorahClient.create(GatewayConfig.MYFATOORAH_TEST_MODE)
    
    /**
     * Create a payment link for customer
     * Returns a URL that customer can open to pay
     */
    suspend fun createPaymentLink(
        amount: Double,
        customerName: String = "Customer",
        customerMobile: String? = null,
        customerEmail: String? = null,
        reference: String? = null,
        items: List<InvoiceItem>? = null
    ): MyFatoorahResult = withContext(Dispatchers.IO) {
        try {
            if (!GatewayConfig.isMyFatoorahConfigured()) {
                return@withContext MyFatoorahResult.Error("MyFatoorah not configured. Please set API token in Settings.")
            }
            
            val request = MyFatoorahInvoiceRequest(
                invoiceValue = amount,
                customerName = customerName,
                customerMobile = customerMobile,
                customerEmail = customerEmail,
                customerReference = reference,
                invoiceItems = items,
                displayCurrencyIso = "AED", // UAE Dirham
                language = "EN",
                callBackUrl = "https://myfatoorah.com/success",
                errorUrl = "https://myfatoorah.com/error"
            )
            
            Log.d(TAG, "Creating payment link for amount: $amount AED")
            
            val response = api.createPayment(
                authorization = GatewayConfig.getMyFatoorahAuth(),
                request = request
            )
            
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.isSuccess == true && body.data != null) {
                    Log.d(TAG, "Payment link created: ${body.data.invoiceUrl}")
                    MyFatoorahResult.Success(
                        invoiceId = body.data.invoiceId,
                        paymentUrl = body.data.invoiceUrl,
                        reference = body.data.customerReference
                    )
                } else {
                    val errorMsg = body?.validationErrors?.firstOrNull()?.error 
                        ?: body?.message 
                        ?: "Unknown error"
                    Log.e(TAG, "Failed to create payment: $errorMsg")
                    MyFatoorahResult.Error(errorMsg)
                }
            } else {
                val error = "Server error: ${response.code()}"
                Log.e(TAG, error)
                MyFatoorahResult.Error(error)
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Exception creating payment link", e)
            MyFatoorahResult.Error("Error: ${e.message}")
        }
    }
    
    /**
     * Create direct payment (embedded form)
     * Use this when customer is paying on your device
     */
    suspend fun createDirectPayment(
        amount: Double,
        customerName: String = "Customer",
        customerMobile: String? = null,
        items: List<InvoiceItem>? = null
    ): MyFatoorahResult = withContext(Dispatchers.IO) {
        try {
            if (!GatewayConfig.isMyFatoorahConfigured()) {
                return@withContext MyFatoorahResult.Error("MyFatoorah not configured")
            }
            
            val request = MyFatoorahInvoiceRequest(
                invoiceValue = amount,
                customerName = customerName,
                customerMobile = customerMobile,
                invoiceItems = items,
                displayCurrencyIso = "AED",
                language = "EN"
            )
            
            val response = api.executePayment(
                authorization = GatewayConfig.getMyFatoorahAuth(),
                request = request
            )
            
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.isSuccess == true && body.data != null) {
                    MyFatoorahResult.Success(
                        invoiceId = body.data.invoiceId,
                        paymentUrl = body.data.invoiceUrl,
                        reference = body.data.customerReference
                    )
                } else {
                    MyFatoorahResult.Error(body?.message ?: "Failed to create payment")
                }
            } else {
                MyFatoorahResult.Error("Server error: ${response.code()}")
            }
            
        } catch (e: Exception) {
            MyFatoorahResult.Error("Error: ${e.message}")
        }
    }
    
    /**
     * Check if payment is completed
     * Call this periodically after creating payment link
     */
    suspend fun checkPaymentStatus(
        paymentId: String
    ): PaymentStatusData = withContext(Dispatchers.IO) {
        try {
            val response = api.getPaymentStatus(
                authorization = GatewayConfig.getMyFatoorahAuth(),
                key = paymentId
            )
            
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.isSuccess == true && body.data != null) {
                    PaymentStatusData(
                        isPaid = body.data.invoiceStatus == "Paid",
                        status = body.data.invoiceStatus,
                        amount = body.data.invoiceValue,
                        reference = body.data.invoiceReference,
                        transactionId = body.data.transactionId,
                        paymentGateway = body.data.paymentGateway,
                        errorMessage = null
                    )
                } else {
                    PaymentStatusData(
                        isPaid = false,
                        status = "Error",
                        errorMessage = "Failed to get status"
                    )
                }
            } else {
                PaymentStatusData(
                    isPaid = false,
                    status = "Error",
                    errorMessage = "Server error: ${response.code()}"
                )
            }
            
        } catch (e: Exception) {
            PaymentStatusData(
                isPaid = false,
                status = "Error",
                errorMessage = e.message
            )
        }
    }
    
    /**
     * Open payment link in browser or share it
     */
    fun sharePaymentLink(paymentUrl: String, customerPhone: String?) {
        if (customerPhone != null) {
            // Send via WhatsApp/SMS
            val message = "Please complete your payment: $paymentUrl"
            
            // Try WhatsApp first
            val whatsappIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("https://wa.me/$customerPhone?text=${Uri.encode(message)}")
                `package` = "com.whatsapp"
            }
            
            try {
                context.startActivity(whatsappIntent)
            } catch (e: Exception) {
                // Fallback to SMS
                val smsIntent = Intent(Intent.ACTION_SENDTO).apply {
                    data = Uri.parse("smsto:$customerPhone")
                    putExtra("sms_body", message)
                }
                context.startActivity(smsIntent)
            }
        } else {
            // Share via any app
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, "Your payment link: $paymentUrl")
            }
            context.startActivity(Intent.createChooser(shareIntent, "Send Payment Link"))
        }
    }
    
    /**
     * Open payment link in browser (for on-device payment)
     */
    fun openPaymentInBrowser(paymentUrl: String) {
        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(paymentUrl))
        context.startActivity(browserIntent)
    }
    
    /**
     * Poll for payment status with timeout
     */
    suspend fun waitForPayment(
        paymentId: String,
        timeoutSeconds: Int = 300, // 5 minutes
        pollIntervalSeconds: Int = 5
    ): PaymentStatusData {
        val startTime = System.currentTimeMillis()
        val timeoutMillis = timeoutSeconds * 1000
        
        while (System.currentTimeMillis() - startTime < timeoutMillis) {
            val status = checkPaymentStatus(paymentId)
            
            if (status.isPaid || status.status == "Error") {
                return status
            }
            
            delay(pollIntervalSeconds * 1000L)
        }
        
        return PaymentStatusData(
            isPaid = false,
            status = "Timeout",
            errorMessage = "Payment timed out"
        )
    }
    
    companion object {
        /**
         * Extract payment ID from MyFatoorah URL
         * URL format: https://ae.myfatoorah.com/ARE/ie/0508365324858506168-c9a59800
         */
        fun extractPaymentId(url: String): String? {
            return url.substringAfterLast("/", "")
                .takeIf { it.isNotBlank() && it.length > 10 }
        }
    }
}

data class PaymentStatusData(
    val isPaid: Boolean,
    val status: String,
    val amount: Double? = null,
    val reference: String? = null,
    val transactionId: String? = null,
    val paymentGateway: String? = null,
    val errorMessage: String? = null
)
