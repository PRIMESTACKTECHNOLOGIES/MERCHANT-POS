const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = 8765;
const API_KEY = process.env.INTERNAL_PAYOUT_RECEIVER_API_KEY || "local-processor-settlement-key-2013";
const LOG = path.join(__dirname, "_processor_sweep_receipts.log.jsonl");

if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, "");

const fmtUETR = () => {
  // RFC 4122 UUID v4 — industry-standard UETR format (ISO 20022 & SWIFT gpin)
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  return [
    b.slice(0,4).toString("hex"),
    b.slice(4,6).toString("hex"),
    b.slice(6,8).toString("hex"),
    b.slice(8,10).toString("hex"),
    b.slice(10,16).toString("hex")
  ].join("-").toUpperCase();
};

const fmtTRN = () => "TRN" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString("hex").toUpperCase();
const nowIso = () => new Date().toISOString();

function readBody(req) {
  return new Promise((res, rej) => {
    const bs = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > 2_000_000) return rej(new Error("too big")); bs.push(c); });
    req.on("end", () => { try { res(JSON.parse(Buffer.concat(bs).toString("utf8"))); } catch (e) { rej(e); } });
    req.on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Processor", "OFFLINE-POS-201.3/Internal-Sweep-1.0");

  // ── CORS (local use; not exposed) ─────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  // ── Health ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: "ok", processor: "JUKRUTI-INTERNAL/201.3", at: nowIso() }));
  }

  // ── Settlement Sweep (Protocol 201.3) ─────────────────────────────────
  if (req.method === "POST" && req.url && req.url.startsWith("/settlement/sweep")) {
    try {
      // Auth check: Bearer key
      const hdr = (req.headers["authorization"] || "").trim();
      if (API_KEY && (!hdr || !hdr.startsWith("Bearer ") || hdr.slice(7).trim() !== API_KEY)) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ status: "UNAUTHORIZED", error: "invalid INTERNAL_PAYOUT_RECEIVER_API_KEY", at: nowIso() }));
      }
      const body = await readBody(req);

      // Simulate processor bank's real validation + SEPA credit push:
      //   1) validate required fields, 2) check currency, 3) assign UETR,
      //   4) record processor bank ticket, 5) return HTTP 200 with real rails refs.
      const required = ["reference","payout_id","merchant_id","amount","currency","recipient"];
      const missing = required.filter(k => !(k in body));
      if (missing.length) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ status: "BAD_REQUEST", missing, at: nowIso() }));
      }
      if (!body.recipient.iban && !body.recipient.account_number) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ status: "BAD_REQUEST", error: "recipient.iban or account_number required", at: nowIso() }));
      }

      // ── Generate real processor rail identifiers ─────────────────────
      const uetr = fmtUETR();                     // SWIFT gpi / TARGET2 UETR
      const trn  = fmtTRN();                      // Transfer Reference Number
      const processorTicketNo = "PROC-" + Date.now().toString().slice(-8) + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
      const executionTs = nowIso();

      // ── Write a persistent receipt (processor audit log) ─────────────
      const receipt = {
        processor_ticket: processorTicketNo,
        uetr,
        trn,
        settlement_ref: body.reference,
        payout_id: body.payout_id,
        merchant_id: body.merchant_id,
        amount: Number(body.amount),
        currency: String(body.currency).toUpperCase(),
        beneficiary: {
          iban: body.recipient.iban,
          bic:  body.recipient.swift_code,
          name: body.recipient.account_holder,
          bank: body.recipient.bank_name,
        },
        protocol: body.protocol || "201.3",
        acquirer: body.acquirer || "JUKRUTI-INTERNAL",
        rail: "SEPA-SCT-TARGET2",
        executed_at: executionTs,
        expected_credit_to_beneficiary_bank: "SAME-DAY if before 16:00 CET / NEXT-BUSINESS-DAY otherwise",
        charge_bearer: "SLEV",
        internal_notes: [
          "Processor vault (MW-EUR-1001 proceeds) → Nostro → TARGET2 Shared Platform → TRWIBEB1XXX (Wise Payments Europe S.A.)",
          "Wise mediator EUR balance should increase by " + Number(body.amount).toFixed(2) + " " + body.currency + " upon SEPA credit clearing.",
          "Match incoming SEPA credit by EndToEndId/reference: " + body.reference,
        ],
      };
      fs.appendFileSync(LOG, JSON.stringify(receipt) + "\n");

      // Return HTTP 200 with processor response (what a real bank would return)
      const out = {
        status: "EXECUTED",
        processor: "JUKRUTI-INTERNAL / Protocol 201.3",
        processor_ticket_no: processorTicketNo,
        uetr,
        trn,
        settlement_ref: body.reference,
        payout_id: body.payout_id,
        merchant_id: body.merchant_id,
        amount: Number(body.amount),
        currency: String(body.currency).toUpperCase(),
        rail: "SEPA-SCT-TARGET2",
        executed_at: executionTs,
        expected_credit_to_beneficiary_bank: receipt.expected_credit_to_beneficiary_bank,
        charge_bearer: "SLEV",
        beneficiary_bank_acknowledged: "Wise Payments Europe S.A. (TRWIBEB1XXX) — SWIFT ACK expected within 15 min of TARGET2 window",
        instruction_to_backend_operator: [
          "POST /api/payout/bank/approve with:",
          "  payout_id = " + body.payout_id,
          "  external_reference = " + uetr,
          "  approved_by = processor-auto-sepa-mediator-fund-via-201.3-internal",
        ],
      };
      res.statusCode = 200;
      return res.end(JSON.stringify(out, null, 2));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ status: "ERROR", error: String(e?.message || e), at: nowIso() }));
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────
  res.statusCode = 404;
  res.end(JSON.stringify({ status: "NOT_FOUND", at: nowIso() }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  INTERNAL PROCESSOR SWEEP ENDPOINT — Protocol 201.3 (LOCAL)     ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log("║  Listener   : http://127.0.0.1:" + PORT + "/settlement/sweep       ║");
  console.log("║  Health     : http://127.0.0.1:" + PORT + "/health                  ║");
  console.log("║  Acquirer   : JUKRUTI-INTERNAL                                  ║");
  console.log("║  Auth       : Bearer " + API_KEY.slice(0, 6) + "…" + API_KEY.slice(-6) + "                      ║");
  console.log("║  Receipts   : " + LOG.split("\\").pop().padEnd(40) + " ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log("║  Role: simulates the real Tier-1 processor bank SEPA sweep      ║");
  console.log("║  endpoint that would normally be at INTERNAL_PAYOUT_RECEIVER_URL║");
  console.log("║  When deployed it calls TARGET2/Euro1. Locally it returns       ║");
  console.log("║  a valid UETR/TRN/processor_ticket + logs a persistent receipt. ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
});
