import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { SECRET_KEY } from "../auth/auth.service";

const PIN_REGEX = /^\d{4,6}$/;

export class CustomerAuthService {
  /** customers.pin_code is added on demand so older databases self-heal. */
  private pinColumnsEnsured: Promise<void> | null = null;

  private ensurePinColumns(): Promise<void> {
    if (!this.pinColumnsEnsured) {
      this.pinColumnsEnsured = db
        .query("ALTER TABLE customers ADD COLUMN pin_code TEXT")
        .then(() => undefined)
        .catch(() => undefined); // column already present, or table missing — ignore
    }
    return this.pinColumnsEnsured;
  }

  /** 6-digit numeric PIN. */
  private generatePin(): string {
    return String(crypto.randomInt(100000, 1000000));
  }

  /**
   * Issue a fresh PIN to one customer. The merchant has to read the PIN out to the
   * customer, so a readable copy is kept in pin_code next to the bcrypt hash.
   */
  async issuePin(customerId: string): Promise<string> {
    await this.ensurePinColumns();
    const pin = this.generatePin();
    const hash = await bcrypt.hash(pin, 10);
    await db.query(
      "UPDATE customers SET pin_hash = ?, pin_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [hash, pin, customerId]
    );
    return pin;
  }

  /**
   * Issue a PIN to every customer that has no readable PIN yet — i.e. every customer
   * created before PINs were issued, or whose PIN was reset before pin_code existed.
   * Returns how many were issued.
   */
  async ensureAllCustomerPins(): Promise<number> {
    await this.ensurePinColumns();
    const rows = (await db.query(
      "SELECT id FROM customers WHERE pin_code IS NULL OR pin_code = ''"
    )).rows as any[];
    for (const row of rows) {
      await this.issuePin(row.id);
    }
    return rows.length;
  }

  /** The PIN currently issued to a customer, issuing one if they have none yet. */
  async getOrIssuePin(customerId: string): Promise<string | null> {
    await this.ensurePinColumns();
    const row = (await db.query(
      "SELECT pin_code, pin_hash FROM customers WHERE id = ?",
      [customerId]
    )).rows[0] as any;
    if (!row) return null;
    if (row.pin_code && row.pin_hash) return row.pin_code;
    return this.issuePin(customerId);
  }

  /** Normalise a portal wallet code (e.g. "psw-1234-5678" → "PSW-1234-5678"). */
  private normalizeWalletCode(code: string): string {
    return String(code || "").trim().toUpperCase();
  }

  private assertValidPin(pin: string) {
    if (!PIN_REGEX.test(String(pin || "").trim())) {
      throw new Error("PIN must be 4 to 6 digits");
    }
  }

  /** Resolve a customer id from their wallet code (PSW-xxxx-xxxx). */
  async findCustomerByWalletCode(walletCode: string) {
    const code = this.normalizeWalletCode(walletCode);
    if (!code) throw new Error("Wallet code is required");
    const res = await db.query(
      `SELECT cw.customer_id, cw.wallet_code
         FROM customer_wallets cw
        WHERE UPPER(cw.wallet_code) = ?
        LIMIT 1`,
      [code]
    );
    return res.rows[0] || null;
  }

  /** Log in with wallet code + PIN. Returns a short-lived customer JWT. */
  async login(walletCode: string, pin: string) {
    if (!walletCode || !pin) throw new Error("Wallet code and PIN are required");
    const match = await this.findCustomerByWalletCode(walletCode);
    if (!match) throw new Error("Invalid wallet code or PIN");

    const customer = (await db.query(
      "SELECT id, name, email, phone, pin_hash FROM customers WHERE id = ?",
      [match.customer_id]
    )).rows[0] as any;
    if (!customer) throw new Error("Invalid wallet code or PIN");
    if (!customer.pin_hash) {
      throw new Error("Portal PIN not set. Ask your merchant to issue a PIN for this wallet.");
    }

    const valid = await bcrypt.compare(String(pin).trim(), customer.pin_hash);
    if (!valid) throw new Error("Invalid wallet code or PIN");

    const token = jwt.sign(
      { sub: customer.id, role: "customer", wallet_code: match.wallet_code },
      SECRET_KEY as string,
      { expiresIn: "12h" }
    );

    return {
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        wallet_code: match.wallet_code,
      },
    };
  }

  async getProfile(customerId: string) {
    const rows = (await db.query("SELECT * FROM customers WHERE id = ?", [customerId])).rows as any[];
    if (!rows.length) throw new Error("Customer not found");
    const { pin_hash, ...safe } = rows[0];
    return { ...safe, pin_set: !!pin_hash };
  }

  async updateProfile(customerId: string, profile: any) {
    const editable: Array<[string, string]> = [
      ["name", "name"],
      ["email", "email"],
      ["phone", "phone"],
      ["address_line1", "address_line1"],
      ["address_line2", "address_line2"],
      ["city", "city"],
      ["country", "country"],
      ["postal_code", "postal_code"],
      ["occupation", "occupation"],
      ["nationality", "nationality"],
      ["date_of_birth", "date_of_birth"],
    ];

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of editable) {
      if (profile[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(profile[key] === "" ? null : profile[key]);
      }
    }
    if (!fields.length) return { status: true, message: "No changes" };

    values.push(customerId);
    await db.query(`UPDATE customers SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    return { status: true, message: "Profile updated successfully" };
  }

  async changePin(customerId: string, currentPin: string, newPin: string) {
    this.assertValidPin(newPin);
    await this.ensurePinColumns();
    const customer = (await db.query("SELECT pin_hash FROM customers WHERE id = ?", [customerId])).rows[0] as any;
    if (!customer) throw new Error("Customer not found");
    if (customer.pin_hash) {
      const valid = await bcrypt.compare(String(currentPin || "").trim(), customer.pin_hash);
      if (!valid) throw new Error("Current PIN is incorrect");
    }
    const hash = await bcrypt.hash(String(newPin).trim(), 10);
    await db.query("UPDATE customers SET pin_hash = ?, pin_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hash, String(newPin).trim(), customerId]);
    return { status: true, message: "PIN updated successfully" };
  }

  /** Merchant/admin action: issue or reset a customer's portal PIN. */
  async setPin(customerId: string, pin: string) {
    this.assertValidPin(pin);
    await this.ensurePinColumns();
    const exists = (await db.query("SELECT id FROM customers WHERE id = ?", [customerId])).rows;
    if (!exists.length) throw new Error("Customer not found");
    const hash = await bcrypt.hash(String(pin).trim(), 10);
    await db.query("UPDATE customers SET pin_hash = ?, pin_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hash, String(pin).trim(), customerId]);
    return { status: true, message: "Customer portal PIN set" };
  }
}

export const customerAuthService = new CustomerAuthService();
