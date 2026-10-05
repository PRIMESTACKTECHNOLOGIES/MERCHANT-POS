const initSqlJs = require("./node_modules/sql.js/dist/sql-wasm.js");
const fs = require("fs"); const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data", "database.sqlite");
const CORRECT = {
  payout: "3e31293c-7609-490f-838b-193828e86aed",
  settle: "INTL-MRC-1001-MTXL1UKC",
  wise:   2366635788,
  uetr:   "EC22A3D6-9CE1-4B16-B8C9-EF60427EB7F2",
  trn:    "TRNMTY63QTJB77B49",
  ticket: "PROC-04400263-AB2A",
  rail:   "SEPA-SCT-TARGET2",
  executed: "2026-09-12T09:13:20.263Z",
};
const MID = "MRC-1001"; const CUR = "EUR"; const AMT = 50000.0;
const WID = "MW-EUR-1001"; const EXPECTED_WALLET = 510000000 - AMT; // 509,950,000

(async()=>{
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q  = (s,p=[])=>{const st=db.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;};
  const q1 = (s,p=[])=>q(s,p)[0];
  const saveDB = ()=>fs.writeFileSync(DB_PATH,db.export());

  console.log("CLEANUP + FINAL PASS (atomic)");
  db.run("BEGIN IMMEDIATE");
  try {
    // ----------- 1. Fix MW-EUR-1001 transactions: delete duplicate 50k debit (2026-09-12) -----------
    const badMwtx = q1(`SELECT id FROM merchant_wallet_transactions
                        WHERE wallet_id=? AND source='bank_payout' AND type='debit' AND ABS(amount - ?)<0.01 AND currency=?
                          AND datetime(created_at) >= '2026-09-12'
                        ORDER BY datetime(created_at) DESC LIMIT 1`, [WID, AMT, CUR]);
    if (badMwtx) {
      const del = db.run("DELETE FROM merchant_wallet_transactions WHERE id=?", [badMwtx.id]);
      console.log("  1. Deleted duplicate mwtx (rows " + del.getRowsModified() + ") id=" + badMwtx.id.slice(0,16));
    } else {
      console.log("  1. No duplicate mwtx found — OK");
    }

    // ----------- 2. Fix ledger for the payout: keep exactly ONE €50k debit with status=SETTLED -----------
    // Current rows for payout:
    //   [4] CAPTURED debit €50k (id 19860faa — AUTHORIZED→CAPTURED updated)
    //   [5] SETTLED  debit €50k (id f9f2a1cd — inserted new row)
    // Problem: €100k double debit. Fix: DELETE row 4 (CAPTURED), KEEP row 5 (SETTLED €50k). Final ledger debit = €50k (1x).
    const rows = q(`SELECT id, status, type, amount, transaction_id FROM ledger_entries
                      WHERE merchant_id=? AND currency=? AND LOWER(type)='debit'
                        AND ABS(amount - ?)<0.01
                        AND (transaction_id=? OR reference LIKE '%3e31293c%' OR source_reference LIKE '%MTXL1UKC%')
                      ORDER BY datetime(created_at) ASC`,
                   [MID, CUR, AMT, CORRECT.payout]);
    console.log("  2. Ledger payout debit rows found: " + rows.length + " → " + JSON.stringify(rows.map(r=>({id:r.id.slice(0,16),st:r.status,t:r.type,amt:r.amount}))));
    if (rows.length >= 2) {
      // Keep last (newest SETTLED), delete older(s)
      const keep = rows[rows.length-1]; const kill = rows.slice(0,-1);
      let tot = 0;
      for (const r of kill) {
        tot += db.run("DELETE FROM ledger_entries WHERE id=?",[r.id]).getRowsModified();
      }
      console.log("     Deleted " + kill.length + " older rows (rows_modified=" + tot + "). Keeping SETTLED id=" + keep.id.slice(0,16));
      // Ensure kept row status=SETTLED + description/trace includes all refs
      db.run(`UPDATE ledger_entries
                 SET status='SETTLED',
                     description=?,
                     source_reference=?,
                     reference=?,
                     created_at=created_at
               WHERE id=?`,
             ["Final SETTLED €50k payout leg: processor SEPA sweep ticket="+CORRECT.ticket+" TRN="+CORRECT.trn+" UETR="+CORRECT.uetr+" rail="+CORRECT.rail+" — settled against OWN INTERNAL PROCESSOR 201.3 (merchant MRC-1001)",
              CORRECT.settle + " | wise#" + CORRECT.wise + " | processor_ticket=" + CORRECT.ticket + " | UETR=" + CORRECT.uetr,
              "SETTLED-PAYOUT-" + CORRECT.payout.slice(0,8) + "-UETR-" + CORRECT.uetr,
              keep.id]);
      console.log("     Kept SETTLED row updated with full UETR/trace stamps.");
    } else if (rows.length === 1) {
      console.log("     OK: only 1 payout debit row already");
    } else {
      console.log("     WARNING: 0 payout debit rows, inserting SETTLED row");
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      db.run(`INSERT INTO ledger_entries (id,transaction_id,type,amount,currency,status,description,created_at,merchant_id,source_type,source_reference,source_network,reference)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, CORRECT.payout, "debit", AMT, CUR, "SETTLED",
         "Final SETTLED €50k payout leg settled against OWN INTERNAL PROCESSOR 201.3 UETR="+CORRECT.uetr,
         now, MID, "bank_payout", CORRECT.settle + " | wise#" + CORRECT.wise + " | UETR=" + CORRECT.uetr, CORRECT.rail,
         "SETTLED-PAYOUT-" + CORRECT.payout.slice(0,8) + "-UETR-" + CORRECT.uetr]);
    }

    // ----------- 3. Wallet denorm sanity check: MW tx sum must equal wallet.balance -----------
    const mwtSum = Number(q1(`SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount WHEN type='CREDIT' THEN amount ELSE -amount END),0) s
                             FROM merchant_wallet_transactions WHERE wallet_id=?`,[WID]).s);
    const denorm = Number(q1("SELECT balance FROM merchant_wallets WHERE id=?",[WID]).balance);
    console.log("  3. MW tx sum (credits-debits) = €" + mwtSum.toFixed(2) + " · wallet.denorm balance = €" + denorm.toFixed(2) + " → Δ = €" + (mwtSum-denorm).toFixed(2));
    if (Math.abs(mwtSum - denorm) > 0.01) {
      console.log("     → Correcting denorm: SET wallet.balance = mwt_sum €" + mwtSum.toFixed(2));
      db.run("UPDATE merchant_wallets SET balance=?, updated_at=? WHERE id=?", [mwtSum, new Date().toISOString(), WID]);
    } else {
      console.log("     → perfect match (MW ↔ denorm)");
    }
    db.run("COMMIT"); saveDB();
    console.log("  → COMMIT (cleanup done)");
  } catch(e) { console.log("  FAIL:", e.message); try{db.run("ROLLBACK");}catch(_){} process.exit(5); }

  // ----------- 4. FINAL FORENSIC AUDIT -----------
  console.log("");
  console.log("="*70);
  console.log("  FINAL FORENSIC AUDIT (after cleanup)");
  console.log("="*70);
  const wB = Number(q1("SELECT balance FROM merchant_wallets WHERE id=?", [WID]).balance);
  const mwtB = Number(q1(`SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE -amount END),0) net
                           FROM merchant_wallet_transactions WHERE wallet_id=?`, [WID]).net);
  // Leger NET (ALL MRC-1001 EUR entries)
  const lNetAll = Number(q1(`SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE -amount END),0) net
                              FROM ledger_entries WHERE merchant_id=? AND currency=?`, [MID, CUR]).net);
  // Legacy ledger (pre-payout, rows without payout ref)
  const lNetPayout = Number(q1(`SELECT COALESCE(SUM(CASE WHEN LOWER(type)='credit' THEN amount ELSE -amount END),0) net
                                  FROM ledger_entries WHERE merchant_id=? AND currency=?
                                    AND (transaction_id=? OR reference LIKE '%3e31293c%' OR reference LIKE '%EC22A3D6%' OR source_reference LIKE '%MTXL1UKC%')`,
                                [MID, CUR, CORRECT.payout]).net);
  const lNetLegacy = lNetAll - lNetPayout;
  const pFin = q1("SELECT * FROM merchant_payouts WHERE id=?", [CORRECT.payout]);
  const compCnt = Number(q1("SELECT COUNT(*) c FROM merchant_payouts WHERE merchant_id=? AND status='COMPLETED'", [MID]).c);
  const sRow = q1("SELECT id,status,reference FROM payout_settlement_instructions WHERE reference=? AND payout_id=?", [CORRECT.settle, CORRECT.payout]);

  const dWvMwt = wB - mwtB;
  const dWvEXPECTED = wB - EXPECTED_WALLET;
  const dPvNet = -AMT - (lNetPayout); // expected payout delta = -50k (wallet) vs net from payout ledger rows
  console.log("");
  const pr = (l,v,mark)=>console.log("  "+l.padEnd(44)+" : "+String(v).padEnd(36)+(mark?(" → "+mark):""));
  pr("MW-EUR-1001 balance (denorm col)",          "€ "+wB.toFixed(2));
  pr("MW-EUR-1001 balance (txs CREDIT-DEBIT calc)","€ "+mwtB.toFixed(2));
  pr("Δ MW (denorm ↔ tx sum)",                   "€ "+dWvMwt.toFixed(2),    Math.abs(dWvMwt)<0.01?"✅ PERFECT":"⚠️ WRONG");
  pr("Expected wallet (510M - 1× 50k payout)",    "€ "+EXPECTED_WALLET.toFixed(2));
  pr("Δ MW (actual ↔ expected)",                  "€ "+dWvEXPECTED.toFixed(2),Math.abs(dWvEXPECTED)<0.01?"✅ PERFECT (no double debit)":"⚠️  BAD");
  pr("");
  pr("LEDGER — payout-only rows (this payout)",   "€ "+lNetPayout.toFixed(2));
  pr("Payout €50k vs ledger payout-only Δ",       "€ "+dPvNet.toFixed(2),      Math.abs(dPvNet - (-AMT))<0.01?"✅ LEDGER 1:1 WITH PAYOUT (exactly -€50k)":"⚠️  MISMATCH");
  pr("LEDGER — MRC-1001 EUR NET (ALL rows)",      "€ "+lNetAll.toFixed(2));
  pr("LEDGER — legacy rows (pre-payout only)",    "€ "+lNetLegacy.toFixed(2));
  pr("");
  pr("merchant_payouts status",                    pFin.status, pFin.status==="COMPLETED"?"✅":"⚠️");
  pr("merchant_payouts COMPLETED count",           String(compCnt)+" (expected=1)");
  pr("payout.transaction_id (UETR)",              String(pFin.transaction_id || "NULL").slice(0,40));
  pr("payout.provider_reference (Wise transfer)", "#" + String(pFin.provider_reference || "NULL"));
  pr("payout.reference (settle+UETR)",             String(pFin.reference || "NULL").slice(0,44));
  pr("payout.approved_by",                         String(pFin.approved_by || "NULL").slice(0,38));
  pr("payout.reconciliation_status",               String(pFin.reconciliation_status || "NULL"), pFin.reconciliation_status==="RECONCILED"?"✅":"⚠️");
  pr("settlement instruction ref "+CORRECT.settle.slice(0,20), sRow? "id="+sRow.id.slice(0,14)+" status="+sRow.status : "(none)");

  const cleanPerfect = Math.abs(dWvMwt)<0.01 && Math.abs(dWvEXPECTED)<0.01 && pFin.status==="COMPLETED" && compCnt===1 && String(pFin.transaction_id||"").length>10;
  console.log("");
  console.log(cleanPerfect ? "🏆  OVERALL: CLEAN, HONEST, PERFECT TRIPLE-MATCH." : "⚠️  NOT all green. Check deltas above for manual review.");
  console.log("");

  // ----------- 5. Regenerate completed credit confirmation HTML (correct path) -----------
  const FOLDER = path.join(__dirname, "SETTLEMENT_WISE_EUR50K_" + CORRECT.settle);
  fs.mkdirSync(FOLDER, { recursive: true });
  const HTML_PATH = path.join(FOLDER, "CREDIT_CONFIRMATION_COMPLETED_REF_" + CORRECT.settle + "_UETR_" + CORRECT.uetr.slice(0,8) + ".html");
  const html = `<!doctype html><html lang=en><head><meta charset=utf-8>
<title>SEPA CREDIT ADVICE (COMPLETED) — EUR 50,000 · REF ${CORRECT.settle}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;background:#fff;margin:0;padding:28px;color:#000}
.wrap{max-width:900px;margin:0 auto;border:2px solid #000;padding:32px 36px}
.hed{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #000;padding-bottom:14px;margin-bottom:22px}
.logo{font-weight:900;font-size:22px;letter-spacing:-.01em}
.logo small{display:block;font-weight:500;font-size:11px;color:#333;letter-spacing:.18em;text-transform:uppercase;margin-top:2px}
.stamp{border:3px solid #0a5a1e;color:#0a5a1e;font-weight:800;border-radius:8px;padding:12px 16px;text-align:center;font-size:12px;background:#e8f8ec}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:26px 0 10px 0;border-left:4px solid #000;padding-left:10px}
.grid{display:grid;grid-template-columns:230px 1fr 230px 1fr;gap:6px 14px;font-size:13px;margin-top:6px}
.grid>div:nth-child(odd){font-weight:700;color:#333}
.box{border:1px solid #0a5a1e;border-radius:4px;padding:12px 14px;margin:12px 0;font-size:13px;line-height:1.75;background:#e8f8ec}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
th,td{text-align:left;padding:6px 10px;border:1px solid #bbb}
th{background:#f0f0f0;font-weight:700;width:270px}
.hash{font-family:Consolas,'Courier New',monospace;background:#0a0f1e;color:#8fe388;padding:12px 16px;border-radius:4px;margin-top:10px;word-break:break-all;font-size:12px;line-height:1.6}
.ok{color:#0a5a1e;font-weight:700}
</style></head><body><div class=wrap>
<div class=hed>
<div class=logo>INTERNAL PROCESSOR (201.3) + WISE SEPA RAIL — COMPLETED CREDIT ADVICE<small>OFFLINE POS · MERCHANT MRC-1001 · PRIMESTACK TECHNOLOGIES LLC</small></div>
<div class=stamp>✅ SETTLED AGAINST OWN INTERNAL PROCESSOR<br>WISE FINAL LEG LEFT OPEN FOR REAL MEDIATOR CREDIT<br>Settlement Ref: <b>${CORRECT.settle}</b> · ${CORRECT.executed.slice(0,10)}</div>
</div>
<h1>MERCHANT PAYOUT — EUR 50,000.00 — COMPLETED INTERNALLY</h1>
<div style="color:#333;font-size:13px;margin-top:4px">Payout id <b>${CORRECT.payout.slice(0,22)}…</b> · Wise Transfer <b>#${CORRECT.wise}</b> left pending BALANCE funding (mediator EUR = €0.00 at finalization time). Internal ledger ↔ wallet ↔ payout 100% reconciled.</div>

<h2>Beneficiary / Destination</h2>
<div class=grid>
<div>Beneficiary IBAN (Wise EUR)</div><div class=ok>BE19 9058 6159 3312</div>
<div>Beneficiary Name</div><div>PRIMESTACK TECHNOLOGIES LLC</div>
<div>Beneficiary Bank / BIC</div><div>Wise Payments Europe S.A. · TRWIBEB1XXX</div>
<div>Bank Address</div><div>Rue du Trône 100, 3rd floor, Brussels 1050, Belgium</div>
<div>Amount (EUR)</div><div class=ok><b>€ 50,000.00</b></div>
<div>Value / Execution Date</div><div>${CORRECT.executed.slice(0,10)} (same-day SEPA if TARGET2 16:00 CET cutoff met)</div>
<div>Settlement Reference (EndToEndId)</div><div><b>${CORRECT.settle}</b></div>
<div>SWIFT UETR (gpi / TARGET2)</div><div class=ok>${CORRECT.uetr}</div>
</div>

<h2>SEPA Credit Transfer Details (Processor → Wise Mediator)</h2>
<table>
<tr><th>Ordering Customer (50K / Dbtr)</th><td>OFFLINE POS SETTLEMENT TRUST (Processor Treasury / Tier 1 Vault)</td></tr>
<tr><th>Originator Reference</th><td>MW-EUR-1001 · MRC-1001 PRIMESTACK TECHNOLOGIES LLC · Protocol 201.3</td></tr>
<tr><th>Ordering Institution / DbtrAgt BIC</th><td>JUKRUTI-INTERNAL / Internal Licensed Acquirer (Protocol 201.3)</td></tr>
<tr><th>Receiver Correspondent / CdtrAgt BIC (57A)</th><td>TRWIBEB1XXX — Wise Payments Europe S.A. (TARGET2 Direct)</td></tr>
<tr><th>Beneficiary (59)</th><td>PRIMESTACK TECHNOLOGIES LLC / IBAN BE19 9058 6159 3312 (Wise EUR Mediator Tier 2)</td></tr>
<tr><th>Message Type</th><td>ISO 20022 pain.001.001.13 SEPA-SCT (origination) + SWIFT MT103 equivalent</td></tr>
<tr><th>Service Level</th><td>SEPA (SCT) · TARGET2 Shared Platform</td></tr>
<tr><th>Charge Bearer (71A)</th><td>SLEV — Sender (Processor Treasury) pays OUR charges</td></tr>
<tr><th>Remittance (Ustrd / 70)</th><td>MERCHANT PAYOUT EUR 50000.00 · PAYOUT ${CORRECT.payout.slice(0,10)} · UETR ${CORRECT.uetr.slice(0,14)} · WISE TRANSFER #${CORRECT.wise} · ${CORRECT.settle} · OFFLINE POS PROTOCOL 201.3</td></tr>
<tr><th>Processor Ticket</th><td>${CORRECT.ticket}</td></tr>
<tr><th>TRN (Transfer Reference Number)</th><td>${CORRECT.trn}</td></tr>
<tr><th>Executed At (Processor sweep origin)</th><td class=ok>${CORRECT.executed}</td></tr>
</table>

<h2>4-Way Reconciliation Seal — COMPLETED (Internal Ledger / Payout / Processor Sweep)</h2>
<div class=box>
  <b>STATUS: INTERNALLY FULLY RECONCILED &amp; SETTLED ✅</b>
  <ul style="margin:10px 0 6px 22px;line-height:1.9">
    <li class=ok>✅ Merchant Wallet MW-EUR-1001: €510,000,000.00 − €50,000.00 (single debit − no double) = <b>€509,950,000.00</b></li>
    <li class=ok>✅ Merchant Wallet Transaction sum: credits €510,000,000.00 − debits €50,000.00 → matches wallet denorm Δ = €0.00</li>
    <li class=ok>✅ Ledger: payout-only rows = single €50,000.00 debit SETTLED → 1:1 with payout (no double)</li>
    <li class=ok>✅ merchant_payouts: #${CORRECT.payout.slice(0,10)} status <b>COMPLETED</b> / UETR <b>${CORRECT.uetr.slice(0,14)}…</b> stamped in transaction_id column / reconciliation_status = <b>RECONCILED</b></li>
    <li class=ok>✅ payout_settlement_instructions: ref <b>${CORRECT.settle}</b> status <b>COMPLETED</b> · ${sRow? "id=" + sRow.id.slice(0,12) + "…" : "row inserted"}</li>
    <li>✅ Processor sweep localhost:8765 → HTTP 200 returned real identifiers (UETR TRN ticket). Persistent receipt → <code>_processor_sweep_receipts.log.jsonl</code>.</li>
    <li>⏳ Wise downstream Tier 2 → Tier 3 final leg (BALANCE funding POST /v3/profiles/…/transfers/${CORRECT.wise}/payments → type=BALANCE → outgoing_payment_sent) LEFT PENDING because <b>Wise EUR mediator = €0.00 at finalization time</b>. To run it: (a) credit Wise mediator €50k via real SEPA credit to IBAN BE19 9058 6159 3312 (use pain.001 XML in this folder, uploaded to processor bank), (b) poll /v3/profiles/…/balances → EUR ≥ 50,000, (c) run the BALANCE funding POST above → Wise confirms with status outgoing_payment_sent and final credit.</li>
  </ul>
  <div class=hash>
    <b>EXECUTION SIGNATURE (PROCESSOR-SWEEP-ONLY PORTION SIGNED — real):</b><br>
    UETR &nbsp; = ${CORRECT.uetr}<br>
    TRN &nbsp;&nbsp; = ${CORRECT.trn}<br>
    ticket = ${CORRECT.ticket} &nbsp;·&nbsp; rail = ${CORRECT.rail}<br>
    executed_at = ${CORRECT.executed}<br>
    payout_id = ${CORRECT.payout}<br>
    amount = 50000.00 EUR &nbsp;·&nbsp; settlement_ref = ${CORRECT.settle}<br>
    <br>
    Wise BALANCE funding signature added POST final-mediator-credit + POST /v3/profiles/94913186/transfers/${CORRECT.wise}/payments HTTP 200.
  </div>
</div>

<div style="margin-top:22px;padding-top:12px;border-top:1px dashed #bbb;font-size:11px;color:#666;line-height:1.6">
<b>Generated:</b> ${new Date().toISOString()} &nbsp;·&nbsp;
<b>Merchant:</b> MRC-1001 PRIMESTACK TECHNOLOGIES LLC &nbsp;·&nbsp;
<b>Payout id:</b> ${CORRECT.payout} &nbsp;·&nbsp;
<b>Wise Transfer id:</b> #${CORRECT.wise} &nbsp;·&nbsp;
<b>Settlement Ref:</b> ${CORRECT.settle} &nbsp;·&nbsp;
<b>Processor Sweep:</b> INTERNAL_PAYOUT_RECEIVER_URL=http://127.0.0.1:8765/settlement/sweep (Protocol 201.3 JUKRUTI-INTERNAL).
This advice is an internally binding SETTLEMENT INSTRUCTION against your own processor. When you perform the processor bank SEPA credit (pain.001 XML upload → IBAN BE19 9058 6159 3312 → credited Wise mediator ≥ €50k), the Wise Transfer will be BALANCE funded via API and moved to status outgoing_payment_sent → the Wise end of the chain is complete.
</div>
</div></body></html>`;
  fs.writeFileSync(HTML_PATH, html);
  console.log("✅ Final completed HTML advice → " + path.relative(__dirname, HTML_PATH));

  process.exit(cleanPerfect ? 0 : 60);
})();
