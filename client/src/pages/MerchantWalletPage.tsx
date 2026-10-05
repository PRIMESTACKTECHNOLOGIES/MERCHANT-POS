import { useState, useEffect } from "react";
import { Eye, EyeOff, RefreshCw, Send } from "lucide-react";
import { resolveApiBaseUrl } from "../lib/backendUrl";

const API = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });

interface MerchantWallet {
  balance: number | string;
  currency: string;
}

interface MerchantTransaction {
  id?: string;
  created_at?: string;
  type?: string;
  amount?: number | string;
  reference?: string;
  description?: string;
  currency?: string;
  source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function apiFetch(path: string, options?: RequestInit): Promise<unknown> {
  const token = localStorage.getItem("token") || localStorage.getItem("jwt_token");
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options?.headers || {}) },
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = isRecord(body)
      ? typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : `Error ${res.status}`
      : `Error ${res.status}`;
    throw new Error(message);
  }
  return body;
}

function getMerchantId() {
  try { return JSON.parse(localStorage.getItem("settings") || "{}").merchant_id || "MRC-1001"; } catch { return "MRC-1001"; }
}

export function MerchantWalletPage() {
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wallet, setWallet] = useState<MerchantWallet | null>(null);
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [error, setError] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendAmount, setSendAmount] = useState("");
  const [sendMsg, setSendMsg] = useState("");
  const merchantId = getMerchantId();

  const load = async () => {
    setLoading(true); setError("");
    try {
      const walletData = await apiFetch(`/wallet/merchant-balance/${encodeURIComponent(merchantId)}`);
      if (!isRecord(walletData) ||
          (typeof walletData.balance !== "number" && typeof walletData.balance !== "string")) {
        throw new Error("Invalid merchant wallet response");
      }
      const currency = typeof walletData.currency === "string" ? walletData.currency : "USD";
      setWallet({
        balance: walletData.balance,
        currency,
      });

      const transactionData = await apiFetch(`/wallet/merchant-transactions/${encodeURIComponent(merchantId)}?currency=${encodeURIComponent(currency)}`);
      const rows = Array.isArray(transactionData)
        ? transactionData
        : isRecord(transactionData) && Array.isArray(transactionData.transactions)
          ? transactionData.transactions
          : [];
      setTransactions(rows.filter(isRecord).map((row): MerchantTransaction => ({
        id: typeof row.id === "string" ? row.id : undefined,
        created_at: typeof row.created_at === "string" ? row.created_at : undefined,
        type: typeof row.type === "string" ? row.type : undefined,
        amount: typeof row.amount === "number" || typeof row.amount === "string" ? row.amount : undefined,
        reference: typeof row.reference === "string" ? row.reference : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        currency: typeof row.currency === "string" ? row.currency : undefined,
        source: typeof row.source === "string" ? row.source : undefined,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  };

  const sendToVault = async () => {
    const amt = Number(sendAmount);
    if (!amt || amt <= 0) { setSendMsg("Enter a valid amount"); return; }
    setSendBusy(true); setSendMsg("");
    try {
      await apiFetch("/api/vault/merchant-transfer", {
        method: "POST",
        body: JSON.stringify({ merchantId, amount: amt, currency: wallet?.currency || "USD" }),
      });
      setSendMsg(`✅ $${amt.toFixed(2)} sent to Vault Bank`);
      setSendAmount("");
      await load();
    } catch (e) { setSendMsg(e instanceof Error ? e.message : "Transfer failed"); }
    finally { setSendBusy(false); }
  };

  // Load data on mount so it's ready when revealed
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merchant Wallet</h1>
          <p className="text-sm text-gray-500 mt-1">Merchant ID: <span className="font-mono font-bold">{merchantId}</span></p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 shadow-sm">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-semibold">{error}</div>}

      {/* Balance Card — hidden until revealed */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-bold text-gray-900">Balance</h2>
          <button
            onClick={() => { if (!wallet && !revealed) void load(); setRevealed(v => !v); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            {revealed ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Reveal Balance</>}
          </button>
        </div>
        <div className="px-6 py-8 text-center">
          {!revealed ? (
            <div>
              <div className="text-5xl font-black text-gray-200 tracking-widest mb-2">••••••</div>
              <p className="text-sm text-gray-400">Click Reveal Balance to view</p>
            </div>
          ) : loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : wallet ? (
            <div>
              <div className="text-4xl font-black text-gray-900 mb-1">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: wallet.currency || "USD" }).format(Number(wallet.balance || 0))}
              </div>
              <p className="text-sm text-gray-500 font-medium">{wallet.currency || "USD"} · Merchant {merchantId}</p>
            </div>
          ) : (
            <div className="text-sm text-gray-400">No wallet data</div>
          )}
        </div>
      </div>

      {/* Send to Vault Bank — only shown when revealed */}
      {revealed && wallet && (
        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm">
          <div className="border-b border-emerald-100 px-5 py-3">
            <h3 className="font-bold text-emerald-900 text-sm">Send to Vault Bank</h3>
          </div>
          <div className="p-5 flex gap-3">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={sendAmount}
              onChange={e => setSendAmount(e.target.value)}
              placeholder={`Max ${Number(wallet.balance || 0).toFixed(2)}`}
              className="flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <button
              onClick={() => void sendToVault()}
              disabled={sendBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send size={14} /> {sendBusy ? "Sending…" : "Send"}
            </button>
          </div>
          {sendMsg && <p className="px-5 pb-4 text-sm font-semibold text-emerald-800">{sendMsg}</p>}
        </div>
      )}

      {/* Recent Transactions — only shown when revealed */}
      {revealed && transactions.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="font-bold text-gray-900 text-sm">Recent Transactions</h3>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-left">Reference</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 15).map((t, i) => (
                <tr key={t.id || i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-xs text-gray-500">{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${t.type === "credit" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {String(t.type || "—").toUpperCase()}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${t.type === "credit" ? "text-emerald-700" : "text-red-700"}`}>
                    {t.type === "credit" ? "+" : "-"}{new Intl.NumberFormat("en-US", { style: "currency", currency: t.currency || "USD" }).format(Number(t.amount || 0))}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-mono truncate max-w-[160px]">{t.reference || t.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
