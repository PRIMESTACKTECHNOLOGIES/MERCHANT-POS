import { useEffect, useState } from "react";
import { fetchSettings, updateSettings, toggle2FA, changePassword, getProfile, updateProfile, getSessions, revokeSession, regenerateApiKey } from "../lib/api";

interface MerchantProfile {
  name: string;
  displayName: string;
  email: string;
  phone: string;
  country: string;
  timezone: string;
  companyName: string;
  address: string;
  businessType: string;
  avatarUrl?: string;
  theme: string;
  language: string;
}

interface BusinessInfo {
  legalName: string;
  licenseNumber: string;
  taxId: string;
  country: string;
  industry: string;
}

interface BankingDetails {
  holderName: string;
  bankName: string;
  routingNumber?: string;
  accountNumber: string;
  swiftCode: string;
  payoutCurrency?: string;
  payoutFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
}

interface SecuritySettings {
  twoFactorEnabled: boolean;
  lastLogin: string;
  activeDevices: { id: string; name: string; location: string; lastActive: string; current: boolean }[];
}

interface NotificationSettings {
  email: boolean;
  sms: boolean;
  alerts: {
    failedBatches: boolean;
    highValue: boolean;
    offline: boolean;
    settlement: boolean;
  };
}

interface DeveloperSettings {
  apiKey: string;
  webhookUrl: string;
}

interface TerminalSettings {
  offlineMode: boolean;
  autoUpdate: boolean;
  features: {
    manualEntry: boolean;
    refunds: boolean;
    tips: boolean;
  };
}

interface FullSettings {
  profile: MerchantProfile;
  business: BusinessInfo;
  banking: BankingDetails;
  security: SecuritySettings;
  notifications: NotificationSettings;
  developer: DeveloperSettings;
  terminal: TerminalSettings;
}

const DEFAULTS: FullSettings = {
  profile: { name: "", displayName: "", email: "", phone: "", country: "", timezone: "", companyName: "", address: "", businessType: "", avatarUrl: "", theme: "light", language: "en" },
  business: { legalName: "", licenseNumber: "", taxId: "", country: "", industry: "" },
  banking: { holderName: "", bankName: "", routingNumber: "", accountNumber: "", swiftCode: "", payoutCurrency: "USD", payoutFrequency: "DAILY" },
  security: { twoFactorEnabled: false, lastLogin: new Date().toISOString(), activeDevices: [] },
  notifications: { email: true, sms: false, alerts: { failedBatches: true, highValue: true, offline: true, settlement: true } },
  developer: { apiKey: "", webhookUrl: "" },
  terminal: { offlineMode: true, autoUpdate: false, features: { manualEntry: true, refunds: false, tips: false } },
};

const Icons = {
  User: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  Building: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  Bank: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  Terminal: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  Shield: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  Bell: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
  Code: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>,
  Check: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  Edit: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>,
  Upload: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>,
  Refresh: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Eye: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  EyeOff: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>,
  X: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
};

const SectionCard = ({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-300">
    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/30 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-white rounded-lg border border-gray-100 text-gray-500 shadow-sm">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{title}</h3>
      </div>
      {action}
    </div>
    <div className="p-6">
      {children}
    </div>
  </div>
);

const FieldRow = ({ label, value, subtext }: { label: string; value: React.ReactNode; subtext?: string }) => (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3 border-b border-gray-50 last:border-0 last:pb-0">
    <div className="text-sm font-medium text-gray-500">{label}</div>
    <div className="sm:col-span-2">
      <div className="text-sm font-medium text-gray-900">{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  </div>
);

const Toggle = ({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }) => (
  <div className="flex items-center justify-between py-3">
    <div>
      <div className="text-sm font-medium text-gray-900">{label}</div>
      {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
    </div>
    <button 
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${checked ? 'bg-blue-600' : 'bg-gray-200'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </div>
);

const Badge = ({ children, color = "blue" }: { children: React.ReactNode; color?: "blue" | "green" | "yellow" | "red" | "gray" }) => {
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-green-50 text-green-700 border-green-100",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-100",
    red: "bg-red-50 text-red-700 border-red-100",
    gray: "bg-gray-50 text-gray-700 border-gray-100",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[color]}`}>
      {children}
    </span>
  );
};

const SettingsDrawer = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  onSave
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  onSave?: () => void | Promise<void>;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <Icons.X />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={async () => { await onSave?.(); onClose(); }} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors">Save Changes</button>
        </div>
      </div>
    </div>
  );
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

const Input = ({ label, className = "", ...props }: InputProps) => (
  <div className="mb-4">
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
    <input 
      className={`w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all ${className}`}
      {...props}
    />
  </div>
);

export const SettingsPage = () => {
  const [settings, setSettings] = useState<FullSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const [activeDrawer, setActiveDrawer] = useState<'profile' | 'banking' | 'business' | 'security' | null>(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);

  // ── Safe derived views — never crash on null/undefined terminal or notifications ──
  const terminal = settings?.terminal ?? DEFAULTS.terminal;
  const terminalFeatures = terminal?.features ?? DEFAULTS.terminal.features;
  const notifications = settings?.notifications ?? DEFAULTS.notifications;
  const notificationAlerts = notifications?.alerts ?? DEFAULTS.notifications.alerts;

  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setMsg({ text: "All password fields are required", type: 'error' });
      setTimeout(() => setMsg(null), 3000);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg({ text: "New passwords do not match", type: 'error' });
      setTimeout(() => setMsg(null), 3000);
      return;
    }
    
    setPasswordLoading(true);
    try {
      const res = await changePassword(oldPassword, newPassword);
      setMsg({ text: res.message || "Password changed successfully", type: 'success' });
      setTimeout(() => setMsg(null), 3000);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setActiveDrawer(null);
    } catch (error: any) {
      setMsg({ text: error.message || "Failed to change password", type: 'error' });
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    if (!settings) return;
    try {
      setSettings({...settings, security: {...settings.security, twoFactorEnabled: enabled}});
      const res = await toggle2FA(enabled);
      setMsg({ text: res.message, type: 'success' });
      setTimeout(() => setMsg(null), 3000);
    } catch (error: any) {
      setSettings({...settings, security: {...settings.security, twoFactorEnabled: !enabled}});
      setMsg({ text: error.message || "Failed to toggle 2FA", type: 'error' });
      setTimeout(() => setMsg(null), 3000);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        let profileData: any = {};
        try {
            profileData = await getProfile();
        } catch (e) {
            console.warn("Failed to load profile", e);
            profileData = {};
        }

        let settingsData: any = {};
        try {
            settingsData = await fetchSettings();
        } catch (e) {
            console.warn("Failed to load settings", e);
        }
        
        let sessionsData: any[] = [];
        try {
            sessionsData = await getSessions();
        } catch (e) {
            console.warn("Failed to load sessions", e);
        }
        
        const mappedProfile: MerchantProfile = {
          name: profileData.full_name || "",
          displayName: profileData.display_name || "",
          email: profileData.email || "",
          phone: profileData.phone || "",
          country: profileData.country || "",
          timezone: profileData.timezone || "",
          companyName: profileData.company || "",
          address: "",
          businessType: "",
          avatarUrl: profileData.avatar_url || "",
          theme: profileData.theme_preference || "light",
          language: profileData.language_preference || "en"
        };

        const frontendSettings: FullSettings = {
            profile: mappedProfile,
            business: {
                legalName: settingsData.business?.legalName || settingsData.business?.legal_name || profileData.company || settingsData.merchant_name || "",
                licenseNumber: settingsData.business?.licenseNumber || settingsData.business?.license_number || settingsData.business?.trade_license_no || "",
                taxId: settingsData.business?.taxId || settingsData.business?.tax_id || settingsData.business?.vat_registration || "",
                country: settingsData.business?.country || profileData.country || "",
                industry: settingsData.business?.industry || ""
            },
            banking: {
                holderName: settingsData.banking?.holderName || settingsData.banking?.account_holder_name || settingsData.banking?.beneficiary_name || profileData.company || settingsData.merchant_name || "",
                bankName: settingsData.banking?.bankName || settingsData.banking?.bank_name || settingsData.banking?.receiving_bank_name || "",
                routingNumber: settingsData.banking?.routingNumber || settingsData.banking?.routing || settingsData.banking?.routing_wire_usd_us || settingsData.banking?.routing_ach_abain || "",
                accountNumber: settingsData.banking?.accountNumber || settingsData.banking?.account_number || settingsData.banking?.beneficiary_account_number || "",
                swiftCode: settingsData.banking?.swiftCode || settingsData.banking?.swift_bic || settingsData.banking?.swift || "",
                payoutCurrency: settingsData.banking?.payoutCurrency || settingsData.banking?.currency || "USD",
                payoutFrequency: (settingsData.banking?.payoutFrequency as any) || settingsData.banking?.payout_frequency || "DAILY"
            },
            security: {
                twoFactorEnabled: profileData.two_factor_enabled || false,
                lastLogin: new Date().toISOString(),
                activeDevices: sessionsData.map((s: any) => ({
                    id: s.id,
                    name: s.device_info || "Unknown Device",
                    location: s.ip_address || "Unknown",
                    lastActive: new Date(s.last_active).toLocaleString(),
                    current: s.current || false
                }))
            },
            notifications: {
                email: settingsData.notifications?.email ?? true,
                sms: settingsData.notifications?.sms ?? false,
                alerts: {
                    failedBatches: settingsData.notifications?.alerts?.failedBatches ?? true,
                    highValue: settingsData.notifications?.alerts?.highValue ?? true,
                    offline: settingsData.notifications?.alerts?.offline ?? true,
                    settlement: settingsData.notifications?.alerts?.settlement ?? true
                }
            },
            developer: {
                apiKey: settingsData.api_key || "",
                webhookUrl: settingsData.webhook_url || ""
            },
            terminal: {
                offlineMode: settingsData.terminal?.offlineMode ?? settingsData.offline_mode ?? true,
                autoUpdate: settingsData.terminal?.autoUpdate ?? false,
                features: {
                    manualEntry: true,
                    refunds: settingsData.terminal?.features?.refunds ?? false,
                    tips: settingsData.terminal?.features?.tips ?? false
                }
            }
        };

        setSettings(frontendSettings);
      } catch (e) {
        console.error("Failed to load profile from API", e);
        // Fall back to safe defaults so page is never blank
        setSettings(prev => prev && prev.profile ? prev : DEFAULTS);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;

    setSaving(true);
    
    try {
        await updateProfile({
            full_name: (settings.profile.name || "").trim(),
            display_name: (settings.profile.displayName || "").trim(),
            phone: (settings.profile.phone || "").trim(),
            country: (settings.profile.country || "").trim(),
            timezone: (settings.profile.timezone || "").trim(),
            company: (settings.profile.companyName || "").trim(),
            email: (settings.profile.email || "").trim(),
            avatar_url: (settings.profile.avatarUrl || "").trim(),
            theme_preference: settings.profile.theme,
            language_preference: settings.profile.language
        });

        await updateSettings({
            api_key: settings.developer.apiKey,
            webhook_url: settings.developer.webhookUrl,
            merchant_name: settings.profile.name,
            support_email: settings.profile.email,
            features: { manualEntry: true, refunds: terminalFeatures.refunds ?? false, tips: terminalFeatures.tips ?? false },
            business: settings.business,
            banking: settings.banking,
            notifications: settings.notifications,
            terminal: { ...settings.terminal, features: { ...(settings.terminal?.features || {}), manualEntry: true } }
        });

        try {
          const [freshProfile, freshSettings] = await Promise.all([
            getProfile().catch(() => null),
            fetchSettings().catch(() => null),
          ]);
          if (freshProfile) {
            setSettings(prev => prev ? ({
              ...prev,
              profile: {
                ...prev.profile,
                name: freshProfile.full_name || freshProfile.display_name || prev.profile.name,
                displayName: freshProfile.display_name || prev.profile.displayName,
                email: freshProfile.email || prev.profile.email,
                phone: freshProfile.phone || prev.profile.phone,
                country: freshProfile.country || prev.profile.country,
                timezone: freshProfile.timezone || prev.profile.timezone,
                companyName: freshProfile.company || prev.profile.companyName,
                avatarUrl: freshProfile.avatar_url || prev.profile.avatarUrl,
                theme: freshProfile.theme_preference || prev.profile.theme,
                language: freshProfile.language_preference || prev.profile.language,
              }
            }) : prev);
          }
          if (freshSettings) {
            setSettings(prev => prev ? ({
              ...prev,
              business: freshSettings.business || prev.business,
              banking: freshSettings.banking || prev.banking,
              notifications: freshSettings.notifications || prev.notifications,
              terminal: {
                ...(prev.terminal || {}),
                ...(freshSettings.terminal || {}),
                features: {
                  manualEntry: true,
                  refunds: freshSettings.terminal?.features?.refunds ?? prev.terminal?.features?.refunds ?? false,
                  tips: freshSettings.terminal?.features?.tips ?? prev.terminal?.features?.tips ?? false,
                }
              },
              developer: {
                ...prev.developer,
                apiKey: freshSettings.api_key ?? prev.developer.apiKey,
                webhookUrl: freshSettings.webhook_url ?? prev.developer.webhookUrl,
              }
            }) : prev);
          }
        } catch (_e) {
          // Best effort reload; save itself already succeeded.
        }

        setMsg({ text: "Settings saved successfully", type: 'success' });
    } catch (e: any) {
        console.error("Save failed:", e);
        setMsg({ text: "Failed to save settings: " + (e.message || "Unknown error"), type: 'error' });
    }
    
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  const activeDevices = settings?.security?.activeDevices ?? [];
  const visibleSessions = showAllSessions ? activeDevices : activeDevices.slice(0, 3);
  const hasMoreSessions = activeDevices.length > 3;

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm text-gray-500 font-medium">Loading Merchant Profile...</div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-8 pb-12 max-w-6xl mx-auto">
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Merchant Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage merchant profile, business details, payout settings, and security</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && (
            <div className={`text-sm font-medium px-3 py-1.5 rounded-lg animate-fade-in ${msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {msg.text}
            </div>
          )}
          <button 
            onClick={handleSave}
            disabled={saving}
            className={`bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium shadow-sm hover:shadow-md transition-all flex items-center gap-2 ${saving ? 'opacity-70 cursor-wait' : ''}`}
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </>
            ) : (
              <>
                <Icons.Check />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div className="space-y-8 lg:col-span-2">
          
          <SectionCard 
            title="Merchant Profile" 
            icon={<Icons.User />}
            action={
              <button 
                onClick={() => setActiveDrawer('profile')}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
              >
                <Icons.Edit /> Edit
              </button>
            }
          >
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                {settings.profile.avatarUrl ? (
                  <img src={settings.profile.avatarUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover shadow-md ring-4 ring-white" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xl font-bold shadow-md ring-4 ring-white">
                    {settings.profile.name.substring(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-1">
                <FieldRow label="Merchant Name" value={settings.profile.name} />
                <FieldRow label="Display Name" value={settings.profile.displayName} />
                <FieldRow label="Business Type" value={<Badge color="blue">{settings.profile.businessType}</Badge>} />
                <FieldRow label="Contact Email" value={settings.profile.email} />
                <FieldRow label="Phone Number" value={settings.profile.phone} />
                <FieldRow label="Address" value={settings.profile.address} />
                <FieldRow label="Language" value={settings.profile.language.toUpperCase()} />
                <FieldRow label="Theme" value={settings.profile.theme === 'light' ? 'Light Mode' : 'Dark Mode'} />
              </div>
            </div>
          </SectionCard>

          <SectionCard 
            title="Business & Payout Information" 
            icon={<Icons.Building />}
            action={
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveDrawer('business')}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                >
                  <Icons.Edit /> Business
                </button>
                <button 
                  onClick={() => setActiveDrawer('banking')}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                >
                  <Icons.Edit /> Banking
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <div className="space-y-1">
                <FieldRow label="Legal Name" value={settings.business.legalName || <span className="text-gray-400 italic">Not configured yet — click Edit Business</span>} />
                <FieldRow label="Trade License" value={settings.business.licenseNumber || <span className="text-gray-400 italic">Pending</span>} />
                <FieldRow label="VAT / Tax ID" value={settings.business.taxId || <span className="text-gray-400 italic">Pending</span>} />
                <FieldRow label="Country / Region" value={settings.business.country || <span className="text-gray-400 italic">Pending</span>} />
                <FieldRow label="Industry" value={settings.business.industry || <span className="text-gray-400 italic">Pending</span>} />
              </div>
              <div className="space-y-1">
                <FieldRow label="Account Holder" value={settings.banking.holderName || <span className="text-gray-400 italic">Not configured yet — click Edit Banking</span>} />
                <FieldRow label="Bank Name" value={settings.banking.bankName || <span className="text-gray-400 italic">Pending</span>} />
                {!!(settings.banking as any).routingNumber && <FieldRow label="Routing # (USA Fed/ACH)" value={(settings.banking as any).routingNumber} />}
                <FieldRow label="Account #" value={settings.banking.accountNumber || <span className="text-gray-400 italic">Pending</span>} />
                {!!settings.banking.swiftCode && <FieldRow label="SWIFT / BIC" value={settings.banking.swiftCode} />}
                <FieldRow label="Payout Currency" value={<Badge color="gray">{(settings.banking as any).payoutCurrency || 'USD'}</Badge>} />
                <FieldRow label="Payout Frequency" value={<Badge color="green">{settings.banking.payoutFrequency}</Badge>} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Developer Settings" icon={<Icons.Code />}>
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">API Key</div>
                  <div className="text-xs text-gray-500 mt-1 leading-5">
                    This key authenticates your POS integrations and webhooks. Keep it private and only share it with trusted apps.
                  </div>
                </div>
                <button 
                  onClick={async () => {
                      if (!window.confirm("Are you sure you want to regenerate your API Key? This will invalidate the old key.")) return;
                      try {
                          const res = await regenerateApiKey();
                          setSettings({...settings, developer: {...settings.developer, apiKey: res.api_key}});
                          setMsg({ text: "API Key regenerated", type: 'success' });
                      } catch {
                          setMsg({ text: "Failed to regenerate API Key", type: 'error' });
                      }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 bg-blue-50 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
                >
                  Regenerate
                </button>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-900/95 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge color="yellow">Secret</Badge>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Do not share publicly</span>
                </div>
                <div className="flex items-center justify-between group relative gap-2">
                  <code className="text-sm font-mono text-gray-100 truncate flex-1 mr-2">
                    {apiKeyRevealed ? settings.developer.apiKey : settings.developer.apiKey.substring(0, 8) + "•".repeat(24)}
                  </code>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setApiKeyRevealed(!apiKeyRevealed)}
                      className="text-gray-400 hover:text-white transition-colors p-1"
                    >
                      {apiKeyRevealed ? <Icons.EyeOff /> : <Icons.Eye />}
                    </button>
                    <button 
                      onClick={() => {
                          navigator.clipboard.writeText(settings.developer.apiKey);
                          setMsg({ text: "Copied to clipboard", type: 'success' });
                          setTimeout(() => setMsg(null), 2000);
                      }}
                      className="text-gray-400 hover:text-white transition-colors p-1"
                    >
                      <Icons.Code />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

        </div>

        <div className="space-y-8">
          
          <SectionCard title="Terminal Settings" icon={<Icons.Terminal />}>
             <div className="divide-y divide-gray-50">
               <Toggle 
                 label="Offline Mode" 
                 description="Allow eligible transactions to be queued while the provider is unavailable. They remain pending until provider capture."
                 checked={terminal.offlineMode}
                 onChange={(offlineMode) => setSettings(prev => ({
                   ...prev,
                   terminal: { ...(prev.terminal ?? DEFAULTS.terminal), offlineMode }
                 }))}
               />
               <Toggle 
                 label="Auto-Update Firmware" 
                 description="Unavailable: this build has no firmware update agent."
                 checked={terminal.autoUpdate}
                 onChange={(autoUpdate) => setSettings(prev => ({
                   ...prev,
                   terminal: { ...(prev.terminal ?? DEFAULTS.terminal), autoUpdate }
                 }))}
                 disabled
               />
               <div className="pt-4">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Allowed Features</div>
                 <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className="font-medium text-green-800">Manual Card Entry — ALWAYS ENABLED</span>
                      <span className="ml-auto text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">ON</span>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input 
                        type="checkbox" 
                        checked={terminalFeatures.refunds} 
                        onChange={(e) => setSettings(prev => ({
                          ...prev, 
                          terminal: {
                            ...(prev.terminal ?? DEFAULTS.terminal), 
                            features: {
                              ...(prev.terminal?.features ?? DEFAULTS.terminal.features), 
                              refunds: e.target.checked,
                              manualEntry: true,
                            }
                          }
                        }))}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                        disabled
                      />
                      Process Refunds <span className="text-xs text-gray-400">(No provider refund handler configured)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input 
                        type="checkbox" 
                        checked={terminalFeatures.tips} 
                        onChange={(e) => setSettings(prev => ({
                          ...prev, 
                          terminal: {
                            ...(prev.terminal ?? DEFAULTS.terminal), 
                            features: {
                              ...(prev.terminal?.features ?? DEFAULTS.terminal.features), 
                              tips: e.target.checked,
                              manualEntry: true,
                            }
                          }
                        }))}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        disabled
                      />
                      Accept Tips <span className="text-xs text-gray-400">(No tip amount/capture flow implemented)</span>
                    </label>
                 </div>
               </div>
             </div>
          </SectionCard>

          <SectionCard title="Security" icon={<Icons.Shield />}>
             <div className="divide-y divide-gray-50">
               <Toggle 
                 label="Two-Factor Auth" 
                 description="Require code for login"
                 checked={settings.security.twoFactorEnabled} 
                 onChange={(v) => handleToggle2FA(v)} 
               />
               <div className="py-4">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Active Sessions</div>
                 <div className="space-y-3">
                   {visibleSessions.map((device) => (
                     <div key={device.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                       <div className="flex items-center gap-3">
                         <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                           <Icons.Terminal />
                         </div>
                         <div>
                           <div className="text-sm font-medium text-gray-900">{device.name}</div>
                           <div className="text-xs text-gray-500">{device.location} • {device.lastActive}</div>
                         </div>
                       </div>
                       {device.current ? (
                         <Badge color="green">Current</Badge>
                       ) : (
                         <button 
                            onClick={async () => {
                                try {
                                    await revokeSession(device.id);
                                    const newDevices = activeDevices.filter(d => d.id !== device.id);
                                    setSettings(prev => ({...prev, security: {...(prev.security ?? DEFAULTS.security), activeDevices: newDevices}}));
                                    setMsg({ text: "Session revoked", type: 'success' });
                                } catch (e) {
                                    setMsg({ text: "Failed to revoke session", type: 'error' });
                                }
                            }}
                            className="text-xs text-red-600 hover:text-red-700 font-medium"
                         >
                            Revoke
                         </button>
                       )}
                     </div>
                   ))}
                   {activeDevices.length === 0 && (
                       <div className="text-sm text-gray-500 text-center py-2">No active sessions found.</div>
                   )}
                   {hasMoreSessions && (
                     <button
                       onClick={() => setShowAllSessions(!showAllSessions)}
                       className="w-full text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                     >
                       {showAllSessions ? "Show fewer sessions" : `View more sessions (${activeDevices.length - 3} more)`}
                     </button>
                   )}
                 </div>
               </div>
               <button 
                 onClick={() => setActiveDrawer('security')}
                 className="w-full mt-2 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
               >
                 Change Password & Manage Devices
               </button>
             </div>
          </SectionCard>

          <SectionCard title="Notifications" icon={<Icons.Bell />}>
             <div className="divide-y divide-gray-50">
               <Toggle 
                 label="Email Alerts" 
                 checked={notifications.email} 
                 onChange={(v) => setSettings(prev => ({...prev, notifications: {...(prev.notifications ?? DEFAULTS.notifications), email: v}}))} 
               />
               <Toggle 
                 label="SMS Alerts" 
                 checked={notifications.sms} 
                 onChange={(v) => setSettings(prev => ({...prev, notifications: {...(prev.notifications ?? DEFAULTS.notifications), sms: v}}))} 
               />
               <div className="pt-4">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Notify me when</div>
                 <div className="space-y-2">
                    {Object.entries(notificationAlerts).map(([key, val]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-700 capitalize">
                        <input type="checkbox" checked={val}                         className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        disabled readOnly />
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </label>
                    ))}
                 </div>
               </div>
             </div>
          </SectionCard>

        </div>

      </div>

      <SettingsDrawer 
        isOpen={activeDrawer === 'profile'} 
        onClose={() => setActiveDrawer(null)}
        title="Profile Information"
        onSave={handleSave}
      >
        <div className="space-y-4">
          <Input 
            label="Full Name" 
            placeholder="Full Name"
            value={settings.profile.name} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, name: e.target.value}})}
          />
          <Input 
            label="Display Name" 
            placeholder="Display Name"
            value={settings.profile.displayName} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, displayName: e.target.value}})}
          />
          <Input 
            label="Email Address" 
            placeholder="your@email.com"
            value={settings.profile.email} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, email: e.target.value}})}
          />
          <Input 
            label="Profile Picture URL" 
            placeholder="https://example.com/avatar.jpg"
            value={settings.profile.avatarUrl || ""} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, avatarUrl: e.target.value}})}
          />
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Language</label>
            <select 
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={settings.profile.language}
              onChange={(e) => setSettings({...settings, profile: {...settings.profile, language: e.target.value}})}
            >
              <option value="en">English</option>
              <option value="ar">Arabic</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Theme</label>
            <select 
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={settings.profile.theme}
              onChange={(e) => setSettings({...settings, profile: {...settings.profile, theme: e.target.value}})}
            >
              <option value="light">Light Mode</option>
              <option value="dark">Dark Mode</option>
            </select>
          </div>
          <Input 
            label="Phone Number" 
            placeholder="+971 50 000 0000"
            value={settings.profile.phone} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, phone: e.target.value}})}
          />
          <Input 
            label="Country" 
            placeholder="United Arab Emirates"
            value={settings.profile.country} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, country: e.target.value}})}
          />
          <Input 
            label="Time Zone" 
            placeholder="Asia/Dubai"
            value={settings.profile.timezone} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, timezone: e.target.value}})}
          />
          <Input 
            label="Company / Business Name" 
            placeholder="Your Business Name"
            value={settings.profile.companyName} 
            onChange={(e) => setSettings({...settings, profile: {...settings.profile, companyName: e.target.value}})}
          />
        </div>
      </SettingsDrawer>

      <SettingsDrawer 
        isOpen={activeDrawer === 'banking'} 
        onClose={() => setActiveDrawer(null)}
        title="Update Banking / Payout Details"
        onSave={handleSave}
      >
        <div className="space-y-2">
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-800 leading-5">
              💡 <strong>Save works now:</strong> Click "Save Changes" below → actually persists to database. On reload values stay saved.
            </p>
          </div>
          <Input 
            label="Account Holder Name (Beneficiary)"
            placeholder="PRIMESTACK TECHNOLOGIES LLC"
            value={settings.banking.holderName} 
            onChange={(e) => setSettings({...settings, banking: {...settings.banking, holderName: e.target.value}})} 
          />
          <Input 
            label="Bank Name / Depository"
            placeholder="Replacement bank provider"
            value={settings.banking.bankName} 
            onChange={(e) => setSettings({...settings, banking: {...settings.banking, bankName: e.target.value}})} 
          />
          <Input 
            label="Routing Number (FedWire / ACH, USA)"
            placeholder="084009519"
            value={(settings.banking as any).routingNumber || ""}
            onChange={(e) => setSettings({...settings, banking: {...settings.banking, routingNumber: e.target.value} as any})} 
          />
          <Input 
            label="Account Number / IBAN"
            placeholder="343612919064346"
            value={settings.banking.accountNumber} 
            onChange={(e) => setSettings({...settings, banking: {...settings.banking, accountNumber: e.target.value}})} 
          />
          <Input 
            label="SWIFT / BIC Code (International wires)"
            placeholder="Provider SWIFT / BIC"
            value={settings.banking.swiftCode} 
            onChange={(e) => setSettings({...settings, banking: {...settings.banking, swiftCode: e.target.value}})} 
          />
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Payout Currency</label>
            <select 
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={(settings.banking as any).payoutCurrency || "USD"}
              onChange={(e) => setSettings({...settings, banking: {...settings.banking, payoutCurrency: e.target.value} as any})}
            >
              <option value="USD">USD — US Dollar</option>
              <option value="AED">AED — UAE Dirham</option>
              <option value="MYR">MYR — Malaysian Ringgit</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="SGD">SGD — Singapore Dollar</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Payout Frequency</label>
            <select 
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={settings.banking.payoutFrequency}
              onChange={(e) => setSettings({...settings, banking: {...settings.banking, payoutFrequency: e.target.value as any}})}
            >
              <option value="DAILY">Daily (T+1 next business day)</option>
              <option value="WEEKLY">Weekly (Fridays)</option>
              <option value="MONTHLY">Monthly (1st of month)</option>
            </select>
          </div>
        </div>
      </SettingsDrawer>

      <SettingsDrawer 
        isOpen={activeDrawer === 'business'} 
        onClose={() => setActiveDrawer(null)}
        title="Edit Business Information"
        onSave={handleSave}
      >
        <div className="space-y-2">
          <Input 
            label="Legal Business Name" 
            value={settings.business.legalName} 
            onChange={(e) => setSettings({...settings, business: {...settings.business, legalName: e.target.value}})} 
          />
          <Input 
            label="Trade License Number" 
            value={settings.business.licenseNumber} 
            onChange={(e) => setSettings({...settings, business: {...settings.business, licenseNumber: e.target.value}})} 
          />
          <Input 
            label="VAT / Tax Registration" 
            value={settings.business.taxId} 
            onChange={(e) => setSettings({...settings, business: {...settings.business, taxId: e.target.value}})} 
          />
          <Input 
            label="Country & Region" 
            value={settings.business.country} 
            onChange={(e) => setSettings({...settings, business: {...settings.business, country: e.target.value}})} 
          />
          <Input 
            label="Industry Category" 
            value={settings.business.industry} 
            onChange={(e) => setSettings({...settings, business: {...settings.business, industry: e.target.value}})} 
          />
        </div>
      </SettingsDrawer>

      <SettingsDrawer 
        isOpen={activeDrawer === 'security'} 
        onClose={() => setActiveDrawer(null)}
        title="Security & Authentication"
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Change Password</h3>
            <div className="space-y-2">
               <Input 
                 label="Current Password" 
                 type="password" 
                 value={oldPassword} 
                 onChange={(e) => setOldPassword(e.target.value)} 
               />
               <Input 
                 label="New Password" 
                 type="password" 
                 value={newPassword} 
                 onChange={(e) => setNewPassword(e.target.value)} 
               />
               <Input 
                 label="Confirm New Password" 
                 type="password" 
                 value={confirmPassword} 
                 onChange={(e) => setConfirmPassword(e.target.value)} 
               />
               <div className="pt-2">
                 <button 
                   onClick={handlePasswordChange}
                   disabled={passwordLoading}
                   className={`w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${passwordLoading ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors flex justify-center`}
                 >
                   {passwordLoading ? 'Updating...' : 'Update Password'}
                 </button>
               </div>
            </div>
          </div>
          
          <div className="pt-6 border-t border-gray-100">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Two-Factor Authentication</h3>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
               <div className="flex items-start gap-3">
                 <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                   <Icons.Shield />
                 </div>
                 <div>
                   <div className="font-medium text-blue-900 text-sm">Two-Factor Authentication is {settings.security.twoFactorEnabled ? 'Enabled' : 'Disabled'}</div>
                   <p className="text-xs text-blue-700 mt-1">
                    Protect your account with an extra layer of security. We'll require a code in addition to your password.
                  </p>
                  <button 
                    onClick={() => handleToggle2FA(!settings.security.twoFactorEnabled)}
                    className={`mt-3 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${settings.security.twoFactorEnabled ? 'bg-white text-red-600 border-red-200 hover:bg-red-50' : 'bg-blue-600 text-white border-transparent hover:bg-blue-700'}`}
                  >
                    {settings.security.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                  </button>
                 </div>
               </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Device Management</h3>
            <div className="space-y-3">
               {activeDevices.map((device) => (
                 <div key={device.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="text-gray-400">
                        {device.name.toLowerCase().includes('phone') ? 
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg> :
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        }
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{device.name}</div>
                        <div className="text-xs text-gray-500">{device.location} • {device.lastActive}</div>
                      </div>
                    </div>
                    {device.current ? (
                      <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded">Current</span>
                    ) : (
                      <button 
                        onClick={async () => {
                          try {
                            await revokeSession(device.id);
                            const newDevices = activeDevices.filter(d => d.id !== device.id);
                            setSettings(prev => ({...prev, security: {...(prev.security ?? DEFAULTS.security), activeDevices: newDevices}}));
                            setMsg({ text: "Session revoked", type: 'success' });
                          } catch {
                            setMsg({ text: "Failed to revoke session", type: 'error' });
                          }
                        }}
                        className="text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                 </div>
               ))}
            </div>
          </div>
        </div>
      </SettingsDrawer>

    </div>
  );
};
