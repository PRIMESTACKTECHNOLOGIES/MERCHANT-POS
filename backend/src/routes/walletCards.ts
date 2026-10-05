import { Router, Request, Response } from "express";
import { db } from "../config/db";
import {
  walletVirtualCardService,
  WalletCardStatus,
} from "../services/walletVirtualCards";
import { validateLuhn, generateVirtualCard } from "../utils/virtualCard";
import { v4 as uuidv4 } from "uuid";
import {
  buildAuthorizationRequest,
  buildAuthorizationResponse,
  buildField55,
  generateDemoArqc,
  parseField55,
  validateArqc,
} from "../services/emv/issuerEmv";

export const walletCardsRouter = Router();

walletCardsRouter.post("/generate", async (req: Request, res: Response) => {
  try {
    const { scheme, validity_years } = req.body || {};
    const card = generateVirtualCard(
      scheme === "MASTERCARD" ? "MASTERCARD" : "VISA",
      Number(validity_years || 3)
    );
    const valid = validateLuhn(card.card_number);
    return res.status(200).json({
      ...card,
      luhn_valid: valid,
      card_number_formatted: card.card_number.replace(/(\d{4})(?=\d)/g, "$1 "),
    });
  } catch (e: any) {
    return res.status(500).json({ error: "GENERATION_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/validate", async (req: Request, res: Response) => {
  try {
    const { card_number } = req.body || {};
    if (!card_number) {
      return res.status(400).json({ error: "CARD_NUMBER_REQUIRED" });
    }
    const clean = String(card_number).replace(/\D/g, "");
    const valid = validateLuhn(clean);
    const scheme = (() => {
      if (/^4/.test(clean)) return "VISA";
      if (/^(5[1-5]|2[2-7])/.test(clean)) return "MASTERCARD";
      if (/^(3[47])/.test(clean)) return "AMEX";
      if (/^6(?:011|5)/.test(clean)) return "DISCOVER";
      return "UNKNOWN";
    })();
    return res.status(200).json({
      valid,
      scheme,
      length: clean.length,
      bin: clean.slice(0, 6),
      last4: clean.slice(-4),
      card_number: clean,
    });
  } catch (e: any) {
    return res.status(500).json({ error: "VALIDATION_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/emv/field55", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const field55 = buildField55({
      pan: body.pan || "4111111111111111",
      amountMinor: Number(body.amountMinor || 1000),
      currency: body.currency || "840",
      atc: body.atc || "0001",
      txnDate: body.txnDate || "260920",
      txnType: body.txnType || "00",
      unpredictableNumber: body.unpredictableNumber || body.unpredictable || "AABBCCDD",
      terminalCountry: body.terminalCountry || "0840",
      terminalCapabilities: body.terminalCapabilities || "E0F8C8",
      cvr: body.cvr || "0102",
      terminalType: body.terminalType || "22",
      ifdSerial: body.ifdSerial || "3132333435363738",
      aid: body.aid || "A0000000031010",
      appVersion: body.appVersion || "0101",
      sequenceCounter: body.sequenceCounter || "00000123",
      arqc: body.arqc || generateDemoArqc({
        ...body,
        pan: body.pan || "4111111111111111",
        amountMinor: Number(body.amountMinor || 1000),
        atc: body.atc || "0001",
        unpredictableNumber: body.unpredictableNumber || body.unpredictable || "AABBCCDD",
      }),
    });

    return res.json({
      field55,
      tags: parseField55(field55),
      summary: {
        arqc: field55.slice(0, 32),
        atc: body.atc || "0001",
        currency: body.currency || "840",
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: "EMV_FIELD55_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/emv/authorize", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const amountMinor = Number(body.amountMinor || 1000);
    const pan = String(body.pan || "4111111111111111");
    const currency = String(body.currency || "840");
    const atc = String(body.atc || "0001").replace(/\D/g, "").padStart(4, "0");
    const terminalId = String(body.terminalId || "TID00001");
    const merchantId = String(body.merchantId || "MID000123");
    const unpredictable = String(body.unpredictableNumber || "AABBCCDD");
    const arqc = String(body.arqc || generateDemoArqc({ pan, amountMinor, currency, atc, unpredictableNumber: unpredictable, terminalId, merchantId }));

    const authRequest = buildAuthorizationRequest({
      pan,
      amountMinor,
      currency,
      atc,
      terminalId,
      merchantId,
      unpredictableNumber: unpredictable,
      arqc,
    });

    const validation = validateArqc({
      pan,
      amountMinor,
      currency,
      atc,
      terminalId,
      merchantId,
      unpredictableNumber: unpredictable,
      arqc,
    });

    const issuerResponse = buildAuthorizationResponse({
      pan,
      amountMinor,
      currency,
      atc,
      terminalId,
      merchantId,
      unpredictableNumber: unpredictable,
      arqc,
    });

    return res.status(200).json({
      arqc,
      field55: authRequest.field55,
      iso8583: authRequest.iso8583,
      issuerValidation: validation,
      issuerResponse,
    });
  } catch (e: any) {
    return res.status(500).json({ error: "EMV_AUTH_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/customer/:customerId/cards", async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const body = req.body || {};
    const result = await walletVirtualCardService.issueCard({
      customer_id: customerId,
      wallet_id: body.wallet_id,
      scheme: (body.scheme || "VISA").toUpperCase() === "MASTERCARD" ? "MASTERCARD" : "VISA",
      currency: (body.currency || "USD").toUpperCase(),
      validity_years: Number(body.validity_years || 3),
      cardholder_name: body.cardholder_name,
      spending_limit: Number(body.spending_limit || 0),
      meta: body.meta || undefined,
      link_to_wallet_card_id: body.link_to_wallet !== false,
    });
    const view = await walletVirtualCardService.toPrivateView(result);
    return res.status(201).json(view);
  } catch (e: any) {
    if (e.message === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ error: "CUSTOMER_NOT_FOUND", message: "Customer does not exist" });
    }
    if (e.message === "PAN_UNAVAILABLE_TRY_LATER") {
      return res.status(503).json({ error: "PAN_UNAVAILABLE_TRY_LATER", message: "Pan generation collision, please retry" });
    }
    return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message || "Failed to issue card" });
  }
});

walletCardsRouter.get("/customer/:customerId/cards", async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { status, currency, include_secrets } = req.query as any;
    const includeSecrets = String(include_secrets || "false").toLowerCase() === "true";
    const result = await walletVirtualCardService.listCustomerCards(customerId, {
      status: status as WalletCardStatus,
      currency: currency as string,
      includeSecrets,
    });
    const views = await Promise.all(
      result.cards.map((c) =>
        includeSecrets
          ? walletVirtualCardService.toPrivateView(c)
          : walletVirtualCardService.toPublicView(c)
      )
    );
    return res.json({
      count: result.count,
      customer_id: customerId,
      cards: views,
    });
  } catch (e: any) {
    return res.status(500).json({ error: "LIST_ERROR", message: e.message });
  }
});

walletCardsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { include_secrets } = req.query as any;
    const includeSecrets = String(include_secrets || "false").toLowerCase() === "true";
    const card = await walletVirtualCardService.getCard(id, includeSecrets);
    if (!card) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Card not found" });
    }
    const view = includeSecrets
      ? await walletVirtualCardService.toPrivateView(card)
      : await walletVirtualCardService.toPublicView(card);
    return res.json(view);
  } catch (e: any) {
    return res.status(500).json({ error: "LOOKUP_ERROR", message: e.message });
  }
});

walletCardsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, spending_limit, cardholder_name, meta } = req.body || {};
    const existing = await walletVirtualCardService.getCard(id);
    if (!existing) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Card not found" });
    }
    let updated = existing;
    if (status === "DEACTIVATED") {
      const r = await walletVirtualCardService.deactivateCard(id, req.body.deactivation_reason);
      if (r) updated = r;
    } else if (status === "ACTIVE" && existing.status === "DEACTIVATED") {
      const r = await walletVirtualCardService.reactivateCard(id);
      if (r) updated = r;
    } else if (status && status !== existing.status) {
      const now = new Date().toISOString();
      await db.query(
        `UPDATE wallet_cards SET status = ?, updated_at = ? WHERE id = ?`,
        [status, now, id]
      );
      const latest = await walletVirtualCardService.getCard(id);
      if (latest) updated = latest;
    }
    if (typeof spending_limit === "number" && spending_limit !== existing.spending_limit) {
      const r = await walletVirtualCardService.setSpendingLimit(id, spending_limit);
      if (r) updated = r;
    }
    if (cardholder_name !== undefined || meta !== undefined) {
      const now = new Date().toISOString();
      const mergedMeta = meta ? { ...(existing.meta_json || {}), ...meta } : existing.meta_json;
      await db.query(
        `UPDATE wallet_cards SET cardholder_name = COALESCE(?, cardholder_name), meta_json = ?, updated_at = ? WHERE id = ?`,
        [
          cardholder_name !== undefined ? cardholder_name || null : null,
          mergedMeta ? JSON.stringify(mergedMeta) : null,
          now,
          id,
        ]
      );
      const latest = await walletVirtualCardService.getCard(id);
      if (latest) updated = latest;
    }
    const view = await walletVirtualCardService.toPublicView(updated);
    return res.json(view);
  } catch (e: any) {
    if (e.message === "INVALID_LIMIT") {
      return res.status(400).json({ error: "INVALID_LIMIT", message: "Spending limit must be a non-negative number" });
    }
    return res.status(500).json({ error: "UPDATE_ERROR", message: e.message });
  }
});

walletCardsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deactivated = await walletVirtualCardService.deactivateCard(id, "DELETED_VIA_API");
    if (!deactivated) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Card not found" });
    }
    return res.json({
      id,
      status: "DEACTIVATED",
      deactivated_at: deactivated.deactivated_at,
    });
  } catch (e: any) {
    return res.status(500).json({ error: "DELETE_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/:id/auth", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, cvv, expiry } = req.body || {};
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "AMOUNT_REQUIRED", message: "Valid amount required" });
    }
    const card = await walletVirtualCardService.getCard(id, true);
    if (!card) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Card not found" });
    }
    if (cvv && String(cvv) !== card.cvv) {
      return res.status(402).json({ approved: false, reason: "CVV_MISMATCH" });
    }
    if (expiry) {
      const [expMonth, expYear] = String(expiry).split(/[\/\-]/);
      if (expMonth !== card.expiry_month || expYear !== card.expiry_year) {
        return res.status(402).json({ approved: false, reason: "EXPIRY_MISMATCH" });
      }
    }
    const result = await walletVirtualCardService.registerCardAuth(id, amount);
    return res.status(result.approved ? 200 : 402).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: "AUTH_ERROR", message: e.message });
  }
});

walletCardsRouter.post("/lookup/pan", async (req: Request, res: Response) => {
  try {
    const { card_number } = req.body || {};
    if (!card_number) {
      return res.status(400).json({ error: "CARD_NUMBER_REQUIRED" });
    }
    const clean = String(card_number).replace(/\D/g, "");
    const card = await walletVirtualCardService.getByPan(clean);
    if (!card) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Card not found" });
    }
    const view = await walletVirtualCardService.toPublicView(card);
    return res.json(view);
  } catch (e: any) {
    return res.status(500).json({ error: "LOOKUP_ERROR", message: e.message });
  }
});
