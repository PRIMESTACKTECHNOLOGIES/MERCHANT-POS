import { db } from "../../config/db";

const ESC = "\x1B";
const GS = "\x1D";
const LF = "\n";

const INIT_PRINTER = `${ESC}@`;
const ALIGN_CENTER = `${ESC}a\x01`;
const ALIGN_LEFT   = `${ESC}a\x00`;

const BOLD_ON      = `${ESC}E\x01`;
const BOLD_OFF     = `${ESC}E\x00`;
const DOUBLE_H     = `${ESC}!\x10`;
const DOUBLE_WH    = `${ESC}!\x30`;
const NORMAL       = `${ESC}!\x00`;

const PAPER_FULL_CUT = `${GS}V\x00`;

export interface ThermalRendered {
  customer: string;
  merchant: string;
  combined: string;
  browserCustomer: string;
  browserMerchant: string;
  browserCombined: string;
  htmlCustomer: string;
  htmlMerchant: string;
  htmlCombined: string;
}

export interface ThermalTxnFull {
  id: string;
  local_txn_id: string;
  merchant_id: string;
  terminal_id: string;
  terminal_name?: string;
  batch_id: string;
  stan: string;
  amount_minor: number;
  currency: string;
  pan_masked: string;
  card_brand?: string;
  txn_type?: string;
  auth_mode?: string;
  entry_mode?: string;
  reader_source?: string;
  cvm_result?: string;
  pin_verified?: number;
  rrn?: string;
  auth_code?: string;
  status?: string;
  txn_timestamp: string;
  pi_id?: string;
  protocol_version?: string;

  batch_seq?: number;
  settlement_code?: string;
  batch_status?: string;
  upload_timestamp?: string;
  beneficiary_bank?: string;
  beneficiary_account_last4?: string;
  beneficiary_routing?: string;
  beneficiary_name?: string;
  settlement_bank?: string;

  merchant_name?: string;
  merchant_address?: string;
  merchant_phone?: string;
  receipt_header?: string;
  receipt_footer?: string;

  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_id?: string;

  card_program?: string;
  cvv_provided?: number;
  expiry_mm_yy?: string;

  tranche?: {
    agreement_total?: number;
    tranche_1?: number;
    tranches_remaining_after_this?: number;
    total_agreement_usd?: number;
    tranches_total_expected?: number;
    tranches_completed?: number;
    tranches_remaining_usd?: number;
  };

  floor_limit_raised_temporary_for_txn_only?: boolean;
  floor_limit_restored_post_commit?: number;
  terminal_floor_limit_permanent?: number;
}

export class ThermalReceiptService {
  private padR(width: number, left: string, right: string): string {
    const l = String(left || "").slice(0, width - 4);
    const r = String(right || "").slice(0, width - 4);
    const gap = Math.max(1, width - l.length - r.length);
    return l + " ".repeat(gap) + r;
  }

  private padRLong(width: number, label: string, value: string, minCharsForLine2: number = 26): string[] {
    const labelTrim = String(label || "").replace(/:\s*$/, ":");
    const v = String(value || "");
    if (v.length <= minCharsForLine2) {
      return [this.padR(width, labelTrim, v)];
    }
    const lines: string[] = [];
    lines.push(labelTrim);
    const indented = "  " + v;
    for (let i = 0; i < indented.length; i += width) {
      lines.push(indented.slice(i, i + width));
    }
    return lines;
  }

  private line40(c: string = "─") { return c.repeat(40); }

  fmtAmountMinor(amountMinor: number, currency: string = "USD"): string {
    const v = (Number(amountMinor) / 100);
    const sym = currency.toUpperCase() === "USD" ? "$" : "";
    return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
  }

  fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      });
    } catch { return iso || ""; }
  }

  fmtDateShort(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch { return iso || ""; }
  }

  async loadFullTransaction(transactionId: string, merchantId: string): Promise<ThermalTxnFull | null> {
    const sql = `
      SELECT
        t.id, t.local_txn_id, t.merchant_id, t.terminal_id, t.batch_id, t.stan,
        t.amount_minor, t.currency, t.pan_masked, t.card_brand, t.txn_type,
        t.auth_mode, t.entry_mode, t.reader_source, t.cvm_result, t.pin_verified,
        t.rrn, t.auth_code, t.status, t.txn_timestamp,
        t.emv_data,
        b.protocol_version, b.settlement_code, b.status AS batch_status,
        b.upload_timestamp, b.batch_seq,
        b.batch_file,
        m.business_name AS merchant_name, m.business_address AS merchant_address,
        m.business_phone AS merchant_phone, m.receipt_header AS receipt_header,
        m.receipt_footer AS receipt_footer,
        s.merchant_name AS ms_name,
        ter.name AS terminal_name, ter.floor_limit AS terminal_floor_limit_permanent
      FROM pos2013_transactions t
      LEFT JOIN pos2013_batches b ON t.batch_id = b.batch_id
      LEFT JOIN merchant_business_info m ON t.merchant_id = m.merchant_id
      LEFT JOIN merchant_settings s ON t.merchant_id = s.merchant_id
      LEFT JOIN terminals ter ON t.terminal_id = ter.terminal_id
      WHERE t.id = ? AND t.merchant_id = ?
      LIMIT 1
    `;
    const rows = await db.query(sql, [transactionId, merchantId]);
    if (rows.rows.length === 0) return null;

    const row: any = rows.rows[0];
    const full: ThermalTxnFull = { ...row };

    let emv: any = {};
    try {
      if (row.emv_data) {
        const raw = typeof row.emv_data === "string" ? row.emv_data : JSON.stringify(row.emv_data);
        emv = JSON.parse(raw);
      }
    } catch { emv = {}; }

    let batchFileJson: any = null;
    try {
      if (row.batch_file) {
        const path0 = require("path");
        const fs0 = require("fs");
        const tryPaths: string[] = [];
        const basename0 = path0.basename(row.batch_file);
        tryPaths.push(path0.resolve(__dirname, "..", "..", "..", "..", basename0));
        tryPaths.push(path0.resolve(__dirname, "..", "..", "..", row.batch_file));
        tryPaths.push(path0.resolve(__dirname, "..", "..", "..", "..", row.batch_file));
        for (const p of tryPaths) { if (fs0.existsSync(p)) { batchFileJson = JSON.parse(fs0.readFileSync(p, "utf8")); break; } }
      }
    } catch { batchFileJson = null; }

    const bfTx: any =
      batchFileJson?.transactions?.find((tx: any) =>
        (tx.id && tx.id === row.id) ||
        (tx.pos_id && tx.pos_id === row.id) ||
        (tx.stan && tx.stan === row.stan)
      ) || batchFileJson;

    full.customer_name   = (emv.customer_name || emv.cardholder_full || batchFileJson?.customer_name || bfTx?.cardholder || bfTx?.cardholder_full || bfTx?.customer?.name || "").trim() || null;
    full.customer_id     = emv.customer_id || bfTx?.customer_id || null;
    full.customer_phone  = emv.customer_phone || bfTx?.customer_phone || null;
    full.customer_email  = emv.customer_email || bfTx?.customer_email || null;
    full.pi_id           = emv.pi_id || emv.pi || bfTx?.pi_id || batchFileJson?.pi_id || null;

    full.card_program    = emv.card_program || emv.card_class || emv.account_type || (emv.card_gold_debit ? "GOLD DEBIT" : null) || null;
    full.cvv_provided    = typeof emv.cvv_provided === "boolean" ? (emv.cvv_provided ? 1 : 0) : (typeof emv.cvv_provided === "number" ? emv.cvv_provided : undefined);

    if (emv.expiry_mm && emv.expiry_yy) {
      const mm = String(emv.expiry_mm).padStart(2, "0");
      const yy = String(emv.expiry_yy).slice(-2);
      full.expiry_mm_yy = `${mm}/${yy}`;
    } else if (bfTx?.expiry_mm_yy) {
      full.expiry_mm_yy = bfTx.expiry_mm_yy;
    }

    const ti: any = emv.tranche_info || bfTx?.tranche || batchFileJson?.tranche || {};
    const ag: any = emv.agreement || bfTx?.agreement || batchFileJson?.agreement || {};

    if (ti.agreement_amount || ag.total_agreement_usd || ti.total_tranches_expected) {
      const totalAgreement = ag.total_agreement_usd || ti.agreement_amount || ti.agreement_total || null;
      const totalTranches  = ag.tranches_total_expected || ti.total_tranches_expected || null;
      const completed      = ag.tranches_completed || ti.tranche_number || 1;
      const remainingUsd   = ag.tranches_remaining_usd || (totalAgreement && ti.first_tranche ? totalAgreement - ti.first_tranche : null) || null;
      const afterThis      = ti.tranches_remaining_after_this_one || (totalTranches && ti.tranche_number ? (totalTranches - ti.tranche_number) : null) || null;
      full.tranche = {
        agreement_total:              totalAgreement,
        tranche_1:                    ti.first_tranche || ti.tranche_1 || null,
        tranches_remaining_after_this: afterThis,
        total_agreement_usd:          totalAgreement,
        tranches_total_expected:      totalTranches,
        tranches_completed:           completed,
        tranches_remaining_usd:       remainingUsd
      };
    }

    full.settlement_bank    = emv.settlement_bank || emv.issuer_bank || batchFileJson?.settlement_bank || (batchFileJson?.batch && batchFileJson.batch.settlement_bank) || null;
    full.beneficiary_bank   = emv.beneficiary_bank || emv.issuer_bank || batchFileJson?.beneficiary_bank || (batchFileJson?.bank && batchFileJson.bank.name) || null;
    full.beneficiary_name   = emv.beneficiary_name || batchFileJson?.beneficiary_name || (batchFileJson?.beneficiary_routing_meta && batchFileJson.beneficiary_routing_meta.name) || (full.customer_name || null);
    full.beneficiary_account_last4 = emv.beneficiary_account_last4 || (batchFileJson?.beneficiary_routing_meta && batchFileJson.beneficiary_routing_meta.account_last_4) || (emv.pan ? String(emv.pan).slice(-4) : null) || (row.pan_masked ? String(row.pan_masked).replace(/[^0-9]/g,"").slice(-4) : null) || null;
    full.beneficiary_routing = emv.beneficiary_routing || emv.issuer_swift || (batchFileJson?.beneficiary_routing_meta && (batchFileJson.beneficiary_routing_meta.routing || batchFileJson.beneficiary_routing_meta.swift)) || null;

    const floorJson: any =
      (batchFileJson?.floor_limit_raised_temporary_for_txn_only !== undefined ? batchFileJson : null) ||
      (bfTx?.floor_limit_raised_temporary_for_txn_only !== undefined ? bfTx : null) || null;

    const tempFloor =
      emv.floor_limit_raised_temporary_for_txn_only === true ||
      (floorJson && floorJson.floor_limit_raised_temporary_for_txn_only === true) ||
      (row.amount_minor / 100 > 5000 && (floorJson?.floor_limit_raised_temporary_for_txn_only || emv.floor_limit_raised_temporary_for_txn_only !== false));
    const restoredPost =
      emv.floor_limit_restored_post_commit ??
      (floorJson && floorJson.floor_limit_restored_post_commit) ??
      (row.amount_minor / 100 > 5000 ? 5000 : null);

    full.floor_limit_raised_temporary_for_txn_only = !!tempFloor;
    full.floor_limit_restored_post_commit          = restoredPost;

    if (!full.terminal_name) full.terminal_name = "Main Terminal";
    const mnRaw = String(full.merchant_name || "").trim();
    const isPlaceholder = mnRaw.length === 0 || /default\s*store/i.test(mnRaw);
    const msRaw = String(row.ms_name || "").trim();
    const msOk = msRaw.length > 0 && !/default\s*store/i.test(msRaw);
    full.merchant_name = isPlaceholder ? (msOk ? msRaw : "PRIMESTACK TECHNOLOGIES LLC") : full.merchant_name;
    if (!full.receipt_footer) full.receipt_footer = "Thank you for your business!";
    if (!full.merchant_address) full.merchant_address = "Wilmington, DE, USA";
    if (!full.merchant_phone) full.merchant_phone = "+1 (302) 000-0000";

    return full;
  }

  build80mmCopy(tx: ThermalTxnFull, copyLabel: string): string {
    const out: string[] = [];
    out.push(ALIGN_LEFT);
    out.push(NORMAL);

    const mnRaw = String(tx.merchant_name || "").trim();
    const isPlaceholder = mnRaw.length === 0 || /default\s*store/i.test(mnRaw);
    const finalMerchantName = isPlaceholder ? "PRIMESTACK TECHNOLOGIES LLC" : tx.merchant_name;

    out.push(ALIGN_CENTER);
    out.push(BOLD_ON);
    out.push(DOUBLE_H);
    out.push(String(finalMerchantName).toUpperCase());
    out.push(NORMAL);
    out.push(BOLD_OFF);
    out.push(tx.merchant_address || "");
    if (tx.merchant_phone) out.push(`TEL: ${tx.merchant_phone}`);
    out.push(this.line40("═"));
    out.push(LF);

    out.push(ALIGN_CENTER);
    out.push(BOLD_ON);
    out.push(DOUBLE_H);
    out.push(`*** ${copyLabel} ***`);
    out.push(NORMAL);
    out.push(BOLD_OFF);
    out.push(LF);

    out.push(ALIGN_LEFT);
    out.push(this.padR(40, "RECEIPT NO:", `RCP-${String(tx.id || "").slice(0, 8).toUpperCase()}`));
    out.push(this.padR(40, "DATE/TIME:", this.fmtDate(tx.txn_timestamp)));
    out.push(this.line40("─"));
    out.push(LF);

    out.push(BOLD_ON);
    out.push("CARDHOLDER DETAILS");
    out.push(BOLD_OFF);
    out.push(this.padR(40, "NAME:", tx.customer_name || "NOT PROVIDED"));
    if (tx.customer_phone) out.push(this.padR(40, "PHONE:", tx.customer_phone));
    if (tx.customer_email) out.push(this.padR(40, "EMAIL:", tx.customer_email));
    if (tx.customer_id) out.push(this.padR(40, "CUST ID:", tx.customer_id));
    out.push(this.line40("─"));
    out.push(LF);

    out.push(BOLD_ON);
    out.push("CARD DETAILS");
    out.push(BOLD_OFF);
    out.push(this.padR(40, "CARD BRAND:", (tx.card_brand || "VISA").toUpperCase()));
    out.push(this.padR(40, "CARD NO:", tx.pan_masked || "****-****-****-****"));
    if (tx.card_program) out.push(this.padR(40, "CARD PROG:", String(tx.card_program).toUpperCase()));
    if (tx.expiry_mm_yy)  out.push(this.padR(40, "EXPIRY:", tx.expiry_mm_yy));
    if (tx.cvv_provided !== undefined) {
      out.push(this.padR(40, "CVV:", tx.cvv_provided ? "VERIFIED (***)" : "NOT PRESENT"));
    }
    out.push(this.padR(40, "ENTRY MODE:", tx.entry_mode || "MANUAL"));
    out.push(this.padR(40, "PIN VERIFIED:", tx.pin_verified ? "YES" : "NO"));
    if (tx.cvm_result) out.push(this.padR(40, "CVM:", tx.cvm_result));
    if (tx.reader_source) out.push(this.padR(40, "READER:", tx.reader_source));
    out.push(this.line40("─"));
    out.push(LF);

    out.push(ALIGN_CENTER);
    out.push(BOLD_ON);
    out.push("TOTAL TRANSACTION AMOUNT");
    out.push(LF);
    out.push(DOUBLE_WH);
    out.push(this.fmtAmountMinor(tx.amount_minor, tx.currency));
    out.push(NORMAL);
    out.push(BOLD_OFF);
    out.push(LF);
    out.push(this.line40("─"));
    out.push(LF);

    out.push(ALIGN_LEFT);
    out.push(BOLD_ON);
    out.push("TRANSACTION DETAILS");
    out.push(BOLD_OFF);
    out.push(this.padR(40, "TXN TYPE:", (tx.txn_type || "SALE").toUpperCase()));
    out.push(this.padR(40, "AUTH MODE:", (tx.auth_mode || "OFFLINE_AUTH").toUpperCase()));
    out.push(this.padR(40, "PROTOCOL:", `VER ${tx.protocol_version || "101.1 PATH B"}`));
    if (tx.pi_id) out.push(...this.padRLong(40, "PI ID:", tx.pi_id, 24));
    out.push(this.padR(40, "STAN:", tx.stan || "N/A"));
    if (tx.rrn) out.push(...this.padRLong(40, "RRN:", tx.rrn, 24));
    out.push(this.padR(40, "AUTH CODE:", tx.auth_code || "N/A"));
    out.push(this.padR(40, "TERMINAL:", `${tx.terminal_id}${tx.terminal_name ? " (" + tx.terminal_name + ")" : ""}`));
    out.push(this.padR(40, "MERCHANT ID:", tx.merchant_id || "MRC-1001"));
    out.push(this.line40("─"));
    out.push(LF);

    out.push(BOLD_ON);
    out.push("BATCH & SETTLEMENT");
    out.push(BOLD_OFF);
    if (tx.batch_id) out.push(...this.padRLong(40, "BATCH ID:", tx.batch_id, 24));
    if (tx.batch_seq) out.push(this.padR(40, "BATCH SEQ:", `#${tx.batch_seq}`));
    out.push(this.padR(40, "BATCH STATUS:", (tx.batch_status || "RECEIVED").toUpperCase()));
    if (tx.settlement_code) out.push(this.padR(40, "SETTLEMENT CODE:", tx.settlement_code));
    out.push(this.padR(40, "UPLOAD DATE:", tx.upload_timestamp ? this.fmtDateShort(tx.upload_timestamp) : "SCHEDULED"));
    if (tx.settlement_bank || tx.beneficiary_bank) {
      out.push(this.padR(40, "SETTLE BANK:", tx.settlement_bank || tx.beneficiary_bank || ""));
    }
    if (tx.beneficiary_name)         out.push(this.padR(40, "BENEF NAME:", tx.beneficiary_name));
    if (tx.beneficiary_account_last4) out.push(this.padR(40, "BENEF ACCT:", `**** ${tx.beneficiary_account_last4}`));
    if (tx.beneficiary_routing)       out.push(this.padR(40, "BENEF RTG:", tx.beneficiary_routing));
    out.push(this.line40("─"));
    out.push(LF);

    const tr = tx.tranche;
    if (tr && (tr.total_agreement_usd || tr.agreement_total || tr.tranches_total_expected)) {
      out.push(BOLD_ON);
      out.push("TRANCHE & MASTER AGREEMENT");
      out.push(BOLD_OFF);
      if (tr.total_agreement_usd) {
        out.push(this.padR(40, "MASTER TOTAL:", `$${Number(tr.total_agreement_usd).toLocaleString("en-US")} USD`));
      } else if (tr.agreement_total) {
        out.push(this.padR(40, "MASTER TOTAL:", `$${Number(tr.agreement_total).toLocaleString("en-US")} USD`));
      }
      out.push(this.padR(40, "TRANCHE AMT:", this.fmtAmountMinor(tx.amount_minor, tx.currency)));
      if (tr.tranches_total_expected) {
        out.push(this.padR(40, "TRANCHE No:", `${tr.tranches_completed || 1} OF ${tr.tranches_total_expected}`));
      }
      if (tr.tranches_remaining_usd) {
        out.push(this.padR(40, "REMAINING:", `$${Number(tr.tranches_remaining_usd).toLocaleString("en-US")} USD`));
      }
      out.push(this.line40("─"));
      out.push(LF);
    }

    out.push(BOLD_ON);
    out.push("TERMINAL FLOOR LIMITS");
    out.push(BOLD_OFF);
    out.push(this.padR(40, "PERMANENT FLOOR:", `$${Number(tx.terminal_floor_limit_permanent || 5000).toLocaleString("en-US")}`));
    if (tx.floor_limit_raised_temporary_for_txn_only) {
      out.push(this.padR(40, "TEMP FLOOR RAISE:", "APPLIED (TXN ONLY)"));
    }
    if (tx.floor_limit_restored_post_commit) {
      out.push(this.padR(40, "FLOOR POST-TXN:", `$${Number(tx.floor_limit_restored_post_commit).toLocaleString("en-US")} (RESTORED)`));
    }
    out.push(this.line40("─"));
    out.push(LF);

    out.push(ALIGN_CENTER);
    const s = String(tx.status || "AUTHORIZED").toUpperCase();
    const approved = s.includes("APPROV") || s.includes("AUTH");
    out.push(BOLD_ON);
    out.push(DOUBLE_H);
    out.push(approved ? "✓ ✓ ✓  APPROVED / AUTHORIZED  ✓ ✓ ✓" : `STATUS: ${s}`);
    out.push(NORMAL);
    out.push(BOLD_OFF);
    out.push(LF);
    out.push(this.line40("═"));
    out.push(LF);

    out.push(ALIGN_LEFT);
    out.push("CARDHOLDER SIGNATURE:");
    out.push(LF);
    out.push(LF);
    out.push("  ____________________________________________  ");
    out.push(LF);
    out.push(this.padR(40, "PRINTED NAME:", "____________________"));
    out.push(LF);
    out.push(this.line40("─"));
    out.push(LF);

    out.push(ALIGN_CENTER);
    out.push(tx.receipt_footer || "Thank you for your business!");
    out.push(LF);
    out.push("KEEP THIS RECEIPT FOR YOUR RECORDS");
    out.push(LF);
    out.push("ALL TRANSACTIONS SUBJECT TO CARDHOLDER AGREEMENT");
    out.push(LF);
    out.push(LF);
    out.push("*** END OF RECEIPT ***");
    out.push(LF);
    out.push(LF);
    out.push(LF);

    return out.join(LF);
  }

  build80mm(tx: ThermalTxnFull): { customer: string; merchant: string; combined: string; browserCustomer: string; browserMerchant: string; browserCombined: string } {
    const c = this.build80mmCopy(tx, "CUSTOMER COPY");
    const m = this.build80mmCopy(tx, "MERCHANT COPY");
    const makeBrowser = (raw: string): string => {
      const stripESC = (s: string) => {
        let o = s;
        o = o.replace(/\x1D\x56[\x00-\x01\x30-\x31][\x00-\xFF]?/g, "");
        o = o.replace(/\x1D[\x21-\x7E][\x00-\xFF]{0,2}/g, "");
        o = o.replace(/\x1B[\x21-\x7E][\x00-\xFF]{0,1}/g, "");
        o = o.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
        o = o.replace(/\r/g, "\n");
        return o;
      };
      const lines = stripESC(raw).split(/\n/).map(l => l.replace(/\s+$/g, ""));
      const clean: string[] = [];
      let lastWasBlank = false;
      for (const ln of lines) {
        if (ln.length === 0) {
          if (!lastWasBlank) clean.push("");
          lastWasBlank = true;
        } else {
          clean.push(ln.slice(0, 80));
          lastWasBlank = false;
        }
      }
      return clean.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
    };
    const bc = makeBrowser(c);
    const bm = makeBrowser(m);
    return {
      customer: c + PAPER_FULL_CUT,
      merchant: m + PAPER_FULL_CUT,
      combined: c + PAPER_FULL_CUT + LF + LF + LF + m + PAPER_FULL_CUT,
      browserCustomer: bc,
      browserMerchant: bm,
      browserCombined: bc + "\n\n\n--- MERCHANT COPY SEPARATOR ---\n\n\n" + bm
    };
  }

  async generateForTransaction(transactionId: string, merchantId: string) {
    const full = await this.loadFullTransaction(transactionId, merchantId);
    if (!full) return null;

    const copies = this.build80mm(full);

    const stripLegacy = (s: string) => s.replace(/[\x00-\x1F\x7F]/g, "");

    await db.query(
      `INSERT INTO receipts (id, receipt_id, transaction_id, merchant_id, receipt_data, generated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(receipt_id) DO UPDATE SET receipt_data = excluded.receipt_data, generated_at = datetime('now')`,
      [
        `LEGACY-${full.id}`,
        `RCP-${full.id}`,
        full.id,
        full.merchant_id,
        JSON.stringify({
          receiptId: `RCP-${full.id}`,
          thermalCombined: copies.combined,
          thermalCustomer: copies.customer,
          thermalMerchant: copies.merchant,
          browserCombined: copies.browserCombined,
          browserCustomer: copies.browserCustomer,
          browserMerchant: copies.browserMerchant,
          plainCustomer: copies.browserCustomer || stripLegacy(copies.customer),
          plainMerchant: copies.browserMerchant || stripLegacy(copies.merchant),
          fullTx: full
        })
      ]
    );

    return {
      receiptId: `RCP-${full.id}`,
      transaction: full,
      thermalCustomer: copies.customer,
      thermalMerchant: copies.merchant,
      thermalCombined: copies.combined,
      browserCustomer: copies.browserCustomer,
      browserMerchant: copies.browserMerchant,
      browserCombined: copies.browserCombined,
      plainCustomer: copies.browserCustomer || stripLegacy(copies.customer),
      plainMerchant: copies.browserMerchant || stripLegacy(copies.merchant)
    };
  }
}

export const thermalReceiptService = new ThermalReceiptService();
