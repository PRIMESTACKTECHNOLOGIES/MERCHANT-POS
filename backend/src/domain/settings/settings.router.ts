import { Router } from "express";
import { settingsController } from "./settings.controller";

const router = Router();

router.get("/settings", settingsController.get.bind(settingsController));
router.post("/settings", settingsController.update.bind(settingsController));

export { router as settingsRouter };
