// src/domain/myfatoorah/myfatoorah2013.router.ts
import { Router } from "express";
import { myfatoorah2013Controller } from "./myfatoorah2013.controller";

const router = Router();

// Protocol 201.3 batch upload for MyFatoorah (payment links)
router.post("/myfatoorah-batch", myfatoorah2013Controller.uploadMyFatoorahBatch.bind(myfatoorah2013Controller));

// Transaction status
router.get("/transaction/:localTxnId/status", myfatoorah2013Controller.getTransactionStatus.bind(myfatoorah2013Controller));

// Batch status
router.get("/batch/:batchId/status", myfatoorah2013Controller.getBatchStatus.bind(myfatoorah2013Controller));

// Webhook from MyFatoorah
router.post("/webhook", myfatoorah2013Controller.handleWebhook.bind(myfatoorah2013Controller));

export default router;
