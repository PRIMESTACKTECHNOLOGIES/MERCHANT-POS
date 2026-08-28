import { useState, useEffect } from "react";
import { useToast } from "../components/ui/Toast";
import { fetchSettings, updateSettings } from "../lib/api";

// --- Types ---
interface PaymentMethod {
  id: string;
  name: string;
  type: 'card' | 'wallet' | 'qr';
  description: string;
  enabled: boolean;
  offlineCapable: boolean;
  protocol2013Supported: boolean;
  logo: string;
  config: {
    floorLimit: number;
    maxTransactionAmount: number;
    requirePin: boolean;
    allowOffline: boolean;
  };
}

// --- Icons as SVG Components ---
const VisaLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="#1A1F71"/>
    <path d="M19 32L15 16H19L21 28L28 16H32L22 32H19Z" fill="white"/>
    <path d="M33 32L29 16H33L37 32H33Z" fill="white"/>
    <path d="M12 16L8 24L12 32H16L20 24L16 16H12Z" fill="white"/>
  </svg>
);

const MastercardLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="white"/>
    <circle cx="18" cy="24" r="10" fill="#EB001B"/>
    <circle cx="30" cy="24" r="10" fill="#F79E1B"/>
    <path d="M24 16C21.5 18 20 21 20 24C20 27 21.5 30 24 32C26.5 30 28 27 28 24C28 21 26.5 18 24 16Z" fill="#FF5F00"/>
  </svg>
);

const AmexLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="#006FCF"/>
    <path d="M8 20H12L14 24L16 20H20V28H17V23L15 28H13L11 23V28H8V20Z" fill="white"/>
    <path d="M21 20H28V22H24V23H28V25H24V26H28V28H21V20Z" fill="white"/>
    <path d="M29 20H36L37 22V26L36 28H29V20Z" fill="white"/>
    <path d="M32 23V26H34V23H32Z" fill="#006FCF"/>
  </svg>
);

const UnionPayLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="#C41E3A"/>
    <rect x="16" width="32" height="48" rx="4" fill="#006D75"/>
    <text x="8" y="30" fill="white" fontSize="8" fontWeight="bold">Union</text>
    <text x="8" y="38" fill="white" fontSize="8" fontWeight="bold">Pay</text>
  </svg>
);

const ApplePayLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="black"/>
    <path d="M28 16C29.5 16 31 17 31.5 18C30 19 29 20.5 29 22C29 24 30.5 25.5 32 26C31.5 28 30 30 28.5 30C27.5 30 27 29.5 26 29.5C25 29.5 24.5 30 23.5 30C22 30 20.5 28 19.5 26C18 23.5 19 20 20.5 18.5C21.5 17.5 23 17 24 17C25 17 26 17.5 26.5 17.5C27 17.5 28 16.5 29.5 16.5L28 16Z" fill="white"/>
    <text x="6" y="38" fill="white" fontSize="7" fontWeight="bold">Pay</text>
  </svg>
);

const GooglePayLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="white"/>
    <path d="M24 20V28H30C31.5 28 32.5 26.5 32.5 24C32.5 21.5 31.5 20 30 20H24Z" fill="#4285F4"/>
    <path d="M24 20H18C16.5 20 15.5 21.5 15.5 24C15.5 26.5 16.5 28 18 28H24V20Z" fill="#34A853"/>
    <path d="M18 20C16.5 20 15.5 21.5 15.5 24C15.5 24.5 15.5 25 16 25.5L12 22C11 23 11 25 12 26L16 22.5C15.5 23 15.5 23.5 15.5 24C15.5 26.5 16.5 28 18 28L24 24L18 20Z" fill="#FBBC04"/>
    <path d="M24 24V28H30C31.5 28 32.5 26.5 32.5 24H24Z" fill="#EA4335"/>
  </svg>
);

const AlipayLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="#1677FF"/>
    <text x="8" y="30" fill="white" fontSize="14" fontWeight="bold">Ali</text>
  </svg>
);

const GenericCardLogo = () => (
  <svg viewBox="0 0 48 48" className="w-10 h-10">
    <rect width="48" height="48" rx="4" fill="#f3f4f6"/>
    <rect x="8" y="18" width="32" height="12" rx="2" fill="#9CA3AF"/>
    <line x1="8" y1="22" x2="40" y2="22" stroke="#D1D5DB" strokeWidth="1"/>
  </svg>
);

// --- Page Component ---
export const PaymentMethodsPage = () => {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const { showToast } = useToast();

  const defaultMethods: PaymentMethod[] = [
    {
      id: "visa",
      name: "Visa",
      type: "card",
      description: "Global credit and debit card network",
      enabled: true,
      offlineCapable: true,
      protocol2013Supported: true,
      logo: "visa",
      config: { floorLimit: 100, maxTransactionAmount: 1000, requirePin: true, allowOffline: true }
    },
    {
      id: "mastercard",
      name: "Mastercard",
      type: "card",
      description: "Global credit and debit card network",
      enabled: true,
      offlineCapable: true,
      protocol2013Supported: true,
      logo: "mastercard",
      config: { floorLimit: 100, maxTransactionAmount: 1000, requirePin: true, allowOffline: true }
    },
    {
      id: "amex",
      name: "American Express",
      type: "card",
      description: "Premium credit card network",
      enabled: true,
      offlineCapable: true,
      protocol2013Supported: true,
      logo: "amex",
      config: { floorLimit: 100, maxTransactionAmount: 5000, requirePin: false, allowOffline: true }
    },
    {
      id: "unionpay",
      name: "UnionPay",
      type: "card",
      description: "Major card network in China and Asia",
      enabled: false,
      offlineCapable: true,
      protocol2013Supported: true,
      logo: "unionpay",
      config: { floorLimit: 100, maxTransactionAmount: 2000, requirePin: true, allowOffline: true }
    },
    {
      id: "applepay",
      name: "Apple Pay",
      type: "wallet",
      description: "Apple's digital wallet and mobile payment",
      enabled: false,
      offlineCapable: false,
      protocol2013Supported: false,
      logo: "applepay",
      config: { floorLimit: 0, maxTransactionAmount: 500, requirePin: false, allowOffline: false }
    },
    {
      id: "googlepay",
      name: "Google Pay",
      type: "wallet",
      description: "Google's digital wallet and mobile payment",
      enabled: false,
      offlineCapable: false,
      protocol2013Supported: false,
      logo: "googlepay",
      config: { floorLimit: 0, maxTransactionAmount: 500, requirePin: false, allowOffline: false }
    },
    {
      id: "alipay",
      name: "Alipay",
      type: "qr",
      description: "China's leading QR code payment platform",
      enabled: false,
      offlineCapable: false,
      protocol2013Supported: false,
      logo: "alipay",
      config: { floorLimit: 0, maxTransactionAmount: 1000, requirePin: false, allowOffline: false }
    }
  ];

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  const loadPaymentMethods = async () => {
    try {
      setLoading(true);
      const settings = await fetchSettings();
      
      if (settings?.paymentConfig?.length > 0) {
        setMethods(settings.paymentConfig);
      } else {
        // Try localStorage fallback
        const saved = localStorage.getItem('payment_methods_v2');
        if (saved) {
          setMethods(JSON.parse(saved));
        } else {
          setMethods(defaultMethods);
        }
      }
    } catch (error) {
      console.error("Failed to load payment methods:", error);
      setMethods(defaultMethods);
    } finally {
      setLoading(false);
    }
  };

  const saveMethods = async (newMethods: PaymentMethod[]) => {
    try {
      // Save to backend
      const settings = await fetchSettings();
      await updateSettings({
        ...settings,
        paymentConfig: newMethods
      });
      // Save to localStorage as backup
      localStorage.setItem('payment_methods_v2', JSON.stringify(newMethods));
      showToast("Payment methods saved", "success");
    } catch (error) {
      console.error("Failed to save:", error);
      showToast("Failed to save to server", "error");
    }
  };

  const toggleMethod = async (methodId: string) => {
    const newMethods = methods.map(m => 
      m.id === methodId ? { ...m, enabled: !m.enabled } : m
    );
    setMethods(newMethods);
    await saveMethods(newMethods);
  };

  const updateConfig = async (methodId: string, updates: Partial<PaymentMethod['config']>) => {
    const newMethods = methods.map(m => 
      m.id === methodId ? { ...m, config: { ...m.config, ...updates } } : m
    );
    setMethods(newMethods);
    await saveMethods(newMethods);
  };

  const getLogo = (logoType: string) => {
    switch (logoType) {
      case 'visa': return <VisaLogo />;
      case 'mastercard': return <MastercardLogo />;
      case 'amex': return <AmexLogo />;
      case 'unionpay': return <UnionPayLogo />;
      case 'applepay': return <ApplePayLogo />;
      case 'googlepay': return <GooglePayLogo />;
      case 'alipay': return <AlipayLogo />;
      default: return <GenericCardLogo />;
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Payment Methods</h1>
        <p className="text-gray-600 mt-2">
          Configure which payment methods your POS accepts. Methods marked with 
          <span className="inline-flex items-center px-2 py-0.5 mx-1 rounded text-xs font-medium bg-green-100 text-green-800">
            201.3 Protocol
          </span>
          support offline transactions.
        </p>
      </div>

      {/* Protocol 201.3 Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">
          💡 About Protocol 201.3 Support
        </h3>
        <p className="text-blue-800 text-sm mb-3">
          Protocol 201.3 is our offline payment standard. Only <strong>card-based</strong> payment methods 
          (Visa, Mastercard, Amex, UnionPay) currently support offline transactions.
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
            ✅ Visa - Offline OK
          </span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
            ✅ Mastercard - Offline OK
          </span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
            ✅ Amex - Offline OK
          </span>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
            ⚠️ Apple Pay - Online Only
          </span>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
            ⚠️ Google Pay - Online Only
          </span>
        </div>
      </div>

      {/* Payment Methods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {methods.map((method) => (
          <div 
            key={method.id}
            className={`border rounded-xl p-5 transition-all ${
              method.enabled 
                ? 'bg-white border-gray-200 shadow-sm' 
                : 'bg-gray-50 border-gray-200 opacity-70'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {getLogo(method.logo)}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{method.name}</h3>
                    {method.protocol2013Supported && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        201.3
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{method.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      method.offlineCapable 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {method.offlineCapable ? '📴 Offline OK' : '🌐 Online Only'}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">
                      {method.type}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedMethod(method)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Configure"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                
                <button
                  onClick={() => toggleMethod(method.id)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    method.enabled ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    method.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            {method.enabled && method.protocol2013Supported && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Floor Limit</span>
                    <p className="font-medium text-gray-900">${method.config.floorLimit}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Max Amount</span>
                    <p className="font-medium text-gray-900">${method.config.maxTransactionAmount}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">PIN Required</span>
                    <p className="font-medium text-gray-900">{method.config.requirePin ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Configuration Modal */}
      {selectedMethod && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Configure {selectedMethod.name}</h3>
                <button 
                  onClick={() => setSelectedMethod(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {!selectedMethod.protocol2013Supported && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <strong>⚠️ Online Only</strong>
                  <p className="mt-1">
                    {selectedMethod.name} requires internet connection and does not support offline transactions.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Floor Limit ($)
                </label>
                <input
                  type="number"
                  value={selectedMethod.config.floorLimit}
                  onChange={(e) => updateConfig(selectedMethod.id, { floorLimit: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedMethod.protocol2013Supported}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum amount for offline approval without online authorization
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Transaction Amount ($)
                </label>
                <input
                  type="number"
                  value={selectedMethod.config.maxTransactionAmount}
                  onChange={(e) => updateConfig(selectedMethod.id, { maxTransactionAmount: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={!selectedMethod.protocol2013Supported}
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-700">Require PIN</span>
                <button
                  onClick={() => updateConfig(selectedMethod.id, { requirePin: !selectedMethod.config.requirePin })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    selectedMethod.config.requirePin ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                  disabled={!selectedMethod.protocol2013Supported}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    selectedMethod.config.requirePin ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-700">Allow Offline</span>
                <button
                  onClick={() => updateConfig(selectedMethod.id, { allowOffline: !selectedMethod.config.allowOffline })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    selectedMethod.config.allowOffline ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                  disabled={!selectedMethod.protocol2013Supported}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    selectedMethod.config.allowOffline ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setSelectedMethod(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
