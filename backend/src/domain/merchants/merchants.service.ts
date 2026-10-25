import { db } from "../../config/db";

/**
 * A "merchant profile" is the merchant_settings row keyed by merchant_id —
 * this schema has no `merchants` table, so merchant_settings is the profile of
 * record. Terminals and wallets link back to it via merchant_id.
 */

// Tables that hold money movement or its audit trail for a merchant. Deleting a
// profile that has any of these would destroy the financial audit trail.
const FINANCIAL_ACTIVITY_TABLES: { table: string; label: string }[] = [
  { table: "pos2013_transactions", label: "POS transactions" },
  { table: "merchant_pos_settlements", label: "POS settlements" },
  { table: "merchant_payouts", label: "payouts" },
  { table: "payouts", label: "payout instructions" },
  { table: "cashouts", label: "cashouts" },
  { table: "ledger_entries", label: "ledger entries" },
  { table: "receipts", label: "receipts" },
  { table: "settlement_batches", label: "settlement batches" },
];

export interface MerchantWalletBalance {
  currency: string;
  balance: number;
}

// merchant_settings predates created_at and older databases never had it, while the
// profile queries below need it. Add it on first use so every database self-heals.
let profileColumnsEnsured: Promise<void> | null = null;
function ensureProfileColumns(): Promise<void> {
  if (!profileColumnsEnsured) {
    profileColumnsEnsured = db
      .query(`ALTER TABLE merchant_settings ADD COLUMN created_at TEXT`)
      .then(() => undefined)
      .catch(() => undefined); // column already present, or table missing — ignore
  }
  return profileColumnsEnsured;
}

export interface MerchantProfile {
  merchantId: string;
  merchantName: string;
  supportEmail: string | null;
  testMode: boolean;
  licenseNumber: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  bankName: string | null;
  bankAccountHolder: string | null;
  bankIban: string | null;
  bankSwiftCode: string | null;
  terminalCount: number;
  wallets: MerchantWalletBalance[];
  totalBalance: number;
  createdAt: string | null;
  updatedAt: string | null;
  deletable: boolean;
  deleteBlockers: string[];
}

export class MerchantsService {
  private mapProfile(row: any): Omit<MerchantProfile, "terminalCount" | "wallets" | "totalBalance" | "deletable" | "deleteBlockers"> {
    return {
      merchantId: row.merchant_id,
      merchantName: row.merchant_name || row.merchant_id,
      supportEmail: row.support_email ?? null,
      testMode: Boolean(row.test_mode),
      licenseNumber: row.license_number ?? null,
      taxId: row.tax_id ?? null,
      address: row.merchant_address ?? null,
      phone: row.merchant_phone ?? null,
      bankName: row.bank_name ?? null,
      bankAccountHolder: row.bank_account_holder ?? null,
      bankIban: row.bank_iban ?? null,
      bankSwiftCode: row.bank_swift_code ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  /** Reasons this profile cannot be deleted. Empty array means it is safe to delete. */
  private async collectDeleteBlockers(merchantId: string): Promise<string[]> {
    const blockers: string[] = [];

    const walletRows = await db.query(
      `SELECT currency, balance FROM merchant_wallets WHERE merchant_id = ?`,
      [merchantId]
    );
    const funded = (walletRows.rows as any[]).filter((w) => Number(w.balance || 0) !== 0);
    if (funded.length) {
      blockers.push(
        `holds a non-zero wallet balance (${funded
          .map((w) => `${Number(w.balance)} ${w.currency}`)
          .join(", ")}). Withdraw or move the funds first`
      );
    }

    const walletTxn = await db.query(
      `SELECT COUNT(*) AS count FROM merchant_wallet_transactions
        WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id = ?)`,
      [merchantId]
    );
    if (Number(walletTxn.rows[0]?.count || 0) > 0) {
      blockers.push(`${Number(walletTxn.rows[0].count)} wallet transaction(s)`);
    }

    for (const { table, label } of FINANCIAL_ACTIVITY_TABLES) {
      const res = await db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE merchant_id = ?`, [merchantId]);
      const count = Number(res.rows[0]?.count || 0);
      if (count > 0) blockers.push(`${count} ${label}`);
    }

    return blockers;
  }

  async listMerchantProfiles(): Promise<MerchantProfile[]> {
    await ensureProfileColumns();
    const settings = await db.query(
      `SELECT merchant_id, merchant_name, support_email, test_mode, license_number, tax_id,
              merchant_address, merchant_phone, bank_name, bank_account_holder, bank_iban, bank_swift_code,
              COALESCE(created_at, updated_at) AS created_at, updated_at
         FROM merchant_settings
        ORDER BY COALESCE(created_at, updated_at) ASC`
    );

    const wallets = await db.query(
      `SELECT merchant_id, currency, balance FROM merchant_wallets`
    );
    const terminalCounts = await db.query(
      `SELECT merchant_id, COUNT(*) AS count FROM terminals GROUP BY merchant_id`
    );

    const walletsByMerchant = new Map<string, MerchantWalletBalance[]>();
    for (const w of wallets.rows as any[]) {
      const list = walletsByMerchant.get(w.merchant_id) || [];
      list.push({ currency: w.currency, balance: Number(w.balance || 0) });
      walletsByMerchant.set(w.merchant_id, list);
    }

    const terminalsByMerchant = new Map<string, number>();
    for (const t of terminalCounts.rows as any[]) {
      terminalsByMerchant.set(t.merchant_id, Number(t.count || 0));
    }

    const profiles: MerchantProfile[] = [];
    for (const row of settings.rows as any[]) {
      const merchantWallets = (walletsByMerchant.get(row.merchant_id) || []).sort((a, b) =>
        a.currency.localeCompare(b.currency)
      );
      const deleteBlockers = await this.collectDeleteBlockers(row.merchant_id);
      profiles.push({
        ...this.mapProfile(row),
        terminalCount: terminalsByMerchant.get(row.merchant_id) || 0,
        wallets: merchantWallets,
        totalBalance: merchantWallets.reduce((sum, w) => sum + w.balance, 0),
        deletable: deleteBlockers.length === 0,
        deleteBlockers,
      });
    }
    return profiles;
  }

  async getMerchantProfile(merchantId: string): Promise<MerchantProfile> {
    await ensureProfileColumns();
    const res = await db.query(
      `SELECT merchant_id, merchant_name, support_email, test_mode, license_number, tax_id,
              merchant_address, merchant_phone, bank_name, bank_account_holder, bank_iban, bank_swift_code,
              COALESCE(created_at, updated_at) AS created_at, updated_at
         FROM merchant_settings WHERE merchant_id = ?`,
      [merchantId]
    );
    if (!res.rows.length) throw new Error(`Merchant profile ${merchantId} not found`);
    const row = res.rows[0] as any;

    const wallets = await db.query(
      `SELECT currency, balance FROM merchant_wallets WHERE merchant_id = ? ORDER BY currency`,
      [merchantId]
    );
    const terminals = await db.query(
      `SELECT COUNT(*) AS count FROM terminals WHERE merchant_id = ?`,
      [merchantId]
    );
    const deleteBlockers = await this.collectDeleteBlockers(merchantId);
    const merchantWallets = (wallets.rows as any[]).map((w) => ({
      currency: w.currency,
      balance: Number(w.balance || 0),
    }));

    return {
      ...this.mapProfile(row),
      terminalCount: Number(terminals.rows[0]?.count || 0),
      wallets: merchantWallets,
      totalBalance: merchantWallets.reduce((sum, w) => sum + w.balance, 0),
      deletable: deleteBlockers.length === 0,
      deleteBlockers,
    };
  }

  async deleteMerchantProfile(merchantId: string, confirmationName: string) {
    if (!merchantId) throw new Error("merchantId is required");

    const existing = await db.query(
      `SELECT merchant_id, merchant_name FROM merchant_settings WHERE merchant_id = ?`,
      [merchantId]
    );
    if (!existing.rows.length) throw new Error(`Merchant profile ${merchantId} not found`);

    const row = existing.rows[0] as any;
    const expected = String(row.merchant_name || row.merchant_id || "").trim();
    const provided = String(confirmationName || "").trim();
    if (provided.toLowerCase() !== expected.toLowerCase() && provided.toLowerCase() !== String(merchantId).toLowerCase()) {
      throw new Error(`Confirmation name does not match the merchant profile. Type "${expected}" to confirm.`);
    }

    const deleteBlockers = await this.collectDeleteBlockers(merchantId);
    if (deleteBlockers.length) {
      throw new Error(
        `Merchant profile is not empty and delete is blocked to preserve the financial audit trail: ${deleteBlockers.join("; ")}.`
      );
    }

    const terminals = await db.query(`SELECT terminal_id FROM terminals WHERE merchant_id = ?`, [merchantId]);
    const removedTerminals = (terminals.rows as any[]).map((t) => t.terminal_id);
    const wallets = await db.query(`SELECT id FROM merchant_wallets WHERE merchant_id = ?`, [merchantId]);
    const removedWalletCount = wallets.rows.length;

    await db.query("BEGIN IMMEDIATE");
    try {
      await db.query(
        `DELETE FROM merchant_wallet_transactions
          WHERE wallet_id IN (SELECT id FROM merchant_wallets WHERE merchant_id = ?)`,
        [merchantId]
      );
      await db.query(`DELETE FROM merchant_wallets WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM terminals WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_business_info WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_bank_accounts WHERE merchant_id = ?`, [merchantId]);
      await db.query(`DELETE FROM merchant_settings WHERE merchant_id = ?`, [merchantId]);
      await db.query("COMMIT");
    } catch (error) {
      try { await db.query("ROLLBACK"); } catch (_) { /* preserve the original error */ }
      throw error;
    }

    return {
      merchantId,
      merchantName: expected,
      removedTerminals,
      removedWalletCount,
    };
  }
}

export const merchantsService = new MerchantsService();
