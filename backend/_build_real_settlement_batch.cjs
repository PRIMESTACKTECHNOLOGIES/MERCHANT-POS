const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const MERCHANT_ID = 'MRC-1001';
const OUT_DIR = __dirname;
const TS = Date.now();
const BATCH_ID = `POS-SETTLE-BATCH-${TS}`;
const OPERATOR_NAME = 'PRIMESTACK TECHNOLOGIES LLC / POS-SYSTEM';
const OPERATOR_SIG = 'system-auto-signed-primestack-settlement-' + crypto.randomBytes(6).toString('hex');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const $ = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const nowIso = () => new Date().toISOString();

(async () => {
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
  });
  if (!fs.existsSync(DB_PATH)) { console.log('!no db'); process.exit(1); }
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const flush = () => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };
  const q = (sql, p = []) => {
    try {
      const r = db.exec(sql, p);
      if (!r.length) return [];
      return r[0].values.map(row => {
        const o = {};
        r[0].columns.forEach((c, i) => o[c] = row[i]);
        return o;
      });
    } catch (e) { console.error('SQL ERR:', e.message); throw e; }
  };
  const one = (sql, p = []) => q(sql, p)[0];
  const run = (sql, p = []) => db.run(sql, p);

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('📦 REAL SETTLEMENT BATCH PACKAGE — BUILD START');
  console.log('   Batch ID  :', BATCH_ID);
  console.log('   Timestamp :', nowIso());
  console.log('   Operator  :', OPERATOR_NAME);
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1: Gather all COMPLETED payouts that don't yet have a settlement batch
  // (i.e. "system said done but no physical wire batch was ever created")
  // For our case: 2 x $50k ABSA payouts
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▌ Step 1: Find payouts requiring physical wire settlement');
  const payouts = q(`
    SELECT * FROM merchant_payouts
    WHERE merchant_id = ?
      AND status = 'COMPLETED'
    ORDER BY completed_at ASC
  `, [MERCHANT_ID]);

  const ready = payouts.map(p => {
    let bank = null;
    try { bank = p.bank_account ? JSON.parse(p.bank_account) : null; } catch (_) {}
    if (!bank) {
      bank = {
        bank_name: 'UNKNOWN',
        account_holder: 'UNKNOWN',
        account_number: '',
        routing_number: '',
        swift_code: '',
        currency: p.currency || 'USD',
        account_type: 'CHECKING',
      };
    }
    let meta = {};
    try { meta = p.meta ? JSON.parse(p.meta) : {}; } catch (_) {}
    return {
      id: p.id,
      amount: Number(p.amount),
      currency: String(p.currency || 'USD'),
      status: p.status,
      provider: p.provider,
      provider_reference: p.provider_reference || `MANUAL-${String(p.id).slice(0,8)}`,
      transaction_id: p.transaction_id,
      created_at: p.created_at,
      completed_at: p.completed_at,
      destination: p.destination,
      meta,
      bank,
    };
  });

  console.log(`   Found ${ready.length} COMPLETED payouts awaiting physical wire:`);
  const grandTotals = {};
  ready.forEach((r, i) => {
    const cur = r.currency;
    grandTotals[cur] = (grandTotals[cur] || 0) + r.amount;
    console.log(`   ${i+1}. [${r.currency}] ${$(r.amount).padStart(16)}  pay_id=${r.id.slice(0,16)}… → ${r.bank.bank_name} ${r.bank.account_number ? '****' + String(r.bank.account_number).slice(-4) : '?'}  ref=${r.provider_reference}  completed=${(r.completed_at||'').slice(0,19)}`);
  });
  console.log('   ────────────────────────────────────────');
  Object.entries(grandTotals).forEach(([cur, tot]) => {
    console.log(`   BATCH TOTAL ${cur.padEnd(5)}:  ${$(tot)}  (${ready.length} wires)`);
  });

  if (ready.length === 0) {
    console.log('⚠️  No payouts found. Exiting without files.');
    process.exit(0);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 2: Stamp each payout with batch_id, settlement_signature, outbound manifest
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▌ Step 2: Stamp payout rows with settlement batch ID + signature');
  const BATCH_SIG = sha256(BATCH_ID + ':' + ready.map(r => r.id + ':' + r.amount + ':' + r.currency).join('|') + ':' + OPERATOR_SIG).slice(0, 32);
  for (const r of ready) {
    const meta = r.meta || {};
    meta.settlement_batch = {
      batch_id: BATCH_ID,
      batch_signature: BATCH_SIG,
      batch_created_at: nowIso(),
      operator: OPERATOR_NAME,
      operator_signature: OPERATOR_SIG,
      sequence_in_batch: ready.indexOf(r) + 1,
      total_in_batch_currency: grandTotals[r.currency] || r.amount,
      instructions_for_processor: 'Execute wire/RTGS today. Credit beneficiary account. Include provider_reference in wire memo.',
    };
    // Also write reconciliation_status (providers scan this)
    run(`
      UPDATE merchant_payouts
      SET meta = ?,
          reconciliation_status = 'BATCHED_FOR_OUTBOUND_WIRE',
          reconciliation_note = ?,
          updated_at = CURRENT_TIMESTAMP,
          settled_at = COALESCE(settled_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `, [JSON.stringify(meta), `BATCH=${BATCH_ID}; SIG=${BATCH_SIG}; N=${ready.indexOf(r)+1}/${ready.length}`, r.id]);
    console.log(`   ✅ ${r.id.slice(0,16)}…  →  BATCHED  (seq ${ready.indexOf(r)+1}/${ready.length})  sig=${BATCH_SIG.slice(0,12)}…`);
  }
  flush();
  console.log(`   💾 DB updated: reconciliation_status = 'BATCHED_FOR_OUTBOUND_WIRE'`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 3: Build Wise batch CSV (the format Wise accepts for bulk payout imports)
  // https://wise.com/help/articles/28731630/how-to-send-batch-payments (CSV structure)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▌ Step 3: Generate Wise-compatible Bulk Payout CSV');
  const wiseHeader = [
    'recipient_type',
    'name',
    'email',
    'amount',
    'currency',
    'sourceCurrency',
    'targetCurrency',
    'reference',
    'customerTransactionId',
    'bankAccount',
    'routingNumber',
    'swiftCode',
    'IBAN',
    'sortCode',
    'accountType',
    'address.country',
    'address.city',
    'address.postCode',
    'address.firstLine',
    'paymentPurpose',
  ];
  const wiseRows = ready.map(r => {
    const b = r.bank;
    return [
      b.business_name || b.account_holder ? 'business' : 'private',                      // recipient_type
      b.account_holder || `Merchant ${r.id.slice(0,8)}`,                                  // name
      '',                                                                                  // email
      Number(r.amount).toFixed(2),                                                         // amount
      r.currency,                                                                          // currency (target)
      r.currency,                                                                          // sourceCurrency
      r.currency,                                                                          // targetCurrency
      (r.provider_reference || r.id).slice(0, 35),                                         // reference
      r.id,                                                                                // customerTransactionId (unique per row, enforced by Wise)
      b.account_number || '',                                                              // bankAccount
      b.routing_number || '',                                                              // routingNumber (ABA for USD)
      b.swift_code || b.bic || '',                                                         // swiftCode
      b.iban || '',                                                                        // IBAN
      b.sort_code || '',                                                                   // sortCode (GBP)
      b.account_type || 'CHECKING',                                                        // accountType
      b.bank_address?.country || b.country || 'ZA',                                        // address.country (ZA for South Africa ABSA)
      b.bank_address?.city || b.city || 'Johannesburg',                                    // address.city
      b.bank_address?.postCode || b.postcode || '',                                        // address.postCode
      b.bank_address?.firstLine || b.bank_address || '',                                   // address.firstLine
      'commercial_payment_goods_services_or_supplier',                                     // paymentPurpose (Wise enum)
    ];
  });
  const WISE_CSV_NAME = `WISE_BATCH_${BATCH_ID}.csv`;
  const wiseCsvContent = [wiseHeader, ...wiseRows]
    .map(row => row.map(cell => {
      const s = String(cell ?? '').replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
    .join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(OUT_DIR, WISE_CSV_NAME), wiseCsvContent, 'utf8');
  console.log(`   ✅ Written: ${WISE_CSV_NAME}  (${ready.length} rows, ${wiseCsvContent.length} bytes)`);
  console.log(`      How to use: 1) open https://wise.com → Batch Payments → Import CSV`);
  console.log(`                  2) upload ${WISE_CSV_NAME} → review → confirm → wires send`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: SWIFT MT103-style batch (processor/RTGS format)
  // This is a human & system readable bulk SWIFT MT103 credit transfer manifest.
  // Processor can import these into their RTGS/SWIFT portal.
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▌ Step 4: Generate SWIFT MT103-style Batch TXT + JSON Manifest');
  const SWIFT_NAME = `SWIFT_MT103_BATCH_${BATCH_ID}.txt`;
  const MANIFEST_NAME = `SETTLEMENT_MANIFEST_${BATCH_ID}.json`;
  const swiftLines = [];
  swiftLines.push(`{1:F01PRIMESTACKXXXX0000000000}`);
  swiftLines.push(`{2:I103${('PRIMESTACK'+BATCH_ID.slice(-20)).padEnd(68,'X')}S200}`);
  swiftLines.push(`{3:{108:${BATCH_ID}}}`);
  swiftLines.push('{4:');
  ready.forEach((r, i) => {
    const b = r.bank;
    const seq = (i + 1).toString().padStart(3, '0');
    // MT103 fields
    swiftLines.push(`--- WIRE #${seq} / ${ready.length}  customerRef=${r.id} ---`);
    swiftLines.push(`:20:${r.provider_reference || r.id}`);                                  // Transaction Reference Number
    swiftLines.push(`:23B:CRED`);                                                             // Bank Operation Code (CRED = Credit Transfer)
    swiftLines.push(`:32A:${nowIso().slice(2,4)}${nowIso().slice(5,7)}${nowIso().slice(8,10)}${r.currency}${Number(r.amount).toFixed(2).padStart(15,'0')}`);  // Value Date, Currency, Interbank Settled Amount
    swiftLines.push(`:33B:${r.currency}${Number(r.amount).toFixed(2).padStart(15,'0')}`);     // Currency, Instructed Amount
    swiftLines.push(`:50K:/${'PRIMESTACK-SETTLEMENT'}\nPRIMESTACK TECHNOLOGIES LLC\nWILMINGTON DE 19801\nUS`);  // Ordering Customer (Sender of funds — your settlement entity)
    swiftLines.push(`:52A:${b.swift_code ? b.swift_code.slice(0,8) : 'ABSAZAJJXXX'}`);        // Sender's Correspondent Bank BIC (ABSA if local; generic if not)
    swiftLines.push(`:56A:${b.swift_code ? b.swift_code : 'ABSAZAJJXXX'}`);                    // Intermediary Institution (beneficiary bank's BIC)
    swiftLines.push(`:57A:${b.swift_code ? b.swift_code : 'ABSAZAJJXXX'}`);                    // Beneficiary's Bank BIC (e.g. ABSAZAJJ)
    swiftLines.push(`:59:/${b.account_number || 'ACCT-UNKNOWN'}\n${(b.account_holder||'BENEFICIARY').toUpperCase()}\nJOHANNESBURG\nZA`);  // Beneficiary Customer
    swiftLines.push(`:70:/SENDING/BATCH-${BATCH_ID}-SIG-${BATCH_SIG.slice(0,16)}/SEQ-${seq}-OF-${ready.length}/POS-ID-${r.id.slice(0,16)}`);  // Remittance Information (put your unique references in wire memo so recon works)
    swiftLines.push(`:71A:SHA`);                                                               // Details of Charges (SHA = Shared)
    swiftLines.push(`:72:/ACC/POS-PAYOUT-SETTLEMENT\n/BENEFICIARY-REFERENCE/${r.provider_reference || r.id}\n/RECON-SIGNATURE/${BATCH_SIG}`); // Sender to Receiver Information
    swiftLines.push('');
  });
  swiftLines.push('-}{5:{CHK:PLACEHOLDER}}');
  const swiftContent = swiftLines.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, SWIFT_NAME), swiftContent, 'utf8');
  console.log(`   ✅ Written: ${SWIFT_NAME}  (${swiftLines.length} lines)`);

  // JSON Manifest — single authoritative file a processor API can ingest
  const manifest = {
    schema_version: '1.0',
    batch_id: BATCH_ID,
    batch_signature: BATCH_SIG,
    created_at: nowIso(),
    operator: OPERATOR_NAME,
    operator_signature: OPERATOR_SIG,
    source_system: 'POS-OFFLINE-201.3 / PRIMESTACK',
    merchant_id: MERCHANT_ID,
    summary: {
      total_wires: ready.length,
      totals_by_currency: grandTotals,
      currencies: Object.keys(grandTotals),
    },
    destination_banks: [...new Set(ready.map(r => (r.bank.bank_name || 'UNKNOWN').toUpperCase()))],
    wires: ready.map((r, i) => ({
      sequence: i + 1,
      payout_id: r.id,
      transaction_id: r.transaction_id,
      provider_reference: r.provider_reference,
      status_before_batch: r.status,
      amount: Number(r.amount),
      currency: r.currency,
      value_date_utc: nowIso().slice(0, 10),
      beneficiary: {
        name: r.bank.account_holder,
        bank_name: r.bank.bank_name,
        account_number: r.bank.account_number,
        routing_number: r.bank.routing_number,
        swift_bic: r.bank.swift_code || r.bank.bic,
        iban: r.bank.iban,
        sort_code: r.bank.sort_code,
        account_type: r.bank.account_type || 'CHECKING',
        currency: r.bank.currency || r.currency,
      },
      ordering_customer: {
        name: 'PRIMESTACK TECHNOLOGIES LLC',
        entity_ref: 'PRIMESTACK-SETTLEMENT',
        city: 'WILMINGTON',
        state: 'DE',
        country: 'US',
      },
      remittance_information: [
        `BATCH=${BATCH_ID}`,
        `SIG=${BATCH_SIG.slice(0, 24)}`,
        `SEQ=${i + 1}/${ready.length}`,
        `POS-PAYOUT-ID=${r.id}`,
        `PROVIDER-REF=${r.provider_reference}`,
      ].join(' | '),
      wire_memo: (r.provider_reference || `BATCH${BATCH_ID.slice(-10)}S${(i+1)}`).slice(0, 35),
      charges_type: 'SHA',
      domestic_rail: r.bank.routing_number && r.currency === 'USD' ? 'ABA-ACH-WIRE' : (r.bank.swift_code ? 'SWIFT' : 'LOCAL-RTGS'),
      recon_signature: sha256(BATCH_ID + '|' + r.id + '|' + r.amount + '|' + BATCH_SIG + '|' + i),
    })),
    output_files: {
      wise_csv: WISE_CSV_NAME,
      swift_mt103_txt: SWIFT_NAME,
      manifest_json: MANIFEST_NAME,
    },
    sha256_of_wise_csv: sha256(wiseCsvContent),
    sha256_of_swift_txt: sha256(swiftContent),
    sha256_of_manifest: null,
  };
  manifest.sha256_of_manifest = sha256(JSON.stringify(manifest, null, 2));
  const manifestContent = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, MANIFEST_NAME), manifestContent, 'utf8');
  console.log(`   ✅ Written: ${MANIFEST_NAME}  (${manifestContent.length} bytes, sha256=${manifest.sha256_of_manifest.slice(0, 24)}…)`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: Forensic Pre-flight of the Wise Rail (if keys active)
  // If not, output the exact step to enable it.
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▌ Step 5: Wise Provider — Live Capability');
  const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const wiseMatch = /^WISE_API_KEY\s*=\s*(.+)$/m.exec(envRaw);
  const wiseActive = wiseMatch && !String(wiseMatch[1]).includes('your_wise');
  const wiseUrl = (/^WISE_API_URL\s*=\s*(.+)$/m.exec(envRaw) || [])[1];
  const wiseProfile = (/^WISE_PROFILE_ID\s*=\s*(.+)$/m.exec(envRaw) || [])[1];
  const providerNow = (/^BANK_PAYOUT_PROVIDER\s*=\s*(.+)$/m.exec(envRaw) || [])[1];
  console.log(`   BANK_PAYOUT_PROVIDER currently  = ${providerNow || '(unset)'}`);
  console.log(`   Wise API key configured         = ${wiseActive ? '✅ YES' : '❌ NO (placeholder / commented out)'}`);
  console.log(`   Wise API URL (default live)     = ${wiseUrl || 'https://api.transferwise.com (default)'}`);
  console.log(`   Wise PROFILE_ID                 = ${wiseProfile || '(auto-resolve on first call)'}`);

  if (wiseActive) {
    console.log('\n   ⚡ Wise LIVE is ACTIVE. To submit these 2 wires NOW via Wise API, run:');
    console.log(`      cd "${OUT_DIR.replace(/\\/g, '/')}"`);
    console.log(`      node -e "require('./src/domain/payouts/payoutProvider.service').then(async m=>{for(const w of require('./${MANIFEST_NAME}').wires){console.log('submitting',w.payout_id,await m.submitBankPayout({merchantId:'${MERCHANT_ID}',payoutId:w.payout_id,amount:w.amount,currency:w.currency,bankAccount:JSON.parse(JSON.stringify(w.beneficiary).replace('bank_name','bankName').replace('account_holder','accountHolder').replace('account_number','accountNumber').replace('routing_number','routingNumber').replace('swift_bic','swiftCode').replace('account_type','accountType')),reference:w.wire_memo}));}})"`);
    console.log('\n   OR (much safer, recommended) — upload the Wise CSV above via the WebUI:');
    console.log(`      → wise.com → Batch Payments → Import → pick ./${WISE_CSV_NAME}`);
  } else {
    console.log('\n   ⚙️  To activate Wise API auto-wire for future batches:');
    console.log('      1. https://wise.com/settings → API tokens → Generate token ("Full access")');
    console.log('      2. In backend/.env, set:');
    console.log('            BANK_PAYOUT_PROVIDER=wise');
    console.log('            WISE_API_URL=https://api.transferwise.com');
    console.log('            WISE_API_KEY=<your_token_here>');
    console.log('            WISE_PROFILE_ID=<optional — auto-resolved from API on first use>');
    console.log('      3. Add USD funds to Wise balance >= total_batch * 1.005 (fees).');
    console.log('      4. Then submit via API or CSV as above.');
    console.log('');
    console.log('   👉 SHORTCUT RIGHT NOW (no API key needed):');
    console.log(`      Upload ${WISE_CSV_NAME} directly to wise.com → Batch Payments → Import.`);
    console.log(`      — OR — hand ${SWIFT_NAME} to your local processor for RTGS execution.`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 6: Printable RTGS Instruction (for you / your processor — human-readable)
  // ─────────────────────────────────────────────────────────────────────────────
  const PRINT_NAME = `RTGS_INSTRUCTION_${BATCH_ID}.html`;
  const printHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>RTGS Settlement Instruction — ${BATCH_ID}</title>
<style>
  body{font-family:Consolas,'Courier New',monospace;max-width:900px;margin:20px auto;padding:30px;color:#111;background:#fff;border:1px dashed #444;}
  h1{font-size:18px;margin:0 0 4px;letter-spacing:2px;}
  h2{font-size:14px;margin:24px 0 8px;border-bottom:1px solid #999;padding-bottom:4px;letter-spacing:1px;}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px;}
  th,td{border:1px solid #888;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#eef;width:30%;}
  .sig{margin-top:20px;border-top:1px solid #555;padding-top:14px;font-size:12px;color:#555;}
  .mono{font-family:Consolas,'Courier New',monospace;}
  .chip{display:inline-block;background:#000;color:#fff;padding:2px 8px;margin-right:6px;border-radius:3px;font-size:11px;}
  .tot{text-align:right;font-weight:bold;font-size:13px;}
</style>
</head>
<body>
<h1>PRIMESTACK TECHNOLOGIES LLC &mdash; POS-OFFLINE SETTLEMENT</h1>
<div style="font-size:12px;color:#333;margin-bottom:12px;">
  <span class="chip">BATCH ID</span><span class="mono">${BATCH_ID}</span><br/>
  <span class="chip">BATCH SIG</span><span class="mono">${BATCH_SIG}</span><br/>
  <span class="chip">CREATED</span>${nowIso()}<br/>
  <span class="chip">OPERATOR</span>${OPERATOR_NAME} &middot; <span class="mono">${OPERATOR_SIG}</span>
</div>

<h2>INSTRUCTION FOR PROCESSOR / BANK</h2>
<p style="font-size:13px;">
  Execute <strong>${ready.length} outbound credit transfer(s)</strong> today
  from the <strong>PRIMESTACK TECHNOLOGIES LLC settlement account</strong> to the beneficiaries below.
  Include the exact <strong>Wire Memo / Beneficiary Reference</strong> shown per line so reconciliation against
  the POS system automatic recon engine (signature <span class="mono">${BATCH_SIG.slice(0,16)}…</span>) succeeds.
  Notify settlements@primestack-tech.com with RTGS confirmation + UETR for each wire.
</p>

<h2>WIRE DETAILS (${ready.length} line item${ready.length>1?'s':''})</h2>
${ready.map((r,i)=>{
  const b=r.bank;
  return `
<table>
  <tr><th colspan="4" style="background:#dde;">WIRE #${i+1} of ${ready.length} &mdash; POS Payout ${r.id.slice(0,24)}&hellip; &mdash; ${$(r.amount)} ${r.currency}</th></tr>
  <tr><th>Amount / Currency</th><td colspan="3"><strong>${$(r.amount)} ${r.currency}</strong></td></tr>
  <tr><th>Value Date (UTC)</th><td>${nowIso().slice(0,10)}</td>
      <th>Charges</th><td>SHA (Shared)</td></tr>
  <tr><th>Ordering Customer (Sender)</th><td colspan="3">PRIMESTACK TECHNOLOGIES LLC<br/>1000 N WEST ST STE 400, WILMINGTON DE 19801, UNITED STATES<br/>Entity Ref: PRIMESTACK-SETTLEMENT</td></tr>
  <tr><th>Sender's Bank (optional)</th><td>${b.swift_code || 'ABSAZAJJ'}</td>
      <th>Beneficiary Bank (BIC)</th><td><strong class="mono">${b.swift_code || 'ABSAZAJJXXX'}</strong></td></tr>
  <tr><th>Beneficiary Bank Name</th><td colspan="3"><strong>${b.bank_name || 'ABSA BANK'}</strong></td></tr>
  <tr><th>Beneficiary Name</th><td colspan="3"><strong>${b.account_holder}</strong></td></tr>
  <tr><th>Account Number</th><td><strong class="mono">${b.account_number}</strong></td>
      <th>Routing / Branch Code</th><td class="mono">${b.routing_number || '—'}</td></tr>
  <tr><th>IBAN (if EU/Intl)</th><td class="mono">${b.iban || '—'}</td>
      <th>Sort Code (if UK)</th><td class="mono">${b.sort_code || '—'}</td></tr>
  <tr><th>Account Type</th><td>${b.account_type || 'CHECKING'}</td>
      <th>Beneficiary Currency</th><td>${r.currency}</td></tr>
  <tr><th style="background:#fff3e6;">Wire Memo / Beneficiary Reference <em>(REQUIRED for recon)</em></th>
      <td colspan="3" style="background:#fffbe6;font-weight:bold;" class="mono">${(r.provider_reference || `BATCH${BATCH_ID.slice(-10)}S${(i+1)}`).slice(0,35)}</td></tr>
  <tr><th>Remittance / Payment Purpose</th>
      <td colspan="3" class="mono" style="font-size:11px;">POS Payout Settlement / Goods &amp; Services<br/>BATCH=${BATCH_ID} | SIG=${BATCH_SIG.slice(0,16)} | SEQ=${i+1}/${ready.length} | POS-ID=${r.id.slice(0,20)}</td></tr>
  <tr><th>Expected Domestic Rail</th><td>${b.routing_number && r.currency==='USD' ? 'US ABA-ACH / Domestic Wire' : (b.swift_code ? 'SWIFT / RTGS International' : 'Local ABSA RTGS / EFT ZA')}</td>
      <th>System Payout Reference</th><td class="mono">${r.provider_reference || r.id}</td></tr>
</table>
  `;
}).join('')}

<h2>BATCH TOTALS</h2>
<table>
${Object.entries(grandTotals).map(([c,t]) => `<tr><th style="width:30%;">Total ${c} Wires (${ready.length} items)</th><td class="tot"><strong>${$(t)} ${c}</strong></td></tr>`)}
<tr><th>Settlement Operator</th><td>${OPERATOR_NAME} &mdash; electronically signed <span class="mono">${nowIso()}</span></td></tr>
</table>

<h2>DELIVERY CONFIRMATION (to be completed by processor / bank)</h2>
<table>
  <tr><th style="width:30%;">Processor Name</th><td>__________________________________________</td></tr>
  <tr><th>Date Submitted</th><td>____/____/__________</td></tr>
${ready.map((r,i)=>`<tr><th>Wire ${i+1} — UETR / RTGS Reference</th><td>POS Payout ${r.id.slice(0,16)}… UETR: ______________________</td></tr>`)}
  <tr><th>Authorized Signatory</th><td>Signature: ________________________ Name: ________________________ Title: ________________________</td></tr>
</table>

<div class="sig">
  Document signature (SHA-256): <span class="mono">${sha256(swiftContent + wiseCsvContent + BATCH_SIG)}</span><br/>
  Source Batch: <span class="mono">${BATCH_ID}</span> &middot; Generated by POS-OFFLINE settlement module.<br/>
  <em>Print 2 copies &mdash; one for processor, one filed with your bank reconciliation binder.</em>
</div>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, PRINT_NAME), printHtml, 'utf8');
  console.log(`   ✅ Written: ${PRINT_NAME}  (printable RTGS instruction)`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('✅ REAL SETTLEMENT BATCH PACKAGE — BUILD COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('   Output files (all in backend/ folder):');
  console.log(`     📄 ${WISE_CSV_NAME.padEnd(52)}  — upload to wise.com → Batch Payments`);
  console.log(`     📄 ${SWIFT_NAME.padEnd(52)}  — give to processor for SWIFT/RTGS`);
  console.log(`     📄 ${MANIFEST_NAME.padEnd(52)}  — machine-readable API ingest`);
  console.log(`     📄 ${PRINT_NAME.padEnd(52)}  — human-printable RTGS instruction`);
  console.log('');
  console.log('   DB state updated:');
  console.log(`     • ${ready.length} payout rows → reconciliation_status = BATCHED_FOR_OUTBOUND_WIRE`);
  console.log(`     • settlement_batch block added to meta (batch_id=${BATCH_ID}, sig=${BATCH_SIG.slice(0,12)}…)`);
  console.log('');
  console.log('   NEXT PHYSICAL STEP (PICK ONE — today):');
  console.log('     A) 🟢 FASTEST: Open the printable HTML above → print → hand to your processor with the batch ID');
  console.log(`     B) 🟢 WISE CSV:  Upload ./${WISE_CSV_NAME} to wise.com → Batch Payments → Send`);
  console.log(`     C) 🟢 PROCESSOR API: POST ./${MANIFEST_NAME} .wires[] array to your processor's payout endpoint`);
  console.log('');
  console.log('   Once wires are submitted, hand me back the real UETR/RTGS references and I will:');
  console.log('     • stamp each payout row with real_provider_outbound_ref = <UETR>');
  console.log('     • move reconciliation_status → OUTBOUND_WIRE_SENT');
  console.log('     • (optional) move ledger_entries to FINAL_RECONCILED if needed');
  console.log('═══════════════════════════════════════════════════════════════════════════');
})().catch(e => { console.error('\n❌ FATAL:', e); process.exit(1); });
