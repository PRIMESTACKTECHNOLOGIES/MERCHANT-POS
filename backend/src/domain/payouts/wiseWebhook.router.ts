import { Router } from "express";
import { handleWiseWebhook, verifyWiseWebhook } from "./wiseWebhook.service";

const router = Router();

router.post("/wise/webhook", async (req, res) => {
  try {
    const signature = req.header("X-Wise-Signature") || req.header("X-Signature") || undefined;
    const rawBody = req.body;

    if (!verifyWiseWebhook(rawBody, signature)) {
      return res.status(401).json({ success: false, error: "Invalid webhook signature" });
    }

    const event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    const result = await handleWiseWebhook(event);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Wise webhook error", err);
    return res.status(400).json({ success: false, error: err.message || "Webhook processing failed" });
  }
});

export { router as wiseWebhookRouter };
