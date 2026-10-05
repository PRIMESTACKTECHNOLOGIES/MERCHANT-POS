const http = require("http");
const crypto = require("crypto");
const path   = require("path");
try { require("dotenv").config(); } catch (_) {}

// ── Persistent card balance bridge (SQLite via better-sqlite3 or sqlite3) ────
// Syncs vault_card_balances / vault_card_txns so card balances survive restarts.
let _sqlite3 = null;
let _sqliteDb = null;
const SQLITE_DB_PATH = process.env.VAULT_SQLITE_PATH
  || path.join(__dirname, "backend", "data", "database.sqlite");

function getSqliteDb() {
  if (_sqliteDb) return _sqliteDb;
  try {
    const sqlite3 = require("sqlite3").verbose();
    _sqlite3 = sqlite3;
    _sqliteDb = new sqlite3.Database(SQLITE_DB_PATH, (err) => {
      if (err) console.warn("[CardBalance] SQLite open failed:", err.message);
      else     console.log("[CardBalance] SQLite connected:", SQLITE_DB_PATH);
    });
    _sqliteDb.run(`CREATE TABLE IF NOT EXISTS vault_card_balances (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, currency TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(card_id, currency)
    )`);
    _sqliteDb.run(`CREATE TABLE IF NOT EXISTS vault_card_txns (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, currency TEXT NOT NULL,
      type TEXT NOT NULL, amount REAL NOT NULL, balance_after REAL NOT NULL,
      channel TEXT, provider_ref TEXT, external_ref TEXT, note TEXT, created_at TEXT NOT NULL
    )`);
    return _sqliteDb;
  } catch (e) {
    console.warn("[CardBalance] sqlite3 not available — card balances will be memory-only:", e.message);
    return null;
  }
}

/** Load all SQLite card balances into cardAccounts (called once on startup) */
function loadCardBalancesFromSqlite() {
  const db = getSqliteDb();
  if (!db) return;
  db.all("SELECT card_id, currency, balance FROM vault_card_balances", [], (err, rows) => {
    if (err) { console.warn("[CardBalance] Load failed:", err.message); return; }
    for (const row of (rows || [])) {
      const cardId = row.card_id;
      const ccy    = String(row.currency).toUpperCase();
      const balMinor = Math.round(Number(row.balance) * 100); // major → minor
      if (!cardAccounts[cardId]) cardAccounts[cardId] = { currency: ccy, balance: 0 };
      cardAccounts[cardId].balance = balMinor;
      console.log(`[CardBalance] Loaded ${ccy} ${row.balance.toFixed(2)} → card=${cardId} (${balMinor} minor)`);
    }
  });
}

/** Persist a card credit to SQLite */
function persistCardCredit(cardId, ccy, amountMinor, channel, providerRef, externalRef, note) {
  const db = getSqliteDb();
  if (!db) return;
  const amount   = amountMinor / 100; // minor → major
  const now      = new Date().toISOString();
  const newId    = crypto.randomUUID();
  const balMajor = (Number(cardAccounts[cardId]?.balance) || 0) / 100;
  db.run(`INSERT INTO vault_card_balances (id, card_id, currency, balance, reserved, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(card_id, currency) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`,
    [newId, cardId, ccy, amount, now, now]);
  db.run(`INSERT INTO vault_card_txns (id, card_id, currency, type, amount, balance_after, channel, provider_ref, external_ref, note, created_at)
    VALUES (?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), cardId, ccy, amount, balMajor, channel || "settlement", providerRef || null, externalRef || null, note || null, now]);
}

/** Persist a card debit to SQLite */
function persistCardDebit(cardId, ccy, amountMinor, providerRef, note) {
  const db = getSqliteDb();
  if (!db) return;
  const amount   = amountMinor / 100; // minor → major
  const now      = new Date().toISOString();
  const balMajor = (Number(cardAccounts[cardId]?.balance) || 0) / 100;
  db.run(`UPDATE vault_card_balances SET balance = MAX(0, balance - ?), updated_at = ? WHERE card_id = ? AND currency = ?`,
    [amount, now, cardId, ccy]);
  db.run(`INSERT INTO vault_card_txns (id, card_id, currency, type, amount, balance_after, channel, provider_ref, note, created_at)
    VALUES (?, ?, ?, 'DEBIT', ?, ?, 'pos_debit', ?, ?, ?)`,
    [crypto.randomUUID(), cardId, ccy, amount, balMajor, providerRef || null, note || null, now]);
}

const VAULT_PORT = parseInt(process.env.VAULT_SETTLEMENT_PORT || process.env.VAULT_BANK_PORT || "9001", 10);

const DEFAULT_CURRENCIES = ["USD", "EUR", "AED"];
const DEFAULT_MERCHANT_CURRENCY = "AED";
const VAULT_BANK_OMNIBUS_ID = "VAULT_BANK_OMNIBUS";

const ALL_OMNIBUS_CCY = [
  "USD", "EUR", "AED", "GBP", "SGD", "INR",
  "JPY", "CHF", "AUD", "CAD", "HKD", "MYR", "CNY"
];

const fxRates = {
  "AED_USD": 0.272294,
  "USD_AED": 3.6730,
  "AED_EUR": 0.2490,
  "EUR_AED": 4.0160,
  "USD_EUR": 0.9150,
  "EUR_USD": 1.0930
};

function convert(amount, from, to) {
  if (!from || !to) throw new Error("FX convert requires from and to currencies");
  const a = String(from).toUpperCase();
  const b = String(to).toUpperCase();
  if (a === b) return Number(amount) || 0;
  const key = `${a}_${b}`;
  const rate = fxRates[key];
  if (!rate) throw new Error(`FX rate not found: ${key}`);
  return (Number(amount) || 0) * rate;
}

function setMerchantDefaultCurrency(accountId, currency) {
  if (!accountId || !currency) return;
  if (accountId === VAULT_BANK_OMNIBUS_ID) return;
  ensureAccount(accountId, currency);
  accounts[accountId].defaultCurrency = String(currency).toUpperCase();
}

function getMerchantDefaultCurrency(accountId, fallback) {
  if (!accountId || accountId === VAULT_BANK_OMNIBUS_ID) return fallback || DEFAULT_MERCHANT_CURRENCY;
  if (accounts[accountId] && accounts[accountId].defaultCurrency) {
    return accounts[accountId].defaultCurrency;
  }
  return fallback || DEFAULT_MERCHANT_CURRENCY;
}

let ledger = [];

function initOmnibus() {
  const obj = { isOmnibus: true, defaultCurrency: "AED" };
  for (const c of ALL_OMNIBUS_CCY) obj[c] = 0;
  return obj;
}

const accounts = {
  [VAULT_BANK_OMNIBUS_ID]: initOmnibus(),
  "VAULT-MERCHANT-001": { defaultCurrency: "AED", USD: 0, EUR: 0, AED: 0 },
  "VAULT-MERCHANT-002": { defaultCurrency: "USD", USD: 0, EUR: 0, AED: 0 }
};

const cardAccounts = {
  "CARD-USD-AJI": { currency: "USD", balance: 0 },
  "CARD-EUR-DANIA": { currency: "EUR", balance: 0 }
};

const VAULT_OPERATOR_CARDS = (function buildCards() {
  const map = new Map();
  const ccyKeys = ["USD", "EUR", "AED", "GBP", "SGD", "INR", "JPY", "CHF", "AUD", "CAD", "HKD", "MYR", "CNY"];
  for (const ccy of ccyKeys) {
    const pan = process.env["OPERATOR_CARD_" + ccy + "_NUMBER"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_PAN" : ccy + "_CARD_PAN")] || null;
    if (!pan) continue;
    const digits = String(pan).replace(/\D/g, "");
    const holder = process.env["OPERATOR_CARD_" + ccy + "_HOLDER"] || process.env["VAULT_" + (ccy === "USD" ? "CARDHOLDER_NAME" : ccy + "_CARDHOLDER_NAME")] || "VAULT CARDHOLDER";
    const expiry = process.env["OPERATOR_CARD_" + ccy + "_EXPIRY"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_EXPIRY" : ccy + "_CARD_EXPIRY")] || "";
    const cvv = process.env["OPERATOR_CARD_" + ccy + "_CVV"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_CVV" : ccy + "_CARD_CVV")] || "";
    const vaultAccount = process.env["OPERATOR_CARD_" + ccy + "_VAULT_ACCOUNT"] || ("PROC-VAULT-" + ccy + "-" + ccy.slice(0, 3));
    const bin = process.env["OPERATOR_CARD_" + ccy + "_BIN"] || digits.slice(0, 6);
    const scheme = (process.env["OPERATOR_CARD_" + ccy + "_SCHEME"] || (digits.startsWith("4") ? "VISA" : digits.match(/^5[1-5]/) ? "MASTERCARD" : "UNKNOWN")).toUpperCase();
    const exp = (function (exp) {
      if (!exp) return { mmYY: null, yyMM: null };
      const m = String(exp).match(/^(\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) return { mmYY: null, yyMM: null };
      const mm = String(m[1]).padStart(2, "0"); const yy = String(m[2]).slice(-2);
      return { mmYY: mm + "/" + yy, yyMM: yy + mm };
    })(expiry);
    const vaultIssuedRegex = /^412345|^423456|^432100|^445678|^456789|^467890|^478901|^489012|^490123|^401234|^532345|^541234|^551234|^523456|^534567|^545678|^556789/;
    map.set(digits, {
      pan: digits, last4: digits.slice(-4), bin, ccy,
      holder: String(holder).toUpperCase().slice(0, 26),
      expiryMmYY: exp.mmYY, expiryYyMM: exp.yyMM,
      cvv: String(cvv || ""), scheme,
      vaultAccount, isVaultIssued: vaultIssuedRegex.test(digits),
      cardId: "CARD-" + ccy + "-" + String(holder || "OP").split(/\s+/)[0].toUpperCase().slice(0, 8)
    });
  }
  return map;
})();

for (const c of VAULT_OPERATOR_CARDS.values()) {
  if (!cardAccounts[c.cardId]) cardAccounts[c.cardId] = { currency: c.ccy, balance: 0, operatorCard: true, vaultAccount: c.vaultAccount };
  ensureAccount(c.vaultAccount, c.ccy);
}

function validateVaultCard(pan, expiry, cvv) {
  const digits = String(pan || "").replace(/\D/g, "");
  const card = VAULT_OPERATOR_CARDS.get(digits);
  const result = {
    valid: false, vaultIssued: false, panFound: false, expiryMatches: false, cvvMatches: false,
    reason: null, card: null
  };
  if (!card) { result.reason = "CARD_NOT_FOUND_IN_VAULT_OPERATOR_REGISTRY"; return result; }
  result.panFound = true; result.vaultIssued = !!card.isVaultIssued; result.card = {
    last4: card.last4, bin: card.bin, ccy: card.ccy, scheme: card.scheme, holder: card.holder,
    vaultAccount: card.vaultAccount, cardId: card.cardId, expiry: card.expiryMmYY
  };
  if (!card.isVaultIssued) { result.reason = "BIN_NOT_VAULT_ISSUED_CANNOT_LOAD_VIA_OMNIBUS"; return result; }
  const expIn = String(expiry || "").replace(/\D/g, "");
  if (expIn.length === 4) {
    if (card.expiryYyMM && expIn === card.expiryYyMM) result.expiryMatches = true;
    if (!result.expiryMatches && card.expiryYyMM && expIn === (card.expiryYyMM.slice(2) + card.expiryYyMM.slice(0, 2))) result.expiryMatches = true;
  }
  if (!result.expiryMatches && expiry && card.expiryMmYY && String(expiry).replace(/\D/g, "") === card.expiryMmYY.replace(/\D/g, "")) result.expiryMatches = true;
  if (!result.expiryMatches) { result.reason = "EXPIRY_MISMATCH"; return result; }
  if (cvv !== undefined && cvv !== null && String(cvv).length > 0) {
    if (card.cvv && String(cvv) === String(card.cvv)) result.cvvMatches = true;
    if (!result.cvvMatches) { result.reason = "CVV_MISMATCH"; return result; }
  } else {
    result.cvvMatches = true;
  }
  if (card.isVaultIssued && digits.length === 16) {
    result.valid = true; result.reason = null;
    return result;
  }
  const luhn = (function (d) {
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) { let n = parseInt(d[i], 10); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    return sum % 10 === 0;
  })(digits);
  if (!luhn) { result.reason = "LUHN_CHECK_FAILED_NOT_VALID_PAN"; return result; }
  result.valid = true; result.reason = null;
  return result;
}

function moveFundsFromOmnibusToVaultAccount(vaultAccountId, ccy, amountMinor, reference) {
  ensureOmnibus(); ensureAccount(vaultAccountId, ccy);
  const omnibusAvail = Number(accounts[VAULT_BANK_OMNIBUS_ID][ccy]) || 0;
  if (omnibusAvail < amountMinor) {
    return { ok: false, error: "OMNIBUS_INSUFFICIENT_FUNDS_FOR_VAULT_LOAD — call POST /api/vault/funds-received first with actual scheme payout to back the omnibus",
             omnibusBalance: omnibusAvail, required: amountMinor, currency: ccy };
  }
  accounts[VAULT_BANK_OMNIBUS_ID][ccy] = omnibusAvail - amountMinor;
  accounts[vaultAccountId][ccy] = (Number(accounts[vaultAccountId][ccy]) || 0) + amountMinor;
  const omnibusEntry = {
    id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
    accountId: VAULT_BANK_OMNIBUS_ID, type: "VAULT_CARD_LOAD_OMNIBUS_DEBIT",
    amount: -amountMinor, currencyCode: ccy, counterpartyAccount: vaultAccountId,
    reference: reference || ("LOAD-OMNIBUS-" + Date.now()), createdAt: new Date().toISOString(),
    omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][ccy]
  };
  ledger.push(omnibusEntry);
  const vaultEntry = {
    id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
    accountId: vaultAccountId, type: "VAULT_CARD_LOAD_CREDIT",
    amount: amountMinor, currencyCode: ccy, sourceAccount: VAULT_BANK_OMNIBUS_ID,
    reference: reference || ("LOAD-VAULT-" + Date.now()), createdAt: new Date().toISOString(),
    vaultBalanceAfter: accounts[vaultAccountId][ccy]
  };
  ledger.push(vaultEntry);
  return { ok: true,
           vaultAccount: vaultAccountId, currency: ccy, amount: amountMinor,
           omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][ccy],
           vaultBalanceAfter: accounts[vaultAccountId][ccy],
           debitLedgerId: omnibusEntry.id, creditLedgerId: vaultEntry.id };
}

function moveFundsFromVaultAccountToPhysicalCard(vaultAccountId, cardId, ccy, amountMinor, reference) {
  ensureAccount(vaultAccountId, ccy);
  if (!cardAccounts[cardId]) cardAccounts[cardId] = { currency: ccy, balance: 0, vaultAccount: vaultAccountId };
  const vaultAvail = Number(accounts[vaultAccountId][ccy]) || 0;
  if (vaultAvail < amountMinor) {
    return { ok: false, error: "VAULT_ACCOUNT_INSUFFICIENT_BALANCE", vaultBalance: vaultAvail, required: amountMinor, currency: ccy };
  }
  accounts[vaultAccountId][ccy] = vaultAvail - amountMinor;
  cardAccounts[cardId].balance = (Number(cardAccounts[cardId].balance) || 0) + amountMinor;
  const ledgerEntry = {
    id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
    accountId: vaultAccountId, type: "VAULT_CARD_LOAD_TO_PHYSICAL",
    amount: -amountMinor, currencyCode: ccy, cardId,
    reference: reference || ("CARD-PUSH-" + Date.now()), createdAt: new Date().toISOString(),
    vaultBalanceAfter: accounts[vaultAccountId][ccy],
    cardBalanceAfter: cardAccounts[cardId].balance
  };
  ledger.push(ledgerEntry);
  // ── Persist card credit to SQLite so balance survives restart ──────────────
  persistCardCredit(cardId, ccy, amountMinor, "vault_load", reference || ledgerEntry.id, null, `Vault account ${vaultAccountId} → card`);
  return { ok: true,
           vaultAccount: vaultAccountId, cardId, currency: ccy, amount: amountMinor,
           vaultBalanceAfter: accounts[vaultAccountId][ccy],
           cardBalanceAfter: cardAccounts[cardId].balance,
           ledgerId: ledgerEntry.id };
}
 = [];
let clearingBatches = [];
let fundsReceivedLedger = [];
let fundingConfirmedByCcyBatch = {};
let pendingMerchantDisbursements = {};
const idempotencyStore = new Map();

const fs = require("fs");
const path = require("path");

function ensureOmnibus() {
  if (!accounts[VAULT_BANK_OMNIBUS_ID]) {
    accounts[VAULT_BANK_OMNIBUS_ID] = initOmnibus();
  } else if (!accounts[VAULT_BANK_OMNIBUS_ID].isOmnibus) {
    accounts[VAULT_BANK_OMNIBUS_ID].isOmnibus = true;
    for (const c of ALL_OMNIBUS_CCY) {
      if (typeof accounts[VAULT_BANK_OMNIBUS_ID][c] !== "number") {
        accounts[VAULT_BANK_OMNIBUS_ID][c] = 0;
      }
    }
  }
}

function getOmnibusBalance(currencyCode) {
  ensureOmnibus();
  const cc = currencyCode ? String(currencyCode).toUpperCase() : "AED";
  return Number(accounts[VAULT_BANK_OMNIBUS_ID][cc]) || 0;
}

function getAllOmnibusBalances() {
  ensureOmnibus();
  const out = {};
  for (const c of ALL_OMNIBUS_CCY) out[c] = Number(accounts[VAULT_BANK_OMNIBUS_ID][c]) || 0;
  return out;
}

function currencyNumericToAlpha(code) {
  if (!code) return "USD";
  if (/^[A-Z]{3}$/.test(String(code).toUpperCase())) return String(code).toUpperCase();
  const map = {
    "784": "AED", "840": "USD", "978": "EUR", "826": "GBP",
    "702": "SGD", "356": "INR", "392": "JPY", "756": "CHF",
    "036": "AUD", "124": "CAD", "344": "HKD", "458": "MYR", "156": "CNY"
  };
  return map[String(code)] || "USD";
}

function settleClearingBatchTransactions(batchId, transactions) {
  ensureOmnibus();

  const validTx = [];
  const totalsByCcy = {};
  for (const tx of transactions) {
    const rawCurrency = String(tx.currencyCode || "784");
    const txCurrencyCode = currencyNumericToAlpha(rawCurrency);
    const amt = Number(tx.amount) || 0;
    if (amt <= 0) continue;
    validTx.push({ ...tx, _txCcy: txCurrencyCode, _amt: amt });
    totalsByCcy[txCurrencyCode] = (totalsByCcy[txCurrencyCode] || 0) + amt;
  }

  const depositEntries = [];
  for (const ccy of Object.keys(totalsByCcy)) {
    const total = totalsByCcy[ccy];
    accounts[VAULT_BANK_OMNIBUS_ID][ccy] = (accounts[VAULT_BANK_OMNIBUS_ID][ccy] || 0) + total;
    const deposit = {
      id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
      accountId: VAULT_BANK_OMNIBUS_ID,
      type: "SCHEME_DEPOSIT",
      amount: total,
      currencyCode: ccy,
      description: "Card scheme (Visa/Mastercard/Amex) batch settlement funded to bank omnibus",
      batchId,
      createdAt: new Date().toISOString(),
      omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][ccy]
    };
    ledger.push(deposit);
    depositEntries.push(deposit);
  }

  const pendingByMidCcy = {};
  const results = [];
  for (const tx of validTx) {
    const accountId = tx.mid || "VAULTBANK001";
    const txCurrencyCode = tx._txCcy;
    const amt = tx._amt;

    const merchantCurrency = getMerchantDefaultCurrency(accountId, txCurrencyCode);
    ensureAccount(accountId, txCurrencyCode);
    ensureAccount(accountId, merchantCurrency);

    if (typeof accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] !== "number") {
      accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] = 0;
    }
    const settledInMerchantCcy = convert(amt, txCurrencyCode, merchantCurrency);
    const disbursedInTxCcy = amt;

    const pendingEntry = accruePendingMerchantDisbursement({
      merchantId: accountId,
      currency: txCurrencyCode,
      amountTxCcy: disbursedInTxCcy,
      amountMerchantCcy: settledInMerchantCcy,
      merchantCurrency,
      txCurrencyCode,
      stan: tx.stan,
      rrn: tx.rrn || tx.stan,
      batchId,
      reference: (tx.rrn || tx.stan || "")
    });
    if (!pendingByMidCcy[accountId]) pendingByMidCcy[accountId] = {};
    if (!pendingByMidCcy[accountId][merchantCurrency]) {
      pendingByMidCcy[accountId][merchantCurrency] = {
        merchantId: accountId,
        merchantCurrency,
        pendingAmountMerchantCcy: 0,
        pendingAmountTxCcy: 0,
        txCcyBreakdown: {},
        txCount: 0,
        batchIds: []
      };
    }
    const aggr = pendingByMidCcy[accountId][merchantCurrency];
    aggr.pendingAmountMerchantCcy += settledInMerchantCcy;
    aggr.pendingAmountTxCcy += disbursedInTxCcy;
    if (!aggr.txCcyBreakdown[txCurrencyCode]) aggr.txCcyBreakdown[txCurrencyCode] = 0;
    aggr.txCcyBreakdown[txCurrencyCode] += disbursedInTxCcy;
    aggr.txCount += 1;
    if (batchId && !aggr.batchIds.includes(batchId)) aggr.batchIds.push(batchId);

    const fxApplied = txCurrencyCode !== merchantCurrency;
    const fxRate = fxApplied ? fxRates[`${txCurrencyCode}_${merchantCurrency}`] : 1;

    const pendingLedger = {
      id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
      accountId,
      amount: settledInMerchantCcy,
      currencyCode: merchantCurrency,
      originalCurrencyCode: txCurrencyCode,
      originalAmount: amt,
      fxApplied,
      fxRate,
      mid: tx.mid,
      tid: tx.tid,
      rrn: tx.rrn || tx.stan,
      stan: tx.stan,
      authCode: "VB" + String(tx.stan || "").slice(-6),
      createdAt: new Date().toISOString(),
      type: "SETTLEMENT_PENDING_DISBURSEMENT",
      batchId,
      status: "AWAITING_MERCHANT_TRANSFER",
      pendingFromOmnibus: {
        accountId: VAULT_BANK_OMNIBUS_ID,
        amount: disbursedInTxCcy,
        currencyCode: txCurrencyCode,
        note: "Funds held in omnibus until merchant manually triggers Send to Vault Bank from POS dashboard wallet"
      }
    };
    ledger.push(pendingLedger);
    results.push({
      stan: tx.stan,
      ledgerId: pendingLedger.id,
      mid: accountId,
      merchantCurrency,
      amountInMerchantCcy: settledInMerchantCcy,
      pendingAmountTxCcy: disbursedInTxCcy,
      txCurrencyCode,
      status: "AWAITING_MERCHANT_TRANSFER",
      accountBalanceAfter: getAccountBalance(accountId, merchantCurrency),
      note: "Not auto-disbursed. Merchant must trigger 'Send to Vault Bank' from POS dashboard wallet when real funds confirmed."
    });
  }

  const pendingFlat = [];
  for (const mid of Object.keys(pendingByMidCcy)) {
    for (const mc of Object.keys(pendingByMidCcy[mid])) {
      pendingFlat.push(pendingByMidCcy[mid][mc]);
    }
  }

  return {
    schemeDeposits: depositEntries,
    disbursements: [],
    pendingDisbursements: results,
    pendingByMidCcy,
    pendingFlat,
    autoDisbursementsPerformed: false,
    totalsByCcy
  };
}

function runDailyClearingCycle() {
  if (!pendingClearing.length) {
    console.log("VaultBank Settlement: daily cycle — no pending auths, skipping");
    return null;
  }
  const batchId = "BATCH-" + Date.now();
  const batch = {
    batchId,
    createdAt: new Date().toISOString(),
    generatedBy: "AUTO_DAILY_CLEARING",
    status: "GENERATED",
    transactions: pendingClearing.slice()
  };
  clearingBatches.push(batch);
  pendingClearing = [];
  console.log("VaultBank Settlement: daily cycle generated batch " + batchId + " with " + batch.transactions.length + " tx");

  const settled = settleClearingBatchTransactions(batchId, batch.transactions);
  batch.status = "SETTLED";
  batch.settledAt = new Date().toISOString();
  batch.settlementResult = {
    count: settled.pendingDisbursements.length,
    settled: [],
    pendingDisbursements: settled.pendingDisbursements,
    pendingByMidCcy: settled.pendingByMidCcy,
    schemeDeposits: settled.schemeDeposits,
    totalsByCcy: settled.totalsByCcy,
    autoDisbursementsPerformed: false
  };
  console.log("VaultBank Settlement: daily cycle settled batch " + batchId + ", pendingDisbursements=" + settled.pendingDisbursements.length + ", schemeDeposits=" + settled.schemeDeposits.length + ". Merchant transfers gated behind POS dashboard manual trigger.");
  return batch;
}

function ensureAccount(accountId, currencyCode) {
  if (!accounts[accountId]) {
    accounts[accountId] = { defaultCurrency: DEFAULT_MERCHANT_CURRENCY, USD: 0, EUR: 0, AED: 0 };
  }
  if (!accounts[accountId].defaultCurrency) {
    accounts[accountId].defaultCurrency = DEFAULT_MERCHANT_CURRENCY;
  }
  if (currencyCode) {
    const cc = String(currencyCode).toUpperCase();
    if (typeof accounts[accountId][cc] !== "number") {
      accounts[accountId][cc] = 0;
    }
  }
}

function getAccountBalance(accountId, currencyCode) {
  ensureAccount(accountId, currencyCode);
  if (!currencyCode) {
    const def = getMerchantDefaultCurrency(accountId);
    return Number(accounts[accountId][def]) || 0;
  }
  return Number(accounts[accountId][String(currencyCode).toUpperCase()]) || 0;
}

function accruePendingMerchantDisbursement({ merchantId, currency, amountTxCcy, amountMerchantCcy, merchantCurrency, txCurrencyCode, stan, rrn, batchId, reference }) {
  if (!pendingMerchantDisbursements[merchantId]) pendingMerchantDisbursements[merchantId] = {};
  if (!pendingMerchantDisbursements[merchantId][merchantCurrency]) {
    pendingMerchantDisbursements[merchantId][merchantCurrency] = {
      merchantId,
      merchantCurrency,
      expectedAmountMerchantCcy: 0,
      expectedAmountTxCcyTotal: 0,
      txCcyBreakdown: {},
      txCount: 0,
      firstTxAt: new Date().toISOString(),
      lastTxAt: new Date().toISOString(),
      batchRefs: [],
      refs: [],
      stans: []
    };
  }
  const p = pendingMerchantDisbursements[merchantId][merchantCurrency];
  p.expectedAmountMerchantCcy += amountMerchantCcy;
  p.expectedAmountTxCcyTotal += amountTxCcy;
  if (!p.txCcyBreakdown[txCurrencyCode]) p.txCcyBreakdown[txCurrencyCode] = 0;
  p.txCcyBreakdown[txCurrencyCode] += amountTxCcy;
  p.txCount += 1;
  p.lastTxAt = new Date().toISOString();
  if (batchId && !p.batchRefs.includes(batchId)) p.batchRefs.push(batchId);
  if (reference && !p.refs.includes(reference)) p.refs.push(reference);
  if (stan && !p.stans.includes(stan)) p.stans.push(String(stan));
  return p;
}

function reducePendingMerchantDisbursement(merchantId, merchantCurrency, amountMerchantCcy) {
  const p = pendingMerchantDisbursements[merchantId]?.[merchantCurrency];
  if (!p) return null;
  const before = Number(p.expectedAmountMerchantCcy) || 0;
  const remaining = Math.max(0, before - amountMerchantCcy);
  p.expectedAmountMerchantCcy = remaining;
  if (remaining <= 0) {
    delete pendingMerchantDisbursements[merchantId][merchantCurrency];
    if (Object.keys(pendingMerchantDisbursements[merchantId]).length === 0) {
      delete pendingMerchantDisbursements[merchantId];
    }
  }
  return { before, after: remaining, reduced: Math.min(before, amountMerchantCcy) };
}

function verifyRequestSignature(req, rawBody) {
  const apiKey = String(process.env.VAULT_BANK_API_KEY || "vault-bank-demo-key").trim();
  const secret = String(process.env.VAULT_BANK_SECRET_KEY || "vault-bank-demo-secret").trim();
  const reqApiKey = String(req.headers["x-api-key"] || "").trim();
  const timestamp = String(req.headers["x-timestamp"] || "").trim();
  const nonce = String(req.headers["x-nonce"] || "").trim();
  const signature = String(req.headers["x-signature"] || "").trim();
  const idempotency = String(req.headers["idempotency-key"] || "").trim();
  const skipSig = !reqApiKey && !timestamp && !nonce && !signature;
  if (skipSig) return { ok: true, skipped: true, idempotency };
  if (reqApiKey && reqApiKey !== apiKey) return { ok: false, error: "INVALID_API_KEY", status: 401 };
  if (!timestamp || !nonce || !signature) return { ok: false, error: "MISSING_SIG_HEADERS", status: 401 };
  const now = Date.now();
  const tsDiff = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(tsDiff) || tsDiff > 5 * 60 * 1000) return { ok: false, error: "TIMESTAMP_OUTSIDE_WINDOW", status: 401 };
  const expected = require("crypto").createHmac("sha512", secret).update(`${timestamp}.${nonce}.${rawBody}`, "utf8").digest("hex");
  if (expected !== signature) return { ok: false, error: "INVALID_SIGNATURE", status: 401 };
  if (idempotency && idempotencyStore.has(idempotency)) {
    return { ok: true, idempotency, cached: idempotencyStore.get(idempotency) };
  }
  return { ok: true, idempotency };
}

function cacheIdempotentResponse(idempotency, status, bodyObj) {
  if (!idempotency) return;
  idempotencyStore.set(idempotency, { status, body: JSON.parse(JSON.stringify(bodyObj)) });
  if (idempotencyStore.size > 2000) {
    const arr = Array.from(idempotencyStore.keys());
    for (let i = 0; i < 500; i++) idempotencyStore.delete(arr[i]);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/vault/merchant-balance")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const merchantId = urlObj.searchParams.get("merchantId");

    if (!merchantId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "merchantId required" }));
    }
    ensureAccount(merchantId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      merchantId,
      balances: accounts[merchantId]
    }));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/card-balance")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const cardId = urlObj.searchParams.get("cardId");
    if (cardId) {
      const card = cardAccounts[cardId];
      if (!card) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "UNKNOWN_CARD_ID", cardId }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        cardId,
        balance: card.balance,
        currency: card.currency
      }));
    } else {
      const out = {};
      for (const cid of Object.keys(cardAccounts)) {
        out[cid] = { ...cardAccounts[cid] };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cards: out }));
    }
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/omnibus")) {
    ensureOmnibus();
    const balances = getAllOmnibusBalances();
    const totalInAed = Object.keys(balances).reduce((sum, ccy) => {
      const v = balances[ccy];
      if (ccy === "AED") return sum + v;
      try { return sum + convert(v, ccy, "AED"); } catch { return sum; }
    }, 0);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      omnibusAccount: VAULT_BANK_OMNIBUS_ID,
      description: "Vault Bank Omnibus Operating Account — actual withdrawable funds received from card schemes",
      balances,
      totalEstimatedAed: totalInAed,
      backedBy: "Card scheme settlements (Visa Base II / Mastercard IPM / Amex GNS) deposited to nostro correspondent accounts",
      backingStatus: Object.values(balances).some(v => v > 0) ? "FUNDED" : "UNFUNDED"
    }));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/balance")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const accountId = urlObj.searchParams.get("accountId");
    const currencyCode = urlObj.searchParams.get("currencyCode");

    const total = ledger.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const byCurrency = {};
    for (const e of ledger) {
      const k = e.currencyCode || "784";
      byCurrency[k] = (byCurrency[k] || 0) + (Number(e.amount) || 0);
    }

    let accountBalances = null;
    if (accountId) {
      ensureAccount(accountId);
      accountBalances = { ...accounts[accountId] };
    }

    const singleCurrency = accountId && currencyCode ? getAccountBalance(accountId, currencyCode) : undefined;
    ensureOmnibus();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      balance: total,
      byCurrency,
      entries: ledger.length,
      omnibus: {
        accountId: VAULT_BANK_OMNIBUS_ID,
        balances: getAllOmnibusBalances(),
        note: "Real withdrawable funds — card scheme deposits land here before merchant disbursement"
      },
      ...(accountBalances !== null ? { accountId, accountBalances } : {}),
      ...(singleCurrency !== undefined ? { accountCurrencyBalance: singleCurrency } : {})
    }));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/fx/rates")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      baseDate: new Date().toISOString().slice(0, 10),
      defaultCurrencies: DEFAULT_CURRENCIES,
      defaultMerchantCurrency: DEFAULT_MERCHANT_CURRENCY,
      rates: { ...fxRates }
    }));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/fx")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const from = urlObj.searchParams.get("from");
    const to = urlObj.searchParams.get("to");
    const rawAmount = urlObj.searchParams.get("amount");

    try {
      const amount = rawAmount === null || rawAmount === "" ? 1 : Number(rawAmount);
      if (!from || !to) throw new Error("Query parameters 'from' and 'to' are required");
      if (!Number.isFinite(amount)) throw new Error("Query parameter 'amount' must be numeric");
      const fromUp = String(from).toUpperCase();
      const toUp = String(to).toUpperCase();
      const converted = convert(amount, fromUp, toUp);
      const rate = fromUp === toUp ? 1 : fxRates[`${fromUp}_${toUp}`];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        from: fromUp,
        to: toUp,
        amount,
        converted,
        rate,
        ratePair: `${fromUp}_${toUp}`
      }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (req.method === "POST" && req.url === "/api/vault/settlement") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const rawBody = body;
        const tx = JSON.parse(body || "{}");
        console.log("VaultBank: settlement request:", tx);

        const sig = verifyRequestSignature(req, rawBody);
        if (sig.cached) {
          res.writeHead(sig.cached.status, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(sig.cached.body));
        }
        if (!sig.ok) {
          res.writeHead(sig.status || 401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: sig.error, settled: false, ok: false }));
        }

        if (Array.isArray(tx.entries) && tx.entries.length > 0) {
          console.log("VaultBank: settlement handler routing entries[] body to MERCHANT-TO-VAULT RECEPTION flow (source: merchant_wallet via dashboard Send to Vault Bank)");
          const resultEntries = [];
          let overallSuccess = true;
          let firstError = null;
          for (const e of tx.entries) {
            const merchantId = String(e.merchantId || "VAULT-MERCHANT-001").trim();
            const entryRef = String(e.reference || `MVR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`).trim();
            const txCurrencyCode = String(e.currency || e.currencyCode || "USD").toUpperCase();
            const rawAmt = Number(e.amount);
            const meta = e.meta || {};
            if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
              overallSuccess = false;
              firstError = firstError || "INVALID_AMOUNT";
              resultEntries.push({ id: null, merchantId, reference: entryRef, success: false, status: "REJECTED", error: "INVALID_AMOUNT", amount: rawAmt, currency: txCurrencyCode });
              continue;
            }
            const merchantCurrency = getMerchantDefaultCurrency(merchantId, txCurrencyCode);
            ensureAccount(merchantId, txCurrencyCode);
            ensureAccount(merchantId, merchantCurrency);
            ensureOmnibus();
            if (typeof accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] !== "number") accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] = 0;

            if (accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] < rawAmt) {
              overallSuccess = false;
              firstError = firstError || "OMNIBUS_SHORTFALL";
              console.warn(`VaultBank: MERCHANT-TO-VAULT REJECTED (OMNIBUS_SHORTFALL): ${rawAmt} ${txCurrencyCode} requested, omnibus has ${accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode]} ${txCurrencyCode}. merchantId=${merchantId} ref=${entryRef}`);
              resultEntries.push({ id: null, merchantId, reference: entryRef, success: false, status: "REJECTED", error: "OMNIBUS_SHORTFALL", errorDetail: `Vault omnibus does not have enough real funds to cover this transfer. Expected omnibus to have at least ${rawAmt} ${txCurrencyCode} backed by real scheme deposits.`, amount: rawAmt, currency: txCurrencyCode, omnibusAvailable: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] });
              continue;
            }

            const settledInMerchantCcy = convert(rawAmt, txCurrencyCode, merchantCurrency);
            accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] -= rawAmt;
            accounts[merchantId][merchantCurrency] += settledInMerchantCcy;

            const now = new Date().toISOString();
            const fxApplied = txCurrencyCode !== merchantCurrency;
            const fxRate = fxApplied ? fxRates[`${txCurrencyCode}_${merchantCurrency}`] : 1;

            const debitId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
            const debitEntry = {
              id: debitId,
              accountId: VAULT_BANK_OMNIBUS_ID,
              counterpartyAccountId: merchantId,
              type: "OMNIBUS_DEBIT_MERCHANT_VAULT_RECEPTION",
              direction: "DEBIT",
              amount: rawAmt,
              currencyCode: txCurrencyCode,
              description: `Merchant wallet Send to Vault Bank: OMNIBUS debited to fund merchant ${merchantId} vault account`,
              reference: entryRef,
              source: meta.source || "merchant_wallet",
              transferId: meta.transferId || null,
              meta,
              createdAt: now,
              balanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode]
            };
            ledger.push(debitEntry);

            const creditId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
            const creditEntry = {
              id: creditId,
              accountId: merchantId,
              counterpartyAccountId: VAULT_BANK_OMNIBUS_ID,
              type: "MERCHANT_VAULT_CREDIT_FROM_WALLET_TRANSFER",
              direction: "CREDIT",
              amount: settledInMerchantCcy,
              currencyCode: merchantCurrency,
              originalCurrencyCode: txCurrencyCode,
              originalAmount: rawAmt,
              fxApplied,
              fxRate,
              description: `Merchant wallet Send to Vault Bank: merchant vault account credited from omnibus pool (manual trigger confirmed real funds in wallet)`,
              reference: entryRef,
              source: meta.source || "merchant_wallet",
              transferId: meta.transferId || null,
              meta,
              createdAt: now,
              balanceAfter: accounts[merchantId][merchantCurrency]
            };
            ledger.push(creditEntry);

            const reduction = reducePendingMerchantDisbursement(merchantId, merchantCurrency, settledInMerchantCcy);

            resultEntries.push({
              id: creditId,
              ledgerId: creditId,
              debitLedgerId: debitId,
              merchantId,
              reference: entryRef,
              transferId: meta.transferId || null,
              success: true,
              ok: true,
              status: "COMPLETED",
              settled: true,
              amount: settledInMerchantCcy,
              currency: merchantCurrency,
              originalAmount: rawAmt,
              originalCurrency: txCurrencyCode,
              fxApplied,
              fxRate,
              balanceAfterOmnibusTxCcy: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode],
              balanceAfterMerchant: accounts[merchantId][merchantCurrency],
              pendingReduction: reduction
            });
          }
          const respBody = {
            success: overallSuccess,
            ok: overallSuccess,
            settled: overallSuccess,
            status: overallSuccess ? "COMPLETED" : "PARTIAL_OR_FAILED",
            error: firstError,
            source: "merchant_wallet_manual_transfer",
            receivedAt: new Date().toISOString(),
            entries: resultEntries
          };
          cacheIdempotentResponse(sig.idempotency, 200, respBody);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(respBody));
        }

        console.log("VaultBank: settlement handler routing to SCHEME PER-TX SETTLEMENT flow (no auto-disbursement; from primestack-processor.js callSettlementForTransaction)");
        const accountId = tx.accountId || "VAULT-MERCHANT-001";
        const txCurrencyCode = String(tx.currencyCode || "USD").toUpperCase();
        const requestedMerchantCurrency = tx.merchantCurrency || tx.defaultCurrency;
        const amt = Number(tx.amount) || 0;

        ensureOmnibus();
        if (typeof accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] !== "number") {
          accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] = 0;
        }

        accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] += amt;
        const schemeDeposit = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: VAULT_BANK_OMNIBUS_ID,
          type: "SCHEME_DEPOSIT",
          amount: amt,
          currencyCode: txCurrencyCode,
          description: "Card scheme settlement funded to bank omnibus (direct API)",
          reference: tx.rrn || tx.stan || null,
          createdAt: new Date().toISOString(),
          omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode]
        };
        ledger.push(schemeDeposit);

        if (requestedMerchantCurrency) {
          setMerchantDefaultCurrency(accountId, requestedMerchantCurrency);
        }
        const merchantCurrency = getMerchantDefaultCurrency(accountId, txCurrencyCode);

        ensureAccount(accountId, txCurrencyCode);
        ensureAccount(accountId, merchantCurrency);

        const settledAmountInTxCcy = amt;
        const settledAmountInMerchantCcy = convert(settledAmountInTxCcy, txCurrencyCode, merchantCurrency);

        const pending = accruePendingMerchantDisbursement({
          merchantId: accountId,
          currency: txCurrencyCode,
          amountTxCcy: settledAmountInTxCcy,
          amountMerchantCcy: settledAmountInMerchantCcy,
          merchantCurrency,
          txCurrencyCode,
          stan: tx.stan,
          rrn: tx.rrn,
          batchId: tx.batchId,
          reference: (tx.rrn || tx.stan || "")
        });

        const fxApplied = txCurrencyCode !== merchantCurrency;
        const fxRate = fxApplied ? fxRates[`${txCurrencyCode}_${merchantCurrency}`] : 1;

        const pendingLedger = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId,
          amount: settledAmountInMerchantCcy,
          currencyCode: merchantCurrency,
          originalCurrencyCode: txCurrencyCode,
          originalAmount: settledAmountInTxCcy,
          fxApplied,
          fxRate,
          mid: tx.mid,
          tid: tx.tid,
          rrn: tx.rrn,
          stan: tx.stan,
          authCode: tx.authCode,
          createdAt: new Date().toISOString(),
          type: "SETTLEMENT_PENDING_DISBURSEMENT",
          status: "AWAITING_MERCHANT_TRANSFER",
          pendingFromOmnibus: {
            accountId: VAULT_BANK_OMNIBUS_ID,
            amount: settledAmountInTxCcy,
            currencyCode: txCurrencyCode,
            note: "Funds held in omnibus. Merchant must trigger 'Send to Vault Bank' from POS dashboard Merchant Wallet when he confirms real funds are in his SQLite merchant_wallets balance."
          }
        };
        ledger.push(pendingLedger);

        const respBody = {
          settled: true,
          ok: true,
          success: true,
          status: "AWAITING_MERCHANT_TRANSFER",
          schemeDepositLedgerId: schemeDeposit.id,
          pendingLedgerId: pendingLedger.id,
          ledgerId: pendingLedger.id,
          merchantTransferPending: true,
          autoDisbursementsPerformed: false,
          pendingAmountInMerchantCcy: settledAmountInMerchantCcy,
          pendingAmountInTxCcy: settledAmountInTxCcy,
          currencyCode: merchantCurrency,
          originalAmount: settledAmountInTxCcy,
          originalCurrencyCode: txCurrencyCode,
          fxApplied,
          fxRate,
          accountId,
          merchantCurrency,
          stan: pendingLedger.stan,
          accountBalanceAfter: getAccountBalance(accountId, merchantCurrency),
          omnibusDeposit: {
            accountId: VAULT_BANK_OMNIBUS_ID,
            currencyCode: txCurrencyCode,
            amountIn: amt,
            amountRetainedInOmnibus: settledAmountInTxCcy,
            balanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode]
          },
          note: "Scheme settlement recorded. Omnibus credited with real scheme funds. Merchant accounts[] NOT auto-credited. The merchant's SQLite merchant_wallets is credited separately by batches.service.ts (creditMerchantWallet). Merchant must then manually click 'Send to Vault Bank' from POS dashboard to trigger OMNIBUS → accounts[mid] movement.",
          nextStep: `Merchant to use POS dashboard → Merchant Wallet → Send to Vault Bank with amount ${settledAmountInMerchantCcy} ${merchantCurrency} (or ${settledAmountInTxCcy} ${txCurrencyCode} if FX disabled) to finalise vault ledger credit.`
        };
        cacheIdempotentResponse(sig.idempotency, 200, respBody);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(respBody));
      } catch (err) {
        console.error("VaultBank: settlement error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ settled: false, error: err.message, success: false, ok: false }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/internal/reverse-transaction") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const tx = JSON.parse(body);
        console.log("VaultBank: internal reverse request:", tx);

        const stan = tx.stan;
        const amount = Number(tx.amount) || 0;
        const currencyCode = String(tx.currencyCode || "").toUpperCase();
        const mid = tx.mid;
        const tid = tx.tid;

        const findByKey = (e) =>
          e.type === "SETTLEMENT" &&
          e.stan === stan &&
          Number(e.amount) === amount &&
          (
            e.currencyCode === currencyCode ||
            (e.originalCurrencyCode && e.originalCurrencyCode === currencyCode && Number(e.originalAmount) === amount)
          ) &&
          e.mid === mid &&
          e.tid === tid;

        const settlementIdx = ledger.findIndex(findByKey);

        if (settlementIdx === -1) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ reversed: false, responseCode: "25", reason: "Unable to locate record" }));
        }

        const entry = ledger[settlementIdx];
        const entryCcy = entry.currencyCode;
        const entryAmt = Number(entry.amount);
        const origCcy = entry.originalCurrencyCode || entryCcy;
        const origAmt = entry.originalAmount !== undefined ? Number(entry.originalAmount) : entryAmt;
        ensureAccount(entry.accountId, entryCcy);
        ensureOmnibus();

        const cardLoadReversals = [];
        for (let i = settlementIdx + 1; i < ledger.length; i++) {
          const le = ledger[i];
          if (
            (le.type === "CARD_LOAD" || le.type === "TRANSFER_TO_CARD") &&
            le.accountId === entry.accountId &&
            le.cardId &&
            cardAccounts[le.cardId]
          ) {
            const merchantDebitAmt = Math.abs(Number(le.amount));
            const merchantDebitCcy = String(le.currencyCode || entryCcy).toUpperCase();
            const cardCredit = Number(le.cardAmount) || merchantDebitAmt;
            const cardCurrency = le.cardCurrency || cardAccounts[le.cardId].currency;

            ensureAccount(entry.accountId, merchantDebitCcy);
            accounts[entry.accountId][merchantDebitCcy] += merchantDebitAmt;

            cardAccounts[le.cardId].balance -= cardCredit;
            if (cardAccounts[le.cardId].balance < 0) {
              cardAccounts[le.cardId].balance = 0;
            }

            const cardRevEntry = {
              id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
              accountId: le.accountId,
              amount: merchantDebitAmt,
              currencyCode: merchantDebitCcy,
              cardCurrency,
              cardAmount: -cardCredit,
              fxApplied: Boolean(le.fxApplied),
              fxRate: le.fxRate || 1,
              mid: le.mid,
              tid: le.tid,
              stan: le.stan,
              cardId: le.cardId,
              type: "REVERSAL_CARD_UNLOAD",
              originalLedgerId: le.id,
              createdAt: new Date().toISOString()
            };
            ledger.push(cardRevEntry);
            cardLoadReversals.push(cardRevEntry);
          }
        }

        accounts[entry.accountId][entryCcy] -= entryAmt;

        let omnibusReversal = null;
        try {
          if (typeof accounts[VAULT_BANK_OMNIBUS_ID][origCcy] !== "number") {
            accounts[VAULT_BANK_OMNIBUS_ID][origCcy] = 0;
          }
          accounts[VAULT_BANK_OMNIBUS_ID][origCcy] -= origAmt;
          omnibusReversal = {
            id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
            accountId: VAULT_BANK_OMNIBUS_ID,
            type: "SCHEME_DEPOSIT_REVERSAL",
            amount: -origAmt,
            currencyCode: origCcy,
            description: "Reversal of scheme deposit (returned to card scheme / cardholder issuer)",
            reversedSettlementLedgerId: entry.id,
            stan,
            createdAt: new Date().toISOString(),
            omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][origCcy]
          };
          ledger.push(omnibusReversal);
        } catch (e) {
          console.warn("VaultBank reversal: omnibus undo skipped", e.message);
        }

        const reversalEntry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: entry.accountId,
          amount: -entryAmt,
          currencyCode: entryCcy,
          originalCurrencyCode: entry.originalCurrencyCode,
          originalAmount: entry.originalAmount !== undefined ? -Number(entry.originalAmount) : undefined,
          fxApplied: Boolean(entry.fxApplied),
          fxRate: entry.fxRate || 1,
          mid: entry.mid,
          tid: entry.tid,
          rrn: entry.rrn,
          stan: entry.stan,
          authCode: entry.authCode,
          type: "REVERSAL",
          originalLedgerId: entry.id,
          createdAt: new Date().toISOString(),
          omnibusReversed: omnibusReversal ? {
            ledgerId: omnibusReversal.id,
            amount: omnibusReversal.amount,
            currencyCode: origCcy,
            omnibusBalanceAfter: omnibusReversal.omnibusBalanceAfter
          } : null
        };
        ledger.push(reversalEntry);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          reversed: true,
          responseCode: "00",
          ledgerId: reversalEntry.id,
          accountId: entry.accountId,
          currencyCode: entryCcy,
          amount: reversalEntry.amount,
          accountBalanceAfter: accounts[entry.accountId][entryCcy],
          cardLoadReversals: cardLoadReversals.length,
          omnibusReversal: reversalEntry.omnibusReversed
        }));
      } catch (err) {
        console.error("VaultBank: internal reverse error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reversed: false, responseCode: "96", error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/internal/refund-transaction") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const tx = JSON.parse(body);
        console.log("VaultBank: internal refund request:", tx);

        const stan = tx.stan;
        const amountInRefundCcy = Number(tx.amount) || 0;
        const refundCurrencyCode = String(tx.currencyCode || "USD").toUpperCase();
        const mid = tx.mid || "VAULTBANK001";
        const tid = tx.tid || "";
        const accountId = mid;

        if (amountInRefundCcy <= 0 || !Number.isFinite(amountInRefundCcy)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ refunded: false, responseCode: "14", reason: "Invalid amount" }));
        }

        ensureOmnibus();
        const merchantCurrency = getMerchantDefaultCurrency(accountId, refundCurrencyCode);
        ensureAccount(accountId, refundCurrencyCode);
        ensureAccount(accountId, merchantCurrency);

        const refundInMerchantCcy = convert(amountInRefundCcy, refundCurrencyCode, merchantCurrency);
        const merchantBalance = Number(accounts[accountId][merchantCurrency]) || 0;
        if (merchantBalance < refundInMerchantCcy) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            refunded: false,
            responseCode: "51",
            reason: "Insufficient funds",
            merchantBalance,
            merchantCurrency,
            requiredInMerchantCcy: refundInMerchantCcy
          }));
        }

        accounts[accountId][merchantCurrency] -= refundInMerchantCcy;

        if (typeof accounts[VAULT_BANK_OMNIBUS_ID][refundCurrencyCode] !== "number") {
          accounts[VAULT_BANK_OMNIBUS_ID][refundCurrencyCode] = 0;
        }
        accounts[VAULT_BANK_OMNIBUS_ID][refundCurrencyCode] += amountInRefundCcy;
        const schemeReturn = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: VAULT_BANK_OMNIBUS_ID,
          type: "SCHEME_REFUND_RETURN",
          amount: amountInRefundCcy,
          currencyCode: refundCurrencyCode,
          description: "Refund held in omnibus pending return to card scheme (issuer reimbursement)",
          stan,
          createdAt: new Date().toISOString(),
          omnibusBalanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][refundCurrencyCode]
        };
        ledger.push(schemeReturn);

        const fxApplied = refundCurrencyCode !== merchantCurrency;
        const fxRate = fxApplied ? fxRates[`${refundCurrencyCode}_${merchantCurrency}`] : 1;

        const refundEntry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId,
          amount: -refundInMerchantCcy,
          currencyCode: merchantCurrency,
          originalCurrencyCode: refundCurrencyCode,
          originalAmount: -amountInRefundCcy,
          fxApplied,
          fxRate,
          mid,
          tid,
          rrn: tx.field7 || stan,
          stan,
          authCode: "RF" + (stan || "").slice(-6),
          type: "REFUND",
          createdAt: new Date().toISOString(),
          schemeReturnLedgerId: schemeReturn.id,
          schemeReturn: {
            accountId: VAULT_BANK_OMNIBUS_ID,
            currencyCode: refundCurrencyCode,
            amount: amountInRefundCcy,
            omnibusBalanceAfter: schemeReturn.omnibusBalanceAfter
          }
        };
        ledger.push(refundEntry);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          refunded: true,
          responseCode: "00",
          ledgerId: refundEntry.id,
          accountId,
          amount: refundEntry.amount,
          currencyCode: merchantCurrency,
          originalCurrencyCode: refundCurrencyCode,
          originalAmount: -amountInRefundCcy,
          fxApplied,
          fxRate,
          authCode: refundEntry.authCode,
          stan,
          merchantCurrency,
          accountBalanceAfter: accounts[accountId][merchantCurrency],
          schemeReturn: refundEntry.schemeReturn
        }));
      } catch (err) {
        console.error("VaultBank: internal refund error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ refunded: false, responseCode: "96", error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/vault-card/validate") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const { pan, expiry, cvv } = p;
        if (!pan) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ valid: false, reason: "PAN_REQUIRED" }));
        }
        const result = validateVaultCard(pan, expiry, cvv);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("VaultBank: vault-card/validate error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ valid: false, reason: "SYSTEM_ERROR", error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/vault-card/load-funds") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const { pan, expiry, cvv, amount, reference } = p;
        const amountMinor = Number(amount);
        if (!pan || !amountMinor || !Number.isFinite(amountMinor) || amountMinor <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "MISSING_OR_INVALID_PARAMS", required: ["pan", "amount"] }));
        }
        const check = validateVaultCard(pan, expiry, cvv);
        if (!check.valid || !check.card) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "CARD_VALIDATION_FAILED", validation: check }));
        }
        const ccy = String(check.card.ccy).toUpperCase();
        if (!ALL_OMNIBUS_CCY.includes(ccy)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "CARD_CURRENCY_NOT_OMNIBUS_SUPPORTED", cardCurrency: ccy, supported: ALL_OMNIBUS_CCY }));
        }
        const step1 = moveFundsFromOmnibusToVaultAccount(check.card.vaultAccount, ccy, amountMinor, reference || ("VAULT-CARD-LOAD-" + Date.now()));
        if (!step1.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, phase: "OMNIBUS_TO_VAULT_ACCOUNT", ...step1 }));
        }
        const step2 = moveFundsFromVaultAccountToPhysicalCard(check.card.vaultAccount, check.card.cardId, ccy, amountMinor, reference || ("VAULT-CARD-PUSH-" + Date.now()));
        if (!step2.ok) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, phase: "VAULT_ACCOUNT_TO_CARD", ...step2, rollbackNote: "Funds remain in vault account, re-run load-vault-card-account or refund manually." }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          loaded: true,
          card: {
            panLast4: check.card.last4,
            bin: check.card.bin,
            ccy: check.card.ccy,
            cardId: check.card.cardId,
            vaultAccount: check.card.vaultAccount,
            scheme: check.card.scheme,
            holder: check.card.holder
          },
          currency: ccy,
          amount: amountMinor,
          reference: reference || step1.debitLedgerId,
          phases: {
            omnibusToVaultAccount: {
              ok: true,
              debitLedgerId: step1.debitLedgerId,
              creditLedgerId: step1.creditLedgerId,
              omnibusBalanceAfter: step1.omnibusBalanceAfter,
              vaultBalanceAfter: step1.vaultBalanceAfter
            },
            vaultAccountToCard: {
              ok: true,
              ledgerId: step2.ledgerId,
              vaultBalanceAfter: step2.vaultBalanceAfter,
              cardBalanceAfter: step2.cardBalanceAfter
            }
          },
          cardBalanceAfter: step2.cardBalanceAfter
        }));
      } catch (err) {
        console.error("VaultBank: vault-card/load-funds error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ loaded: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/internal/load-vault-card-account") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const { cardId, vaultAccountId, currencyCode, amount, reference } = p;
        const amountMinor = Number(amount);
        const ccy = String(currencyCode || "USD").toUpperCase();
        if ((!cardId && !vaultAccountId) || !amountMinor || !Number.isFinite(amountMinor) || amountMinor <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "MISSING_OR_INVALID_PARAMS", required: ["cardId|vaultAccountId", "currencyCode", "amount"] }));
        }
        let resolvedVaultAccount = vaultAccountId;
        let resolvedCardId = cardId;
        if (resolvedCardId && !resolvedVaultAccount) {
          const ca = cardAccounts[resolvedCardId];
          if (!ca) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ loaded: false, error: "UNKNOWN_CARD_ID", cardId: resolvedCardId }));
          }
          resolvedVaultAccount = ca.vaultAccount;
          if (!resolvedVaultAccount) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ loaded: false, error: "CARD_HAS_NO_VAULT_ACCOUNT_LINK", cardId: resolvedCardId }));
          }
        }
        if (!resolvedVaultAccount) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "VAULT_ACCOUNT_NOT_RESOLVED" }));
        }
        ensureAccount(resolvedVaultAccount, ccy);
        accounts[resolvedVaultAccount][ccy] = (Number(accounts[resolvedVaultAccount][ccy]) || 0) + amountMinor;
        const ledgerEntry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: resolvedVaultAccount,
          type: "INTERNAL_VAULT_CARD_ACCOUNT_LOAD",
          amount: amountMinor,
          currencyCode: ccy,
          reference: reference || ("INT-LOAD-" + Date.now()),
          cardId: resolvedCardId || null,
          createdAt: new Date().toISOString(),
          vaultBalanceAfter: accounts[resolvedVaultAccount][ccy]
        };
        ledger.push(ledgerEntry);
        let cardPushResult = null;
        if (resolvedCardId && cardAccounts[resolvedCardId]) {
          const cardCcy = cardAccounts[resolvedCardId].currency || ccy;
          if (cardCcy !== ccy) {
            cardPushResult = { skipped: true, reason: "CARD_CURRENCY_MISMATCH_USE_LOAD_FUNDS_ENDPOINT", cardCurrency: cardCcy, vaultCurrency: ccy };
          } else {
            const push = moveFundsFromVaultAccountToPhysicalCard(resolvedVaultAccount, resolvedCardId, cardCcy, amountMinor, reference || ("INT-PUSH-" + Date.now()));
            cardPushResult = push;
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          loaded: true,
          vaultAccountId: resolvedVaultAccount,
          cardId: resolvedCardId || null,
          currencyCode: ccy,
          amount: amountMinor,
          ledgerId: ledgerEntry.id,
          vaultBalanceAfter: ledgerEntry.vaultBalanceAfter,
          cardPush: cardPushResult,
          note: "Internal acquirer loopback endpoint — assumes omnibus funding was already confirmed upstream. No card validation performed."
        }));
      } catch (err) {
        console.error("VaultBank: internal/load-vault-card-account error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ loaded: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/internal/debit-card-account") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const { cardId, vaultAccountId, currencyCode, amount, reference } = p;
        const amountMinor = Number(amount);
        const ccy = String(currencyCode || "USD").toUpperCase();
        if (!cardId || !amountMinor || !Number.isFinite(amountMinor) || amountMinor <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ debited: false, error: "MISSING_OR_INVALID_PARAMS", required: ["cardId", "currencyCode", "amount"] }));
        }
        if (!cardAccounts[cardId]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ debited: false, error: "UNKNOWN_CARD_ID", cardId }));
        }
        const cardCcy = cardAccounts[cardId].currency;
        if (cardCcy && String(cardCcy).toUpperCase() !== ccy) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ debited: false, error: "CARD_CURRENCY_MISMATCH", cardCurrency: cardCcy, requested: ccy }));
        }
        const resolvedVaultAccount = vaultAccountId || cardAccounts[cardId].vaultAccount;
        if (!resolvedVaultAccount) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ debited: false, error: "NO_VAULT_ACCOUNT_LINKED", cardId }));
        }
        const cardBalance = Number(cardAccounts[cardId].balance) || 0;
        if (cardBalance < amountMinor) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            debited: false,
            error: "INSUFFICIENT_CARD_BALANCE",
            cardId, cardCurrency: ccy,
            cardBalance, required: amountMinor, shortfall: amountMinor - cardBalance
          }));
        }
        ensureAccount(resolvedVaultAccount, ccy);
        cardAccounts[cardId].balance = cardBalance - amountMinor;
        accounts[resolvedVaultAccount][ccy] = (Number(accounts[resolvedVaultAccount][ccy]) || 0) + amountMinor;
        const ledgerEntry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: resolvedVaultAccount,
          type: "VAULT_CARD_AUTH_DEBIT_TO_VAULT",
          amount: amountMinor,
          currencyCode: ccy,
          reference: reference || ("AUTH-DEBIT-" + Date.now()),
          cardId,
          createdAt: new Date().toISOString(),
          cardBalanceAfter: cardAccounts[cardId].balance,
          vaultBalanceAfter: accounts[resolvedVaultAccount][ccy]
        };
        ledger.push(ledgerEntry);
        // ── Persist debit to SQLite so balance survives restart ──────────────
        persistCardDebit(cardId, ccy, amountMinor, reference || ledgerEntry.id, `POS debit → vault ${resolvedVaultAccount}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          debited: true,
          cardId, vaultAccountId: resolvedVaultAccount,
          currencyCode: ccy, amount: amountMinor,
          ledgerId: ledgerEntry.id,
          cardBalanceAfter: ledgerEntry.cardBalanceAfter,
          vaultBalanceAfter: ledgerEntry.vaultBalanceAfter,
          note: "Card account debited (spend at POS). Funds moved back to card's linked vault account to back settlement outflow to acquirer/mid."
        }));
      } catch (err) {
        console.error("VaultBank: internal/debit-card-account error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ debited: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/transfer-to-card") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const raw = JSON.parse(body);
        console.log("VaultBank: transfer-to-card request:", raw);

        const merchantId = raw.merchantId;
        const cardId = raw.cardId;
        const sourceCurrency = String(raw.currencyCode || "").toUpperCase();
        const amount = Number(raw.amount);

        if (!merchantId || !cardId || !sourceCurrency || !Number.isFinite(amount) || amount <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ transferred: false, error: "MISSING_OR_INVALID_PARAMS" }));
        }
        if (!cardAccounts[cardId]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ transferred: false, error: "UNKNOWN_CARD_ID", cardId }));
        }

        const cardCurrency = cardAccounts[cardId].currency;
        ensureAccount(merchantId, sourceCurrency);
        const merchantBalance = Number(accounts[merchantId][sourceCurrency]) || 0;
        if (merchantBalance < amount) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            transferred: false,
            error: "INSUFFICIENT_MERCHANT_BALANCE",
            merchantBalance,
            sourceCurrency
          }));
        }

        const cardCreditAmount = convert(amount, sourceCurrency, cardCurrency);
        accounts[merchantId][sourceCurrency] -= amount;
        cardAccounts[cardId].balance += cardCreditAmount;

        const fxApplied = sourceCurrency !== cardCurrency;
        const fxRate = fxApplied ? fxRates[`${sourceCurrency}_${cardCurrency}`] : 1;

        const entry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: merchantId,
          amount: -amount,
          currencyCode: sourceCurrency,
          cardCurrency,
          cardAmount: cardCreditAmount,
          fxApplied,
          fxRate,
          createdAt: new Date().toISOString(),
          type: "TRANSFER_TO_CARD",
          cardId
        };
        ledger.push(entry);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          transferred: true,
          merchantId,
          cardId,
          sourceAmount: amount,
          sourceCurrency,
          cardAmount: cardCreditAmount,
          cardCurrency,
          fxApplied,
          fxRate,
          merchantBalanceAfter: accounts[merchantId][sourceCurrency],
          cardBalanceAfter: cardAccounts[cardId].balance,
          ledgerId: entry.id
        }));
      } catch (err) {
        console.error("VaultBank: transfer-to-card error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ transferred: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/card-load") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const tx = JSON.parse(body);
        console.log("VaultBank: card load request:", tx);

        const { accountId, cardId, amount } = tx;
        const sourceCurrency = String(tx.currencyCode || "").toUpperCase();
        const amt = Number(amount);

        if (!accountId || !cardId || !sourceCurrency || !Number.isFinite(amt) || amt <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "MISSING_OR_INVALID_PARAMS" }));
        }
        if (!cardAccounts[cardId]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ loaded: false, error: "UNKNOWN_CARD_ID", cardId }));
        }

        const cardCurrency = cardAccounts[cardId].currency;
        const balance = getAccountBalance(accountId, sourceCurrency);
        if (amt > balance) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            loaded: false,
            error: "INSUFFICIENT_VAULT_BALANCE",
            vaultBalance: balance,
            sourceCurrency
          }));
        }

        const cardCreditAmount = convert(amt, sourceCurrency, cardCurrency);
        accounts[accountId][sourceCurrency] -= amt;
        cardAccounts[cardId].balance += cardCreditAmount;

        const fxApplied = sourceCurrency !== cardCurrency;
        const fxRate = fxApplied ? fxRates[`${sourceCurrency}_${cardCurrency}`] : 1;

        const entry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId,
          amount: -amt,
          currencyCode: sourceCurrency,
          cardCurrency,
          cardAmount: cardCreditAmount,
          fxApplied,
          fxRate,
          createdAt: new Date().toISOString(),
          type: "CARD_LOAD",
          cardId
        };
        ledger.push(entry);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          loaded: true,
          cardId,
          sourceAmount: amt,
          sourceCurrency,
          cardAmount: cardCreditAmount,
          cardCurrency,
          fxApplied,
          fxRate,
          vaultBalanceAfter: accounts[accountId][sourceCurrency],
          cardBalanceAfter: cardAccounts[cardId].balance,
          ledgerId: entry.id
        }));
      } catch (err) {
        console.error("VaultBank: card load error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ loaded: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/funds-received") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const amount = Number(p.amount) || 0;
        const currencyCode = String(p.currencyCode || "AED").toUpperCase();
        const scheme = String(p.scheme || "VISA").toUpperCase();
        const reference = String(p.reference || ("BANK-DEP-" + Date.now()));
        const batchId = p.batchId || null;
        const source = String(p.source || "MANUAL_CONFIRMATION").toUpperCase();
        const notes = String(p.notes || "");

        if (amount <= 0) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "INVALID_AMOUNT", expected: "positive amount" })); }
        if (!ALL_OMNIBUS_CCY.includes(currencyCode)) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "CURRENCY_NOT_SUPPORTED_OMNIBUS", supported: ALL_OMNIBUS_CCY })); }

        ensureOmnibus();
        const prev = Number(accounts[VAULT_BANK_OMNIBUS_ID][currencyCode]) || 0;
        accounts[VAULT_BANK_OMNIBUS_ID][currencyCode] = prev + amount;
        const omnibusBalanceAfter = Number(accounts[VAULT_BANK_OMNIBUS_ID][currencyCode]) || 0;

        const ledgerEntry = {
          id: "LDG-" + (ledger.length + 1).toString().padStart(5, "0"),
          accountId: VAULT_BANK_OMNIBUS_ID,
          type: "FUNDS_RECEIVED_FROM_SCHEME",
          subType: scheme,
          direction: "CREDIT",
          amount,
          currencyCode,
          scheme,
          reference,
          batchId,
          source,
          notes,
          createdAt: new Date().toISOString(),
          balanceBefore: prev,
          balanceAfter: omnibusBalanceAfter
        };
        ledger.push(ledgerEntry);

        const fundingEntry = {
          id: "FR-" + (fundsReceivedLedger.length + 1).toString().padStart(5, "0"),
          amount, currencyCode, scheme, reference, batchId, source, notes,
          createdAt: ledgerEntry.createdAt,
          ledgerId: ledgerEntry.id,
          omnibusBalanceAfter
        };
        fundsReceivedLedger.push(fundingEntry);

        if (batchId) {
          const key = `${batchId}:${currencyCode}`;
          if (!fundingConfirmedByCcyBatch[key]) fundingConfirmedByCcyBatch[key] = { confirmed: 0, expected: 0, deposited: 0 };
          fundingConfirmedByCcyBatch[key].deposited += amount;
        }

        console.log(`VaultBank Settlement: 💰 FUNDS_RECEIVED ${amount} ${currencyCode} from ${scheme} (${source}) → OMNIBUS[${currencyCode}] = ${omnibusBalanceAfter} (ref ${reference})`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          received: true,
          fundingId: fundingEntry.id,
          ledgerId: ledgerEntry.id,
          scheme,
          currencyCode,
          amount,
          reference,
          omnibusBalanceAfter,
          note: "This money is now real withdrawable funds in the Vault Bank omnibus. It remains in OMNIBUS until merchant manually triggers Send to Vault Bank from POS dashboard Merchant Wallet page.",
          nextStep: batchId ? "Scheme funds now held in omnibus pool. Merchant wallet is credited independently via batches.service.ts. Merchant must manually click 'Send to Vault Bank' on POS dashboard to move from omnibus to their vault accounts[] ledger." : "Scheme funds now held in omnibus pool. Merchant must trigger manual transfer from POS dashboard."
        }));
      } catch (err) {
        console.error("VaultBank Settlement: FUNDS_RECEIVED error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: false, error: err.message }));
      }
    });
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/funds-received")) {
    const totalByCcy = {};
    const countByCcy = {};
    for (const f of fundsReceivedLedger) {
      totalByCcy[f.currencyCode] = (totalByCcy[f.currencyCode] || 0) + f.amount;
      countByCcy[f.currencyCode] = (countByCcy[f.currencyCode] || 0) + 1;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      count: fundsReceivedLedger.length,
      totalByCcy,
      countByCcy,
      entries: fundsReceivedLedger.slice().reverse()
    }));
  } else if (req.method === "POST" && req.url === "/api/vault/clearing/export-settlement-files") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const p = body ? JSON.parse(body) : {};
        const batchId = p.batchId;
        if (!batchId) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "BATCH_ID_REQUIRED" })); }
        const batch = clearingBatches.find(b => b.batchId === batchId);
        if (!batch) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "BATCH_NOT_FOUND", batchId })); }
        const tx = (batch._rawTransactions || batch.transactions || []).slice();
        const byScheme = {};
        for (const t of tx) {
          const panDigits = String(t.pan || "").replace(/\D/g, "");
          let scheme = "OTHER";
          if (panDigits.startsWith("4")) scheme = "VISA";
          else if (/^5[1-5]/.test(panDigits) || panDigits.startsWith("52")) scheme = "MASTERCARD";
          else if (panDigits.startsWith("34") || panDigits.startsWith("37")) scheme = "AMEX";
          else if (panDigits.startsWith("6011")) scheme = "DISCOVER";
          if (!byScheme[scheme]) byScheme[scheme] = [];
          byScheme[scheme].push(t);
        }
        const files = [];
        const outDir = path.resolve(process.cwd(), "settlement-exports", batchId);
        fs.mkdirSync(outDir, { recursive: true });

        if (byScheme.VISA && byScheme.VISA.length > 0) {
          let total = 0;
          let lines = [
            "H,01,VISA_BASEII," + batchId + "," + new Date().toISOString().slice(0,10).replace(/-/g,""),
            "D,DETAIL_RECORD,STAN,RRN,AMOUNT,CURRENCY,CARD_BIN,CARD_LAST4,AUTH_CODE,MCC,MID,TID,ACQ_REF,DATE",
          ];
          for (const t of byScheme.VISA) {
            const panDigits = String(t.pan || "").replace(/\D/g, "");
            const amt = Number(t.amount) || 0;
            total += amt;
            lines.push([
              "D",
              "TX",
              String(t.stan || "").padStart(6, "0"),
              String(t.rrn || "").padStart(12, "0"),
              String(amt).padStart(12, "0"),
              currencyNumericToAlpha(t.currencyCode),
              panDigits.slice(0, 6),
              panDigits.slice(-4),
              String(t.authCode || t.auth || "").slice(0, 6),
              String(t.mcc || "").slice(0, 4),
              String(t.mid || "").padEnd(15, " ").slice(0, 15),
              String(t.tid || "").padEnd(8, " ").slice(0, 8),
              t.stan ? "V" + t.stan : "",
              (t.createdAt || new Date().toISOString()).slice(0,19)
            ].join(","));
          }
          lines.push("T,VISA_TOTALS," + byScheme.VISA.length + "," + total.toFixed(2));
          const fname = `VISA_BASEII_${batchId}_${Date.now()}.csv`;
          fs.writeFileSync(path.join(outDir, fname), lines.join("\n"));
          files.push({ scheme: "VISA", format: "VISA_BASEII_CSV", fileName: fname, recordCount: byScheme.VISA.length, total });
        }

        if (byScheme.MASTERCARD && byScheme.MASTERCARD.length > 0) {
          let total = 0;
          let lines = [
            "1IPMCIPMFILEHDR01MASTERCARD_IPM_" + batchId + new Date().toISOString().slice(0,10).replace(/-/g,"") + "                                 ",
            "1DETAILRCDTPP0100STAN    RRN          AMOUNT      CCY BIN   LAST4 AUTH MCC  MID            TID     DATE",
          ];
          for (const t of byScheme.MASTERCARD) {
            const panDigits = String(t.pan || "").replace(/\D/g, "");
            const amt = Number(t.amount) || 0;
            total += amt;
            lines.push("1" + [
              "TX",
              "TPP",
              String(t.stan || "").padStart(6, "0"),
              String(t.rrn || "").padStart(12, "0"),
              String(amt).padStart(12, "0"),
              currencyNumericToAlpha(t.currencyCode).padEnd(3, " "),
              panDigits.slice(0, 6),
              panDigits.slice(-4),
              String(t.authCode || t.auth || "").slice(0, 6).padEnd(6, " "),
              String(t.mcc || "").slice(0, 4).padEnd(4, " "),
              String(t.mid || "").padEnd(15, " ").slice(0, 15),
              String(t.tid || "").padEnd(8, " ").slice(0, 8),
              (t.createdAt || new Date().toISOString()).slice(0,10)
            ].join(""));
          }
          lines.push("1IPMTAIL" + String(byScheme.MASTERCARD.length).padStart(6, "0") + String(total.toFixed(2)).padStart(18, "0"));
          const fname = `MC_IPM_${batchId}_${Date.now()}.txt`;
          fs.writeFileSync(path.join(outDir, fname), lines.join("\n"));
          files.push({ scheme: "MASTERCARD", format: "MASTERCARD_IPM_TXT", fileName: fname, recordCount: byScheme.MASTERCARD.length, total });
        }

        if (byScheme.AMEX && byScheme.AMEX.length > 0) {
          let total = 0;
          const lines = [];
          for (const t of byScheme.AMEX) { total += Number(t.amount) || 0; lines.push(JSON.stringify(t)); }
          const fname = `AMEX_GNS_${batchId}_${Date.now()}.jsonl`;
          fs.writeFileSync(path.join(outDir, fname), lines.join("\n"));
          files.push({ scheme: "AMEX", format: "AMEX_GNS_JSONL", fileName: fname, recordCount: byScheme.AMEX.length, total });
        }

        const fnameAll = `ALL_TX_${batchId}_${Date.now()}.json`;
        fs.writeFileSync(path.join(outDir, fnameAll), JSON.stringify(batch, null, 2));
        files.push({ scheme: "ALL", format: "FULL_BATCH_JSON", fileName: fnameAll, recordCount: tx.length, total: null });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          exported: true,
          batchId,
          outDir,
          files,
          nextStep: [
            "1) Upload VISA_BASEII_*.csv to Visa Net settlement portal (or transmit via SFTP to Visa Connect).",
            "2) Upload MC_IPM_*.txt to Mastercard MIP / GCMS file receiver.",
            "3) After scheme processes these files + ACH/Wire payout hits your Vault Bank operating account:",
            "     → POST /api/vault/funds-received with amount + batchId to mark funds REAL in the omnibus.",
            "4) POST /api/vault/clearing/settle with batchId to record scheme deposit to omnibus (merchant accounts[] NOT auto-credited).",
            "5) Merchant confirms real funds landed in his SQLite merchant_wallets (credited by batches.service.ts → creditMerchantWallet).",
            "6) Merchant clicks 'Send to Vault Bank' on POS dashboard Merchant Wallet page → debits wallet + credits accounts[mid] from OMNIBUS."
          ].join("\n")
        }));
      } catch (err) {
        console.error("VaultBank Settlement: export-settlement-files error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ exported: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/internal/add-pending-auth") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const entry = JSON.parse(body);
        pendingClearing.push(entry);
        console.log("VaultBank Settlement: pending auth enqueued. pendingClearing count: " + pendingClearing.length + " stan=" + (entry && entry.stan));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, queued: pendingClearing.length, stan: entry && entry.stan }));
      } catch (err) {
        console.error("VaultBank Settlement: add-pending-auth error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/clearing/pending")) {
    const pendingCopy = pendingClearing.map(tx => ({ ...tx, pan: tx.pan ? String(tx.pan).substring(0, 6) + "******" + String(tx.pan).substring(12) : null }));
    const totals = {};
    for (const tx of pendingClearing) {
      const ccy = currencyNumericToAlpha(tx.currencyCode);
      if (!totals[ccy]) totals[ccy] = { count: 0, amount: 0 };
      totals[ccy].count += 1;
      totals[ccy].amount += Number(tx.amount) || 0;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      count: pendingClearing.length,
      totals,
      transactions: pendingCopy
    }));
  } else if (req.method === "POST" && req.url === "/api/vault/clearing/generate") {
    const batchId = "BATCH-" + Date.now();
    const txSnapshot = pendingClearing.slice();

    const totals = {};
    for (const tx of txSnapshot) {
      const ccy = currencyNumericToAlpha(tx.currencyCode);
      if (!totals[ccy]) totals[ccy] = { count: 0, amount: 0 };
      totals[ccy].count += 1;
      totals[ccy].amount += Number(tx.amount) || 0;
    }

    const batch = {
      batchId,
      createdAt: new Date().toISOString(),
      generatedBy: "MANUAL",
      status: "GENERATED",
      count: txSnapshot.length,
      totals,
      transactions: txSnapshot.map(tx => ({
        ...tx,
        pan: tx.pan ? String(tx.pan).substring(0, 6) + "******" + String(tx.pan).substring(12) : null
      })),
      _rawTransactions: txSnapshot
    };

    clearingBatches.push(batch);
    pendingClearing = [];
    console.log("VaultBank Settlement: clearing batch generated " + batchId + " with " + batch.count + " tx. totals=" + JSON.stringify(totals));

    res.writeHead(200, { "Content-Type": "application/json" });
    const { _rawTransactions, ...publicBatch } = batch;
    res.end(JSON.stringify(publicBatch));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/clearing/batches")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const batchId = urlObj.searchParams.get("batchId");
    const includeTransactions = urlObj.searchParams.get("include") === "tx";

    if (batchId) {
      const b = clearingBatches.find(x => x.batchId === batchId);
      if (!b) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "BATCH_NOT_FOUND", batchId }));
      }
      const out = { ...b };
      if (b._rawTransactions && includeTransactions) {
        out.transactions = b._rawTransactions.map(tx => ({
          ...tx,
          pan: tx.pan ? String(tx.pan).substring(0, 6) + "******" + String(tx.pan).substring(12) : null
        }));
      } else if (out.transactions) {
        out.transactions = (out.transactions || []).map(tx => ({
          ...tx,
          pan: tx.pan ? String(tx.pan).substring(0, 6) + "******" + String(tx.pan).substring(12) : null
        }));
      }
      delete out._rawTransactions;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out));
    }

    const summary = clearingBatches.map(b => {
      const s = {
        batchId: b.batchId,
        createdAt: b.createdAt,
        generatedBy: b.generatedBy,
        status: b.status,
        count: b.count != null ? b.count : ((b._rawTransactions ? b._rawTransactions.length : (b.transactions ? b.transactions.length : 0))),
        totals: b.totals || null,
        settledAt: b.settledAt || null
      };
      if (b.settlementResult) {
        s.settlementResult = {
          count: b.settlementResult.count
        };
      }
      return s;
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      count: summary.length,
      batches: summary
    }));
  } else if (req.method === "POST" && req.url === "/api/vault/clearing/settle") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const { batchId } = parsed;

        const batch = clearingBatches.find(b => b.batchId === batchId);
        if (!batch) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "BATCH_NOT_FOUND", batchId }));
        }

        if (batch.status === "SETTLED") {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            settled: true,
            alreadySettled: true,
            batchId,
            settledAt: batch.settledAt,
            count: batch.settlementResult ? batch.settlementResult.count : 0
          }));
        }

        const rawTx = batch._rawTransactions || batch.transactions || [];
        const settled = settleClearingBatchTransactions(batchId, rawTx);

        batch.status = "SETTLED";
        batch.settledAt = new Date().toISOString();
        batch.settlementResult = {
          count: settled.pendingDisbursements.length,
          settled: [],
          pendingDisbursements: settled.pendingDisbursements,
          pendingByMidCcy: settled.pendingByMidCcy,
          schemeDeposits: settled.schemeDeposits,
          totalsByCcy: settled.totalsByCcy,
          autoDisbursementsPerformed: false
        };
        console.log("VaultBank Settlement: batch settled " + batchId + " pendingDisbursements=" + settled.pendingDisbursements.length + " schemeDeposits=" + settled.schemeDeposits.length + ". Merchant vault transfers now gated behind POS dashboard Send to Vault Bank trigger.");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          settled: true,
          batchId,
          settledAt: batch.settledAt,
          count: settled.pendingDisbursements.length,
          autoDisbursementsPerformed: false,
          totals: batch.totals || settled.totalsByCcy,
          schemeDeposits: settled.schemeDeposits.map(d => ({
            ledgerId: d.id,
            currencyCode: d.currencyCode,
            amount: d.amount,
            omnibusBalanceAfter: d.omnibusBalanceAfter
          })),
          pendingPerTx: settled.pendingDisbursements.map(s => ({
            stan: s.stan,
            ledgerId: s.ledgerId,
            mid: s.mid,
            merchantCurrency: s.merchantCurrency,
            pendingAmountMerchantCcy: s.amountInMerchantCcy,
            pendingAmountTxCcy: s.pendingAmountTxCcy,
            txCurrencyCode: s.txCurrencyCode,
            status: s.status
          })),
          pendingAggregate: settled.pendingFlat,
          note: "Scheme funds landed in OMNIBUS. Merchant balances in accounts[] NOT auto-incremented. Merchant must use POS dashboard Merchant Wallet → Send to Vault Bank button to trigger transfer from omnibus to their vault account. SQLite merchant_wallets balance is credited independently by batches.service.ts."
        }));
      } catch (err) {
        console.error("VaultBank Settlement: batch settle error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ settled: false, error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/clearing/auto-cycle") {
    const batch = runDailyClearingCycle();
    if (!batch) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ cycled: false, reason: "NO_PENDING_AUTHS", pendingClearingCount: 0 }));
    }
    const { _rawTransactions, settlementResult, ...publicBatch } = batch;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      cycled: true,
      batch: {
        ...publicBatch,
        settlementCount: settlementResult ? settlementResult.count : 0
      }
    }));
  } else if (req.method === "GET" && req.url.startsWith("/api/vault/pending-merchant-disbursements")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const merchantId = urlObj.searchParams.get("merchantId");
    const currencyCode = urlObj.searchParams.get("currencyCode");
    const totalInPoolByCcy = {};
    const perMerchant = {};
    const perMerchantFlat = [];
    const mids = merchantId ? [merchantId] : Object.keys(pendingMerchantDisbursements);
    for (const mid of mids) {
      const byCcy = pendingMerchantDisbursements[mid] || {};
      const ccyList = currencyCode ? [currencyCode] : Object.keys(byCcy);
      if (!perMerchant[mid] && ccyList.length) perMerchant[mid] = {};
      for (const mc of ccyList) {
        const p = byCcy[mc];
        if (!p) continue;
        perMerchant[mid][mc] = { ...p };
        perMerchantFlat.push({ ...p });
        for (const txCcy of Object.keys(p.txCcyBreakdown || {})) {
          totalInPoolByCcy[txCcy] = (totalInPoolByCcy[txCcy] || 0) + (Number(p.txCcyBreakdown[txCcy]) || 0);
        }
      }
      if (perMerchant[mid] && !Object.keys(perMerchant[mid]).length) delete perMerchant[mid];
    }
    let grandTotalOmnibus = 0;
    ensureOmnibus();
    const omnibusBalances = getAllOmnibusBalances();
    for (const ccy of Object.keys(totalInPoolByCcy)) {
      const pool = Number(totalInPoolByCcy[ccy]) || 0;
      const avail = Number(omnibusBalances[ccy]) || 0;
      totalInPoolByCcy[ccy] = { expectedInPool: pool, omnibusAvailable: avail, coverage: pool > 0 ? Math.min(100, Number((avail / pool * 100).toFixed(2))) : 100 };
      try { grandTotalOmnibus += Number(convert(avail, ccy, "USD")) || 0; } catch { /* skip */ }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      count: perMerchantFlat.length,
      queryFilters: { merchantId: merchantId || null, currencyCode: currencyCode || null },
      totalInPoolByCcy,
      grandTotalOmnibusEquivalentUsd: grandTotalOmnibus,
      perMerchant,
      perMerchantFlat: perMerchantFlat.sort((a, b) => String(a.merchantId).localeCompare(String(b.merchantId)) || String(a.merchantCurrency).localeCompare(String(b.merchantCurrency))),
      note: "This endpoint reports what vault accounts[] OMNIBUS pool OWES each merchant due to settled scheme transactions. The merchant wallet (SQLite merchant_wallets) holds the actual confirmed balance the merchant can see and spend; he manually clicks Send to Vault Bank from the wallet dashboard to materialise this expected amount into accounts[mid]."
    }));
  } else if (req.method === "POST" && req.url === "/api/vault/credit") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const rawBody = body;
        const p = body ? JSON.parse(body) : {};
        const sig = verifyRequestSignature(req, rawBody);
        if (sig.cached) {
          res.writeHead(sig.cached.status, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(sig.cached.body));
        }
        if (!sig.ok) {
          res.writeHead(sig.status || 401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: sig.error, ok: false }));
        }
        const merchantId = String(p.merchantId || "VAULT-MERCHANT-001").trim();
        const txCurrencyCode = String(p.currency || p.currencyCode || "USD").toUpperCase();
        const reference = String(p.reference || `CR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`).trim();
        const amount = Number(p.amount);
        const type = String(p.type || "MANUAL_CREDIT");
        const meta = p.meta || {};
        if (!Number.isFinite(amount) || amount <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "INVALID_AMOUNT", ok: false, amount }));
        }
        const merchantCurrency = getMerchantDefaultCurrency(merchantId, txCurrencyCode);
        ensureAccount(merchantId, txCurrencyCode);
        ensureAccount(merchantId, merchantCurrency);
        ensureOmnibus();
        if (typeof accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] !== "number") accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] = 0;
        if (accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] < amount) {
          res.writeHead(409, { "Content-Type": "application/json" });
          const bodyFail = { success: false, ok: false, error: "OMNIBUS_SHORTFALL", amount, currency: txCurrencyCode, omnibusAvailable: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode], reference, merchantId, type };
          cacheIdempotentResponse(sig.idempotency, 409, bodyFail);
          return res.end(JSON.stringify(bodyFail));
        }
        const settledInMerchantCcy = convert(amount, txCurrencyCode, merchantCurrency);
        accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode] -= amount;
        accounts[merchantId][merchantCurrency] += settledInMerchantCcy;
        const now = new Date().toISOString();
        const fxApplied = txCurrencyCode !== merchantCurrency;
        const fxRate = fxApplied ? fxRates[`${txCurrencyCode}_${merchantCurrency}`] : 1;
        const debitId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
        ledger.push({
          id: debitId, accountId: VAULT_BANK_OMNIBUS_ID, counterpartyAccountId: merchantId,
          type: "OMNIBUS_DEBIT_FOR_CREDIT_ENDPOINT", direction: "DEBIT",
          amount, currencyCode: txCurrencyCode,
          description: `/credit endpoint: OMNIBUS debited for merchant ${merchantId} vault credit (${type})`,
          reference, typeMeta: type, meta, createdAt: now,
          balanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode]
        });
        const creditId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
        ledger.push({
          id: creditId, accountId: merchantId, counterpartyAccountId: VAULT_BANK_OMNIBUS_ID,
          type: "MERCHANT_VAULT_CREDIT_VIA_ENDPOINT", direction: "CREDIT",
          amount: settledInMerchantCcy, currencyCode: merchantCurrency,
          originalCurrencyCode: txCurrencyCode, originalAmount: amount, fxApplied, fxRate,
          description: `/credit endpoint: merchant ${merchantId} vault account credited from omnibus (${type})`,
          reference, typeMeta: type, meta, createdAt: now,
          balanceAfter: accounts[merchantId][merchantCurrency]
        });
        const reduction = reducePendingMerchantDisbursement(merchantId, merchantCurrency, settledInMerchantCcy);
        const resp = {
          success: true, ok: true, status: "CREDITED", settled: true,
          reference, merchantId, type,
          creditLedgerId: creditId, debitLedgerId: debitId, ledgerId: creditId, id: creditId,
          amount: settledInMerchantCcy, currency: merchantCurrency,
          originalAmount: amount, originalCurrency: txCurrencyCode,
          fxApplied, fxRate,
          balanceAfterOmnibusTxCcy: accounts[VAULT_BANK_OMNIBUS_ID][txCurrencyCode],
          balanceAfterMerchant: accounts[merchantId][merchantCurrency],
          pendingReduction: reduction
        };
        cacheIdempotentResponse(sig.idempotency, 200, resp);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
      } catch (err) {
        console.error("VaultBank: /credit error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message, ok: false }));
      }
    });
  } else if (req.method === "POST" && req.url === "/api/vault/debit") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const rawBody = body;
        const p = body ? JSON.parse(body) : {};
        const sig = verifyRequestSignature(req, rawBody);
        if (sig.cached) {
          res.writeHead(sig.cached.status, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(sig.cached.body));
        }
        if (!sig.ok) {
          res.writeHead(sig.status || 401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: sig.error, ok: false }));
        }
        const merchantId = String(p.merchantId || "VAULT-MERCHANT-001").trim();
        const merchantCurrency = String(p.currency || p.currencyCode || getMerchantDefaultCurrency(merchantId, "USD")).toUpperCase();
        const reference = String(p.reference || `DR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`).trim();
        const amount = Number(p.amount);
        const type = String(p.type || "MANUAL_DEBIT");
        const meta = p.meta || {};
        const targetCcy = String(p.targetCurrency || merchantCurrency).toUpperCase();
        if (!Number.isFinite(amount) || amount <= 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "INVALID_AMOUNT", ok: false, amount }));
        }
        ensureAccount(merchantId, merchantCurrency);
        ensureOmnibus();
        if (typeof accounts[merchantId][merchantCurrency] !== "number") accounts[merchantId][merchantCurrency] = 0;
        if (accounts[merchantId][merchantCurrency] < amount) {
          res.writeHead(409, { "Content-Type": "application/json" });
          const bodyFail = { success: false, ok: false, error: "MERCHANT_VAULT_SHORTFALL", amount, currency: merchantCurrency, merchantAvailable: accounts[merchantId][merchantCurrency], reference, merchantId, type };
          cacheIdempotentResponse(sig.idempotency, 409, bodyFail);
          return res.end(JSON.stringify(bodyFail));
        }
        const amountInTarget = convert(amount, merchantCurrency, targetCcy);
        accounts[merchantId][merchantCurrency] -= amount;
        accounts[VAULT_BANK_OMNIBUS_ID][targetCcy] = (accounts[VAULT_BANK_OMNIBUS_ID][targetCcy] || 0) + amountInTarget;
        const now = new Date().toISOString();
        const fxApplied = merchantCurrency !== targetCcy;
        const fxRate = fxApplied ? fxRates[`${merchantCurrency}_${targetCcy}`] : 1;
        const debitId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
        ledger.push({
          id: debitId, accountId: merchantId, counterpartyAccountId: VAULT_BANK_OMNIBUS_ID,
          type: "MERCHANT_VAULT_DEBIT_VIA_ENDPOINT", direction: "DEBIT",
          amount, currencyCode: merchantCurrency,
          originalCurrencyCode: merchantCurrency, originalAmount: amount,
          targetCurrencyCode: targetCcy, targetAmount: amountInTarget, fxApplied, fxRate,
          description: `/debit endpoint: merchant ${merchantId} vault account debited (${type}), funds returned to omnibus pool`,
          reference, typeMeta: type, meta, createdAt: now,
          balanceAfter: accounts[merchantId][merchantCurrency]
        });
        const creditId = "LDG-" + (ledger.length + 1).toString().padStart(5, "0");
        ledger.push({
          id: creditId, accountId: VAULT_BANK_OMNIBUS_ID, counterpartyAccountId: merchantId,
          type: "OMNIBUS_CREDIT_FROM_DEBIT_ENDPOINT", direction: "CREDIT",
          amount: amountInTarget, currencyCode: targetCcy,
          description: `/debit endpoint: OMNIBUS credited with ${amountInTarget} ${targetCcy} returned from merchant ${merchantId} vault (${type})`,
          reference, typeMeta: type, meta, createdAt: now,
          balanceAfter: accounts[VAULT_BANK_OMNIBUS_ID][targetCcy]
        });
        const resp = {
          success: true, ok: true, status: "DEBITED", settled: true,
          reference, merchantId, type,
          debitLedgerId: debitId, creditLedgerId: creditId, ledgerId: debitId, id: debitId,
          amount, currency: merchantCurrency,
          targetCurrency: targetCcy, targetAmount: amountInTarget,
          fxApplied, fxRate,
          balanceAfterOmnibusTargetCcy: accounts[VAULT_BANK_OMNIBUS_ID][targetCcy],
          balanceAfterMerchant: accounts[merchantId][merchantCurrency],
          note: "Funds debited from merchant vault account returned to omnibus pool. This mirrors a 'pull back from vault to wallet' operation if the wallet layer also refunds the SQLite merchant_wallets balance."
        };
        cacheIdempotentResponse(sig.idempotency, 200, resp);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resp));
      } catch (err) {
        console.error("VaultBank: /debit error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message, ok: false }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

setInterval(() => {
  try {
    const b = runDailyClearingCycle();
    if (b) {
      console.log("VaultBank Settlement: 24h auto clearing cycle completed batch=" + b.batchId);
    } else {
      console.log("VaultBank Settlement: 24h auto clearing cycle — nothing to clear");
    }
  } catch (e) {
    console.error("VaultBank Settlement: auto clearing cycle error:", e.message);
  }
}, 24 * 60 * 60 * 1000);

server.listen(VAULT_PORT, () => {
  console.log(`Vault Bank Settlement HTTP listening on port ${VAULT_PORT}`);
  console.log(`Vault Bank Settlement: auto daily clearing scheduler armed (24h interval)`);
  // ── Load persistent card balances from SQLite into memory ──────────────────
  loadCardBalancesFromSqlite();
});
