import crypto from "crypto";
import { db } from "../../config/db";

export const PREAUTH_PROTOCOLS = ["101.1", "101.6"] as const;
export type PreAuthProtocol = (typeof PREAUTH_PROTOCOLS)[number];

type PreAuthRequest = {
  protocolVersion: string;
  merchantId: string;
  terminalId: string;
  amountMinor: number;
  currency: string;
  cardToken?: string;
  pan?: string;
};

type PreAuthRecord = {
  id: string;
  merchant_id: string;
  terminal_id: string;
  protocol_version: PreAuthProtocol;
  amount_minor: number;
  currency: string;
  status: "AUTHORIZED" | "CAPTURED" | "VOIDED";
  auth_code: string;
  card_last4: string;
  captured_amount_minor: number | null;
  created_at: string;
  captured_at: string | null;
  voided_at: string | null;
};

function isPreAuthProtocol(value: string): value is PreAuthProtocol {
  return (PREAUTH_PROTOCOLS as readonly string[]).includes(value);
}

function isPreAuthEnabled() {
  return process.env.PREAUTH_ENABLED !== "false" && process.env.PREAUTH_ENABLED !== "0";
}

function enabledProtocols(): PreAuthProtocol[] {
  const configured = (process.env.ENABLED_PAYMENT_PROTOCOLS || "101.1,101.6,201.3")
    .split(",")
    .map((value) => value.trim());

  return PREAUTH_PROTOCOLS.filter((protocol) => configured.includes(protocol));
}

function getLastFour(cardToken?: string, pan?: string) {
  const value = (pan || cardToken || "").replace(/\s/g, "");
  return value.length >= 4 ? value.slice(-4) : "****";
}

export class PreAuthService {
  getProtocolStatus() {
    const protocols = enabledProtocols();
    return {
      preAuthEnabled: isPreAuthEnabled(),
      protocols: PREAUTH_PROTOCOLS.map((protocol) => ({
        protocol,
        enabled: isPreAuthEnabled() && protocols.includes(protocol),
        operations: ["preauth", "capture", "void"],
      })),
    };
  }

  async authorize(request: PreAuthRequest) {
    if (!isPreAuthEnabled()) {
      throw new Error("Pre-authorization is disabled");
    }
    if (!isPreAuthProtocol(request.protocolVersion) || !enabledProtocols().includes(request.protocolVersion)) {
      throw new Error("Unsupported or disabled pre-authorization protocol");
    }
    if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
      throw new Error("amountMinor must be a positive integer");
    }
    if (!/^[A-Z]{3}$/.test(request.currency)) {
      throw new Error("currency must be a three-letter ISO code");
    }
    if (!request.merchantId || !request.terminalId) {
      throw new Error("merchantId and terminalId are required");
    }

    // Preserve the existing test gateway's deterministic decline behavior.
    if (request.amountMinor % 7 === 0) {
      return {
        success: false,
        status: "DECLINED",
        protocolVersion: request.protocolVersion,
        amountMinor: request.amountMinor,
        currency: request.currency,
      };
    }

    const id = `pa_${crypto.randomUUID()}`;
    const authCode = crypto.randomBytes(4).toString("hex").toUpperCase();
    const cardLast4 = getLastFour(request.cardToken, request.pan);

    await db.query(
      `INSERT INTO payment_preauthorizations
        (id, merchant_id, terminal_id, protocol_version, amount_minor, currency, status, auth_code, card_last4)
       VALUES (?, ?, ?, ?, ?, ?, 'AUTHORIZED', ?, ?)`,
      [
        id,
        request.merchantId,
        request.terminalId,
        request.protocolVersion,
        request.amountMinor,
        request.currency,
        authCode,
        cardLast4,
      ],
    );

    return {
      success: true,
      id,
      status: "AUTHORIZED",
      protocolVersion: request.protocolVersion,
      amountMinor: request.amountMinor,
      currency: request.currency,
      authCode,
      cardLast4,
    };
  }

  async capture(id: string, amountMinor?: number) {
    const result = await db.query("SELECT * FROM payment_preauthorizations WHERE id = ? LIMIT 1", [id]);
    const authorization = result.rows[0] as PreAuthRecord | undefined;
    if (!authorization) {
      throw new Error("Pre-authorization not found");
    }
    if (authorization.status !== "AUTHORIZED") {
      throw new Error(`Pre-authorization is already ${authorization.status.toLowerCase()}`);
    }

    const captureAmount = amountMinor ?? authorization.amount_minor;
    if (!Number.isInteger(captureAmount) || captureAmount <= 0 || captureAmount > authorization.amount_minor) {
      throw new Error("Capture amount must be a positive integer no greater than the authorized amount");
    }

    const updateResult = await db.query(
      `UPDATE payment_preauthorizations
       SET status = 'CAPTURED', captured_amount_minor = ?, captured_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'AUTHORIZED'`,
      [captureAmount, id],
    );
    if (updateResult.rowCount !== 1) {
      throw new Error("Pre-authorization is no longer available for capture");
    }

    return {
      success: true,
      id,
      status: "CAPTURED",
      protocolVersion: authorization.protocol_version,
      amountMinor: captureAmount,
      currency: authorization.currency,
      authCode: authorization.auth_code,
    };
  }

  async void(id: string) {
    const result = await db.query("SELECT * FROM payment_preauthorizations WHERE id = ? LIMIT 1", [id]);
    const authorization = result.rows[0] as PreAuthRecord | undefined;
    if (!authorization) {
      throw new Error("Pre-authorization not found");
    }
    if (authorization.status !== "AUTHORIZED") {
      throw new Error(`Pre-authorization is already ${authorization.status.toLowerCase()}`);
    }

    const updateResult = await db.query(
      `UPDATE payment_preauthorizations
       SET status = 'VOIDED', voided_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'AUTHORIZED'`,
      [id],
    );
    if (updateResult.rowCount !== 1) {
      throw new Error("Pre-authorization is no longer available for void");
    }

    return {
      success: true,
      id,
      status: "VOIDED",
      protocolVersion: authorization.protocol_version,
      amountMinor: authorization.amount_minor,
      currency: authorization.currency,
      authCode: authorization.auth_code,
    };
  }
}

export const preAuthService = new PreAuthService();
