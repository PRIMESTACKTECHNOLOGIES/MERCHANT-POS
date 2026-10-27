import { Router } from "express";
import { terminalsController } from "./terminals.controller";

const router = Router();

// NOTE: terminal/register and terminal/verify are mounted as PUBLIC routes
// directly in app.ts (before authenticateToken). Do NOT add them here.

router.post("/terminal/regenerate-secret", terminalsController.regenerateSecret.bind(terminalsController));
router.delete("/terminal/:merchantId/:terminalId", terminalsController.delete.bind(terminalsController));
router.get("/terminals", terminalsController.list.bind(terminalsController));

export { router as terminalsRouter };
