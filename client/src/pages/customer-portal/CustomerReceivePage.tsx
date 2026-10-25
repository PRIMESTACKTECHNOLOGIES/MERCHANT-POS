import { useEffect, useState } from "react";
import { portalReceive, type PortalWallet, type PortalCryptoWallet } from "../../lib/customerApi";

function money(amount: number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency || "USD"} ${n.toFixed(2)}`;
  }
}

/**
 * navigator.clipboard needs a secure context and permission, which fails on plain
 * http (e.g. a LAN IP). Fall back to a hidden textarea + execCommand so Copy works
 * everywhere. Returns whether the value actually reached the clipboard.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function CopyField({ label, value, qr }: { label: string; value: string; qr?: string | null }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async () => {
    const ok = await copyText(value);
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied("idle"), 1500);
  };
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <code className="flex-1 text-sm font-mono text-slate-800 break-all">{value}</code>
        <button
          onClick={copy}
          className="shrink-0 text-xs px-3 py-2 sm:py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
        >
          {copied === "ok" ? "Copied" : copied === "fail" ? "Select & copy" : "Copy"}
        </button>
      </div>
      {qr && (
        <div className="mt-3 flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
          <img src={qr} alt={`QR code for ${value}`} className="w-32 h-32 border border-slate-200 rounded-md bg-white" />
          <div className="text-xs text-slate-500">Scan to get this wallet code.</div>
        </div>
      )}
    </div>
  );
}

export function CustomerReceivePage() {
  const [wallets, setWallets] = useState<PortalWallet[]>([]);
  const [crypto, setCrypto] = useState<PortalCryptoWallet[]>([]);
  const [pin, setPin] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await portalReceive();
        if (!active) return;
        setWallets(res.wallets || []);
        setCrypto(res.cryptoWallets || []);
        setPin(res.portal_pin || null);
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

  if (loading) return <div className="text-slate-500">Loading receive details…</div>;
  if (error) return <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Receive funds</h1>
        <p className="text-sm text-slate-500 mt-1">Share these details so others can send you funds.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Wallet codes</h2>
        {wallets.length === 0 && <div className="text-sm text-slate-500">No wallet yet.</div>}
        {wallets.map((w, i) => (
          <CopyField
            key={w.id || `${w.currency}-${i}`}
            label={`${w.currency} wallet`}
            value={w.wallet_code || "—"}
            qr={w.qr_data_url}
          />
        ))}
        {pin && <CopyField label="Portal PIN (for login)" value={pin} />}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Crypto deposit addresses</h2>
        {crypto.length === 0 ? (
          <div className="text-sm text-slate-500">
            No crypto deposit address assigned yet. Ask your merchant to enable a coin for this wallet —
            the address appears here once it is issued.
          </div>
        ) : (
          crypto.map((c, i) => (
            <CopyField
              key={c.id || `${c.crypto_coin}-${i}`}
              label={`${c.crypto_coin} ${c.crypto_address ? "" : "(address pending)"}`}
              value={c.crypto_address || "Not assigned yet"}
            />
          ))
        )}
      </div>

      {wallets.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Current balances</h2>
          <div className="space-y-2">
            {wallets.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{w.currency}</span>
                <span className="font-semibold tabular-nums text-slate-800">{money(Number(w.balance || 0), w.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
