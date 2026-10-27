import { Router } from "express";
import { transactionsController } from "./transactions.controller";

const router = Router();

router.get("/transactions", transactionsController.list.bind(transactionsController));
router.get("/transactions/:id", transactionsController.get.bind(transactionsController));

export { router as transactionsRouter };
