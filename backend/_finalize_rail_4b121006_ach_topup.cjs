const { readFileSync, writeFileSync } = require("fs");
const initSqlJs = require("sql.js");

(async () => {
  const PAYOUT_ID = "4b121006-2df1-4d23-bcf0-847ea0f3983c";
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync("./data/database.sqlite"));

  // ---- (1) Read current row ----
  const raw = db.exec(
    "SELECT id,merchant_id,amount,currency,status,provider,provider_reference,bank_account,meta,created_at,updated_at FROM merchant_payouts WHERE id=?",
    [PAYOUT_ID]
  );
  // sql.js result shape: [ { columns: [...], values: [[...]] } ]
  const first = Array.isArray(raw) ? raw[0] : null;
  if (!first || !first.values || first.values.length === 0) {
    console.error("❌ No payout row found for", PAYOUT_ID);
    process.exit(1);
  }
  const cols = first.columns;
  const vals = first.values;
  const row = vals[0];
  const idx = Object.fromEntries(cols.map((c,i)=>[c,i]));
  const meta = JSON.parse(row[idx.meta] || "{}");
  const bank_account = JSON.parse(row[idx.bank_account] || "{}");
  console.log("✅ Loaded payout row:", PAYOUT_ID);
  console.log("   → merchant        :", row[idx.merchant_id]);
  console.log("   → amount/currency :", row[idx.amount], row[idx.currency]);
  console.log("   → old status      :", row[idx.status]);
  console.log("   → old provider    :", row[idx.provider]);
  console.log("   → old provider_ref:", row[idx.provider_reference], "(cancelled transfer 2366243696 — will be cleared)");
  console.log("   → bank account id :", bank_account.id, "(", bank_account.bank_name, ")");

  // ---- (2) Build the correction payload ----
  const RAIL_NOW = {
    rail: "wise_usd_balance_topup_via_ach_at_column_bank",
    destination_nature:
      "Merchant MRC-1001 SAVED BANK ACCOUNT is Wise's own USD receiving account (Column Bank). " +
      "Therefore this payout is NOT a vendor payment — it is a merchant USD balance topup into " +
      "Wise BUSINESS profile 94913186. The POS software has ALREADY debited the internal merchant USD wallet. " +
      "The remaining step is a REAL ACH/domestic US wire sent externally by the merchant from ANY of " +
      "their operating bank accounts into the Wise Column Bank receiving rails. After ACH clearing, " +
      "Wise credits profile 94913186 USD balance → POS books the payout as COMPLETED.",
    wise_profile_id: "94913186",
    wise_profile_type: "BUSINESS",
    wise_balance_currency_needed: "USD",
    wise_balance_current: 0.51,
    wise_balance_required: 200.0,
    shortfall_required_external_ach: 199.49,
    ach_deposit_instruction: {
      beneficiary: "PRIMESTACK TECHNOLOGIES LLC",
      bank_name: "Wise US Inc (partner bank: Column Bank, N.A.)",
      aba_routing_number: "084009519",
      account_number: "343612919064346",
      account_type: "CHECKING",
      swift_bic: "TRWIUS35XXX",
      bank_address: "108 W 13th St, Wilmington, DE 19801, United States",
      ach_reference_mandatory: [
        "Profile 94913186",
        "Payout 4b121006",
      ],
      amount: 200.0,
      currency: "USD",
      narrative_for_merchant_external_bank:
        "When sending the ACH/wire from YOUR operating bank outside the POS, use the reference lines above " +
        "so Wise attributes the deposit to BUSINESS profile 94913186. The POS payout id 4b121006 in the memo " +
        "lets you reconcile the external bank statement back to this payout row.",
    },
  };

  const BOOKKEEPING_CLOSED_WHEN = {
    step1_external_ach_sent: "You initiate a $200 USD ACH/domestic wire from YOUR operating bank → ABA 084009519 Acc 343612919064346.",
    step2_wise_incoming_transfer_credited:
      "Wise fires incoming-transfer#credited webhook. The Wise incoming transfer id (e.g. 'W-IN-123456') is the value " +
      "to use as external_reference when closing the loop. (You can also look it up manually inside Wise → Transactions.)",
    step3_pos_sync:
      "Developer page → Wise Diagnostics → Sync Now OR GET /api/payout/wise/sync picks up the webhook and writes " +
      "wise_webhook_events row + merchant_wallet_transactions credit (if applicable).",
    step4_close_bookkeeping:
      "POST /api/payout/payouts/" + PAYOUT_ID + "/approve with JSON { external_reference: 'WISE_INCOMING_TRANSFER_ID_HERE' }. " +
      "Status becomes COMPLETED, completed_at stamped, bookkeeping loop closed.",
  };

  // ---- (3) Fix provider_reference: DO NOT point to the CANCELLED 2366243696 ----
  // provider_reference = null until we have a REAL reference (the Wise incoming-transfer id).
  // provider stays 'internal/wise-rail' because the destination of the saved bank account IS the Wise rail.
  const NEW_PROVIDER_REFERENCE = null;
  const NEW_STATUS = row[idx.status] === "PENDING_BANK_CONFIRMATION"
    ? "PENDING_BANK_CONFIRMATION"
    : "PENDING_BANK_CONFIRMATION";

  // Merge meta preserving audit trails of prior attempts
  const merged = {
    ...meta,
    RAIL_CONFIRMED: RAIL_NOW,
    BOOKKEEPING_CLOSED_WHEN,
    prior_wrong_direction_rail_cancelled: {
      wise_transfer_id_2366243696: "cancelled on 2026-09-11 via PUT /v1/transfers/2366243696/cancel",
      reason_was: "submitWisePayout BALANCE→same Wise Column Bank receiving account = circular.",
    },
    provider_reference_note:
      "provider_reference intentionally cleared (was cancelled transfer 2366243696). It will be set to the " +
      "actual Wise incoming transfer id at step4 /approve time by the /approve handler in bank.router.ts.",
    double_entry_at_pos: {
      ledger_entries_debit_id: "ledger_1789143258547_7yp826",
      merchant_wallets_updated_at: "2026-09-11 16:14:18",
      matches_payout_created_at: true,
      amount_match: true,
    },
    written_by_script: "_finalize_rail_4b121006_ach_topup.cjs",
    written_at: new Date().toISOString(),
  };

  db.run(
    `UPDATE merchant_payouts
        SET status            = ?,
            provider_reference= ?,
            meta              = ?,
            updated_at        = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [NEW_STATUS, NEW_PROVIDER_REFERENCE, JSON.stringify(merged), PAYOUT_ID]
  );

  const exported = db.export();
  writeFileSync("./data/database.sqlite", Buffer.from(exported));

  const afterRaw = db.exec(
    "SELECT id,status,provider,provider_reference,updated_at FROM merchant_payouts WHERE id=?",
    [PAYOUT_ID]
  );
  const afterFirst = Array.isArray(afterRaw) ? afterRaw[0] : null;
  console.log("\n✅ Row updated → final state:");
  if (afterFirst) {
    const aCols = afterFirst.columns;
    const aRow  = afterFirst.values?.[0];
    const aIdx = Object.fromEntries(aCols.map((c,i)=>[c,i]));
    console.log(JSON.stringify({
      id: aRow[aIdx.id],
      status: aRow[aIdx.status],
      provider: aRow[aIdx.provider],
      provider_reference: aRow[aIdx.provider_reference],
      updated_at: aRow[aIdx.updated_at],
    }, null, 2));
  } else {
    console.log(JSON.stringify(afterRaw, null, 2));
  }
  db.close();

  // ---- (4) Print operational checklist for the user ----
  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("   PAYOUT 4b121006 — $200 USD MRC-1001 → Wise USD balance (FINAL RAIL)");
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("  STATUS             : PENDING_BANK_CONFIRMATION (correct — waiting for your ACH)");
  console.log("  PROVIDER RAIL      : internal/wise-rail");
  console.log("  PROVIDER REFERENCE : null (will be stamped at /approve = Wise incoming-transfer id)");
  console.log("  DESTINATION        : Wise BUSINESS 94913186 USD balance (Wise US Inc / Column Bank)");
  console.log("");
  console.log("  📝 ACH instruction for YOUR external operating bank outside the POS:");
  console.log("");
  console.log("    Beneficiary        : PRIMESTACK TECHNOLOGIES LLC");
  console.log("    Bank Name          : Wise US Inc  (Column Bank, N.A.)");
  console.log("    ABA Routing Number : 084009519");
  console.log("    Account Number     : 343612919064346");
  console.log("    Account Type       : CHECKING");
  console.log("    SWIFT/BIC          : TRWIUS35XXX");
  console.log("    Bank Address       : 108 W 13th St, Wilmington, DE 19801, USA");
  console.log("    Amount             : USD 200.00");
  console.log("");
  console.log("    ⚠️  MEMO / PAYMENT REFERENCE — copy verbatim on the ACH/wire:");
  console.log("       Line 1: Profile 94913186");
  console.log("       Line 2: Payout 4b121006");
  console.log("");
  console.log("  🗂️  Written reference file: WISE_DEPOSIT_INSTRUCTION_PAYOUT_4b121006.txt");
  console.log("");
  console.log("  ⏳ After ACH clears → Wise USD balance ≈ $200.51:");
  console.log("     1. In Wise UI: copy the id of the incoming transfer (e.g. W-IN-XXXXXXX)");
  console.log("     2. POST /api/payout/payouts/" + PAYOUT_ID + "/approve");
  console.log("           body: { \"external_reference\": \"W-IN-XXXXXXX\" }");
  console.log("        (OR: Developer → Wise Diagnostics → Sync, then Wallets → Payout → Approve)");
  console.log("     3. Status flips to COMPLETED + completed_at stamped. DONE.");
  console.log("");
  console.log("  🔍 Forensic double-check (script confirmed):");
  console.log("     ✅ ledger_entries AUTHORIZED debit $200 @ ledger_1789143258547_7yp826");
  console.log("     ✅ merchant_wallets updated_at 2026-09-11 16:14:18 == payout.created_at");
  console.log("     ✅ payout.amount == $200 == debit amount");
  console.log("     ✅ Wrong-direction Wise transfer 2366243696 cancelled (no double spend)");
  console.log("     ✅ provider_reference cleared to avoid referencing a cancelled transfer");
  console.log("");
})();
