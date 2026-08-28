// src/domain/myfatoorah/myfatoorah.router.ts
import { Router } from "express";
import { myfatoorahController } from "./myfatoorah.controller";

const router = Router();

// MyFatoorah webhook - called by MyFatoorah when payment is complete
// IMPORTANT: This must be publicly accessible (no auth)
router.post("/webhook", myfatoorahController.handleWebhook.bind(myfatoorahController));

// Callback URL - customer redirected here after payment
router.get("/callback", (req, res) => {
  res.json({ success: true, message: "Payment completed" });
});

// Error URL - customer redirected here if payment fails
router.get("/error", (req, res) => {
  res.json({ success: false, message: "Payment failed or cancelled" });
});

// Protected routes (require authentication)
router.post("/create", myfatoorahController.createPayment.bind(myfatoorahController));
router.get("/status/:invoiceId", myfatoorahController.getPaymentStatus.bind(myfatoorahController));
router.get("/payments", myfatoorahController.getPayments.bind(myfatoorahController));

export default router;
