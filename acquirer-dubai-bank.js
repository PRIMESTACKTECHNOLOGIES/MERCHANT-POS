const net = require("net");
const crypto = require("crypto");
try { require("dotenv").config(); } catch {}

const ACQUIRER_NAME = "DUBAI_BANK";
const ACQUIRER_PORT = 9002;
const SETTLEMENT_HOST = "127.0.0.1";
const SETTLEMENT_PORT = 9001;
const http = require("http");

const ACCEPTED_SCHEMES = ["VISA", "MASTERCARD"];
const ACCEPTED_CCY_NUMS = ["784"];
const ACCEPTED_CCY_ALPHA = ["AED"];
const MAX_TX_AMOUNT = 500000;

const binTable = {
  "4":     { scheme: "VISA",      length: 16 },
  "51":    { scheme: "MASTERCARD", length: 16 },
  "52":    { scheme: "MASTERCARD", length: 16 },
  "53":    { scheme: "MASTERCARD", length: 16 },
  "54":    { scheme: "MASTERCARD", length: 16 },
  "55":    { scheme: "MASTERCARD", length: 16 }
};

function detectScheme(pan) {
  if (!pan) return null;
  const digits = String(pan).replace(/\D/g, "");
  const keys = Object.keys(binTable).sort((a, b) => b.length - a.length);
  for (const bin of keys) if (digits.startsWith(bin)) return binTable[bin];
  return null;
}

function luhnValid(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validatePan(pan) {
  if (!pan) return { valid: false, responseCode: "14", reason: "NO_PAN" };
  const digits = String(pan).replace(/\D/g, "");
  if (!/^\d+$/.test(digits)) return { valid: false, responseCode: "14", reason: "NON_NUMERIC_PAN" };
  if (digits.startsWith("52") && digits.length === 16) {
    return { valid: true, scheme: "MASTERCARD", digits, isDpan: true };
  }
  const schemeInfo = detectScheme(digits);
  if (!schemeInfo) return { valid: false, responseCode: "14", reason: "UNKNOWN_BIN" };
  if (digits.length !== schemeInfo.length) return { valid: false, responseCode: "14", reason: "INVALID_LENGTH", scheme: schemeInfo.scheme };
  return { valid: true, scheme: schemeInfo.scheme, digits };
}

function buildIsoResponse(mti, reqFields, responseCode) {
  const fields = {};
  for (const k of Object.keys(reqFields)) fields[k] = reqFields[k];
  fields["39"] = responseCode;
  fields["12"] = new Date().toTimeString().slice(0, 5).replace(":", "");
  fields["13"] = String(new Date().getMonth() + 1).padStart(2, "0") + String(new Date().getDate()).padStart(2, "0");
  fields["38"] = responseCode === "00" ? ("DB" + String(Math.floor(Math.random() * 900000) + 100000)) : "";

  let msg = mti;
  Object.keys(fields).forEach(f => { msg += `|${f}=${fields[f]}`; });
  return Buffer.from(msg, "utf8");
}

function callSettlementReverse(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/reverse-transaction",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 8000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

function callSettlementRefund(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/refund-transaction",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 8000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

function callSettlementAddPendingAuth(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/add-pending-auth",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 5000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(data ? JSON.parse(data) : { ok: true }); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on("data", data => {
    buffer = Buffer.concat([buffer, data]);
    const raw = buffer.toString("utf8");
    if (!raw.includes("|2=") && !raw.startsWith("0100") && !raw.startsWith("0400") && !raw.startsWith("0200")) return;

    const parts = raw.split("|");
    const mti = parts[0];
    const fields = {};
    for (let i = 1; i < parts.length; i++) {
      const [f, v] = parts[i].split("=");
      fields[f] = v;
    }

    console.log(`[${ACQUIRER_NAME}] received ISO8583 ${mti}:`, raw);

    if (mti === "0400") {
      let responseCode = "96";
      try {
        if (fields["2"]) {
          const panCheck = validatePan(fields["2"]);
          if (!panCheck.valid) responseCode = panCheck.responseCode || "14";
          else if (!ACCEPTED_SCHEMES.includes(panCheck.scheme)) responseCode = "14";
          else {
            responseCode = "00";
            const amt = Number(fields["4"]) || 0;
            const ccyAlpha = fields["49"] === "784" ? "AED" : fields["49"];
            callSettlementReverse({
              accountId: fields["42"] || "VAULT-MERCHANT-001",
              amount: amt,
              currencyCode: ccyAlpha,
              mid: fields["42"],
              tid: fields["41"],
              rrn: fields["11"],
              stan: fields["11"],
              reason: "REVERSAL"
            }).catch(() => {});
          }
        } else responseCode = "14";
      } catch (e) { responseCode = "96"; }
      const resp = buildIsoResponse("0410", fields, responseCode);
      console.log(`[${ACQUIRER_NAME}] sending 0410 reversal response code=${responseCode}:`, resp.toString("utf8"));
      socket.write(resp);
      socket.end();
      return;
    }

    if (mti === "0200") {
      let responseCode = "96";
      try {
        if (fields["2"]) {
          const panCheck = validatePan(fields["2"]);
          if (!panCheck.valid) responseCode = panCheck.responseCode || "14";
          else if (!ACCEPTED_SCHEMES.includes(panCheck.scheme)) responseCode = "14";
          else {
            responseCode = "00";
            const amt = Number(fields["4"]) || 0;
            const ccyAlpha = fields["49"] === "784" ? "AED" : fields["49"];
            callSettlementRefund({
              accountId: fields["42"] || "VAULT-MERCHANT-001",
              amount: amt,
              currencyCode: ccyAlpha,
              mid: fields["42"],
              tid: fields["41"],
              rrn: fields["11"],
              stan: fields["11"]
            }).catch(() => {});
          }
        } else responseCode = "14";
      } catch (e) { responseCode = "96"; }
      const resp = buildIsoResponse("0210", fields, responseCode);
      console.log(`[${ACQUIRER_NAME}] sending 0210 refund response code=${responseCode}:`, resp.toString("utf8"));
      socket.write(resp);
      socket.end();
      return;
    }

    if (mti === "0100") {
      let responseCode = "00";
      let scheme = null;

      const amt = Number(fields["4"]) || 0;
      if (!fields["4"] || amt <= 0) responseCode = "14";
      else if (amt > MAX_TX_AMOUNT) responseCode = "61";
      else if (fields["49"] && !ACCEPTED_CCY_NUMS.includes(String(fields["49"])) && !ACCEPTED_CCY_ALPHA.includes(String(fields["49"]))) {
        responseCode = "91";
      } else if (fields["2"]) {
        if (fields["2"].startsWith("52")) {
          if (fields["2"].length !== 16) responseCode = "14";
        }
        if (responseCode === "00") {
          const panCheck = validatePan(fields["2"]);
          if (!panCheck.valid) responseCode = panCheck.responseCode || "14";
          else if (!panCheck.isDpan && !luhnValid(panCheck.digits)) responseCode = "14";
          else if (!ACCEPTED_SCHEMES.includes(panCheck.scheme)) responseCode = "14";
          else {
            scheme = panCheck.scheme;
            if (fields["18"] === "7995" && scheme === "VISA") responseCode = "57";
            if (scheme === "MASTERCARD" && !fields["52"]) responseCode = "N7";
          }
        }
      }

      if (responseCode === "00" && fields["55"]) {
        const arqcPresence = fields["55"].includes("9F26");
        const cidPresence = fields["55"].includes("9F27");
        if (!arqcPresence || !cidPresence) responseCode = "55";
      }

      const procCode = String(fields["3"] || "000000");
      if (responseCode === "00" && procCode === "000000" && fields["2"]) {
        const entry = {
          stan: fields["11"],
          rrn: fields["7"],
          amount: Number(fields["4"]),
          currencyCode: fields["49"],
          mid: fields["42"] || "VAULT-MERCHANT-001",
          tid: fields["41"] || "",
          pan: String(fields["2"]),
          emv: fields["55"] || null,
          mcc: fields["18"] || null,
          mti: "0100",
          processingCode: procCode,
          createdAt: new Date().toISOString(),
          acquiringInstitution: ACQUIRER_NAME
        };
        callSettlementAddPendingAuth(entry).catch(() => {});
      }

      const resp = buildIsoResponse("0110", fields, responseCode);
      console.log(`[${ACQUIRER_NAME}] sending 0110 auth response code=${responseCode} scheme=${scheme || "-"}:`, resp.toString("utf8"));
      socket.write(resp);
      socket.end();
      return;
    }

    responseCode = "96";
    socket.write(buildIsoResponse(mti.endsWith("00") ? mti.slice(0, 2) + "10" : "0110", fields, responseCode));
    socket.end();
  });

  socket.on("error", err => console.error(`[${ACQUIRER_NAME}] socket error:`, err.message));
  socket.on("end", () => {});
});

server.listen(ACQUIRER_PORT, () => {
  console.log(`${ACQUIRER_NAME} Acquirer listening on port ${ACQUIRER_PORT}`);
  console.log(`  Schemes: [${ACCEPTED_SCHEMES.join(",")}]`);
  console.log(`  Currencies (numeric): [${ACCEPTED_CCY_NUMS.join(",")}]`);
  console.log(`  Currencies (alpha):   [${ACCEPTED_CCY_ALPHA.join(",")}]`);
  console.log(`  Max amount: ${MAX_TX_AMOUNT}`);
});
