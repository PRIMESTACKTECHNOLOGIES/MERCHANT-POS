import { db } from "../../config/db";

export class TransactionsService {
  async getTransactions() {
    try {
      const res = await db.query(`
        SELECT 
          id, merchant_id, terminal_id, batch_id, local_txn_id, stan,
          amount_minor, currency, pan_masked, txn_type, auth_mode,
          entry_mode, rrn, auth_code, status, emv_data, txn_timestamp, created_at,
          card_brand, reader_source, cvm_result, pin_verified,
          fd.document_number AS invoice_id, fd.document_type AS document_type
        FROM pos2013_transactions t
        LEFT JOIN financial_documents fd
          ON fd.source_table = 'pos2013_transactions' AND fd.source_id = t.id
        ORDER BY txn_timestamp DESC
        LIMIT 200
      `);
      
      return res.rows.map((row: any) => ({
        id: row.id,
        merchantId: row.merchant_id,
        terminalId: row.terminal_id,
        batchId: row.batch_id,
        localTxnId: row.local_txn_id,
        stan: row.stan,
        amountMinor: row.amount_minor,
        currency: row.currency,
        panMasked: row.pan_masked,
        txnType: row.txn_type,
        authMode: row.auth_mode,
        entryMode: row.entry_mode,
        rrn: row.rrn,
        authCode: row.auth_code,
        status: row.status,
        emvData: row.emv_data ? (() => {
          try { return JSON.parse(row.emv_data); } catch { return row.emv_data; }
        })() : null,
        txnTimestamp: row.txn_timestamp,
        cardBrand: row.card_brand || null,
        readerSource: row.reader_source || null,
        cvmResult: row.cvm_result || null,
          pinVerified: row.pin_verified === 1 || row.pin_verified === true || row.pin_verified === '1',
        invoiceId: row.invoice_id || `INV-POS_INVOICE-${row.id}`,
        receiptId: row.invoice_id || `INV-POS_INVOICE-${row.id}`,
        documentType: row.document_type || 'POS_INVOICE'
      }));
    } catch (error) {
      console.error("DB Error in getTransactions:", error);
      return [];
    }
  }

  async getTransactionById(id: string) {
    try {
      const res = await db.query(
        `SELECT t.*, fd.document_number AS invoice_id, fd.document_type AS document_type
         FROM pos2013_transactions t
         LEFT JOIN financial_documents fd
           ON fd.source_table = 'pos2013_transactions' AND fd.source_id = t.id
         WHERE t.id = ? LIMIT 1`,
        [id]
      );
      
      if (res.rows.length === 0) {
        return null;
      }

      return this.mapRowToTransaction(res.rows[0]);
    } catch (error) {
      console.error("Error fetching transaction:", error);
      return null;
    }
  }

  async getTransactionByLocalTxnId(localTxnId: string) {
    try {
      const res = await db.query(
        `SELECT t.*, fd.document_number AS invoice_id, fd.document_type AS document_type
         FROM pos2013_transactions t
         LEFT JOIN financial_documents fd
           ON fd.source_table = 'pos2013_transactions' AND fd.source_id = t.id
         WHERE t.local_txn_id = ? LIMIT 1`,
        [localTxnId]
      );
      if (res.rows.length === 0) {
        return null;
      }

      return this.mapRowToTransaction(res.rows[0]);
    } catch (error) {
      console.error("Error fetching transaction by localTxnId:", error);
      return null;
    }
  }

  async getTransactionByIdOrLocalId(idOrLocalTxnId: string) {
    const byId = await this.getTransactionById(idOrLocalTxnId);
    if (byId) return byId;
    return this.getTransactionByLocalTxnId(idOrLocalTxnId);
  }

  private mapRowToTransaction(row: any) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      terminalId: row.terminal_id,
      batchId: row.batch_id,
      localTxnId: row.local_txn_id,
      stan: row.stan,
      amountMinor: row.amount_minor,
      currency: row.currency,
      panMasked: row.pan_masked,
      txnType: row.txn_type,
      authMode: row.auth_mode,
      entryMode: row.entry_mode,
      rrn: row.rrn,
      authCode: row.auth_code,
      status: row.status,
      emvData: row.emv_data ? (() => {
        try { return JSON.parse(row.emv_data); } catch { return row.emv_data; }
      })() : null,
      txnTimestamp: row.txn_timestamp,
      cardBrand: row.card_brand || null,
      readerSource: row.reader_source || null,
      cvmResult: row.cvm_result || null,
      pinVerified: row.pin_verified === 1 || row.pin_verified === true || row.pin_verified === '1',
      invoiceId: row.invoice_id || `INV-POS_INVOICE-${row.id}`,
      receiptId: row.invoice_id || `INV-POS_INVOICE-${row.id}`,
      documentType: row.document_type || 'POS_INVOICE'
    };
  }
}

export const transactionsService = new TransactionsService();
