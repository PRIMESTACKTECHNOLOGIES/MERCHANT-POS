/**
 * RESERVE REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 * Reserve position across all merchant/currency reserves (vault_reserve) plus a
 * custody-account snapshot. When PROVIDER_* is configured the report is also
 * pulled from the provider's /reports/reserve endpoint with a real signed call.
 */
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import { providerClient } from './provider.client';
import { toCsv, toPrintableHtml, type ReportColumn } from './reportRenderer';

export interface ReserveReportQuery {
  from?: string;
  to?: string;
  currency?: string;
  merchantId?: string;
  status?: string;
  limit?: number;
}

export interface ReserveRow {
  id: string;
  ts: string;
  merchantId: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  releaseTs: string | null;
}

export interface ReserveReport {
  generatedAt: string;
  source: 'provider' | 'local';
  provider: { configured: boolean; endpoint: string | null; requestId: string | null } | null;
  period: { from: string | null; to: string | null };
  filters: { currency: string | null; merchantId: string | null; status: string | null };
  summary: {
    totalReserved: number;
    activeReserved: number;
    releasedReserved: number;
    cancelledReserved: number;
    activeCount: number;
    totalCount: number;
  };
  byCurrency: Array<{ currency: string; activeAmount: number; totalAmount: number; activeCount: number }>;
  byReason: Array<{ reason: string; amount: number; count: number }>;
  aging: Array<{ bucket: string; amount: number; count: number }>;
  custody: Array<{ currency: string; available: number; pending: number; settled: number }>;
  reserves: ReserveRow[];
  providerReport: unknown | null;
}

const RESERVE_COLUMNS: ReportColumn[] = [
  { key: 'id', label: 'Reserve ID' },
  { key: 'ts', label: 'Created' },
  { key: 'merchantId', label: 'Merchant' },
  { key: 'currency', label: 'Currency' },
  { key: 'amount', label: 'Amount' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'releaseTs', label: 'Release Date' },
];

function agingBucket(ts: string): string {
  const created = new Date(ts).getTime();
  if (!Number.isFinite(created)) return 'unknown';
  const days = Math.floor((Date.now() - created) / 86_400_000);
  if (days <= 30) return '0-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '90+ days';
}

export class ReserveReportService {
  async build(query: ReserveReportQuery = {}): Promise<ReserveReport> {
    await ensureTreasuryTables();
    const filters: string[] = [];
    const params: unknown[] = [];
    if (query.currency) {
      filters.push('UPPER(currency) = ?');
      params.push(query.currency.toUpperCase());
    }
    if (query.merchantId) {
      filters.push('merchant_id = ?');
      params.push(query.merchantId);
    }
    if (query.status) {
      filters.push('UPPER(status) = ?');
      params.push(query.status.toUpperCase());
    }
    if (query.from) {
      filters.push('ts >= ?');
      params.push(query.from);
    }
    if (query.to) {
      filters.push('ts <= ?');
      params.push(query.to);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(query.limit) || 2000, 1), 20000);

    const res = await db.query(
      `SELECT * FROM vault_reserve ${where} ORDER BY ts DESC LIMIT ?`,
      [...params, limit],
    );
    const reserves: ReserveRow[] = (res.rows || []).map((row: any) => ({
      id: row.id,
      ts: row.ts,
      merchantId: row.merchant_id || null,
      amount: Number(row.amount),
      currency: String(row.currency || '').toUpperCase(),
      reason: row.reason || null,
      status: String(row.status || '').toUpperCase(),
      releaseTs: row.release_ts || null,
    }));

    const totalReserved = reserves.reduce((sum, r) => sum + r.amount, 0);
    const active = reserves.filter((r) => r.status === 'ACTIVE');
    const released = reserves.filter((r) => r.status === 'RELEASED');
    const cancelled = reserves.filter((r) => r.status === 'CANCELLED');

    const currencyMap = new Map<string, { activeAmount: number; totalAmount: number; activeCount: number }>();
    const reasonMap = new Map<string, { amount: number; count: number }>();
    const agingMap = new Map<string, { amount: number; count: number }>();
    for (const r of reserves) {
      const c = currencyMap.get(r.currency) || { activeAmount: 0, totalAmount: 0, activeCount: 0 };
      c.totalAmount += r.amount;
      if (r.status === 'ACTIVE') {
        c.activeAmount += r.amount;
        c.activeCount += 1;
      }
      currencyMap.set(r.currency, c);

      const reasonKey = r.reason || 'UNSPECIFIED';
      const reason = reasonMap.get(reasonKey) || { amount: 0, count: 0 };
      reason.amount += r.amount;
      reason.count += 1;
      reasonMap.set(reasonKey, reason);

      if (r.status === 'ACTIVE') {
        const bucket = agingBucket(r.ts);
        const ag = agingMap.get(bucket) || { amount: 0, count: 0 };
        ag.amount += r.amount;
        ag.count += 1;
        agingMap.set(bucket, ag);
      }
    }

    let custody: ReserveReport['custody'] = [];
    try {
      const cust = await db.query(
        `SELECT currency,
                COALESCE(SUM(available_delta), 0) AS available,
                COALESCE(SUM(pending_delta), 0) AS pending,
                COALESCE(SUM(settled_delta), 0) AS settled
           FROM vault_custody_entries
          GROUP BY currency`,
      );
      custody = (cust.rows || []).map((row: any) => ({
        currency: String(row.currency || '').toUpperCase(),
        available: Number(row.available),
        pending: Number(row.pending),
        settled: Number(row.settled),
      }));
    } catch {
      custody = [];
    }

    let source: 'provider' | 'local' = 'local';
    let providerReport: unknown = null;
    let providerInfo: ReserveReport['provider'] = null;
    if (providerClient.isConfigured()) {
      const call = await providerClient.fetchReserveReport({
        from: query.from,
        to: query.to,
        currency: query.currency,
        merchant_id: query.merchantId,
      });
      source = 'provider';
      providerReport = call.data;
      providerInfo = { configured: true, endpoint: call.endpoint, requestId: call.requestId };
    } else {
      providerInfo = { configured: false, endpoint: null, requestId: null };
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
      },
      summary: {
        totalReserved,
        activeReserved: active.reduce((s, r) => s + r.amount, 0),
        releasedReserved: released.reduce((s, r) => s + r.amount, 0),
        cancelledReserved: cancelled.reduce((s, r) => s + r.amount, 0),
        activeCount: active.length,
        totalCount: reserves.length,
      },
      byCurrency: [...currencyMap.entries()].map(([currency, v]) => ({ currency, ...v })),
      byReason: [...reasonMap.entries()].map(([reason, v]) => ({ reason, ...v })),
      aging: [...agingMap.entries()].map(([bucket, v]) => ({ bucket, ...v })),
      custody,
      reserves,
      providerReport,
    };
  }

  toCsv(report: ReserveReport): string {
    return toCsv(RESERVE_COLUMNS, report.reserves as unknown as Array<Record<string, unknown>>);
  }

  toPrintable(report: ReserveReport): string {
    return toPrintableHtml({
      title: 'Reserve Report',
      subtitle: `Source: ${report.source}${report.provider?.requestId ? ` · provider request ${report.provider.requestId}` : ''}`,
      meta: [
        { label: 'Generated', value: report.generatedAt },
        { label: 'Period From', value: report.period.from || 'all time' },
        { label: 'Period To', value: report.period.to || 'now' },
        { label: 'Currency Filter', value: report.filters.currency || 'all' },
        { label: 'Merchant Filter', value: report.filters.merchantId || 'all' },
        { label: 'Status Filter', value: report.filters.status || 'all' },
      ],
      summary: [
        { label: 'Total Reserved', value: report.summary.totalReserved },
        { label: 'Active Reserved', value: report.summary.activeReserved },
        { label: 'Released', value: report.summary.releasedReserved },
        { label: 'Cancelled', value: report.summary.cancelledReserved },
        { label: 'Active Reserves', value: report.summary.activeCount },
        { label: 'Total Reserves', value: report.summary.totalCount },
      ],
      columns: RESERVE_COLUMNS,
      rows: report.reserves as unknown as Array<Record<string, unknown>>,
      footer: 'Reserve Report — merchant funds held back for risk, chargebacks and fraud.',
    });
  }
}

export const reserveReportService = new ReserveReportService();
