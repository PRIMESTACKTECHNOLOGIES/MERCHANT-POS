import { Router, Request, Response } from "express";
import { getCardByToken, issueWalletCardToken } from "../services/tokenization";

export const cardTokensRouter = Router();

cardTokensRouter.post("/issue", async (req: Request, res: Response) => {
  try {
    const card = await issueWalletCardToken(req.body?.customer_id);
    return res.status(201).json(card);
  } catch (error: any) {
    if (error.message === "CUSTOMER_REQUIRED") {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "TOKENIZATION_ERROR", message: error.message });
  }
});

cardTokensRouter.get("/:token", async (req: Request, res: Response) => {
  try {
    const card = await getCardByToken(req.params.token);
    if (!card) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json(card);
  } catch (error: any) {
    return res.status(500).json({ error: "LOOKUP_ERROR", message: error.message });
  }
});
