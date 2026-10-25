import { Router } from "express";
import { customerPortalController } from "./customer-portal.controller";
import { authenticateCustomer } from "../../middleware/customerAuth.middleware";

const router = Router();
const c = customerPortalController;

// Every route below is scoped to the authenticated customer (req.customer.id).
router.use(authenticateCustomer);

router.get("/overview", (req, res) => c.overview(req, res));
router.get("/profile", (req, res) => c.getProfile(req, res));
router.get("/wallet", (req, res) => c.wallet(req, res));
router.get("/transactions", (req, res) => c.transactions(req, res));
router.get("/receive", (req, res) => c.receive(req, res));
router.get("/recipients", (req, res) => c.recipients(req, res));
router.post("/send", (req, res) => c.send(req, res));

// C2M — Customer → Merchant through your payment provider endpoint.
router.post("/c2m/call-provider", (req, res) => c.callProvider(req, res));

// Card payment — collects the EMV funds via the POS charge implementation.
router.post("/pay/card", (req, res) => c.payWithCard(req, res));

export { router as customerPortalRouter };
