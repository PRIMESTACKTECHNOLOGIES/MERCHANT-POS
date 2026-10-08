import { Router } from "express";
import { transactionsController } from "./transactions.controller";
import { batchesController } from "../batches/batches.controller";

const router = Router();

// Mounted at /merchant/v1/transactions and /api/transactions
// "/" = GET /merchant/v1/transactions
router.get("/", transactionsController.list.bind(transactionsController));
router.get("/transactions", transactionsController.list.bind(transactionsController)); // alias

// Single transaction by ID — must come before /:id/auth-code
router.patch("/:transactionId/auth-code", batchesController.setTransactionAuthCode.bind(batchesController));
router.get("/:id", transactionsController.get.bind(transactionsController));
router.get("/transactions/:id", transactionsController.get.bind(transactionsController)); // alias

export { router as transactionsRouter };
