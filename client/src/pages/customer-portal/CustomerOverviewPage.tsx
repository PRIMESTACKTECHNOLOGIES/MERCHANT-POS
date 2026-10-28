import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
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

function isCredit(t: PortalTransaction) {
  return String(t.type || "").toLowerCase() === "credit";
}

export function CustomerOverviewPage() {
  const { t } = useTranslation();
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

  const wallets = data.wallets || [];
  const cryptoWallets = data.cryptoWallets || [];
  const transactions = data.recentTransactions || [];

  // Balances and the recent in/out totals are grouped per currency: adding USD
  // to AED would be meaningless, so every figure stays in its own currency.
  const byCurrency = new Map<string, { balance: number; in: number; out: number; walletCode?: string }>();
  for (const w of wallets) {
    const ccy = w.currency || "USD";
    const entry = byCurrency.get(ccy) || { balance: 0, in: 0, out: 0, walletCode: undefined };
    entry.balance += Number(w.balance || 0);
    if (!entry.walletCode && w.wallet_code) entry.walletCode = w.wallet_code;
    byCurrency.set(ccy, entry);
  }
  for (const tx of transactions) {
    // Only fold activity into a currency the customer actually holds, so the
    // cards never show a phantom "USD Balance $0.00".
    const entry = byCurrency.get(tx.currency || "USD");
    if (!entry) continue;
    const amount = Number(tx.amount || 0);
    if (isCredit(tx)) entry.in += amount;
    else entry.out += amount;
  }

  const cryptoByCoin = new Map<string, number>();
  for (const c of cryptoWallets) {
    const coin = c.crypto_coin || "CRYPTO";
    cryptoByCoin.set(coin, (cryptoByCoin.get(coin) || 0) + Number(c.balance || 0));
  }

  const kyc = String(data.profile.kyc_status || "").toLowerCase();
  const verified = kyc === "verified" || kyc === "approved";
  const firstName = (data.profile.name || "").split(" ")[0] || t("portal.customer");

  const actions = [
    { to: "/portal/send", label: t("portal.sendMoney"), primary: true },
    { to: "/portal/receive", label: t("portal.receiveMoney"), primary: false },
    { to: "/portal/processor", label: t("portal.processor"), primary: false },
    { to: "/portal/c2m", label: t("portal.c2m"), primary: false },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Greeting + account state */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Hi, {firstName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t("portal.personalWalletAccess")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              verified
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            {verified ? t("portal.kycVerified") : t("portal.kycPending")}
          </span>
          {!data.profile.pin_set && (
            <Link
              to="/portal/profile"
              className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-700 border-red-200"
            >
              Set your PIN
            </Link>
          )}
        </div>
      </div>

      {!verified && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span>{t("portal.kycPending")} — add your details to unlock every rail.</span>
          <Link to="/portal/profile" className="font-semibold underline">
            {t("portal.profile")}
          </Link>
        </div>
      )}

      {/* Balances, with the recent in/out for the same currency */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {byCurrency.size === 0 && (
          <div className="col-span-full bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-500">
            No wallet balance yet.
          </div>
        )}
        {[...byCurrency.entries()].map(([currency, entry]) => (
          <div key={currency} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {currency} {t("portal.walletBalance")}
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-2">{money(entry.balance, currency)}</div>
            {entry.walletCode && (
              <div className="mt-1 text-xs font-mono text-slate-400">{entry.walletCode}</div>
            )}
            {(entry.in > 0 || entry.out > 0) && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                  {t("portal.recentActivity")}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-600 font-semibold">
                    {t("portal.totalIn")} +{money(entry.in, currency)}
                  </span>
                  <span className="text-slate-500 font-semibold">
                    {t("portal.totalOut")} −{money(entry.out, currency)}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Crypto holdings */}
      {cryptoByCoin.size > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...cryptoByCoin.entries()].map(([coin, balance]) => (
            <div key={coin} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{coin}</div>
              <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">
                {Number(balance).toLocaleString("en-US", { maximumFractionDigits: 8 })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">{t("portal.quickActions")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
          {actions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className={`rounded-xl p-3 sm:p-4 text-center text-sm sm:text-base font-semibold transition ${
                a.primary
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-slate-800 hover:bg-slate-900 text-white"
              }`}
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">{t("portal.recentActivity")}</h2>
          <Link to="/portal/send" className="text-xs font-semibold text-blue-600 hover:underline">
            {t("portal.sendMoney")}
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {transactions.length === 0 && (
            <div className="px-5 py-6 text-sm text-slate-500">No transactions yet.</div>
          )}
          {transactions.map((tx) => (
            <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {tx.description || tx.source || "Transaction"}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {timeAgo(tx.created_at)}
                  {tx.reference ? ` · ${tx.reference}` : ""}
                  {tx.status ? ` · ${tx.status}` : ""}
                </div>
              </div>
              <div
                className={`text-sm font-semibold tabular-nums shrink-0 ${
                  isCredit(tx) ? "text-emerald-600" : "text-slate-700"
                }`}
              >
                {isCredit(tx) ? "+" : "−"}
                {money(Number(tx.amount || 0), tx.currency || "USD")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
