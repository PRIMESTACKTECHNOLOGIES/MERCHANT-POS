import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

export type FinancialDocumentType = 'POS_INVOICE' | 'WALLET_TRANSFER_RECEIPT' | 'CRYPTO_PURCHASE_RECEIPT' | 'BANK_PAYOUT_RECEIPT';

export interface CreateFinancialDocumentInput {
  type: FinancialDocumentType;
  sourceTable: string;
  sourceId: string;
  merchantId?: string | null;
  customerId?: string | null;
  amount: number;
  currency: string;
  status: string;
  reference?: string | null;
  description?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Durable financial document writer. Documents are append-only and idempotent:
 * the same source transaction can never create two invoices/receipts.
 */
export class InvoiceReceiptService {
  async ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS financial_documents (
        id TEXT PRIMARY KEY,
        document_number TEXT UNIQUE NOT NULL,
        document_type TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id TEXT NOT NULL,
        merchant_id TEXT,
        customer_id TEXT,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        reference TEXT,
        description TEXT,
        document_data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_table, source_id)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_financial_documents_merchant ON financial_documents(merchant_id, created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_financial_documents_customer ON financial_documents(customer_id, created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_financial_documents_type ON financial_documents(document_type, created_at DESC)');
    // Database-level protection: no application or SQL path may alter/delete issued documents.
    await db.query(`
      CREATE TRIGGER IF NOT EXISTS financial_documents_no_update
      BEFORE UPDATE ON financial_documents
      BEGIN SELECT RAISE(ABORT, 'financial documents are immutable'); END
    `);
    await db.query(`
      CREATE TRIGGER IF NOT EXISTS financial_documents_no_delete
      BEFORE DELETE ON financial_documents
      BEGIN SELECT RAISE(ABORT, 'financial documents cannot be deleted'); END
    `);
  }

  async create(input: CreateFinancialDocumentInput): Promise<{ documentNumber: string; created: boolean }> {
    await this.ensureSchema();
    if (!input.sourceId) throw new Error('Financial document sourceId is required');
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error('Financial document amount is invalid');

    const documentNumber = `INV-${input.type}-${input.sourceId}`;
    const documentData = JSON.stringify({
      documentNumber,
      documentType: input.type,
      sourceTable: input.sourceTable,
      sourceId: input.sourceId,
      merchantId: input.merchantId ?? null,
      customerId: input.customerId ?? null,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      reference: input.reference ?? null,
      description: input.description ?? null,
      details: input.details ?? {},
      issuedAt: new Date().toISOString(),
    });

    const result = await db.query(
      `INSERT OR IGNORE INTO financial_documents
       (id, document_number, document_type, source_table, source_id, merchant_id, customer_id,
        amount, currency, status, reference, description, document_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), documentNumber, input.type, input.sourceTable, input.sourceId,
       input.merchantId ?? null, input.customerId ?? null, input.amount, input.currency,
       input.status, input.reference ?? null, input.description ?? null, documentData]
    );

    return { documentNumber, created: result.rowCount > 0 };
  }

  async backfillExisting(): Promise<{ created: number; existing: number }> {
    await this.ensureSchema();
    let created = 0;
    let existing = 0;
    const create = async (input: CreateFinancialDocumentInput) => {
      const result = await this.create(input);
      result.created ? created++ : existing++;
    };

    const pos = await db.query(`SELECT * FROM pos2013_transactions`);
    for (const row of pos.rows) {
      await create({
        type: 'POS_INVOICE', sourceTable: 'pos2013_transactions', sourceId: String(row.id),
        merchantId: row.merchant_id, amount: Number(row.amount_minor || 0) / 100,
        currency: row.currency || 'USD', status: row.status || 'UNKNOWN',
        reference: row.rrn || row.stan, description: 'POS transaction invoice', details: row,
      });
    }

    const transfers = await db.query(`SELECT * FROM wallet_transfers`);
    for (const row of transfers.rows) {
      await create({
        type: 'WALLET_TRANSFER_RECEIPT', sourceTable: 'wallet_transfers', sourceId: String(row.id),
        customerId: row.receiver_customer_id, amount: Number(row.amount || 0), currency: row.currency || 'USD',
        status: row.status || 'UNKNOWN', reference: `TRF-${String(row.id).slice(0, 8).toUpperCase()}`,
        description: row.note || 'Wallet-to-wallet transfer receipt', details: row,
      });
    }

    const crypto = await db.query(`SELECT * FROM crypto_transactions_log_v2`);
    for (const row of crypto.rows) {
      await create({
        type: 'CRYPTO_PURCHASE_RECEIPT', sourceTable: 'crypto_transactions_log_v2', sourceId: String(row.id),
        customerId: row.customer_id, amount: Number(row.from_amount || 0), currency: row.from_currency || 'USD',
        status: row.status || 'UNKNOWN', reference: row.reference, description: 'Crypto purchase receipt', details: row,
      });
    }

    const payouts = await db.query(`SELECT * FROM bank_payouts`);
    for (const row of payouts.rows) {
      await create({
        type: 'BANK_PAYOUT_RECEIPT', sourceTable: 'bank_payouts', sourceId: String(row.id),
        customerId: row.customer_id, amount: Number(row.amount || 0), currency: row.currency || 'USD',
        status: row.status || 'UNKNOWN', reference: row.reference, description: 'Bank payout receipt', details: row,
      });
    }

    // Repair the legacy POS receipt index as well. This keeps older receipt
    // screens populated while financial_documents remains the source of truth.
    const posDocuments = await db.query(`
      SELECT document_number, source_id, merchant_id, document_data, created_at
      FROM financial_documents
      WHERE source_table = 'pos2013_transactions'`);
    for (const row of posDocuments.rows) {
      await db.query(
        `INSERT OR IGNORE INTO receipts (id, receipt_id, transaction_id, merchant_id, receipt_data, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`LEGACY-${row.source_id}`, `RCP-${row.source_id}`, row.source_id, row.merchant_id,
          row.document_data, row.created_at]
      );
    }
    return { created, existing };
  }

  async list(filters: { merchantId?: string; customerId?: string; type?: string; limit?: number } = {}) {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.merchantId) { where.push('merchant_id = ?'); params.push(filters.merchantId); }
    if (filters.customerId) { where.push('customer_id = ?'); params.push(filters.customerId); }
    if (filters.type) { where.push('document_type = ?'); params.push(filters.type); }
    params.push(Math.min(Math.max(filters.limit || 100, 1), 500));
    const result = await db.query(`SELECT * FROM financial_documents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, params);
    return result.rows.map(row => ({ ...row, documentData: JSON.parse(row.document_data) }));
  }

  async get(documentNumber: string) {
    const result = await db.query('SELECT * FROM financial_documents WHERE document_number = ? LIMIT 1', [documentNumber]);
    if (!result.rows.length) return null;
    return { ...result.rows[0], documentData: JSON.parse(result.rows[0].document_data) };
  }
}

export const invoiceReceiptService = new InvoiceReceiptService();
