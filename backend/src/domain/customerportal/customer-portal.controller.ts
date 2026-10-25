import { Request, Response } from "express";
import QRCode from "qrcode";
import { walletsService } from "../wallets/wallets.service";
import { customerAuthService } from "../customerauth/customer-auth.service";
import { db } from "../../config/db";

/** Render a value as an inline SVG QR code the browser can show without any extra request. */
async function qrDataUrl(value: string): Promise<string | null> {
  try {
    const svg = await QRCode.toString(value, { type: "svg", margin: 1, width: 180 });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Customer self-service portal API.
 *
 * Every handler derives the customer id from the authenticated customer token
 * (`req.customer.id`) and NEVER from request params/body, so a customer can
 * only ever read or move their own data.
 */
export class CustomerPortalController {
  private customerId(req: Request): string {
    return String((req as any).customer?.id || "");
  }

  /** Combined landing payload: profile summary + balances + recent activity. */
  async overview(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });

      const [profile, wallets, cryptoWallets, transactions] = await Promise.all([
        customerAuthService.getProfile(customerId),
        walletsService.listCustomerWallets(customerId),
        walletsService.getCustomerCryptoWallets(customerId).catch(() => []),
        walletsService.getWalletTransactions(customerId).catch(() => []),
      ]);

      res.json({
        profile: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          kyc_status: profile.kyc_status,
          risk_level: profile.risk_level,
          pin_set: profile.pin_set,
        },
        wallets,
        cryptoWallets,
        recentTransactions: (transactions as any[]).slice(0, 10),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      res.json(await customerAuthService.getProfile(customerId));
    } catch (e: any) {
      res.status(e.message.includes("not found") ? 404 : 500).json({ error: e.message });
    }
  }

  async wallet(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      const [wallets, cryptoWallets] = await Promise.all([
        walletsService.listCustomerWallets(customerId),
        walletsService.getCustomerCryptoWallets(customerId).catch(() => []),
      ]);
      res.json({ wallets, cryptoWallets });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async transactions(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      const { currency } = req.query as any;
      res.json(await walletsService.getWalletTransactions(customerId, currency as string | undefined));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** Receive details — the customer's own wallet codes, QR codes and crypto deposit addresses. */
  async receive(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      const [wallets, cryptoWallets, profile] = await Promise.all([
        walletsService.listCustomerWallets(customerId),
        walletsService.getCustomerCryptoWallets(customerId).catch(() => []),
        customerAuthService.getProfile(customerId).catch(() => null as any),
      ]);
      const list = await Promise.all(
        (wallets as any[]).map(async w => ({
          wallet_code: w.wallet_code,
          currency: w.currency,
          balance: w.balance,
          qr_data_url: w.wallet_code ? await qrDataUrl(String(w.wallet_code)) : null,
        }))
      );
      res.json({
        wallets: list,
        cryptoWallets: (cryptoWallets as any[]).map(c => ({
          crypto_coin: c.crypto_coin,
          crypto_address: c.crypto_address || null,
          balance: c.balance,
          status: c.status,
        })),
        portal_pin: (profile as any)?.pin_code || null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** Wallet codes this customer has sent to before, for the Send page picker. */
  async recipients(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });
      const rows = (await db.query(
        `SELECT c.name, w.wallet_code, MAX(t.created_at) AS last_sent
           FROM wallet_transfers t
           JOIN customers c ON c.id = t.receiver_customer_id
           LEFT JOIN customer_wallets w ON w.customer_id = c.id
          WHERE t.sender_customer_id = ?
          GROUP BY c.id, c.name, w.wallet_code
          ORDER BY last_sent DESC
          LIMIT 20`,
        [customerId]
      )).rows as any[];
      res.json(rows.filter(r => !!r.wallet_code));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** Send funds to another customer (by wallet code) or a merchant. */
  async send(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });

      const { receiverWalletCode, receiverCustomerId, amount, note, currency } = req.body || {};
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: "A positive amount is required" });
      }

      let targetId = receiverCustomerId ? String(receiverCustomerId) : "";
      if (!targetId && receiverWalletCode) {
        const match = await customerAuthService.findCustomerByWalletCode(String(receiverWalletCode));
        if (!match) return res.status(404).json({ error: `Wallet code ${receiverWalletCode} not found` });
        targetId = match.customer_id;
      }
      if (!targetId) return res.status(400).json({ error: "A recipient wallet code is required" });

      const result = await walletsService.walletTransfer(
        customerId,
        targetId,
        numericAmount,
        note,
        currency || "USD"
      );
      res.json(result);
    } catch (e: any) {
      const status = /Insufficient|yourself|positive|decimal places|required|customer not found/i.test(e.message) ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  }

  /**
   * C2M — Customer → Merchant, collecting REAL funds from the payment provider.
   *
   * The provider endpoint comes from the SERVER config (`CUSTOMER_WALLET_PROVIDER_URL`),
   * never from the request: a customer supplies only their API key + secret, so a
   * caller can never redirect the pull at a host they control and have the
   * merchant wallet credited on a forged "SUCCESS" response.
   *
   * The pull is HMAC-SHA512 signed (X-Timestamp / X-Nonce / X-Signature) and only
   * credits the merchant wallet when the provider confirms with its own
   * transaction id, a matching amount and currency, and no mock/test markers.
   * On confirmation it also clears the customer's internal-ledger receivable so
   * the same value is never counted twice.
   */
  async callProvider(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });

      const providerUrl = String(process.env.CUSTOMER_WALLET_PROVIDER_URL || "").trim();
      if (!providerUrl) {
        return res.status(503).json({
          error: "Provider endpoint is not configured on the server (CUSTOMER_WALLET_PROVIDER_URL)",
        });
      }

      const {
        merchantId,
        amountMinor,
        currency,
        apiKey,
        secretKey,
        requestReference,
        reason,
      } = req.body || {};

      const result = await walletsService.pullProviderFundsToMerchant({
        customerId,
        merchantId,
        amountMinor: Number(amountMinor),
        currency,
        endpointUrl: providerUrl,
        apiKey,
        secretKey,
        requestReference,
        reason,
      });
      res.json(result);
    } catch (e: any) {
      const message = e?.message || String(e);
      const status = /required|must be|invalid|allowlisted|Insufficient|not found|do not retry|reconcile|mismatched|mock|echo|real transaction ID|previously failed/i.test(message)
        ? 400
        : 502;
      res.status(status).json({ error: message });
    }
  }

  /**
   * Card payment — collects the EMV funds through the same charge implementation
   * the POS uses.
   *
   * The charge runs the live authorization first. When the acquirer does not
   * capture, the value is captured to the paying CUSTOMER wallet as an
   * INTERNAL_LEDGER receivable (funds_type=INTERNAL_LEDGER); it becomes
   * withdrawable merchant money only after the C2M provider pull. That is why
   * this returns the charge's own status/reason instead of a bare "approved" —
   * the portal must show the customer where the funds actually landed.
   */
  async payWithCard(req: Request, res: Response) {
    try {
      const customerId = this.customerId(req);
      if (!customerId) return res.status(401).json({ error: "Unauthorized" });

      const {
        merchantId,
        amountMinor,
        currency,
        pan,
        expiry,
        cvv,
        emv,
        stan,
        terminalId,
        entryMode,
      } = req.body || {};

      if (!merchantId) return res.status(400).json({ error: "merchantId required" });
      const amount = Number(amountMinor);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "amountMinor required and must be positive" });
      }
      if (!currency) return res.status(400).json({ error: "currency required" });

      const cleanPan = String(pan || "").replace(/\s/g, "");
      if (cleanPan.length < 12) return res.status(400).json({ error: "Invalid PAN" });

      const { paymentsService } = await import("../payments/payments.service");
      const result = await paymentsService.charge(String(merchantId), {
        merchantId: String(merchantId),
        customerId,
        amountMinor: Math.round(amount),
        currency: String(currency).toUpperCase(),
        pan: cleanPan,
        expiry: expiry ? String(expiry) : undefined,
        cvv: cvv ? String(cvv) : undefined,
        emv: emv && typeof emv === "object" ? emv : undefined,
        stan: stan ? String(stan) : undefined,
        terminalId: terminalId ? String(terminalId) : "WEB-PORTAL-001",
        entryMode: entryMode ? String(entryMode) : "CHIP",
        protocol: "201.3",
      });

      res.json(result);
    } catch (e: any) {
      const message = e?.message || String(e);
      const status = /required|Invalid|positive|not found|Insufficient/i.test(message) ? 400 : 502;
      res.status(status).json({ error: message });
    }
  }
}

export const customerPortalController = new CustomerPortalController();
