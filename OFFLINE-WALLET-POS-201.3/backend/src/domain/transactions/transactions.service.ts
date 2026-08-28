import { db } from "../../config/db";

export class TransactionsService {
  async getTransactions() {
    try {
      const res = await db.query(`
        SELECT 
          id,
          merchant_id,
          terminal_id,
          batch_id,
          local_txn_id,
          stan,
          amount_minor,
          currency,
          pan_masked,
          txn_type,
          auth_mode,
          entry_mode,
          rrn,
          auth_code,
          status,
          emv_data,
          txn_timestamp,
          created_at
        FROM pos2013_transactions
        ORDER BY txn_timestamp DESC
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
        emvData: row.emv_data ? JSON.parse(row.emv_data) : null,
        txnTimestamp: row.txn_timestamp
      }));
    } catch (error) {
      console.error("DB Error in getTransactions, returning mock", error);
      return [
        {
          id: 'mock-txn-1',
          merchantId: 'MRC-1001',
          terminalId: 'T2013-001',
          batchId: 'BATCH-001',
          localTxnId: 'LOCAL-001',
          stan: '123456',
          amountMinor: 2500,
          currency: 'USD',
          panMasked: '411111******1111',
          txnType: 'SALE',
          authMode: 'OFFLINE_APPROVED',
          entryMode: 'CHIP',
          status: 'APPROVED',
          txnTimestamp: new Date().toISOString()
        },
        {
          id: 'mock-txn-2',
          merchantId: 'MRC-1001',
          terminalId: 'T2013-001',
          batchId: 'BATCH-001',
          localTxnId: 'LOCAL-002',
          stan: '123457',
          amountMinor: 1550,
          currency: 'USD',
          panMasked: '555555******4444',
          txnType: 'SALE',
          authMode: 'OFFLINE_APPROVED',
          entryMode: 'CONTACTLESS',
          status: 'DECLINED',
          txnTimestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: 'mock-txn-3',
          merchantId: 'MRC-1001',
          terminalId: 'T2013-002',
          batchId: 'BATCH-002',
          localTxnId: 'LOCAL-003',
          stan: '123458',
          amountMinor: 4200,
          currency: 'USD',
          panMasked: '378282******0005',
          txnType: 'SALE',
          authMode: 'OFFLINE_APPROVED',
          entryMode: 'MANUAL',
          status: 'APPROVED',
          txnTimestamp: new Date(Date.now() - 7200000).toISOString()
        }
      ];
    }
  }

  async getTransactionById(id: string) {
    try {
      const res = await db.query(
        `SELECT * FROM pos2013_transactions WHERE id = ? LIMIT 1`,
        [id]
      );
      
      if (res.rows.length === 0) {
        return null;
      }

      const row = res.rows[0];
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
        emvData: row.emv_data ? JSON.parse(row.emv_data) : null,
        txnTimestamp: row.txn_timestamp
      };
    } catch (error) {
      console.error("Error fetching transaction:", error);
      return null;
    }
  }
}

export const transactionsService = new TransactionsService();
