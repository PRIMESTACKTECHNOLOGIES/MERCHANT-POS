import { Router, Request, Response } from "express";
import { createPayout, getPayout, listPayouts } from "../services/payouts";
import { checkIdempotency } from "../services/payoutIdempotency";

export const payoutsRouter = Router();

payoutsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const idempotencyKey = (req.header("Idempotency-Key") || undefined) as string | undefined;
    if (idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey, req.body);
      if (existing.exists) {
        return res.status(200).json(existing.payout);
      }
    }

    const payout = await createPayout(req.body, idempotencyKey);
    return res.status(201).json(payout);
  } catch (err: any) {
    if (err.message === "IDEMPOTENCY_CONFLICT") {
      return res.status(409).json({
        error: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key already used with different payload",
      });
    }
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: err.message || "Invalid payout request",
    });
  }
});

payoutsRouter.get("/:id", async (req: Request, res: Response) => {
  const payout = await getPayout(req.params.id);
  if (!payout) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: "Payout not found",
    });
  }
  return res.json(payout);
});

payoutsRouter.get("/", async (req: Request, res: Response) => {
  const { status, channel, search } = req.query as {
    status?: string;
    channel?: string;
    search?: string;
  };
  const list = await listPayouts({ status, channel, search });
  return res.json(list);
});
