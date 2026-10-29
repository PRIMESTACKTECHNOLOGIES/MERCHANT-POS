import { db } from "../../config/db";

export class TransactionsService {
  async getTransactions() {
    try {
      const res = await db.query(`
        SELECT 
          t.id, t.merchant_id, t.terminal_id, t.batch_id, t.local_txn_id, t.stan,
          t.amount_minor, t.currency, t.pan_masked, t.txn_type, t.auth_mode,
          t.entry_mode, t.rrn, t.auth_code, t.status, t.emv_data, t.txn_timestamp, t.created_at,
          t.card_brand, t.reader_source, t.cvm_result, t.pin_verified,
          fd.document_number AS invoice_id, fd.document_type AS document_type
        FROM pos2013_transactions t
        LEFT JOIN financial_documents fd
          ON fd.source_table = 'pos2013_transactions' AND fd.source_id = t.id
        ORDER BY t.txn_timestamp DESC
        LIMIT 200
      `);
      
      const posTxns = res.rows.map((row: any) => ({
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
        documentType: row.document_type || 'POS_INVOICE',
        source: 'pos'
      }));

      // Wallet-ledger charges (card top-ups, POS card charges, C2M provider pulls)
      // live in the customer wallet ledger, not pos2013_transactions. Surface them
      // here too so the Transactions page shows everything in one place.
      const walletTxns = await this.getWalletLedgerTransactions();

      return [...posTxns, ...walletTxns]
        .sort((a, b) => new Date(b.txnTimestamp || 0).getTime() - new Date(a.txnTimestamp || 0).getTime())
        .slice(0, 200);
    } catch (error) {
      console.error("DB Error in getTransactions:", error);
      return [];
    }
  }

  private async getWalletLedgerTransactions() {
    try {
      const res = await db.query(`
        SELECT wt.id, wt.wallet_id, wt.type, wt.amount, wt.currency, wt.source,
               wt.pan_masked, wt.reference, wt.description, wt.created_at,
               cw.customer_id
          FROM wallet_transactions wt
          LEFT JOIN customer_wallets cw ON cw.id = wt.wallet_id
         ORDER BY wt.created_at DESC
         LIMIT 200
      `);
      return res.rows.map((row: any) => ({
        id: `WLT-${row.id}`,
        merchantId: null,
        terminalId: 'CUSTOMER-WALLET',
        batchId: null,
        localTxnId: row.id,
        stan: null,
        amountMinor: Math.round(Number(row.amount || 0) * 100),
        currency: row.currency || 'USD',
        panMasked: row.pan_masked || null,
        txnType: String(row.type || '').toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        authMode: 'wallet_ledger',
        entryMode: null,
        rrn: null,
        authCode: null,
        status: 'APPROVED',
        emvData: null,
        txnTimestamp: row.created_at,
        cardBrand: null,
        readerSource: row.source || null,
        cvmResult: null,
        pinVerified: false,
        invoiceId: null,
        receiptId: null,
        documentType: 'WALLET_LEDGER_RECEIPT',
        source: 'wallet_ledger',
        customerId: row.customer_id || null,
        description: row.description || row.reference || null
      }));
    } catch (error: any) {
      console.warn('Wallet ledger transactions unavailable:', error?.message);
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
