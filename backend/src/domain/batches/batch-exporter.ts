import crypto from "crypto";

export type ExportFormat = "json" | "csv" | "nacha" | "wise";

export interface BatchRowShape {
  id: string;
  batch_id: string;
  merchant_id: string;
  terminal_id: string;
  protocol_version?: string;
  status?: string;
  settlement_code?: string | null;
  txn_count?: number;
  total_amount_minor?: number;
  signature?: string | null;
  nonce?: string | null;
  upload_timestamp?: string | null;
  processed_at?: string | null;
  batch_seq?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TxnRowShape {
  id: string;
  merchant_id: string;
  terminal_id: string;
  batch_id: string | null;
  local_txn_id: string;
  stan: string;
  amount_minor: number;
  currency: string;
  pan_masked: string;
  txn_type: string | null;
  auth_mode: string | null;
  entry_mode: string | null;
  card_brand: string | null;
  reader_source: string | null;
  cvm_result: string | null;
  pin_verified: number | null;
  status: string | null;
  auth_code: string | null;
  rrn: string | null;
  txn_timestamp: string | null;
  created_at: string | null;
}

export interface MerchantMeta {
  merchantName?: string;
  supportEmail?: string;
  supportPhone?: string;
  companyName?: string;
  businessCountry?: string;
  businessAddress?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
  bankName?: string;
  ein?: string;
  settlementCode?: string;
  iban?: string;
  swiftBic?: string;
  accountHolder?: string;
  accountCurrency?: string;
  addressCountryCode?: string;
  addressCity?: string;
  addressFirstLine?: string;
  addressState?: string;
  transferPurpose?: string;
  fxRateToAccount?: number;
  receiverType?: "PRIVATE" | "INSTITUTION";
  [key: string]: any;
}

export interface ExportOpts {
  includeGhost?: boolean;
  secretKey: string;
  merchant?: MerchantMeta;
  generatedAt?: Date;
}

export interface ExportResult {
  format: ExportFormat;
  filename: string;
  contentType: string;
  body: string;
  byteLength: number;
  txnCount: number;
  ghostExcluded: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  controlEntryHash: string;
  signature: string;
  canonicalPayload: string;
  generatedAt: string;
}

const pad = (s: any, len: number, ch: string = " ", align: "L" | "R" = "L"): string => {
  const str = String(s == null ? "" : s);
  const clipped = str.length > len ? str.substring(0, len) : str;
  const pad = ch.repeat(Math.max(0, len - clipped.length));
  return align === "R" ? pad + clipped : clipped + pad;
};

const numPad = (n: any, len: number): string => pad(String(Math.max(0, Math.floor(Number(n) || 0))), len, "0", "R");

const moneyMinorToWholeDollars10Pad = (minor: number): string => {
  const abs = Math.max(0, Math.floor(Math.abs(minor) || 0));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const whole = `${dollars}${numPad(cents, 2)}`;
  return pad(whole, 12, "0", "R");
};

const mod10Digit = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
};

const routingCheckDigit = (routing: string): string => {
  const d = routing.replace(/\D/g, "").split("").map(Number);
  if (d.length < 8) return "0";
  return String(((3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5])) % 10 === 0) ? d[8] ?? "0" : "0");
};

const isGhostTxn = (t: TxnRowShape): boolean => {
  const ac = String(t.auth_code || "").trim();
  if (ac === "0000") return true;
  const pan = String(t.pan_masked || "");
  if (/^\*+$/.test(pan.replace(/\s/g, ""))) return true;
  return false;
};

const tsStamp = (d: Date): { ymd: string; hms: string; julian: string; iso: string } => {
  const yy = String(d.getFullYear()).slice(-2);
  const yyyy = String(d.getFullYear());
  const mm = numPad(d.getMonth() + 1, 2);
  const dd = numPad(d.getDate(), 2);
  const hh = numPad(d.getHours(), 2);
  const mi = numPad(d.getMinutes(), 2);
  const ss = numPad(d.getSeconds(), 2);
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const jul = numPad(Math.floor(diff / oneDay), 3);
  return { ymd: `${yyyy}${mm}${dd}`, hms: `${hh}${mi}${ss}`, julian: jul, iso: d.toISOString() };
};

const filenameSafe = (s: string): string => String(s || "").replace(/[^A-Za-z0-9_-]/g, "");

const buildFilename = (batch: BatchRowShape, format: ExportFormat, d: Date): string => {
  const stamp = tsStamp(d);
  return [
    "2013",
    filenameSafe(batch.merchant_id),
    filenameSafe(batch.terminal_id),
    filenameSafe(batch.batch_id),
    stamp.ymd,
    stamp.hms,
  ].filter(Boolean).join("_") + "." + (format === "nacha" ? "ach" : format);
};

export class BatchExporter {
  private hashEntry(entry: number[] | string[]): bigint {
    let sum = 0n;
    for (const v of entry) {
      const n = typeof v === "bigint" ? v : BigInt(String(v).replace(/\D/g, "") || "0");
      if (n > 0n) sum += n;
    }
    const str = sum.toString();
    return BigInt(str.length > 10 ? str.slice(-10) : str);
  }

  private panLast8ForHash(panMasked: string): string {
    const digits = panMasked.replace(/\D/g, "");
    return digits.length >= 8 ? digits.slice(-8) : pad(digits, 8, "0", "R");
  }

  private routingForHash(merchant: MerchantMeta = {}): string {
    const r = String(merchant.routingNumber || merchant.accountNumber || "00000000").replace(/\D/g, "");
    return r.length >= 8 ? r.slice(0, 8) : pad(r, 8, "0", "L");
  }

  private signCanonical(batch: BatchRowShape, timestampStr: string, nonce: string, count: number, secretKey: string): { canonicalPayload: string; signature: string } {
    const canonicalPayload = [
      batch.protocol_version || "201.3",
      batch.merchant_id,
      batch.terminal_id,
      batch.batch_id,
      timestampStr,
      nonce,
      String(count),
    ].join("|");
    const signature = crypto.createHmac("sha256", secretKey).update(canonicalPayload).digest("base64");
    return { canonicalPayload, signature };
  }

  export(batch: BatchRowShape, rawTxns: TxnRowShape[], format: ExportFormat, opts: ExportOpts): ExportResult {
    const includeGhost = opts.includeGhost === true;
    const generatedAt = opts.generatedAt || new Date();
    const stamp = tsStamp(generatedAt);

    const ghosts = rawTxns.filter(isGhostTxn);
    const txns = includeGhost ? rawTxns : rawTxns.filter(t => !isGhostTxn(t));
    const ghostExcluded = includeGhost ? 0 : ghosts.length;

    const totalDebitMinor = txns.reduce((s, t) => s + Math.max(0, Number(t.amount_minor) || 0), 0);
    const totalCreditMinor = txns.reduce((s, t) => s + Math.min(0, Number(t.amount_minor) || 0), 0) * -1;

    const panEntries = txns.map(t => this.panLast8ForHash(t.pan_masked));
    const routeEntry = this.routingForHash(opts.merchant);
    const entryHashBig = this.hashEntry([routeEntry, ...panEntries]);
    const controlEntryHash = entryHashBig.toString().slice(-10);

    const signatureNonce = batch.nonce || crypto.randomBytes(12).toString("hex");
    const tsString = stamp.iso;
    const { canonicalPayload, signature } = this.signCanonical(
      batch, tsString, signatureNonce, txns.length, opts.secretKey
    );

    const filename = buildFilename(batch, format, generatedAt);
    const txnCount = txns.length;

    switch (format) {
      case "json": {
        const body = JSON.stringify({
          protocolVersion: batch.protocol_version || "201.3",
          generatedAt: stamp.iso,
          settlement: {
            settlementCode: batch.settlement_code || null,
            batchSequence: batch.batch_seq ?? 1,
            merchantId: batch.merchant_id,
            terminalId: batch.terminal_id,
            batchId: batch.batch_id,
            status: batch.status || null,
            uploadedAt: batch.upload_timestamp || null,
            processedAt: batch.processed_at || null,
          },
          merchant: {
            merchantName: opts.merchant?.merchantName || "",
            companyName: opts.merchant?.companyName || opts.merchant?.merchantName || "",
            supportEmail: opts.merchant?.supportEmail || "",
            ein: opts.merchant?.ein || "",
            routingNumber: opts.merchant?.routingNumber ? opts.merchant.routingNumber + routingCheckDigit(opts.merchant.routingNumber) : "",
            accountNumberMasked: opts.merchant?.accountNumber ? String(opts.merchant.accountNumber).slice(-4).padStart(String(opts.merchant.accountNumber).length, "*") : "",
          },
          control: {
            transactionCount: txnCount,
            ghostExcluded,
            totalDebitMinor,
            totalCreditMinor,
            entryHash10: controlEntryHash,
            blockCount: 0,
          },
          signature: {
            nonce: signatureNonce,
            timestamp: tsString,
            canonicalPayload,
            algorithm: "HMAC-SHA256",
            hmacBase64: signature,
            matchesBatch: batch.signature && batch.signature === signature ? true : (batch.signature ? "re-signed" : "signed"),
          },
          transactions: txns.map((t, idx) => ({
            sequence: idx + 1,
            id: t.id,
            localTxnId: t.local_txn_id,
            stan: t.stan,
            amountMinor: t.amount_minor,
            currency: t.currency || "USD",
            panMasked: t.pan_masked,
            panLast8: this.panLast8ForHash(t.pan_masked),
            txnType: t.txn_type || "SALE",
            authMode: t.auth_mode || "",
            entryMode: t.entry_mode || "MANUAL",
            cardBrand: t.card_brand || "",
            readerSource: t.reader_source || "",
            cvmResult: t.cvm_result || "",
            pinVerified: Number(t.pin_verified || 0) === 1,
            authCode: t.auth_code || "",
            rrn: t.rrn || "",
            txnTimestamp: t.txn_timestamp || t.created_at || null,
            isGhost: isGhostTxn(t),
          })),
        }, null, 2) + "\n";

        return {
          format: "json", filename,
          contentType: "application/json; charset=utf-8",
          body, byteLength: Buffer.byteLength(body, "utf8"),
          txnCount, ghostExcluded, totalDebitMinor, totalCreditMinor,
          controlEntryHash, signature, canonicalPayload, generatedAt: stamp.iso
        };
      }
      case "csv": {
        const header = [
          "protocol_version=201.3",
          `generated_at=${stamp.iso}`,
          `merchant_id=${batch.merchant_id}`,
          `terminal_id=${batch.terminal_id}`,
          `batch_id=${batch.batch_id}`,
          `settlement_code=${batch.settlement_code || ""}`,
          `batch_seq=${batch.batch_seq ?? 1}`,
          `hmac=${signature}`,
          `hmac_payload=${canonicalPayload}`,
        ].join(",");

        const cols = [
          "seq", "id", "local_txn_id", "stan", "amount_minor", "currency",
          "pan_masked", "pan_last8", "txn_type", "auth_mode", "entry_mode",
          "card_brand", "reader_source", "cvm_result", "pin_verified",
          "auth_code", "rrn", "txn_timestamp", "status", "is_ghost"
        ];

        const rows = txns.map((t, i) => cols.map(c => {
          switch (c) {
            case "seq": return String(i + 1);
            case "pan_last8": return this.panLast8ForHash(t.pan_masked);
            case "pin_verified": return Number(t.pin_verified || 0) === 1 ? "1" : "0";
            case "is_ghost": return isGhostTxn(t) ? "1" : "0";
            case "amount_minor": return String(Number(t.amount_minor) || 0);
            default: {
              const v = (t as any)[c];
              const s = String(v == null ? "" : v).replace(/"/g, '""');
              return /[",\n\r]/.test(s) ? `"${s}"` : s;
            }
          }
        }).join(","));

        const trailer = [
          "CONTROL",
          String(txnCount),
          String(ghostExcluded),
          String(totalDebitMinor),
          String(totalCreditMinor),
          String(controlEntryHash),
          cols.join("|"),
        ].join(",");

        const body = [header, cols.join(","), ...rows, trailer].join("\n") + "\n";

        return {
          format: "csv", filename,
          contentType: "text/csv; charset=utf-8",
          body, byteLength: Buffer.byteLength(body, "utf8"),
          txnCount, ghostExcluded, totalDebitMinor, totalCreditMinor,
          controlEntryHash, signature, canonicalPayload, generatedAt: stamp.iso
        };
      }
      case "wise": {
        const wiseHeader = [
          "name",
          "recipientEmail",
          "paymentReference",
          "referenceNumber",
          "receiverType",
          "amountCurrency",
          "amount",
          "sourceCurrency",
          "targetCurrency",
          "IBAN",
          "addressCountryCode",
          "addressCity",
          "addressFirstLine",
          "addressState",
          "transferPurpose",
        ];

        const m = opts.merchant || {};
        const name = (m.accountHolder || m.companyName || m.merchantName || batch.merchant_id).trim();
        const recipientEmail = (m.supportEmail || "").trim();
        const receiverType: string = (m.receiverType === "PRIVATE" ? "PRIVATE" : "INSTITUTION");
        const addressCountryCode = (m.addressCountryCode || "").trim().toUpperCase();
        const addressCity = (m.addressCity || "").trim();
        const addressFirstLine = (m.addressFirstLine || "").trim();
        const addressState = (m.addressState || "").trim().toUpperCase();
        const transferPurpose = (m.transferPurpose || "BUSINESS_PAYMENT").trim().toUpperCase();
        const iban = (m.iban || "").trim();
        const targetCurrency = (m.accountCurrency || "AED").trim().toUpperCase();
        const fxRate = Number(m.fxRateToAccount) || 0;

        const csvEscape = (v: any) => {
          const s = String(v == null ? "" : v).replace(/"/g, '""');
          return /[",\n\r]/.test(s) ? `"${s}"` : s;
        };

        const rows = txns.map(t => {
          const amountMinor = Number(t.amount_minor) || 0;
          const whole = amountMinor / 100;
          const srcCur = String(t.currency || "USD").toUpperCase();
          const tgtCur = targetCurrency;
          const amountInTarget = (srcCur === tgtCur)
            ? whole.toFixed(2)
            : (fxRate > 0 ? (whole * fxRate).toFixed(2) : "");

          const refParts = [
            batch.merchant_id,
            t.auth_code ? "Auth " + t.auth_code : "",
            t.stan ? "STAN " + t.stan : "",
            t.currency + " " + whole.toFixed(2),
          ].filter(Boolean).join(" ");

          return [
            csvEscape(name),
            csvEscape(recipientEmail),
            csvEscape("POS Card Settlement " + refParts),
            csvEscape(String(t.auth_code || batch.settlement_code || t.local_txn_id)),
            csvEscape(receiverType),
            "target",
            csvEscape(amountInTarget),
            csvEscape(srcCur),
            csvEscape(tgtCur),
            csvEscape(iban),
            csvEscape(addressCountryCode),
            csvEscape(addressCity),
            csvEscape(addressFirstLine),
            csvEscape(addressState),
            csvEscape(transferPurpose),
          ].join(",");
        });

        const body = [wiseHeader.join(","), ...rows].join("\n") + "\n";

        return {
          format: "wise", filename,
          contentType: "text/csv; charset=utf-8",
          body, byteLength: Buffer.byteLength(body, "utf8"),
          txnCount, ghostExcluded, totalDebitMinor, totalCreditMinor,
          controlEntryHash, signature, canonicalPayload, generatedAt: stamp.iso
        };
      }
      case "nacha": {
        // NACHA standard 94-byte fixed-width records (5 record types: 1=FileHdr, 5=BatchHdr, 6=Entry, 8=BatchCtrl, 9=FileCtrl)
        // We'll build a single-batch single-entry file, standard industry layout.
        // Routing number derived from merchant settings; if missing uses 000000000.
        const routingRaw = String(opts.merchant?.routingNumber || "").replace(/\D/g, "");
        const routing8 = routingRaw.length >= 8 ? routingRaw.slice(0, 8) : pad("", 8, "0", "L");
        const routing9 = routing8 + (routingRaw.length >= 9 ? routingRaw[8] : routingCheckDigit(routing8));
        const originationDFI = routing8; // First 8 of receiving DFI
        const companyId = String(opts.merchant?.ein || batch.merchant_id).replace(/\D/g, "").slice(0, 10).padStart(10, " ");
        const companyName = pad(opts.merchant?.companyName || opts.merchant?.merchantName || batch.merchant_id, 16, " ", "L");
        const entryDesc = pad("OFFLINE POS", 10, " ", "L");
        const descDate = `${stamp.ymd.slice(4, 6)}${stamp.ymd.slice(6, 8)}`; // MMDD
        const effectiveDate = stamp.ymd.slice(2); // YYMMDD

        // Standard settlement code 200 for credit/debit mixed; 225 for PPD consumer
        // Service class code 200 = Mixed Debits/Credits; 220 = Credits Only; 225 = Debits Only
        const hasCredit = totalCreditMinor > 0;
        const hasDebit = totalDebitMinor > 0;
        const serviceClass = hasDebit && hasCredit ? "200" : (hasDebit ? "225" : "220");
        const standardEntryClass = "PPD";

        // File Header (Record Type 1)
        const priorityCode = "01";
        const immediateDest = pad(routing9, 10, " ", "R");
        const immediateOrig = pad(companyId, 10, " ", "R");
        const fileIDModifier = "A";
        const recordSize = "094";
        const blockingFactor = "10";
        const formatCode = "1";
        const immediateDestName = pad("ACQUIRER BANK", 23, " ", "L");
        const immediateOrigName = pad(opts.merchant?.companyName || batch.merchant_id, 23, " ", "L");
        const referenceCode = pad(batch.batch_id.slice(0, 8), 8, " ", "L");
        const fileHeader = "1" + priorityCode + immediateDest + immediateOrig + stamp.ymd + stamp.hms.slice(0, 4) + fileIDModifier + recordSize + blockingFactor + formatCode + immediateDestName + immediateOrigName + referenceCode;

        // Batch Header (Record Type 5)
        const batchNumber = numPad(batch.batch_seq ?? 1, 7);
        const batchHeader = "5" + serviceClass + companyName + pad(opts.merchant?.merchantName || "", 20, " ", "L") + pad(standardEntryClass, 3, " ", "L") + entryDesc + pad(descDate, 6, " ", "L") + pad(effectiveDate, 6, " ", "L") + pad("", 3, " ", "L") + "1" + pad(originationDFI, 8, " ", "L") + batchNumber;

        // Entry Detail (Record Type 6) per txn
        const entries: string[] = txns.map((t, idx) => {
          // Transaction code 22 = Checking Credit; 27 = Checking Debit; 32 = Savings Credit; 37 = Savings Debit
          const isDebit = Number(t.amount_minor) >= 0;
          const trxCode = isDebit ? "27" : "22";
          const rcvDFI = routing8;
          const checkDigit = routing9[8] || "0";
          const dfiAccount = pad(String(opts.merchant?.accountNumber || t.local_txn_id).replace(/\D/g, "").slice(-17), 17, " ", "L");
          const amount = moneyMinorToWholeDollars10Pad(Math.abs(Number(t.amount_minor) || 0));
          const idNumber = pad(t.local_txn_id, 15, " ", "L");
          const rxName = pad(String(t.pan_masked).replace(/\*/g, "X"), 22, " ", "L");
          const discData = pad(String(t.card_brand || t.auth_code || "").slice(0, 2), 2, " ", "L");
          const addendaInd = "0";
          const traceDFI = originationDFI.slice(0, 8);
          const traceSeq = numPad(idx + 1, 7);
          return "6" + trxCode + rcvDFI + checkDigit + dfiAccount + amount + idNumber + rxName + discData + addendaInd + traceDFI + traceSeq;
        });

        const entryHashNumeric = Number(controlEntryHash || "0") || Number(entryHashBig.toString().slice(-10)) || 0;

        // Batch Control (Record Type 8)
        const batchCtrl = "8" + serviceClass + numPad(txnCount, 6) + numPad(entryHashNumeric, 10, ) + moneyMinorToWholeDollars10Pad(totalCreditMinor) + moneyMinorToWholeDollars10Pad(totalDebitMinor) + pad(companyId, 10, " ", "L") + pad("", 19, " ", "L") + pad("", 6, " ", "L") + pad(originationDFI, 8, " ", "L") + batchNumber;

        // File Control (Record Type 9)
        const batchCount = 1;
        const blockCount = 1;
        const entryAddendaCount = txnCount;
        const fileCtrl = "9" + numPad(batchCount, 6) + numPad(blockCount, 6) + numPad(entryAddendaCount, 8) + numPad(entryHashNumeric, 10) + moneyMinorToWholeDollars10Pad(totalCreditMinor) + moneyMinorToWholeDollars10Pad(totalDebitMinor) + pad("", 39, " ", "L");

        // Ensure all lines exactly 94 bytes then pad to 10-record block
        const records = [fileHeader, batchHeader, ...entries, batchCtrl, fileCtrl].map(r => {
          if (r.length < 94) return r + " ".repeat(94 - r.length);
          if (r.length > 94) return r.substring(0, 94);
          return r;
        });
        while (records.length % 10 !== 0) records.push("9".repeat(94)); // NACHA 999... filler

        const body = records.join("\n") + "\n";

        return {
          format: "nacha", filename,
          contentType: "application/octet-stream; charset=us-ascii",
          body, byteLength: Buffer.byteLength(body, "ascii"),
          txnCount, ghostExcluded, totalDebitMinor, totalCreditMinor,
          controlEntryHash, signature, canonicalPayload, generatedAt: stamp.iso
        };
      }
    }
  }
}

export const batchExporter = new BatchExporter();
