/**
 * SETTLEMENT REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified settlement register across the three settlement sources the system
 * maintains: vault bank settlements, POS sale settlements and card scheme
 * settlements. When PROVIDER_* is configured the report is also pulled from the
 * provider's /reports/settlement endpoint with a real signed call.
 */
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import { providerClient } from './provider.client';
import { toCsv, toPrintableHtml, type ReportColumn } from './reportRenderer';

export interface SettlementReportQuery {
  from?: string;
  to?: string;
  currency?: string;
  merchantId?: string;
  status?: string;
  channel?: 'VAULT' | 'POS' | 'CARD';
  limit?: number;
}

export interface SettlementReportRow {
  channel: 'VAULT' | 'POS' | 'CARD';
  id: string;
  merchantId: string | null;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SettlementReport {
  generatedAt: string;
  source: 'provider' | 'local';
  provider: { configured: boolean; endpoint: string | null; requestId: string | null } | null;
  period: { from: string | null; to: string | null };
  filters: { currency: string | null; merchantId: string | null; status: string | null; channel: string | null };
  summary: {
    totalAmount: number;
    settledAmount: number;
    pendingAmount: number;
    failedAmount: number;
    rowCount: number;
  };
  byChannel: Array<{ channel: string; amount: number; count: number }>;
  byCurrency: Array<{ currency: string; amount: number; count: number }>;
  byStatus: Array<{ status: string; amount: number; count: number }>;
  rows: SettlementReportRow[];
  providerReport: unknown | null;
}

const SETTLEMENT_COLUMNS: ReportColumn[] = [
  { key: 'channel', label: 'Channel' },
  { key: 'id', label: 'Settlement ID' },
  { key: 'merchantId', label: 'Merchant' },
  { key: 'currency', label: 'Currency' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'reference', label: 'Reference' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
];

const SETTLED_STATES = new Set(['SETTLED', 'PROCESSED', 'RECONCILED', 'COMPLETE', 'COMPLETED', 'CAPTURED']);
const FAILED_STATES = new Set(['FAILED', 'RETURNED', 'REVERSED', 'DECLINED']);

export class SettlementReportService {
  private async loadVault(where: string, params: unknown[], limit: number): Promise<SettlementReportRow[]> {
    try {
      const res = await db.query(
        `SELECT id, merchant_id, amount, currency, status, reference, created_at, updated_at, type
           FROM vault_settlements
           ${where} ${where ? 'AND' : 'WHERE'} 1=1
           ORDER BY created_at DESC LIMIT ?`,
        [...params, limit],
      );
      return (res.rows || []).map((row: any) => ({
        channel: 'VAULT' as const,
        id: row.id,
        merchantId: row.merchant_id || null,
        amount: Number(row.amount),
        currency: String(row.currency || '').toUpperCase(),
        status: String(row.status || '').toUpperCase(),
        reference: row.reference || row.type || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      }));
    } catch {
      return [];
    }
  }

  private async loadPos(where: string, params: unknown[], limit: number): Promise<SettlementReportRow[]> {
    try {
      const res = await db.query(
        `SELECT id, merchant_id, amount, currency, status, created_at, updated_at, settled_at, ledger_entry_id
           FROM merchant_pos_settlements
           ${where} ${where ? 'AND' : 'WHERE'} 1=1
           ORDER BY created_at DESC LIMIT ?`,
        [...params, limit],
      );
      return (res.rows || []).map((row: any) => ({
        channel: 'POS' as const,
        id: row.id,
        merchantId: row.merchant_id || null,
        amount: Number(row.amount),
        currency: String(row.currency || '').toUpperCase(),
        status: String(row.status || '').toUpperCase(),
        reference: row.ledger_entry_id || null,
        createdAt: row.created_at || null,
        updatedAt: row.settled_at || row.updated_at || null,
      }));
    } catch {
      return [];
    }
  }

  private async loadCard(where: string, params: unknown[], limit: number): Promise<SettlementReportRow[]> {
    try {
      const res = await db.query(
        `SELECT id, merchant_id, net_amount, gross_amount, fee_amount, currency, status, transaction_id, created_at, updated_at
           FROM transaction_settlements
           ${where} ${where ? 'AND' : 'WHERE'} 1=1
           ORDER BY created_at DESC LIMIT ?`,
        [...params, limit],
      );
      return (res.rows || []).map((row: any) => ({
        channel: 'CARD' as const,
        id: row.id,
        merchantId: row.merchant_id || null,
        amount: Number(row.net_amount ?? row.gross_amount ?? 0),
        currency: String(row.currency || '').toUpperCase(),
        status: String(row.status || '').toUpperCase(),
        reference: row.transaction_id || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      }));
    } catch {
      return [];
    }
  }

  async build(query: SettlementReportQuery = {}): Promise<SettlementReport> {
    await ensureTreasuryTables();
    const limit = Math.min(Math.max(Number(query.limit) || 2000, 1), 20000);
    const filters: string[] = [];
    const params: unknown[] = [];
    if (query.merchantId) {
      filters.push('merchant_id = ?');
      params.push(query.merchantId);
    }
    if (query.currency) {
      filters.push('UPPER(currency) = ?');
      params.push(query.currency.toUpperCase());
    }
    if (query.from) {
      filters.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      filters.push('created_at <= ?');
      params.push(query.to);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const collectors: Array<Promise<SettlementReportRow[]>> = [];
    if (!query.channel || query.channel === 'VAULT') collectors.push(this.loadVault(where, params, limit));
    if (!query.channel || query.channel === 'POS') collectors.push(this.loadPos(where, params, limit));
    if (!query.channel || query.channel === 'CARD') collectors.push(this.loadCard(where, params, limit));
    const grouped = await Promise.all(collectors);
    let rows: SettlementReportRow[] = grouped.flat();
    if (query.status) {
      const want = query.status.toUpperCase();
      rows = rows.filter((r) => r.status === want);
    }
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const currencyMap = new Map<string, { amount: number; count: number }>();
    const statusMap = new Map<string, { amount: number; count: number }>();
    const channelMap = new Map<string, { amount: number; count: number }>();
    let totalAmount = 0;
    let settledAmount = 0;
    let pendingAmount = 0;
    let failedAmount = 0;

    for (const row of rows) {
      totalAmount += row.amount;
      const c = currencyMap.get(row.currency) || { amount: 0, count: 0 };
      c.amount += row.amount; c.count += 1; currencyMap.set(row.currency, c);
      const s = statusMap.get(row.status) || { amount: 0, count: 0 };
      s.amount += row.amount; s.count += 1; statusMap.set(row.status, s);
      const ch = channelMap.get(row.channel) || { amount: 0, count: 0 };
      ch.amount += row.amount; ch.count += 1; channelMap.set(row.channel, ch);

      if (SETTLED_STATES.has(row.status)) settledAmount += row.amount;
      else if (FAILED_STATES.has(row.status)) failedAmount += row.amount;
      else pendingAmount += row.amount;
    }

    let source: 'provider' | 'local' = 'local';
    let providerReport: unknown = null;
    let providerInfo: SettlementReport['provider'] = { configured: false, endpoint: null, requestId: null };
    if (providerClient.isConfigured()) {
      const call = await providerClient.fetchSettlementReport({
        from: query.from,
        to: query.to,
        currency: query.currency,
        merchant_id: query.merchantId,
      });
      source = 'provider';
      providerReport = call.data;
      providerInfo = { configured: true, endpoint: call.endpoint, requestId: call.requestId };
    }

    return {
      generatedAt: new Date().toISOString(),
      source,
      provider: providerInfo,
      period: { from: query.from || null, to: query.to || null },
      filters: {
        currency: query.currency ? query.currency.toUpperCase() : null,
        merchantId: query.merchantId || null,
        status: query.status ? query.status.toUpperCase() : null,
        channel: query.channel || null,
      },
      summary: {
        totalAmount,
        settledAmount,
        pendingAmount,
        failedAmount,
        rowCount: rows.length,
      },
      byChannel: [...channelMap.entries()].map(([channel, v]) => ({ channel, ...v })),
      byCurrency: [...currencyMap.entries()].map(([currency, v]) => ({ currency, ...v })),
      byStatus: [...statusMap.entries()].map(([status, v]) => ({ status, ...v })),
      rows,
      providerReport,
    };
  }

  toCsv(report: SettlementReport): string {
    return toCsv(SETTLEMENT_COLUMNS, report.rows as unknown as Array<Record<string, unknown>>);
  }

  toPrintable(report: SettlementReport): string {
    return toPrintableHtml({
      title: 'Settlement Report',
      subtitle: `Source: ${report.source}${report.provider?.requestId ? ` · provider request ${report.provider.requestId}` : ''}`,
      meta: [
        { label: 'Generated', value: report.generatedAt },
        { label: 'Period From', value: report.period.from || 'all time' },
        { label: 'Period To', value: report.period.to || 'now' },
        { label: 'Channel', value: report.filters.channel || 'all' },
        { label: 'Currency', value: report.filters.currency || 'all' },
        { label: 'Merchant', value: report.filters.merchantId || 'all' },
      ],
      summary: [
        { label: 'Total Amount', value: report.summary.totalAmount },
        { label: 'Settled', value: report.summary.settledAmount },
        { label: 'Pending', value: report.summary.pendingAmount },
        { label: 'Failed / Returned', value: report.summary.failedAmount },
        { label: 'Rows', value: report.summary.rowCount },
      ],
      columns: SETTLEMENT_COLUMNS,
      rows: report.rows as unknown as Array<Record<string, unknown>>,
      footer: 'Settlement Report — unified vault / POS / card settlement register.',
    });
  }
}

export const settlementReportService = new SettlementReportService();
