import { db } from "../../config/db";
import { POS_BRAND_NAME, POS_PROTOCOL_VERSION, VAULT_DISPLAY_NAME, transactionChannel } from "../../config/brand";

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
  decline_reason?: string;
  created_at?: string;
  updated_at?: string;

  batch_seq?: number;
  settlement_code?: string;
  batch_status?: string;
  upload_timestamp?: string;
  batch_total_amount_minor?: number;
  batch_txn_count?: number;
  batch_processed_at?: string;
  batch_signature?: string;
  beneficiary_bank?: string;
  beneficiary_account_last4?: string;
  beneficiary_routing?: string;
  beneficiary_name?: string;
  settlement_bank?: string;

  merchant_name?: string;
  merchant_address?: string;
  merchant_phone?: string;
  merchant_email?: string;
  merchant_license?: string;
  merchant_tax_id?: string;
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

  ledger_entry_id?: string;
  settlement_id?: string;
  offline_approval_type?: string;
  emv_cryptogram_type?: string;
  customer_signature_required?: boolean;
  transaction_channel?: 'ONLINE' | 'OFFLINE';
  pos_brand_name?: string;
  vault_display_name?: string;
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
        t.emv_data, t.decline_reason, t.created_at, t.updated_at,
        b.protocol_version, b.settlement_code, b.status AS batch_status,
        b.upload_timestamp, b.batch_seq, b.total_amount_minor AS batch_total_amount_minor,
        b.txn_count AS batch_txn_count, b.processed_at AS batch_processed_at,
        b.signature AS batch_signature,
        b.batch_file,
        m.business_name AS merchant_name, m.business_address AS merchant_address,
        m.business_phone AS merchant_phone, m.receipt_header AS receipt_header,
        m.receipt_footer AS receipt_footer,
        s.merchant_name AS ms_name, s.support_email AS merchant_email,
        s.license_number AS merchant_license, s.tax_id AS merchant_tax_id,
        s.merchant_address AS ms_address, s.merchant_phone AS ms_phone,
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

    full.customer_name   = (emv.customer_name || emv.cardholder_full || emv.cardholder_name || batchFileJson?.customer_name || bfTx?.cardholder || bfTx?.cardholder_full || bfTx?.cardholder_name || bfTx?.customer?.name || "").trim() || null;
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
    } else if (emv.expiry) {
      const e = String(emv.expiry).replace(/[^0-9]/g, "");
      if (e.length === 4) full.expiry_mm_yy = `${e.slice(0,2)}/${e.slice(2,4)}`;
    }

    full.offline_approval_type = emv.offline_approval_type || emv.offline_auth_type || null;
    full.emv_cryptogram_type   = emv.cryptogram_type || emv.cid_type || emv.crypto_type || null;
    full.customer_signature_required = typeof emv.signature_required === "boolean" ? emv.signature_required : (emv.cvm_requires_signature ? true : undefined);

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

    try {
      const settleRows = await db.query(
        `SELECT id AS settlement_id, ledger_entry_id FROM merchant_pos_settlements
         WHERE merchant_id = ? AND (meta LIKE ? OR meta LIKE ?) LIMIT 1`,
        [
          merchantId,
          `%"paymentIntentId":"${transactionId}"%`,
          `%"processor_reference":"${transactionId}"%`
        ]
      );
      if (settleRows.rows?.length) {
        full.settlement_id = settleRows.rows[0].settlement_id;
        full.ledger_entry_id = settleRows.rows[0].ledger_entry_id;
      }
    } catch { /* ignore settlement lookup */ }

    if (!full.merchant_email) {
      full.merchant_email = emv.merchant_email || batchFileJson?.merchant_email || null;
    }
    if (!full.merchant_license) {
      full.merchant_license = emv.merchant_license || batchFileJson?.merchant_license || null;
    }
    if (!full.merchant_tax_id) {
      full.merchant_tax_id = emv.merchant_tax_id || batchFileJson?.merchant_tax_id || null;
    }
    if (!full.merchant_address && row.ms_address) {
      full.merchant_address = row.ms_address;
    }
    if (!full.merchant_phone && row.ms_phone) {
      full.merchant_phone = row.ms_phone;
    }

    if (!full.terminal_name) full.terminal_name = "Main Terminal";
    const mnRaw = String(full.merchant_name || "").trim();
    const isPlaceholder = mnRaw.length === 0 || /default\s*store/i.test(mnRaw);
    const msRaw = String(row.ms_name || "").trim();
    const msOk = msRaw.length > 0 && !/default\s*store/i.test(msRaw);
    full.merchant_name = isPlaceholder ? (msOk ? msRaw : POS_BRAND_NAME) : full.merchant_name;
    if (!full.receipt_footer) full.receipt_footer = "Thank you for your business!";
    if (!full.merchant_address) full.merchant_address = "Wilmington, DE, USA";
    if (!full.merchant_phone) full.merchant_phone = "+1 (302) 000-0000";
    full.transaction_channel = transactionChannel(full.auth_mode, full.batch_id);
    full.pos_brand_name = POS_BRAND_NAME;
    full.vault_display_name = VAULT_DISPLAY_NAME;

    return full;
  }

  build80mmCopy(tx: ThermalTxnFull, copyLabel: string): string {
    const out: string[] = [];
    out.push(ALIGN_LEFT);
    out.push(NORMAL);

    const mnRaw = String(tx.merchant_name || "").trim();
    const isPlaceholder = mnRaw.length === 0 || /default\s*store/i.test(mnRaw);
    const finalMerchantName = isPlaceholder ? POS_BRAND_NAME : tx.merchant_name;
    const statusRaw = String(tx.status || "AUTHORIZED").toUpperCase();
    const isDeclined = statusRaw.includes("DECLIN") || statusRaw.includes("FAIL") || statusRaw.includes("REJECT");
    const approved = !isDeclined && (statusRaw.includes("APPROV") || statusRaw.includes("AUTH"));

    out.push(ALIGN_CENTER);
    out.push(BOLD_ON);
    out.push(DOUBLE_H);
    out.push(String(finalMerchantName).toUpperCase());
    out.push(`${VAULT_DISPLAY_NAME} VAULT · ${tx.transaction_channel || transactionChannel(tx.auth_mode, tx.batch_id)} TRANSACTION`);
    out.push(NORMAL);
    out.push(BOLD_OFF);
    out.push(tx.merchant_address || "");
    if (tx.merchant_phone) out.push(`TEL: ${tx.merchant_phone}`);
    if (tx.merchant_email) out.push(`EMAIL: ${tx.merchant_email}`);
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
    if (tx.created_at && tx.created_at !== tx.txn_timestamp) {
      out.push(this.padR(40, "RECORDED AT:", this.fmtDate(tx.created_at)));
    }
    if (tx.updated_at) {
      out.push(this.padR(40, "LAST UPDATED:", this.fmtDate(tx.updated_at)));
    }
    out.push(this.line40("─"));
    out.push(LF);

    if (isDeclined && (tx.decline_reason || tx.status)) {
      out.push(ALIGN_CENTER);
      out.push(BOLD_ON);
      out.push(DOUBLE_H);
      out.push("✗ ✗ ✗  DECLINED / FAILED  ✗ ✗ ✗");
      out.push(NORMAL);
      out.push(BOLD_OFF);
      out.push(LF);
      out.push(ALIGN_LEFT);
      out.push(BOLD_ON);
      out.push("DECLINE DETAILS");
      out.push(BOLD_OFF);
      out.push(this.padR(40, "STATUS:", statusRaw));
      if (tx.decline_reason) {
        const dr = String(tx.decline_reason);
        const bracketMatch = dr.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (bracketMatch) {
          out.push(this.padR(40, "DECLINE CODE:", bracketMatch[1]));
          out.push(...this.padRLong(40, "REASON:", bracketMatch[2] || dr, 22));
        } else {
          out.push(...this.padRLong(40, "REASON:", dr, 22));
        }
      } else {
        out.push(this.padR(40, "REASON:", "Card not authorized"));
      }
      out.push(this.line40("─"));
      out.push(LF);
    }

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
    if (tx.emv_cryptogram_type) out.push(this.padR(40, "EMV CRYPTO:", String(tx.emv_cryptogram_type).toUpperCase()));
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
    out.push(this.padR(40, "POS BRAND:", tx.pos_brand_name || POS_BRAND_NAME));
    out.push(this.padR(40, "VAULT:", tx.vault_display_name || VAULT_DISPLAY_NAME));
    out.push(this.padR(40, "CHANNEL:", tx.transaction_channel || transactionChannel(tx.auth_mode, tx.batch_id)));
    out.push(this.padR(40, "PROTOCOL:", `VER ${tx.protocol_version || POS_PROTOCOL_VERSION}`));
    if (tx.offline_approval_type) out.push(this.padR(40, "OFFLINE AUTH:", String(tx.offline_approval_type).toUpperCase()));
    if (tx.pi_id) out.push(...this.padRLong(40, "PI ID:", tx.pi_id, 24));
    out.push(this.padR(40, "STAN:", tx.stan || "N/A"));
    if (tx.rrn) out.push(...this.padRLong(40, "RRN:", tx.rrn, 24));
    out.push(this.padR(40, "AUTH CODE:", tx.auth_code || "N/A"));
    out.push(this.padR(40, "TERMINAL:", `${tx.terminal_id}${tx.terminal_name ? " (" + tx.terminal_name + ")" : ""}`));
    out.push(this.padR(40, "MERCHANT ID:", tx.merchant_id || "MRC-1001"));
    if (tx.local_txn_id && tx.local_txn_id !== tx.id) {
      out.push(...this.padRLong(40, "LOCAL TXN ID:", tx.local_txn_id, 24));
    }
    out.push(this.line40("─"));
    out.push(LF);

    out.push(BOLD_ON);
    out.push("BATCH & SETTLEMENT");
    out.push(BOLD_OFF);
    if (tx.batch_id) out.push(...this.padRLong(40, "BATCH ID:", tx.batch_id, 24));
    if (tx.batch_seq) out.push(this.padR(40, "BATCH SEQ:", `#${tx.batch_seq}`));
    out.push(this.padR(40, "BATCH STATUS:", (tx.batch_status || "RECEIVED").toUpperCase()));
    if (tx.batch_txn_count !== undefined && tx.batch_txn_count !== null) {
      out.push(this.padR(40, "BATCH TXN CT:", String(tx.batch_txn_count)));
    }
    if (tx.batch_total_amount_minor !== undefined && tx.batch_total_amount_minor !== null) {
      out.push(this.padR(40, "BATCH TOTAL:", this.fmtAmountMinor(tx.batch_total_amount_minor, tx.currency)));
    }
    if (tx.settlement_code) out.push(this.padR(40, "SETTLEMENT CODE:", tx.settlement_code));
    out.push(this.padR(40, "UPLOAD DATE:", tx.upload_timestamp ? this.fmtDateShort(tx.upload_timestamp) : "SCHEDULED"));
    if (tx.batch_processed_at) out.push(this.padR(40, "PROCESSED AT:", this.fmtDate(tx.batch_processed_at)));
    if (tx.settlement_bank || tx.beneficiary_bank) {
      out.push(this.padR(40, "SETTLE BANK:", tx.settlement_bank || tx.beneficiary_bank || ""));
    }
    if (tx.beneficiary_name)         out.push(this.padR(40, "BENEF NAME:", tx.beneficiary_name));
    if (tx.beneficiary_account_last4) out.push(this.padR(40, "BENEF ACCT:", `**** ${tx.beneficiary_account_last4}`));
    if (tx.beneficiary_routing)       out.push(this.padR(40, "BENEF RTG:", tx.beneficiary_routing));
    if (tx.batch_signature) out.push(...this.padRLong(40, "BATCH SIG:", String(tx.batch_signature).slice(0, 32), 20));
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
      if (tr.tranches_remaining_after_this !== undefined && tr.tranches_remaining_after_this !== null) {
        out.push(this.padR(40, "LEFT AFTER:", `${tr.tranches_remaining_after_this} TRANCHE(S)`));
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

    const hasCompliance = tx.merchant_license || tx.merchant_tax_id || tx.merchant_email;
    if (hasCompliance) {
      out.push(BOLD_ON);
      out.push("MERCHANT COMPLIANCE INFO");
      out.push(BOLD_OFF);
      if (tx.merchant_license) out.push(...this.padRLong(40, "LICENSE #:", tx.merchant_license, 22));
      if (tx.merchant_tax_id)  out.push(...this.padRLong(40, "TAX ID:", tx.merchant_tax_id, 22));
      if (tx.merchant_email)   out.push(this.padR(40, "SUPPORT EMAIL:", tx.merchant_email));
      out.push(this.line40("─"));
      out.push(LF);
    }

    const hasAudit = tx.ledger_entry_id || tx.settlement_id || tx.batch_signature;
    if (hasAudit) {
      out.push(BOLD_ON);
      out.push("AUDIT & TRACEABILITY");
      out.push(BOLD_OFF);
      if (tx.ledger_entry_id) out.push(...this.padRLong(40, "LEDGER ENTRY:", tx.ledger_entry_id, 22));
      if (tx.settlement_id)   out.push(...this.padRLong(40, "SETTLEMENT ID:", tx.settlement_id, 22));
      out.push(this.line40("─"));
      out.push(LF);
    }

    out.push(ALIGN_CENTER);
    if (approved) {
      out.push(BOLD_ON);
      out.push(DOUBLE_H);
      out.push("✓ ✓ ✓  APPROVED / AUTHORIZED  ✓ ✓ ✓");
      out.push(NORMAL);
      out.push(BOLD_OFF);
    } else if (isDeclined) {
      out.push(BOLD_ON);
      out.push(DOUBLE_H);
      out.push("✗ ✗ ✗  DECLINED — DO NOT HONOR  ✗ ✗ ✗");
      out.push(NORMAL);
      out.push(BOLD_OFF);
    } else {
      out.push(BOLD_ON);
      out.push(DOUBLE_H);
      out.push(`STATUS: ${statusRaw}`);
      out.push(NORMAL);
      out.push(BOLD_OFF);
    }
    out.push(LF);
    out.push(this.line40("═"));
    out.push(LF);

    const needSig = tx.customer_signature_required !== false && approved;
    if (needSig) {
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
    }

    out.push(ALIGN_CENTER);
    out.push(tx.receipt_footer || "Thank you for your business!");
    out.push(LF);
    out.push("KEEP THIS RECEIPT FOR YOUR RECORDS");
    out.push(LF);
    out.push("ALL TRANSACTIONS SUBJECT TO CARDHOLDER AGREEMENT");
    if (isDeclined) {
      out.push(LF);
      out.push("CONTACT ISSUING BANK FOR FURTHER DETAILS");
    }
    out.push(LF);
    out.push(LF);
    out.push("*** END OF RECEIPT ***");
    out.push(LF);
    out.push(LF);
    out.push(LF);

    return out.join(LF);
  }

  private buildHtmlCopy(tx: ThermalTxnFull, copyLabel: string): string {
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tr = (label: string, value: any) => `<tr><th>${esc(label)}</th><td>${esc(value ?? "—")}</td></tr>`;
    const statusRaw = String(tx.status || "AUTHORIZED").toUpperCase();
    const isDeclined = statusRaw.includes("DECLIN") || statusRaw.includes("FAIL") || statusRaw.includes("REJECT");
    const approved = !isDeclined && (statusRaw.includes("APPROV") || statusRaw.includes("AUTH"));
    const mnRaw = String(tx.merchant_name || "").trim();
    const isPlaceholder = mnRaw.length === 0 || /default\s*store/i.test(mnRaw);
    const finalMerchantName = isPlaceholder ? POS_BRAND_NAME : tx.merchant_name;
    const statusClass = approved ? "ok" : (isDeclined ? "bad" : "warn");
    const statusText = approved
      ? "✓ ✓ ✓  APPROVED / AUTHORIZED  ✓ ✓ ✓"
      : (isDeclined ? "✗ ✗ ✗  DECLINED — DO NOT HONOR  ✗ ✗ ✗" : `STATUS: ${esc(statusRaw)}`);

    const sections: string[] = [];

    sections.push(`<header>
      <h1>${esc(String(finalMerchantName).toUpperCase())}</h1>
      <div class="addr">${esc(`${tx.vault_display_name || VAULT_DISPLAY_NAME} VAULT · ${tx.pos_brand_name || POS_BRAND_NAME} POS`)}</div>
      <div class="addr">${esc(tx.merchant_address || "")}</div>
      ${tx.merchant_phone ? `<div class="addr">TEL: ${esc(tx.merchant_phone)}</div>` : ""}
      ${tx.merchant_email ? `<div class="addr">EMAIL: ${esc(tx.merchant_email)}</div>` : ""}
      <div class="hr hr2"></div>
      <div class="copy-label">*** ${esc(copyLabel)} ***</div>
      <div class="meta">
        <div><span>RECEIPT NO:</span> <b>RCP-${esc(String(tx.id || "").slice(0, 8).toUpperCase())}</b></div>
        <div><span>DATE/TIME:</span> <b>${esc(this.fmtDate(tx.txn_timestamp))}</b></div>
        ${tx.created_at && tx.created_at !== tx.txn_timestamp ? `<div><span>RECORDED AT:</span> <b>${esc(this.fmtDate(tx.created_at))}</b></div>` : ""}
        ${tx.updated_at ? `<div><span>LAST UPDATED:</span> <b>${esc(this.fmtDate(tx.updated_at))}</b></div>` : ""}
      </div>
    </header>`);

    if (isDeclined && (tx.decline_reason || tx.status)) {
      const dr = String(tx.decline_reason || "");
      const bracketMatch = dr.match(/^\[([^\]]+)\]\s*(.*)$/);
      const dCode = bracketMatch ? bracketMatch[1] : "";
      const dReason = bracketMatch ? (bracketMatch[2] || dr) : dr;
      sections.push(`<section>
        <div class="status bad"><h3>✗ ✗ ✗  DECLINED / FAILED  ✗ ✗ ✗</h3></div>
        <h3>DECLINE DETAILS</h3>
        <table>
          ${tr("STATUS", statusRaw)}
          ${dCode ? tr("DECLINE CODE", dCode) : ""}
          ${(tx.decline_reason) ? `<tr><th>REASON:</th><td>${esc(dReason || "Card not authorized")}</td></tr>` : `<tr><th>REASON:</th><td>Card not authorized</td></tr>`}
        </table>
      </section>`);
    }

    sections.push(`<section>
      <h3>CARDHOLDER DETAILS</h3>
      <table>
        ${tr("NAME", tx.customer_name || "NOT PROVIDED")}
        ${tx.customer_phone ? tr("PHONE", tx.customer_phone) : ""}
        ${tx.customer_email ? tr("EMAIL", tx.customer_email) : ""}
        ${tx.customer_id ? tr("CUST ID", tx.customer_id) : ""}
      </table>
    </section>`);

    sections.push(`<section>
      <h3>CARD DETAILS</h3>
      <table>
        ${tr("CARD BRAND", (tx.card_brand || "VISA").toUpperCase())}
        ${tr("CARD NO", tx.pan_masked || "****-****-****-****")}
        ${tx.card_program ? tr("CARD PROG", String(tx.card_program).toUpperCase()) : ""}
        ${tx.expiry_mm_yy ? tr("EXPIRY", tx.expiry_mm_yy) : ""}
        ${(tx.cvv_provided !== undefined) ? tr("CVV", tx.cvv_provided ? "VERIFIED (***)" : "NOT PRESENT") : ""}
        ${tr("ENTRY MODE", tx.entry_mode || "MANUAL")}
        ${tr("PIN VERIFIED", tx.pin_verified ? "YES" : "NO")}
        ${tx.cvm_result ? tr("CVM", tx.cvm_result) : ""}
        ${tx.reader_source ? tr("READER", tx.reader_source) : ""}
        ${tx.emv_cryptogram_type ? tr("EMV CRYPTO", String(tx.emv_cryptogram_type).toUpperCase()) : ""}
      </table>
    </section>`);

    sections.push(`<section class="amount">
      <h3>TOTAL TRANSACTION AMOUNT</h3>
      <div class="amount-big">${esc(this.fmtAmountMinor(tx.amount_minor, tx.currency))}</div>
    </section>`);

    sections.push(`<section>
      <h3>TRANSACTION DETAILS</h3>
      <table>
        ${tr("TXN TYPE", (tx.txn_type || "SALE").toUpperCase())}
        ${tr("AUTH MODE", (tx.auth_mode || "OFFLINE_AUTH").toUpperCase())}
        ${tr("POS BRAND", tx.pos_brand_name || POS_BRAND_NAME)}
        ${tr("VAULT", tx.vault_display_name || VAULT_DISPLAY_NAME)}
        ${tr("CHANNEL", tx.transaction_channel || transactionChannel(tx.auth_mode, tx.batch_id))}
        ${tr("PROTOCOL", `VER ${tx.protocol_version || POS_PROTOCOL_VERSION}`)}
        ${tx.offline_approval_type ? tr("OFFLINE AUTH", String(tx.offline_approval_type).toUpperCase()) : ""}
        ${tx.pi_id ? `<tr><th>PI ID:</th><td>${esc(tx.pi_id)}</td></tr>` : ""}
        ${tr("STAN", tx.stan || "N/A")}
        ${tx.rrn ? `<tr><th>RRN:</th><td>${esc(tx.rrn)}</td></tr>` : ""}
        ${tr("AUTH CODE", tx.auth_code || "N/A")}
        ${tr("TERMINAL", `${tx.terminal_id}${tx.terminal_name ? " (" + tx.terminal_name + ")" : ""}`)}
        ${tr("MERCHANT ID", tx.merchant_id || "MRC-1001")}
        ${(tx.local_txn_id && tx.local_txn_id !== tx.id) ? `<tr><th>LOCAL TXN ID:</th><td>${esc(tx.local_txn_id)}</td></tr>` : ""}
      </table>
    </section>`);

    sections.push(`<section>
      <h3>BATCH &amp; SETTLEMENT</h3>
      <table>
        ${tx.batch_id ? `<tr><th>BATCH ID:</th><td>${esc(tx.batch_id)}</td></tr>` : ""}
        ${tx.batch_seq ? tr("BATCH SEQ", `#${tx.batch_seq}`) : ""}
        ${tr("BATCH STATUS", (tx.batch_status || "RECEIVED").toUpperCase())}
        ${((tx.batch_txn_count !== undefined) && (tx.batch_txn_count !== null)) ? tr("BATCH TXN CT", String(tx.batch_txn_count)) : ""}
        ${((tx.batch_total_amount_minor !== undefined) && (tx.batch_total_amount_minor !== null)) ? tr("BATCH TOTAL", this.fmtAmountMinor(tx.batch_total_amount_minor, tx.currency)) : ""}
        ${tx.settlement_code ? tr("SETTLEMENT CODE", tx.settlement_code) : ""}
        ${tr("UPLOAD DATE", tx.upload_timestamp ? this.fmtDateShort(tx.upload_timestamp) : "SCHEDULED")}
        ${tx.batch_processed_at ? tr("PROCESSED AT", this.fmtDate(tx.batch_processed_at)) : ""}
        ${(tx.settlement_bank || tx.beneficiary_bank) ? tr("SETTLE BANK", tx.settlement_bank || tx.beneficiary_bank || "") : ""}
        ${tx.beneficiary_name ? tr("BENEF NAME", tx.beneficiary_name) : ""}
        ${tx.beneficiary_account_last4 ? tr("BENEF ACCT", `**** ${tx.beneficiary_account_last4}`) : ""}
        ${tx.beneficiary_routing ? tr("BENEF RTG", tx.beneficiary_routing) : ""}
        ${tx.batch_signature ? `<tr><th>BATCH SIG:</th><td>${esc(String(tx.batch_signature).slice(0, 32))}</td></tr>` : ""}
      </table>
    </section>`);

    const txTr = tx.tranche;
    if (txTr && (txTr.total_agreement_usd || txTr.agreement_total || txTr.tranches_total_expected)) {
      const masterTotal = txTr.total_agreement_usd || txTr.agreement_total || 0;
      sections.push(`<section class="tranche">
        <h3>TRANCHE &amp; MASTER AGREEMENT</h3>
        <table>
          ${masterTotal ? tr("MASTER TOTAL", `$${Number(masterTotal).toLocaleString("en-US")} USD`) : ""}
          ${tr("TRANCHE AMT", this.fmtAmountMinor(tx.amount_minor, tx.currency))}
          ${txTr.tranches_total_expected ? tr("TRANCHE No", `${txTr.tranches_completed || 1} OF ${txTr.tranches_total_expected}`) : ""}
          ${txTr.tranches_remaining_usd ? tr("REMAINING", `$${Number(txTr.tranches_remaining_usd).toLocaleString("en-US")} USD`) : ""}
          ${((txTr.tranches_remaining_after_this !== undefined) && (txTr.tranches_remaining_after_this !== null)) ? tr("LEFT AFTER", `${txTr.tranches_remaining_after_this} TRANCHE(S)`) : ""}
        </table>
      </section>`);
    }

    sections.push(`<section>
      <h3>TERMINAL FLOOR LIMITS</h3>
      <table>
        ${tr("PERMANENT FLOOR", `$${Number(tx.terminal_floor_limit_permanent || 5000).toLocaleString("en-US")}`)}
        ${tx.floor_limit_raised_temporary_for_txn_only ? tr("TEMP FLOOR RAISE", "APPLIED (TXN ONLY)") : ""}
        ${tx.floor_limit_restored_post_commit ? tr("FLOOR POST-TXN", `$${Number(tx.floor_limit_restored_post_commit).toLocaleString("en-US")} (RESTORED)`) : ""}
      </table>
    </section>`);

    if (tx.merchant_license || tx.merchant_tax_id || tx.merchant_email) {
      sections.push(`<section>
        <h3>MERCHANT COMPLIANCE INFO</h3>
        <table>
          ${tx.merchant_license ? `<tr><th>LICENSE #:</th><td>${esc(tx.merchant_license)}</td></tr>` : ""}
          ${tx.merchant_tax_id ? `<tr><th>TAX ID:</th><td>${esc(tx.merchant_tax_id)}</td></tr>` : ""}
          ${tx.merchant_email ? tr("SUPPORT EMAIL", tx.merchant_email) : ""}
        </table>
      </section>`);
    }

    if (tx.ledger_entry_id || tx.settlement_id) {
      sections.push(`<section>
        <h3>AUDIT &amp; TRACEABILITY</h3>
        <table>
          ${tx.ledger_entry_id ? `<tr><th>LEDGER ENTRY:</th><td>${esc(tx.ledger_entry_id)}</td></tr>` : ""}
          ${tx.settlement_id ? `<tr><th>SETTLEMENT ID:</th><td>${esc(tx.settlement_id)}</td></tr>` : ""}
        </table>
      </section>`);
    }

    sections.push(`<section class="status ${statusClass}"><h3>${esc(statusText)}</h3></section>`);

    const needSig = tx.customer_signature_required !== false && approved;
    if (needSig) {
      sections.push(`<section class="sig">
        <div class="siglabel">CARDHOLDER SIGNATURE:</div>
        <div class="sigline"></div>
        <div class="sigprint"><span>PRINTED NAME:</span><span>____________________</span></div>
      </section>`);
    }

    sections.push(`<footer>
      <p>${esc(tx.receipt_footer || "Thank you for your business!")}</p>
      <p>KEEP THIS RECEIPT FOR YOUR RECORDS</p>
      <p>${esc(POS_BRAND_NAME)} POS · ${esc(VAULT_DISPLAY_NAME)} VAULT · PROTOCOL ${esc(POS_PROTOCOL_VERSION)}</p>
      <p>ALL TRANSACTIONS SUBJECT TO CARDHOLDER AGREEMENT</p>
      ${isDeclined ? `<p>CONTACT ISSUING BANK FOR FURTHER DETAILS</p>` : ""}
      <p class="end">*** END OF RECEIPT ***</p>
    </footer>`);

    return `<article class="receipt">${sections.join("")}</article>`;
  }

  build80mm(tx: ThermalTxnFull): ThermalRendered {
    const c = this.build80mmCopy(tx, "CUSTOMER COPY");
    const m = this.build80mmCopy(tx, "MERCHANT COPY");
    const hc = this.buildHtmlCopy(tx, "CUSTOMER COPY");
    const hm = this.buildHtmlCopy(tx, "MERCHANT COPY");
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
    const separator = `<div class="cut-tear">◦ ◦ ◦ &nbsp; MERCHANT COPY — TEAR HERE &nbsp; ◦ ◦ ◦</div>`;
    return {
      customer: c + PAPER_FULL_CUT,
      merchant: m + PAPER_FULL_CUT,
      combined: c + PAPER_FULL_CUT + LF + LF + LF + m + PAPER_FULL_CUT,
      browserCustomer: bc,
      browserMerchant: bm,
      browserCombined: bc + "\n\n\n--- MERCHANT COPY SEPARATOR ---\n\n\n" + bm,
      htmlCustomer: hc,
      htmlMerchant: hm,
      htmlCombined: `<div class="receipt-dual">${hc}${separator}${hm}</div>`
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
          htmlCombined: copies.htmlCombined,
          htmlCustomer: copies.htmlCustomer,
          htmlMerchant: copies.htmlMerchant,
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
      htmlCustomer: copies.htmlCustomer,
      htmlMerchant: copies.htmlMerchant,
      htmlCombined: copies.htmlCombined,
      plainCustomer: copies.browserCustomer || stripLegacy(copies.customer),
      plainMerchant: copies.browserMerchant || stripLegacy(copies.merchant)
    };
  }
}

export const thermalReceiptService = new ThermalReceiptService();
