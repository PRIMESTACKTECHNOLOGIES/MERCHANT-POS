package com.pos2013.offline.data

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.pos2013.offline.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Manages offline orders - creates them when offline, processes when online
 * 
 * WORKFLOW:
 * 1. Customer buys something (offline)
 * 2. Save order with customer phone number
 * 3. When internet returns, auto-generate MyFatoorah link
 * 4. Send link to customer via WhatsApp/SMS
 * 5. Poll for payment status
 */
class OfflineOrderManager(private val context: Context) {
    
    private val TAG = "OfflineOrderManager"
    private val prefs = context.getSharedPreferences("offline_orders", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val myfatoorahRepo = MyFatoorahRepository(context)
    
    companion object {
        private const val KEY_ORDERS = "pending_orders"
    }
    
    /**
     * Create a new offline order (NO card data stored!)
     */
    suspend fun createOfflineOrder(
        amount: Double,
        customerName: String,
        customerPhone: String,
        description: String = "Purchase"
    ): OfflineOrder = withContext(Dispatchers.IO) {
        val order = OfflineOrder(
            orderId = generateOrderId(),
            amount = amount,
            customerName = customerName,
            customerPhone = customerPhone,
            description = description,
            status = "PENDING"
        )
        
        saveOrder(order)
        Log.d(TAG, "Created offline order: ${order.orderId}")
        order
    }
    
    /**
     * Process all pending orders when internet is available
     * Call this when device comes online
     */
    suspend fun processPendingOrders(): List<OfflineOrder> = withContext(Dispatchers.IO) {
        val pendingOrders = getPendingOrders()
        val processedOrders = mutableListOf<OfflineOrder>()
        
        for (order in pendingOrders) {
            if (order.status == "PENDING") {
                val result = processOrder(order)
                if (result) {
                    processedOrders.add(order)
                }
            }
        }
        
        processedOrders
    }
    
    /**
     * Process single order - create MyFatoorah link and send
     */
    private suspend fun processOrder(order: OfflineOrder): Boolean {
        return try {
            Log.d(TAG, "Processing order: ${order.orderId}")
            
            // Create MyFatoorah payment link
            val result = myfatoorahRepo.createPaymentLink(
                amount = order.amount,
                customerName = order.customerName,
                customerMobile = order.customerPhone,
                reference = order.orderId,
                items = listOf(
                    InvoiceItem(
                        itemName = order.description,
                        quantity = 1,
                        unitPrice = order.amount
                    )
                )
            )
            
            when (result) {
                is MyFatoorahResult.Success -> {
                    // Update order with payment details
                    order.status = "LINK_SENT"
                    order.myfatoorahInvoiceId = result.invoiceId
                    order.paymentUrl = result.paymentUrl
                    updateOrder(order)
                    
                    // Send to customer
                    myfatoorahRepo.sharePaymentLink(result.paymentUrl, order.customerPhone)
                    
                    Log.d(TAG, "Payment link sent for order: ${order.orderId}")
                    true
                }
                is MyFatoorahResult.Error -> {
                    Log.e(TAG, "Failed to create link: ${result.message}")
                    false
                }
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Error processing order", e)
            false
        }
    }
    
    /**
     * Check payment status for all LINK_SENT orders
     */
    suspend fun checkPendingPayments(): List<OfflineOrder> = withContext(Dispatchers.IO) {
        val linkSentOrders = getAllOrders().filter { it.status == "LINK_SENT" }
        val paidOrders = mutableListOf<OfflineOrder>()
        
        for (order in linkSentOrders) {
            order.myfatoorahInvoiceId?.let { invoiceId ->
                val status = myfatoorahRepo.checkPaymentStatus(invoiceId.toString())
                
                if (status.isPaid) {
                    order.status = "PAID"
                    order.paidAt = System.currentTimeMillis()
                    updateOrder(order)
                    paidOrders.add(order)
                    Log.d(TAG, "Order ${order.orderId} is now PAID")
                }
            }
        }
        
        paidOrders
    }
    
    /**
     * Get all orders with PENDING status
     */
    fun getPendingOrders(): List<OfflineOrder> {
        return getAllOrders().filter { it.status == "PENDING" }
    }
    
    /**
     * Get all orders waiting for payment
     */
    fun getLinkSentOrders(): List<OfflineOrder> {
        return getAllOrders().filter { it.status == "LINK_SENT" }
    }
    
    /**
     * Get all orders
     */
    fun getAllOrders(): List<OfflineOrder> {
        val json = prefs.getString(KEY_ORDERS, null) ?: return emptyList()
        val type = object : TypeToken<List<OfflineOrder>>() {}.type
        return gson.fromJson(json, type) ?: emptyList()
    }
    
    /**
     * Save/update order
     */
    private fun saveOrder(order: OfflineOrder) {
        val orders = getAllOrders().toMutableList()
        orders.removeAll { it.orderId == order.orderId }
        orders.add(order)
        saveAllOrders(orders)
    }
    
    private fun updateOrder(order: OfflineOrder) {
        saveOrder(order)
    }
    
    private fun saveAllOrders(orders: List<OfflineOrder>) {
        val json = gson.toJson(orders)
        prefs.edit().putString(KEY_ORDERS, json).apply()
    }
    
    /**
     * Delete old orders (older than specified days)
     */
    fun clearOldOrders(days: Int) {
        val cutoff = System.currentTimeMillis() - (days * 24 * 60 * 60 * 1000)
        val orders = getAllOrders().filter { 
            it.createdAt > cutoff || it.status == "LINK_SENT" 
        }
        saveAllOrders(orders)
    }
    
    /**
     * Cancel an order
     */
    fun cancelOrder(orderId: String) {
        val order = getAllOrders().find { it.orderId == orderId }
        order?.let {
            it.status = "CANCELLED"
            updateOrder(it)
        }
    }
    
    private fun generateOrderId(): String {
        return "ORD-${System.currentTimeMillis()}"
    }
    
    fun getPendingCount(): Int = getPendingOrders().size
    
    fun getLinkSentCount(): Int = getLinkSentOrders().size
}
