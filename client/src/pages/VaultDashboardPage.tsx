import { useEffect, useMemo, useState, useCallback, type ReactNode, type ChangeEvent, type FormEvent } from "react";
import {
  RefreshCw, ShieldCheck, Play, Check, X, FileText,
  Activity, Wallet, ArrowDownToLine, ArrowUpFromLine,
  Settings2, CreditCard, Copy, Eye, EyeOff, RotateCw, Send,
  Coins, KeyRound, Mail, Shield, QrCode, ExternalLink,
  Users,
} from "lucide-react";
import { resolveApiBaseUrl } from "../lib/backendUrl";
import { TransakWidgetModal, type TransakFlow } from "../components/TransakWidgetModal";
import VaultCard from "../components/VaultCard";
import VaultBankCard from "../components/vault/VaultBankCard";
import {
  createVirtualAccount,
  listVirtualAccounts,
  transakSendUserOtp,
  transakVerifyUserOtp,
  transakGetUserLimits,
  transakGetUserDetails,
  transakOnboardUser,
  transakVerifyWalletAddress,
  listCustomerVirtualCards,
  issueCustomerVirtualCard,
  updateCustomerVirtualCard,
  getCustomerVirtualCard,
  type BankTransferTransaction,
  type IssuedVirtualCard,
} from "../lib/api";

type Tab = "overview" | "cardload" | "settlements" | "payouts" | "beneficiaries" | "withdrawals" | "fxfees" | "reconciliation" | "onramp" | "credentials";
type AnyRecord = Record<string, any>;

const API = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });
const CARD_ASSET_BASE = `${API}/coins/cards`;
const tabs: Array<{ id: Tab; label: string; icon: typeof Wallet }> = [
  { id: "overview",       label: "Overview",          icon: Wallet },
  { id: "cardload",       label: "Card Loading",      icon: CreditCard },
  { id: "onramp",         label: "Crypto On-Ramp",    icon: Coins },
  { id: "settlements",    label: "Settlements",       icon: ArrowDownToLine },
  { id: "payouts",        label: "Payouts",           icon: ArrowUpFromLine },
  { id: "beneficiaries",  label: "Beneficiaries",     icon: Users },
  { id: "withdrawals",    label: "Withdrawals",       icon: Activity },
  { id: "fxfees",         label: "FX & Fees",         icon: Settings2 },
  { id: "reconciliation", label: "Reconciliation",    icon: ShieldCheck },
  { id: "credentials",    label: "Bank Credentials",  icon: KeyRound },
];

async function api(path: string, options?: RequestInit): Promise<any> {
  const token = localStorage.getItem("token") || localStorage.getItem("jwt_token");
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

function fmtNum(n: number, ccy?: string) {
  return `${ccy ? ccy + ' ' : ''}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maskCredential(value: string) {
  if (!value) return "Not configured";
  if (value.includes("...")) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function luhnCheckDigit(raw: string) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    let digit = Number(raw[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidLuhn(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function makeDemoCard(currency: string) {
  const isEuro = currency === "EUR";
  const pan = isEuro ? "4556731234567891" : "4111111111111111";
  const expiry = "12/30";
  const cvv = isEuro ? "321" : "123";
  return {
    scheme: "VISA",
    card_number: pan,
    card_number_formatted: pan.replace(/(\d{4})(?=\d)/g, "$1 "),
    bin: pan.slice(0, 6),
    last4: pan.slice(-4),
    expiry_month: "12",
    expiry_year: "30",
    expiry,
    cvv,
    luhn_valid: isValidLuhn(pan),
  };
}

function StatusBadge({ value }: { value: string }) {
  const s = String(value || "UNKNOWN").toUpperCase();
  const tone = s.includes("FAIL") || s.includes("ERROR") || s.includes("MISMATCH")
    ? "bg-red-100 text-red-700"
    : s.includes("PENDING") || s.includes("PROCESS")
    ? "bg-amber-100 text-amber-700"
    : "bg-emerald-100 text-emerald-700";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${tone}`}>{s.replaceAll("_", " ")}</span>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: AnyRecord[]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            {columns.map(c => <th key={c} className="px-4 py-3 font-bold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length
            ? rows.map((row, i) => (
                <tr key={row.id || row.payout_id || i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                  {columns.map(c => <td key={c} className="whitespace-nowrap px-4 py-3 text-gray-700">{row[c] ?? "-"}</td>)}
                </tr>
              ))
            : <tr><td className="px-4 py-8 text-center text-gray-400" colSpan={columns.length}>{empty}</td></tr>
          }
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="font-bold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function maskEmvValue(value: unknown, tag: string) {
  const clean = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!clean) return "Not available";
  if (tag === "9F26" || tag === "9F37" || tag === "9F10" || tag === "95" || tag === "9F34") {
    return clean.length > 8 ? `${clean.slice(0, 4)}••••${clean.slice(-4)}` : "••••••••";
  }
  return clean;
}

const ACTIVE_EMV_CARD_PROFILE: AnyRecord = {
  "9F26": "ARQC_HEX",
  "9F27": "80",
  "9F10": "IAD_HEX",
  "9F37": "UN_HEX",
  "9F36": "0015",
  "95": "TVR_HEX",
  "9A": "260921",
  "9C": "00",
  "9F02": "000000010000",
  "5F2A": "0840",
  "82": "AIP_HEX",
  "9F34": "CVR_HEX",
  "9F1A": "0566",
  "9F33": "TERMCAP_HEX",
  "9F35": "22",
  "9F1E": "IFD_SERIAL",
  "84": "A0000000031010",
  "9F09": "0001",
  "9F41": "00000021",
};

function EmvChipPanel({ auditRows }: { auditRows: AnyRecord[] }) {
  const parseObject = (value: unknown): AnyRecord => {
    if (value && typeof value === "object") return value as AnyRecord;
    if (typeof value !== "string") return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const getField55 = (row: AnyRecord): AnyRecord => {
    const candidates = [
      row?.field55,
      row?.field55Json,
      row?.emv_data,
      row?.emvData,
      row?.details?.field55,
      row?.details?.emv,
      row?.meta?.field55,
      row?.meta?.emv,
      row?.after?.field55,
      row?.after?.emv,
    ];
    for (const candidate of candidates) {
      const parsed = parseObject(candidate);
      if (parsed.field55 && typeof parsed.field55 === "object") return parsed.field55;
      if (Object.keys(parsed).some((key) => /^[0-9A-F]{2,4}$/i.test(key))) return parsed;
    }
    return {};
  };
  const latest = auditRows.find((row) => Object.keys(getField55(row)).length > 0);
  const emv = latest ? getField55(latest) : ACTIVE_EMV_CARD_PROFILE;
  const amount = emv["9F02"] || latest?.amount_minor;
  const currency = emv["5F2A"];
  const date = emv["9A"];
  const dateDisplay = /^[0-9A-F]{6}$/i.test(String(date))
    ? `20${String(date).slice(0, 2)}-${String(date).slice(2, 4)}-${String(date).slice(4, 6)}`
    : String(date);
  const rows: Array<[string, string, unknown]> = [
    ["9F02", "Amount authorised", amount
      ? `${emv["9F02"] ? (Number.parseInt(String(amount), 16) / 100).toFixed(2) : (Number(amount) / 100).toFixed(2)}${currency ? ` ${currency === "0840" ? "USD" : currency}` : ""}`
      : undefined],
    ["9F03", "Amount other", emv["9F03"]],
    ["5F2A", "Currency", currency ? (currency === "0840" ? "USD (0840)" : currency) : undefined],
    ["9A", "Transaction date", dateDisplay],
    ["9C", "Transaction type", emv["9C"] === "00" ? "Purchase" : emv["9C"]],
    ["9F26", "ARQC", emv["9F26"]],
    ["9F27", "Cryptogram type", emv["9F27"]],
    ["9F10", "Issuer application data", emv["9F10"]],
    ["9F36", "ATC", emv["9F36"] ? `${Number.parseInt(String(emv["9F36"]), 16)} (${emv["9F36"]})` : undefined],
    ["9F37", "Unpredictable number", emv["9F37"]],
    ["95", "TVR", emv["95"]],
    ["82", "AIP", emv["82"]],
    ["9F34", "CVR", emv["9F34"]],
    ["9F1A", "Terminal country", emv["9F1A"]],
    ["9F33", "Terminal capabilities", emv["9F33"]],
    ["9F35", "Terminal type", emv["9F35"]],
    ["9F1E", "IFD serial", emv["9F1E"]],
    ["84", "Application identifier", emv["84"]],
    ["9F09", "Application version", emv["9F09"]],
    ["9F41", "Transaction sequence", emv["9F41"]],
  ];

  return (
    <Card title="EMV Chip Data" action={<ShieldCheck size={17} className="text-emerald-600" />}>
      <div className="grid gap-2 p-5 sm:grid-cols-2">
        {rows.map(([tag, label, value]) => (
          <div key={tag} className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="min-w-0">
              <span className="block font-mono text-xs font-bold text-slate-700">{tag}</span>
              <span className="block truncate text-[11px] text-slate-500">{label}</span>
            </span>
            <span className="max-w-[58%] truncate text-right font-mono text-xs font-semibold text-slate-900">
              {tag === "9A" || tag === "9F02" || tag === "5F2A" || tag === "9C" || tag === "9F36"
                ? String(value || "Not available")
                : maskEmvValue(value, tag)}
            </span>
          </div>
        ))}
      </div>
      <p className="px-5 pb-5 text-xs text-slate-500">
        Active EMV card profile. A transaction audit record containing Field 55 overrides these configured values. ARQC, IAD, TVR, CVR, and unpredictable numbers are masked. PAN, CVV, PINs, and issuer keys are never displayed.
      </p>
    </Card>
  );
}

function ApiKeyPanel({ securityKey, onRotate }: { securityKey: AnyRecord | null; onRotate: () => void }) {
  const [visible, setVisible] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [endpointVisible, setEndpointVisible] = useState(false);
  const [rotating, setRotating] = useState(false);
  const key = revealedKey || securityKey?.apiKey || "";
  const endpoint = securityKey?.transferUrl || "";
  const rotate = () => {
    if (!window.confirm("Rotate the active vault gateway key? The previous key will stop working.")) return;
    setRotating(true); onRotate(); window.setTimeout(() => setRotating(false), 700);
  };
  const copy = async () => { if (revealedKey) await navigator.clipboard.writeText(revealedKey); };
  const toggleVisibility = async () => {
    if (visible) {
      setVisible(false);
      return;
    }
    if (!revealedKey) {
      try {
        const result = await api("/api/vault/security/api-key/reveal");
        setRevealedKey(result.apiKey || "");
      } catch {
        return;
      }
    }
    setVisible(true);
  };
  const copyEndpoint = async () => { if (endpoint) await navigator.clipboard.writeText(endpoint); };
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Active API key</p>
          <p className="mt-1 truncate font-mono text-sm text-gray-800">{visible ? key : maskCredential(key)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button aria-label={visible ? "Hide API key" : "Show API key"} onClick={() => void toggleVisibility()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-200">{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button aria-label="Copy API key" disabled={!revealedKey} onClick={() => void copy()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-200 disabled:opacity-40"><Copy size={15} /></button>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{securityKey?.lastUsedAt ? `Last used ${new Date(securityKey.lastUsedAt).toLocaleString()}` : "Usage not recorded"}</span>
        <button disabled={rotating} onClick={rotate} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
          <RotateCw size={13} className={rotating ? "animate-spin" : ""} /> Rotate
        </button>
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <p className="font-bold uppercase tracking-wide text-slate-500">Vault endpoint</p>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 break-all font-mono text-slate-700">
            {endpointVisible ? endpoint : maskCredential(endpoint)}
          </p>
          <button aria-label={endpointVisible ? "Hide endpoint" : "Show endpoint"} onClick={() => setEndpointVisible(v => !v)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-200">
            {endpointVisible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button aria-label="Copy endpoint" onClick={() => void copyEndpoint()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-200">
            <Copy size={15} />
          </button>
        </div>
        <p className="font-bold uppercase tracking-wide text-slate-500">HMAC secret</p>
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-slate-700">{securityKey?.secretConfigured ? "Configured · hidden" : "Not configured"}</p>
          <span className="text-[11px] font-semibold text-slate-400">Reveal disabled</span>
        </div>
      </div>
      <p className="text-xs leading-5 text-gray-500">The API key is masked. The HMAC secret is never returned to the browser.</p>
    </div>
  );
}

// ── Operator Card (pixel-matched to user's reference screenshots) ──────────────────────────────
// Two layout variants driven by prop:
//   simpleLayout = true  → small 2-column side-by-side card (card-load UI)
//                        NO cardholder / valid-thru / cvv row at bottom
//   simpleLayout = false → full operator card (201.3 stacked section)
//                        INCLUDES cardholder / valid-thru / cvv row
// ─────────────────────────────────────────────────────────────────────────────────────────────
function OperatorCard({
  currency, loaded, card, bankName,
}: {
  currency: string;
  loaded: { amount: number; currency: string } | null;
  card: { number: string; cvv: string; expiry: string };
  bankName?: string;
  lastFour?: string;
  revealed?: boolean;
  simpleLayout?: boolean;
}) {
  return <VaultCard currency={currency} />;
}
export function VaultDashboardPage() {
  const [tab, setTab]       = useState<Tab>("overview");
  const [vaultCardDetails, setVaultCardDetails] = useState<Record<string, AnyRecord>>({});
  const [vaultCardDetailsBusy, setVaultCardDetailsBusy] = useState(false);
  const [vaultCardDetailsError, setVaultCardDetailsError] = useState("");
  const [cardLoadingOpen, setCardLoadingOpen] = useState(false);
  const [selectedLoadingCard, setSelectedLoadingCard] = useState<"usd" | "eur" | null>(null);
  const [data, setData]     = useState<AnyRecord>({});
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [message, setMessage] = useState("");
  const [beneficiaryBusy, setBeneficiaryBusy] = useState(false);
  const [beneficiaryForm, setBeneficiaryForm] = useState<Record<string, string>>({
    beneficiary_legal_name: "", beneficiary_address_line1: "", beneficiary_address_line2: "",
    beneficiary_city: "", beneficiary_country: "", beneficiary_phone: "",
    receiving_bank_name: "", receiving_bank_address_line1: "", receiving_bank_address_line2: "",
    receiving_bank_city: "", receiving_bank_country: "", receiving_bank_swift_bic: "",
    receiving_bank_routing_number: "", receiving_bank_sort_code: "", receiving_bank_local_clearing_code: "",
    account_number: "", iban: "", supported_currency: "USD", account_type: "",
    transfer_type: "DOMESTIC", network_code: "", payment_purpose_code: "",
    payment_description: "", end_to_end_id: "", beneficiary_reference: "",
    vault_customer_id: "", vault_wallet_id: "", vault_card_reference: "",
    vault_settlement_batch_id: "", vault_transaction_id: "", internal_note: "",
  });

  // ── Fund Card state ─────────────────────────────────────────────────────────
  const [cardLoads, setCardLoads] = useState<Record<string, { amount: number; currency: string } | null>>({ USD: null, EUR: null });
  // ── Generated Luhn-valid cards ─────────────────────────────────────────────
  const [generatedCards, setGeneratedCards] = useState<Record<string, AnyRecord | null>>({ USD: null, EUR: null });
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({ USD: false, EUR: false });
  const [loadCurrency, setLoadCurrency] = useState("EUR");
  const [loadAmount, setLoadAmount]     = useState("");
  const [loadNote, setLoadNote]         = useState("");
  const [loadBusy, setLoadBusy]         = useState(false);
  const [loadHistory, setLoadHistory]   = useState<AnyRecord[]>([]);
  const [externalEndpoint, setExternalEndpoint] = useState("");
  const [externalApiKey, setExternalApiKey] = useState("");
  const [externalProviderName, setExternalProviderName] = useState("");
  const [externalProviderAccount, setExternalProviderAccount] = useState("");
  const [externalEnvironment, setExternalEnvironment] = useState<"sandbox" | "production">("production");
  const [externalSourceReference, setExternalSourceReference] = useState("");
  const [externalCardId, setExternalCardId] = useState<"usd" | "eur">("usd");
  const [fundingMethod, setFundingMethod] = useState<"card-to-card" | "server-to-card" | "bank-to-card" | "wallet-to-card">("wallet-to-card");
  const [sourceCardReference, setSourceCardReference] = useState("");
  const [sourceServerReference, setSourceServerReference] = useState("");
  const [sourceBankName, setSourceBankName] = useState("");
  const [sourceBankReference, setSourceBankReference] = useState("");
  const [sourceBankSenderName, setSourceBankSenderName] = useState("");
  const [sourceBankAccountReference, setSourceBankAccountReference] = useState("");
  const [sourceTransferType, setSourceTransferType] = useState("SWIFT");
  const [sourceTransferNetworkCode, setSourceTransferNetworkCode] = useState("");
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [sourceWalletNetwork, setSourceWalletNetwork] = useState("");
  const [sourceWalletTransactionId, setSourceWalletTransactionId] = useState("");
  const [sourceServerName, setSourceServerName] = useState("");
  const [sourceServerAccount, setSourceServerAccount] = useState("");
  const [sourceCardIssuer, setSourceCardIssuer] = useState("");
  const [sourceCardLast4, setSourceCardLast4] = useState("");
  // ── Bank Credentials tab state ─────────────────────────────────────────────
  const [creds, setCreds] = useState<AnyRecord>({});
  const [credsRevealed, setCredsRevealed] = useState(false);
  const [credsVisible, setCredsVisible] = useState<Record<string, boolean>>({});
  const [credsEditing, setCredsEditing] = useState(false);
  const [credsDraft, setCredsDraft] = useState<AnyRecord>({});
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsRotating, setCredsRotating] = useState(false);
  const [credsRotateResult, setCredsRotateResult] = useState<AnyRecord | null>(null);
  const [credsMsg, setCredsMsg] = useState("");
  const [credsErr, setCredsErr] = useState("");
  const [transferMerchantId, setTransferMerchantId] = useState("MRC-1001");
  const [transferCurrency, setTransferCurrency] = useState("USD");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  // ── Wise payout state ─────────────────────────────────────────────────────
  const [wiseAmount, setWiseAmount] = useState("");
  const [wiseCurrency, setWiseCurrency] = useState("USD");
  const [wiseTargetName, setWiseTargetName] = useState("");
  const [wiseTargetAccount, setWiseTargetAccount] = useState("");
  const [wiseTargetBic, setWiseTargetBic] = useState("");
  const [wiseTargetCountry, setWiseTargetCountry] = useState("");
  const [wiseReference, setWiseReference] = useState("");
  const [wiseSending, setWiseSending] = useState(false);
  const [wiseResult, setWiseResult] = useState<AnyRecord | null>(null);
  const [wiseError, setWiseError] = useState("");
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [providerEndpoint, setProviderEndpoint] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerSecretKey, setProviderSecretKey] = useState("");
  const [providerConnected, setProviderConnected] = useState(false);
  const [providerConnecting, setProviderConnecting] = useState(false);
  const [providerConnectError, setProviderConnectError] = useState("");
  const [providerSending, setProviderSending] = useState(false);
  const [providerSendResult, setProviderSendResult] = useState<AnyRecord | null>(null);

  // ── Crypto On-Ramp (Transak VBA + widget) state ────────────────────────────
  const DEFAULT_MERCHANT = "MRC-1001";
  const [onrampMerchantId, setOnrampMerchantId] = useState<string>(DEFAULT_MERCHANT);
  const [virtualAccounts, setVirtualAccounts] = useState<BankTransferTransaction[]>([]);
  const [onrampBusy, setOnrampBusy] = useState(false);

  // Transak user auth (OTP or Auth Reliance)
  const [merchantEmail, setMerchantEmail] = useState<string>("");
  const [transakOtp, setTransakOtp] = useState<string>("");
  const [transakStateToken, setTransakStateToken] = useState<string>("");
  const [transakOtpSent, setTransakOtpSent] = useState<boolean>(false);
  const [transakAccessToken, setTransakAccessToken] = useState<string>("");
  const [transakAuthRelianceEmail, setTransakAuthRelianceEmail] = useState<string>("");
  const [transakKycStatus, setTransakKycStatus] = useState<string>("");
  const [transakKycType, setTransakKycType] = useState<string>("");
  const [transakLimits, setTransakLimits] = useState<{ daily: string; monthly: string; yearly: string }>({ daily: "", monthly: "", yearly: "" });

  // Fiat source
  const [fiatCurrency, setFiatCurrency] = useState<string>("USD");
  const [paymentMethod, setPaymentMethod] = useState<string>("gbp_bank_transfer");

  // Crypto destination
  const [destAsset, setDestAsset] = useState<string>("USDT");
  const [destNetwork, setDestNetwork] = useState<string>("tron");
  const [destAddress, setDestAddress] = useState<string>("");
  const [walletVerified, setWalletVerified] = useState<"true" | "false" | "">("");

  // Transak widget state (merchant/customer direct live crypto buy)
  const [transakOpen, setTransakOpen] = useState(false);
  const [transakFlow, setTransakFlow] = useState<TransakFlow>("BUY");
  const [transakPresets, setTransakPresets] = useState<{
    defaultCryptoCurrency: string;
    defaultNetwork?: string;
    defaultFiatAmount?: number;
    defaultFiatCurrency: string;
    partnerCustomerId?: string;
    walletAddress?: string;
  }>({
    defaultCryptoCurrency: "USDT",
    defaultFiatCurrency: "USD",
  });

  const openTransakWidget = (flow: TransakFlow, opts?: Partial<typeof transakPresets>) => {
    setTransakPresets({
      defaultCryptoCurrency: opts?.defaultCryptoCurrency || destAsset || "USDT",
      defaultNetwork: opts?.defaultNetwork || destNetwork,
      defaultFiatAmount: opts?.defaultFiatAmount,
      defaultFiatCurrency: opts?.defaultFiatCurrency || fiatCurrency || "USD",
      partnerCustomerId: onrampMerchantId,
      walletAddress: opts?.walletAddress || (destAddress ? destAddress : undefined),
    });
    setTransakFlow(flow);
    setTransakOpen(true);
  };

  const loadVirtualAccounts = useCallback(async () => {
    try {
      const result = await listVirtualAccounts(onrampMerchantId);
      setVirtualAccounts(result.transactions || []);
    } catch (e: any) { console.warn("[VBA] list failed:", e?.message); setVirtualAccounts([]); }
  }, [onrampMerchantId]);

  // ── Vault Bank Operator Cards (wallet_cards table) ───────────────────────
  const DEFAULT_OPERATOR_CUSTOMER_ID =
    "6f89ee50-5925-45e2-b7d3-ef6ad3587505"; // seeded customer already has 2 cards in wallet_cards (incl. user's VISA 4002468754246857)
  const [operatorCustomerId, setOperatorCustomerId] = useState<string>(DEFAULT_OPERATOR_CUSTOMER_ID);
  const [issuedCards, setIssuedCards] = useState<IssuedVirtualCard[]>([]);
  const [issuedCardsCount, setIssuedCardsCount] = useState<number>(0);
  const [issueBusy, setIssueBusy] = useState(false);
  const [revealSecrets, setRevealSecrets] = useState<Record<string, boolean>>({});
  const [issueParams, setIssueParams] = useState<{
    scheme: IssuedVirtualCard["scheme"];
    currency: string;
    validityYears: number;
    cardholderName: string;
    spendingLimit: number;
  }>({ scheme: "VISA", currency: "USD", validityYears: 5, cardholderName: "PRIMESTACK VAULT OPERATOR", spendingLimit: 100000 });

  const loadIssuedCards = useCallback(async () => {
    if (!operatorCustomerId) return;
    try {
      const r = await listCustomerVirtualCards(operatorCustomerId, { includeSecrets: true });
      setIssuedCards(r.cards || []);
      setIssuedCardsCount(r.count || (r.cards || []).length);
    } catch (e: any) { console.warn("[OPCARDS] list failed:", e?.message); setIssuedCards([]); setIssuedCardsCount(0); }
  }, [operatorCustomerId]);

  const handleIssueOperatorCard = async () => {
    if (!operatorCustomerId) { setError("Select a customer id first"); return; }
    setIssueBusy(true); setError(""); setMessage("");
    try {
      const newCard = await issueCustomerVirtualCard({
        customerId: operatorCustomerId,
        scheme: issueParams.scheme,
        currency: issueParams.currency,
        validityYears: issueParams.validityYears,
        cardholderName: issueParams.cardholderName,
        spendingLimit: issueParams.spendingLimit,
        meta: { source: "vault-dashboard-operator-issue" },
      });
      setMessage(`✅ Issued ${newCard.scheme} ${newCard.currency} card · ${newCard.bin}…${newCard.last4}`);
      await loadIssuedCards();
    } catch (e: any) { setError(e?.message || "Card issuance failed"); }
    finally { setIssueBusy(false); }
  };

  const handleToggleCardStatus = async (card: IssuedVirtualCard, target: "ACTIVE" | "BLOCKED" | "DEACTIVATED") => {
    setError(""); setMessage("");
    try {
      await updateCustomerVirtualCard(card.id, { status: target });
      setMessage(`Card ${card.bin}…${card.last4} status → ${target}`);
      await loadIssuedCards();
    } catch (e: any) { setError(e?.message || "Update failed"); }
  };

  useEffect(() => { void loadIssuedCards(); }, [loadIssuedCards]);

  const handleSendMerchantOtp = async () => {
    const email = merchantEmail.trim();
    if (!email) { setError("Enter the merchant/operator email registered on Transak"); return; }
    setOnrampBusy(true); setError(""); setMessage("");
    try {
      const r = await transakSendUserOtp(email);
      setTransakStateToken(r.stateToken);
      setTransakOtpSent(true);
      setMessage("OTP sent to " + email);
    } catch (e: any) { setError(e?.message || "Failed to send OTP"); }
    finally { setOnrampBusy(false); }
  };

  const handleOnboardMerchantAuthReliance = async () => {
    const email = merchantEmail.trim();
    if (!email) { setError("Enter the merchant/operator email for Auth Reliance"); return; }
    setOnrampBusy(true); setError(""); setMessage("");
    try {
      const r = await transakOnboardUser(email);
      setTransakAuthRelianceEmail(r.user.email);
      setTransakKycStatus(r.user.kyc?.status || "UNKNOWN");
      setTransakKycType(r.user.kyc?.type || "UNKNOWN");
      setMessage("Auth Reliance onboarded — KYC: " + (r.user.kyc?.status || "UNKNOWN"));
    } catch (e: any) { setError(e?.message || "Auth Reliance failed (check Transak partner settings)"); }
    finally { setOnrampBusy(false); }
  };

  const handleVerifyMerchantOtp = async () => {
    const email = merchantEmail.trim();
    const otp = transakOtp.trim();
    if (!email || !otp || !transakStateToken) { setError("Send OTP first, then enter the 6-digit code"); return; }
    setOnrampBusy(true); setError(""); setMessage("");
    try {
      const r = await transakVerifyUserOtp(email, otp, transakStateToken);
      setTransakAccessToken(r.accessToken);
      try {
        const user = await transakGetUserDetails(r.accessToken);
        setTransakKycStatus(user.user.kyc?.status || "UNKNOWN");
        setTransakKycType(user.user.kyc?.type || "UNKNOWN");
      } catch { /* non-fatal */ }
      try {
        const lim = await transakGetUserLimits({
          accessToken: r.accessToken,
          fiatCurrency,
          paymentCategory: paymentMethod,
          kycType: "STANDARD",
        });
        setTransakLimits({
          daily:   String(lim.limits.remaining["1"] ?? 0),
          monthly: String(lim.limits.remaining["30"] ?? 0),
          yearly:  String(lim.limits.remaining["365"] ?? 0),
        });
      } catch { /* non-fatal */ }
      setMessage("Transak session verified — ready to open Virtual Account");
    } catch (e: any) { setError(e?.message || "Invalid or expired OTP"); }
    finally { setOnrampBusy(false); }
  };

  const handleVerifyMerchantWalletAddress = async () => {
    const cryptoCurrency = (destAsset || "USDT").trim();
    const network = (destNetwork || "tron").trim();
    const walletAddress = destAddress.trim();
    if (!walletAddress) { setError("Enter the destination wallet address first"); return; }
    setOnrampBusy(true); setError(""); setMessage("");
    try {
      const r = await transakVerifyWalletAddress({ cryptoCurrency, network, walletAddress });
      if (!r.response) {
        setWalletVerified("false");
        setError(`Transak rejected this ${cryptoCurrency} (${network}) address`);
      } else {
        setWalletVerified("true");
        setMessage(`Wallet address verified ✓ — ${cryptoCurrency} on ${network}`);
      }
    } catch (e: any) {
      setWalletVerified("false");
      setError(e?.message || "Address verification failed");
    } finally { setOnrampBusy(false); }
  };

  const handleCreateVirtualAccount = async () => {
    setOnrampBusy(true); setError(""); setMessage("");
    try {
      if (!transakAccessToken && !transakAuthRelianceEmail) throw new Error("Verify merchant email with OTP or use Auth Reliance first");
      if (!fiatCurrency || !paymentMethod) throw new Error("Select the merchant fiat currency and payment method");
      if (!destAsset || !destNetwork || !destAddress.trim()) throw new Error("Enter the crypto destination (asset, network, wallet address)");
      if (walletVerified !== "true") throw new Error("Verify the wallet address first to ensure Transak can deliver funds");
      const result = await createVirtualAccount(onrampMerchantId, {
        source: { fiatCurrency, paymentMethod },
        destination: { cryptoCurrency: destAsset, walletAddress: destAddress.trim(), network: destNetwork },
        transakAccessToken: transakAccessToken || undefined,
        transakAuthRelianceEmail: transakAuthRelianceEmail || undefined,
      });
      setVirtualAccounts(prev => [result.transaction, ...prev.filter(t => t.id !== result.transaction.id)]);
      setMessage("✅ Transak Virtual Account opened — use the bank details below to fund it");
      await loadVirtualAccounts();
    } catch (e: any) {
      console.error("[VBA] create failed:", e);
      setError(e?.message || "Virtual account creation failed");
    } finally { setOnrampBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const requests: Record<string, string> = {
      stats:         "/api/vault/stats",
      accounts:      "/api/vault/accounts",
      payouts:       "/api/vault/payouts",
      settlements:   "/api/vault/batch-settlements",
      reconciliation:"/api/vault/reconciliation?currency=USD",
      liquidity:     "/api/vault/liquidity?currency=USD",
      realFunds:     "/api/vault/real-funds",
      custodyUsd:   "/api/vault/custody-reserve/USD",
      custodyEur:   "/api/vault/custody-reserve/EUR",
      audit:         "/api/vault/audit?limit=20",
      securityKey:   "/api/vault/security/api-key",
      withdrawals:   "/api/merchant/withdrawals",
      fx:            "/api/vault/fx",
      fees:          "/api/vault/fees",
      beneficiaries: "/api/vault/beneficiaries",
    };
    const entries = await Promise.all(
      Object.entries(requests).map(async ([key, path]) => {
        try { return [key, await api(path)] as const; } catch { return [key, null] as const; }
      })
    );
    setData(Object.fromEntries(entries));

    // Load card-loads history
    try {
      const hist = await api("/api/vault/card-loads");
      setLoadHistory(hist.loads || []);
    } catch { setLoadHistory([]); }

    // Load Transak VBA list for default merchant
    await loadVirtualAccounts();

    setLoading(false);
  }, [loadVirtualAccounts]);

  const updateBeneficiary = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setBeneficiaryForm(prev => ({ ...prev, [name]: value }));
  };

  const saveBeneficiary = async (event: FormEvent) => {
    event.preventDefault();
    setBeneficiaryBusy(true); setError(""); setMessage("");
    try {
      await api("/api/vault/beneficiaries", {
        method: "POST",
        body: JSON.stringify(beneficiaryForm),
      });
      setMessage("Beneficiary saved. Review and approve it before any payout.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save beneficiary");
    } finally {
      setBeneficiaryBusy(false);
    }
  };

  const loadVaultCardDetails = useCallback(async () => {
    setVaultCardDetailsBusy(true);
    setVaultCardDetailsError("");
    try {
      const response = await api("/api/vault/security/card-details");
      setVaultCardDetails(Object.fromEntries((response.cards || []).map((card: AnyRecord) => [card.id, card])));
    } catch (error: any) {
      setVaultCardDetailsError(error?.message || "Unable to load card details");
    } finally {
      setVaultCardDetailsBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { void loadVirtualAccounts(); }, [loadVirtualAccounts]);

  const payouts     = useMemo(() => data.payouts?.payouts     || data.payouts     || [], [data]);
  const settlements = useMemo(() => data.settlements?.settlements || data.settlements || [], [data]);
  const stats       = data.stats || {};
  const reconciliation = data.reconciliation?.reconciliation || data.reconciliation || {};
  const currencies  = data.liquidity?.currencies || (data.liquidity ? [data.liquidity] : []);
  const vaultAccounts: AnyRecord[] = Array.isArray(data.accounts) ? data.accounts : [];
  const realFundCurrencies: AnyRecord[] = data.realFunds?.currencies || [];
  const hasConfirmedRealFunds = realFundCurrencies.some((row: AnyRecord) => Number(row.available || 0) > 0);

  const getVaultAccountMeta = (currency: string): { bankName: string; lastFour: string } => {
    const acc = vaultAccounts.find((a) => String(a.currency || "").toUpperCase() === String(currency).toUpperCase());
    if (!acc) return { bankName: "VAULT BANK", lastFour: "" };
    const bankName =
      acc.bank_name || acc.bankName || (acc.bic ? `BIC ${acc.bic}` : acc.account_id || acc.id || "VAULT BANK");
    const raw = acc.account_number || acc.iban || acc.masked_number || acc.id || "";
    const digits = String(raw).replace(/\D/g, "");
    const lastFour = digits.length >= 4 ? digits.slice(-4) : String(raw).slice(-4).replace(/[^A-Za-z0-9]/g, "");
    return { bankName: String(bankName), lastFour };
  };

  // ── Generate a real Luhn-valid card for a currency ─────────────────────────
  const generateCard = async (currency: string) => {
    setGenBusy(prev => ({ ...prev, [currency]: true }));
    try {
      const res = await api(`/api/wallet-cards/generate`, {
        method: "POST",
        body: JSON.stringify({ scheme: "VISA", validity_years: 3, currency, merchant_id: "MRC-1001" }),
      });
      const card = {
        ...res,
        card_number_formatted: res.card_number_formatted || (res.card_number ? res.card_number.replace(/(\d{4})(?=\d)/g, "$1 ") : ""),
        luhn_valid: res.luhn_valid ?? isValidLuhn(String(res.card_number || "")),
      };
      setGeneratedCards(prev => ({ ...prev, [currency]: card }));
      setMessage(`✅ ${currency} card generated — Luhn valid`);
    } catch (e) {
      const fallback = makeDemoCard(currency);
      setGeneratedCards(prev => ({ ...prev, [currency]: fallback }));
      setMessage(`⚠️ ${currency} card fallback loaded — Luhn valid test card (Visa) is active.`);
      setError("");
    } finally {
      setGenBusy(prev => ({ ...prev, [currency]: false }));
    }
  };

  const runAction = async (action: () => Promise<any>, success: string) => {
    setError(""); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
  };

  // ── Send to card handler ────────────────────────────────────────────────────
  const handleSendToCard = async () => {
    const amt = parseFloat(loadAmount);
    if (!loadCurrency)       { setError("Select a currency"); return; }
    if (!amt || amt <= 0)    { setError("Enter a valid amount"); return; }
    setLoadBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/api/vault/card-load", {
        method: "POST",
        body: JSON.stringify({ currency: loadCurrency, amount: amt, note: loadNote || undefined }),
      });
      setCardLoads(previous => ({ ...previous, [loadCurrency]: { amount: amt, currency: loadCurrency } }));
      setMessage(`✅ ${result.message}. Confirmed real funds remaining: ${fmtNum(result.realFundsAvailableAfter, loadCurrency)}`);
      setLoadAmount("");
      setLoadNote("");
      // Refresh history + accounts
      const hist = await api("/api/vault/card-loads");
      setLoadHistory(hist.loads || []);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoadBusy(false);
    }
  };

  const handleExternalCardLoad = async () => {
    const amt = Number(loadAmount);
    if (!externalProviderName.trim() || !externalProviderAccount.trim() || !externalEndpoint || !externalApiKey || !externalSourceReference || !loadAmount || amt <= 0) {
      setError("Enter the provider name, provider account, endpoint, API key, source reference, and a positive amount");
      return;
    }
    const routeMissing =
      fundingMethod === "card-to-card"
        ? !sourceCardReference.trim()
        : fundingMethod === "server-to-card"
          ? !sourceServerReference.trim() || !sourceServerName.trim() || !sourceServerAccount.trim()
          : fundingMethod === "bank-to-card"
            ? !sourceBankName.trim() || !sourceBankReference.trim() || !sourceBankSenderName.trim()
            : !sourceWalletId.trim() || !sourceWalletNetwork.trim() || !sourceWalletTransactionId.trim();
    if (routeMissing) {
      setError("Complete all required fields for the selected funding route");
      return;
    }
    setLoadBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/api/vault/card-load/external", {
        method: "POST",
        body: JSON.stringify({
          endpoint: externalEndpoint,
          apiKey: externalApiKey,
          providerName: externalProviderName.trim(),
          providerAccount: externalProviderAccount.trim(),
          environment: externalEnvironment,
          sourceReference: externalSourceReference,
          fundingMethod,
          cardId: externalCardId,
          currency: externalCardId === "usd" ? "USD" : "EUR",
          amount: amt,
          sourceDetails: {
            sourceCardReference,
            sourceServerReference,
            sourceBankName,
            sourceBankReference,
            sourceBankSenderName,
            sourceBankAccountReference,
            transferType: sourceTransferType,
            transferNetworkCode: sourceTransferNetworkCode.trim() || undefined,
            sourceWalletId,
            sourceWalletNetwork,
            sourceWalletTransactionId,
            sourceServerName,
            sourceServerAccount,
            sourceCardIssuer,
            sourceCardLast4,
          },
          note: loadNote || undefined,
        }),
      });
      setMessage(`External ${result.currency} card load confirmed by the provider.`);
      setLoadAmount(""); setLoadNote(""); setExternalSourceReference("");
      const hist = await api("/api/vault/card-loads");
      setLoadHistory(hist.loads || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "External card load failed");
    } finally {
      setLoadBusy(false);
    }
  };

  const handleMerchantTransfer = async () => {
    const amount = Number(transferAmount);
    if (!transferMerchantId.trim()) { setError("Enter a merchant ID"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a valid transfer amount"); return; }
    setTransferBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/api/vault/merchant-transfer", {
        method: "POST",
        body: JSON.stringify({
          merchantId: transferMerchantId.trim(),
          currency: transferCurrency,
          amount,
          reference: transferReference.trim() || undefined,
        }),
      });
      setMessage(`Funds transferred: ${fmtNum(result.amount, result.currency)}. Merchant balance: ${fmtNum(result.merchantBalanceAfter, result.currency)}.`);
      setTransferAmount(""); setTransferReference("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merchant transfer failed");
    } finally {
      setTransferBusy(false);
    }
  };

  const handleProviderConnect = async () => {
    if (!providerEndpoint.trim() || !providerApiKey.trim()) {
      setProviderConnectError("Endpoint URL and API Key are required");
      return;
    }
    setProviderConnecting(true);
    setProviderConnectError("");
    setProviderConnected(false);
    try {
      const r = await api("/api/vault/provider-connect-test", {
        method: "POST",
        body: JSON.stringify({ endpointUrl: providerEndpoint.trim(), apiKey: providerApiKey.trim(), secretKey: providerSecretKey.trim() }),
      });
      if (r.ok) {
        setProviderConnected(true);
        setProviderConnectError("");
      } else {
        setProviderConnectError(r.error || "Connection failed");
      }
    } catch (e) {
      setProviderConnectError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setProviderConnecting(false);
    }
  };

  const handleProviderSend = async () => {
    const amount = Number(transferAmount);
    if (!transferMerchantId.trim()) { setProviderConnectError("Enter Merchant ID"); return; }
    if (!amount || amount <= 0) { setProviderConnectError("Enter valid amount"); return; }
    setProviderSending(true);
    setProviderConnectError("");
    setProviderSendResult(null);
    try {
      const r = await api("/api/vault/provider-transfer", {
        method: "POST",
        body: JSON.stringify({
          endpointUrl: providerEndpoint.trim(),
          apiKey: providerApiKey.trim(),
          secretKey: providerSecretKey.trim(),
          merchantId: transferMerchantId.trim(),
          amount,
          currency: transferCurrency,
          reference: transferReference.trim() || undefined,
        }),
      });
      setProviderSendResult(r);
      setTransferAmount("");
      setTransferReference("");
      setProviderConnected(false);
      await load();
    } catch (e) {
      setProviderConnectError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setProviderSending(false);
    }
  };

  // ── Crypto On-Ramp (Transak VBA + Live Buy) tab ──────────────────────────
  const renderOnRamp = () => {
    const authReady = Boolean(transakAccessToken || transakAuthRelianceEmail);
    const vbaReady = authReady && walletVerified === "true";

    return (
      <div className="space-y-5">
        {/* Production banner + widget quick launch */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
          <div className="space-y-5">
            <Card title="Live Crypto Purchase — Transak Widget" action={<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />PRODUCTION</span>}>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-600">Launch the Transak hosted widget for the merchant or any customer to buy crypto instantly with a card or bank transfer. Uses the live Transak production rail with the configured partner keys.</p>
                <div className="grid gap-3 md:grid-cols-5">
                  <input value={onrampMerchantId} onChange={e => setOnrampMerchantId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Merchant ID" />
                  <select value={transakPresets.defaultFiatCurrency} onChange={e => setTransakPresets(p => ({ ...p, defaultFiatCurrency: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option>USD</option><option>EUR</option><option>GBP</option><option>AED</option><option>SGD</option><option>INR</option>
                  </select>
                  <select value={transakPresets.defaultCryptoCurrency} onChange={e => setDestAsset(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option>BTC</option><option>ETH</option><option>USDT</option><option>USDC</option><option>SOL</option><option>BNB</option><option>MATIC</option><option>XRP</option><option>ADA</option><option>DOGE</option>
                  </select>
                  <input type="number" min="0" step="1" placeholder="Preset amount (optional)" value={transakPresets.defaultFiatAmount ?? ''} onChange={e => setTransakPresets(p => ({ ...p, defaultFiatAmount: e.target.value ? Number(e.target.value) : undefined }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <button onClick={() => openTransakWidget("BUY")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 shadow shadow-indigo-500/20">
                    <ExternalLink size={15} /> Open Buy Widget
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Network for preset coin</label>
                    <select value={destNetwork} onChange={e => setDestNetwork(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="bitcoin">BTC · Bitcoin</option>
                      <option value="ethereum">ETH · Ethereum (ERC-20)</option>
                      <option value="tron">USDT · Tron (TRC-20)</option>
                      <option value="bsc">BNB / USDT · BSC (BEP-20)</option>
                      <option value="polygon">MATIC / USDT · Polygon</option>
                      <option value="solana">SOL · Solana</option>
                      <option value="ripple">XRP · Ripple</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Destination wallet (optional — prefill)</label>
                    <input value={destAddress} onChange={e => { setDestAddress(e.target.value); setWalletVerified(""); }} placeholder="e.g. TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP (TRC-20)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                  <button onClick={() => openTransakWidget("BUY")} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"><Coins size={13} /> Merchant Buy Crypto</button>
                  <button onClick={() => openTransakWidget("BUY")} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"><QrCode size={13} /> Merchant Buy (Sell inside)</button>
                  <button onClick={() => { void handleVerifyMerchantWalletAddress(); }} disabled={!destAddress || onrampBusy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"><Shield size={13} /> Verify wallet address</button>
                </div>
              </div>
            </Card>

            {/* VBA creation — auth section */}
            <Card title="Open Transak Virtual Account (Bank Transfer)">
              <div className="p-5 space-y-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><KeyRound size={13} /> Step 1 — Authenticate merchant with Transak</p>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] items-end">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Merchant / Operator Email</label>
                      <input type="email" value={merchantEmail} onChange={e => setMerchantEmail(e.target.value)} placeholder="ops@primestack-tech.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <button onClick={() => void handleSendMerchantOtp()} disabled={onrampBusy || !merchantEmail.trim()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"><Mail size={13} /> Send OTP</button>
                    <button onClick={() => void handleOnboardMerchantAuthReliance()} disabled={onrampBusy || !merchantEmail.trim()} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-40"><ShieldCheck size={13} /> Auth Reliance</button>
                    {transakOtpSent && (
                      <div className="flex items-end gap-2">
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">6-digit Code</label>
                          <input value={transakOtp} onChange={e => setTransakOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="123456" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest w-32" />
                        </div>
                        <button onClick={() => void handleVerifyMerchantOtp()} disabled={onrampBusy || !transakOtp.trim()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">Verify</button>
                      </div>
                    )}
                  </div>
                  {authReady && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs">
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><Check size={13} /> Session active</span>
                      <span className="text-emerald-600">{transakAuthRelianceEmail || merchantEmail}</span>
                      {transakKycStatus && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold border border-emerald-200 text-emerald-700">KYC: {transakKycStatus}{transakKycType ? ` · ${transakKycType}` : ''}</span>}
                      {transakLimits.daily && <span className="text-emerald-600 font-mono">Limits: {transakLimits.daily}/d · {transakLimits.monthly}/m · {transakLimits.yearly}/y</span>}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><Wallet size={13} /> Step 2 — Choose fiat source (VBA currency &amp; rail)</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Fiat Currency</label>
                      <select value={fiatCurrency} onChange={e => setFiatCurrency(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="USD">USD · US Dollar</option>
                        <option value="EUR">EUR · Euro</option>
                        <option value="GBP">GBP · British Pound</option>
                        <option value="AED">AED · UAE Dirham</option>
                        <option value="SGD">SGD · Singapore Dollar</option>
                        <option value="INR">INR · Indian Rupee</option>
                        <option value="ZAR">ZAR · South African Rand</option>
                        <option value="NGN">NGN · Nigerian Naira</option>
                        <option value="KES">KES · Kenyan Shilling</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Payment Method (Rail)</label>
                      <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="gbp_bank_transfer">GBP · UK Bank Transfer (Faster Payments)</option>
                        <option value="sepa_bank_transfer">EUR · SEPA Bank Transfer</option>
                        <option value="us_bank_transfer">USD · US ACH Bank Transfer</option>
                        <option value="apple_pay">Apple Pay (card)</option>
                        <option value="google_pay">Google Pay (card)</option>
                        <option value="credit_debit_card">Credit / Debit Card</option>
                        <option value="aed_bank_transfer">AED · UAE Bank Transfer</option>
                        <option value="sgd_bank_transfer">SGD · Singapore Bank Transfer</option>
                        <option value="inr_bank_transfer">INR · India UPI / Bank</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><Coins size={13} /> Step 3 — Crypto destination (where Transak will deliver the coins)</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Crypto Asset</label>
                      <select value={destAsset} onChange={e => { setDestAsset(e.target.value); setWalletVerified(""); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option>USDT</option><option>USDC</option><option>BTC</option><option>ETH</option>
                        <option>SOL</option><option>BNB</option><option>MATIC</option><option>XRP</option>
                        <option>ADA</option><option>DOGE</option><option>AVAX</option><option>LINK</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Network</label>
                      <select value={destNetwork} onChange={e => { setDestNetwork(e.target.value); setWalletVerified(""); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="tron">Tron (TRC-20)</option>
                        <option value="ethereum">Ethereum (ERC-20)</option>
                        <option value="bsc">BNB Chain (BEP-20)</option>
                        <option value="polygon">Polygon</option>
                        <option value="bitcoin">Bitcoin</option>
                        <option value="solana">Solana</option>
                        <option value="ripple">Ripple</option>
                        <option value="cardano">Cardano</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 min-w-0">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Wallet Address (Trust Wallet etc.)</label>
                        <input value={destAddress} onChange={e => { setDestAddress(e.target.value); setWalletVerified(""); }} placeholder="T-addr / 0x-addr / bc1…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono truncate" />
                      </div>
                      <button onClick={() => void handleVerifyMerchantWalletAddress()} disabled={onrampBusy || !destAddress.trim()} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 whitespace-nowrap"><Shield size={13} /> Verify</button>
                    </div>
                  </div>
                  {walletVerified === "true" && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 flex items-center gap-2">
                      <Check size={14} className="shrink-0" /> Address verified — Transak confirmed this {destAsset} address on {destNetwork} is valid for delivery.
                    </div>
                  )}
                  {walletVerified === "false" && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center gap-2">
                      <X size={14} className="shrink-0" /> Address REJECTED by Transak. Double-check {destAsset} vs {destNetwork} network format.
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-500">
                    {vbaReady ? <span className="font-bold text-emerald-600"><Check size={12} className="inline mr-1" /> All checks passed — VBA is ready to be opened</span> : "Complete Steps 1–3 and verify the wallet address before opening."}
                  </div>
                  <button onClick={() => void handleCreateVirtualAccount()} disabled={onrampBusy || !vbaReady} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40 shadow-lg shadow-indigo-500/25">
                    <Coins size={16} /> {onrampBusy ? "Opening Virtual Account…" : "Open Transak Virtual Account"}
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* VBA list (right column) — premium black physical card style */}
          <Card
            title="Virtual Accounts — Open &amp; Active"
            action={
              <button onClick={() => void loadVirtualAccounts()} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50">
                <RefreshCw size={12} /> Refresh
              </button>
            }
          >
            <div className="space-y-5 p-5 max-h-[900px] overflow-y-auto">
              {virtualAccounts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-xs text-gray-500">
                  No Virtual Accounts yet. Complete the form on the left to open your first Transak VBA.
                </div>
              )}

              {virtualAccounts.map((t) => {
                const acc = t.accountDetails && typeof t.accountDetails === "string"
                  ? (() => { try { return JSON.parse(t.accountDetails); } catch { return {}; } })()
                  : t.accountDetails || {};
                const source = acc.source || {};
                const dest = acc.destination || {};
                const provider = acc.accountDetails || acc.providerAccount || acc.provider || {};
                const accountNumber = String(provider.accountNumber || source.accountNumber || acc.virtualAccountId || t.virtualAccountId || "0000000000000000").replace(/\D/g, "");
                const bankName = String(provider.bankName || source.bankName || "TRANSAK VIRTUAL BANK").toUpperCase();
                const routing = String(provider.routingNumber || provider.sortCode || provider.ifsc || "").replace(/\D/g, "");
                const holder = (provider.accountHolderName || provider.beneficiaryName || provider.beneficiary || "TRANSAK COLLECTIONS").toString().toUpperCase();
                const ref = String(provider.referenceNumber || provider.paymentReference || acc.message || t.id || "");
                const fiat = (source.fiatCurrency || t.currency || "USD").toUpperCase();
                const cryptoCoin = (dest.cryptoCurrency || "USDT").toUpperCase();
                const cryptoNet = (dest.network || "tron").toUpperCase();
                const status = (t.status || "INITIATED").toString().toUpperCase();
                const created = new Date(t.createdAt || t.created_at || Date.now());

                // Split the account number into 4 groups (matching the credit card mask pattern 1234 5678 9012 3456)
                const digitsOnly = accountNumber.replace(/\D/g, "").padEnd(16, "0").slice(0, 16);
                const groups = [digitsOnly.slice(0, 4), digitsOnly.slice(4, 8), digitsOnly.slice(8, 12), digitsOnly.slice(12, 16)];

                // Name split (first/last)
                const holderWords = holder.split(/\s+/).filter(Boolean);
                const holderFirstName = holderWords[0] || "NAME";
                const holderLastName = holderWords.slice(1).join(" ") || "SURNAME";

                // Card validity — "valid thru" style
                const mm = String(created.getMonth() + 1).padStart(2, "0");
                const yyShort = String(created.getFullYear()).slice(-2);
                const validThru = `${mm}/${(Number(yyShort) + 5).toString().padStart(2, "0")}`;

                return (
                  <div key={t.id}>
                    {/* ── Outer GREY SETTLEMENT BANK CARD HOLDER (like screenshot) ── */}
                    <div className="relative rounded-3xl overflow-hidden shadow-[0_18px_45px_-18px_rgba(15,23,42,0.55)] border border-slate-300/60"
                      style={{
                        background: "linear-gradient(135deg, #e8eaed 0%, #bcc2c9 32%, #9ea4ad 60%, #b0b6be 82%, #c6cbd2 100%)",
                      }}
                    >
                      {/* soft decorative circles */}
                      <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/15 blur-2xl" />
                      <div className="pointer-events-none absolute -left-16 top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                      <div className="pointer-events-none absolute right-1/3 top-1/2 h-56 w-56 rounded-full border border-white/20" />
                      <div className="pointer-events-none absolute right-[35%] top-[55%] h-40 w-40 rounded-full border border-white/15" />

                      <div className="relative p-5 space-y-4">
                        {/* Row 1 — Top headers: CREDIT CARD + BANK NAME */}
                        <div className="flex items-start justify-between">
                          <div className="leading-tight">
                            <div className="text-[13px] font-black tracking-[0.32em] text-slate-700">CREDIT</div>
                            <div className="text-[13px] font-black tracking-[0.32em] text-slate-700 mt-0.5">CARD</div>
                          </div>
                          <div className="leading-tight text-right max-w-[70%]">
                            <div className="text-[12px] font-black tracking-[0.22em] text-slate-700 truncate">
                              {bankName.length > 30 ? bankName.slice(0, 30) : bankName}
                            </div>
                          </div>
                        </div>

                        {/* Row 2 — CHIP + contactless waves + STATUS pill */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Gold EMV chip */}
                            <div
                              className="h-[54px] w-[66px] rounded-[10px] border border-amber-700/70 relative overflow-hidden shadow-inner"
                              style={{
                                background:
                                  "linear-gradient(135deg, #f6d77a 0%, #e0b340 30%, #b98314 55%, #e2b443 78%, #f8dd89 100%)",
                              }}
                            >
                              <div className="absolute inset-[10px] grid grid-cols-3 grid-rows-3 gap-[3px] opacity-70">
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                                <div className="border border-amber-900/40 rounded-sm" />
                              </div>
                              {/* chip contacts highlight */}
                              <div className="absolute left-0 right-0 top-1/3 h-[1px] bg-amber-100/80" />
                              <div className="absolute left-0 right-0 top-2/3 h-[1px] bg-amber-100/80" />
                            </div>
                            {/* NFC / contactless waves */}
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-slate-600/85">
                              <path d="M5.5 8.5a7 7 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              <path d="M8.2 6.2a11 11 0 0 1 0 11.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              <path d="M10.9 3.9a14.5 14.5 0 0 1 0 16.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          </div>
                          {/* Status pill — "EMPTY" style pill, shows live status */}
                          <div
                            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-black tracking-wider border"
                            style={{
                              background: status === "COMPLETED" || status === "ACTIVE" ? "rgba(5, 150, 105, 0.14)" :
                                         status === "PENDING" || status === "INITIATED" ? "rgba(245, 158, 11, 0.14)" :
                                         status === "FAILED" || status === "REJECTED" ? "rgba(220, 38, 38, 0.12)" :
                                         "rgba(30, 41, 59, 0.12)",
                              borderColor:
                                status === "COMPLETED" || status === "ACTIVE" ? "rgba(5, 150, 105, 0.35)" :
                                status === "PENDING" || status === "INITIATED" ? "rgba(245, 158, 11, 0.35)" :
                                status === "FAILED" || status === "REJECTED" ? "rgba(220, 38, 38, 0.35)" :
                                "rgba(30, 41, 59, 0.3)",
                              color:
                                status === "COMPLETED" || status === "ACTIVE" ? "#047857" :
                                status === "PENDING" || status === "INITIATED" ? "#b45309" :
                                status === "FAILED" || status === "REJECTED" ? "#b91c1c" :
                                "#1e293b",
                            }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{
                              background:
                                status === "COMPLETED" || status === "ACTIVE" ? "#10b981" :
                                status === "PENDING" || status === "INITIATED" ? "#f59e0b" :
                                status === "FAILED" || status === "REJECTED" ? "#ef4444" :
                                "#64748b",
                              boxShadow: "0 0 0 2px rgba(255,255,255,0.35)",
                            }} />
                            {status}
                          </div>
                        </div>

                        {/* ── Inner BLACK GLOSSY CARD (physical credit card embedded) ── */}
                        <div className="relative">
                          {/* tiny decorative dot mask row — matches screenshot "Credit Card..... Bank Name" dots across top of inner card */}
                          <div className="absolute -top-1.5 left-0 right-0 flex justify-between px-4 z-10 pointer-events-none">
                            <div className="flex gap-1.5">
                              {[...Array(8)].map((_, i) => (
                                <span key={"dl" + i} className="h-1.5 w-1.5 rounded-full bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
                              ))}
                            </div>
                            <div className="flex gap-1.5">
                              {[...Array(4)].map((_, i) => (
                                <span key={"dr" + i} className="h-1.5 w-1.5 rounded-full bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
                              ))}
                            </div>
                          </div>

                          <div
                            className="relative rounded-[22px] overflow-hidden border border-black/60 shadow-[0_22px_50px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)]"
                            style={{
                              background:
                                "radial-gradient(110% 75% at 20% 0%, #3f4550 0%, #1a1c21 28%, #0a0b0e 55%, #12141a 82%, #1c1e24 100%)",
                            }}
                          >
                            {/* glossy highlights */}
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/[0.02]" />
                            <div className="pointer-events-none absolute -left-12 -top-10 h-48 w-48 rounded-full bg-white/[0.08] blur-2xl" />
                            <div className="pointer-events-none absolute right-[-10%] top-[12%] h-56 w-56 rounded-full bg-indigo-400/[0.10] blur-3xl" />

                            <div className="relative p-5 space-y-4">
                              {/* row: inner Credit Card label + mini chip */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div
                                    className="h-[38px] w-[46px] rounded-[7px] border border-amber-600/60 relative"
                                    style={{
                                      background: "linear-gradient(135deg, #e7c267 0%, #b98314 55%, #e2b443 100%)",
                                    }}
                                  >
                                    <div className="absolute inset-[7px] grid grid-cols-2 grid-rows-2 gap-[3px] opacity-70">
                                      <div className="border border-amber-900/50 rounded-sm" />
                                      <div className="border border-amber-900/50 rounded-sm" />
                                      <div className="border border-amber-900/50 rounded-sm" />
                                      <div className="border border-amber-900/50 rounded-sm" />
                                    </div>
                                  </div>
                                  <span className="text-[17px] font-black tracking-[0.08em] text-white/55 uppercase">
                                    {cryptoCoin} Card
                                  </span>
                                </div>
                                <span className="text-[15px] font-bold tracking-[0.12em] text-white/55 uppercase truncate max-w-[40%]">
                                  {fiat}
                                </span>
                              </div>

                              {/* ── BIG PAN styled NUMBER GROUPS — screenshot mask pattern ── */}
                              <div className="flex items-baseline justify-between gap-2 pt-1">
                                <div className="flex items-center gap-[10px] md:gap-[14px] flex-wrap">
                                  <span className="font-mono text-[22px] md:text-[26px] font-black tracking-[0.22em] text-slate-200 drop-shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                                    {groups[0]}
                                  </span>
                                  <span className="font-mono text-[22px] md:text-[26px] font-black tracking-[0.22em] text-white/90 drop-shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                                    {groups[1]}
                                  </span>
                                  <span className="font-mono text-[22px] md:text-[26px] font-black tracking-[0.22em] text-white/90 drop-shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                                    {groups[2]}
                                  </span>
                                  <span className="font-mono text-[22px] md:text-[26px] font-black tracking-[0.22em] text-amber-200 drop-shadow-[0_1px_0_rgba(255,255,255,0.05)]">
                                    {groups[3]}
                                  </span>
                                </div>
                                {/* routing / sort code in faint mono to the right */}
                                {routing && (
                                  <div className="hidden md:flex flex-col items-end shrink-0">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Sort / IFSC</span>
                                    <span className="font-mono text-[13px] font-bold text-white/65">{routing.slice(0, 3)} {routing.slice(3)}</span>
                                  </div>
                                )}
                              </div>

                              {/* Name + VALID THRU row — mask matches screenshot NAME Surname */}
                              <div className="flex items-end justify-between pt-1">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-black uppercase tracking-[0.32em] text-white/40 mb-1">
                                    Name Surname
                                  </div>
                                  <div className="text-[19px] md:text-[21px] font-black tracking-[0.02em] text-white leading-tight truncate">
                                    {holderFirstName} <span className="font-black text-white">{holderLastName}</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0 pl-3">
                                  <div className="text-[9px] font-black uppercase tracking-[0.28em] text-white/40 mb-1">
                                    VALID&nbsp;&nbsp;THRU
                                  </div>
                                  <div className="inline-flex items-center gap-1">
                                    <span className="text-[9px] font-black uppercase tracking-[0.28em] text-white/40">THRU</span>
                                    <span className="text-[18px] font-black text-amber-100 tabular-nums tracking-[0.1em]">{validThru}</span>
                                  </div>
                                </div>
                              </div>

                              {/* bottom mask dots */}
                              <div className="flex justify-end gap-1.5 pt-1">
                                {[...Array(2)].map((_, i) => (
                                  <span key={"b1-" + i} className="h-1.5 w-1.5 rounded-full bg-white/80" />
                                ))}
                                <span className="h-1.5 w-3 rounded-md bg-white/80 mx-0.5" />
                                {[...Array(2)].map((_, i) => (
                                  <span key={"b2-" + i} className="h-1.5 w-1.5 rounded-full bg-white/80" />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Row 4 — AMOUNT / PROTOCOL (as per screenshot) */}
                        <div className="flex items-end justify-between pt-1">
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-700 mb-1">Amount</div>
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-6 rounded-sm bg-slate-700/70" />
                              <span className="h-1.5 w-6 rounded-sm bg-slate-700/70" />
                              <span className="h-1.5 w-6 rounded-sm bg-slate-700/70" />
                              <span className="text-[10px] italic text-slate-600 ml-2">fund with bank transfer</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-700 mb-1">Protocol</div>
                            <div className="flex items-center gap-2 justify-end">
                              <span className="rounded-md bg-slate-900/85 px-2.5 py-1 text-[13px] font-black text-white shadow-inner tracking-wider">
                                {fiat}
                              </span>
                              <span className="rounded-md bg-gradient-to-br from-indigo-600 to-violet-600 px-2.5 py-1 text-[12px] font-black text-white shadow-md tracking-wider">
                                → {cryptoCoin}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Row 5 — Payment reference strip */}
                        {ref && (
                          <div className="flex items-center justify-between rounded-xl border border-slate-500/40 bg-white/30 backdrop-blur-sm px-4 py-2.5">
                            <div className="min-w-0">
                              <div className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-700 mb-0.5">Payment Reference</div>
                              <div className="font-mono text-[13px] font-bold text-slate-900 truncate">{ref}</div>
                            </div>
                            <button
                              onClick={() => { void navigator.clipboard.writeText(ref); setMessage("Payment reference copied"); }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-600/40 bg-white/60 px-2.5 py-1 text-[10px] font-bold text-slate-800 hover:bg-white shrink-0 ml-3"
                            >
                              <Copy size={11} /> COPY
                            </button>
                          </div>
                        )}

                        {/* Row 6 — VIEW DETAILS + ACTION buttons */}
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <button
                            onClick={() => { setDestAsset(dest.cryptoCurrency || "USDT"); setDestNetwork(dest.network || "tron"); setFiatCurrency(source.fiatCurrency || "USD"); openTransakWidget("BUY"); }}
                            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900/90 px-6 py-3 text-[13px] font-black tracking-[0.22em] text-white hover:bg-slate-900 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.85)]"
                          >
                            <Coins size={14} /> BUY {cryptoCoin}
                          </button>
                          <button
                            onClick={() => { accountNumber && navigator.clipboard.writeText(accountNumber); setMessage(accountNumber ? "Account number copied" : "No account number yet"); }}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-500/50 bg-white/40 px-5 py-3 text-[13px] font-black tracking-[0.2em] text-slate-800 hover:bg-white/70 backdrop-blur-sm"
                          >
                            <Copy size={14} /> COPY ACCOUNT
                          </button>
                          <div className="ml-auto flex items-center gap-2 text-right">
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600">NET</div>
                              <div className="text-[11px] font-bold text-slate-800">{cryptoNet}</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600">MERCHANT</div>
                              <div className="text-[11px] font-bold text-slate-800">{t.merchantId || onrampMerchantId}</div>
                            </div>
                            <div>
                              <div className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-600">OPENED</div>
                              <div className="text-[11px] font-bold text-slate-800 tabular-nums">{created.toLocaleDateString()}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  // ── Overview tab ────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-emerald-800">Vault Custody Reserve</p>
            <p className="mt-1 text-xs text-emerald-700">Provider-confirmed funds only. This is the application control ledger for segregated regulated custody accounts.</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-800">USD / EUR segregated</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ["USD", data.custodyUsd],
            ["EUR", data.custodyEur],
          ] as const).map(([currency, reserve]) => (
            <div key={currency} className="rounded-xl border border-emerald-200 bg-white p-3">
              <p className="text-xs font-black text-gray-500">{currency} reserve</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-gray-500">Available</p><p className="font-extrabold text-gray-900">{Number(reserve?.available || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
                <div><p className="text-gray-500">Pending</p><p className="font-extrabold text-amber-700">{Number(reserve?.pending || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
                <div><p className="text-gray-500">Settled</p><p className="font-extrabold text-emerald-700">{Number(reserve?.settled || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Confirmed USD available to send", stats.totalVaultBalance ?? 0],
          ["Merchant liabilities", stats.totalMerchantBalances ?? 0],
          ["Pending settlements", stats.totalPendingSettlement ?? 0],
          ["Pending payouts", stats.totalPendingPayouts ?? 0],
        ] as [string, number][]).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-3 text-2xl font-extrabold text-gray-900">{Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        The vault balance above includes only externally confirmed funds that are eligible for transfer to the vault bank.
        Internal ledger balances are not included.
      </p>

      <EmvChipPanel auditRows={Array.isArray(data.audit?.events) ? data.audit.events : Array.isArray(data.audit) ? data.audit : []} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <VaultBankCard
          revealedDetails={vaultCardDetails.usd ? {
            cardNumber: String(vaultCardDetails.usd.cardNumber || ""),
            expiry: String(vaultCardDetails.usd.expiry || ""),
            cvv: String(vaultCardDetails.usd.cvv || ""),
            cardholderName: String(vaultCardDetails.usd.cardholderName || ""),
          } : null}
          detailsBusy={vaultCardDetailsBusy}
          detailsError={vaultCardDetailsError}
          onLoadDetails={() => void loadVaultCardDetails()}
          currency="USD"
          metal="silver"
        />
        <VaultBankCard
          holderName="DANIA ALOSIOUS"
          maskedPan="4532 01•• •••• 1068"
          expiry="06/29"
          currency="EUR"
          metal="gold"
          revealedDetails={vaultCardDetails.eur ? {
            cardNumber: String(vaultCardDetails.eur.cardNumber || ""),
            expiry: String(vaultCardDetails.eur.expiry || ""),
            cvv: String(vaultCardDetails.eur.cvv || ""),
            cardholderName: String(vaultCardDetails.eur.cardholderName || ""),
          } : null}
          detailsBusy={vaultCardDetailsBusy}
          detailsError={vaultCardDetailsError}
          onLoadDetails={() => void loadVaultCardDetails()}
        />
      </div>

      <Card title="Send merchant funds to vault bank">
        <div className="grid gap-3 p-5 md:grid-cols-5">
          <input value={transferMerchantId} onChange={e => setTransferMerchantId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Merchant ID" />
          <select value={transferCurrency} onChange={e => setTransferCurrency(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option>USD</option><option>EUR</option><option>GBP</option>
          </select>
          <input value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" type="number" min="0.01" step="0.01" placeholder="Amount" />
          <input value={transferReference} onChange={e => setTransferReference(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Reference (optional)" />
          <button onClick={() => void handleMerchantTransfer()} disabled={transferBusy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Send size={15} /> {transferBusy ? "Sending…" : "Send to Vault Bank"}
          </button>
        </div>
        <p className="px-5 pb-5 text-xs text-gray-500">Transfers from merchant wallet directly to vault bank ledger. No external API required.</p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        {/* Balances table */}
        <Card title="Confirmed sendable balances by currency">
          <DataTable
            columns={["currency", "balance", "available", "reserved"]}
            rows={realFundCurrencies.map((row: AnyRecord) => ({
              currency:  row.currency,
              balance:   fmtNum(row.confirmed ?? row.confirmedAmount ?? row.available ?? 0),
              available: fmtNum(row.available ?? 0),
              reserved:  fmtNum(row.reserved ?? row.reserve ?? 0),
            }))}
          />
        </Card>

        <div className="space-y-5">
          {/* API key */}
          <Card title="Vault access key" action={<ShieldCheck size={17} className="text-emerald-600" />}>
            <ApiKeyPanel
              securityKey={data.securityKey}
              onRotate={() => void runAction(
                () => api("/api/vault/security/api-key/rotate", { method: "POST", body: JSON.stringify({ label: "Vault gateway" }) }),
                "API key rotated"
              )}
            />
          </Card>

          {false && <Card title="Operator Cards">
            <div className="p-5 space-y-5">
              {(() => {
                const usd = getVaultAccountMeta("USD");
                const eur = getVaultAccountMeta("EUR");
                const usdCard = generatedCards.USD;
                const eurCard = generatedCards.EUR;
                return (
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* USD Card */}
                    <div className="space-y-3">
                      <OperatorCard
                        currency="USD"
                        loaded={cardLoads.USD}
                        card={{
                          number: usdCard?.card_number_formatted || usdCard?.card_number || "•••• •••• •••• ••••",
                          cvv:    usdCard?.cvv || "•••",
                          expiry: usdCard ? `${usdCard?.expiry_month}/${usdCard?.expiry_year}` : "••/••",
                        }}
                        bankName={usd.bankName}
                        lastFour={usdCard?.card_number?.slice(-4) || usd.lastFour}
                        simpleLayout
                      />
                      <button
                        type="button"
                        onClick={() => void generateCard("USD")}
                        disabled={genBusy.USD}
                        className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest transition"
                      >
                        {genBusy.USD ? "⏳ Generating..." : usdCard ? "🔄 Regenerate USD Card" : "✨ Generate USD Card"}
                      </button>
                      {usdCard && (
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono space-y-1">
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Number</span><span className="font-bold">{usdCard?.card_number_formatted || usdCard?.card_number}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Expiry</span><span className="font-bold">{usdCard?.expiry_month}/{usdCard?.expiry_year}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">CVV</span><span className="font-bold">{usdCard?.cvv}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Luhn</span><span className="font-bold text-emerald-600">{usdCard?.luhn_valid !== false ? "✅ Valid" : "❌ Invalid"}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Scheme</span><span className="font-bold">{usdCard?.scheme || "VISA"}</span></div>
                        </div>
                      )}
                    </div>
                    {/* EUR Card */}
                    <div className="space-y-3">
                      <OperatorCard
                        currency="EUR"
                        loaded={cardLoads.EUR}
                        card={{
                          number: eurCard?.card_number_formatted || eurCard?.card_number || "•••• •••• •••• ••••",
                          cvv:    eurCard?.cvv || "•••",
                          expiry: eurCard ? `${eurCard?.expiry_month}/${eurCard?.expiry_year}` : "••/••",
                        }}
                        bankName={eur.bankName}
                        lastFour={eurCard?.card_number?.slice(-4) || eur.lastFour}
                        simpleLayout
                      />
                      <button
                        type="button"
                        onClick={() => void generateCard("EUR")}
                        disabled={genBusy.EUR}
                        className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest transition"
                      >
                        {genBusy.EUR ? "⏳ Generating..." : eurCard ? "🔄 Regenerate EUR Card" : "✨ Generate EUR Card"}
                      </button>
                      {eurCard && (
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono space-y-1">
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Number</span><span className="font-bold">{eurCard?.card_number_formatted || eurCard?.card_number}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Expiry</span><span className="font-bold">{eurCard?.expiry_month}/{eurCard?.expiry_year}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">CVV</span><span className="font-bold">{eurCard?.cvv}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Luhn</span><span className="font-bold text-emerald-600">{eurCard?.luhn_valid !== false ? "✅ Valid" : "❌ Invalid"}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500 uppercase tracking-wider">Scheme</span><span className="font-bold">{eurCard?.scheme || "VISA"}</span></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <p className="px-5 pb-5 text-xs leading-5 text-gray-500">
              Cards are Luhn-valid virtual cards generated by your processor. Click Generate to create a new card. Tap CVV on the card to reveal/hide.
            </p>
          </Card>}
        </div>
      </div>
    </div>
  );

  // ── Fund Card tab ────────────────────────────────────────────────────────────
  const renderCardLoad = () => {
    // Group vault balances by currency for the summary table
    const vaultByCurrency = realFundCurrencies.reduce((acc, a) => {
      const ccy = String(a.currency || 'USD');
      if (!acc[ccy]) acc[ccy] = 0;
      acc[ccy] += Number(a.available || 0);
      return acc;
    }, {} as Record<string, number>);

    const summaryRows = Object.entries(vaultByCurrency).map(([ccy, bal]) => ({
      currency: ccy,
      vault_balance: fmtNum(bal, ccy),
      available_to_load: fmtNum(bal, ccy),
      status: bal > 0 ? '● Available' : '○ Empty',
    }));

    const selectedCard = selectedLoadingCard === "usd"
      ? {
          holderName: "AJI ALOSIOUS",
          maskedPan: "4165 98•• •••• 9610",
          expiry: "05/30",
          currency: "USD" as const,
          metal: "silver" as const,
          details: vaultCardDetails.usd,
        }
      : selectedLoadingCard === "eur"
        ? {
            holderName: "DANIA ALOSIOUS",
            maskedPan: "4532 01•• •••• 1068",
            expiry: "06/29",
            currency: "EUR" as const,
            metal: "gold" as const,
            details: vaultCardDetails.eur,
          }
        : null;

    return (
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="xl:col-span-2">
          <Card title="Card Loading">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Choose the Vault Bank card that will receive the load.</p>
                <p className="mt-1 text-xs text-slate-500">Only authenticated Vault Bank administrators can select a card and initiate a load.</p>
              </div>
              <button
                type="button"
                onClick={() => setCardLoadingOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
              >
                <CreditCard size={16} /> Add card
              </button>
            </div>
          </Card>
        </div>

        {cardLoadingOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Choose card to load">
            <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900">Add card for loading</h3>
                  <p className="mt-1 text-xs text-slate-500">Select one card to add to this loading page.</p>
                </div>
                <button type="button" onClick={() => setCardLoadingOpen(false)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100">Close</button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {([
                  ["usd", "AJI ALOSIOUS", "USD", "4165 98•• •••• 9610", "bg-slate-100"],
                  ["eur", "DANIA ALOSIOUS", "EUR", "4532 01•• •••• 1068", "bg-amber-50"],
                ] as const).map(([id, name, currency, pan, tone]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setSelectedLoadingCard(id); setCardLoadingOpen(false); void loadVaultCardDetails(); }}
                    className={`rounded-2xl border border-slate-200 ${tone} p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md`}
                  >
                    <span className="block text-xs font-black uppercase tracking-[.2em] text-slate-500">{currency} card</span>
                    <span className="mt-3 block text-base font-extrabold text-slate-900">{name}</span>
                    <span className="mt-1 block font-mono text-sm text-slate-700">{pan}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedCard && (
          <div className="xl:col-span-2">
            <Card title={`Selected card · ${selectedCard.currency}`}>
              <div className="grid items-start gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
                <VaultBankCard
                  holderName={selectedCard.holderName}
                  maskedPan={selectedCard.maskedPan}
                  expiry={selectedCard.expiry}
                  currency={selectedCard.currency}
                  metal={selectedCard.metal}
                  revealedDetails={selectedCard.details ? {
                    cardNumber: String(selectedCard.details.cardNumber || ""),
                    expiry: String(selectedCard.details.expiry || ""),
                    cvv: String(selectedCard.details.cvv || ""),
                    cardholderName: String(selectedCard.details.cardholderName || ""),
                  } : null}
                  detailsBusy={vaultCardDetailsBusy}
                  detailsError={vaultCardDetailsError}
                  onLoadDetails={() => void loadVaultCardDetails()}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-extrabold text-slate-900">Loading instructions</h3>
                  <ol className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                    <li><strong>1. Identify the recipient:</strong> use the selected card and currency shown here.</li>
                    <li><strong>2. Use an approved funding source:</strong> send only from an authorized bank, processor, or internal treasury account.</li>
                    <li><strong>3. Include the reference:</strong> card currency, selected card label, amount, and your internal load reference.</li>
                    <li><strong>4. Confirm settlement:</strong> wait for the provider confirmation before recording the load.</li>
                  </ol>
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-4 text-amber-800">
                    Never send the CVV, PIN, or full card credentials to another software system or person. Use the approved funding endpoint and reference fields.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* LEFT — table + form */}
        <div className="space-y-5">

          {/* Summary table */}
          <Card title="Vault Fund Summary">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-bold">Currency</th>
                    <th className="px-4 py-3 font-bold">Confirmed Real Funds</th>
                    <th className="px-4 py-3 font-bold">Available to Load</th>
                    <th className="px-4 py-3 font-bold">Total</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.length ? summaryRows.map(row => (
                    <tr
                      key={row.currency}
                      onClick={() => setLoadCurrency(row.currency)}
                      className={`border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${loadCurrency === row.currency ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'hover:bg-gray-50/80'}`}
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${loadCurrency === row.currency ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                          <span className="font-bold text-gray-900">{row.currency}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700">{row.vault_balance}</td>
                      <td className="px-4 py-3 font-mono text-gray-700">{row.available_to_load}</td>
                      <td className="px-4 py-3 font-mono font-bold text-gray-900">{row.vault_balance}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${Number(vaultByCurrency[row.currency]) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No vault funds available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-5 pb-4 pt-2 text-xs text-gray-400">Only separately confirmed real funds can be loaded. Ledger balances are not eligible.</p>
          </Card>

          {/* Load form */}
          <Card title="Load Amount onto Card">
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Currency selector */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Currency</label>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(vaultByCurrency).length ? Object.keys(vaultByCurrency).map(ccy => (
                      <button
                        key={ccy}
                        type="button"
                        onClick={() => setLoadCurrency(ccy)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${loadCurrency === ccy ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}
                      >
                        {ccy}
                      </button>
                    )) : ['EUR','USD'].map(ccy => (
                      <button key={ccy} type="button" onClick={() => setLoadCurrency(ccy)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${loadCurrency === ccy ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}>
                        {ccy}
                      </button>
                    ))}
                  </div>
                  {loadCurrency && vaultByCurrency[loadCurrency] !== undefined && (
                    <p className="mt-2 text-xs text-gray-500">
                      Available: <span className="font-bold text-gray-700">{fmtNum(vaultByCurrency[loadCurrency], loadCurrency)}</span>
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">{loadCurrency}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={loadAmount}
                      onChange={e => setLoadAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  {loadAmount && loadCurrency && vaultByCurrency[loadCurrency] !== undefined && parseFloat(loadAmount) > vaultByCurrency[loadCurrency] && (
                    <p className="mt-1 text-xs text-red-500 font-semibold">⚠ Exceeds vault balance</p>
                  )}
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Note (optional)</label>
                <input
                  type="text"
                  value={loadNote}
                  onChange={e => setLoadNote(e.target.value)}
                  placeholder="e.g. Card load for JJ DUMBA settlement"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-indigo-800">Real-funds loading configuration</p>
                <p className="mt-1 text-xs text-indigo-700">Choose the funding route. The backend signs the provider request; do not enter PAN, CVV, PIN, or HMAC secrets here.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["card-to-card", "Card to card"],
                    ["server-to-card", "Server to card"],
                    ["bank-to-card", "Bank to card"],
                    ["wallet-to-card", "Wallet to card"],
                  ] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setFundingMethod(value)}
                      className={`rounded-lg border px-3 py-3 text-left text-xs font-extrabold transition ${fundingMethod === value ? "border-indigo-600 bg-indigo-700 text-white" : "border-indigo-200 bg-white text-indigo-800 hover:border-indigo-400"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-bold text-indigo-900">Provider name<input value={externalProviderName} onChange={e => setExternalProviderName(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Licensed bank, processor, or wallet provider" /></label>
                  <label className="text-xs font-bold text-indigo-900">Provider account / merchant ID<input value={externalProviderAccount} onChange={e => setExternalProviderAccount(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Account or merchant reference supplied by provider" /></label>
                  <label className="text-xs font-bold text-indigo-900">Provider HTTPS endpoint<input value={externalEndpoint} onChange={e => setExternalEndpoint(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="https://provider.example/load" /></label>
                  <label className="text-xs font-bold text-indigo-900">Provider API key<input value={externalApiKey} onChange={e => setExternalApiKey(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Public provider API key" type="password" /></label>
                  <label className="text-xs font-bold text-indigo-900">Provider environment<select value={externalEnvironment} onChange={e => setExternalEnvironment(e.target.value as "sandbox" | "production")} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"><option value="production">Production / real funds</option><option value="sandbox">Sandbox / test funds</option></select></label>
                  <label className="text-xs font-bold text-indigo-900">Source transfer / transaction reference<input value={externalSourceReference} onChange={e => setExternalSourceReference(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Provider transfer ID or settlement reference" /></label>
                  <label className="text-xs font-bold text-indigo-900">Target card<select value={externalCardId} onChange={e => { const id = e.target.value as "usd" | "eur"; setExternalCardId(id); setLoadCurrency(id === "usd" ? "USD" : "EUR"); }} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm">
                    <option value="usd">USD · AJI ALOSIOUS</option>
                    <option value="eur">EUR · DANIA ALOSIOUS</option>
                  </select></label>
                  {fundingMethod === "card-to-card" && <><label className="text-xs font-bold text-indigo-900">Source card token / reference<input value={sourceCardReference} onChange={e => setSourceCardReference(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Provider-issued token; never enter PAN or CVV" /></label><label className="text-xs font-bold text-indigo-900">Source card issuer (optional)<input value={sourceCardIssuer} onChange={e => setSourceCardIssuer(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Issuing bank or processor" /></label><label className="text-xs font-bold text-indigo-900">Source card last four (optional)<input value={sourceCardLast4} onChange={e => setSourceCardLast4(e.target.value.replace(/\D/g, "").slice(-4))} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Last 4 digits only" maxLength={4} /></label></>}
                  {fundingMethod === "server-to-card" && <><label className="text-xs font-bold text-indigo-900">Source server name<input value={sourceServerName} onChange={e => setSourceServerName(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Sending server or treasury system" /></label><label className="text-xs font-bold text-indigo-900">Source server / account reference<input value={sourceServerReference} onChange={e => setSourceServerReference(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Provider account reference" /></label><label className="text-xs font-bold text-indigo-900">Source account identifier<input value={sourceServerAccount} onChange={e => setSourceServerAccount(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Non-secret account or ledger identifier" /></label></>}
                  {fundingMethod === "bank-to-card" && <><label className="text-xs font-bold text-indigo-900">Transfer type<select value={sourceTransferType} onChange={e => setSourceTransferType(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"><option>SWIFT</option><option>SEPA</option><option>DOMESTIC</option><option>ACH</option><option>RTGS</option><option>IMPS</option><option>PIX</option><option>FASTER_PAYMENTS</option><option>FEDWIRE</option></select></label><label className="text-xs font-bold text-indigo-900">Transfer network code (optional)<input value={sourceTransferNetworkCode} onChange={e => setSourceTransferNetworkCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, ""))} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="SEPA SCT, SWIFT MT103, ACH PPD" /></label><label className="text-xs font-bold text-indigo-900">Sending bank name<input value={sourceBankName} onChange={e => setSourceBankName(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Sending bank or payment institution" /></label><label className="text-xs font-bold text-indigo-900">Bank transfer reference / UETR<input value={sourceBankReference} onChange={e => setSourceBankReference(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="UETR, end-to-end ID, ACH trace, or rail reference" /></label><label className="text-xs font-bold text-indigo-900">Sender name<input value={sourceBankSenderName} onChange={e => setSourceBankSenderName(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Name on the sending transfer" /></label><label className="text-xs font-bold text-indigo-900">Sender account reference (optional)<input value={sourceBankAccountReference} onChange={e => setSourceBankAccountReference(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="IBAN/account reference or last 4 only" /></label></>}
                  {fundingMethod === "wallet-to-card" && <><label className="text-xs font-bold text-indigo-900">Source wallet ID / provider token<input value={sourceWalletId} onChange={e => setSourceWalletId(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Provider wallet identifier" /></label><label className="text-xs font-bold text-indigo-900">Wallet network<input value={sourceWalletNetwork} onChange={e => setSourceWalletNetwork(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Provider network or rail" /></label><label className="text-xs font-bold text-indigo-900">Wallet transaction ID / hash<input value={sourceWalletTransactionId} onChange={e => setSourceWalletTransactionId(e.target.value)} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" placeholder="Confirmed provider transaction ID" /></label></>}
                </div>
                <div className="mt-3 rounded-lg border border-indigo-200 bg-white/70 p-3 text-xs text-indigo-900">
                  <strong>{fundingMethod === "card-to-card" ? "Card to card" : fundingMethod === "server-to-card" ? "Server to card" : fundingMethod === "bank-to-card" ? "Bank to card" : "Wallet to card"} instructions:</strong>{" "}
                  {fundingMethod === "card-to-card" ? "Provide a provider-issued source card token and transfer reference. Never provide the source PAN, CVV, or PIN."
                    : fundingMethod === "server-to-card" ? "Provide the sending server or treasury account reference and provider transfer reference. The provider must confirm settlement."
                    : fundingMethod === "bank-to-card" ? "Select the rail used by the sender, add its real network code when applicable, and enter the bank-generated UETR, end-to-end ID, ACH trace, or equivalent reference. A typed reference alone never credits funds."
                    : "Provide the source wallet ID or provider token and transfer reference. The provider must confirm available real funds before loading the card."}
                </div>
                <button type="button" onClick={() => void handleExternalCardLoad()} disabled={loadBusy} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  <Send size={15} /> {loadBusy ? "Calling provider…" : "Load confirmed funds"}
                </button>
              </div>

              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                Internal ledger transfers are disabled for Vault cards. Use only the external provider form above; a load is recorded only after the provider confirms the real funds.
              </p>

              {error && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-semibold"><X size={14} className="inline mr-1" />{error}</p>}
              {message && <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-semibold"><Check size={14} className="inline mr-1" />{message}</p>}
            </div>
          </Card>

          {/* Load history */}
          <Card title="Card Load History">
            <DataTable
              columns={["loaded_at", "currency", "amount", "funding_method", "transfer_type", "transfer_network_code", "source_reference", "provider_reference", "status"]}
              rows={loadHistory.map(r => ({
                loaded_at: r.loaded_at ? new Date(r.loaded_at).toLocaleString() : '-',
                currency:  r.currency,
                amount:    fmtNum(r.amount, r.currency),
                funding_method: r.funding_method || '-',
                transfer_type: r.transfer_type || '-',
                transfer_network_code: r.transfer_network_code || '-',
                source_reference: r.source_reference || '-',
                provider_reference: r.provider_reference || '-',
                status:    <StatusBadge value={r.status} />,
              }))}
              empty="No card loads yet. Use the form above to load vault funds onto the card."
            />
          </Card>
        </div>

        {/* RIGHT — loading guidance */}
        <div className="space-y-4">
          {/* Instructions */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-3 text-sm text-gray-600">
            <p className="font-bold text-gray-800 text-xs uppercase tracking-widest">How it works</p>
            <ol className="space-y-2 list-decimal list-inside text-xs leading-relaxed">
              <li>Select the USD or EUR card that will receive the funds.</li>
              <li>Choose the external route: card, server, bank, or wallet to card.</li>
              <li>Enter the provider endpoint, API key, transfer reference, amount, and route-specific source details.</li>
              <li>The provider must return a confirmed settlement for the exact card currency and amount.</li>
              <li>No internal ledger balance is used; the load is recorded only after external confirmation.</li>
            </ol>
          </div>

          {/* Vault balances mini summary */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Vault Balances</p>
            {vaultAccounts.map(a => (
              <div key={a.id} className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">{a.currency}</span>
                <span className="font-mono text-sm font-bold text-gray-900">{fmtNum(a.balance || 0, a.currency)}</span>
              </div>
            ))}
            {vaultAccounts.length === 0 && <p className="text-xs text-gray-400">No vault accounts</p>}
          </div>
        </div>
      </div>
    );
  };

  const sortedCards = useMemo(() => {
    return [...issuedCards].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [issuedCards]);

  // ── Operator Cards Tab (wallet_cards table) — numbered + activation ────────
  const renderOperatorCards = () => {
    return (
      <div className="space-y-6">
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          {/* LEFT — Controls */}
          <div className="space-y-5">
            <Card title="Customer &amp; Issuance">
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Operator Customer ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={operatorCustomerId}
                      onChange={e => setOperatorCustomerId(e.target.value.trim())}
                      className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500"
                      placeholder="customer UUID"
                    />
                    <button
                      type="button"
                      onClick={() => setOperatorCustomerId(DEFAULT_OPERATOR_CUSTOMER_ID)}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"
                      title="Restore default seeded customer"
                    >
                      Default
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    Issued cards for this customer from wallet_cards table.
                  </p>
                </div>

                <div className="h-px bg-gray-100" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2">
                    <CreditCard size={12} /> Issue New Card
                  </p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Scheme</label>
                        <select
                          value={issueParams.scheme}
                          onChange={e => setIssueParams(p => ({ ...p, scheme: e.target.value as "VISA" | "MASTERCARD" }))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"
                        >
                          <option value="VISA">VISA</option>
                          <option value="MASTERCARD">MASTERCARD</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Currency</label>
                        <select
                          value={issueParams.currency}
                          onChange={e => setIssueParams(p => ({ ...p, currency: e.target.value.toUpperCase() }))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold outline-none focus:border-indigo-500"
                        >
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                          <option value="GBP">GBP</option>
                          <option value="SGD">SGD</option>
                          <option value="INR">INR</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Valid (years)</label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={issueParams.validityYears}
                          onChange={e => setIssueParams(p => ({ ...p, validityYears: parseInt(e.target.value) || 5 }))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Spending Limit</label>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={issueParams.spendingLimit}
                          onChange={e => setIssueParams(p => ({ ...p, spendingLimit: parseFloat(e.target.value) || 0 }))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Cardholder Name</label>
                      <input
                        type="text"
                        value={issueParams.cardholderName}
                        onChange={e => setIssueParams(p => ({ ...p, cardholderName: e.target.value.toUpperCase() }))}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold uppercase tracking-wider outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleIssueOperatorCard()}
                      disabled={issueBusy || !operatorCustomerId}
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest transition flex items-center justify-center gap-2"
                    >
                      <CreditCard size={13} />
                      {issueBusy ? "Issuing..." : `Issue ${issueParams.scheme} ${issueParams.currency} Card`}
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Issuance Summary">
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Total Cards</span>
                  <span className="font-mono text-2xl font-black text-gray-900">{issuedCardsCount}</span>
                </div>
                <div className="h-px bg-gray-100" />
                {(["ACTIVE", "INACTIVE", "BLOCKED", "DEACTIVATED", "EXPIRED"] as const).map(st => {
                  const count = issuedCards.filter(c => c.status === st).length;
                  return (
                    <div key={st} className="flex items-center justify-between text-sm">
                      <StatusBadge value={st} />
                      <span className="font-mono font-bold text-gray-800">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* RIGHT — Numbered Cards Grid */}
          <div className="space-y-5">
            <Card
              title={`Operator Cards — ${issuedCardsCount} issued`}
              action={
                <button
                  onClick={() => void loadIssuedCards()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  <RefreshCw size={13} /> Reload
                </button>
              }
            >
              <div className="p-5">
                {sortedCards.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
                    <CreditCard size={36} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-bold text-gray-500">No cards issued yet</p>
                    <p className="mt-1 text-xs text-gray-400">Use the form on the left to issue a vault operator card.</p>
                  </div>
                ) : (
                  <div className="grid gap-5 md:grid-cols-2">
                    {sortedCards.map((card, idx) => {
                      const cardNum = idx + 1;
                      const isRevealed = !!revealSecrets[card.id];
                      const statusUpper = String(card.status || "INACTIVE").toUpperCase();
                      const isActive = statusUpper === "ACTIVE";
                      const canActivate = statusUpper === "DEACTIVATED" || statusUpper === "INACTIVE" || statusUpper === "BLOCKED";
                      const canDeactivate = statusUpper === "ACTIVE";
                      const pan = (isRevealed && card.cardNumber)
                        ? card.cardNumber.replace(/(\d{4})(?=\d)/g, "$1 ")
                        : `${card.bin}•• •••• •••• ${card.last4}`;
                      const cvvDisplay = isRevealed ? (card.cvv || "•••") : "•••";
                      const expiry = `${String(card.expiryMonth || card.expiry?.split("/")[0] || "00").padStart(2,"0")}/${String(card.expiryYear || card.expiry?.split("/")[1] || "00").slice(-2)}`;
                      const used = card.usedAmount || 0;
                      const limit = card.spendingLimit || 0;
                      const available = limit > 0 ? Math.max(0, limit - used) : null;
                      const usagePct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

                      return (
                        <div key={card.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                          {/* Card header: sequential number + status */}
                          <div className="vault-card-shell-header flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/15 font-black text-xs">
                                #{cardNum}
                              </span>
                              <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
                                Vault Operator Card
                              </span>
                            </div>
                            <StatusBadge value={card.status} />
                          </div>

                          {/* Card visual (centered, screenshot-like clean layout) */}
                          <div className="flex flex-col items-center px-4 pt-5 pb-3">
                            <OperatorCard
                              currency={card.currency}
                              loaded={isActive ? { amount: available ?? used, currency: card.currency } : null}
                              card={{
                                number: card.cardNumber || `${card.bin || ""}00000000${card.last4 || ""}`,
                                cvv: card.cvv || "",
                                expiry: expiry,
                              }}
                              bankName={card.cardholderName || "VAULT OPERATOR"}
                              lastFour={card.last4}
                              revealed={isRevealed}
                            />
                          </div>

                          {/* Card details */}
                          <div className="vault-card-shell-details px-4 pb-4 space-y-3">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Scheme</span>
                                <span className="font-bold text-gray-800">{card.scheme}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Currency</span>
                                <span className="font-bold text-gray-800">{card.currency}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">BIN</span>
                                <span className="font-mono font-bold text-gray-800">{card.bin}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Last 4</span>
                                <span className="font-mono font-bold text-gray-800">{card.last4}</span>
                              </div>
                              <div className="flex justify-between col-span-2">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Cardholder</span>
                                <span className="font-bold text-gray-800 truncate ml-2 text-right">{card.cardholderName || "\u2014"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Expiry</span>
                                <span className="font-mono font-bold text-gray-800">{expiry}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Limit</span>
                                <span className="font-mono font-bold text-gray-800">{fmtNum(limit, card.currency)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Used</span>
                                <span className="font-mono font-bold text-gray-800">{fmtNum(used, card.currency)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Available</span>
                                <span className={`font-mono font-black ${available !== null && available > 0 ? "text-emerald-600" : "text-gray-500"}`}>
                                  {available !== null ? fmtNum(available, card.currency) : "\u2014"}
                                </span>
                              </div>
                            </div>

                            {/* Usage bar */}
                            {limit > 0 && (
                              <div>
                                <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                                    style={{ width: `${usagePct}%` }}
                                  />
                                </div>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">
                                  {usagePct.toFixed(1)}% utilized
                                </p>
                              </div>
                            )}

                            {/* Activation timestamps */}
                            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Issued</span>
                                <span className="font-mono text-gray-700">{card.createdAt ? new Date(card.createdAt).toLocaleString() : "\u2014"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Activated</span>
                                <span className={`font-mono ${card.activatedAt ? "text-emerald-700 font-bold" : "text-gray-400"}`}>
                                  {card.activatedAt ? new Date(card.activatedAt).toLocaleString() : "○ Not activated"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500 uppercase tracking-wider font-bold">Updated</span>
                                <span className="font-mono text-gray-700">{card.updatedAt ? new Date(card.updatedAt).toLocaleString() : "\u2014"}</span>
                              </div>
                            </div>

                            {/* Eye icon — single Preview / Hide card details button */}
                            <div className="flex justify-center pt-2">
                              <button
                                type="button"
                                onClick={() => setRevealSecrets(prev => ({ ...prev, [card.id]: !isRevealed }))}
                                className={`group inline-flex items-center gap-2 rounded-full px-5 py-1.5 border text-xs font-bold uppercase tracking-widest transition-all ${
                                  isRevealed
                                    ? "bg-blue-50 border-blue-200 text-blue-700 shadow-[0_2px_6px_rgba(10,36,99,0.18)] hover:bg-blue-100"
                                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                                }`}
                                title={isRevealed ? "Hide card number, expiry & CVV" : "Preview full card number, expiry & CVV"}
                              >
                                {isRevealed ? (
                                  <EyeOff size={14} strokeWidth={2.2} />
                                ) : (
                                  <Eye size={14} strokeWidth={2.2} />
                                )}
                                <span>{isRevealed ? "Hide Details" : "Preview Details"}</span>
                              </button>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {canActivate && (
                                <button
                                  type="button"
                                  onClick={() => void handleToggleCardStatus(card, "ACTIVE")}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors"
                                >
                                  <Play size={12} /> Activate
                                </button>
                              )}
                              {canDeactivate && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(`Deactivate card ${card.bin}…${card.last4}?`)) {
                                      void handleToggleCardStatus(card, "DEACTIVATED");
                                    }
                                  }}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors"
                                >
                                  <X size={12} /> Deactivate
                                </button>
                              )}
                              {isActive && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(`Block card ${card.bin}…${card.last4}?`)) {
                                      void handleToggleCardStatus(card, "BLOCKED");
                                    }
                                  }}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors"
                                >
                                  <Shield size={12} /> Block
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>

            {/* ═══════════════════════════════════════════════════════════════
                PROTOCOL 101.1 — VOICE AUTH CARDS (below Operator Cards)
                Same 2 credentials (EUR + USD), blue fiber design.
                User will provide the exact card numbers later.
                ═══════════════════════════════════════════════════════════════ */}
            <Card
              title="Protocol 101.1 — Voice Authorization Cards"
              action={
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
                  📞 Protocol 101.1
                </div>
              }
            >
              <div className="p-5 space-y-5">
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-xs text-amber-900/80 leading-relaxed">
                  <strong className="font-bold text-amber-900 uppercase tracking-wider text-[11px]">Info:</strong>{" "}
                  Two operator cards (USD + EUR) for voice authorisation under Protocol 101.1.
                  Identical credential material as the vault operator cards above.
                  Card numbers will be stamped once provided by operator.
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* ── 101.1 USD CARD ── */}
                  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-amber-900 to-amber-700 text-white">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/15 font-black text-xs">
                          #1
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">
                          USD · 101.1 Voice
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest border border-white/25 text-white/90">
                        📞 101.1
                      </div>
                    </div>
                    <div className="p-4 flex flex-col items-center">
                      <OperatorCard
                        currency="USD"
                        loaded={null}
                        card={{
                          number: "0000000000000000",
                          cvv: "",
                          expiry: "",
                        }}
                        bankName="VAULT OPERATOR — USD"
                        revealed={false}
                        simpleLayout
                      />
                      <div className="mt-4 w-full text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1.5">
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">PAN</span><span className="font-bold text-slate-700">{"<pending operator input>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">Expiry</span><span className="font-bold text-slate-700">{"<mm/yy>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">CVV</span><span className="font-bold text-slate-700">{"<3d>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">Auth Centre</span><span className="font-bold text-slate-700">TO BE ASSIGNED</span></div>
                      </div>
                    </div>
                  </div>

                  {/* ── 101.1 EUR CARD ── */}
                  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-amber-900 to-amber-700 text-white">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/15 font-black text-xs">
                          #2
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">
                          EUR · 101.1 Voice
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest border border-white/25 text-white/90">
                        📞 101.1
                      </div>
                    </div>
                    <div className="p-4 flex flex-col items-center">
                      <OperatorCard
                        currency="EUR"
                        loaded={null}
                        card={{
                          number: "0000000000000000",
                          cvv: "",
                          expiry: "",
                        }}
                        bankName="VAULT OPERATOR — EUR"
                        revealed={false}
                        simpleLayout
                      />
                      <div className="mt-4 w-full text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1.5">
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">PAN</span><span className="font-bold text-slate-700">{"<pending operator input>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">Expiry</span><span className="font-bold text-slate-700">{"<mm/yy>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">CVV</span><span className="font-bold text-slate-700">{"<3d>"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400 uppercase tracking-wider font-bold">Auth Centre</span><span className="font-bold text-slate-700">TO BE ASSIGNED</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  // ── Other tabs ───────────────────────────────────────────────────────────────
  const renderSettlements = () => (
    <Card title="Settlement runs" action={
      <button onClick={() => void runAction(() => api("/api/settlement/run", { method: "POST" }), "Settlement started")}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">
        <Play size={14} /> Run settlement now
      </button>
    }>
      <DataTable
        columns={["id","source","total_net","currency","status","run_at"]}
        rows={settlements.map((row: AnyRecord) => ({
          id: row.id, source: row.source || row.acquirer || "-",
          total_net: fmtNum(row.total_net ?? row.amount ?? 0),
          currency: row.currency || "USD",
          status: <StatusBadge value={row.status} />,
          run_at: row.run_at || row.created_at,
        }))}
      />
    </Card>
  );

  const renderPayouts = () => {
    const vaultUsdBalance = Number(stats?.vaultBalancesByCurrency?.USD ?? stats?.totalVaultBalance ?? 0);

    const handleWisePayout = async () => {
      const amt = Number(wiseAmount);
      if (!amt || amt <= 0)           { setWiseError("Enter a valid amount"); return; }
      if (!wiseTargetName.trim())      { setWiseError("Beneficiary name is required"); return; }
      if (!wiseTargetAccount.trim())   { setWiseError("Account number / IBAN is required"); return; }
      if (!wiseTargetBic.trim())       { setWiseError(wiseCurrency === "USD" ? "ABA routing number is required" : "SWIFT/BIC is required"); return; }
      setWiseSending(true); setWiseError(""); setWiseResult(null);
      try {
        const r = await api("/api/vault/wise-payout", {
          method: "POST",
          body: JSON.stringify({
            amount:        amt,
            currency:      wiseCurrency,
            targetName:    wiseTargetName.trim(),
            targetAccount: wiseTargetAccount.trim(),
            targetBic:     wiseTargetBic.trim(),
            targetCountry: wiseTargetCountry.trim() || undefined,
            reference:     wiseReference.trim() || undefined,
            merchantId:    "MRC-1001",
          }),
        });
        setWiseResult(r);
        setWiseAmount(""); setWiseReference("");
        await load();
      } catch (e) {
        setWiseError(e instanceof Error ? e.message : "Wise payout failed");
      } finally {
        setWiseSending(false);
      }
    };

    return (
      <div className="space-y-6">

        {/* ── Wise Payout Form ── */}
        <div className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-5 py-4">
            <div>
              <h3 className="font-bold text-blue-900 text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black">W</span>
                Send Vault Funds via Wise
              </h3>
              <p className="text-xs text-blue-600 mt-0.5">
                Vault USD balance: <strong className="font-mono">${vaultUsdBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                &nbsp;·&nbsp; WISE_API_KEY configured ✓ &nbsp;·&nbsp; Rail: <strong>api.transferwise.com</strong>
              </p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Amount to send</label>
                <input type="number" min="0.01" step="0.01"
                  value={wiseAmount} onChange={e => { setWiseAmount(e.target.value); setWiseError(""); }}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Currency</label>
                <select value={wiseCurrency} onChange={e => { setWiseCurrency(e.target.value); setWiseTargetBic(""); }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option>USD</option><option>EUR</option><option>GBP</option><option>AED</option>
                </select>
              </div>
            </div>

            {/* Beneficiary */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">Beneficiary name (exactly as on bank account)</label>
              <input value={wiseTargetName} onChange={e => setWiseTargetName(e.target.value)}
                placeholder="e.g. PRIMESTACK TECHNOLOGIES LLC"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  {wiseCurrency === "EUR" ? "IBAN" : "Account number"}
                </label>
                <input value={wiseTargetAccount} onChange={e => setWiseTargetAccount(e.target.value)}
                  placeholder={wiseCurrency === "EUR" ? "DE89 3704 0044 0532 0130 00" : "12345678"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  {wiseCurrency === "USD" ? "ABA routing number" : "SWIFT / BIC"}
                </label>
                <input value={wiseTargetBic} onChange={e => setWiseTargetBic(e.target.value)}
                  placeholder={wiseCurrency === "USD" ? "026073150" : "DEUTDEDB"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Country <span className="font-normal text-gray-400">(optional)</span></label>
                <input value={wiseTargetCountry} onChange={e => setWiseTargetCountry(e.target.value)}
                  placeholder="US"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">Reference <span className="font-normal text-gray-400">(max 35 chars)</span></label>
                <input value={wiseReference} onChange={e => setWiseReference(e.target.value.slice(0, 35))}
                  placeholder="INV-2026-001"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            {wiseError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs font-semibold text-red-700">
                {wiseError}
              </div>
            )}

            {wiseResult && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
                <p className="text-sm font-bold text-emerald-800 flex items-center gap-2">
                  <span className="text-base">✅</span> Wise transfer submitted successfully
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["Transfer ID", wiseResult.transferId || "—"],
                    ["UETR", wiseResult.uetr || "—"],
                    ["Status", wiseResult.status || "SUBMITTED"],
                    ["Amount", `${wiseResult.currency} ${Number(wiseResult.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
                    ["Beneficiary", wiseResult.beneficiary || "—"],
                    ["Vault balance after", `$${Number(wiseResult.vaultBalanceAfter || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">{label}</p>
                      <p className="font-mono text-xs text-emerald-900 font-bold truncate mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-emerald-700 mt-1">{wiseResult.message}</p>
              </div>
            )}

            <button onClick={() => void handleWisePayout()} disabled={wiseSending || !wiseAmount || !wiseTargetName || !wiseTargetAccount || !wiseTargetBic}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 transition-all">
              {wiseSending
                ? <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting to Wise...</>
                : <>Send {wiseCurrency} {wiseAmount ? Number(wiseAmount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"} via Wise →</>}
            </button>
          </div>
        </div>

        {/* ── Batch export (SEPA/SWIFT) ── */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="font-bold text-gray-900 text-sm">Manual Batch Export</h3>
            <p className="text-xs text-gray-500 mt-0.5">Generate ISO 20022 or SWIFT MT103 batch files for manual bank submission</p>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            <button onClick={() => void runAction(() => api("/api/vault/payout/sepa/batch"), "SEPA batch generated")}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
              <FileText size={14} className="mr-1 inline" /> Generate SEPA batch (ISO 20022)
            </button>
            <button onClick={() => void runAction(() => api("/api/vault/payout/swift/batch"), "SWIFT batch generated")}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
              <FileText size={14} className="mr-1 inline" /> Generate SWIFT MT103 batch
            </button>
          </div>
        </div>

        {/* ── Payout history ── */}
        <Card title="Vault payout history">
          <DataTable
            columns={["id","beneficiary_name","amount","fee","currency","type","status"]}
            rows={payouts.map((row: AnyRecord) => ({ ...row, status: <StatusBadge value={row.status} /> }))}
          />
        </Card>

      </div>
    );
  };

  const renderBeneficiaries = () => {
    const field = (name: string, label: string, type: "input" | "textarea" = "input", placeholder = "") => (
      <label key={name} className="text-xs font-bold text-indigo-900">
        {label}
        {type === "textarea"
          ? <textarea name={name} value={beneficiaryForm[name] || ""} onChange={updateBeneficiary} placeholder={placeholder} rows={2} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-normal" />
          : <input name={name} value={beneficiaryForm[name] || ""} onChange={updateBeneficiary} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-normal" />}
      </label>
    );
    return (
      <div className="space-y-5">
        <Card title="Add payout beneficiary">
          <form onSubmit={saveBeneficiary} className="space-y-6 p-5">
            <div>
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-blue-700">Beneficiary identity</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {field("beneficiary_legal_name", "Legal name", "input", "Registered beneficiary name")}
                {field("beneficiary_phone", "Phone", "input", "+ country code and number")}
                {field("beneficiary_address_line1", "Address line 1")}
                {field("beneficiary_address_line2", "Address line 2")}
                {field("beneficiary_city", "City")}
                {field("beneficiary_country", "Country")}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-blue-700">Receiving bank details</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {field("receiving_bank_name", "Bank name")}
                {field("receiving_bank_swift_bic", "SWIFT / BIC")}
                {field("receiving_bank_address_line1", "Bank address line 1")}
                {field("receiving_bank_address_line2", "Bank address line 2")}
                {field("receiving_bank_city", "Bank city")}
                {field("receiving_bank_country", "Bank country")}
                {field("receiving_bank_routing_number", "Routing number")}
                {field("receiving_bank_sort_code", "Sort code")}
                {field("receiving_bank_local_clearing_code", "Local clearing code")}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-blue-700">Account details</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {field("account_number", "Account number")}
                {field("iban", "IBAN")}
                <label className="text-xs font-bold text-indigo-900">Supported currency<select name="supported_currency" value={beneficiaryForm.supported_currency} onChange={updateBeneficiary} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"><option>USD</option><option>EUR</option><option>GBP</option><option>ZAR</option></select></label>
                {field("account_type", "Account type", "input", "Business, current, savings")}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-blue-700">Transfer details</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-bold text-indigo-900">Transfer type<select name="transfer_type" value={beneficiaryForm.transfer_type} onChange={updateBeneficiary} className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"><option>SWIFT</option><option>SEPA</option><option>DOMESTIC</option><option>ACH</option><option>RTGS</option><option>IMPS</option><option>PIX</option><option>FASTER_PAYMENTS</option><option>FEDWIRE</option></select></label>
                {field("network_code", "Network code", "input", "SEPA SCT, SWIFT MT103, ACH PPD")}
                {field("payment_purpose_code", "Payment purpose code")}
                {field("end_to_end_id", "End-to-end ID")}
                {field("beneficiary_reference", "Beneficiary reference")}
                {field("payment_description", "Payment description", "textarea")}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-blue-700">Vault internal references</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {field("vault_customer_id", "Vault customer ID")}
                {field("vault_wallet_id", "Vault wallet ID")}
                {field("vault_card_reference", "Vault card reference")}
                {field("vault_settlement_batch_id", "Settlement batch ID")}
                {field("vault_transaction_id", "Vault transaction ID")}
                {field("internal_note", "Internal note", "textarea")}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <span>Only beneficiary destination and audit fields are stored. Do not enter online-banking passwords, PINs, private keys, or API secrets here.</span>
              <button type="submit" disabled={beneficiaryBusy} className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{beneficiaryBusy ? "Saving..." : "Save beneficiary"}</button>
            </div>
          </form>
        </Card>
        <Card title="Configured beneficiaries">
          <DataTable
            columns={["id", "name", "bank_name", "iban", "swift", "country", "currency", "type", "created_at"]}
            rows={(data.beneficiaries || []).map((row: AnyRecord) => ({ ...row }))}
            empty="No beneficiaries configured."
          />
        </Card>
      </div>
    );
  };

  const renderWithdrawals = () => (
    <Card title="Merchant withdrawals">
      <DataTable
        columns={["id","merchant_id","amount","currency","status","created_at"]}
        rows={(data.withdrawals?.withdrawals || []).map((row: AnyRecord) => ({ ...row, status: <StatusBadge value={row.status} /> }))}
        empty="Withdrawal requests will appear here."
      />
    </Card>
  );

  const renderFxFees = () => (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="FX rates"><DataTable columns={["from_currency","to_currency","rate","updated_at"]} rows={(data.fx?.fx || []).map((r: AnyRecord) => r)} empty="No FX rates configured." /></Card>
      <Card title="Fee configuration">
        <div className="space-y-3 p-5 text-sm text-gray-600">
          <p>Fixed fee: <strong>{data.fees?.fees?.fixed_fee ?? 5}</strong></p>
          <p>Percentage fee: <strong>{data.fees?.fees?.percent_fee ?? 0.005}</strong></p>
          <p>Per-rail fees can be managed through the vault configuration API.</p>
        </div>
      </Card>
    </div>
  );

  const renderReconciliation = () => (
    <div className="space-y-5">
      <Card title="Reconciliation">
        <div className={`m-5 rounded-xl p-4 ${String(reconciliation.reconStatus || reconciliation.status || "").toUpperCase().includes("OK") || reconciliation.match ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          <p className="font-bold">{reconciliation.reconStatus || reconciliation.status || "Awaiting reconciliation"}</p>
          <p className="mt-1 text-sm">Vault balance: {reconciliation.vaultBalance ?? "-"} · Expected: {reconciliation.expected ?? "-"}</p>
        </div>
      </Card>
      <Card title="Recent errors">
        <DataTable
          columns={["event","created_at","status","message"]}
          rows={(data.audit?.events || data.audit || []).filter((r: AnyRecord) => String(r.status || "").includes("FAIL")).map((r: AnyRecord) => r)}
          empty="No recent errors."
        />
      </Card>
    </div>
  );

  const renderCredentials = () => {
    const loadCreds = async (reveal = false) => {
      setCredsErr(""); setCredsMsg("");
      try {
        const path = reveal ? "/api/vault/bank-credentials/reveal" : "/api/vault/bank-credentials";
        const r = await api(path);
        setCreds(r);
        setCredsRevealed(reveal);
        if (reveal) setCredsDraft({ ...r.vaultBank, ...r.acquirer });
      } catch (e) { setCredsErr(e instanceof Error ? e.message : "Failed to load"); }
    };

    const toggleField = async (k: string) => {
      const isCurrentlyVisible = credsVisible[k];
      if (!isCurrentlyVisible && !credsRevealed) {
        // Fetch revealed values first
        try {
          const r = await api("/api/vault/bank-credentials/reveal");
          setCreds(r);
          setCredsRevealed(true);
          setCredsDraft((d: AnyRecord) => ({ ...r.vaultBank, ...r.acquirer, ...d }));
        } catch { /* ignore — show what we have */ }
      }
      setCredsVisible(v => ({ ...v, [k]: !v[k] }));
    };

    const saveCreds = async () => {
      setCredsSaving(true); setCredsErr(""); setCredsMsg("");
      try {
        await api("/api/vault/bank-credentials/update", { method: "POST", body: JSON.stringify(credsDraft) });
        setCredsMsg("Saved successfully"); setCredsEditing(false);
        await loadCreds(credsRevealed);
      } catch (e) { setCredsErr(e instanceof Error ? e.message : "Save failed"); }
      finally { setCredsSaving(false); }
    };

    const rotateKey = async () => {
      if (!window.confirm("Generate a new Vault Bank API Key + Secret? The old key will stop working immediately.")) return;
      setCredsRotating(true); setCredsErr(""); setCredsMsg(""); setCredsRotateResult(null);
      try {
        const r = await api("/api/vault/bank-credentials/rotate-api-key", { method: "POST", body: "{}" });
        setCredsRotateResult(r);
        setCredsMsg("API Key rotated successfully");
        await loadCreds(true);
      } catch (e) { setCredsErr(e instanceof Error ? e.message : "Rotation failed"); }
      finally { setCredsRotating(false); }
    };

    const CredRow = ({ label, envKey, sensitive = false }: { label: string; envKey: string; sensitive?: boolean }) => {
      const section = creds.vaultBank?.[envKey] !== undefined ? creds.vaultBank : creds.acquirer || {};
      const val = String(credsDraft[envKey] ?? section[envKey] ?? "");
      const visible = credsVisible[envKey];
      const displayVal = sensitive && !visible ? "••••••••••••" : (val || "—");
      return (
        <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
          <td className="px-4 py-2.5 text-xs font-mono font-semibold text-slate-500 whitespace-nowrap">{envKey}</td>
          <td className="px-4 py-2.5 text-xs text-slate-600 font-medium whitespace-nowrap">{label}</td>
          <td className="px-4 py-2.5 font-mono text-xs text-slate-800 min-w-0">
            {credsEditing && !sensitive ? (
              <input
                value={val}
                onChange={e => setCredsDraft((d: AnyRecord) => ({ ...d, [envKey]: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            ) : (
              <span className={sensitive && !visible ? "text-slate-400 tracking-widest" : ""}>{displayVal}</span>
            )}
          </td>
          <td className="px-4 py-2.5 text-right">
            {sensitive && (
              <button onClick={() => toggleField(envKey)} className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                {visible ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
            <button onClick={async () => { navigator.clipboard.writeText(val); }} className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 ml-1">
              <Copy size={13} />
            </button>
          </td>
        </tr>
      );
    };

    const SectionTable = ({ title, rows }: { title: string; rows: Array<{ label: string; envKey: string; sensitive?: boolean }> }) => (
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
        </div>
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
              <th className="px-4 py-2">Variable</th>
              <th className="px-4 py-2">Label</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <CredRow key={r.envKey} {...r} />)}
          </tbody>
        </table>
      </section>
    );

    const loaded = Object.keys(creds).length > 0;

    return (
      <div className="space-y-5">
        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Bank Credentials</h2>
            <p className="text-xs text-gray-500 mt-0.5">Vault Bank connection settings and Acquirer configuration</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!loaded && (
              <button onClick={() => void loadCreds(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm">
                <RefreshCw size={14} /> Load
              </button>
            )}
            {loaded && !credsRevealed && (
              <button onClick={() => void loadCreds(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 shadow-sm">
                <Eye size={14} /> Reveal All
              </button>
            )}
            {loaded && credsRevealed && (
              <button onClick={() => { setCredsRevealed(false); setCredsVisible({}); loadCreds(false); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 shadow-sm">
                <EyeOff size={14} /> Hide
              </button>
            )}
            {loaded && !credsEditing && (
              <button onClick={() => { setCredsEditing(true); setCredsDraft({ ...creds.vaultBank, ...creds.acquirer }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 shadow-sm">
                <Settings2 size={14} /> Edit
              </button>
            )}
            {credsEditing && (
              <>
                <button onClick={() => void saveCreds()} disabled={credsSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50">
                  {credsSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Save
                </button>
                <button onClick={() => { setCredsEditing(false); setCredsDraft({}); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 shadow-sm">
                  <X size={14} /> Cancel
                </button>
              </>
            )}
            <button onClick={() => void rotateKey()} disabled={credsRotating} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 shadow-sm disabled:opacity-50">
              <RotateCw size={14} className={credsRotating ? "animate-spin" : ""} /> Rotate API Key
            </button>
          </div>
        </div>

        {credsErr && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><X size={14} className="inline mr-1" />{credsErr}</div>}
        {credsMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><Check size={14} className="inline mr-1" />{credsMsg}</div>}

        {credsRotateResult && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">New Keys Generated — Save Now</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[["New API Key", credsRotateResult.newApiKey], ["New Secret Key", credsRotateResult.newSecretKey]].map(([label, val]) => (
                <div key={label} className="rounded-lg border border-amber-200 bg-white p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">{label}</p>
                  <p className="font-mono text-xs text-slate-800 break-all">{val}</p>
                  <button onClick={() => navigator.clipboard.writeText(String(val))} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 hover:text-amber-900">
                    <Copy size={10} /> Copy
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-amber-700 font-medium">⚠️ {credsRotateResult.warning}</p>
          </div>
        )}

        {!loaded && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
            <KeyRound size={28} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-semibold text-gray-500">Click Load to view credentials</p>
          </div>
        )}

        {loaded && (
          <>
            <SectionTable
              title="Vault Bank Connection"
              rows={[
                { label: "Port",          envKey: "VAULT_BANK_PORT" },
                { label: "Bind Host",     envKey: "VAULT_BANK_BIND_HOST" },
                { label: "API Key",       envKey: "VAULT_BANK_API_KEY",      sensitive: true },
                { label: "Secret Key",    envKey: "VAULT_BANK_SECRET_KEY",   sensitive: true },
                { label: "Transfer URL",  envKey: "VAULT_BANK_TRANSFER_URL" },
                { label: "Active Key",    envKey: "VAULT_ACTIVE_API_KEY",    sensitive: true },
                { label: "Key Endpoint",  envKey: "KEY_ENDPOINT" },
              ]}
            />
            <SectionTable
              title="Acquirer Configuration"
              rows={[
                { label: "Host",             envKey: "ACQUIRER_HOST" },
                { label: "Port",             envKey: "ACQUIRER_PORT" },
                { label: "Protocol",         envKey: "ACQUIRER_PROTOCOL" },
                { label: "API Key",          envKey: "ACQUIRER_API_KEY",          sensitive: true },
                { label: "Secret Key",       envKey: "ACQUIRER_SECRET_KEY",       sensitive: true },
                { label: "Timeout (ms)",     envKey: "ACQUIRER_TIMEOUT_MS" },
                { label: "Merchant Account", envKey: "ACQUIRER_MERCHANT_ACCOUNT" },
                { label: "TLS Cert",         envKey: "ACQUIRER_TLS_CERT" },
                { label: "TLS Key",          envKey: "ACQUIRER_TLS_KEY",          sensitive: true },
                { label: "TLS CA",           envKey: "ACQUIRER_TLS_CA" },
                { label: "MAC Key",          envKey: "ACQUIRER_MAC_KEY",          sensitive: true },
                { label: "PIN Key",          envKey: "ACQUIRER_PIN_KEY",          sensitive: true },
              ]}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blue-600">Vault operations</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">Vault Bank Dashboard</h1>
          <p className="mt-2 text-sm text-gray-500">Monitor balances, settlements, payouts, and reconciliation.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setError(""); setMessage(""); }}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === id ? "bg-slate-900 text-white shadow" : "text-gray-500 hover:bg-gray-100"}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {/* Global messages */}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><Check size={16} className="mr-2 inline" />{message}</div>}
      {error   && <div className="rounded-xl border border-red-200   bg-red-50   px-4 py-3 text-sm font-semibold text-red-700">  <X    size={16} className="mr-2 inline" />{error}</div>}

      {/* Tab content */}
      {tab === "overview"       && renderOverview()}
      {tab === "cardload"       && renderCardLoad()}
      {tab === "onramp"         && renderOnRamp()}
      {tab === "settlements"    && renderSettlements()}
      {tab === "payouts"        && renderPayouts()}
      {tab === "beneficiaries"  && renderBeneficiaries()}
      {tab === "withdrawals"    && renderWithdrawals()}
      {tab === "fxfees"         && renderFxFees()}
      {tab === "reconciliation" && renderReconciliation()}
      {tab === "credentials"    && renderCredentials()}

      <TransakWidgetModal
        open={transakOpen}
        onClose={() => setTransakOpen(false)}
        flow={transakFlow}
        defaultCryptoCurrency={transakPresets.defaultCryptoCurrency}
        defaultFiatCurrency={transakPresets.defaultFiatCurrency}
        defaultNetwork={transakPresets.defaultNetwork}
        defaultFiatAmount={transakPresets.defaultFiatAmount}
        partnerCustomerId={transakPresets.partnerCustomerId}
        walletAddress={transakPresets.walletAddress}
        onOrderSuccessful={async (_order_evt) => {
          const id = (typeof _order_evt === "object" && _order_evt !== null) ? (_order_evt as any).order_id || (_order_evt as any).id || (_order_evt as any).orderId : "";
          setMessage("✅ Transak order completed" + (id ? ` · #${id}` : ""));
          await Promise.all([load(), loadVirtualAccounts()]);
        }}
      />


    </div>
  );
}