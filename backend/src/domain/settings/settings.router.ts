import { Router } from "express";
import { settingsController } from "./settings.controller";

const router = Router();

// Mounted at /merchant/v1/settings and /api/settings
// so routes here use "/" not "/settings"
router.get("/", settingsController.get.bind(settingsController));
router.post("/", settingsController.update.bind(settingsController));

// Also keep /settings alias for any direct callers
router.get("/settings", settingsController.get.bind(settingsController));
router.post("/settings", settingsController.update.bind(settingsController));

export { router as settingsRouter };
