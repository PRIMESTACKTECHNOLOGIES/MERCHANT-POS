import { useEffect, useState } from 'react';
import {
  fetchReceipts,
  generateReceipt,
  getReceipt,
  printReceipt,
  generateThermalReceipt,
  downloadThermalTxt,
  type Receipt,
  type ThermalCopy,
} from '../lib/api';

export function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [fullReceipt, setFullReceipt] = useState<any>(null);
  const [printResult, setPrintResult] = useState<any>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [copyTab, setCopyTab] = useState<ThermalCopy>('combined');

  useEffect(() => {
    loadReceipts();
  }, []);

  const loadReceipts = async () => {
    try {
      setLoading(true);
      const data = await fetchReceipts();
      setReceipts(data);
    } catch (error) {
      console.error('Failed to load receipts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReceipt = async (transactionId: string) => {
    try {
      const receipt = await generateReceipt(transactionId);
      setSelectedReceiptId(receipt.receiptId);
      setFullReceipt(receipt);
      loadReceipts();
    } catch (error) {
      console.error('Failed to generate receipt:', error);
      alert((error as Error).message);
    }
  };

  const openReceipt = async (receiptId: string) => {
    setSelectedReceiptId(receiptId);
    try {
      const r = await getReceipt(receiptId);
      setFullReceipt(r);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePrint = async (receiptId: string) => {
    try {
      const r = await printReceipt(receiptId);
      setPrintResult(r);
      setShowPrintModal(true);
      setCopyTab('combined');
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    }
  };

  const handlePrintByTxn = async (transactionId: string, copy: ThermalCopy) => {
    try {
      const r = await generateThermalReceipt(transactionId, copy, 'json');
      setPrintResult(r);
      setShowPrintModal(true);
      setCopyTab(copy);
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    }
  };

  const receiptPrintCss = `
@page { size: 80mm auto; margin: 2mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 80mm; padding: 2mm; font-family: "Courier New", Consolas, "Lucida Console", monospace; font-size: 11px; line-height: 1.35; }
.receipt, .receipt-dual { width: 100%; }
.receipt + .cut-tear, .cut-tear { margin: 8mm 0 6mm; text-align: center; color: #444; font-size: 10px; letter-spacing: 0.5px; }
.receipt header { text-align: center; margin-bottom: 6px; }
.receipt header h1 { margin: 0 0 4px; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.receipt header .addr { margin: 2px 0 6px; color: #111; }
.receipt header .hr { width: 100%; height: 1px; background: #000; margin: 6px 0; }
.receipt header .hr.hr2 { height: 2px; }
.receipt header .copy-label { font-weight: 700; margin: 6px 0 4px; text-transform: uppercase; }
.receipt header .meta { margin-top: 4px; text-align: left; width: 100%; }
.receipt header .meta > div { display: flex; justify-content: space-between; width: 100%; }
.receipt header .meta span { color: #222; }
.receipt header .meta b { color: #000; font-weight: 700; }
.receipt section { margin: 6px 0; }
.receipt section h3 { margin: 6px 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; border-top: 1px dashed #666; padding-top: 4px; }
.receipt table { width: 100%; border-collapse: collapse; font-size: 11px; }
.receipt table th, .receipt table td { text-align: left; padding: 1px 0; vertical-align: top; }
.receipt table th { color: #333; font-weight: 600; width: 42%; padding-right: 6px; }
.receipt table td { color: #000; word-break: break-word; }
.receipt .amount { text-align: center; margin: 6px 0; padding: 6px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; }
.receipt .amount h3 { border: none; margin: 0 0 4px; padding: 0; }
.receipt .amount-big { font-weight: 800; font-size: 18px; letter-spacing: 0.5px; }
.receipt .tranche h3 { color: #7b4d00; }
.receipt .status { text-align: center; margin: 8px 0 6px; padding: 4px 0; border: 2px solid #000; }
.receipt .status h3 { margin: 0; padding: 2px 0; border: none; font-weight: 800; font-size: 13px; color: #000; }
.receipt .status.ok h3 { color: #064e3b; }
.receipt .sig { margin: 8px 0 4px; }
.receipt .sig .siglabel { font-weight: 700; margin-bottom: 16px; }
.receipt .sig .sigline { border-bottom: 1px solid #000; margin: 0 0 6px; width: 100%; height: 22px; }
.receipt .sig .sigprint { display: flex; justify-content: space-between; }
.receipt footer { margin-top: 6px; text-align: center; font-size: 10px; color: #222; }
.receipt footer p { margin: 2px 0; }
.receipt footer .end { margin-top: 6px; font-weight: 700; font-size: 11px; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

  const browserPrintHtml = (html: string, title = 'Thermal Receipt') => {
    const w = window.open('', '_blank', 'width=520,height=960');
    if (!w) { alert('Please allow pop-ups to print the receipt.'); return; }
    w.document.write(`<!doctype html><html><head><title>${title}</title>
<meta charset="utf-8" />
<style>${receiptPrintCss}</style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { console.error('print failed', e); } }, 550);
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-200 rounded"></div>)}
        </div>
      </div>
    );
  }

  const pickFirst = (obj: any, keys: string[]): string => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
    return '';
  };

  const browserText: string =
    pickFirst(printResult, [
      copyTab === 'combined' ? 'browserCombined' : copyTab === 'customer' ? 'browserCustomer' : 'browserMerchant',
      copyTab === 'combined' ? 'combinedCopy' : copyTab === 'customer' ? 'customerCopy' : 'merchantCopy',
      copyTab === 'combined' ? 'plainCombined' : copyTab === 'customer' ? 'plainCustomer' : 'plainMerchant',
      copyTab === 'combined' ? 'printable' : copyTab === 'customer' ? 'plainTextCustomer' : 'plainTextMerchant',
    ]) ||
    (typeof printResult?.receipt === 'object'
      ? pickFirst(printResult.receipt, [
          copyTab === 'combined' ? 'browserCombined' : copyTab === 'customer' ? 'browserCustomer' : 'browserMerchant',
          copyTab === 'combined' ? 'plainCombined' : copyTab === 'customer' ? 'plainCustomer' : 'plainMerchant',
        ])
      : '');

  const htmlText: string =
    pickFirst(printResult, [
      copyTab === 'combined' ? 'htmlCombined' : copyTab === 'customer' ? 'htmlCustomer' : 'htmlMerchant',
    ]) ||
    (typeof printResult?.receipt === 'object'
      ? pickFirst(printResult.receipt, [
          copyTab === 'combined' ? 'htmlCombined' : copyTab === 'customer' ? 'htmlCustomer' : 'htmlMerchant',
        ])
      : '');

  const escposText: string =
    pickFirst(printResult, [
      copyTab === 'combined' ? 'thermalCombined' : copyTab === 'customer' ? 'thermalCustomer' : 'thermalMerchant',
      copyTab === 'combined' ? 'printable' : copyTab === 'customer' ? 'thermalCustomer' : 'thermalMerchant',
    ]) ||
    browserText;

  const thermalText: string = browserText || escposText;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Receipts</h1>
          <p className="text-gray-600 mt-2">PRIME POS receipts with ICICI Vault, online/offline channel, transaction, card, terminal, ledger, and settlement details</p>
        </div>
        <div className="text-xs text-gray-500 bg-white border border-gray-200 rounded px-3 py-2">
          ✳️ &nbsp; Click any receipt row → then use <strong>PRINT THERMAL</strong> for ESC/POS 80mm (Customer + Merchant copies)
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Receipts ({receipts.length})</h2>
        </div>

        {receipts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg font-medium">No receipts yet</p>
            <p className="text-sm mt-1">Transactions generate receipts automatically on the POS flow.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {receipts.map((r) => {
              const active = selectedReceiptId === r.receiptId;
              return (
                <div
                  key={r.receiptId}
                  className={`px-6 py-4 transition-colors ${active ? 'bg-blue-50' : 'hover:bg-gray-50'} cursor-pointer`}
                  onClick={() => openReceipt(r.receiptId)}
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center space-x-4 min-w-0">
                      <div className="w-11 h-11 bg-blue-100 rounded-lg flex items-center justify-center flex-none">
                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{r.receiptId}</p>
                        <p className="text-xs text-gray-500 font-mono">STAN {r.stan || '—'} &nbsp;·&nbsp; Auth {r.authCode || '—'} &nbsp;·&nbsp; {r.cardMasked || '—'}</p>
                      </div>
                    </div>
                    <div className="text-right min-w-[140px]">
                      <p className="font-bold text-gray-900 text-lg">
                        {r.currency === 'USD' ? '$' : ''}{Number(r.amount || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} {r.currency}
                      </p>
                      <p className="text-xs text-gray-500">{new Date(r.generatedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2 flex-none" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
                        onClick={() => handlePrint(r.receiptId)}
                      >
                        🖨 PRINT THERMAL
                      </button>
                      <button
                        className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-white hover:bg-gray-900 font-medium"
                        onClick={() => downloadThermalTxt(r.transactionId, 'combined')}
                      >
                        ⬇ DUAL .TXT
                      </button>
                    </div>
                  </div>

                  {active && fullReceipt && fullReceipt.receiptId === r.receiptId && (
                    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                        {[
                          ['RECEIPT ID:', fullReceipt.receiptId || r.receiptId],
                          ['TXN ID:', r.transactionId],
                          ['DATE / TIME:', r.txnTimestamp ? new Date(r.txnTimestamp).toLocaleString() : new Date(r.generatedAt).toLocaleString()],
                          ['STATUS:', r.status || 'AUTHORIZED'],
                          ['POS BRAND:', 'PRIME'],
                          ['VAULT:', 'ICICI'],
                          ['CHANNEL:', String(r.authMode || '').toUpperCase().includes('OFFLINE') || String(r.batchId || '').toUpperCase().startsWith('OFFLINE-') ? 'OFFLINE' : 'ONLINE'],
                          ['STAN:', r.stan || '—'],
                          ['AUTH CODE:', r.authCode || '—'],
                          ['TERMINAL:', r.batchStatus ? r.batchStatus : r.transaction?.terminalId || '—'],
                          ['BATCH:', r.batchId || '—'],
                          ['CARD:', r.cardMasked || '—'],
                          ['AMOUNT:', `${r.currency === 'USD' ? '$' : ''}${Number(r.amount || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${r.currency}`],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between border-b border-dashed border-gray-200 py-1">
                            <span className="font-bold text-gray-600">{k}</span>
                            <span className="font-mono text-gray-900 text-right ml-3 break-all">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                      {fullReceipt.fullTx && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                          {[
                            ['CARDHOLDER:', fullReceipt.fullTx.customer_name || 'NOT PROVIDED'],
                            ['CARD BRAND:', fullReceipt.fullTx.card_brand || 'VISA'],
                            ['CARD PROGRAM:', fullReceipt.fullTx.card_program || '—'],
                            ['EXPIRY:', fullReceipt.fullTx.expiry_mm_yy || '—'],
                            ['CVV:', fullReceipt.fullTx.cvv_provided ? 'VERIFIED (***)' : 'NOT PRESENT'],
                            ['ENTRY MODE:', fullReceipt.fullTx.entry_mode || 'MANUAL'],
                            ['PIN VERIFIED:', fullReceipt.fullTx.pin_verified ? 'YES' : 'NO'],
                            ['EMV CRYPTO:', fullReceipt.fullTx.emv_cryptogram_type || '—'],
                            ['PROTOCOL:', `VER ${fullReceipt.fullTx.protocol_version || '201.3'}`],
                            ['POS BRAND:', fullReceipt.fullTx.pos_brand_name || 'PRIME'],
                            ['VAULT:', fullReceipt.fullTx.vault_display_name || 'ICICI'],
                            ['CHANNEL:', fullReceipt.fullTx.transaction_channel || 'ONLINE'],
                            ['OFFLINE AUTH:', fullReceipt.fullTx.offline_approval_type || '—'],
                            ['PI ID:', fullReceipt.fullTx.pi_id || '—'],
                            ['RRN:', fullReceipt.fullTx.rrn || '—'],
                            ['LOCAL TXN ID:', (fullReceipt.fullTx.local_txn_id && fullReceipt.fullTx.local_txn_id !== r.transactionId) ? fullReceipt.fullTx.local_txn_id : '—'],
                            ['SETTLEMENT CODE:', fullReceipt.fullTx.settlement_code || '—'],
                            ['BATCH STATUS:', fullReceipt.fullTx.batch_status || '—'],
                            ['BATCH TXN CT:', fullReceipt.fullTx.batch_txn_count ? String(fullReceipt.fullTx.batch_txn_count) : '—'],
                            ['BATCH TOTAL:', fullReceipt.fullTx.batch_total_amount_minor ? `${r.currency === 'USD' ? '$' : ''}${(Number(fullReceipt.fullTx.batch_total_amount_minor) / 100).toLocaleString('en-US',{minimumFractionDigits:2})} ${r.currency}` : '—'],
                            ['PROCESSED AT:', fullReceipt.fullTx.batch_processed_at ? new Date(fullReceipt.fullTx.batch_processed_at).toLocaleString() : '—'],
                            ['SETTLE BANK:', fullReceipt.fullTx.settlement_bank || fullReceipt.fullTx.beneficiary_bank || '—'],
                            ['BENEF NAME:', fullReceipt.fullTx.beneficiary_name || '—'],
                            ['BENEF ACCT:', fullReceipt.fullTx.beneficiary_account_last4 ? `**** ${fullReceipt.fullTx.beneficiary_account_last4}` : '—'],
                            ['BENEF RTG:', fullReceipt.fullTx.beneficiary_routing || '—'],
                            ['PERM FLOOR:', `$${Number(fullReceipt.fullTx.terminal_floor_limit_permanent || 5000).toLocaleString('en-US')}`],
                            ['TEMP FLOOR RAISE:', fullReceipt.fullTx.floor_limit_raised_temporary_for_txn_only ? 'APPLIED (TXN ONLY)' : 'NO'],
                            ['FLOOR POST-TXN:', fullReceipt.fullTx.floor_limit_restored_post_commit ? `$${Number(fullReceipt.fullTx.floor_limit_restored_post_commit).toLocaleString('en-US')} (RESTORED)` : '—'],
                            ['TERMINAL NAME:', fullReceipt.fullTx.terminal_name || 'Main Terminal'],
                            ['MERCHANT:', fullReceipt.fullTx.merchant_name || 'PRIMESTACK'],
                            ['MERCHANT EMAIL:', fullReceipt.fullTx.merchant_email || '—'],
                            ['LICENSE #:', fullReceipt.fullTx.merchant_license || '—'],
                            ['TAX ID:', fullReceipt.fullTx.merchant_tax_id || '—'],
                            ['LEDGER ENTRY:', fullReceipt.fullTx.ledger_entry_id || '—'],
                            ['SETTLEMENT ID:', fullReceipt.fullTx.settlement_id || '—'],
                            ['RECORDED AT:', fullReceipt.fullTx.created_at ? new Date(fullReceipt.fullTx.created_at).toLocaleString() : '—'],
                            ['LAST UPDATED:', fullReceipt.fullTx.updated_at ? new Date(fullReceipt.fullTx.updated_at).toLocaleString() : '—'],
                          ].filter(([, v]) => v && String(v) !== '—').map(([k, v]) => (
                            <div key={k} className="flex justify-between border-b border-dashed border-gray-100 py-1">
                              <span className="font-bold text-gray-500">{k}</span>
                              <span className="font-mono text-gray-900 text-right ml-3 break-all">{String(v)}</span>
                            </div>
                          ))}
                          {fullReceipt.fullTx.decline_reason && (
                            <div className="md:col-span-2 mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
                              <p className="font-bold text-red-800 mb-2">✗ ✗ ✗ DECLINED — DETAILS</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                {(() => {
                                  const dr = String(fullReceipt.fullTx.decline_reason || '');
                                  const m = dr.match(/^\[([^\]]+)\]\s*(.*)$/);
                                  const code = m ? m[1] : '';
                                  const reason = m ? (m[2] || dr) : dr;
                                  return [
                                    ['STATUS:', r.status || 'DECLINED'],
                                    ...(code ? [['DECLINE CODE:', code] as [string,string]] : []),
                                    ['REASON:', reason || 'Card not authorized']
                                  ].map(([kk,vv]) => (
                                    <div key={kk} className="flex justify-between border-b border-dashed border-red-200 py-0.5">
                                      <span className="font-bold text-red-700">{kk}</span>
                                      <span className="font-mono text-red-900 text-right ml-3 break-all">{vv}</span>
                                    </div>
                                  ));
                                })()}
                              </div>
                            </div>
                          )}
                          {fullReceipt.fullTx.tranche && (fullReceipt.fullTx.tranche.total_agreement_usd || fullReceipt.fullTx.tranche.agreement_total) && (
                            <div className="md:col-span-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="font-bold text-amber-800 mb-2">TRANCHE &amp; MASTER AGREEMENT</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                {[
                                  ['MASTER TOTAL:', `$${Number(fullReceipt.fullTx.tranche.total_agreement_usd || fullReceipt.fullTx.tranche.agreement_total).toLocaleString('en-US')} USD`],
                                  ['TRANCHE AMOUNT:', `$${Number(r.amount).toLocaleString('en-US')} USD`],
                                  ['TRANCHE No:', `${fullReceipt.fullTx.tranche.tranches_completed || 1} OF ${fullReceipt.fullTx.tranche.tranches_total_expected || '?'}`],
                                  ['REMAINING:', fullReceipt.fullTx.tranche.tranches_remaining_usd ? `$${Number(fullReceipt.fullTx.tranche.tranches_remaining_usd).toLocaleString('en-US')} USD` : '—'],
                                  ['LEFT AFTER:', (fullReceipt.fullTx.tranche.tranches_remaining_after_this !== undefined && fullReceipt.fullTx.tranche.tranches_remaining_after_this !== null) ? `${fullReceipt.fullTx.tranche.tranches_remaining_after_this} TRANCHE(S)` : '—'],
                                ].filter(([,v]) => v && String(v) !== '—').map(([k,v]) => (
                                  <div key={k} className="flex justify-between border-b border-dashed border-amber-200 py-0.5">
                                    <span className="font-bold text-amber-700">{k}</span>
                                    <span className="font-mono text-amber-900 text-right ml-3">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Thermal Print Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl font-bold text-gray-900">🖨 Thermal Receipt (80mm ESC/POS)</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {printResult?.receiptId ? `Receipt ${printResult.receiptId}` : printResult?.receipt?.receiptId ? `Receipt ${printResult.receipt.receiptId}` : ''}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(['combined','customer','merchant'] as ThermalCopy[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setCopyTab(tab)}
                    className={`px-3 py-1.5 text-xs rounded-md border font-semibold transition-colors ${
                      copyTab === tab
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {tab === 'combined' ? '📄 DUAL COPY' : tab === 'customer' ? '👤 CUSTOMER' : '🏪 MERCHANT'}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5 border-b border-gray-200 bg-gray-50 flex gap-3 flex-wrap">
              <button
                onClick={() => {
                  if (htmlText && htmlText.trim().length > 0) {
                    browserPrintHtml(htmlText, `Thermal-${copyTab}`);
                  } else {
                    const fallbackPlain = browserText || escposText || '';
                    const htmlFallback = `<article class="receipt"><pre style="white-space:pre-wrap;word-break:break-word;font-family:Courier New,monospace;font-size:11px;margin:0;padding:0;">${fallbackPlain.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></article>`;
                    browserPrintHtml(htmlFallback, `Thermal-${copyTab}`);
                  }
                }}
                className="px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-semibold text-sm shadow-sm"
              >
                🖨 PRINT NOW (Browser → Thermal)
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([escposText], { type: 'application/octet-stream' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `receipt-${printResult?.receiptId || 'thermal'}-${copyTab}.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 2000);
                }}
                className="px-4 py-2 rounded-md bg-gray-800 text-white hover:bg-gray-900 font-semibold text-sm shadow-sm"
              >
                ⬇ DOWNLOAD ESC/POS .TXT
              </button>
              <button
                onClick={() => navigator.clipboard?.writeText(browserText)}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-sm shadow-sm"
              >
                📋 COPY TO CLIPBOARD
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { setShowPrintModal(false); setPrintResult(null); }}
                className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 font-semibold text-sm"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 bg-gray-900">
              {htmlText && htmlText.trim().length > 0 ? (
                <div className="bg-white p-4 rounded-lg border border-gray-700 shadow-inner">
                  <style>{receiptPrintCss.replace(/@page\s*\{[^}]*\}/g, '')}</style>
                  <div style={{ maxWidth: 540 }} dangerouslySetInnerHTML={{ __html: htmlText }} />
                </div>
              ) : (
                <pre className="text-green-300 text-[11px] leading-[1.35] font-mono whitespace-pre-wrap bg-black p-4 rounded-lg border border-gray-700 shadow-inner">
                  {browserText || '(Receipt preview not available for this copy)'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReceiptsPage;
