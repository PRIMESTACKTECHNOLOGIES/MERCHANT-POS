import { Router } from "express";
import { transactionsController } from "./transactions.controller";

const router = Router();

router.get("/transactions", transactionsController.list.bind(transactionsController));

export { router as transactionsRouter };
