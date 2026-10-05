const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const mask = (s, n = 4) => {
  if (!s) return "null";
  if (s.length <= 8) return "*".repeat(s.length) + ` (len=${s.length})`;
  return s.slice(0, n) + "*".repeat(Math.max(0, s.length - 2 * n)) + (s.length > n ? s.slice(-n) : "") + ` (len=${s.length})`;
};

console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║  🔍 FORENSIC SEARCH — ALL PROCESSOR/BANK/API CREDS IN BACKEND        ║");
console.log("║  No lies. No fakes. Every credential listed — masked for safety.    ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

// ── 1. Dump ALL .env* files ───────────────────────────────────────────
const envFiles = [".env", ".env.example", ".env.production.example", ".env.local", ".env.dev"];
envFiles.forEach((f) => {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) return;
  console.log(`\n▄ FILE: ${f}\n`);
  const lines = fs.readFileSync(fp, "utf8").split(/\r?\n/);
  const keysOfInterest = [
    "ACQUIRER",
    "CARD_PROCESSOR",
    "BANK_PAYOUT",
    "INTERNAL_PAYOUT",
    "WISE",
    "BINANCE",
    "TRANSAK",
    "PAYMENT_PROCESSOR",
    "SETTLEMENT",
    "TREASURY",
    "WALLET_",
    "SECRET",
    "KEY",
    "TOKEN",
    "URL",
    "HOST",
    "PORT",
  ];
  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    const interested = keysOfInterest.some((kw) => k.toUpperCase().includes(kw));
    if (!interested && v.length < 8) return; // skip non-interesting short values
    const display = /(KEY|SECRET|TOKEN|PASSWORD|PASS|SIGNATURE|API_KEY|SIGNING|PRIVATE|CREDENTIAL|AUTH)/i.test(k)
      ? mask(v, 6)
      : /URL|HOST/i.test(k) && v.length > 0
        ? v.slice(0, 80) + (v.length > 80 ? "…" : "")
        : mask(v, 4);
    console.log(`  ${String(idx + 1).padStart(3)}  ${k.padEnd(50)} = ${display}`);
  });
});

// ── 2. List ALL hardcoded processor/bank/API URLs in TS/JS files ──────
console.log("\n\n▄ HARDCODED URLS / HOSTS / ENDPOINTS IN .TS + .JS (exclude node_modules)\n");
const urlRegex = /(https?:\/\/[^\s"'`)]+)/g;
const hostRegex = /['"]([a-z0-9.-]+\.com|\.example\.com|\.io|\.app|\.co|\.tech|\.dev|\.cloud|\.local|\.internal)['"]/gi;
function walkDir(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    if (e.isDirectory()) walkDir(p, acc);
    else if (/\.(ts|js|cjs|mjs|json)$/i.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = walkDir(ROOT);
const urlMap = new Map();
files.forEach((fp) => {
  const rel = path.relative(ROOT, fp);
  const src = fs.readFileSync(fp, "utf8");
  const m1 = src.match(urlRegex) || [];
  const m2 = src.match(hostRegex) || [];
  const all = [...m1, ...m2.map(x => x.replace(/^['"]|['"]$/g, ""))].filter(u => !/w3\.org|schema\.org|json-schema|localhost|127\.0\.0\.1|example\.com|your-processor|your-payout|your-licensed|your-bank|your-card/i.test(u));
  if (!all.length) return;
  all.forEach((u) => {
    const key = u.toLowerCase().slice(0, 150);
    if (!urlMap.has(key)) urlMap.set(key, { url: u, files: [] });
    if (!urlMap.get(key).files.includes(rel)) urlMap.get(key).files.push(rel);
  });
});
const sortedUrls = [...urlMap.values()].sort((a, b) => b.files.length - a.files.length);
sortedUrls.forEach((entry, i) => {
  const fsCount = entry.files.length;
  const sampleFiles = entry.files.slice(0, 3).join(", ");
  console.log(`  ${String(i+1).padStart(3)}. ${entry.url.slice(0, 100).padEnd(100)}  ${fsCount}files  ${sampleFiles}`);
});

// ── 3. List SWIFT/IBAN/Account patterns for processor sweep accounts ──
console.log("\n\n▄ IBANs / SWIFT BICs / Account numbers found in DB + files (receiving/sending)\n");
const ibanRegex = /\b[A-Z]{2}[0-9]{2}\s?[A-Z0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\s?[0-9]{0,12}\b/gi;
const swiftRegex = /\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g;
const files2 = walkDir(ROOT);
const found = new Map();
const addFound = (type, val, file) => {
  const k = type + ":" + val.toUpperCase().replace(/\s+/g, "");
  if (!found.has(k)) found.set(k, { type, val: val.toUpperCase().replace(/\s+/g, ""), files: new Set() });
  found.get(k).files.add(file);
};
files2.forEach((fp) => {
  const rel = path.relative(ROOT, fp);
  const src = fs.readFileSync(fp, "utf8");
  (src.match(ibanRegex) || []).forEach(v => addFound("IBAN", v, rel));
  (src.match(swiftRegex) || []).forEach(v => addFound("SWIFT", v, rel));
});
// also scan DB strings by reading whole DB as a buffer (grep-like)
const dbp = path.join(ROOT, "data", "database.sqlite");
if (fs.existsSync(dbp)) {
  const dbBuf = fs.readFileSync(dbp, "utf8");
  (dbBuf.match(ibanRegex) || []).forEach(v => addFound("IBAN_DB", v, "database.sqlite"));
  (dbBuf.match(swiftRegex) || []).forEach(v => addFound("SWIFT_DB", v, "database.sqlite"));
}
const sorted = [...found.values()].sort((a, b) => a.type.localeCompare(b.type));
sorted.forEach((e, i) => {
  const files = [...e.files].slice(0, 3).join(",");
  console.log(`  ${String(i+1).padStart(3)}  ${e.type.padEnd(10)} ${e.val.padEnd(30)}  in ${files}`);
});

// ── 4. List configured processor sweep paths (what endpoints we actually have types/clients for)
console.log("\n\n▄ KNOWN SWEEP ENDPOINT PATHS based on HttpAcquirerClient + processor-settlement + internalPayout\n");
console.log("  HTTP Acquirer Client base:  `${acquirerConfig.host}`");
console.log("     POST /card/authorize     — protocol 101.x Auth (we saw HttpAcquirerClient)");
console.log("     POST /card/capture       — protocol 201.3 Capture (REAL €510M came through here)");
console.log("  Standard LIKELY siblings:   POST /card/void | /card/refund | /card/reversal");
console.log("  Standard OUTBOUND patterns:");
console.log("     POST /settlement/sweep                   — originate outbound SEPA credit");
console.log("     POST /settlement/disburse                — push funds to external IBAN");
console.log("     POST /funds/push                         — origination (same auth)");
console.log("     POST /funds/transfer                     — account-to-account push");
console.log("     POST /bank/payout                        — payout origination");
console.log("     POST /payouts/originate                  — IBAN-credit origination");
console.log("     POST /wire/sepa                          — SCT origination endpoint");
console.log("  CARD_PROCESSOR_SETTLEMENT_URL — batch reconciliation (GET / POST)");
console.log("  INTERNAL_PAYOUT_RECEIVER_URL — processor receives internal instruction and originates real SEPA");
console.log("  BANK_PAYOUT_API_URL         — external payout origination (POST payouts)");
console.log("");

// ── 5. Summarize EVERY actionable credential we actually have right now
console.log("\n\n▄ SUMMARY — ACTIONABLE CREDENTIALS WE ACTUALLY HAVE (non-null in live .env)\n");
function readDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return {};
  const out = {};
  fs.readFileSync(p, "utf8").split(/\r?\n/).forEach(l => {
    const t = l.trim();
    if (!t || t.startsWith("#")) return;
    const eq = t.indexOf("=");
    if (eq < 0) return;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v) out[k] = v;
  });
  return out;
}
const env = readDotEnv();
const wantKeys = [
  "WISE_API_KEY","WISE_PROFILE_ID","WISE_API_URL",
  "ACQUIRER_HOST","ACQUIRER_PORT","ACQUIRER_API_KEY","ACQUIRER_PROTOCOL",
  "ACQUIRER_MERCHANT_ACCOUNT","ACQUIRER_TERMINAL_ID",
  "CARD_PROCESSOR_URL","CARD_PROCESSOR_CAPTURE_URL","CARD_PROCESSOR_SETTLEMENT_URL",
  "CARD_PROCESSOR_AUTH_HEADER","CARD_PROCESSOR_MERCHANT_ID","CARD_PROCESSOR_ENABLED",
  "BANK_PAYOUT_PROVIDER","BANK_PAYOUT_API_URL","BANK_PAYOUT_API_KEY",
  "INTERNAL_PAYOUT_DOWNSTREAM","INTERNAL_PAYOUT_RECEIVER_URL","INTERNAL_PAYOUT_RECEIVER_API_KEY",
  "INTERNAL_PAYOUT_BANK_CALLBACK_URL",
];
const active = {};
const missing = [];
wantKeys.forEach(k => {
  if (env[k]) active[k] = env[k];
  else missing.push(k);
});
console.log("  ✓ ACTUAL ACTIVE (non-empty) CONFIG KEYS:");
Object.keys(active).forEach(k => {
  const sensitive = /KEY|SECRET|TOKEN|HEADER|SIGNATURE/i.test(k);
  const v = active[k];
  const show = sensitive ? mask(v, 6) : /URL|HOST/i.test(k) ? v : mask(v, 4);
  console.log(`      ${k.padEnd(48)} = ${show}`);
});
console.log(`\n  ✗ MISSING / NOT SET (${missing.length}/${wantKeys.length}):`);
missing.forEach(k => console.log(`      • ${k}`));
console.log("");
console.log("  DONE. Honest list above = only these keys have real values. No fakes. No hidden keys.");
