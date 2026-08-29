import { Router } from "express";
import { receiptsController } from "./receipts.controller";

const router = Router();

router.post("/generate/:transactionId", receiptsController.generate);

router.get("/", receiptsController.list);

// Universal invoices/receipts for POS, wallet, crypto, and bank payout transactions.
router.get("/financial", receiptsController.listFinancialDocuments);
router.get("/financial/:documentNumber", receiptsController.getFinancialDocument);

router.get("/:receiptId", receiptsController.getById);

router.get("/:receiptId/print", receiptsController.print);

router.get("/thermal/:transactionId", receiptsController.printThermalByTxn);

export { router as receiptsRouter };
