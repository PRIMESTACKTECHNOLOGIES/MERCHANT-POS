// src/domain/pos2013/pos2013Offline.router.ts 
 import { Router } from "express"; 
import { pos2013OfflineController } from "./pos2013Offline.controller"; 
import { pos2013TerminalsController } from "./pos2013Terminals.controller";
import { merchantAuth } from "../../middleware/auth";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router(); 

// --- POS Terminal Endpoints (HMAC Protected) ---
router.post( 
  "/v1/pos/201.3/offline-batch", 
  pos2013OfflineController.uploadOfflineBatch.bind(pos2013OfflineController) 
); 

// --- POS Terminal Verification (Public) ---
router.post(
  "/v1/terminal/verify",
  pos2013TerminalsController.verifyTerminal.bind(pos2013TerminalsController)
);

// --- Dashboard Endpoints (JWT Protected) ---
router.get(
  "/v1/pos/201.3/batches",
  authenticateToken,
  pos2013OfflineController.getBatches.bind(pos2013OfflineController)
);

router.get(
  "/v1/pos/201.3/batches/:batchId",
  authenticateToken,
  pos2013OfflineController.getBatchDetails.bind(pos2013OfflineController)
);

router.post(
  "/v1/pos/201.3/batches/:batchId/settle",
  authenticateToken,
  pos2013OfflineController.settleBatch.bind(pos2013OfflineController)
);

router.delete(
  "/v1/pos/201.3/batches/:batchId",
  authenticateToken,
  pos2013OfflineController.deleteBatch.bind(pos2013OfflineController)
);

router.get(
  "/v1/terminals",
  authenticateToken,
  pos2013TerminalsController.getTerminals.bind(pos2013TerminalsController)
);

router.get(
  "/v1/transactions",
  authenticateToken,
  pos2013TerminalsController.getAllTransactions.bind(pos2013TerminalsController)
);

router.post(
  "/v1/terminal/register",
  authenticateToken,
  pos2013TerminalsController.registerTerminal.bind(pos2013TerminalsController)
);

router.post(
  "/v1/terminal/regenerate-secret",
  authenticateToken,
  pos2013TerminalsController.regenerateSecret.bind(pos2013TerminalsController)
);

router.post(
  "/v1/terminal/force-reboot",
  authenticateToken,
  pos2013TerminalsController.forceReboot.bind(pos2013TerminalsController)
);

// --- Real-time Payment Endpoints ---
router.post(
  "/v1/payments/charge",
  authenticateToken,
  pos2013OfflineController.chargePayment.bind(pos2013OfflineController)
);

export { router as pos2013OfflineRouter };
