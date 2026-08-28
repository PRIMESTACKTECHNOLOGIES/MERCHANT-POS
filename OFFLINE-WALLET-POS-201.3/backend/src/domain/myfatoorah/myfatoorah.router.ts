import { Router } from "express";
import { myFatoorahController } from "./myfatoorah.controller";

const router = Router();

// MyFatoorah webhook endpoint (called by MyFatoorah when payment status changes)
router.post("/myfatoorah/webhook", myFatoorahController.webhook.bind(myFatoorahController));

// Alternative: some providers use GET for webhooks
router.get("/myfatoorah/webhook", myFatoorahController.webhookGet.bind(myFatoorahController));

// Execute Payment endpoint (LIVE Mode)
router.post("/pay", myFatoorahController.executePayment.bind(myFatoorahController));

export { router as myFatoorahRouter };
