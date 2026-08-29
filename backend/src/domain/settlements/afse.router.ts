import { Router, Request, Response } from "express";
import { afse } from "./automatic-fund-settlement-engine";
import { authenticateToken } from "../../middleware/auth.middleware";
import axios from "axios";
import * as crypto from "crypto";

const router = Router();

router.get("/status", authenticateToken, async (req: Request, res: Response) => {
  try {
    const s = await afse.getStatus();
    res.json(s);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/run-for-auth/:code", authenticateToken, async (req: Request, res: Response) => {
  try {
    const op = (req as any).user?.id || "system";
    const r = await afse.runForAuthCode(req.params.code, op);
    if (r.run_status === "COMPLETE" || r.run_status === "ALREADY_SETTLED") {
      res.json({ success: true, ...r });
    } else {
      const code =
        r.run_status === "CONFIG_ERROR"
          ? 400
          : r.run_status.endsWith("_FAILED")
            ? 502
            : 202;
      res.status(code).json({ success: false, ...r });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.post("/run-all", authenticateToken, async (req: Request, res: Response) => {
  try {
    const op = (req as any).user?.id || "system";
    const r = await afse.runAll(op);
    if (r.failed === 0 && r.total > 0) {
      res.json({ success: true, ...r });
    } else if (r.total === 0) {
      res.json({ success: true, nothing_to_do: true, ...r });
    } else {
      res.status(207).json({ success: r.succeeded > 0, ...r });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

/**
 * Encrypt a payload for TransactPay using their RSA XML public key.
 * TransactPay uses RSA PKCS#1 v1.5 with a 4096-bit key stored as base64 XML.
 * Node's native crypto handles this without any extra dependency.
 */
function encryptForTransactPay(payload: object, encryptionKeyB64: string): string {
  // 1. Decode the base64 → XML string, strip the '4096!' prefix they add
  const xml = Buffer.from(encryptionKeyB64, "base64").toString("utf-8").replace("4096!", "");

  // 2. Parse Modulus and Exponent from the RSA XML key value format
  const modMatch = xml.match(/<Modulus>([^<]+)<\/Modulus>/);
  const expMatch = xml.match(/<Exponent>([^<]+)<\/Exponent>/);
  if (!modMatch || !expMatch) throw new Error("TransactPay encryption key is malformed");

  const modulus = Buffer.from(modMatch[1], "base64");
  const exponent = Buffer.from(expMatch[1], "base64");

  // 3. Build a DER-encoded SubjectPublicKeyInfo so Node crypto can import it
  //    DER structure: SEQUENCE { SEQUENCE { OID rsaEncryption, NULL }, BIT STRING { SEQUENCE { INTEGER mod, INTEGER exp } } }
  function encodeLength(n: number): Buffer {
    if (n < 0x80) return Buffer.from([n]);
    if (n < 0x100) return Buffer.from([0x81, n]);
    return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  }
  function encodeInteger(buf: Buffer): Buffer {
    // Prepend 0x00 if high bit set (avoid sign bit interpretation)
    const needs00 = buf[0] & 0x80 ? Buffer.from([0x00]) : Buffer.alloc(0);
    const content = Buffer.concat([needs00, buf]);
    return Buffer.concat([Buffer.from([0x02]), encodeLength(content.length), content]);
  }
  const modInt = encodeInteger(modulus);
  const expInt = encodeInteger(exponent);
  const rsaSeqContent = Buffer.concat([modInt, expInt]);
  const rsaSeq = Buffer.concat([Buffer.from([0x30]), encodeLength(rsaSeqContent.length), rsaSeqContent]);
  // BIT STRING wrapping
  const bitStr = Buffer.concat([Buffer.from([0x03]), encodeLength(rsaSeq.length + 1), Buffer.from([0x00]), rsaSeq]);
  // Algorithm identifier: SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algorithmId = Buffer.from("300d06092a864886f70d0101010500", "hex");
  const spkiContent = Buffer.concat([algorithmId, bitStr]);
  const spki = Buffer.concat([Buffer.from([0x30]), encodeLength(spkiContent.length), spkiContent]);

  // 4. Import and encrypt with PKCS1 v1.5 padding
  const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    plaintext
  );
  return encrypted.toString("base64");
}

// ─── TransactPay payment initiation ─────────────────────────────────────────
// POST /api/settlement-engine/transactpay/initiate
//
// Step 1: Create a TransactPay order  → /payment/order/create
// Step 2: Pay the order (card)        → /payment/order/pay
// Step 3: Return the reference (auth_code) back to the POS
//
// The returned `reference` must be stored as `auth_code` on the POS transaction
// so the AFSE capture engine can find and settle it later.
//
// Body: {
//   reference:    string  — your own unique order reference (e.g. "TXN-20260827-001")
//   amount:       number  — decimal amount (e.g. 97.50)
//   currency:     string  — e.g. "NGN"
//   description?: string
//   customer: {
//     firstname: string, lastname: string, email: string,
//     mobile: string, country: string
//   }
//   card: {
//     cardnumber: string, expirymonth: string, expiryyear: string, cvv: string,
//     authOption?: "NOAUTH"   // omit for standard 3DS flow
//   }
//   redirectUrl?: string      // required for 3DS flow
// }
router.post("/transactpay/initiate", authenticateToken, async (req: Request, res: Response) => {
  try {
    const baseUrl = String(process.env.TRANSACTPAY_BASE_URL || "https://payment-api-service.transactpay.ai").trim().replace(/\/+$/, "");
    const publicKey = String(process.env.TRANSACTPAY_PUBLIC_KEY || "").trim();
    const secretKey = String(process.env.TRANSACTPAY_SECRET_KEY || "").trim();
    const encryptionKey = String(process.env.TRANSACTPAY_ENCRYPTION_KEY || "").trim();

    if (!publicKey || !secretKey || !encryptionKey) {
      return res.status(503).json({
        success: false,
        error: "TransactPay not configured — set TRANSACTPAY_PUBLIC_KEY, TRANSACTPAY_SECRET_KEY, TRANSACTPAY_ENCRYPTION_KEY in backend/.env",
      });
    }

    const { reference, amount, currency, description, customer, card, redirectUrl } = req.body || {};

    // ── Validate required fields ───────────────────────────────────────────
    if (!reference) return res.status(400).json({ success: false, error: "reference is required" });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ success: false, error: "amount (decimal) is required" });
    if (!currency) return res.status(400).json({ success: false, error: "currency is required" });
    if (!customer?.firstname || !customer?.lastname || !customer?.email || !customer?.mobile || !customer?.country) {
      return res.status(400).json({ success: false, error: "customer.firstname, lastname, email, mobile, country are required" });
    }
    if (!card?.cardnumber || !card?.expirymonth || !card?.expiryyear || !card?.cvv) {
      return res.status(400).json({ success: false, error: "card.cardnumber, expirymonth, expiryyear, cvv are required" });
    }

    const headers = { "Content-Type": "application/json", Accept: "application/json", "api-key": publicKey };
    const secureHeaders = { ...headers, "api-key": secretKey };

    // ── Step 1: Create order ────────────────────────────────────────────────
    const orderPayload = {
      customer: {
        firstname: customer.firstname,
        lastname: customer.lastname,
        mobile: customer.mobile,
        country: customer.country,
        email: customer.email,
      },
      order: {
        amount: Number(amount),
        reference: String(reference),
        description: description || `POS payment ${reference}`,
        currency: String(currency).toUpperCase(),
      },
      payment: { RedirectUrl: redirectUrl || process.env.TRANSACTPAY_REDIRECT_URL || "https://pos.example.com/callback" },
      paymentMeta: { ipAddress: req.ip || req.headers["x-forwarded-for"] || "0.0.0.0" },
    };

    const encryptedOrder = encryptForTransactPay(orderPayload, encryptionKey);
    const createRes = await axios.post(`${baseUrl}/payment/order/create`, { data: encryptedOrder }, { headers, timeout: 20000 });
    const createBody = createRes.data || {};
    if (createBody.status === false) {
      return res.status(502).json({
        success: false,
        step: "create_order",
        error: createBody.message || "TransactPay order creation failed",
        raw: createBody,
      });
    }
    // TransactPay returns the reference back — use it to confirm
    const orderReference = createBody.data?.reference || createBody.data?.orderReference || reference;

    // ── Step 2: Pay order (encrypt card data) ──────────────────────────────
    const payPayload: Record<string, any> = {
      reference: orderReference,
      paymentoption: "C",
      country: customer.country,
      card: {
        cardnumber: card.cardnumber,
        expirymonth: card.expirymonth,
        expiryyear: card.expiryyear,
        cvv: card.cvv,
        ...(card.authOption ? { authOption: card.authOption } : {}),
      },
    };

    const encryptedPay = encryptForTransactPay(payPayload, encryptionKey);
    const payRes = await axios.post(`${baseUrl}/payment/order/pay`, { data: encryptedPay }, { headers: secureHeaders, timeout: 20000 });
    const payBody = payRes.data || {};
    const payData = payBody.data || {};

    if (payBody.status === false) {
      return res.status(502).json({
        success: false,
        step: "pay_order",
        error: payBody.message || payData.paymentResponseMessage || "TransactPay pay order failed",
        reference: orderReference,
        raw: payBody,
      });
    }

    // ── Step 3: Return the auth_code (reference) to the POS ───────────────
    // The POS MUST store this as auth_code on the pos2013_transactions row.
    // The AFSE engine will use it to verify + capture real funds later.
    const statusId = Number(payData.statusId || payData.orderSummary?.statusId || 0);
    const status = String(payData.status || payData.orderSummary?.status || "").toLowerCase();
    const requiresVerify = card.authOption !== "NOAUTH" && statusId !== 5 && status !== "successful";

    return res.json({
      success: true,
      auth_code: orderReference,       // ← store this on the POS transaction
      reference: orderReference,
      statusId,
      status,
      requiresOtpOrRedirect: requiresVerify,
      redirectUrl: payData.redirectUrl || payData.authorizationUrl || null,
      message: requiresVerify
        ? `Order pre-authorized (statusId=${statusId}). Complete 3DS/OTP then call capture.`
        : `Payment successful. Use auth_code="${orderReference}" in AFSE capture.`,
      raw: payBody,
    });
  } catch (e: any) {
    const errMsg = e?.response?.data?.message || e?.message || String(e);
    console.error("[TransactPay Initiate]", errMsg);
    return res.status(500).json({ success: false, error: errMsg });
  }
});

export default router;
