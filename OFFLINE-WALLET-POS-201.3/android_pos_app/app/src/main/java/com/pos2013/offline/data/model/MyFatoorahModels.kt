package com.pos2013.offline.data.model

import com.google.gson.annotations.SerializedName

// Request Models
data class MyFatoorahInvoiceRequest(
    @SerializedName("InvoiceValue") val invoiceValue: Double,
    @SerializedName("CustomerName") val customerName: String = "Customer",
    @SerializedName("CustomerMobile") val customerMobile: String? = null,
    @SerializedName("CustomerEmail") val customerEmail: String? = null,
    @SerializedName("CallBackUrl") val callBackUrl: String = "https://yourdomain.com/success",
    @SerializedName("ErrorUrl") val errorUrl: String = "https://yourdomain.com/error",
    @SerializedName("Language") val language: String = "EN",
    @SerializedName("DisplayCurrencyIso") val displayCurrencyIso: String = "AED",
    @SerializedName("MobileCountryCode") val mobileCountryCode: String = "+971",
    @SerializedName("CustomerReference") val customerReference: String? = null,
    @SerializedName("InvoiceItems") val invoiceItems: List<InvoiceItem>? = null
)

data class InvoiceItem(
    @SerializedName("ItemName") val itemName: String,
    @SerializedName("Quantity") val quantity: Int,
    @SerializedName("UnitPrice") val unitPrice: Double
)

// Response Models
data class MyFatoorahInvoiceResponse(
    @SerializedName("IsSuccess") val isSuccess: Boolean,
    @SerializedName("Message") val message: String? = null,
    @SerializedName("ValidationErrors") val validationErrors: List<ValidationError>? = null,
    @SerializedName("Data") val data: InvoiceData? = null
)

data class InvoiceData(
    @SerializedName("InvoiceId") val invoiceId: Long,
    @SerializedName("InvoiceURL") val invoiceUrl: String,
    @SerializedName("CustomerReference") val customerReference: String? = null,
    @SerializedName("UserDefinedField") val userDefinedField: String? = null
)

data class ValidationError(
    @SerializedName("Name") val name: String,
    @SerializedName("Error") val error: String
)

// Payment Status Response
data class PaymentStatusResponse(
    @SerializedName("IsSuccess") val isSuccess: Boolean,
    @SerializedName("Data") val data: PaymentData? = null
)

data class PaymentData(
    @SerializedName("InvoiceId") val invoiceId: Long,
    @SerializedName("InvoiceStatus") val invoiceStatus: String,
    @SerializedName("InvoiceReference") val invoiceReference: String? = null,
    @SerializedName("InvoiceDisplayValue") val invoiceDisplayValue: String? = null,
    @SerializedName("CustomerName") val customerName: String? = null,
    @SerializedName("CustomerMobile") val customerMobile: String? = null,
    @SerializedName("CustomerEmail") val customerEmail: String? = null,
    @SerializedName("TransactionDate") val transactionDate: String? = null,
    @SerializedName("PaymentGateway") val paymentGateway: String? = null,
    @SerializedName("ReferenceId") val referenceId: String? = null,
    @SerializedName("TrackId") val trackId: String? = null,
    @SerializedName("TransactionId") val transactionId: String? = null,
    @SerializedName("PaymentId") val paymentId: String? = null,
    @SerializedName("AuthorizationId") val authorizationId: String? = null,
    @SerializedName("InvoiceValue") val invoiceValue: Double? = null
)

// Result Sealed Class
sealed class MyFatoorahResult {
    data class Success(
        val invoiceId: Long,
        val paymentUrl: String,
        val reference: String?
    ) : MyFatoorahResult()
    
    data class Error(val message: String) : MyFatoorahResult()
}
