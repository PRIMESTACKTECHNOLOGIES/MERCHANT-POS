import { Router } from "express";
import { batchesController } from "./batches.controller";

const router = Router();

// List all batches
router.get("/", batchesController.list);
router.get("/batches", batchesController.list);

// Get all transactions
router.get("/transactions", batchesController.getTransactions);
router.patch("/transactions/:transactionId/auth-code", batchesController.setTransactionAuthCode.bind(batchesController));

// Verify merchant credentials
router.post("/verify", batchesController.verifyCredentials);

// Sync locally stored offline funds receipts when the machine is back online
router.post("/sync-offline-funds", batchesController.syncOfflineFunds);

// Process offline batch upload from POS (Legacy)
router.post("/api/payment2013/batch", batchesController.processOfflineBatch);

// Protocol 201.3 CARD batch
router.post("/pos/201.3/offline-batch", batchesController.processOfflineBatch);

// Redeem payment code  
router.post("/api/payment2013/redeem", batchesController.redeemPaymentCode);
// Also handle the /pos/201.3/redeem path used by older frontend versions
router.post("/pos/201.3/redeem", batchesController.redeemPaymentCode);

// Legacy Braintree cashout (deprecated)
router.post("/api/payment2013/cashout", batchesController.cashoutBraintree);
router.post("/merchant/v1/cashout/braintree", batchesController.cashoutBraintree);

// ───────────────────────────────────────────────────────────────────────
// BATCH RECONCILIATION ENDPOINTS
// ───────────────────────────────────────────────────────────────────────

// Reconcile batch transactions (compare offline vs online)
router.post("/reconcile/batch", batchesController.reconcileBatch.bind(batchesController));

// Get reconciliation report details
router.get("/reconcile/report/:reportId", batchesController.getReconciliationReport.bind(batchesController));

// List reconciliation reports for merchant
router.get("/reconcile/reports", batchesController.listReconciliationReports.bind(batchesController));

// Health check for POS
router.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 201.3 Settlement: Batch Close / Export / Download / Upload ─────────
router.get("/:batchId/details", batchesController.getBatchDetails.bind(batchesController));
router.get("/:batchId", batchesController.getBatchDetails.bind(batchesController));
router.post("/close", batchesController.closeBatch.bind(batchesController));
router.post("/:batchId/close", batchesController.closeBatch.bind(batchesController));
router.get("/:batchId/preview", batchesController.previewBatchExport.bind(batchesController));
router.get("/:batchId/download/:format", batchesController.downloadBatch.bind(batchesController));
router.get("/:batchId/download", batchesController.downloadBatch.bind(batchesController));
router.post("/:batchId/uploaded", batchesController.markBatchUploaded.bind(batchesController));
router.post("/:batchId/mark-uploaded", batchesController.markBatchUploaded.bind(batchesController));
router.get("/auto-close/candidates", batchesController.autoCloseCandidates.bind(batchesController));
router.post("/auto-close/run", batchesController.autoCloseCandidates.bind(batchesController));

// ─── Processor capture retry (when processor offline during initial sync) ──
router.post("/retry-captures", batchesController.retryFailedCaptures.bind(batchesController));
router.post("/pos/201.3/retry-captures", batchesController.retryFailedCaptures.bind(batchesController));

export { router as batchesRouter };
