import { Router } from "express";
import { paymentsController } from "./payments.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

// ─── ACR122U card read for contactless/contact reader ─────────────────────────
router.post("/read-acr122u", paymentsController.readAcr122uCard.bind(paymentsController));
router.get("/read-acr122u/status", paymentsController.getAcr122uStatus.bind(paymentsController));
router.get("/status", paymentsController.getAcr122uStatus.bind(paymentsController));
// ─── Processor enablement / configuration diagnostics ─────────────────────────
router.get("/processor-status", paymentsController.getProcessorStatus.bind(paymentsController));
router.get("/payments/processor-status", paymentsController.getProcessorStatus.bind(paymentsController));
// Backward-compatible aliases for older callers
router.post("/payments/read-acr122u", paymentsController.readAcr122uCard.bind(paymentsController));
router.get("/payments/read-acr122u/status", paymentsController.getAcr122uStatus.bind(paymentsController));
router.post("/payments/decide", paymentsController.decide.bind(paymentsController));
// Canonical charge path when this router is mounted at /merchant/v1/payments.
router.post("/charge", paymentsController.charge.bind(paymentsController));
// Backward-compatible alias for clients using the historical double prefix.
router.post("/payments/charge", paymentsController.charge.bind(paymentsController));
router.post("/settlements/capture", authenticateToken, paymentsController.captureSettlement.bind(paymentsController));
// Module-9 / offline PIN upload endpoint (POS devices)
router.post("/offline-pin", paymentsController.handleOfflinePinSale.bind(paymentsController));
// Backward compatible alias
router.post("/payments/offline-pin", paymentsController.handleOfflinePinSale.bind(paymentsController));
// Transak payment processing endpoints
router.post("/transak/create-order", paymentsController.createTransakOrder.bind(paymentsController));
router.get("/transak/order/:orderId", paymentsController.getTransakOrderStatus.bind(paymentsController));
router.post("/transak/webhook", paymentsController.handleTransakWebhook.bind(paymentsController));
// Transak headless card endpoints
router.post("/transak/transaction-session", paymentsController.createTransactionSession.bind(paymentsController));
router.get("/transak/transaction-request-status/:requestId", paymentsController.getTransactionRequestStatus.bind(paymentsController));

// ─── Inbound Transaction Registration & Fund Verification (101.1 DTC flow) ──
router.get("/inbound", authenticateToken, paymentsController.listInboundRegistrations.bind(paymentsController));
router.get("/inbound/lookup", authenticateToken, paymentsController.findInboundByAuthCode.bind(paymentsController));
router.get("/inbound/:id", authenticateToken, paymentsController.getInboundRegistration.bind(paymentsController));
router.post("/inbound", authenticateToken, paymentsController.registerInboundTransaction.bind(paymentsController));
router.post("/inbound/:id/link-card", authenticateToken, paymentsController.linkInboundCardDetails.bind(paymentsController));
router.post("/inbound/:id/verify-funds", authenticateToken, paymentsController.verifyInboundFunds.bind(paymentsController));

export { router as paymentsRouter };
