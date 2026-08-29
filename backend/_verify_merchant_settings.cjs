const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve("sql.js/dist/" + f) });
  const dbPath = path.join(__dirname, "data", "database.sqlite");
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const MID = "MRC-1001";

  const getColNames = (table) => {
    const p = db.exec("PRAGMA table_info(" + table + ")");
    if (!p || !p[0]) return [];
    return p[0].values.map((r) => r[1]);
  };

  const safeSelect = (table, wantCols, whereSql, whereParams) => {
    const cols = getColNames(table);
    const allowed = wantCols.filter((c) => cols.includes(c));
    const sql = "SELECT " + allowed.join(", ") + " FROM " + table + " " + (whereSql || "");
    const r = db.exec(sql, whereParams || []);
    return r && r[0] ? r[0] : null;
  };

  const printRows = (label, res) => {
    console.log("\n=== " + label + " ===");
    if (!res || !res.values.length) {
      console.log("(no rows)");
      return;
    }
    for (const r of res.values) {
      const o = {};
      for (let i = 0; i < res.columns.length; i++) {
        const col = res.columns[i]; const val = r[i];
        if ((col === "metadata_json" || col === "extended_settings") && typeof val === "string") {
          try { o[col] = JSON.parse(val); }
          catch (e) { o[col] = val ? (val.slice(0, 400) + (val.length > 400 ? "..." : "")) : val; }
        } else {
          o[col] = val;
        }
      }
      console.log(JSON.stringify(o, null, 2));
    }
  };

  printRows(
    "merchant_business_info MRC-1001",
    safeSelect(
      "merchant_business_info",
      ["merchant_id", "business_name", "business_address", "business_phone", "business_email", "business_country", "language", "updated_at"],
      "WHERE merchant_id = ?",
      [MID]
    )
  );
  printRows(
    "merchant_settings MRC-1001",
    safeSelect(
      "merchant_settings",
      ["merchant_id", "merchant_name", "support_email", "support_phone", "display_name", "display_currency", "updated_at", "extended_settings"],
      "WHERE merchant_id = ?",
      [MID]
    )
  );
  printRows(
    "bank_accounts MRC-1001 (default + 2nd)",
    safeSelect(
      "bank_accounts",
      [
        "id", "customer_id", "merchant_id", "bank_name", "account_holder",
        "account_number", "routing_number", "account_type", "iban",
        "swift_code", "bank_address", "currency", "country", "is_default",
        "verified", "account_reference", "verification_status",
        "updated_at", "last_verified_at", "created_at", "metadata_json"
      ],
      "WHERE merchant_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 2",
      [MID]
    )
  );
  printRows(
    "merchant_wallets MRC-1001",
    safeSelect(
      "merchant_wallets",
      ["merchant_id", "currency", "wallet_code", "balance"],
      "WHERE merchant_id = ? ORDER BY balance DESC",
      [MID]
    )
  );
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
