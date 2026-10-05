import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import { balancedLedgerEngine } from "../domain/ledger/ledger.service";
import { getPanForProcessing } from "../services/tokenization";
import { generateArpc, validateArqc } from "./emvCrypto";
import { parseEmvField55, validateEmvField55Minimum, validateEmvRisk } from "./emvValidation";
import { build0210, packIssuerMessage } from "../iso8583/issuerMessages";
import type { IsoMessage } from "../domain/payments/acquirer/iso8583.codec";

type IssuerInput = {
  customer_id: string;
  amount: number;
  currency: string;
};

function normalizeInput(input: IssuerInput): { customerId: string; amount: number; currency: string } {
  const customerId = String(input.customer_id || "").trim();
  const amount = Number(input.amount);
  const currency = String(input.currency || "").trim().toUpperCase();
  if (!customerId) throw new Error("CUSTOMER_REQUIRED");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_CURRENCY");
  return { customerId, amount, currency };
}

async function getAccount(customerId: string, currency: string) {
  const result = await db.query(
    `SELECT * FROM issuer_accounts
     WHERE customer_id = ? AND currency = ? AND status = 'ACTIVE'
     LIMIT 1`,
    [customerId, currency],
  );
  const account = result.rows[0];
  if (!account) throw new Error("ISSUER_ACCOUNT_NOT_FOUND");
  return account;
}

export class IssuerProcessor {
  private static appendIssuerAuthData(field55Hex: string, arpc: string | null): string {
    if (!arpc) return field55Hex;
    const clean = String(field55Hex || "").replace(/\s+/g, "").toUpperCase();
    const authData = `${arpc}00`;
    return `${clean}910A${authData}`;
  }

  private static async authorizeInternal(input: IssuerInput & {
    token: string;
    merchant_id: string;
  }, emv?: ReturnType<typeof parseEmvField55>) {
    const { customerId, amount, currency } = normalizeInput(input);
    const token = String(input.token || "").trim();
    const merchantId = String(input.merchant_id || "").trim();
    if (!token) throw new Error("TOKEN_REQUIRED");
    if (!merchantId) throw new Error("MERCHANT_REQUIRED");

    const account = await getAccount(customerId, currency);
    if (Number(account.available) < amount) throw new Error("INSUFFICIENT_FUNDS");
    if (emv && !validateEmvRisk(emv)) throw new Error("EMV_RISK_DECLINED");

    const tokenResult = await db.query(
      `SELECT customer_id, scheme, last4
       FROM card_tokens
       WHERE token = ? AND status = 'ACTIVE'
       LIMIT 1`,
      [token],
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow || tokenRow.customer_id !== customerId) {
      throw new Error("CARD_TOKEN_NOT_FOUND");
    }
    await getPanForProcessing(token);

    const holdId = uuidv4();
    const authRef = `AUTH-${holdId}`;
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO issuer_auth_holds
       (id, account_id, token, auth_ref, merchant_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'AUTHORIZED', ?)`,
      [holdId, account.id, token, authRef, merchantId, amount, currency, now],
    );
    await db.query(
      "UPDATE issuer_accounts SET available = available - ?, updated_at = ? WHERE id = ?",
      [amount, now, account.id],
    );

    const ledger = await balancedLedgerEngine.createBalancedTransaction({
      type: "card_auth",
      status: "AUTHORIZED",
      amount,
      currency,
      reference: authRef,
      metadata: { customer_id: customerId, token, merchant_id: merchantId },
      entries: [
        {
          account_code: `ISSUER_${account.id}_AUTH_HOLD`,
          direction: "debit",
          amount,
          currency,
          source_type: "card",
          source_reference: authRef,
          description: "Issuer card authorization hold",
        },
        {
          account_code: `ISSUER_${account.id}_OPEN_TO_BUY`,
          direction: "credit",
          amount,
          currency,
          source_type: "card",
          source_reference: authRef,
          description: "Issuer open-to-buy reservation",
        },
      ],
    });

    return {
      success: true,
      authRef,
      ledgerTransactionId: ledger.ledger_transaction_id,
      account_id: account.id,
      amount,
      currency,
      scheme: tokenRow.scheme,
      last4: tokenRow.last4,
    };
  }

  static async authorize(input: IssuerInput & {
    token: string;
    merchant_id: string;
  }) {
    return this.authorizeInternal(input);
  }

  static async authorizeEmv(input: IssuerInput & {
    token: string;
    merchant_id: string;
    field55Hex: string;
    iso?: {
      amountMinor?: number;
      currencyCode?: string;
      processingCode?: string;
      posEntryMode?: string;
      posConditionCode?: string;
      stan?: string;
      rrn?: string;
      terminalId?: string;
      merchantId?: string;
    };
  }) {
    const emv = parseEmvField55(input.field55Hex);
    validateEmvField55Minimum(emv);
    const processingCard = await getPanForProcessing(input.token);
    const validatedEmv = emv.pan ? emv : { ...emv, pan: processingCard.pan };
    const amountMinor = Math.round(Number(input.amount) * 100);
    const currency = String(input.currency || "").trim().toUpperCase();
    const expectedCurrency = currency === "USD" ? "0840" : currency === "EUR" ? "0978" : currency === "GBP" ? "0826" : "";
    const field55Amount = Number.parseInt(validatedEmv.amount!.toString("hex"), 16);
    const field55Currency = validatedEmv.currency!.toString("hex").toUpperCase();
    if (!Number.isSafeInteger(field55Amount) || field55Amount !== amountMinor) {
      throw new Error("EMV_AMOUNT_MISMATCH");
    }
    if (!expectedCurrency || field55Currency !== expectedCurrency) {
      throw new Error("EMV_CURRENCY_MISMATCH");
    }
    if (input.iso?.amountMinor !== undefined && input.iso.amountMinor !== amountMinor) {
      throw new Error("ISO_AMOUNT_MISMATCH");
    }
    if (input.iso?.currencyCode && input.iso.currencyCode !== field55Currency.slice(-3)) {
      throw new Error("ISO_CURRENCY_MISMATCH");
    }
    const atc = validatedEmv.atc!.readUInt16BE(0);
    const state = await db.query("SELECT last_atc, last_arqc FROM emv_card_state WHERE token = ? LIMIT 1", [input.token]);
    const previousAtc = state.rows[0] ? Number(state.rows[0].last_atc) : -1;
    if (atc <= previousAtc) throw new Error("EMV_ATC_REPLAY");
    if (!validateArqc(validatedEmv, amountMinor, currency)) {
      throw new Error("EMV_CRYPTOGRAM_INVALID");
    }
    if (validatedEmv.pan) {
      const tokenCard = await db.query(
        "SELECT last4 FROM card_tokens WHERE token = ? AND status = 'ACTIVE' LIMIT 1",
        [input.token],
      );
      if (!tokenCard.rows[0] || !validatedEmv.pan.endsWith(String(tokenCard.rows[0].last4))) {
        throw new Error("EMV_PAN_MISMATCH");
      }
    }
    const result = await this.authorizeInternal(input, validatedEmv);
    const authCode = String(Math.floor(100000 + Math.random() * 900000));
    const arpc = generateArpc(validatedEmv, processingCard.pan, "00");
    const responseField55 = this.appendIssuerAuthData(input.field55Hex, arpc);
    await db.query(
      `INSERT INTO emv_card_state (token, last_atc, last_arqc, last_rrn, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(token) DO UPDATE SET
         last_atc = excluded.last_atc,
         last_arqc = excluded.last_arqc,
         last_rrn = excluded.last_rrn,
         updated_at = CURRENT_TIMESTAMP`,
      [input.token, atc, validatedEmv.arqc!.toString("hex").toUpperCase(), input.iso?.rrn || null],
    );
    return {
      ...result,
      isoResponse: {
        mti: "0210",
        responseCode: "00",
        authCode,
        fields: {
          "2": input.token,
          "4": String(amountMinor).padStart(12, "0"),
          "11": input.iso?.stan || "",
          "37": input.iso?.rrn || "",
          "38": authCode,
          "39": "00",
          "41": input.iso?.terminalId || "",
          "42": input.iso?.merchantId || input.merchant_id,
          "49": input.iso?.currencyCode || field55Currency.slice(-3),
          "55": responseField55,
        },
        arpc,
        arpcStatus: arpc ? "SOFTWARE_SANDBOX_KEY" : "ISSUER_KEY_NOT_CONFIGURED",
      },
    };
  }

  static async authorizeIso(input: {
    mti: string;
    fields: Record<string, string | Buffer>;
  }) {
    if (input.mti !== "0200") throw new Error("ISO_MTI_MUST_BE_0200");
    const fields = input.fields || {};
    const value = (field: number): string => {
      const raw = fields[String(field)];
      if (Buffer.isBuffer(raw)) return raw.toString("hex").toUpperCase();
      return String(raw || "");
    };
    const token = value(2).trim();
    const amountText = value(4);
    const field55Hex = value(55);
    const amountMinor = Number(amountText);
    const currencyCode = value(49);
    if (!/^\d{12}$/.test(amountText) || !Number.isSafeInteger(amountMinor)) throw new Error("ISO_AMOUNT_INVALID");
    if (!/^\d{3}$/.test(currencyCode)) throw new Error("ISO_CURRENCY_INVALID");
    if (!field55Hex) throw new Error("EMV_FIELD55_REQUIRED");

    const currency = currencyCode === "840" ? "USD" : currencyCode === "978" ? "EUR" : currencyCode === "826" ? "GBP" : "";
    if (!currency) throw new Error("ISO_CURRENCY_UNSUPPORTED");
    const card = await db.query(
      "SELECT customer_id FROM card_tokens WHERE token = ? AND status = 'ACTIVE' LIMIT 1",
      [token],
    );
    const customerId = card.rows[0]?.customer_id;
    if (!customerId) throw new Error("CARD_TOKEN_NOT_FOUND");

    const result = await this.authorizeEmv({
      customer_id: customerId,
      amount: amountMinor / 100,
      currency,
      token,
      merchant_id: value(42),
      field55Hex,
      iso: {
        amountMinor,
        currencyCode,
        processingCode: value(3),
        posEntryMode: value(22),
        posConditionCode: value(25),
        stan: value(11),
        rrn: value(37),
        terminalId: value(41),
        merchantId: value(42),
      },
    });

    const requestMessage: IsoMessage = {
      mti: "0200",
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, fieldValue]) => [Number(key), fieldValue]),
      ),
    };
    const responseField55 = result.isoResponse.fields["55"];
    const responseMessage = build0210(
      requestMessage,
      result.isoResponse.responseCode,
      result.isoResponse.authCode,
      responseField55,
    );
    return {
      ...result,
      isoResponse: {
        ...result.isoResponse,
        packedHex: packIssuerMessage(responseMessage).toString("hex").toUpperCase(),
      },
    };
  }

  static async capture(input: {
    authRef: string;
    amount: number;
    currency: string;
    merchant_settlement_account: string;
  }) {
    const amount = Number(input.amount);
    const currency = String(input.currency || "").trim().toUpperCase();
    const merchantAccount = String(input.merchant_settlement_account || "").trim();
    if (!input.authRef) throw new Error("AUTH_REF_REQUIRED");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_CURRENCY");
    if (!merchantAccount) throw new Error("MERCHANT_ACCOUNT_REQUIRED");

    const result = await db.query(
      "SELECT * FROM issuer_auth_holds WHERE auth_ref = ? AND currency = ? LIMIT 1",
      [input.authRef, currency],
    );
    const hold = result.rows[0];
    if (!hold) throw new Error("AUTH_NOT_FOUND");
    if (hold.status !== "AUTHORIZED") throw new Error("AUTH_ALREADY_USED");
    if (amount > Number(hold.amount)) throw new Error("CAPTURE_EXCEEDS_AUTH");

    const captureRef = `CAP-${uuidv4()}`;
    const now = new Date().toISOString();
    await db.query(
      "UPDATE issuer_auth_holds SET status = 'CAPTURED', captured_amount = ?, updated_at = ? WHERE id = ?",
      [amount, now, hold.id],
    );
    await db.query(
      `UPDATE issuer_accounts
       SET balance = balance - ?, available = available + ?, updated_at = ?
       WHERE id = ?`,
      [amount, Number(hold.amount) - amount, now, hold.account_id],
    );

    const ledger = await balancedLedgerEngine.createBalancedTransaction({
      type: "card_capture",
      status: "CAPTURED",
      amount,
      currency,
      reference: captureRef,
      metadata: { auth_ref: input.authRef, merchant_settlement_account: merchantAccount },
      entries: [
        {
          account_code: `ISSUER_${hold.account_id}_CUSTOMER_BALANCE`,
          direction: "debit",
          amount,
          currency,
          source_type: "card",
          source_reference: input.authRef,
          description: "Issuer card capture",
        },
        {
          account_code: `ACQUIRER_${merchantAccount}_RECEIVABLE`,
          direction: "credit",
          amount,
          currency,
          source_type: "card",
          source_reference: captureRef,
          description: "Merchant settlement receivable",
        },
      ],
    });

    return { success: true, captureRef, authRef: input.authRef, ledgerTransactionId: ledger.ledger_transaction_id, amount, currency };
  }

  static async refund(input: IssuerInput & { original_capture_ref: string }) {
    const { customerId, amount, currency } = normalizeInput(input);
    if (!input.original_capture_ref) throw new Error("CAPTURE_REF_REQUIRED");
    const account = await getAccount(customerId, currency);
    const refundRef = `RFND-${uuidv4()}`;
    const now = new Date().toISOString();
    await db.query(
      "UPDATE issuer_accounts SET balance = balance + ?, available = available + ?, updated_at = ? WHERE id = ?",
      [amount, amount, now, account.id],
    );
    const ledger = await balancedLedgerEngine.createBalancedTransaction({
      type: "refund",
      status: "SETTLED",
      amount,
      currency,
      reference: refundRef,
      metadata: { customer_id: customerId, original_capture_ref: input.original_capture_ref },
      entries: [
        { account_code: `ISSUER_${account.id}_CUSTOMER_BALANCE`, direction: "credit", amount, currency, source_type: "card", source_reference: refundRef, description: "Issuer card refund" },
        { account_code: "ACQUIRER_REFUND_POOL", direction: "debit", amount, currency, source_type: "card", source_reference: input.original_capture_ref, description: "Acquirer refund funding" },
      ],
    });
    return { success: true, refundRef, ledgerTransactionId: ledger.ledger_transaction_id, amount, currency };
  }

  static async chargeback(input: IssuerInput & {
    original_capture_ref: string;
    reason_code: string;
  }) {
    const { customerId, amount, currency } = normalizeInput(input);
    if (!input.original_capture_ref) throw new Error("CAPTURE_REF_REQUIRED");
    if (!input.reason_code) throw new Error("REASON_CODE_REQUIRED");
    const account = await getAccount(customerId, currency);
    const chargebackRef = `CBK-${uuidv4()}`;
    const now = new Date().toISOString();
    await db.query(
      "UPDATE issuer_accounts SET balance = balance + ?, available = available + ?, updated_at = ? WHERE id = ?",
      [amount, amount, now, account.id],
    );
    const ledger = await balancedLedgerEngine.createBalancedTransaction({
      type: "chargeback",
      status: "REVERSED",
      amount,
      currency,
      reference: chargebackRef,
      metadata: { customer_id: customerId, original_capture_ref: input.original_capture_ref, reason_code: input.reason_code },
      entries: [
        { account_code: `ISSUER_${account.id}_CUSTOMER_BALANCE`, direction: "credit", amount, currency, source_type: "card", source_reference: chargebackRef, description: "Issuer chargeback credit" },
        { account_code: "ACQUIRER_CHARGEBACK_POOL", direction: "debit", amount, currency, source_type: "card", source_reference: input.original_capture_ref, description: "Acquirer chargeback funding" },
      ],
    });
    return { success: true, chargebackRef, ledgerTransactionId: ledger.ledger_transaction_id, amount, currency, reason_code: input.reason_code };
  }
}
