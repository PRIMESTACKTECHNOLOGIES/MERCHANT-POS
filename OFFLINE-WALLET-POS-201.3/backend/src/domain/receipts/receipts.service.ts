import { db } from "../../config/db";

export class ReceiptsService {
  /**
   * Generate a receipt for a transaction
   */
  async generateReceipt(transactionId: string, merchantId: string) {
    try {
      // Get transaction details
      const txnResult = await db.query(`
        SELECT 
          t.id,
          t.stan,
          t.amount_minor,
          t.currency,
          t.pan_masked,
          t.txn_timestamp,
          t.status,
          t.batch_id,
          b.settlement_code,
          b.upload_timestamp as batch_upload_time,
          b.terminal_id
        FROM pos2013_transactions t
        LEFT JOIN pos2013_batches b ON t.batch_id = b.batch_id
        WHERE t.id = ? AND t.merchant_id = ?
      `, [transactionId, merchantId]);

      if (txnResult.rows.length === 0) {
        throw new Error('Transaction not found');
      }

      const txn = txnResult.rows[0];

      // Get merchant settings
      const settingsResult = await db.query(`
        SELECT business_name, business_address, receipt_footer
        FROM merchant_settings 
        WHERE merchant_id = ?
      `, [merchantId]);

      const merchantSettings = settingsResult.rows[0] || {
        business_name: 'POS 201.3 Merchant',
        business_address: '',
        receipt_footer: 'Thank you for your business!'
      };

      // Build receipt
      const receipt = {
        receiptId: `RCP-${Date.now()}`,
        transactionId: txn.id,
        merchantInfo: {
          name: merchantSettings.business_name,
          address: merchantSettings.business_address,
          id: merchantId
        },
        transaction: {
          stan: txn.stan,
          amount: (txn.amount_minor / 100).toFixed(2),
          currency: txn.currency || 'USD',
          cardMasked: txn.pan_masked,
          date: new Date(txn.txn_timestamp).toLocaleString(),
          status: txn.status,
          batchId: txn.batch_id,
          settlementCode: txn.settlement_code,
          terminalId: txn.terminal_id
        },
        generatedAt: new Date().toISOString(),
        footer: merchantSettings.receipt_footer
      };

      // Save receipt to database
      await db.query(`
        INSERT INTO receipts (
          receipt_id, transaction_id, merchant_id, receipt_data, generated_at
        ) VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(receipt_id) DO UPDATE SET
          receipt_data = excluded.receipt_data,
          generated_at = datetime('now')
      `, [receipt.receiptId, transactionId, merchantId, JSON.stringify(receipt)]);

      return receipt;
    } catch (error: any) {
      console.error('Error generating receipt:', error);
      throw error;
    }
  }

  /**
   * Get all receipts for a merchant
   */
  async getReceipts(merchantId: string, limit: number = 50) {
    try {
      const result = await db.query(`
        SELECT 
          r.receipt_id,
          r.transaction_id,
          r.generated_at,
          t.stan,
          t.amount_minor,
          t.currency,
          t.pan_masked,
          t.status
        FROM receipts r
        JOIN pos2013_transactions t ON r.transaction_id = t.id
        WHERE r.merchant_id = ?
        ORDER BY r.generated_at DESC
        LIMIT ?
      `, [merchantId, limit]);

      return result.rows.map((row: any) => ({
        receiptId: row.receipt_id,
        transactionId: row.transaction_id,
        generatedAt: row.generated_at,
        stan: row.stan,
        amount: (row.amount_minor / 100).toFixed(2),
        currency: row.currency || 'USD',
        cardMasked: row.pan_masked,
        status: row.status
      }));
    } catch (error: any) {
      console.error('Error fetching receipts:', error);
      return [];
    }
  }

  /**
   * Get receipt by ID
   */
  async getReceiptById(receiptId: string, merchantId: string) {
    try {
      const result = await db.query(`
        SELECT receipt_data 
        FROM receipts 
        WHERE receipt_id = ? AND merchant_id = ?
      `, [receiptId, merchantId]);

      if (result.rows.length === 0) {
        return null;
      }

      return JSON.parse(result.rows[0].receipt_data);
    } catch (error: any) {
      console.error('Error fetching receipt:', error);
      return null;
    }
  }

  /**
   * Print receipt (generate printable format)
   */
  async printReceipt(receiptId: string, merchantId: string) {
    const receipt = await this.getReceiptById(receiptId, merchantId);
    
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    // Format for thermal printer (80mm)
    const printable = `
================================
${receipt.merchantInfo.name}
${receipt.merchantInfo.address}
--------------------------------
RECEIPT
Receipt ID: ${receipt.receiptId}
Date: ${new Date(receipt.generatedAt).toLocaleString()}
--------------------------------
TRANSACTION DETAILS
STAN: ${receipt.transaction.stan}
Terminal: ${receipt.transaction.terminalId}
Card: ${receipt.transaction.cardMasked}
Date: ${receipt.transaction.date}
--------------------------------
AMOUNT: $${receipt.transaction.amount} ${receipt.transaction.currency}
Status: ${receipt.transaction.status}
Settlement: ${receipt.transaction.settlementCode || 'PENDING'}
--------------------------------
${receipt.footer}
================================
`;

    return { receipt, printable };
  }
}

export const receiptsService = new ReceiptsService();
