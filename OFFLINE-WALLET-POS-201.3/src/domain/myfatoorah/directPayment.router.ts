import { Router } from "express";
import { settleTransaction } from "./directPayment.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

// Endpoint for POS to sync encrypted card data and settle payment
router.post("/settle", authenticateToken, settleTransaction);

export default router;
