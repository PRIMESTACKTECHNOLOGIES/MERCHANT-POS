import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { customerLogin } from "../../lib/customerApi";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

export function CustomerLoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [walletCode, setWalletCode] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await customerLogin(walletCode.trim(), pin.trim());
      navigate("/portal/overview", { replace: true });
    } catch (err: any) {
      setError(err.message || t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-20">
        <LanguageSwitcher variant="icon" className="bg-white shadow-md border border-slate-200" />
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-2xl font-bold mx-auto mb-3">
            C
          </div>
          <h1 className="text-xl font-bold text-slate-900">{t("auth.customerPortalTitle")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("auth.signInWithWallet")}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
          {error && (
            <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="walletCode" className="block text-sm font-semibold text-slate-700 mb-1.5">
                {t("auth.walletCode")}
              </label>
              <input
                id="walletCode"
                type="text"
                autoComplete="username"
                required
                spellCheck={false}
                placeholder="PSW-1234-5678"
                value={walletCode}
                onChange={(e) => setWalletCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none font-mono tracking-wide uppercase"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                {t("auth.walletCodeHint")}
              </p>
            </div>

            <div>
              <label htmlFor="pin" className="block text-sm font-semibold text-slate-700 mb-1.5">
                {t("common.pin")}
              </label>
              <div className="relative">
                <input
                  id="pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  autoComplete="current-password"
                  required
                  maxLength={6}
                  placeholder={t("auth.pinPlaceholder")}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full px-4 py-3 pr-12 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none tracking-[0.3em]"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  title={showPin ? `${t("common.hide")} ${t("common.pin")}` : `${t("common.show")} ${t("common.pin")}`}
                >
                  {showPin ? t("common.hide") : t("common.show")}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold transition"
            >
              {loading ? t("auth.signingIn") : t("auth.continue")}
            </button>
          </form>
        </div>

        <div className="text-center mt-6 text-sm text-slate-500">
          {t("auth.merchantQuestion")}{" "}
          <Link to="/login" className="text-blue-600 font-semibold hover:underline">
            {t("auth.goToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}
