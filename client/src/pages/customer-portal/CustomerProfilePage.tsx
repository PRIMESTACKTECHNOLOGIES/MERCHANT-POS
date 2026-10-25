import { useEffect, useState } from "react";
import {
  changePortalPin,
  getPortalProfile,
  updatePortalProfile,
  type PortalProfile,
} from "../../lib/customerApi";

type Notice = { type: "ok" | "error"; msg: string } | null;

const EDITABLE_FIELDS: Array<{ key: keyof PortalProfile; label: string; type?: string }> = [
  { key: "name", label: "Full name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "date_of_birth", label: "Date of birth", type: "date" },
  { key: "nationality", label: "Nationality" },
  { key: "occupation", label: "Occupation" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country" },
];

export function CustomerProfilePage() {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinNotice, setPinNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getPortalProfile();
        if (!active) return;
        setProfile(res);
        const initial: Record<string, string> = {};
        for (const f of EDITABLE_FIELDS) initial[f.key as string] = (res[f.key] as string) || "";
        setForm(initial);
      } catch (e: any) {
        if (active) setNotice({ type: "error", msg: e.message || "Failed to load profile" });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await updatePortalProfile(form as Partial<PortalProfile>);
      const fresh = await getPortalProfile();
      setProfile(fresh);
      setNotice({ type: "ok", msg: "Profile updated successfully" });
    } catch (err: any) {
      setNotice({ type: "error", msg: err.message || "Update failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinNotice(null);
    if (!/^\d{4,6}$/.test(newPin)) {
      setPinNotice({ type: "error", msg: "New PIN must be 4 to 6 digits" });
      return;
    }
    setPinSaving(true);
    try {
      await changePortalPin(currentPin, newPin);
      setPinNotice({ type: "ok", msg: "PIN updated successfully" });
      setCurrentPin("");
      setNewPin("");
    } catch (err: any) {
      setPinNotice({ type: "error", msg: err.message || "Failed to change PIN" });
    } finally {
      setPinSaving(false);
    }
  };

  if (loading) return <div className="text-slate-500">Loading profile…</div>;

  if (!profile) {
    return (
      <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
        {notice?.msg || "Profile unavailable"}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">My profile</h1>
        <p className="text-sm text-slate-500 mt-1">
          {profile.wallet_code ? `Wallet ${profile.wallet_code}` : "Manage your account details"}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">KYC status</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">{profile.kyc_status || "—"}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Risk level</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">{profile.risk_level || "—"}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portal PIN</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">{profile.pin_set ? "Set" : "Not set"}</div>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-700">Account details</h2>

        {notice && (
          <div className={`px-4 py-3 rounded-lg text-sm border ${notice.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>
            {notice.msg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {EDITABLE_FIELDS.map((f) => (
            <div key={f.key as string} className={f.key === "address_line1" || f.key === "address_line2" ? "sm:col-span-2" : ""}>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{f.label}</label>
              <input
                type={f.type || "text"}
                value={form[f.key as string] || ""}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key as string]: e.target.value }))}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
              />
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold transition"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <form onSubmit={handleChangePin} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-700">Change portal PIN</h2>

        {pinNotice && (
          <div className={`px-4 py-3 rounded-lg text-sm border ${pinNotice.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>
            {pinNotice.msg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Current PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none tracking-widest"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">New PIN (4–6 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none tracking-widest"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pinSaving}
          className="w-full sm:w-auto px-6 py-3 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold transition"
        >
          {pinSaving ? "Updating…" : "Update PIN"}
        </button>
      </form>
    </div>
  );
}
