import { Router } from "express";
import { merchantsController } from "./merchants.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

// Mounted at /api/merchants and /merchant/v1/merchants
router.get("/", authenticateToken, merchantsController.list.bind(merchantsController));
router.get("/:merchantId", authenticateToken, merchantsController.get.bind(merchantsController));
router.delete("/:merchantId", authenticateToken, merchantsController.remove.bind(merchantsController));

export { router as merchantsRouter };
