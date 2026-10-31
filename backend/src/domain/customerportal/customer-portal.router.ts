import { Router, Request, Response } from "express";
import { customerPortalController } from "./customer-portal.controller";
import { authenticateCustomer } from "../../middleware/customerAuth.middleware";
import { authenticateToken } from "../../middleware/auth.middleware";
import { customerAuthService } from "../customerauth/customer-auth.service";

const router = Router();
const c = customerPortalController;

// ── Admin: issue / set PIN for a customer (merchant-auth required) ─────────
router.post("/admin/set-pin", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { customerId, walletId, pin } = req.body || {};
    const id = String(customerId || walletId || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "customerId is required" });

    if (pin) {
      // Merchant sets a specific PIN
      const result = await customerAuthService.setPin(id, String(pin));
      return res.json({ ok: true, ...result });
    } else {
      // Auto-generate a 4-digit PIN
      const issuedPin = await customerAuthService.issuePin(id);
      return res.json({ ok: true, pin: issuedPin, message: "PIN issued — share this with the customer" });
    }
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

// Admin: get current PIN for a customer
router.get("/admin/pin/:customerId", authenticateToken, async (req: Request, res: Response) => {
  try {
    const pin = await customerAuthService.getOrIssuePin(req.params.customerId);
    return res.json({ ok: true, pin, customerId: req.params.customerId });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

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
