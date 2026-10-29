/**
 * BANK STATEMENT PROCESSOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Ingests a bank statement (MT940, ISO 20022 CAMT.053 XML, or CSV) — either
 * pulled straight from the configured provider or supplied as raw text — and
 * normalises it into bank_statement_lines.
 *
 * Every imported line is then matched against internal records
 * (inbound fund registrations for credits, vault settlements for debits) so the
 * books can be reconciled. When PROVIDER_* is configured, `fetchFromProvider`
 * performs a real signed GET to the provider's statement endpoint.
 */
import { v4 as uuidv4 } from 'uuid';
import { XMLParser } from 'fast-xml-parser';
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import { providerClient } from './provider.client';

export type StatementFormat = 'MT940' | 'CAMT053' | 'CSV';

export interface ParsedStatementLine {
  valueDate: string | null;
  bookingDate: string | null;
  amount: number;
  creditDebit: 'CREDIT' | 'DEBIT';
  currency: string | null;
  reference: string | null;
  counterparty: string | null;
  narrative: string | null;
  raw: unknown;
}

export interface ParsedStatement {
  format: StatementFormat;
  accountId: string | null;
  currency: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  lines: ParsedStatementLine[];
}

export interface StatementProcessResult {
  statementId: string;
  format: StatementFormat;
  source: 'provider' | 'upload';
  lineCount: number;
  matched: number;
  unmatched: number;
  accountId: string | null;
  currency: string | null;
  providerRequestId: string | null;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value).replace(/\s/g, '').replace(/,(\d{0,2})$/, '.$1').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const ymd = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (ymd) {
    const year = Number(ymd[1]) >= 70 ? `19${ymd[1]}` : `20${ymd[1]}`;
    return `${year}-${ymd[2]}-${ymd[3]}`;
  }
  return raw;
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields and escaped quotes). */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

export class BankStatementProcessor {
  detectFormat(content: string): StatementFormat {
    const trimmed = String(content || '').trim();
    if (/^<\?xml/i.test(trimmed) || /<Document[\s>]/i.test(trimmed) || /BkToCstmrStmt/i.test(trimmed)) return 'CAMT053';
    if (/^:\d{2}[A-Z]?:/m.test(trimmed)) return 'MT940';
    return 'CSV';
  }

  parseMt940(content: string): ParsedStatement {
    const result: ParsedStatement = {
      format: 'MT940',
      accountId: null,
      currency: null,
      periodFrom: null,
      periodTo: null,
      openingBalance: null,
      closingBalance: null,
      lines: [],
    };
    // Normalise field markers onto their own lines.
    const normalized = content.replace(/\r/g, '').replace(/\n(:\d{2}[A-Z]?:)/g, '\n$1');
    const tokens = normalized.split('\n');
    let current: ParsedStatementLine | null = null;

    const pushCurrent = () => {
      if (current) {
        result.lines.push(current);
        current = null;
      }
    };

    for (const rawLine of tokens) {
      const line = rawLine.trim();
      if (!line) continue;
      const field = line.match(/^:(\d{2}[A-Z]?):(.*)$/s);
      if (!field) {
        if (current && line) {
          current.narrative = current.narrative ? `${current.narrative} ${line}` : line;
        }
        continue;
      }
      const tag = field[1];
      const body = field[2].trim();
      if (tag === '25') {
        result.accountId = body.split('/').pop() || body;
      } else if (tag === '60F' || tag === '60M') {
        const m = body.match(/^([CD])(\d{6})([A-Z]{3})?(.+)$/);
        if (m) {
          const balance = num(m[4]);
          result.openingBalance = balance === null ? null : (m[1] === 'D' ? -balance : balance);
          result.currency = m[3] || result.currency;
          result.periodFrom = isoDate(m[2]);
        }
      } else if (tag === '62F' || tag === '62M') {
        const m = body.match(/^([CD])(\d{6})([A-Z]{3})?(.+)$/);
        if (m) {
          const balance = num(m[4]);
          result.closingBalance = balance === null ? null : (m[1] === 'D' ? -balance : balance);
          result.currency = m[3] || result.currency;
          result.periodTo = isoDate(m[2]);
        }
      } else if (tag === '61') {
        pushCurrent();
        const m = body.match(/^(?:[CD])?(\d{6})(\d{4})?([CD])([0-9.,]+)(?:N|F)([^\n/]*)/);
        if (m) {
          const amount = num(m[4]) ?? 0;
          current = {
            valueDate: isoDate(m[1]),
            bookingDate: isoDate(m[1]),
            amount: Math.abs(amount),
            creditDebit: m[3] === 'C' ? 'CREDIT' : 'DEBIT',
            currency: result.currency,
            reference: (m[5] || '').trim() || null,
            counterparty: null,
            narrative: null,
            raw: body,
          };
        } else {
          current = {
            valueDate: null,
            bookingDate: null,
            amount: 0,
            creditDebit: 'CREDIT',
            currency: result.currency,
            reference: body,
            counterparty: null,
            narrative: null,
            raw: body,
          };
        }
      } else if (tag === '86' && current) {
        const narrative = body.replace(/\?(\d{2})/g, ' ').trim();
        current.narrative = current.narrative ? `${current.narrative} ${narrative}` : narrative;
        const nameMatch = narrative.match(/(?:NAME|BENM|CNP)[:/]([^/\n]+)/i);
        if (nameMatch) current.counterparty = nameMatch[1].trim();
      }
    }
    pushCurrent();
    return result;
  }

  parseCamt053(content: string): ParsedStatement {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseTagValue: true,
      trimValues: true,
    });
    const doc = parser.parse(content || '');
    const result: ParsedStatement = {
      format: 'CAMT053',
      accountId: null,
      currency: null,
      periodFrom: null,
      periodTo: null,
      openingBalance: null,
      closingBalance: null,
      lines: [],
    };
    const stmts = toArray(doc?.Document?.BkToCstmrStmt?.Stmt);
    for (const stmt of stmts) {
      const acct = stmt?.Acct?.Id?.IBAN || stmt?.Acct?.Id?.Othr?.Id || null;
      if (!result.accountId) result.accountId = acct ? String(acct) : null;

      for (const bal of toArray(stmt?.Bal)) {
        const code = String(bal?.Tp?.CdOrPrtry?.Cd || '').toUpperCase();
        const amount = num(bal?.Amt?.['#text'] ?? bal?.Amt);
        if (amount === null) continue;
        const signed = String(bal?.CdtDbtInd || '').toUpperCase() === 'DBIT' ? -amount : amount;
        if (code === 'OPBD' || code === 'PRCD') result.openingBalance = signed;
        if (code === 'CLBD' || code === 'CLAV') result.closingBalance = signed;
        const ccy = bal?.Amt?.['@_Ccy'];
        if (ccy && !result.currency) result.currency = String(ccy).toUpperCase();
      }

      for (const entry of toArray(stmt?.Ntry)) {
        const amount = num(entry?.Amt?.['#text'] ?? entry?.Amt);
        if (amount === null) continue;
        const ccy = entry?.Amt?.['@_Ccy'];
        if (ccy && !result.currency) result.currency = String(ccy).toUpperCase();
        const creditDebit = String(entry?.CdtDbtInd || '').toUpperCase() === 'DBIT' ? 'DEBIT' : 'CREDIT';
        const bookingDate = isoDate(entry?.BookgDt?.Dt || entry?.BookgDt?.DtTm);
        const valueDate = isoDate(entry?.ValDt?.Dt || entry?.ValDt?.DtTm) || bookingDate;

        const txDetails = toArray(entry?.NtryDtls?.TxDtls);
        const reference =
          txDetails[0]?.Refs?.EndToEndId ||
          txDetails[0]?.Refs?.TxId ||
          txDetails[0]?.Refs?.AcctSvcrRef ||
          entry?.AcctSvcrRef ||
          entry?.NtryRef ||
          null;
        const narrative =
          txDetails[0]?.RmtInf?.Ustrd ||
          entry?.AddtlNtryInf ||
          (Array.isArray(txDetails[0]?.RmtInf?.Ustrd) ? txDetails[0].RmtInf.Ustrd.join(' ') : null);
        const counterparty =
          txDetails[0]?.RltdPties?.Dbtr?.Nm ||
          txDetails[0]?.RltdPties?.Cdtr?.Nm ||
          null;

        result.lines.push({
          valueDate,
          bookingDate,
          amount: Math.abs(amount),
          creditDebit,
          currency: ccy ? String(ccy).toUpperCase() : result.currency,
          reference: reference ? String(reference) : null,
          counterparty: counterparty ? String(counterparty) : null,
          narrative: narrative ? String(Array.isArray(narrative) ? narrative.join(' ') : narrative) : null,
          raw: entry,
        });
      }
    }
    return result;
  }

  parseCsv(content: string): ParsedStatement {
    const rows = parseCsv(content);
    const result: ParsedStatement = {
      format: 'CSV',
      accountId: null,
      currency: null,
      periodFrom: null,
      periodTo: null,
      openingBalance: null,
      closingBalance: null,
      lines: [],
    };
    if (!rows.length) return result;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
    const iDate = idx(['date', 'value_date', 'valuedate', 'booking_date', 'bookingdate']);
    const iAmount = idx(['amount', 'value', 'amt']);
    const iCreditDebit = idx(['credit_debit', 'direction', 'cdt_dbt', 'type', 'dr_cr']);
    const iCurrency = idx(['currency', 'ccy']);
    const iReference = idx(['reference', 'ref', 'transaction_id', 'uetr']);
    const iCounterparty = idx(['counterparty', 'name', 'beneficiary', 'payer']);
    const iNarrative = idx(['narrative', 'description', 'details', 'remark']);

    for (const row of rows.slice(1)) {
      const amountCell = iAmount >= 0 ? row[iAmount] : row[1];
      const signed = num(amountCell);
      if (signed === null) continue;
      const dirCell = iCreditDebit >= 0 ? String(row[iCreditDebit] || '').trim().toUpperCase() : '';
      let creditDebit: 'CREDIT' | 'DEBIT';
      if (dirCell.startsWith('D') || dirCell === 'DR' || dirCell === 'DBIT') creditDebit = 'DEBIT';
      else if (dirCell.startsWith('C') || dirCell === 'CR' || dirCell === 'CRDT') creditDebit = 'CREDIT';
      else creditDebit = signed >= 0 ? 'CREDIT' : 'DEBIT';
      const date = iDate >= 0 ? isoDate(row[iDate]) : null;
      const currency = iCurrency >= 0 ? String(row[iCurrency] || '').trim().toUpperCase() || null : null;
      if (currency && !result.currency) result.currency = currency;
      result.lines.push({
        valueDate: date,
        bookingDate: date,
        amount: Math.abs(signed),
        creditDebit,
        currency,
        reference: iReference >= 0 ? String(row[iReference] || '').trim() || null : null,
        counterparty: iCounterparty >= 0 ? String(row[iCounterparty] || '').trim() || null : null,
        narrative: iNarrative >= 0 ? String(row[iNarrative] || '').trim() || null : null,
        raw: row,
      });
    }
    return result;
  }

  parse(content: string, format?: StatementFormat): ParsedStatement {
    const resolved = format || this.detectFormat(content);
    if (resolved === 'MT940') return this.parseMt940(content);
    if (resolved === 'CAMT053') return this.parseCamt053(content);
    return this.parseCsv(content);
  }

  /** Normalise a provider JSON payload into a ParsedStatement. */
  normalizeProviderPayload(data: any, format?: StatementFormat): ParsedStatement {
    const rawLines: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.lines)
        ? data.lines
        : Array.isArray(data?.entries)
          ? data.entries
          : [];
    const lines: ParsedStatementLine[] = rawLines.map((entry) => {
      const signed = num(entry?.amount ?? entry?.amt ?? entry?.value);
      const dir = String(entry?.credit_debit || entry?.direction || entry?.cdtDbtInd || entry?.type || '').toUpperCase();
      const creditDebit: 'CREDIT' | 'DEBIT' = dir.startsWith('D') || (signed !== null && signed < 0)
        ? 'DEBIT'
        : 'CREDIT';
      const amount = signed === null ? 0 : Math.abs(signed);
      const date = isoDate(entry?.value_date || entry?.valueDate || entry?.booking_date || entry?.bookingDate || entry?.date);
      return {
        valueDate: date,
        bookingDate: date,
        amount,
        creditDebit,
        currency: entry?.currency ? String(entry.currency).toUpperCase() : null,
        reference: entry?.reference || entry?.ref || entry?.uetr || entry?.transaction_id || null,
        counterparty: entry?.counterparty || entry?.name || entry?.beneficiary || null,
        narrative: entry?.narrative || entry?.description || entry?.details || null,
        raw: entry,
      };
    });
    const currencyFromLines = lines.find((l) => l.currency)?.currency || null;
    return {
      format: format || 'CSV',
      accountId: data?.account_id || data?.accountId || data?.iban || null,
      currency: data?.currency ? String(data.currency).toUpperCase() : currencyFromLines,
      periodFrom: isoDate(data?.period_from || data?.from),
      periodTo: isoDate(data?.period_to || data?.to),
      openingBalance: num(data?.opening_balance ?? data?.openingBalance),
      closingBalance: num(data?.closing_balance ?? data?.closingBalance),
      lines,
    };
  }

  /** Real signed GET to the provider statement endpoint (requires PROVIDER_*). */
  async fetchFromProvider(query: {
    accountId?: string;
    from?: string;
    to?: string;
    currency?: string;
    format?: StatementFormat;
  }): Promise<{ parsed: ParsedStatement; requestId: string | null; endpoint: string }> {
    const call = await providerClient.fetchBankStatement({
      account_id: query.accountId,
      from: query.from,
      to: query.to,
      currency: query.currency,
      format: query.format,
    });
    const data: any = call.data || {};
    if (typeof data === 'string') {
      return { parsed: this.parse(data, query.format), requestId: call.requestId, endpoint: call.endpoint };
    }
    if (typeof data?.statement === 'string' || typeof data?.raw === 'string' || typeof data?.content === 'string') {
      const text = data.statement || data.raw || data.content;
      return { parsed: this.parse(text, query.format || data.format), requestId: call.requestId, endpoint: call.endpoint };
    }
    return {
      parsed: this.normalizeProviderPayload(data, query.format),
      requestId: call.requestId,
      endpoint: call.endpoint,
    };
  }

  async persist(
    parsed: ParsedStatement,
    options: { source: 'provider' | 'upload'; importedBy?: string; providerRequestId?: string | null; accountId?: string; currency?: string },
  ): Promise<StatementProcessResult> {
    await ensureTreasuryTables();
    const statementId = uuidv4();
    const now = new Date().toISOString();
    const accountId = options.accountId || parsed.accountId || null;
    const currency = (options.currency || parsed.currency || null)?.toUpperCase() || null;
    const dates = parsed.lines.map((l) => l.valueDate).filter(Boolean) as string[];
    const periodFrom = parsed.periodFrom || (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null);
    const periodTo = parsed.periodTo || (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null);

    await db.query(
      `INSERT INTO bank_statements
        (id, account_id, currency, source_format, source, period_from, period_to,
         opening_balance, closing_balance, line_count, imported_by, provider_request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        statementId,
        accountId,
        currency,
        parsed.format,
        options.source,
        periodFrom,
        periodTo,
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.lines.length,
        options.importedBy || null,
        options.providerRequestId || null,
        now,
      ],
    );

    let matched = 0;
    for (const line of parsed.lines) {
      const match = await this.matchLine(line, currency);
      if (match.matched) matched += 1;
      await db.query(
        `INSERT INTO bank_statement_lines
          (id, statement_id, source_format, account_id, currency, value_date, booking_date,
           amount, credit_debit, reference, counterparty, narrative, match_status, matched_ref, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          statementId,
          parsed.format,
          accountId,
          line.currency || currency,
          line.valueDate,
          line.bookingDate,
          line.amount,
          line.creditDebit,
          line.reference,
          line.counterparty,
          line.narrative,
          match.matched ? 'MATCHED' : 'UNMATCHED',
          match.matchedRef || null,
          JSON.stringify(line.raw ?? {}),
          now,
        ],
      );
    }

    return {
      statementId,
      format: parsed.format,
      source: options.source,
      lineCount: parsed.lines.length,
      matched,
      unmatched: parsed.lines.length - matched,
      accountId,
      currency,
      providerRequestId: options.providerRequestId || null,
    };
  }

  private async matchLine(
    line: ParsedStatementLine,
    fallbackCurrency: string | null,
  ): Promise<{ matched: boolean; matchedRef: string | null }> {
    const currency = (line.currency || fallbackCurrency || '').toUpperCase();
    try {
      if (line.creditDebit === 'CREDIT') {
        const res = await db.query(
          `SELECT id FROM inbound_transaction_registrations
            WHERE CAST(amount AS REAL) = ?
              AND (? = '' OR UPPER(currency) = ?)
              AND (
                (reference IS NULL AND ? IS NULL)
                OR UPPER(authorization_code) = ?
                OR UPPER(COALESCE(uetr, '')) = ?
                OR COALESCE(deposit_code, '') = ?
              )
            LIMIT 1`,
          [
            line.amount,
            currency,
            currency,
            line.reference ? line.reference.toUpperCase() : null,
            String(line.reference || '').toUpperCase(),
            String(line.reference || '').toUpperCase(),
            String(line.reference || ''),
          ],
        );
        if (res.rows?.[0]) return { matched: true, matchedRef: `inbound:${res.rows[0].id}` };
      } else {
        const res = await db.query(
          `SELECT id FROM vault_settlements
            WHERE CAST(amount AS REAL) = ?
              AND (? = '' OR UPPER(currency) = ?)
              AND (id = ? OR reference = ?)
            LIMIT 1`,
          [line.amount, currency, currency, String(line.reference || ''), String(line.reference || '')],
        );
        if (res.rows?.[0]) return { matched: true, matchedRef: `settlement:${res.rows[0].id}` };
      }
    } catch {
      // Internal tables may be absent in some runtimes — leave the line unmatched.
    }
    return { matched: false, matchedRef: null };
  }

  async listStatements(limit = 50) {
    await ensureTreasuryTables();
    const res = await db.query(
      `SELECT * FROM bank_statements ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return res.rows || [];
  }

  async listLines(statementId: string, matchStatus?: string) {
    await ensureTreasuryTables();
    const params: unknown[] = [statementId];
    let sql = `SELECT * FROM bank_statement_lines WHERE statement_id = ?`;
    if (matchStatus) {
      sql += ` AND match_status = ?`;
      params.push(matchStatus.toUpperCase());
    }
    sql += ` ORDER BY booking_date ASC, created_at ASC`;
    const res = await db.query(sql, params);
    return res.rows || [];
  }
}

export const bankStatementProcessor = new BankStatementProcessor();
