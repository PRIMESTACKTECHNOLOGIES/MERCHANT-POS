import { Request, Response } from "express";
import { batchesService } from "./batches.service";
import { db } from "../../config/db";

export class BatchesController {
  /**
   * List all batches (optionally filtered by merchant)
   */
  async list(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      
      // If merchant ID provided, filter by it
      const batches = await batchesService.getBatches(merchantId);
      res.json(batches);
    } catch (e: any) {
      console.error('Error listing batches:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Process offline batch upload from POS device
   */
  async processOfflineBatch(req: Request, res: Response) {
    try {
      // Get credentials from headers
      const merchantId = req.headers['x-merchant-id'] as string || req.body.merchantId;
      const terminalId = req.headers['x-terminal-id'] as string || req.body.terminalId;
      // Accept signature from header OR body (Android app sends it in body)
      const signature = (req.headers['x-signature'] as string) || req.body.signature;
      const batchData = req.body;

      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      if (!terminalId) {
        return res.status(401).json({ error: 'Missing terminal ID' });
      }

      console.log('[Protocol 201.3] Batch upload received:', {
        merchantId,
        terminalId,
        batchId: batchData.batchId,
        txnCount: batchData.transactions?.length || 0,
        hasSignature: !!signature
      });

      // Ensure signature is set in batchData
      batchData.signature = signature || batchData.signature;

      const result = await batchesService.processOfflineBatch(merchantId, terminalId, batchData);
      
      console.log('[Protocol 201.3] Batch processed successfully:', {
        batchId: result.batchId,
        settlementCode: result.settlementCode,
        txnCount: result.txnCount
      });

      res.json(result);
    } catch (e: any) {
      console.error('Error processing offline batch:', e);
      res.status(400).json({ error: e.message });
    }
  }

  /**
   * Get transactions list
   */
  async getTransactions(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const transactions = await batchesService.getTransactions(merchantId, limit);
      res.json(transactions);
    } catch (e: any) {
      console.error('Error fetching transactions:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Verify merchant credentials
   */
  async verifyCredentials(req: Request, res: Response) {
    try {
      const { merchantId, secretKey } = req.body;

      if (!merchantId || !secretKey) {
        return res.status(400).json({ 
          valid: false, 
          error: 'Missing merchant ID or secret key' 
        });
      }

      // Get merchant settings from database
      const result = await db.query(
        'SELECT merchant_id, api_key FROM merchant_settings WHERE merchant_id = ?',
        [merchantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          valid: false, 
          error: 'Merchant not found' 
        });
      }

      const merchant = result.rows[0];

      // Verify secret key
      if (merchant.api_key !== secretKey) {
        return res.status(401).json({ 
          valid: false, 
          error: 'Invalid secret key' 
        });
      }

      res.json({ 
        valid: true, 
        merchantId: merchant.merchant_id,
        message: 'Credentials verified successfully'
      });
    } catch (e: any) {
      console.error('Error verifying credentials:', e);
      res.status(500).json({ valid: false, error: e.message });
    }
  }

  async syncOfflineFunds(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string || req.body.merchantId;
      const terminalId = req.headers['x-terminal-id'] as string || req.body.terminalId;

      if (!merchantId) {
        return res.status(400).json({ error: 'merchantId required' });
      }

      const result = await batchesService.syncOfflineFundsReceipts(merchantId, terminalId);
      res.json(result);
    } catch (e: any) {
      console.error('Error syncing offline receipts:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Redeem a payment code (Live transaction)
   */
  async redeemPaymentCode(req: Request, res: Response) {
    try {
      const { code, amount, merchantId } = req.body;
      
      if (!code || !amount) {
        return res.status(400).json({ error: 'Missing code or amount' });
      }

      const result = await batchesService.redeemPaymentCode({
        code,
        amount,
        merchantId: merchantId || req.headers['x-merchant-id'] as string || 'MRC-1001'
      });

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (e: any) {
      console.error('Error redeeming code:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Legacy Braintree cashout (deprecated)
   */
  async cashoutBraintree(req: Request, res: Response) {
    try {
      const { batches } = req.body;
      const merchantId = req.headers['x-merchant-id'] as string || 'MRC-1001';
      
      console.warn(`[Deprecated] Braintree cashout called by: ${merchantId}`);
      
      const result = await batchesService.cashoutBraintree(merchantId, batches);
      res.json(result);
    } catch (e: any) {
      console.error('Error in cashout:', e);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * Reconcile batch transactions - Compare offline vs online
   * POST /reconcile/batch
   * Body: { batchId?, terminalId?, startDate?, endDate?, includeSettled? }
   */
  async reconcileBatch(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { batchId, terminalId, startDate, endDate, includeSettled } = req.body || {};

      const { reconcileBatch } = await import('./reconciliation.service');

      const report = await reconcileBatch({
        merchantId,
        batchId,
        terminalId,
        startDate,
        endDate,
        includeSettled: includeSettled || false
      });

      console.log(`[Reconciliation] Report generated: ${report.reconciliationId}`);

      res.json({
        success: true,
        reportId: report.reconciliationId,
        totalDiscrepancies: report.totalDiscrepancies,
        criticalIssues: report.criticalIssues,
        warnings: report.warnings,
        summary: report.summary
      });
    } catch (e: any) {
      console.error('Error reconciling batch:', e);
      res.status(500).json({ 
        success: false, 
        error: e.message 
      });
    }
  }

  /**
   * Get reconciliation report details
   * GET /reconcile/report/:reportId
   */
  async getReconciliationReport(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const { reportId } = req.params;
      if (!reportId) {
        return res.status(400).json({ error: 'reportId is required' });
      }

      const { getReconciliationReport } = await import('./reconciliation.service');

      const report = await getReconciliationReport(reportId);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      // Verify merchant access
      if (report.merchantId !== merchantId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      res.json({
        success: true,
        report
      });
    } catch (e: any) {
      console.error('Error fetching reconciliation report:', e);
      res.status(500).json({ 
        success: false, 
        error: e.message 
      });
    }
  }

  /**
   * List reconciliation reports for merchant
   * GET /reconcile/reports
   */
  async listReconciliationReports(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      if (!merchantId) {
        return res.status(401).json({ error: 'Missing merchant ID' });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const offset = parseInt(req.query.offset as string) || 0;

      const { listReconciliationReports } = await import('./reconciliation.service');

      const result = await listReconciliationReports(merchantId, limit, offset);

      res.json({
        success: true,
        ...result
      });
    } catch (e: any) {
      console.error('Error listing reconciliation reports:', e);
      res.status(500).json({
        success: false,
        error: e.message
      });
    }
  }

  async getBatchDetails(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      const batchId = req.params.batchId || req.body?.batchId;
      if (!batchId) return res.status(400).json({ error: 'batchId required' });
      const details = await batchesService.getBatchDetails(batchId, merchantId);
      if (!details) return res.status(404).json({ error: 'Batch not found' });
      res.json({ success: true, ...details });
    } catch (e: any) {
      console.error('getBatchDetails error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async closeBatch(req: Request, res: Response) {
    try {
      const merchantId = (req.headers['x-merchant-id'] as string) || req.body.merchantId || 'MRC-1001';
      const terminalId = (req.headers['x-terminal-id'] as string) || req.body.terminalId;
      const { batchId, includeGhost, force, minAmountMinor } = req.body || {};

      const result = await batchesService.closeBatch({
        merchantId,
        terminalId: terminalId || undefined,
        batchId: batchId || undefined,
        includeGhost: includeGhost === true,
        force: force === true,
        minAmountMinor: minAmountMinor != null ? Number(minAmountMinor) : undefined,
      });
      res.json({ success: true, closed: true, ...result });
    } catch (e: any) {
      console.error('closeBatch error:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }

  async downloadBatch(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      const batchId = req.params.batchId;
      const formatRaw = (req.params.format || 'json').toLowerCase();
      const includeGhost = req.query.includeGhost === '1' || req.query.includeGhost === 'true';
      if (!['json', 'csv', 'nacha'].includes(formatRaw)) {
        return res.status(400).json({ error: 'format must be one of: json, csv, nacha' });
      }
      const format = formatRaw as any;
      const result = await batchesService.exportBatch(batchId, format, {
        merchantId,
        includeGhost,
      });
      const asAttachment = req.query.download !== '0' && req.query.preview !== '1';
      const cd = asAttachment
        ? `attachment; filename="${encodeURIComponent(result.filename)}"`
        : `inline; filename="${encodeURIComponent(result.filename)}"`;
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', cd);
      res.setHeader('X-Batch-Format', result.format);
      res.setHeader('X-Batch-Signature', result.signature);
      res.setHeader('X-Batch-Hash10', result.controlEntryHash || result.controlEntryHash);
      res.setHeader('X-Batch-TxnCount', String(result.txnCount));
      res.setHeader('X-Batch-GhostExcluded', String(result.ghostExcluded));
      res.setHeader('X-Batch-TotalDebitMinor', String(result.totalDebitMinor));
      res.setHeader('X-Batch-TotalCreditMinor', String(result.totalCreditMinor));
      res.setHeader('Content-Length', String(result.byteLength));
      res.status(200).send(result.body);
    } catch (e: any) {
      console.error('downloadBatch error:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }

  async previewBatchExport(req: Request, res: Response) {
    try {
      const merchantId = req.headers['x-merchant-id'] as string;
      const batchId = req.params.batchId;
      const formatRaw = (req.query.format || 'json').toString().toLowerCase();
      const includeGhost = req.query.includeGhost === '1' || req.query.includeGhost === 'true';
      if (!['json', 'csv', 'nacha'].includes(formatRaw)) {
        return res.status(400).json({ error: 'format must be one of: json, csv, nacha' });
      }
      const format = formatRaw as any;
      const result = await batchesService.exportBatch(batchId, format, {
        merchantId,
        includeGhost,
      });
      res.json({
        success: true,
        filename: result.filename,
        format: result.format,
        contentType: result.contentType,
        byteLength: result.byteLength,
        txnCount: result.txnCount,
        ghostExcluded: result.ghostExcluded,
        totalDebitMinor: result.totalDebitMinor,
        totalCreditMinor: result.totalCreditMinor,
        entryHash10: result.controlEntryHash,
        signature: result.signature,
        canonicalPayload: result.canonicalPayload,
        generatedAt: result.generatedAt,
        bodyPreview: result.body.slice(0, 500),
      });
    } catch (e: any) {
      console.error('previewBatchExport error:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }

  async markBatchUploaded(req: Request, res: Response) {
    try {
      const merchantId = (req.headers['x-merchant-id'] as string) || req.body.merchantId;
      const batchId = req.params.batchId || req.body.batchId;
      if (!batchId) return res.status(400).json({ error: 'batchId required' });
      const { externalRef, processor, uploadTimestamp, status } = req.body || {};
      const result = await batchesService.markBatchUploaded({
        batchId,
        merchantId,
        externalRef,
        processor,
        uploadTimestamp,
        status,
      });
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error('markBatchUploaded error:', e);
      res.status(400).json({ success: false, error: e.message });
    }
  }

  async autoCloseCandidates(req: Request, res: Response) {
    try {
      const merchantId = (req.headers['x-merchant-id'] as string) || req.body.merchantId || 'MRC-1001';
      const terminalId = (req.headers['x-terminal-id'] as string) || req.query.terminalId || req.body?.terminalId;
      const maxAgeHours = Number(req.query.maxAgeHours || req.body?.maxAgeHours) || 24;
      const minTxnCount = Number(req.query.minTxnCount || req.body?.minTxnCount) || 50;
      const minAmountMinor = Number(req.query.minAmountMinor || req.body?.minAmountMinor) || 100000;
      const closeNow = req.body?.closeNow === true || req.query.closeNow === '1';

      const list = await batchesService.autoCloseCandidates(merchantId, {
        terminalId: terminalId || undefined,
        maxAgeHours,
        minTxnCount,
        minAmountMinor,
      });

      if (!closeNow) {
        return res.json({ success: true, thresholds: { maxAgeHours, minTxnCount, minAmountMinor }, candidates: list });
      }

      const closed: any[] = [];
      const skipped: any[] = [];
      for (const c of list) {
        if (!c.thresholdHit) { skipped.push(c); continue; }
        try {
          const r = await batchesService.closeBatch({ merchantId, terminalId: c.terminalId, force: false });
          closed.push({ terminalId: c.terminalId, batch: r?.batch?.batch_id, txnCount: r?.txnCount || 0 });
        } catch (err: any) {
          skipped.push({ terminalId: c.terminalId, error: err.message });
        }
      }
      res.json({
        success: true,
        thresholds: { maxAgeHours, minTxnCount, minAmountMinor },
        candidates: list,
        closed,
        skipped,
      });
    } catch (e: any) {
      console.error('autoCloseCandidates error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }

  /**
   * Retry processor capture for failed / stuck transactions.
   * POST /batches/retry-captures
   * Body: { terminalId?, maxRetries? }
   * Triggers: when processor was offline during initial sync → retries cardholder deduction.
   */
  async retryFailedCaptures(req: Request, res: Response) {
    try {
      const merchantId = (req.headers['x-merchant-id'] as string) || req.body.merchantId || 'MRC-1001';
      const terminalId = (req.headers['x-terminal-id'] as string) || req.body?.terminalId;
      const maxRetries = Number(req.body?.maxRetries || req.query?.maxRetries || 10);
      const result = await batchesService.retryFailedCaptures({ merchantId, terminalId, maxRetries });
      res.json({ ...result });
    } catch (e: any) {
      console.error('retryFailedCaptures error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  }
}

export const batchesController = new BatchesController();
