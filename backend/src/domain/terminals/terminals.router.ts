import { Router } from "express";
import { terminalsController } from "./terminals.controller";

const router = Router();

// NOTE: terminal/register and terminal/verify are mounted as PUBLIC routes
// directly in app.ts (before authenticateToken). Do NOT add them here.

// Mounted at /merchant/v1/terminals — so "/" = GET /merchant/v1/terminals
router.get("/", terminalsController.list.bind(terminalsController));
router.get("/terminals", terminalsController.list.bind(terminalsController)); // alias

router.post("/terminal/regenerate-secret", terminalsController.regenerateSecret.bind(terminalsController));
router.delete("/terminal/:merchantId/:terminalId", terminalsController.delete.bind(terminalsController));

export { router as terminalsRouter };
