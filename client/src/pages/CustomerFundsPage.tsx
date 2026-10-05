import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Send, RefreshCw, X, Check, ChevronRight, Wallet, ArrowRight } from "lucide-react";
import { resolveApiBaseUrl } from "../lib/backendUrl";

const API = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });

async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("token") || localStorage.getItem("jwt_token");
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `Error ${res.status}`);
  return body;
}

function getMerchantId() {
  try { return JSON.parse(localStorage.getItem("settings") || "{}").merchant_id || "MRC-1001"; } catch { return "MRC-1001"; }
}

interface CustomerWallet {
  balance: number;
  currency: string;
  customerId: string;
  name?: string;
}

interface TransferResult {
  amount: number;
  currency: string;
  reference: string;
  merchantId: string;
  merchantBalanceAfter: number;
  providerReference?: string;
  creditedAt?: string;
}

// ── Step indicator ────────────────────────────────────────────────────────────
const steps = [
  { id: 1, label: "POS Capture", desc: "Offline payment captured to customer wallet" },
  { id: 2, label: "Provider Debit", desc: "Customer provides credentials to pull real funds" },
  { id: 3, label: "Merchant Credit", desc: "Real funds credited to merchant wallet" },
  { id: 4, label: "Vault Bank", desc: "Merchant sends to vault → external bank or crypto" },
];

function FlowSteps({ active }: { active: number }) {
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const done = active > step.id;
        const current = active === step.id;
        return (
          <div key={step.id} className="flex items-start min-w-0">
            <div className="flex flex-col items-center min-w-[72px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${done ? "bg-emerald-500 border-emerald-500 text-white" :
                  current ? "bg-blue-600 border-blue-600 text-white" :
                  "bg-white border-gray-300 text-gray-400"}`}>
                {done ? <Check size={14} /> : step.id}
              </div>
              <p className={`text-[10px] font-bold mt-1 text-center leading-tight
                ${done ? "text-emerald-600" : current ? "text-blue-700" : "text-gray-400"}`}>
                {step.label}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-6 mt-4 mx-1 flex-shrink-0 transition-colors
                ${active > step.id ? "bg-emerald-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CustomerFundsPage() {
  const merchantId = getMerchantId();

  // Customer wallet lookup
  const [customers, setCustomers] = useState<CustomerWallet[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);

  // Transfer form
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWallet | null>(null);
  const [amount, setAmount]       = useState("");
  const [currency, setCurrency]   = useState("USD");
  const [reference, setReference] = useState("");

  // Provider modal
  const [showModal, setShowModal]           = useState(false);
  const [providerUrl, setProviderUrl]       = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerSecret, setProviderSecret] = useState("");
  const [showSecret, setShowSecret]         = useState(false);

  // State
  const [sending, setSending]       = useState(false);
  const [sendResult, setSendResult] = useState<TransferResult | null>(null);
  const [sendErr, setSendErr]       = useState("");
  const [formErr, setFormErr]       = useState("");

  // Flow step: 1=capture done, 2=entering provider, 3=done (credited), 4=go to vault
  const [flowStep, setFlowStep] = useState(1);

  const loadCustomerWallets = useCallback(async () => {
    setLoadingWallets(true);
    try {
      const data = await apiFetch("/wallet/customers");
      const list = Array.isArray(data) ? data : (data.customers || data.data || []);
      const wallets: CustomerWallet[] = [];
      for (const c of list.slice(0, 50)) {
        try {
          const wb = await apiFetch(`/wallet/balance/${encodeURIComponent(c.id)}`);
          if (Number(wb?.balance) > 0) {
            wallets.push({
              customerId: c.id,
              name: c.name || c.full_name || c.id,
              balance: Number(wb.balance),
              currency: String(wb.currency || "USD"),
            });
          }
        } catch { /* skip wallets that fail */ }
      }
      setCustomers(wallets);
    } catch (e) {
      console.warn("Failed to load customer wallets", e);
    } finally {
      setLoadingWallets(false);
    }
  }, []);

  useEffect(() => { void loadCustomerWallets(); }, [loadCustomerWallets]);

  const openModal = () => {
    setFormErr("");
    if (!selectedCustomer && !amount) {
      setFormErr("Select a customer or enter a customer ID and amount");
      return;
    }
    if (!amount || Number(amount) <= 0) { setFormErr("Enter a valid amount"); return; }
    setSendErr("");
    setShowModal(true);
    setFlowStep(2);
  };

  const closeModal = () => {
    if (sending) return;
    setShowModal(false);
    setSendErr("");
    if (!sendResult) setFlowStep(1);
  };

  const sendToMerchant = async () => {
    const custId = selectedCustomer?.customerId || "";
    if (!custId) { setSendErr("No customer selected"); return; }
    if (!providerUrl.trim())    { setSendErr("Provider endpoint URL is required"); return; }
    if (!providerApiKey.trim()) { setSendErr("API key is required"); return; }
    if (!providerSecret.trim()) { setSendErr("Secret key is required"); return; }

    setSending(true);
    setSendErr("");
    try {
      const r = await apiFetch("/api/wallets/customer-to-merchant", {
        method: "POST",
        body: JSON.stringify({
          customerId:        custId,
          merchantId,
          amount:            Number(amount),
          currency,
          providerUrl:       providerUrl.trim(),
          providerApiKey:    providerApiKey.trim(),
          providerSecretKey: providerSecret.trim(),
          reference:         reference.trim() || undefined,
        }),
      });
      setSendResult(r);
      setShowModal(false);
      setProviderUrl(""); setProviderApiKey(""); setProviderSecret(""); setShowSecret(false);
      setFlowStep(3);
      // Refresh wallet list
      void loadCustomerWallets();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Funds Transfer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pull real funds from the customer's payment provider and credit the merchant wallet.
        </p>
      </div>

      {/* Flow steps */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Payment Flow</p>
        <FlowSteps active={flowStep} />
      </div>

      {/* Customer wallets with captured balances */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-blue-600" />
            <h2 className="font-bold text-gray-900 text-sm">Customer Captured Balances</h2>
          </div>
          <button onClick={() => void loadCustomerWallets()} disabled={loadingWallets}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700">
            <RefreshCw size={12} className={loadingWallets ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {loadingWallets ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading wallets...</div>
          ) : customers.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500 font-medium">No customer wallets with balance</p>
              <p className="text-xs text-gray-400 mt-1">Process a POS capture first — it will appear here</p>
            </div>
          ) : (
            customers.map(c => (
              <button key={c.customerId}
                onClick={() => {
                  setSelectedCustomer(c);
                  setAmount(String(c.balance));
                  setCurrency(c.currency);
                  setFormErr("");
                  setSendResult(null);
                  setFlowStep(1);
                }}
                className={`w-full flex items-center justify-between px-5 py-4 text-left transition-colors
                  ${selectedCustomer?.customerId === c.customerId
                    ? "bg-blue-50 border-l-4 border-blue-500"
                    : "hover:bg-gray-50 border-l-4 border-transparent"}`}>
                <div>
                  <p className="text-sm font-bold text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{c.customerId}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-700">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency }).format(c.balance)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Captured — pending provider pull</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Transfer form */}
      {!sendResult && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 text-sm">Transfer Details</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {selectedCustomer
                ? `Pulling from ${selectedCustomer.name}'s provider`
                : "Select a customer above or enter manually"}
            </p>
          </div>
          <div className="p-5 space-y-4">

            {selectedCustomer && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                  {(selectedCustomer.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-blue-900 truncate">{selectedCustomer.name}</p>
                  <p className="text-xs text-blue-600 font-mono">{selectedCustomer.customerId}</p>
                </div>
                <button onClick={() => { setSelectedCustomer(null); setAmount(""); setFormErr(""); }}
                  className="text-blue-400 hover:text-blue-600">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Amount</label>
                <input type="number" min="0.01" step="0.01" value={amount}
                  onChange={e => { setAmount(e.target.value); setFormErr(""); }}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Currency</label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option>USD</option><option>EUR</option><option>GBP</option><option>AED</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Reference <span className="font-normal text-gray-400">(optional)</span></label>
              <input value={reference} onChange={e => setReference(e.target.value)}
                placeholder="e.g. TXN-20260901-001"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>

            {formErr && <p className="text-xs font-semibold text-red-600">{formErr}</p>}

            <button onClick={openModal} disabled={sending || !amount || Number(amount) <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-md hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 transition-all">
              <Send size={15} />
              Enter provider credentials &amp; pull funds
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Success result */}
      {sendResult && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-900">Real funds credited to merchant wallet</p>
                <p className="text-xs text-emerald-600 mt-0.5">Provider confirmed debit — merchant balance updated</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Amount credited", `${sendResult.currency} ${Number(sendResult.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
                ["Reference", sendResult.reference],
                ["Merchant wallet", `${sendResult.currency} ${Number(sendResult.merchantBalanceAfter || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
                ["Provider ref", sendResult.providerReference || "—"],
              ].map(([label, value]) => (
                <div key={label} className="bg-white rounded-xl px-3 py-2.5 border border-emerald-100">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">{label}</p>
                  <p className="text-sm font-mono text-emerald-900 font-bold truncate mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Next step: send to vault */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ArrowRight size={14} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-blue-900">Next: Send to Vault Bank</p>
                <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                  The merchant wallet now holds real withdrawable funds. Go to Merchant Wallet → Send to Vault Bank to move them into the vault for external payout or crypto purchase.
                </p>
                <button
                  onClick={() => { window.location.href = "/merchant-wallet"; }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-colors">
                  Go to Merchant Wallet <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              setSendResult(null);
              setAmount("");
              setReference("");
              setSelectedCustomer(null);
              setFlowStep(1);
              void loadCustomerWallets();
            }}
            className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            Transfer another customer
          </button>
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-700">How this works:</strong> The POS captured funds are recorded in the customer's internal ledger wallet. This screen calls your payment provider using the credentials you enter to pull the real external funds and credit the merchant wallet. Provider credentials are used only for this request and are never stored.
      </div>

      {/* Provider credentials modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <form
            role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title"
            onSubmit={e => { e.preventDefault(); void sendToMerchant(); }}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">

            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="provider-dialog-title" className="text-lg font-bold text-gray-900">Provider credentials</h2>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Enter your payment provider's API credentials. The backend will connect to your provider endpoint and pull{" "}
                  <strong>{currency} {Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> to the merchant wallet.
                  Credentials are not saved.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closeModal} disabled={sending}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-50">
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Provider endpoint URL</label>
              <input type="url" required value={providerUrl} onChange={e => setProviderUrl(e.target.value)}
                placeholder="https://api.yourprovider.com/v1/withdraw"
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <p className="text-[10px] text-gray-400 mt-1">Must be HTTPS. Your backend POSTs to this URL.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">API Key</label>
              <input type="password" required autoComplete="new-password" value={providerApiKey}
                onChange={e => setProviderApiKey(e.target.value)}
                placeholder="pk_live_..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Secret Key</label>
              <div className="relative">
                <input type={showSecret ? "text" : "password"} required autoComplete="new-password"
                  value={providerSecret} onChange={e => setProviderSecret(e.target.value)}
                  placeholder="sk_live_..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-10 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <button type="button" aria-label={showSecret ? "Hide" : "Show"}
                  onClick={() => setShowSecret(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {sendErr && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs font-semibold text-red-700">
                {sendErr}
              </div>
            )}

            <button type="submit" disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60 transition-all shadow-md">
              {sending
                ? <><RefreshCw size={15} className="animate-spin" /> Connecting to provider...</>
                : <><Send size={15} /> Confirm — pull {currency} {Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} to merchant</>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
