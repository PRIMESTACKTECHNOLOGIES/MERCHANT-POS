// src/domain/myfatoorah/myfatoorah.service.ts
import { db } from "../../config/db";

// MyFatoorah API configuration
const MYFATOORAH_BASE_URL = process.env.MYFATOORAH_TEST_MODE === "true" 
  ? "https://apitest.myfatoorah.com/" 
  : "https://api.myfatoorah.com/";

const MYFATOORAH_API_KEY = process.env.MYFATOORAH_API_KEY || "SK_ARE_GHXzJs81newi8L06b8dDE8qZhaidkdcjuf2seTAgnZjVrzjzTwSh6ACeRYsfJ0w0";

export interface MyFatoorahPaymentData {
  invoiceId: number;
  invoiceReference: string;
  customerName: string;
  customerMobile: string;
  transactionDate: string;
  paymentGateway: string;
  referenceId: string;
  trackId: string;
  transactionId: string;
  paymentId: string;
  authorizationId: string;
  amount: number;
  rawData: any;
}

export interface CreatePaymentData {
  amount: number;
  customerName?: string;
  customerMobile?: string;
  description?: string;
  reference?: string;
}

export class MyFatoorahService {
  
  /**
   * Process payment webhook and save to YOUR SQL database
   */
  async processPayment(data: MyFatoorahPaymentData): Promise<void> {
    console.log("[MyFatoorahService] Processing payment:", data.invoiceId);
    
    // Save to your PostgreSQL database
    await db.query(
      `INSERT INTO myfatoorah_payments (
        invoice_id, 
        invoice_reference, 
        customer_name, 
        customer_mobile,
        transaction_date,
        payment_gateway,
        reference_id,
        track_id,
        transaction_id,
        payment_id,
        authorization_id,
        amount,
        status,
        raw_webhook_data,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (invoice_id) DO UPDATE SET
        status = $13,
        updated_at = NOW()`,
      [
        data.invoiceId,
        data.invoiceReference,
        data.customerName,
        data.customerMobile,
        data.transactionDate,
        data.paymentGateway,
        data.referenceId,
        data.trackId,
        data.transactionId,
        data.paymentId,
        data.authorizationId,
        data.amount,
        "PAID",
        JSON.stringify(data.rawData)
      ]
    );

    // Also update related order if exists
    if (data.invoiceReference) {
      await db.query(
        `UPDATE offline_orders 
         SET status = 'PAID', 
             paid_at = NOW(),
             myfatoorah_invoice_id = $1
         WHERE order_id = $2`,
        [data.invoiceId, data.invoiceReference]
      );
    }

    console.log("[MyFatoorahService] Payment saved to database");
  }

  /**
   * Create new payment via MyFatoorah API
   */
  async createPayment(data: CreatePaymentData): Promise<any> {
    if (!MYFATOORAH_API_KEY) {
      throw new Error("MyFatoorah API key not configured");
    }

    const requestBody = {
      InvoiceValue: data.amount,
      CustomerName: data.customerName || "Customer",
      CustomerMobile: data.customerMobile || "",
      CustomerReference: data.reference || `ORD-${Date.now()}`,
      DisplayCurrencyIso: "AED",
      Language: "EN",
      CallBackUrl: `${process.env.BACKEND_URL}/api/myfatoorah/callback`,
      ErrorUrl: `${process.env.BACKEND_URL}/api/myfatoorah/error`
    };

    const response = await fetch(`${MYFATOORAH_BASE_URL}v2/SendPayment`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MYFATOORAH_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    
    if (!result.IsSuccess) {
      throw new Error(result.Message || "Failed to create payment");
    }

    // Save pending payment to database
    await db.query(
      `INSERT INTO myfatoorah_payments (
        invoice_id,
        invoice_reference,
        customer_name,
        customer_mobile,
        amount,
        status,
        payment_url,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        result.Data.InvoiceId,
        data.reference,
        data.customerName,
        data.customerMobile,
        data.amount,
        "PENDING",
        result.Data.InvoiceURL
      ]
    );

    return {
      invoiceId: result.Data.InvoiceId,
      paymentUrl: result.Data.InvoiceURL,
      reference: data.reference
    };
  }

  /**
   * Check payment status from MyFatoorah API
   */
  async checkPaymentStatus(invoiceId: string): Promise<any> {
    if (!MYFATOORAH_API_KEY) {
      throw new Error("MyFatoorah API key not configured");
    }

    const response = await fetch(
      `${MYFATOORAH_BASE_URL}v2/GetPaymentStatus?Key=${invoiceId}&KeyType=InvoiceId`,
      {
        headers: {
          "Authorization": `Bearer ${MYFATOORAH_API_KEY}`
        }
      }
    );

    const result = await response.json();
    return result;
  }

  /**
   * Execute direct card payment (for offline synced transactions)
   */
  async executeDirectPayment(data: {
    localTxnId: string;
    amount: number;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
    customerName?: string;
    paymentMethodId?: number;
  }): Promise<any> {
    if (!MYFATOORAH_API_KEY) {
      throw new Error("MyFatoorah API key not configured");
    }

    // 1. Idempotency Check: Check if this localTxnId already exists in DB
    const existing = await db.query(
      "SELECT * FROM myfatoorah_direct_settlements WHERE local_txn_id = $1",
      [data.localTxnId]
    );

    if (existing.rows.length > 0) {
      console.log(`Duplicate sync detected for localTxnId: ${data.localTxnId}. Returning existing record.`);
      const record = existing.rows[0];
      return { 
        success: record.status === 'Paid', 
        data: { 
          Data: { 
            InvoiceId: record.invoice_id, 
            PaymentId: record.payment_id, 
            InvoiceStatus: record.status,
            AuthorizationCode: record.auth_code,
            CardInfo: record.card_brand
          } 
        } 
      };
    }

    // 2. Create Invoice first (Required for ExecutePayment)
    const initiateResponse = await fetch(`${MYFATOORAH_BASE_URL}v2/SendPayment`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MYFATOORAH_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        InvoiceValue: data.amount,
        CustomerName: data.customerName || "Offline Customer",
        DisplayCurrencyIso: "AED",
        NotificationOption: "LNK"
      })
    });

    const initiateResult = await initiateResponse.json();
    if (!initiateResult.IsSuccess) {
      return { success: false, error: initiateResult.Message };
    }

    // 3. Execute Payment with Card Details
    // PaymentMethodId: 20 for Visa/Mastercard (default)
    const requestBody = {
      PaymentMethodId: data.paymentMethodId || 20, 
      CustomerName: data.customerName || "Offline Customer",
      DisplayCurrencyIso: "AED",
      MobileCountryCode: "971",
      CustomerMobile: "500000000",
      CustomerEmail: "test@example.com",
      InvoiceValue: data.amount,
      Card: {
        Number: data.cardNumber,
        ExpiryMonth: data.expiryMonth,
        ExpiryYear: data.expiryYear,
        SecurityCode: data.cvv
      }
    };

    const response = await fetch(`${MYFATOORAH_BASE_URL}v2/ExecutePayment`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MYFATOORAH_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    
    if (!result.IsSuccess) {
      // Save failed attempt for auditing
      await db.query(
        `INSERT INTO myfatoorah_direct_settlements (
          local_txn_id, amount, status, error_message, created_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [data.localTxnId, data.amount, 'Failed', result.Message]
      );
      return { success: false, error: result.Message };
    }

    // 4. Save successful direct settlement to database
    const mf = result.Data;
    await db.query(
      `INSERT INTO myfatoorah_direct_settlements (
        local_txn_id,
        invoice_id,
        payment_id,
        auth_code,
        customer_name,
        amount,
        status,
        card_brand,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [
        data.localTxnId,
        mf.InvoiceId,
        mf.PaymentId,
        mf.AuthorizationCode,
        data.customerName || "Offline Customer",
        data.amount,
        mf.InvoiceStatus,
        mf.CardInfo
      ]
    );

    return { success: true, data: result };
  }

  /**
   * Get all payments from YOUR database
   */
  async getPayments(): Promise<any[]> {
    const result = await db.query(
      `SELECT * FROM myfatoorah_direct_settlements 
       ORDER BY created_at DESC 
       LIMIT 100`
    );
    return result.rows;
  }
}

export const myfatoorahService = new MyFatoorahService();
