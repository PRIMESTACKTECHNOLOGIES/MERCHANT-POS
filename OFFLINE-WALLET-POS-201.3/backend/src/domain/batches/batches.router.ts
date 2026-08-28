import { Router } from "express";
import { batchesController } from "./batches.controller";

const router = Router();

// List all batches
router.get("/", batchesController.list);

// Get all transactions
router.get("/transactions", batchesController.getTransactions);

// Verify merchant credentials
router.post("/verify", batchesController.verifyCredentials);

// Process offline batch upload from POS (Legacy)
router.post("/api/payment2013/batch", batchesController.processOfflineBatch);

// Protocol 201.3 CARD batch
router.post("/pos/201.3/offline-batch", batchesController.processOfflineBatch);

// Protocol 201.3 MYFATOORAH batch (reuses same controller for now)
router.post("/pos/201.3/myfatoorah-batch", batchesController.processOfflineBatch);

// Redeem payment code
router.post("/api/payment2013/redeem", batchesController.redeemPaymentCode);

// Legacy Braintree cashout
router.post("/api/payment2013/cashout", batchesController.cashoutBraintree);

// Health check for POS
router.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export { router as batchesRouter };
