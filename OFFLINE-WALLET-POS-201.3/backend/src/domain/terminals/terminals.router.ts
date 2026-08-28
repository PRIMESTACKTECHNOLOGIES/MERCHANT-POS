import { Router } from "express";
import { terminalsController } from "./terminals.controller";

const router = Router();

// GET test endpoint for connectivity check
router.get("/terminal/verify", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Terminal verify endpoint is reachable. Use POST to verify credentials.",
    expectedBody: {
      merchantId: "MRC-1001",
      terminalId: "T2013-001",
      secretKey: "secret_term_001"
    }
  });
});

router.post("/terminal/register", terminalsController.register.bind(terminalsController));
router.post("/terminal/regenerate-secret", terminalsController.regenerateSecret.bind(terminalsController));
router.post("/terminal/verify", terminalsController.verify.bind(terminalsController));
router.get("/terminals", terminalsController.list.bind(terminalsController));

export { router as terminalsRouter };
