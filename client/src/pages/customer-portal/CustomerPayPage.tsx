import { useState } from "react";
import { processEMVOffline, type EMVResult } from "../../lib/emv/emv-pos-bridge";
import { getCustomerProfile, portalPayWithCard, type PortalCardChargeResult } from "../../lib/customerApi";

type Phase = "form" | "processing" | "result";

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : digits.slice(0, 2) + "/" + digits.slice(2);
}

function formatPAN(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

export function CustomerPayPage() {
  const profile = getCustomerProfile();

  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [merchantId, setMerchantId] = useState("");

  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [result, setResult] = useState<EMVResult | null>(null);
  const [collected, setCollected] = useState<PortalCardChargeResult | null>(null);
  const [collecting, setCollecting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCollected(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter a valid amount");
    if (!merchantId.trim()) return setError("Enter the merchant ID you are paying");
    const cleanPan = pan.replace(/\s/g, "");
    if (cleanPan.length < 13 || !expiry || !cvv) return setError("Enter valid card details");

    setPhase("processing");
    try {
      const res = await processEMVOffline(
        { pan: cleanPan, expiry, cvv, pin: pin || undefined },
        value,
        currency,
        "WEB-PORTAL-001",
        undefined,
        undefined,
        profile?.id
      );
      setResult(res);
      setPhase("result");

      // Local EMV only decides offline; the funds are collected by submitting the
      // charge to the backend. ARQC needs the same online call the TC does.
      if (res.approved || res.requiresOnline) {
        setCollecting(true);
        try {
          const charge = await portalPayWithCard({
            merchantId: merchantId.trim(),
            amountMinor: Math.round(value * 100),
            currency,
            pan: cleanPan,
            expiry,
            cvv,
            emv: {
              cryptogramType: res.decision,
              cryptogram: res.cryptogram,
              atc: res.atc,
              tvr: res.tvr,
              tsi: res.tsi,
            },
            stan: res.stan,
            terminalId: "WEB-PORTAL-001",
            entryMode: "CHIP",
          });
          setCollected(charge);
        } catch (err: any) {
          setCollected({ success: false, status: "ERROR", error: err?.message || "Collection failed" });
        } finally {
          setCollecting(false);
        }
      }
    } catch (err: any) {
      setError(err.message || "Processing error");
      setPhase("form");
    }
  };

  const reset = () => {
    setResult(null);
    setCollected(null);
    setError("");
    setAmount("");
    setPan("");
    setExpiry("");
    setCvv("");
    setPin("");
    setMerchantId("");
    setPhase("form");
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Make a payment</h1>
        <p className="text-sm text-slate-500 mt-1">Pay securely through the card processor.</p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {phase === "result" && result && (
        <div className={`rounded-xl border p-6 shadow-sm ${result.approved ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <div className={`text-lg font-bold ${result.approved ? "text-emerald-700" : "text-red-700"}`}>
            {result.approved ? "Payment approved" : result.requiresOnline ? "Online required" : "Payment declined"}
          </div>
          <div className="text-sm text-slate-600 mt-2">
            {currency} {Number(amount || 0).toFixed(2)} · {result.cardBrand} •••• {result.cardLast4}
          </div>
          {result.approved && result.authCode && (
            <div className="text-sm text-slate-600 mt-1">
              Auth code: <span className="font-mono font-semibold">{result.authCode}</span>
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            {result.reason} {result.stan ? `· STAN ${result.stan}` : ""}
          </div>

          {(collecting || collected) && (
            <div className="mt-3 pt-3 border-t border-slate-200/70 text-sm">
              {collecting ? (
                <div className="text-slate-600">Collecting funds…</div>
              ) : collected?.status === "APPROVED" ? (
                <div className="text-emerald-800">
                  <div className="font-semibold">Funds collected</div>
                  <div className="text-xs mt-1">{collected.reason}</div>
                  {collected.paymentIntentId && (
                    <div className="text-xs mt-1 font-mono">{collected.paymentIntentId}</div>
                  )}
                  <div className="text-xs mt-2 text-slate-600">
                    Use <span className="font-semibold">C2M</span> to move them to the merchant.
                  </div>
                </div>
              ) : (
                <div className="text-red-800">
                  <div className="font-semibold">Funds not collected ({collected?.status})</div>
                  <div className="text-xs mt-1">{collected?.error || collected?.reason}</div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={reset}
            className="mt-4 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold transition"
          >
            New payment
          </button>
        </div>
      )}

      {phase !== "result" && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
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
                {["USD", "AED", "EUR", "GBP"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

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

          <div className="border-t border-slate-100 pt-5">
            <div className="text-sm font-semibold text-slate-700 mb-3">Card details</div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Card number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={23}
                  value={pan}
                  onChange={(e) => setPan(formatPAN(e.target.value))}
                  placeholder="1234 5678 9012 3456"
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono tracking-wide"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Expiry</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/YY"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">CVV</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="•••"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                  />
                </div>
              </div>

              {showPin ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Card PIN (optional)</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="4-digit PIN"
                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono tracking-widest"
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setShowPin(true)} className="text-sm text-blue-600 font-semibold">
                  + Add card PIN (optional)
                </button>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={phase === "processing"}
            className="w-full py-3 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold transition"
          >
            {phase === "processing" ? "Processing…" : `Pay ${currency} ${Number(amount || 0).toFixed(2)}`}
          </button>
        </form>
      )}
    </div>
  );
}
