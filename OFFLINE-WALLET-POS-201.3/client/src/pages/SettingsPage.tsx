import { useEffect, useState } from "react";
import { fetchSettings, updateSettings, toggle2FA, changePassword, getProfile, updateProfile, getSessions, revokeSession, regenerateApiKey } from "../lib/api";

// --- Interfaces ---

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
  accountNumber: string;
  swiftCode: string;
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
  }
}

interface DeveloperSettings {
  apiKey: string;
  webhookUrl: string;
  signingSecret: string;
  testMode: boolean;
  paypalClientId: string;
  paypalClientSecret: string;
  myfatoorahApiToken: string;
  myfatoorahTestMode: boolean;
}

interface TerminalSettings {
  offlineMode: boolean;
  autoUpdate: boolean;
  features: {
    manualEntry: boolean;
    refunds: boolean;
    tips: boolean;
  }
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

// --- Icons ---

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

// --- Components ---

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

const Toggle = ({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string }) => (
  <div className="flex items-center justify-between py-3">
    <div>
      <div className="text-sm font-medium text-gray-900">{label}</div>
      {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
    </div>
    <button 
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
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
  onSave?: () => void;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <Icons.X />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => { onSave?.(); onClose(); }} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors">Save Changes</button>
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

const FileUpload = ({ label }: { label: string }) => (
  <div className="mb-4">
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group">
      <div className="space-y-1 text-center">
        <div className="mx-auto h-12 w-12 text-gray-400 group-hover:text-blue-500 transition-colors">
          <svg className="w-12 h-12" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex text-sm text-gray-600 justify-center">
          <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none">
            <span>Upload a file</span>
            <input type="file" className="sr-only" />
          </label>
          <p className="pl-1">or drag and drop</p>
        </div>
        <p className="text-xs text-gray-500">PDF, PNG, JPG up to 10MB</p>
      </div>
    </div>
  </div>
);

export const SettingsPage = () => {
  const [settings, setSettings] = useState<FullSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  // Interaction states
  const [activeDrawer, setActiveDrawer] = useState<'profile' | 'banking' | 'business' | 'security' | null>(null);

  // Password Change State
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

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
      // Optimistic update
      setSettings({...settings, security: {...settings.security, twoFactorEnabled: enabled}});
      const res = await toggle2FA(enabled);
      setMsg({ text: res.message, type: 'success' });
      setTimeout(() => setMsg(null), 3000);
    } catch (error: any) {
      // Revert on error
      setSettings({...settings, security: {...settings.security, twoFactorEnabled: !enabled}});
      setMsg({ text: error.message || "Failed to toggle 2FA", type: 'error' });
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [loadedSettingsData, setLoadedSettingsData] = useState<any>(null);

  useEffect(() => {
    // Load Settings
    const loadSettings = async () => {
      try {
        let profileData: any = {};
        try {
            profileData = await getProfile();
        } catch (e) {
            console.warn("Failed to load profile", e);
            // Minimal fallback for profile data
            profileData = {
                full_name: "Merchant User",
                display_name: "Merchant",
                email: "merchant@example.com"
            };
        }

        let settingsData: any = {};
        try {
            settingsData = await fetchSettings();
            setLoadedSettingsData(settingsData);
        } catch (e) {
            console.warn("Failed to load settings", e);
        }
        
        let sessionsData: any[] = [];
        try {
            sessionsData = await getSessions();
        } catch (e) {
            console.warn("Failed to load sessions", e);
        }
        
        // Map API response to UI state
        const mappedProfile: MerchantProfile = {
          name: profileData.full_name || "Merchant User",
          displayName: profileData.display_name || "Merchant",
          email: profileData.email || "merchant@example.com",
          phone: profileData.phone || "",
          country: profileData.country || "",
          timezone: profileData.timezone || "",
          companyName: profileData.company || "",
          address: "Address not set",
          businessType: "Retail",
          avatarUrl: profileData.avatar_url || "",
          theme: profileData.theme_preference || "light",
          language: profileData.language_preference || "en"
        };

        const mockSettings: any = {
            profile: mappedProfile,
            business: {
                legalName: profileData.company || "Company Name", // Use company name from profile as fallback
                licenseNumber: "BUS-2023-89912",
                taxId: "US-99-1234567",
                country: profileData.country || "United States",
                industry: "Retail & Consumer Goods"
            },
            banking: {
                holderName: profileData.company || "Company Name",
                bankName: "Chase Bank",
                accountNumber: "**** **** **** 8821",
                swiftCode: "CHASUS33",
                payoutFrequency: "DAILY"
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
                email: true,
                sms: false,
                alerts: {
                    failedBatches: true,
                    highValue: true,
                    offline: true,
                    settlement: true
                }
            },
            developer: {
                apiKey: settingsData.api_key || "sk_test_mock_key_12345",
                webhookUrl: settingsData.webhook_url || "",
                signingSecret: "whsec_mock_secret",
                testMode: settingsData.test_mode !== undefined ? settingsData.test_mode : true,
                paypalClientId: settingsData.paypal_client_id || "",
                paypalClientSecret: settingsData.paypal_client_secret || "",
                myfatoorahApiToken: settingsData.myfatoorah_api_token || "",
                myfatoorahTestMode: settingsData.myfatoorah_test_mode !== undefined ? settingsData.myfatoorah_test_mode : true
            },
            terminal: {
                offlineMode: true,
                autoUpdate: true,
                features: {
                    manualEntry: false,
                    refunds: true,
                    tips: true
                }
            }
        };

        setSettings(mockSettings);
      } catch (e) {
        console.error("Failed to load profile from API", e);
        // Fallback or error handling
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    
    // Validation
    if (!settings.profile.name || !settings.profile.name.trim()) {
        setMsg({ text: "Full name is required", type: 'error' });
        setTimeout(() => setMsg(null), 3000);
        return;
    }

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
            test_mode: settings.developer.testMode,
            merchant_name: settings.profile.name,
            support_email: settings.profile.email,
            paypal_client_id: settings.developer.paypalClientId,
            paypal_client_secret: settings.developer.paypalClientSecret,
            myfatoorah_api_token: settings.developer.myfatoorahApiToken,
            myfatoorah_test_mode: settings.developer.myfatoorahTestMode
        });

        setMsg({ text: "Settings saved successfully", type: 'success' });
    } catch (e: any) {
        console.error("Save failed:", e);
        setMsg({ text: "Failed to save settings: " + (e.message || "Unknown error"), type: 'error' });
    }
    
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm text-gray-500 font-medium">Loading Merchant Profile...</div>
      </div>
    </div>
  );

  if (!settings) return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] space-y-4">
      <div className="text-red-500 bg-red-50 p-4 rounded-full">
         <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      </div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-900">Unable to Load Settings</h3>
        <p className="text-gray-500 mt-1 max-w-sm mx-auto">
          We encountered an error loading your merchant profile. Please try refreshing the page or logging in again.
        </p>
      </div>
      <button 
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium shadow-sm hover:bg-blue-700 transition-colors"
      >
        Retry Connection
      </button>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-8 pb-12 max-w-6xl mx-auto">
      
      {/* Header */}
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
        
        {/* Left Column - Profile, Business, Banking */}
        <div className="space-y-8 lg:col-span-2">
          
          {/* 1. Merchant Profile */}
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

          {/* 3. Business Information (Combined Payout) */}
          <SectionCard 
            title="Business & Payout Information" 
            icon={<Icons.Building />}
            action={
              <button 
                onClick={() => setActiveDrawer('business')}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
              >
                <Icons.Edit /> Edit
              </button>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <div className="space-y-1">
                <FieldRow label="Legal Name" value={settings.business.legalName} />
                <FieldRow label="Trade License" value={settings.business.licenseNumber} />
                <FieldRow label="VAT / Tax ID" value={settings.business.taxId} />
              </div>
              <div className="space-y-1">
                <FieldRow label="Bank Account" value={settings.banking.accountNumber} subtext="**** 8821" />
                <FieldRow label="Payout Frequency" value={<Badge color="green">{settings.banking.payoutFrequency}</Badge>} />
                <p className="text-[10px] text-gray-400 mt-2 italic">* Payouts are handled automatically via MyFatoorah settlement.</p>
              </div>
            </div>
          </SectionCard>

          {/* 6. Developer Settings */}
          <SectionCard title="Developer Settings" icon={<Icons.Code />}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">API Key</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Use this key to authenticate API requests. Keep it secret.
                  </div>
                </div>
                <button 
                  onClick={async () => {
                      if (!window.confirm("Are you sure you want to regenerate your API Key? This will invalidate the old key.")) return;
                      try {
                          const res = await regenerateApiKey();
                          setSettings({...settings, developer: {...settings.developer, apiKey: res.api_key}});
                          setMsg({ text: "API Key regenerated", type: 'success' });
                      } catch (e) {
                          setMsg({ text: "Failed to regenerate API Key", type: 'error' });
                      }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                >
                  Regenerate
                </button>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 flex items-center justify-between group relative">
                 <code className="text-sm font-mono text-gray-100 truncate flex-1 mr-4">
                    {apiKeyRevealed ? settings.developer.apiKey : settings.developer.apiKey.substring(0, 8) + "•".repeat(24)}
                 </code>
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
                    className="text-gray-400 hover:text-white transition-colors p-1 ml-1"
                 >
                    <Icons.Code />
                 </button>
              </div>

              <div className="pt-4 border-t border-gray-100">
                 <div className="mb-4">
                   <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">PayPal Client ID</label>
                   <input 
                     type="text" 
                     value={settings.developer.paypalClientId}
                     onChange={(e) => setSettings({...settings, developer: {...settings.developer, paypalClientId: e.target.value}})}
                     placeholder="Paste your PayPal Client ID here"
                     className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                   />
                 </div>
                 <div className="mb-4">
                   <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">PayPal Client Secret</label>
                   <input 
                     type="password" 
                     value={settings.developer.paypalClientSecret}
                     onChange={(e) => setSettings({...settings, developer: {...settings.developer, paypalClientSecret: e.target.value}})}
                     placeholder="Paste your PayPal Client Secret here"
                     className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                   />
                 </div>
               </div>

               {/* MyFatoorah Settings */}
               <div className="pt-4 border-t border-gray-100">
                 <div className="flex items-center justify-between mb-4">
                   <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">MyFatoorah API Token</label>
                   <span className="text-xs text-blue-600 font-medium">Primary Payment Gateway</span>
                 </div>
                 <div className="mb-4">
                   <input 
                     type="password" 
                     value={settings.developer.myfatoorahApiToken}
                     onChange={(e) => setSettings({...settings, developer: {...settings.developer, myfatoorahApiToken: e.target.value}})}
                     placeholder="Paste your MyFatoorah API Token here"
                     className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                   />
                   <p className="text-xs text-gray-400 mt-1">
                     Get your token from <a href="https://myfatoorah.com" target="_blank" className="text-blue-600 hover:underline">MyFatoorah Dashboard</a>
                   </p>
                 </div>
                 <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                   <div>
                     <div className="text-sm font-medium text-gray-900">MyFatoorah Test Mode</div>
                     <div className="text-xs text-gray-500">Use sandbox for testing</div>
                   </div>
                   <button 
                     onClick={() => setSettings({...settings, developer: {...settings.developer, myfatoorahTestMode: !settings.developer.myfatoorahTestMode}})}
                     className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${settings.developer.myfatoorahTestMode ? 'bg-blue-600' : 'bg-gray-200'}`}
                   >
                     <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${settings.developer.myfatoorahTestMode ? 'translate-x-6' : 'translate-x-1'}`} />
                   </button>
                 </div>
                 <button
                   onClick={async () => {
                     try {
                       setMsg({ text: "Testing MyFatoorah connection...", type: 'success' });
                       const res = await fetch('/merchant/v1/myfatoorah/check-connection', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                         body: JSON.stringify({
                           apiToken: settings.developer.myfatoorahApiToken,
                           testMode: settings.developer.myfatoorahTestMode
                         })
                       });
                       const data = await res.json();
                       if (data.connected) {
                         setMsg({ text: `✓ Connected to MyFatoorah ${data.mode}`, type: 'success' });
                       } else {
                         setMsg({ text: `✗ ${data.message}`, type: 'error' });
                       }
                     } catch (e) {
                       setMsg({ text: "Failed to test connection", type: 'error' });
                     }
                     setTimeout(() => setMsg(null), 5000);
                   }}
                   disabled={!settings.developer.myfatoorahApiToken}
                   className="mt-3 w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                 >
                   Test MyFatoorah Connection
                 </button>
               </div>

               <div className="pt-4 border-t border-gray-100">
                <Toggle 
                  label="Test Mode" 
                  description="Use sandbox environment for transactions. Disable for Live processing."
                  checked={settings.developer.testMode} 
                  onChange={async (v) => {
                    // Update local state first for instant UI feedback
                    const updatedSettings = {...settings, developer: {...settings.developer, testMode: v}};
                    setSettings(updatedSettings);
                    
                    // Auto-save this specific change to ensure it persists
                    try {
                      await updateSettings({
                        ...loadedSettingsData, // Use current loaded settings as base
                        api_key: updatedSettings.developer.apiKey,
                        test_mode: v,
                        merchant_name: updatedSettings.profile.name,
                        support_email: updatedSettings.profile.email
                      });
                      setMsg({ text: `Test Mode ${v ? 'Enabled' : 'Disabled'}`, type: 'success' });
                      setTimeout(() => setMsg(null), 2000);
                    } catch (e) {
                      console.error("Auto-save failed:", e);
                    }
                  }} 
                />
              </div>
            </div>
          </SectionCard>

        </div>

        {/* Right Column - Terminal, Security, Notifications */}
        <div className="space-y-8">
          
          {/* 4. Terminal Settings */}
          <SectionCard title="Terminal Settings" icon={<Icons.Terminal />}>
             <div className="divide-y divide-gray-50">
               <Toggle 
                 label="Offline Mode" 
                 description="Allow processing when internet is down"
                 checked={settings.terminal.offlineMode} 
                 onChange={(v) => setSettings({...settings, terminal: {...settings.terminal, offlineMode: v}})} 
               />
               <Toggle 
                 label="Auto-Update Firmware" 
                 description="Install updates between 2am-4am"
                 checked={settings.terminal.autoUpdate} 
                 onChange={(v) => setSettings({...settings, terminal: {...settings.terminal, autoUpdate: v}})} 
               />
               <div className="pt-4">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Allowed Features</div>
                 <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input 
                        type="checkbox" 
                        checked={settings.terminal.features.manualEntry} 
                        onChange={(e) => setSettings({
                          ...settings, 
                          terminal: {
                            ...settings.terminal, 
                            features: {
                              ...settings.terminal.features, 
                              manualEntry: e.target.checked
                            }
                          }
                        })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                      />
                      Manual Card Entry
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input 
                        type="checkbox" 
                        checked={settings.terminal.features.refunds} 
                        onChange={(e) => setSettings({
                          ...settings, 
                          terminal: {
                            ...settings.terminal, 
                            features: {
                              ...settings.terminal.features, 
                              refunds: e.target.checked
                            }
                          }
                        })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                      />
                      Process Refunds
                    </label>
                 </div>
               </div>
             </div>
          </SectionCard>

          {/* 5. Security */}
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
                   {settings.security.activeDevices.map((device, i) => (
                     <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
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
                                    // Refresh settings or remove from state
                                    const newDevices = settings.security.activeDevices.filter(d => d.id !== device.id);
                                    setSettings({...settings, security: {...settings.security, activeDevices: newDevices}});
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
                   {settings.security.activeDevices.length === 0 && (
                       <div className="text-sm text-gray-500 text-center py-2">No active sessions found.</div>
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

          {/* 6. Notifications */}
          <SectionCard title="Notifications" icon={<Icons.Bell />}>
             <div className="divide-y divide-gray-50">
               <Toggle 
                 label="Email Alerts" 
                 checked={settings.notifications.email} 
                 onChange={(v) => setSettings({...settings, notifications: {...settings.notifications, email: v}})} 
               />
               <Toggle 
                 label="SMS Alerts" 
                 checked={settings.notifications.sms} 
                 onChange={(v) => setSettings({...settings, notifications: {...settings.notifications, sms: v}})} 
               />
               <div className="pt-4">
                 <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Notify me when</div>
                 <div className="space-y-2">
                    {Object.entries(settings.notifications.alerts).map(([key, val]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-700 capitalize">
                        <input type="checkbox" checked={val} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" readOnly />
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </label>
                    ))}
                 </div>
               </div>
             </div>
          </SectionCard>

        </div>

      </div>

      {/* Drawers */}
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
        title="Update Banking Details"
      >
        <div className="space-y-2">
          <Input label="Account Holder Name" defaultValue={settings.banking.holderName} />
          <Input label="Bank Name" defaultValue={settings.banking.bankName} />
          <Input label="Account Number / IBAN" defaultValue={settings.banking.accountNumber} />
          <Input label="SWIFT / BIC Code" defaultValue={settings.banking.swiftCode} />
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Payout Frequency</label>
            <select className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all">
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
        </div>
      </SettingsDrawer>

      <SettingsDrawer 
        isOpen={activeDrawer === 'business'} 
        onClose={() => setActiveDrawer(null)}
        title="Edit Business Information"
      >
        <div className="space-y-2">
          <Input label="Legal Business Name" defaultValue={settings.business.legalName} />
          <Input label="Trade License Number" defaultValue={settings.business.licenseNumber} />
          <Input label="VAT / Tax Registration" defaultValue={settings.business.taxId} />
          <Input label="Country & Region" defaultValue={settings.business.country} />
          <Input label="Industry Category" defaultValue={settings.business.industry} />
          <div className="pt-2 border-t border-gray-100 mt-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Business Documents</h3>
            <FileUpload label="Trade License / Registration" />
            <FileUpload label="Tax / VAT Certificate" />
          </div>
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
               {settings.security.activeDevices.map((device, i) => (
                 <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100">
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
                    {i === 0 ? (
                      <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded">Current</span>
                    ) : (
                      <button className="text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors">
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
