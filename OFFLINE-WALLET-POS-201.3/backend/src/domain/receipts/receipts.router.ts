import { Router } from "express";
import { receiptsController } from "./receipts.controller";

const router = Router();

// Generate receipt for a transaction
router.post("/generate/:transactionId", receiptsController.generate);

// Get all receipts
router.get("/", receiptsController.list);

// Get single receipt
router.get("/:receiptId", receiptsController.getById);

// Print receipt
router.get("/:receiptId/print", receiptsController.print);

export { router as receiptsRouter };
