import { Router, Request, Response } from "express";
import { recoveryController } from "./recovery.controller";

const router = Router();

router.post("/recovery/scan", recoveryController.scan.bind(recoveryController));
router.post("/scan", recoveryController.scan.bind(recoveryController));

router.get("/recovery/audits", recoveryController.listAudits.bind(recoveryController));
router.get("/audits", recoveryController.listAudits.bind(recoveryController));

router.post("/recovery/classify/:txnId?", recoveryController.classify.bind(recoveryController));
router.post("/classify/:txnId?", recoveryController.classify.bind(recoveryController));

router.post("/recovery/apply/:auditId?", recoveryController.apply.bind(recoveryController));
router.post("/apply/:auditId?", recoveryController.apply.bind(recoveryController));
router.post("/recovery/apply", recoveryController.apply.bind(recoveryController));

router.post("/recovery/cron", recoveryController.cronRun.bind(recoveryController));
router.post("/cron", recoveryController.cronRun.bind(recoveryController));

export { router as recoveryRouter };
