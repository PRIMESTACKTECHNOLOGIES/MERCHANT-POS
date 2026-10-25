import { useEffect, useState } from "react";
import { portalCallProvider, portalWallet, type PortalWallet } from "../../lib/customerApi";

/** Currencies the wallet rails support; used so the picker is never limited to one option. */
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "AED", "ZAR", "KES", "NGN"];

/** Provider transfers must be idempotent, so the reference is generated once per attempt. */
function newRequestReference(): string {
  const random = window.crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
  return `WPP-${random}`;
}

function money(amount: number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "USD"} ${n.toFixed(2)}`;
  }
}

export function CustomerC2MPage() {
  const [wallets, setWallets] = useState<PortalWallet[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(true);

  const [merchantId, setMerchantId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [reason, setReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ reference: string; amount: number; currency: string; merchantId: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await portalWallet();
        if (!active) return;
        setWallets(res.wallets || []);
        if (res.wallets?.length) setCurrency(res.wallets[0].currency);
      } catch {
        /* balance is informational; the provider call validates funds */
      } finally {
        if (active) setLoadingWallets(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const currencyOptions = Array.from(
    new Set([...wallets.map((w) => w.currency), ...SUPPORTED_CURRENCIES])
  ).filter(Boolean);

  const selected = wallets.find((w) => w.currency === currency);
  const available = selected ? Number(selected.balance || 0) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(null);

    const value = Number(amount);
    if (!merchantId.trim()) return setError("Merchant ID is required");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter a valid amount");
    if (!apiKey.trim()) return setError("Provider API key is required");
    if (!secretKey.trim()) return setError("Provider secret key is required");
    if (available && value > available) return setError(`Insufficient balance. Available ${money(available, currency)}`);

    setSubmitting(true);
    try {
      const res = await portalCallProvider({
        merchantId: merchantId.trim(),
        amountMinor: Math.round(value * 100),
        currency,
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
        requestReference: newRequestReference(),
        reason: reason.trim() || undefined,
      });
      setSuccess({
        reference: res.reference,
        amount: Number(res.amount ?? value),
        currency: res.currency || currency,
        merchantId: res.merchantId || merchantId.trim(),
      });
      setAmount("");
      setReason("");
      // refresh balances
      try {
        const w = await portalWallet();
        setWallets(w.wallets || []);
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      setError(err.message || "Provider transfer failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">C2M — Pay a merchant</h1>
        <p className="text-sm text-slate-500 mt-1">
          Customer to Merchant: calls your payment provider endpoint to collect the funds and settle them to the merchant.
        </p>
      </div>

      {success && (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          Paid {money(success.amount, success.currency)} to <span className="font-mono font-semibold">{success.merchantId}</span>.
          Reference <span className="font-mono font-semibold">{success.reference}</span>
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Merchant ID</label>
          <input
            type="text"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            placeholder="MRC-1001"
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono tracking-wide"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Amount</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none bg-white"
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          {loadingWallets ? "Loading balance…" : `Available: ${money(available, currency)}`}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Provider API key</label>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pk_live_..."
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Provider secret key</label>
          <input
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="sk_live_..."
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Used to sign the pull request (HMAC-SHA512). Your provider endpoint is configured on the server.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's this payment for?"
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold transition"
        >
          {submitting ? "Calling provider…" : "CALL THE PROVIDER"}
        </button>
      </form>
    </div>
  );
}
