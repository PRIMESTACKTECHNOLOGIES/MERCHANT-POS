/**
 * Shared renderers for treasury reports: JSON is returned as-is by the router,
 * these helpers produce CSV downloads and print-ready HTML statements
 * (printable to PDF from the browser — no external PDF dependency required).
 */

export interface ReportColumn {
  key: string;
  label: string;
}

export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((c) => escapeCsv(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCsv(row[c.key])).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const looksMonetary = /amount|balance|total|fee|credit|debit|net|reserved|available/i.test(key);
  const numeric = typeof value === 'number'
    || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && looksMonetary);
  if (numeric) {
    const n = Number(value);
    if (Number.isFinite(n) && (looksMonetary || !Number.isInteger(n))) {
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  return escapeHtml(value);
}

export interface PrintableStatementInput {
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: unknown }>;
  summary?: Array<{ label: string; value: unknown }>;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  footer?: string;
}

export function toPrintableHtml(input: PrintableStatementInput): string {
  const metaRows = (input.meta || [])
    .map((m) => `<div class="meta-item"><span class="meta-label">${escapeHtml(m.label)}</span><span class="meta-value">${escapeHtml(m.value)}</span></div>`)
    .join('');
  const summaryRows = (input.summary || [])
    .map((s) => `<div class="summary-card"><div class="summary-label">${escapeHtml(s.label)}</div><div class="summary-value">${formatCell(s.label, s.value)}</div></div>`)
    .join('');
  const head = input.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = input.rows
    .map((row) => `<tr>${input.columns.map((c) => `<td>${formatCell(c.key, row[c.key])}</td>`).join('')}</tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; background: #f8fafc; }
  .sheet { max-width: 1100px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.02em; }
  .subtitle { color: #64748b; font-size: 13px; margin-bottom: 20px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 24px; padding: 16px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; margin-bottom: 20px; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
  .meta-value { font-size: 13px; font-weight: 600; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .summary-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #f1f5f9; }
  .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 6px; }
  .summary-value { font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #0f172a; color: #fff; padding: 8px 10px; font-weight: 600; white-space: nowrap; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center; }
  .toolbar { max-width: 1100px; margin: 0 auto 16px; text-align: right; }
  .toolbar button { background: #0f172a; color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; }
    .toolbar { display: none; }
    thead { display: table-header-group; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">
    <h1>${escapeHtml(input.title)}</h1>
    ${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ''}
    ${metaRows ? `<div class="meta">${metaRows}</div>` : ''}
    ${summaryRows ? `<div class="summary">${summaryRows}</div>` : ''}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${input.columns.length}">No records</td></tr>`}</tbody>
    </table>
    <div class="footer">${escapeHtml(input.footer || `Generated ${new Date().toISOString()}`)}</div>
  </div>
</body>
</html>`;
}
