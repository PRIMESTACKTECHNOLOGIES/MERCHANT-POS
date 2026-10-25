import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getPortalOverview,
  type PortalOverview,
  type PortalTransaction,
} from "../../lib/customerApi";

function money(amount: number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "USD"} ${n.toFixed(2)}`;
  }
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function CustomerOverviewPage() {
  const [data, setData] = useState<PortalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getPortalOverview();
        if (active) setData(res);
      } catch (e: any) {
        if (active) setError(e.message || "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <div className="text-slate-500">Loading your account…</div>;
  if (error) return <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const totalByCurrency = new Map<string, number>();
  for (const w of data.wallets || []) {
    totalByCurrency.set(w.currency, (totalByCurrency.get(w.currency) || 0) + Number(w.balance || 0));
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Hi, {(data.profile.name || "there").split(" ")[0]}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {data.profile.wallet_code ? `Wallet ${data.profile.wallet_code}` : "Your personal wallet"}
        </p>
      </div>

      {/* Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {totalByCurrency.size === 0 && (
          <div className="col-span-full bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-500">
            No wallet balance yet.
          </div>
        )}
        {[...totalByCurrency.entries()].map(([currency, balance]) => (
          <div key={currency} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{currency} Balance</div>
            <div className="text-2xl font-bold text-slate-900 mt-2">{money(balance, currency)}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Link to="/portal/send" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-3 sm:p-4 text-center text-sm sm:text-base font-semibold transition">
          Send
        </Link>
        <Link to="/portal/receive" className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl p-3 sm:p-4 text-center text-sm sm:text-base font-semibold transition">
          Receive
        </Link>
        <Link to="/portal/pay" className="bg-slate-800 hover:bg-slate-900 text-white rounded-xl p-3 sm:p-4 text-center text-sm sm:text-base font-semibold transition">
          Pay
        </Link>
      </div>

      {/* Recent transactions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Recent activity</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {(data.recentTransactions || []).length === 0 && (
            <div className="px-5 py-6 text-sm text-slate-500">No transactions yet.</div>
          )}
          {(data.recentTransactions || []).map((t: PortalTransaction) => (
            <div key={t.id} className="px-5 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {t.description || t.source || "Transaction"}
                </div>
                <div className="text-xs text-slate-400">{timeAgo(t.created_at)}</div>
              </div>
              <div className={`text-sm font-semibold tabular-nums ${t.type === "credit" ? "text-emerald-600" : "text-slate-700"}`}>
                {t.type === "credit" ? "+" : "−"}
                {money(Number(t.amount || 0), t.currency || "USD")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
