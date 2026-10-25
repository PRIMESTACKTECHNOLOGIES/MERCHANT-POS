import { useEffect, useState } from "react";
import { portalSend, portalWallet, portalRecipients, type PortalWallet, type PortalRecipient } from "../../lib/customerApi";

/** Currencies the wallet rails support; used so the picker is never limited to one option. */
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "AED", "ZAR", "KES", "NGN"];

function money(amount: number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "USD"} ${n.toFixed(2)}`;
  }
}

export function CustomerSendPage() {
  const [wallets, setWallets] = useState<PortalWallet[]>([]);
  const [recipients, setRecipients] = useState<PortalRecipient[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(true);

  const [receiverWalletCode, setReceiverWalletCode] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ reference: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await portalWallet();
        if (!active) return;
        setWallets(res.wallets || []);
        if (res.wallets?.length) setCurrency(res.wallets[0].currency);
      } catch {
        /* balance is informational; the send call validates funds */
      } finally {
        if (active) setLoadingWallets(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await portalRecipients();
        if (active) setRecipients(res || []);
      } catch {
        /* recent recipients are a convenience only */
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
    if (!receiverWalletCode.trim()) return setError("Recipient wallet code is required");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter a valid amount");
    if (available && value > available) return setError(`Insufficient balance. Available ${money(available, currency)}`);

    setSubmitting(true);
    try {
      const res = await portalSend({
        receiverWalletCode: receiverWalletCode.trim().toUpperCase(),
        amount: value,
        currency,
        note: note.trim() || undefined,
      });
      setSuccess({ reference: res.reference, amount: res.amount, currency: res.currency });
      setReceiverWalletCode("");
      setAmount("");
      setNote("");
      // refresh balances
      try {
        const w = await portalWallet();
        setWallets(w.wallets || []);
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      setError(err.message || "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Send funds</h1>
        <p className="text-sm text-slate-500 mt-1">Transfer to another customer using their wallet code.</p>
      </div>

      {success && (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          Sent {money(success.amount, success.currency)}. Reference <span className="font-mono font-semibold">{success.reference}</span>
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Recipient wallet code</label>
          <input
            type="text"
            list="portal-recipients"
            value={receiverWalletCode}
            onChange={(e) => setReceiverWalletCode(e.target.value.toUpperCase())}
            placeholder="PSW-1234-5678"
            spellCheck={false}
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono tracking-wide"
          />
          <datalist id="portal-recipients">
            {recipients.map((r) => (
              <option key={r.wallet_code} value={r.wallet_code}>
                {r.name || r.wallet_code}
              </option>
            ))}
          </datalist>
          {recipients.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {recipients.slice(0, 5).map((r) => (
                <button
                  key={r.wallet_code}
                  type="button"
                  onClick={() => setReceiverWalletCode(r.wallet_code)}
                  className="text-xs px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono transition"
                >
                  {r.wallet_code}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-1.5">
              Tip: pick from the list once you have sent to someone before.
            </p>
          )}
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
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Note <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's this for?"
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold transition"
        >
          {submitting ? "Sending…" : "Send funds"}
        </button>
      </form>
    </div>
  );
}
