/**
 * TREASURY ROUTER — mounted at /api/treasury
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes the treasury engines:
 *   · Funds Auto Verifier      (provider-backed inbound fund verification)
 *   · Bank Statement Processor (MT940 / CAMT.053 / CSV import + matching)
 *   · Reserve Report
 *   · Settlement Report
 *   · EMI Account Statement
 *
 * Sensitive: every route is authenticated (the app also applies
 * authenticateToken globally before this router).
 */
import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { db } from '../../config/db';
import { ensureTreasuryTables } from './treasury.tables';
import { providerClient, ProviderNotConfiguredError, ProviderCallFailedError } from './provider.client';
import { fundsAutoVerifierEngine } from './fundsAutoVerifier.engine';
import { bankStatementProcessor, type StatementFormat } from './bankStatementProcessor.service';
import { reserveReportService } from './reserveReport.service';
import { settlementReportService } from './settlementReport.service';
import { emiAccountStatementService } from './emiAccountStatement.service';
import { processPos1011RealSettlement } from '../../pos/pos1011RealSettlement';
import {
  describeProviderConfig,
  saveProviderConfig,
} from './providerConfig.store';

const router = Router();
router.use(authenticateToken);

function fail(res: Response, error: any): void {
  if (error instanceof ProviderNotConfiguredError) {
    res.status(503).json({
      ok: false,
      error: 'PROVIDER_NOT_CONFIGURED',
      message: error.message,
      missing: error.missing,
      hint: 'Set PROVIDER_ENDPOINT_URL, PROVIDER_API_KEY and PROVIDER_SECRET_KEY so the engine can call the provider.',
    });
    return;
  }
  if (error instanceof ProviderCallFailedError) {
    res.status(502).json({
      ok: false,
      error: 'PROVIDER_CALL_FAILED',
      message: error.message,
      endpoint: error.endpoint,
      status: error.status ?? null,
      response: error.responseBody ?? null,
    });
    return;
  }
  const code = error?.code || 'TREASURY_ERROR';
  const status = code === 'VALIDATION_ERROR' ? 400 : 500;
  res.status(status).json({ ok: false, error: code, message: error?.message || 'Treasury operation failed' });
}

function sendFormatted(res: Response, format: string | undefined, payload: {
  json: unknown;
  csv?: () => string;
  html?: () => string;
  filename?: string;
}): void {
  const fmt = String(format || 'json').trim().toLowerCase();
  if (fmt === 'csv' && payload.csv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename || 'treasury-report'}.csv"`);
    res.send(payload.csv());
    return;
  }
  if ((fmt === 'html' || fmt === 'pdf' || fmt === 'print') && payload.html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(payload.html());
    return;
  }
  res.json({ ok: true, data: payload.json });
}

// ── Provider configuration ───────────────────────────────────────────────────

router.get('/provider/status', (_req: Request, res: Response) => {
  res.json({ ok: true, data: providerClient.status() });
});

// Read the credential set currently in effect (UI values win over env vars).
// Secrets are returned masked; plaintext is never exposed.
router.get('/provider/config', async (_req: Request, res: Response) => {
  try {
    res.json({
      ok: true,
      data: {
        items: await describeProviderConfig(),
        provider: providerClient.status(),
        globalServer: globalServerStatus(),
      },
    });
  } catch (error: any) {
    fail(res, error);
  }
});

// Store provider / global-server / C2M credentials typed in the Treasury UI.
// A non-empty value overrides the environment variable; an empty string clears
// the stored value and falls back to the environment variable.
router.put('/provider/config', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { values?: Record<string, unknown> };
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    if (!Object.keys(values).length) {
      res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'values must contain at least one credential' });
      return;
    }
    const updatedBy = (req as any).user?.username || (req as any).user?.id || 'api';
    const result = await saveProviderConfig(values, updatedBy);
    res.json({
      ok: true,
      data: {
        ...result,
        items: await describeProviderConfig(),
        provider: providerClient.status(),
        globalServer: globalServerStatus(),
      },
    });
  } catch (error: any) {
    fail(res, error);
  }
});

// ── Funds auto verifier ──────────────────────────────────────────────────────

router.get('/funds-verifier/status', async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, data: await fundsAutoVerifierEngine.getStatus() });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/funds-verifier/candidates', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 200;
    const authorizationCode = req.query.authorizationCode ? String(req.query.authorizationCode) : undefined;
    res.json({ ok: true, data: await fundsAutoVerifierEngine.listCandidates(limit, authorizationCode) });
  } catch (error: any) {
    fail(res, error);
  }
});

router.post('/funds-verifier/run', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { limit?: number; authorizationCode?: string; initiatedBy?: string };
    const result = await fundsAutoVerifierEngine.run({
      limit: body.limit,
      authorizationCode: body.authorizationCode,
      initiatedBy: body.initiatedBy || 'api',
    });
    res.json({ ok: true, data: result });
  } catch (error: any) {
    fail(res, error);
  }
});

// ── Bank statement processor ─────────────────────────────────────────────────

router.post('/bank-statements/process', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as {
      content?: string;
      format?: StatementFormat;
      accountId?: string;
      currency?: string;
      fileName?: string;
    };
    if (!body.content || typeof body.content !== 'string') {
      res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'content (raw statement text) is required' });
      return;
    }
    const parsed = bankStatementProcessor.parse(body.content, body.format);
    const result = await bankStatementProcessor.persist(parsed, {
      source: 'upload',
      importedBy: (req as any).user?.username || (req as any).user?.id || 'api',
      accountId: body.accountId,
      currency: body.currency,
    });
    res.json({ ok: true, data: { ...result, fileName: body.fileName || null } });
  } catch (error: any) {
    fail(res, error);
  }
});

router.post('/bank-statements/fetch', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as {
      accountId?: string;
      from?: string;
      to?: string;
      currency?: string;
      format?: StatementFormat;
    };
    const fetched = await bankStatementProcessor.fetchFromProvider(body);
    const result = await bankStatementProcessor.persist(fetched.parsed, {
      source: 'provider',
      importedBy: (req as any).user?.username || (req as any).user?.id || 'api',
      providerRequestId: fetched.requestId,
      accountId: body.accountId,
      currency: body.currency,
    });
    res.json({ ok: true, data: { ...result, providerEndpoint: fetched.endpoint } });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/bank-statements', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 50;
    res.json({ ok: true, data: await bankStatementProcessor.listStatements(limit) });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/bank-statements/:id/lines', async (req: Request, res: Response) => {
  try {
    const matchStatus = req.query.matchStatus ? String(req.query.matchStatus) : undefined;
    res.json({ ok: true, data: await bankStatementProcessor.listLines(req.params.id, matchStatus) });
  } catch (error: any) {
    fail(res, error);
  }
});

// ── Real funds (Global Server) ───────────────────────────────────────────────
//
// The Global Server is the fund-holding server that actually owns the money
// behind a card capture. The ledger credit produced by capture is a claim; the
// ONLY thing that moves real value is a CONFIRMED response from this server.
// Nothing is ever recorded as a real settlement without it.

function globalServerStatus() {
  const url = String(process.env.GLOBAL_SERVER_URL || '').trim();
  const key = String(process.env.GLOBAL_API_KEY || '').trim();
  const secret = String(process.env.GLOBAL_API_SECRET || '').trim();
  const missing: string[] = [];
  if (!url) missing.push('GLOBAL_SERVER_URL');
  if (!key) missing.push('GLOBAL_API_KEY');
  if (!secret) missing.push('GLOBAL_API_SECRET');
  return {
    configured: missing.length === 0,
    missing,
    baseUrl: url || null,
    balancePath: '/balance',
    settlePath: '/settle',
  };
}

router.get('/real-funds/status', async (_req: Request, res: Response) => {
  try {
    await ensureTreasuryTables();
    const recent = await db.query(
      `SELECT id, tx_id, amount_minor, currency, status, created_at
         FROM pos1011_events
        WHERE event_type = 'GLOBAL_SETTLEMENT'
        ORDER BY created_at DESC LIMIT 25`,
    ).catch(() => ({ rows: [] as any[] }));
    const totals = await db.query(
      `SELECT currency, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS minor
         FROM pos1011_events
        WHERE event_type = 'GLOBAL_SETTLEMENT' AND status = 'SETTLED'
        GROUP BY currency`,
    ).catch(() => ({ rows: [] as any[] }));
    res.json({
      ok: true,
      data: {
        globalServer: globalServerStatus(),
        recentSettlements: recent.rows || [],
        totals: (totals.rows || []).map((r: any) => ({
          currency: r.currency,
          count: Number(r.count),
          amountMinor: Number(r.minor),
        })),
      },
    });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/real-funds/settlements', async (req: Request, res: Response) => {
  try {
    await ensureTreasuryTables();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const result = await db.query(
      `SELECT * FROM pos1011_events
        WHERE event_type IN ('GLOBAL_SETTLEMENT', 'GLOBAL_BALANCE_CHECK')
        ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    res.json({ ok: true, data: result.rows || [] });
  } catch (error: any) {
    fail(res, error);
  }
});

// Calls the fund-holding server to move REAL value for a captured sale.
// Fail-closed: never attempts the call when the server is not configured, and
// never records a settlement that the server did not CONFIRM.
router.post('/real-funds/settle', async (req: Request, res: Response) => {
  const status = globalServerStatus();
  if (!status.configured) {
    res.status(503).json({
      ok: false,
      error: 'GLOBAL_SERVER_NOT_CONFIGURED',
      message: 'The fund-holding server is not configured, so no real funds can be called.',
      missing: status.missing,
      hint: 'Set GLOBAL_SERVER_URL, GLOBAL_API_KEY and GLOBAL_API_SECRET in the backend environment.',
    });
    return;
  }
  try {
    const body = (req.body || {}) as any;
    const amountMinor = Number(body.amountMinor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'amountMinor must be a positive integer (minor units).' });
      return;
    }
    const result = await processPos1011RealSettlement({
      sessionId: String(body.sessionId || ''),
      cardRef: String(body.cardRef || ''),
      amountMinor,
      currency: String(body.currency || '').toUpperCase(),
      authCode: String(body.authCode || ''),
      receiverBank: {
        bankName: String(body.receiverBank?.bankName || ''),
        iban: body.receiverBank?.iban ? String(body.receiverBank.iban) : undefined,
        accountNumber: body.receiverBank?.accountNumber ? String(body.receiverBank.accountNumber) : undefined,
        swift: body.receiverBank?.swift ? String(body.receiverBank.swift) : undefined,
      },
    });
    res.json({ ok: true, data: result });
  } catch (error: any) {
    // Validation problems are the caller's fault; everything else is the
    // upstream fund-holding server's fault.
    const message = String(error?.message || 'Real fund settlement failed');
    const isValidation = /required|must be|mismatch/i.test(message);
    res.status(isValidation ? 400 : 502).json({
      ok: false,
      error: isValidation ? 'VALIDATION_ERROR' : 'GLOBAL_SERVER_CALL_FAILED',
      message,
    });
  }
});

// ── Reports ──────────────────────────────────────────────────────────────────

router.get('/reports/reserve', async (req: Request, res: Response) => {
  try {
    const report = await reserveReportService.build({
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      currency: req.query.currency ? String(req.query.currency) : undefined,
      merchantId: req.query.merchantId ? String(req.query.merchantId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendFormatted(res, req.query.format as string, {
      json: report,
      csv: () => reserveReportService.toCsv(report),
      html: () => reserveReportService.toPrintable(report),
      filename: `reserve-report-${Date.now()}`,
    });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/reports/settlement', async (req: Request, res: Response) => {
  try {
    const channelRaw = req.query.channel ? String(req.query.channel).toUpperCase() : undefined;
    const channel = channelRaw === 'VAULT' || channelRaw === 'POS' || channelRaw === 'CARD' ? channelRaw : undefined;
    const report = await settlementReportService.build({
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      currency: req.query.currency ? String(req.query.currency) : undefined,
      merchantId: req.query.merchantId ? String(req.query.merchantId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      channel,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendFormatted(res, req.query.format as string, {
      json: report,
      csv: () => settlementReportService.toCsv(report),
      html: () => settlementReportService.toPrintable(report),
      filename: `settlement-report-${Date.now()}`,
    });
  } catch (error: any) {
    fail(res, error);
  }
});

router.get('/reports/emi-account-statement', async (req: Request, res: Response) => {
  try {
    const merchantId = String(req.query.merchantId || req.query.accountId || '').trim();
    if (!merchantId) {
      res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'merchantId is required' });
      return;
    }
    const statement = await emiAccountStatementService.build({
      merchantId,
      currency: String(req.query.currency || 'USD'),
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendFormatted(res, req.query.format as string, {
      json: statement,
      csv: () => emiAccountStatementService.toCsv(statement),
      html: () => emiAccountStatementService.toPrintable(statement),
      filename: `emi-statement-${merchantId}-${statement.account.currency}-${Date.now()}`,
    });
  } catch (error: any) {
    fail(res, error);
  }
});

// ── Engine run history ───────────────────────────────────────────────────────

router.get('/engine-runs', async (req: Request, res: Response) => {
  try {
    await ensureTreasuryTables();
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const engine = req.query.engine ? String(req.query.engine) : null;
    const params: unknown[] = [];
    let sql = 'SELECT * FROM treasury_engine_runs';
    if (engine) {
      sql += ' WHERE engine = ?';
      params.push(engine);
    }
    sql += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);
    const res2 = await db.query(sql, params);
    res.json({ ok: true, data: res2.rows || [] });
  } catch (error: any) {
    fail(res, error);
  }
});

export default router;
