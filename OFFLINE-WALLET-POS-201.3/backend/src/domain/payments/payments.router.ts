import { Router } from "express";
import { paymentsController } from "./payments.controller";
import { settleTransaction } from "./paymentController";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

router.post("/payments/charge", authenticateToken, paymentsController.charge.bind(paymentsController));
router.post("/payments/read-acr122u", authenticateToken, paymentsController.readAcr122uCard.bind(paymentsController));
router.get("/payments/read-acr122u/status", authenticateToken, paymentsController.getAcr122uStatus.bind(paymentsController));
router.post("/settle", settleTransaction);

export { router as paymentsRouter };
