/**
 * EMI ACCOUNT STATEMENT
 * ─────────────────────────────────────────────────────────────────────────────
 * Electronic-Money-Institution style account statement for a merchant's
 * e-money account (per currency): opening balance, every movement in the
 * period with a running balance, and the closing balance.
 *
 * Local source of truth is vault_ledger. When PROVIDER_* is configured the
 * statement is also requested from the provider's account-statement endpoint
 * with a real signed call.
 */
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import { providerClient } from './provider.client';
import { toCsv, toPrintableHtml, type ReportColumn } from './reportRenderer';

export interface EmiStatementQuery {
  merchantId: string;
  currency: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface EmiMovement {
  id: string;
  ts: string;
  type: string;
  reference: string | null;
  status: string;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface EmiAccountStatement {
  generatedAt: string;
  source: 'provider' | 'local';
  provider: { configured: boolean; endpoint: string | null; requestId: string | null } | null;
  account: {
    accountId: string;
    merchantId: string;
    currency: string;
    accountType: string;
  };
  period: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  movementCount: number;
  movements: EmiMovement[];
  providerStatement: unknown | null;
}

const STATEMENT_COLUMNS: ReportColumn[] = [
  { key: 'ts', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'reference', label: 'Reference' },
  { key: 'description', label: 'Description' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'balance', label: 'Balance' },
  { key: 'status', label: 'Status' },
];

function describe(row: any): string | null {
  if (!row) return null;
  let meta: any = row.meta;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = null; }
  }
  return (
    (meta && (meta.description || meta.note || meta.memo)) ||
    row.type ||
    null
  );
}

export class EmiAccountStatementService {
  async build(query: EmiStatementQuery): Promise<EmiAccountStatement> {
    await ensureTreasuryTables();
    const merchantId = String(query.merchantId || '').trim();
    if (!merchantId) throw Object.assign(new Error('merchantId is required'), { code: 'VALIDATION_ERROR' });
    const currency = String(query.currency || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error('currency must be an ISO 4217 alpha-3 code'), { code: 'VALIDATION_ERROR' });

    const from = query.from || null;
    const to = query.to || null;
    const limit = Math.min(Math.max(Number(query.limit) || 5000, 1), 50000);

    let openingBalance = 0;
    let movements: EmiMovement[] = [];
    let totalCredits = 0;
    let totalDebits = 0;

    try {
      if (from) {
        const open = await db.query(
          `SELECT COALESCE(SUM(amount), 0) AS bal FROM vault_ledger
            WHERE merchant_id = ? AND UPPER(currency) = ? AND ts < ?`,
          [merchantId, currency, from],
        );
        openingBalance = Number(open.rows?.[0]?.bal || 0);
      }

      const filters = ['merchant_id = ?', 'UPPER(currency) = ?'];
      const params: unknown[] = [merchantId, currency];
      if (from) { filters.push('ts >= ?'); params.push(from); }
      if (to) { filters.push('ts <= ?'); params.push(to); }
      params.push(limit);

      const res = await db.query(
        `SELECT id, ts, type, amount, currency, reference, status, meta
           FROM vault_ledger
          WHERE ${filters.join(' AND ')}
          ORDER BY ts ASC, id ASC
          LIMIT ?`,
        params,
      );

      let running = openingBalance;
      movements = (res.rows || []).map((row: any) => {
        const amount = Number(row.amount);
        const debit = amount < 0 ? Math.abs(amount) : 0;
        const credit = amount > 0 ? amount : 0;
        running += amount;
        if (credit) totalCredits += credit;
        if (debit) totalDebits += debit;
        return {
          id: row.id,
          ts: row.ts,
          type: String(row.type || ''),
          reference: row.reference || null,
          status: String(row.status || ''),
          description: describe(row),
          debit,
          credit,
          balance: Number(running.toFixed(2)),
        };
      });
    } catch {
      movements = [];
    }

    const closingBalance = Number((openingBalance + totalCredits - totalDebits).toFixed(2));

    let source: 'provider' | 'local' = 'local';
    let providerStatement: unknown = null;
    let providerInfo: EmiAccountStatement['provider'] = { configured: false, endpoint: null, requestId: null };
    if (providerClient.isConfigured()) {
      const call = await providerClient.fetchAccountStatement(merchantId, {
        from,
        to,
        currency,
      });
      source = 'provider';
      providerStatement = call.data;
      providerInfo = { configured: true, endpoint: call.endpoint, requestId: call.requestId };
    }

    return {
      generatedAt: new Date().toISOString(),
      source,
      provider: providerInfo,
      account: {
        accountId: merchantId,
        merchantId,
        currency,
        accountType: 'EMI_EMONEY_ACCOUNT',
      },
      period: { from, to },
      openingBalance: Number(openingBalance.toFixed(2)),
      closingBalance,
      totalCredits: Number(totalCredits.toFixed(2)),
      totalDebits: Number(totalDebits.toFixed(2)),
      movementCount: movements.length,
      movements,
      providerStatement,
    };
  }

  toCsv(statement: EmiAccountStatement): string {
    const lines: string[] = [];
    lines.push(`EMI Account Statement,${statement.account.accountId},${statement.account.currency}`);
    lines.push(`Period,${statement.period.from || 'start'},${statement.period.to || 'now'}`);
    lines.push(`Opening Balance,${statement.openingBalance}`);
    lines.push('');
    lines.push(toCsv(STATEMENT_COLUMNS, statement.movements as unknown as Array<Record<string, unknown>>).trimEnd());
    lines.push('');
    lines.push(`Total Credits,${statement.totalCredits}`);
    lines.push(`Total Debits,${statement.totalDebits}`);
    lines.push(`Closing Balance,${statement.closingBalance}`);
    return `${lines.join('\n')}\n`;
  }

  toPrintable(statement: EmiAccountStatement): string {
    return toPrintableHtml({
      title: 'EMI Account Statement',
      subtitle: `${statement.account.accountId} · ${statement.account.currency} · ${statement.account.accountType}`,
      meta: [
        { label: 'Generated', value: statement.generatedAt },
        { label: 'Account', value: statement.account.accountId },
        { label: 'Currency', value: statement.account.currency },
        { label: 'Period From', value: statement.period.from || 'start of account' },
        { label: 'Period To', value: statement.period.to || 'now' },
        { label: 'Source', value: statement.source },
      ],
      summary: [
        { label: 'Opening Balance', value: statement.openingBalance },
        { label: 'Total Credits', value: statement.totalCredits },
        { label: 'Total Debits', value: statement.totalDebits },
        { label: 'Closing Balance', value: statement.closingBalance },
        { label: 'Movements', value: statement.movementCount },
      ],
      columns: STATEMENT_COLUMNS,
      rows: statement.movements as unknown as Array<Record<string, unknown>>,
      footer: 'EMI Account Statement — electronic money account held on behalf of the merchant.',
    });
  }
}

export const emiAccountStatementService = new EmiAccountStatementService();
