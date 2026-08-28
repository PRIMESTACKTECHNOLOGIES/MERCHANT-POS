import { Request, Response } from "express";
import {
  recoveryEngineService,
  ensureRecoverySchema,
  detectRecoveryAction,
  classifyMismatch,
  type RecoveryType,
} from "./recovery-engine.service";
import { P2013, explain } from '../pos2013/protocol-2013-codes';

export class RecoveryController {

  async scan(req: Request, res: Response) {
    const t0 = Date.now();
    try {
      const merchantId =
        (req.headers['x-merchant-id'] as string) ||
        (req as any).user?.merchantId ||
        req.body?.merchantId ||
        req.query?.merchantId;
      const startDate = req.body?.startDate || req.query?.startDate || undefined;
      const endDate = req.body?.endDate || req.query?.endDate || undefined;
      const limit = Math.min(Number(req.body?.limit || req.query?.limit || 2000), 10000);
      const onlyMismatches =
        req.body?.onlyMismatches !== undefined
          ? Boolean(req.body.onlyMismatches)
          : req.query?.onlyMismatches !== undefined
            ? String(req.query.onlyMismatches).toLowerCase() !== 'false'
            : true;
      const report = await recoveryEngineService.scanMismatches({
        merchantId: merchantId ? String(merchantId) : undefined,
        startDate,
        endDate,
        limit,
        onlyMismatches,
      });
      const took = Date.now() - t0;
      console.log(`[P2013 | ${P2013.RECONCILIATION_COMPLETED}] scan mismatches=${report.mismatchesCount} scanned=${report.scannedCount} critical=${report.criticalCount} tookMs=${took} ${explain(P2013.RECONCILIATION_COMPLETED)}`);
      res.json({
        success: true,
        protocolLastCode: P2013.RECONCILIATION_COMPLETED,
        protocolLastMeaning: explain(P2013.RECONCILIATION_COMPLETED),
        tookMs: took,
        ...report,
      });
    } catch (e: any) {
      console.error(`[P2013 | ${P2013.RECONCILIATION_FAILED}] scan error:`, e);
      res.status(500).json({
        success: false,
        protocolLastCode: P2013.RECONCILIATION_FAILED,
        protocolLastMeaning: explain(P2013.RECONCILIATION_FAILED),
        error: e?.message || String(e),
        tookMs: Date.now() - t0,
      });
    }
  }

  async listAudits(req: Request, res: Response) {
    try {
      const merchantId =
        (req.headers['x-merchant-id'] as string) ||
        (req as any).user?.merchantId ||
        req.query?.merchantId;
      const result = await recoveryEngineService.listRecoveryAudits({
        merchantId: merchantId ? String(merchantId) : undefined,
        txnId: (req.query?.txnId as string) || undefined,
        status: (req.query?.status as any) || undefined,
        mismatchType: (req.query?.mismatchType as any) || undefined,
        limit: Number(req.query?.limit || 100),
        offset: Number(req.query?.offset || 0),
      });
      res.json({ success: true, protocolLastCode: P2013.RECONCILIATION_STARTED, protocolLastMeaning: explain(P2013.RECONCILIATION_STARTED), ...result });
    } catch (e: any) {
      console.error('[Recovery] list audits failed:', e);
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  }

  async classify(req: Request, res: Response) {
    try {
      const txnId = req.params?.txnId || req.body?.txnId;
      if (!txnId) {
        res.status(400).json({ success: false, error: 'txnId required (param or body)' });
        return;
      }
      await ensureRecoverySchema();
      const { db } = await import("../../config/db");
      const row = (await db.query(`SELECT * FROM pos2013_transactions WHERE id = ? LIMIT 1`, [String(txnId)])).rows?.[0];
      if (!row) {
        res.status(404).json({ success: false, error: `No txn with id=${txnId}` });
        return;
      }
      const snap = await recoveryEngineService.buildTransactionSnapshot(row);
      const classification = classifyMismatch(snap);
      const action = detectRecoveryAction(snap);
      res.json({
        success: true,
        protocolLastCode: P2013.RECONCILIATION_REPORTED,
        protocolLastMeaning: explain(P2013.RECONCILIATION_REPORTED),
        snapshot: snap,
        classification,
        detectRecoveryAction: action,
      });
    } catch (e: any) {
      console.error('[Recovery] classify failed:', e);
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  }

  async apply(req: Request, res: Response) {
    const t0 = Date.now();
    try {
      const auditId = req.params?.auditId || req.body?.auditId;
      const txnId = req.body?.txnId || undefined;
      const recoveryType = (req.body?.recoveryType as RecoveryType) || undefined;
      const operatorNotes = (req.body?.operatorNotes as string) || undefined;
      const force = Boolean(req.body?.force);
      if (!auditId && !txnId) {
        res.status(400).json({ success: false, error: 'Either auditId (param) or txnId (body) required' });
        return;
      }
      const result = await recoveryEngineService.applyRecoveryAction({
        auditId: auditId ? String(auditId) : undefined,
        txnId: txnId ? String(txnId) : undefined,
        recoveryType,
        operatorNotes,
        force,
      });
      res.json({
        ...result,
        success: result.success,
        tookMs: Date.now() - t0,
        protocolLastCode: result.status === 'APPLIED_OK' ? P2013.WALLET_CREDIT_CREDITED :
                          result.status === 'REVIEW_REQUIRED' ? P2013.SETTLEMENT_RECONCILE_STARTED :
                          P2013.WALLET_CREDIT_FAILED,
        protocolLastMeaning: explain(
          result.status === 'APPLIED_OK' ? P2013.WALLET_CREDIT_CREDITED :
          result.status === 'REVIEW_REQUIRED' ? P2013.SETTLEMENT_RECONCILE_STARTED :
          P2013.WALLET_CREDIT_FAILED
        ),
      });
    } catch (e: any) {
      console.error(`[P2013 | ${P2013.RECONCILIATION_FAILED}] apply failed:`, e);
      res.status(500).json({
        success: false,
        protocolLastCode: P2013.RECONCILIATION_FAILED,
        protocolLastMeaning: explain(P2013.RECONCILIATION_FAILED),
        error: e?.message || String(e),
        tookMs: Date.now() - t0,
      });
    }
  }

  async cronRun(req: Request, res: Response) {
    const t0 = Date.now();
    try {
      const merchantId = (req.headers['x-merchant-id'] as string) || req.body?.merchantId || req.query?.merchantId;
      const result = await recoveryEngineService.cronSweep(merchantId ? String(merchantId) : undefined);
      res.json({
        success: true,
        tookMs: Date.now() - t0,
        protocolLastCode: P2013.RECONCILIATION_COMPLETED,
        protocolLastMeaning: explain(P2013.RECONCILIATION_COMPLETED),
        applied: result.applied,
        pending: result.pending,
        totalExposureMinor: result.totalExposureMinor,
        scanId: result.scan.scanId,
        scannedCount: result.scan.scannedCount,
        mismatchesCount: result.scan.mismatchesCount,
      });
    } catch (e: any) {
      console.error(`[Recovery] cronRun failed:`, e);
      res.status(500).json({
        success: false,
        error: e?.message || String(e),
        tookMs: Date.now() - t0,
      });
    }
  }
}

export const recoveryController = new RecoveryController();
