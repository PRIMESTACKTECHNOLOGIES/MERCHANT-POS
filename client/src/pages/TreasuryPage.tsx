import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/ui/toastContext";
import { resolveApiBaseUrl } from "../lib/backendUrl";

/**
 * Treasury desk — provider-backed funds verification and statements/reports.
 *
 * Every engine behind these tabs fails closed when the provider is not
 * configured (PROVIDER_ENDPOINT_URL / PROVIDER_API_KEY / PROVIDER_SECRET_KEY).
 * A configured system always makes a real signed call to the provider.
 */

type Tab = "provider" | "verifier" | "statements" | "realfunds" | "reserve" | "settlement" | "emi";

const money = (value: unknown, currency = "USD") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

const Badge = ({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) => {
  const tones: Record<string, string> = {
    ok: "bg-green-100 text-green-800",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-800",
    muted: "bg-gray-100 text-gray-700",
  };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
    <p className="mt-2 text-2xl font-bold text-gray-900 break-words">{value}</p>
    {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
  </div>
);

const Panel = ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 bg-gray-50">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
    {label}
    {children}
  </label>
);

const inputCls = "border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500";

// Credentials the Treasury UI can set at runtime. A saved value overrides the
// same environment variable; leaving a field blank keeps the env fallback.
const PROVIDER_CRED_FIELDS: {
  group: string;
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
}[] = [
  { group: "Treasury provider", key: "PROVIDER_ENDPOINT_URL", label: "Endpoint URL", placeholder: "https://api.yourprovider.com" },
  { group: "Treasury provider", key: "PROVIDER_API_KEY", label: "API key", placeholder: "provider api key" },
  { group: "Treasury provider", key: "PROVIDER_SECRET_KEY", label: "Secret key", placeholder: "provider secret key" },
  { group: "Treasury provider", key: "PROVIDER_AUTH_SCHEME", label: "Auth scheme", options: ["hmac", "bearer"] },
  { group: "Treasury provider", key: "PROVIDER_SIGNATURE_ALGORITHM", label: "Signature algorithm", options: ["sha256", "sha512"] },
  { group: "Treasury provider", key: "PROVIDER_TIMEOUT_MS", label: "Timeout (ms)", placeholder: "20000" },
  { group: "Global server (real funds)", key: "GLOBAL_SERVER_URL", label: "Base URL", placeholder: "https://global.yourprovider.com" },
  { group: "Global server (real funds)", key: "GLOBAL_API_KEY", label: "API key", placeholder: "global api key" },
  { group: "Global server (real funds)", key: "GLOBAL_API_SECRET", label: "API secret", placeholder: "global api secret" },
  { group: "C2M provider pull", key: "CUSTOMER_WALLET_PROVIDER_URL", label: "Provider pull URL", placeholder: "https://provider.example.com/v1/pull" },
  { group: "C2M provider pull", key: "CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS", label: "Allowed hosts", placeholder: "payments.example.com" },
];


export function TreasuryPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("provider");
  const [busy, setBusy] = useState(false);

  const apiBase = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });
  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${localStorage.getItem("token") || ""}`, "Content-Type": "application/json" }),
    [],
  );

  // ── Provider status ────────────────────────────────────────────────────────
  const [providerStatus, setProviderStatus] = useState<any>(null);

  const loadProvider = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/treasury/provider/status`, { headers: authHeaders() });
      const body = await res.json();
      setProviderStatus(body?.data ?? null);
    } catch {
      setProviderStatus(null);
    }
  }, [apiBase, authHeaders]);

  useEffect(() => { loadProvider(); }, [loadProvider]);

  // ── Provider credentials (UI values override the environment) ──────────────
  const [configItems, setConfigItems] = useState<any[]>([]);
  const [credForm, setCredForm] = useState<Record<string, string>>({});

  const loadProviderConfig = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/treasury/provider/config`, { headers: authHeaders() });
      const body = await res.json();
      setConfigItems(body?.data?.items ?? []);
    } catch {
      setConfigItems([]);
    }
  }, [apiBase, authHeaders]);

  useEffect(() => { loadProviderConfig(); }, [loadProviderConfig]);

  const sourceOf = (key: string) => configItems.find((i) => i.key === key);

  const saveProviderCredentials = async () => {
    const values: Record<string, string> = {};
    Object.entries(credForm).forEach(([k, v]) => {
      if (String(v).trim()) values[k] = String(v).trim();
    });
    if (!Object.keys(values).length) {
      showToast("Enter at least one credential to save", "error");
      return;
    }
    setBusy(true);
    try {
      const data = await call("/api/treasury/provider/config", {
        method: "PUT",
        body: JSON.stringify({ values }),
      });
      setConfigItems(data?.items ?? []);
      setCredForm({});
      await loadProvider();
      showToast(`Saved ${data?.saved?.length ?? 0} credential(s) — live now`, "success");
    } catch (err: any) {
      showToast(`Save failed: ${err?.message ?? String(err)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        const detail = body?.missing?.length ? ` (missing: ${body.missing.join(", ")})` : "";
        throw new Error(`${body?.error || `HTTP ${res.status}`}: ${body?.message || "request failed"}${detail}`);
      }
      return body.data;
    },
    [apiBase, authHeaders],
  );

  // Report download / print. Reports are authenticated, so fetch then stream.
  const openReport = async (path: string, format: "csv" | "html", filename: string) => {
    try {
      const res = await fetch(`${apiBase}${path}${path.includes("?") ? "&" : "?"}format=${format}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      if (format === "html") {
        const html = await res.text();
        const win = window.open("", "_blank");
        if (win) { win.document.write(html); win.document.close(); }
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${filename}.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      showToast(`Export failed: ${err?.message ?? String(err)}`, "error");
    }
  };

  // ── Funds auto verifier ────────────────────────────────────────────────────
  const [verifierStatus, setVerifierStatus] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [lastRun, setLastRun] = useState<any>(null);

  const loadVerifier = useCallback(async () => {
    try {
      const [status, cands] = await Promise.all([
        call("/api/treasury/funds-verifier/status"),
        call("/api/treasury/funds-verifier/candidates?limit=200"),
      ]);
      setVerifierStatus(status);
      setCandidates(Array.isArray(cands) ? cands : []);
    } catch (err: any) {
      showToast(`Verifier load failed: ${err?.message ?? String(err)}`, "error");
    }
  }, [call, showToast]);

  useEffect(() => { if (tab === "verifier") loadVerifier(); }, [tab, loadVerifier]);

  const runVerifier = async () => {
    setBusy(true);
    try {
      const result = await call("/api/treasury/funds-verifier/run", {
        method: "POST",
        body: JSON.stringify({ initiatedBy: "treasury-ui" }),
      });
      setLastRun(result);
      showToast(`Run complete: ${result.verified} verified, ${result.failed} failed`, "success");
      await loadVerifier();
    } catch (err: any) {
      showToast(String(err?.message ?? err), "error");
    } finally {
      setBusy(false);
    }
  };

  // ── Bank statements ────────────────────────────────────────────────────────
  const [statements, setStatements] = useState<any[]>([]);
  const [statementForm, setStatementForm] = useState({ accountId: "", currency: "USD", from: "", to: "", format: "AUTO" });
  const [uploadText, setUploadText] = useState("");
  const [selectedStatement, setSelectedStatement] = useState<any>(null);
  const [statementLines, setStatementLines] = useState<any[]>([]);

  const loadStatements = useCallback(async () => {
    try {
      const rows = await call("/api/treasury/bank-statements?limit=50");
      setStatements(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      showToast(`Statement load failed: ${err?.message ?? String(err)}`, "error");
    }
  }, [call, showToast]);

  useEffect(() => { if (tab === "statements") loadStatements(); }, [tab, loadStatements]);

  const processUpload = async () => {
    if (!uploadText.trim()) { showToast("Paste a statement or choose a file first", "error"); return; }
    setBusy(true);
    try {
      const result = await call("/api/treasury/bank-statements/process", {
        method: "POST",
        body: JSON.stringify({
          content: uploadText,
          format: statementForm.format === "AUTO" ? undefined : statementForm.format,
          accountId: statementForm.accountId || undefined,
          currency: statementForm.currency || undefined,
        }),
      });
      showToast(`Imported ${result.lineCount} lines (${result.matched} matched)`, "success");
      setUploadText("");
      await loadStatements();
    } catch (err: any) {
      showToast(String(err?.message ?? err), "error");
    } finally {
      setBusy(false);
    }
  };

  const fetchFromProvider = async () => {
    setBusy(true);
    try {
      const result = await call("/api/treasury/bank-statements/fetch", {
        method: "POST",
        body: JSON.stringify({
          accountId: statementForm.accountId || undefined,
          currency: statementForm.currency || undefined,
          from: statementForm.from || undefined,
          to: statementForm.to || undefined,
          format: statementForm.format === "AUTO" ? undefined : statementForm.format,
        }),
      });
      showToast(`Fetched ${result.lineCount} lines from provider`, "success");
      await loadStatements();
    } catch (err: any) {
      showToast(String(err?.message ?? err), "error");
    } finally {
      setBusy(false);
    }
  };

  const openStatement = async (statement: any) => {
    setSelectedStatement(statement);
    try {
      const lines = await call(`/api/treasury/bank-statements/${encodeURIComponent(statement.id)}/lines`);
      setStatementLines(Array.isArray(lines) ? lines : []);
    } catch (err: any) {
      showToast(`Line load failed: ${err?.message ?? String(err)}`, "error");
    }
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadText(String(reader.result || ""));
    reader.readAsText(file);
  };

  // ── Real funds (Global Server) ──────────────────────────────────────────────
  const [realFunds, setRealFunds] = useState<any>(null);
  const [settleResult, setSettleResult] = useState<any>(null);
  const [settleForm, setSettleForm] = useState({
    sessionId: "", cardRef: "", amountMinor: "", currency: "USD", authCode: "",
    bankName: "", iban: "", swift: "",
  });

  const loadRealFunds = useCallback(async () => {
    try {
      setRealFunds(await call("/api/treasury/real-funds/status"));
    } catch (err: any) {
      showToast(`Real funds load failed: ${err?.message ?? String(err)}`, "error");
    }
  }, [call, showToast]);

  useEffect(() => { if (tab === "realfunds") loadRealFunds(); }, [tab, loadRealFunds]);

  const submitSettle = async () => {
    setBusy(true);
    setSettleResult(null);
    try {
      const result = await call("/api/treasury/real-funds/settle", {
        method: "POST",
        body: JSON.stringify({
          sessionId: settleForm.sessionId,
          cardRef: settleForm.cardRef,
          amountMinor: Number(settleForm.amountMinor),
          currency: settleForm.currency,
          authCode: settleForm.authCode,
          receiverBank: {
            bankName: settleForm.bankName,
            iban: settleForm.iban || undefined,
            swift: settleForm.swift || undefined,
          },
        }),
      });
      setSettleResult(result);
      showToast(`Real funds CONFIRMED · ${result.settlementId}`, "success");
      await loadRealFunds();
    } catch (err: any) {
      showToast(String(err?.message ?? err), "error");
    } finally {
      setBusy(false);
    }
  };

  // ── Reports ────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ from: "", to: "", currency: "USD", merchantId: "MRC-1001" });
  const [reserve, setReserve] = useState<any>(null);
  const [settlement, setSettlement] = useState<any>(null);
  const [emi, setEmi] = useState<any>(null);

  const query = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.currency) p.set("currency", filters.currency);
    if (filters.merchantId) p.set("merchantId", filters.merchantId);
    Object.entries(extra).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const loadReport = async (kind: Tab) => {
    setBusy(true);
    try {
      if (kind === "reserve") setReserve(await call(`/api/treasury/reports/reserve${query()}`));
      if (kind === "settlement") setSettlement(await call(`/api/treasury/reports/settlement${query()}`));
      if (kind === "emi") setEmi(await call(`/api/treasury/reports/emi-account-statement${query()}`));
    } catch (err: any) {
      showToast(`Report failed: ${err?.message ?? String(err)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "provider", label: "Provider" },
    { id: "verifier", label: "Funds Auto Verifier" },
    { id: "statements", label: "Bank Statements" },
    { id: "realfunds", label: "Real Funds" },
    { id: "reserve", label: "Reserve Report" },
    { id: "settlement", label: "Settlement Report" },
    { id: "emi", label: "EMI Statement" },
  ];

  const configured = Boolean(providerStatus?.configured);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Treasury</h1>
          <p className="mt-1 text-sm text-gray-500">
            Provider-backed fund verification, statement processing and settlement/reserve reporting.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {providerStatus ? (
            configured
              ? <Badge tone="ok">Provider configured</Badge>
              : <Badge tone="bad">Provider not configured</Badge>
          ) : <Badge tone="muted">Provider status unavailable</Badge>}
          <button onClick={loadProvider} className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === t.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Provider not configured.</strong> Set <code>PROVIDER_ENDPOINT_URL</code>, <code>PROVIDER_API_KEY</code> and{" "}
          <code>PROVIDER_SECRET_KEY</code> in the backend environment. Until then every engine run fails closed with{" "}
          <code>PROVIDER_NOT_CONFIGURED</code> and no funds are ever marked verified. Local reports still render from your own ledger.
          {providerStatus?.missing?.length ? <div className="mt-1">Missing: {providerStatus.missing.join(", ")}</div> : null}
        </div>
      )}

      {/* ── Provider tab ── */}
      {tab === "provider" && (
        <div className="space-y-6">
          <Panel title="Provider configuration">
            {!providerStatus ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Stat label="Configured" value={providerStatus.configured ? "Yes" : "No"} />
                <Stat label="Endpoint" value={providerStatus.endpointUrl || "—"} />
                <Stat label="Auth scheme" value={String(providerStatus.authScheme || "—").toUpperCase()} />
                <Stat label="Signature" value={String(providerStatus.signatureAlgorithm || "—").toUpperCase()} />
                <Stat label="Timeout" value={`${providerStatus.timeoutMs ?? "—"} ms`} />
                <Stat label="Key fingerprint" value={providerStatus.keyFingerprint || "—"} />
                {providerStatus.missing?.length ? (
                  <div className="md:col-span-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    Missing settings: {providerStatus.missing.join(", ")}
                  </div>
                ) : null}
                {providerStatus.lastError ? (
                  <div className="md:col-span-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Last provider error: {providerStatus.lastError}
                  </div>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel
            title="Provider & real-fund credentials"
            actions={
              <button
                onClick={saveProviderCredentials}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save credentials"}
              </button>
            }
          >
            <p className="text-sm text-gray-500 mb-4">
              Enter the provider credentials here to use them immediately. A value saved here overrides the
              same environment variable; leave a field blank to keep using the env value. Secrets are stored
              encrypted and only a masked fingerprint is shown.
            </p>
            <div className="space-y-6">
              {Array.from(new Set(PROVIDER_CRED_FIELDS.map((f) => f.group))).map((group) => (
                <div key={group} className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{group}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {PROVIDER_CRED_FIELDS.filter((f) => f.group === group).map((f) => {
                      const item = sourceOf(f.key);
                      const isSecret = f.key.includes("KEY") || f.key.includes("SECRET");
                      return (
                        <Field key={f.key} label={f.label}>
                          {f.options ? (
                            <select
                              className={inputCls}
                              value={credForm[f.key] ?? ""}
                              onChange={(e) => setCredForm({ ...credForm, [f.key]: e.target.value })}
                            >
                              <option value="">
                                {item?.displayValue ? `keep ${item.source} (${item.displayValue})` : "— not set —"}
                              </option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className={inputCls}
                              type={isSecret ? "password" : "text"}
                              value={credForm[f.key] ?? ""}
                              placeholder={item?.displayValue ? `current: ${item.displayValue} (${item.source})` : (f.placeholder || "")}
                              onChange={(e) => setCredForm({ ...credForm, [f.key]: e.target.value })}
                            />
                          )}
                          <span className="text-[11px] text-gray-400">
                            {item?.source === "ui" ? "Set on this page" : item?.source === "env" ? "From environment" : "Not set"}
                          </span>
                        </Field>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* ── Funds auto verifier tab ── */}
      {tab === "verifier" && (
        <div className="space-y-6">
          <Panel
            title="Verification status"
            actions={
              <>
                <button onClick={loadVerifier} className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50">Reload</button>
                <button onClick={runVerifier} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {busy ? "Running…" : "Run verification"}
                </button>
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Stat label="Candidates" value={String(candidates.length)} sub="Awaiting provider verification" />
              {(verifierStatus?.registrationCounts || []).map((row: any) => (
                <Stat key={row.status} label={String(row.status || "UNKNOWN")} value={String(row.count)} />
              ))}
            </div>
            {verifierStatus?.lastRun && (
              <p className="mt-4 text-xs text-gray-500">
                Last run: {verifierStatus.lastRun.status} · {new Date(verifierStatus.lastRun.started_at).toLocaleString()} ·
                {" "}verified {verifierStatus.lastRun.verified} / failed {verifierStatus.lastRun.failed}
                {verifierStatus.lastRun.error ? ` · ${verifierStatus.lastRun.error}` : ""}
              </p>
            )}
            {lastRun && (
              <p className="mt-2 text-xs text-gray-500">
                This run called the provider {lastRun.providerCalled}× → {lastRun.providerEndpoint}
              </p>
            )}
          </Panel>

          <Panel title={`Candidates (${candidates.length})`}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["Auth code", "Protocol", "Amount", "Currency", "Beneficiary", "Status", "Settlement"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {candidates.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">No candidates awaiting verification.</td></tr>
                  ) : candidates.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{c.authorizationCode}</td>
                      <td className="px-3 py-2">{c.protocol}</td>
                      <td className="px-3 py-2 font-semibold">{money(c.amount, c.currency)}</td>
                      <td className="px-3 py-2">{c.currency}</td>
                      <td className="px-3 py-2">{c.beneficiaryName || "—"}</td>
                      <td className="px-3 py-2">{c.fundVerificationStatus}</td>
                      <td className="px-3 py-2">{c.settlementStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ── Bank statements tab ── */}
      {tab === "statements" && (
        <div className="space-y-6">
          <Panel title="Fetch from provider or import a file">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
              <Field label="Account ID"><input className={inputCls} value={statementForm.accountId} onChange={(e) => setStatementForm({ ...statementForm, accountId: e.target.value })} placeholder="IBAN / account" /></Field>
              <Field label="Currency"><input className={inputCls} value={statementForm.currency} onChange={(e) => setStatementForm({ ...statementForm, currency: e.target.value.toUpperCase() })} /></Field>
              <Field label="From"><input type="date" className={inputCls} value={statementForm.from} onChange={(e) => setStatementForm({ ...statementForm, from: e.target.value })} /></Field>
              <Field label="To"><input type="date" className={inputCls} value={statementForm.to} onChange={(e) => setStatementForm({ ...statementForm, to: e.target.value })} /></Field>
              <Field label="Format">
                <select className={inputCls} value={statementForm.format} onChange={(e) => setStatementForm({ ...statementForm, format: e.target.value })}>
                  <option value="AUTO">Auto-detect</option>
                  <option value="MT940">MT940</option>
                  <option value="CAMT053">CAMT.053</option>
                  <option value="CSV">CSV</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={fetchFromProvider} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                Fetch from provider
              </button>
              <input type="file" accept=".xml,.sta,.mt940,.csv,.txt" onChange={(e) => onFile(e.target.files?.[0] || null)} className="text-sm" />
              <button onClick={processUpload} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-md bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50">
                Import pasted/loaded statement
              </button>
            </div>
            <textarea
              className="mt-4 w-full h-40 font-mono text-xs border border-gray-300 rounded-md p-3"
              placeholder="Paste MT940 / CAMT.053 XML / CSV here, or choose a file above."
              value={uploadText}
              onChange={(e) => setUploadText(e.target.value)}
            />
          </Panel>

          <Panel title={`Imported statements (${statements.length})`}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["Created", "Format", "Source", "Account", "Currency", "Lines", "Opening", "Closing", ""].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {statements.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-10 text-center text-gray-500">No statements imported yet.</td></tr>
                  ) : statements.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs">{s.created_at ? new Date(s.created_at).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2">{s.source_format}</td>
                      <td className="px-3 py-2">{s.source}</td>
                      <td className="px-3 py-2">{s.account_id || "—"}</td>
                      <td className="px-3 py-2">{s.currency || "—"}</td>
                      <td className="px-3 py-2">{s.line_count}</td>
                      <td className="px-3 py-2">{s.opening_balance ?? "—"}</td>
                      <td className="px-3 py-2">{s.closing_balance ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openStatement(s)} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">Lines</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {selectedStatement && (
            <Panel
              title={`Lines — ${selectedStatement.id}`}
              actions={<button onClick={() => { setSelectedStatement(null); setStatementLines([]); }} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Close</button>}
            >
              <div className="overflow-x-auto max-h-[520px]">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {["Value date", "Amount", "C/D", "Reference", "Counterparty", "Narrative", "Match"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {statementLines.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No lines.</td></tr>
                    ) : statementLines.map((l) => (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs">{l.value_date || l.booking_date || "—"}</td>
                        <td className="px-3 py-2 font-semibold">{l.amount}</td>
                        <td className="px-3 py-2">{l.credit_debit}</td>
                        <td className="px-3 py-2 font-mono text-xs">{l.reference || "—"}</td>
                        <td className="px-3 py-2">{l.counterparty || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{l.narrative || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge tone={l.match_status === "MATCHED" ? "ok" : l.match_status === "UNMATCHED" ? "warn" : "muted"}>{l.match_status || "—"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── Real funds tab ── */}
      {tab === "realfunds" && (
        <div className="space-y-6">
          <Panel
            title="Fund-holding server (Global Server)"
            actions={<button onClick={loadRealFunds} className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50">Reload</button>}
          >
            {!realFunds ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Stat label="Configured" value={realFunds.globalServer?.configured ? "Yes" : "No"} />
                  <Stat label="Base URL" value={realFunds.globalServer?.baseUrl || "—"} />
                  <Stat label="Endpoints" value={`${realFunds.globalServer?.balancePath ?? "—"} · ${realFunds.globalServer?.settlePath ?? "—"}`} />
                </div>
                {realFunds.globalServer?.missing?.length ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <strong>Real funds rail not configured.</strong> The capture→ledger step believes the sale is done, but no money can move
                    until the fund-holding server is reachable. Missing: {realFunds.globalServer.missing.join(", ")}.
                  </div>
                ) : (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                    Real funds rail is live. Settling will POST to the fund-holding server and only records a settlement on a CONFIRMED response.
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {(realFunds.totals || []).length === 0 ? (
                    <Stat label="Confirmed real settlements" value="0" sub="No CONFIRMED settlements recorded" />
                  ) : (realFunds.totals || []).map((t: any) => (
                    <Stat key={t.currency} label={`${t.currency} confirmed`} value={money(t.amountMinor / 100, t.currency)} sub={`${t.count} settlements`} />
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Call the real fund (Global Server settle)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Session / reference"><input className={inputCls} value={settleForm.sessionId} onChange={(e) => setSettleForm({ ...settleForm, sessionId: e.target.value })} placeholder="unique session id" /></Field>
              <Field label="Card reference"><input className={inputCls} value={settleForm.cardRef} onChange={(e) => setSettleForm({ ...settleForm, cardRef: e.target.value })} placeholder="tokenized card ref" /></Field>
              <Field label="Auth code"><input className={inputCls} value={settleForm.authCode} onChange={(e) => setSettleForm({ ...settleForm, authCode: e.target.value })} placeholder="101.1 auth code" /></Field>
              <Field label="Amount (minor units, e.g. cents)"><input className={inputCls} value={settleForm.amountMinor} onChange={(e) => setSettleForm({ ...settleForm, amountMinor: e.target.value.replace(/[^0-9]/g, "") })} placeholder="1000 = 10.00" /></Field>
              <Field label="Currency"><input className={inputCls} value={settleForm.currency} onChange={(e) => setSettleForm({ ...settleForm, currency: e.target.value.toUpperCase() })} /></Field>
              <Field label="Receiver bank name"><input className={inputCls} value={settleForm.bankName} onChange={(e) => setSettleForm({ ...settleForm, bankName: e.target.value })} /></Field>
              <Field label="Receiver IBAN"><input className={inputCls} value={settleForm.iban} onChange={(e) => setSettleForm({ ...settleForm, iban: e.target.value })} /></Field>
              <Field label="Receiver SWIFT / BIC"><input className={inputCls} value={settleForm.swift} onChange={(e) => setSettleForm({ ...settleForm, swift: e.target.value })} /></Field>
              <div className="flex items-end">
                <button onClick={submitSettle} disabled={busy || !realFunds?.globalServer?.configured} className="w-full px-4 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {busy ? "Calling…" : "Call real fund"}
                </button>
              </div>
            </div>
            {settleResult && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                CONFIRMED · settlement {settleResult.settlementId} · {money(settleResult.amountMinor / 100, settleResult.currency)} · value date {settleResult.valueDate || "—"}
              </div>
            )}
          </Panel>

          <Panel title="Recent real settlements">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>{["Created", "Tx", "Amount", "Currency", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(realFunds?.recentSettlements || []).length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-500">No real settlements confirmed yet.</td></tr>
                  ) : (realFunds?.recentSettlements || []).map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.tx_id}</td>
                      <td className="px-3 py-2 font-semibold">{money(r.amount_minor / 100, r.currency)}</td>
                      <td className="px-3 py-2">{r.currency}</td>
                      <td className="px-3 py-2"><Badge tone={r.status === "SETTLED" ? "ok" : "warn"}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ── Report tabs ── */}
      {(tab === "reserve" || tab === "settlement" || tab === "emi") && (
        <div className="space-y-6">
          <Panel title="Report filters">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <Field label="From"><input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
              <Field label="To"><input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
              <Field label="Currency"><input className={inputCls} value={filters.currency} onChange={(e) => setFilters({ ...filters, currency: e.target.value.toUpperCase() })} /></Field>
              <Field label="Merchant ID"><input className={inputCls} value={filters.merchantId} onChange={(e) => setFilters({ ...filters, merchantId: e.target.value })} /></Field>
              <div className="flex items-end gap-2">
                <button onClick={() => loadReport(tab)} disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {busy ? "Loading…" : "Generate"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => openReport(`/api/treasury/reports/${tab === "emi" ? "emi-account-statement" : tab}${query()}`, "csv", `${tab}-report`)} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Export CSV</button>
              <button onClick={() => openReport(`/api/treasury/reports/${tab === "emi" ? "emi-account-statement" : tab}${query()}`, "html", `${tab}-report`)} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Print / Save as PDF</button>
            </div>
          </Panel>

          {tab === "reserve" && (
            <Panel title="Reserve Report">
              {!reserve ? <p className="text-sm text-gray-500">Click Generate to build the report.</p> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Stat label="Total reserved" value={money(reserve.summary?.totalReserved)} />
                    <Stat label="Active" value={money(reserve.summary?.activeReserved)} sub={`${reserve.summary?.activeCount ?? 0} reserves`} />
                    <Stat label="Released" value={money(reserve.summary?.releasedReserved)} />
                    <Stat label="Cancelled" value={money(reserve.summary?.cancelledReserved)} />
                  </div>
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>{["ID", "Created", "Merchant", "Currency", "Amount", "Reason", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(reserve.reserves || []).map((r: any) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                          <td className="px-3 py-2 text-xs">{r.ts ? new Date(r.ts).toLocaleString() : "—"}</td>
                          <td className="px-3 py-2">{r.merchantId || "—"}</td>
                          <td className="px-3 py-2">{r.currency}</td>
                          <td className="px-3 py-2 font-semibold">{money(r.amount, r.currency)}</td>
                          <td className="px-3 py-2">{r.reason || "—"}</td>
                          <td className="px-3 py-2">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {tab === "settlement" && (
            <Panel title="Settlement Report">
              {!settlement ? <p className="text-sm text-gray-500">Click Generate to build the report.</p> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <Stat label="Total" value={money(settlement.summary?.totalAmount)} />
                    <Stat label="Settled" value={money(settlement.summary?.settledAmount)} />
                    <Stat label="Pending" value={money(settlement.summary?.pendingAmount)} />
                    <Stat label="Failed" value={money(settlement.summary?.failedAmount)} />
                    <Stat label="Rows" value={String(settlement.summary?.rowCount ?? 0)} />
                  </div>
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>{["Channel", "ID", "Merchant", "Currency", "Amount", "Status", "Created"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(settlement.rows || []).map((r: any, i: number) => (
                        <tr key={`${r.channel}-${r.id}-${i}`} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{r.channel}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                          <td className="px-3 py-2">{r.merchantId || "—"}</td>
                          <td className="px-3 py-2">{r.currency}</td>
                          <td className="px-3 py-2 font-semibold">{money(r.amount, r.currency)}</td>
                          <td className="px-3 py-2">{r.status}</td>
                          <td className="px-3 py-2 text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {tab === "emi" && (
            <Panel title="EMI Account Statement">
              {!emi ? <p className="text-sm text-gray-500">Click Generate to build the statement.</p> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <Stat label="Opening" value={money(emi.openingBalance, emi.account?.currency)} />
                    <Stat label="Credits" value={money(emi.totalCredits, emi.account?.currency)} />
                    <Stat label="Debits" value={money(emi.totalDebits, emi.account?.currency)} />
                    <Stat label="Closing" value={money(emi.closingBalance, emi.account?.currency)} />
                    <Stat label="Movements" value={String(emi.movementCount ?? 0)} />
                  </div>
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>{["Date", "Type", "Reference", "Debit", "Credit", "Balance", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(emi.movements || []).map((m: any) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs">{m.ts ? new Date(m.ts).toLocaleString() : "—"}</td>
                          <td className="px-3 py-2">{m.type}</td>
                          <td className="px-3 py-2 font-mono text-xs">{m.reference || "—"}</td>
                          <td className="px-3 py-2 text-red-600">{m.debit ? money(m.debit, emi.account?.currency) : "—"}</td>
                          <td className="px-3 py-2 text-green-600">{m.credit ? money(m.credit, emi.account?.currency) : "—"}</td>
                          <td className="px-3 py-2 font-semibold">{money(m.balance, emi.account?.currency)}</td>
                          <td className="px-3 py-2">{m.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

export default TreasuryPage;
