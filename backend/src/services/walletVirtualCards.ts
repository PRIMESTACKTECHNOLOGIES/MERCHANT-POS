import { v4 as uuidv4 } from "uuid";
import { db } from "../config/db";
import {
  generateVirtualCard,
  encryptPan,
  validateLuhn,
  detectSchemeFromPan,
  CardScheme,
  GeneratedCard,
} from "../utils/virtualCard";

export type WalletCardStatus = "ACTIVE" | "INACTIVE" | "DEACTIVATED" | "EXPIRED" | "BLOCKED";

export interface WalletCardRecord {
  id: string;
  customer_id: string;
  wallet_id: string | null;
  scheme: CardScheme;
  bin: string;
  last4: string;
  card_number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string;
  cardholder_name: string | null;
  currency: string;
  status: WalletCardStatus;
  spending_limit: number;
  used_amount: number;
  pan_encrypted: string | null;
  pan_kid: string | null;
  meta_json: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
}

export interface CreateWalletCardOptions {
  customer_id: string;
  wallet_id?: string;
  scheme?: CardScheme;
  currency?: string;
  validity_years?: number;
  cardholder_name?: string;
  spending_limit?: number;
  meta?: Record<string, any>;
  link_to_wallet_card_id?: boolean;
}

function parseCardRow(row: any): WalletCardRecord {
  return {
    id: row.id,
    customer_id: row.customer_id,
    wallet_id: row.wallet_id || null,
    scheme: row.scheme as CardScheme,
    bin: row.bin,
    last4: row.last4,
    card_number: row.card_number,
    expiry_month: row.expiry_month,
    expiry_year: row.expiry_year,
    cvv: row.cvv,
    cardholder_name: row.cardholder_name || null,
    currency: row.currency || "USD",
    status: row.status as WalletCardStatus,
    spending_limit: Number(row.spending_limit || 0),
    used_amount: Number(row.used_amount || 0),
    pan_encrypted: row.pan_encrypted || null,
    pan_kid: row.pan_kid || null,
    meta_json: row.meta_json ? JSON.parse(row.meta_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    activated_at: row.activated_at || null,
    deactivated_at: row.deactivated_at || null,
  };
}

export class WalletVirtualCardService {
  async getCustomerWalletId(customerId: string, currency: string = "USD"): Promise<string | null> {
    const walletRes = await db.query(
      "SELECT id FROM customer_wallets WHERE customer_id = ? AND currency = ? LIMIT 1",
      [customerId, currency.toUpperCase()]
    );
    return walletRes.rows?.[0]?.id || null;
  }

  async ensureCustomerExists(customerId: string): Promise<void> {
    const cust = await db.query("SELECT id FROM customers WHERE id = ? LIMIT 1", [customerId]);
    if (!cust.rows?.length) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }
  }

  async ensurePanUnique(pan: string): Promise<void> {
    const prior = await db.query("SELECT id FROM wallet_cards WHERE card_number = ? LIMIT 1", [pan]);
    if (prior.rows?.length) {
      throw new Error("PAN_COLLISION_RETRY");
    }
  }

  async issueCard(options: CreateWalletCardOptions): Promise<WalletCardRecord> {
    if (!options.customer_id) throw new Error("CUSTOMER_ID_REQUIRED");

    const scheme: CardScheme = (options.scheme || "VISA").toUpperCase() as CardScheme;
    const currency = (options.currency || "USD").trim().toUpperCase();
    const validityYears = Number(options.validity_years || 3);

    await this.ensureCustomerExists(options.customer_id);

    let walletId: string | null = options.wallet_id || null;
    if (!walletId && options.link_to_wallet_card_id !== false) {
      walletId = await this.getCustomerWalletId(options.customer_id, currency);
    }

    let card: GeneratedCard;
    let attempts = 0;
    while (true) {
      card = generateVirtualCard(scheme, validityYears);
      if (!validateLuhn(card.card_number)) continue;
      const detected = detectSchemeFromPan(card.card_number);
      if (detected !== scheme) continue;
      try {
        await this.ensurePanUnique(card.card_number);
        break;
      } catch (e: any) {
        if (e.message !== "PAN_COLLISION_RETRY") throw e;
        attempts++;
        if (attempts >= 10) throw new Error("PAN_UNAVAILABLE_TRY_LATER");
      }
    }

    const { encrypted, kid } = encryptPan(card.card_number);
    const now = new Date().toISOString();
    const id = `card_${uuidv4().replace(/-/g, "")}`;

    await db.query(
      `INSERT INTO wallet_cards
         (id, customer_id, wallet_id, scheme, bin, last4, card_number,
          expiry_month, expiry_year, cvv, cardholder_name, currency, status,
          spending_limit, used_amount, pan_encrypted, pan_kid, meta_json,
          created_at, updated_at, activated_at, deactivated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        options.customer_id,
        walletId,
        scheme,
        card.bin,
        card.last4,
        card.card_number,
        card.expiry_month,
        card.expiry_year,
        card.cvv,
        options.cardholder_name || null,
        currency,
        "ACTIVE",
        Number(options.spending_limit || 0),
        0,
        encrypted,
        kid,
        options.meta ? JSON.stringify(options.meta) : null,
        now,
        now,
        now,
        null,
      ]
    );

    return this.getCard(id) as Promise<WalletCardRecord>;
  }

  async getCard(id: string, includeSecrets: boolean = true): Promise<WalletCardRecord | null> {
    const res = await db.query("SELECT * FROM wallet_cards WHERE id = ? LIMIT 1", [id]);
    if (!res.rows?.length) return null;
    const rec = parseCardRow(res.rows[0]);
    if (!includeSecrets) {
      (rec as any).card_number = `XXXX-XXXX-XXXX-${rec.last4}`;
      (rec as any).cvv = "***";
      (rec as any).pan_encrypted = null;
    }
    return rec;
  }

  async getByPan(pan: string): Promise<WalletCardRecord | null> {
    const clean = pan.replace(/\D/g, "");
    const res = await db.query("SELECT * FROM wallet_cards WHERE card_number = ? LIMIT 1", [clean]);
    if (!res.rows?.length) return null;
    return parseCardRow(res.rows[0]);
  }

  async listCustomerCards(
    customerId: string,
    params: { status?: WalletCardStatus; includeSecrets?: boolean; currency?: string } = {}
  ): Promise<{ count: number; cards: WalletCardRecord[] }> {
    const conds: string[] = ["customer_id = ?"];
    const args: any[] = [customerId];
    if (params.status) {
      conds.push("status = ?");
      args.push(params.status);
    }
    if (params.currency) {
      conds.push("currency = ?");
      args.push(params.currency.toUpperCase());
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const countR = await db.query(`SELECT COUNT(*) c FROM wallet_cards ${where}`, args);
    const count = Number(countR.rows?.[0]?.c || 0);

    const rowsR = await db.query(
      `SELECT * FROM wallet_cards ${where} ORDER BY created_at DESC LIMIT 100`,
      args
    );
    const cards: WalletCardRecord[] = [];
    for (const row of rowsR.rows || []) {
      const rec = parseCardRow(row);
      if (params.includeSecrets === false) {
        (rec as any).card_number = `XXXX-XXXX-XXXX-${rec.last4}`;
        (rec as any).cvv = "***";
        (rec as any).pan_encrypted = null;
      }
      cards.push(rec);
    }
    return { count, cards };
  }

  async deactivateCard(id: string, reason?: string): Promise<WalletCardRecord | null> {
    const now = new Date().toISOString();
    const prior = await this.getCard(id);
    if (!prior) return null;
    const meta = prior.meta_json || {};
    meta.deactivation_reason = reason || "USER_REQUEST";
    await db.query(
      `UPDATE wallet_cards
          SET status = 'DEACTIVATED', deactivated_at = ?, meta_json = ?, updated_at = ?
        WHERE id = ?`,
      [now, JSON.stringify(meta), now, id]
    );
    return this.getCard(id);
  }

  async reactivateCard(id: string): Promise<WalletCardRecord | null> {
    const now = new Date().toISOString();
    const prior = await this.getCard(id);
    if (!prior) return null;
    await db.query(
      `UPDATE wallet_cards
          SET status = 'ACTIVE', deactivated_at = NULL, activated_at = COALESCE(activated_at, ?), updated_at = ?
        WHERE id = ?`,
      [now, now, id]
    );
    return this.getCard(id);
  }

  async setSpendingLimit(id: string, limit: number): Promise<WalletCardRecord | null> {
    if (!Number.isFinite(limit) || limit < 0) throw new Error("INVALID_LIMIT");
    const now = new Date().toISOString();
    await db.query(
      `UPDATE wallet_cards SET spending_limit = ?, updated_at = ? WHERE id = ?`,
      [limit, now, id]
    );
    return this.getCard(id);
  }

  async registerCardAuth(id: string, amount: number): Promise<{ approved: boolean; reason?: string }> {
    const prior = await this.getCard(id);
    if (!prior) return { approved: false, reason: "CARD_NOT_FOUND" };
    if (prior.status !== "ACTIVE") return { approved: false, reason: `CARD_STATUS_${prior.status}` };
    if (prior.spending_limit > 0 && prior.used_amount + amount > prior.spending_limit) {
      return { approved: false, reason: "LIMIT_EXCEEDED" };
    }
    const now = new Date().toISOString();
    await db.query(
      `UPDATE wallet_cards SET used_amount = used_amount + ?, updated_at = ? WHERE id = ?`,
      [amount, now, id]
    );
    return { approved: true };
  }

  async toPublicView(card: WalletCardRecord): Promise<any> {
    return {
      id: card.id,
      customer_id: card.customer_id,
      wallet_id: card.wallet_id,
      scheme: card.scheme,
      bin: card.bin,
      last4: card.last4,
      card_number_formatted: `${card.bin}XX XXXX XXXX ${card.last4}`,
      expiry: `${card.expiry_month}/${card.expiry_year}`,
      expiry_month: card.expiry_month,
      expiry_year: card.expiry_year,
      cardholder_name: card.cardholder_name,
      currency: card.currency,
      status: card.status,
      spending_limit: card.spending_limit,
      used_amount: card.used_amount,
      available_amount:
        card.spending_limit > 0
          ? Math.max(0, card.spending_limit - card.used_amount)
          : null,
      created_at: card.created_at,
      activated_at: card.activated_at,
      deactivated_at: card.deactivated_at,
      meta: card.meta_json,
    };
  }

  async toPrivateView(card: WalletCardRecord): Promise<any> {
    return {
      ...(await this.toPublicView(card)),
      card_number: card.card_number,
      card_number_formatted: card.card_number.replace(/(\d{4})(?=\d)/g, "$1 "),
      cvv: card.cvv,
      pan_encrypted: card.pan_encrypted,
      pan_kid: card.pan_kid,
    };
  }
}

export const walletVirtualCardService = new WalletVirtualCardService();
