import { useState } from "react";
import { useNavigate } from "react-router-dom";

// --- Icons ---
const Icons = {
  Building: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  Bank: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  Terminal: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  Code: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>,
  Check: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  ArrowRight: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>,
  ArrowLeft: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>,
  Upload: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>,
  Shield: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
};

// --- Interfaces ---
interface OnboardingData {
  business: {
    legalName: string;
    taxId: string;
    address: string;
    city: string;
    zip: string;
    country: string;
  };
  banking: {
    accountHolder: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
  };
  terminal: {
    locationName: string;
    timezone: string;
    offlineMode: boolean;
  };
  developer: {
    enableApi: boolean;
    webhookUrl: string;
  };
}

const Input = ({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder: string; type?: string; }) => (
  <div className="mb-4">
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
    />
  </div>
);

const StepIndicator = ({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) => (
  <div className="flex items-center justify-between mb-8 px-2">
    {Array.from({ length: totalSteps }).map((_, i) => (
      <div key={i} className="flex flex-col items-center relative z-10">
        <div 
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
            i + 1 <= currentStep 
              ? "bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-110" 
              : "bg-gray-100 text-gray-400 border border-gray-200"
          }`}
        >
          {i + 1 < currentStep ? <Icons.Check /> : i + 1}
        </div>
        <div className={`mt-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${i + 1 <= currentStep ? "text-blue-600" : "text-gray-400"}`}>
          {["Business", "Banking", "Terminal", "API", "Review"][i]}
        </div>
      </div>
    ))}
    {/* Progress Line */}
    <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-100 -z-0 px-8">
      <div 
        className="h-full bg-blue-600 transition-all duration-500 ease-out" 
        style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }} 
      />
    </div>
  </div>
);

export const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OnboardingData>({
    business: { legalName: "", taxId: "", address: "", city: "", zip: "", country: "United States" },
    banking: { accountHolder: "", bankName: "", accountNumber: "", routingNumber: "" },
    terminal: { locationName: "Main Store", timezone: "UTC-5", offlineMode: true },
    developer: { enableApi: false, webhookUrl: "" }
  });

  const handleNext = () => {
    if (step < 5) setStep(step + 1);
    else handleComplete();
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleComplete = async () => {
    setLoading(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1500));
    setLoading(false);
    navigate("/"); // Go to Dashboard
  };

  const updateData = (section: keyof OnboardingData, field: string, value: string | boolean) => {
    setData(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value }
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Bar */}
      <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">M</div>
           <span className="font-bold text-gray-900 tracking-tight">MerchantPortal</span>
        </div>
        <a href="#" className="text-sm font-medium text-gray-500 hover:text-gray-900">Need help?</a>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
           <div className="absolute top-20 left-20 w-64 h-64 bg-blue-100/50 rounded-full blur-3xl opacity-60 mix-blend-multiply animate-blob"></div>
           <div className="absolute bottom-20 right-20 w-64 h-64 bg-purple-100/50 rounded-full blur-3xl opacity-60 mix-blend-multiply animate-blob animation-delay-2000"></div>
        </div>

        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-100 p-8 relative z-10 animate-fade-in">
          
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {step === 1 && "Tell us about your business"}
              {step === 2 && "Setup your payouts"}
              {step === 3 && "Configure your terminal"}
              {step === 4 && "Developer Settings"}
              {step === 5 && "Review & Complete"}
            </h1>
            <p className="text-gray-500 text-sm">
              {step === 1 && "We need some basic information to verify your account."}
              {step === 2 && "Where should we send your daily settlements?"}
              {step === 3 && "Customize how your POS terminal behaves offline."}
              {step === 4 && "Optional: Configure API access for custom integrations."}
              {step === 5 && "You're all set! Review your details below."}
            </p>
          </div>

          <div className="relative">
             <StepIndicator currentStep={step} totalSteps={5} />
          </div>

          <div className="min-h-[300px]">
            {/* Step 1: Business Info */}
            {step === 1 && (
              <div className="space-y-4 animate-slide-in-right">
                <Input label="Legal Business Name" value={data.business.legalName} onChange={(e: any) => updateData('business', 'legalName', e.target.value)} placeholder="Acme Corp LLC" />
                <Input label="Tax ID / EIN" value={data.business.taxId} onChange={(e: any) => updateData('business', 'taxId', e.target.value)} placeholder="12-3456789" />
                <Input label="Business Address" value={data.business.address} onChange={(e: any) => updateData('business', 'address', e.target.value)} placeholder="123 Main St" />
                <div className="grid grid-cols-2 gap-4">
                  <Input label="City" value={data.business.city} onChange={(e: any) => updateData('business', 'city', e.target.value)} placeholder="San Francisco" />
                  <Input label="Zip Code" value={data.business.zip} onChange={(e: any) => updateData('business', 'zip', e.target.value)} placeholder="94105" />
                </div>
              </div>
            )}

            {/* Step 2: Banking */}
            {step === 2 && (
              <div className="space-y-4 animate-slide-in-right">
                <Input label="Account Holder Name" value={data.banking.accountHolder} onChange={(e: any) => updateData('banking', 'accountHolder', e.target.value)} placeholder="Acme Corp LLC" />
                <Input label="Bank Name" value={data.banking.bankName} onChange={(e: any) => updateData('banking', 'bankName', e.target.value)} placeholder="Chase Bank" />
                <Input label="Account Number" value={data.banking.accountNumber} onChange={(e: any) => updateData('banking', 'accountNumber', e.target.value)} placeholder="0000 0000 0000" type="password" />
                <Input label="Routing Number" value={data.banking.routingNumber} onChange={(e: any) => updateData('banking', 'routingNumber', e.target.value)} placeholder="000000000" />
              </div>
            )}

            {/* Step 3: Terminal */}
            {step === 3 && (
              <div className="space-y-6 animate-slide-in-right">
                <Input label="Location Name" value={data.terminal.locationName} onChange={(e: any) => updateData('terminal', 'locationName', e.target.value)} placeholder="Main Store" />
                
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <div className="text-sm font-bold text-gray-900">Offline Mode</div>
                    <div className="text-xs text-gray-500">Allow payments when internet is down</div>
                  </div>
                  <button 
                    onClick={() => updateData('terminal', 'offlineMode', !data.terminal.offlineMode)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${data.terminal.offlineMode ? 'bg-blue-600' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${data.terminal.offlineMode ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="p-4 border border-dashed border-gray-300 rounded-lg bg-gray-50 text-center hover:bg-gray-100 transition-colors cursor-pointer group">
                   <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm text-gray-400 group-hover:text-blue-500 transition-colors">
                     <Icons.Upload />
                   </div>
                   <div className="text-sm font-medium text-gray-900">Upload Store Logo</div>
                   <div className="text-xs text-gray-500">For customer receipts</div>
                </div>
              </div>
            )}

            {/* Step 4: Developer */}
            {step === 4 && (
              <div className="space-y-6 animate-slide-in-right">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <div className="text-sm font-bold text-gray-900">Enable Developer API</div>
                    <div className="text-xs text-gray-500">Access your data programmatically</div>
                  </div>
                  <button 
                    onClick={() => updateData('developer', 'enableApi', !data.developer.enableApi)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${data.developer.enableApi ? 'bg-blue-600' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${data.developer.enableApi ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {data.developer.enableApi && (
                   <div className="animate-fade-in">
                     <Input label="Webhook URL" value={data.developer.webhookUrl} onChange={(e: any) => updateData('developer', 'webhookUrl', e.target.value)} placeholder="https://api.yoursite.com/webhooks" />
                     <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                        API Keys will be generated automatically upon completion.
                     </div>
                   </div>
                )}
              </div>
            )}

            {/* Step 5: Review */}
            {step === 5 && (
              <div className="space-y-6 animate-slide-in-right text-center py-4">
                 <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto mb-4 animate-bounce-in">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                 </div>
                 <h2 className="text-xl font-bold text-gray-900">You're All Set!</h2>
                 <p className="text-gray-500 max-w-sm mx-auto">
                   Your account has been configured. You can now access your dashboard and start processing payments.
                 </p>
                 
                 <div className="bg-gray-50 rounded-lg p-4 text-left border border-gray-100 max-w-sm mx-auto mt-4 text-sm">
                    <div className="flex justify-between py-1 border-b border-gray-200 pb-2 mb-2">
                       <span className="text-gray-500">Business</span>
                       <span className="font-medium">{data.business.legalName || "Not set"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-200 pb-2 mb-2">
                       <span className="text-gray-500">Bank</span>
                       <span className="font-medium">{data.banking.bankName || "Not set"}</span>
                    </div>
                    <div className="flex justify-between py-1">
                       <span className="text-gray-500">Terminal</span>
                       <span className="font-medium">{data.terminal.locationName}</span>
                    </div>
                 </div>
              </div>
            )}
          </div>

          <div className="mt-8 flex justify-between pt-6 border-t border-gray-100">
            {step > 1 && step < 5 ? (
              <button 
                onClick={handleBack}
                className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Back
              </button>
            ) : <div></div>}
            
            <button 
              onClick={handleNext}
              disabled={loading}
              className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transition-all flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </>
              ) : (
                <>
                  {step === 5 ? "Go to Dashboard" : "Next Step"}
                  {step < 5 && <Icons.ArrowRight />}
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
