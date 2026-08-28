// src/domain/batches/batches.router.ts
import { Router } from "express";
import { batchesController } from "./batches.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

// Get all batches
router.get(
  "/v1/batches",
  authenticateToken,
  batchesController.getBatches.bind(batchesController)
);

// Cashout/Settle batches via MyFatoorah
router.post(
  "/v1/cashout/myfatoorah",
  authenticateToken,
  batchesController.cashoutMyFatoorah.bind(batchesController)
);

// Legacy endpoint for backward compatibility
router.post(
  "/v1/cashout/braintree",
  authenticateToken,
  batchesController.cashoutMyFatoorah.bind(batchesController)
);

// Check MyFatoorah connection
router.post(
  "/v1/myfatoorah/check-connection",
  authenticateToken,
  batchesController.checkMyFatoorahConnection.bind(batchesController)
);

// Get settlement status for a batch
router.get(
  "/v1/batches/:batchId/settlement-status",
  authenticateToken,
  batchesController.getSettlementStatus.bind(batchesController)
);

export { router as batchesRouter };
