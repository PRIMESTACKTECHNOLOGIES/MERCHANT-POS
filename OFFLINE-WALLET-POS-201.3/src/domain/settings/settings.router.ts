import { Router } from "express";
import { settingsController } from "./settings.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

// Assuming settings are protected
router.get("/v1/settings", authenticateToken, settingsController.get.bind(settingsController));
router.post("/v1/settings", authenticateToken, settingsController.update.bind(settingsController));

export { router as settingsRouter };
