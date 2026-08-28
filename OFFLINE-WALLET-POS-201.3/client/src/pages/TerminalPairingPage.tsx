import type { ChangeEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { resolveApiBaseUrl } from "../lib/backendUrl";

// --- Icons ---
const Icons = {
  Terminal: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
  QrCode: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4h-4v-2h4v-2h3v2m-3-2v3m-4 1h3m-1-5h-3m4-3h-4M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /></svg>,
  Check: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  ArrowRight: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>,
  Copy: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
  Refresh: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Info: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Key: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
};

// --- Components ---
interface InputProps {
  label: string;
  value: string | number;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
}

const Input = ({ label, value, onChange, placeholder, type = "text" }: InputProps) => (
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
  <div className="flex items-center justify-between mb-8 px-2 max-w-lg mx-auto">
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
          {["Identify", "Pairing Code", "Confirm", "Done"][i]}
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

/** Copyable credential row */
const CredentialRow = ({ label, value, mask }: { label: string; value: string; mask?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(!mask);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-mono text-gray-900 truncate">
          {visible ? value : "•".repeat(Math.min(value.length, 24))}
        </div>
      </div>
      <div className="flex items-center gap-1 ml-2">
        {mask && (
          <button
            onClick={() => setVisible(!visible)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors text-xs"
            title={visible ? "Hide" : "Show"}
          >
            {visible ? "Hide" : "Show"}
          </button>
        )}
        <button
          onClick={copy}
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
          title="Copy"
        >
          {copied ? <Icons.Check /> : <Icons.Copy />}
        </button>
      </div>
    </div>
  );
};

// Backend base URL (same as dashboard API)
const API_BASE = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });

export const TerminalPairingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Terminal credentials returned from backend after registration
  const [credentials, setCredentials] = useState<{
    merchantId: string;
    terminalId: string;
    terminalSecret: string;
    name?: string;
  } | null>(null);

  const [data, setData] = useState({
    serialNumber: "",
    model: "Android POS",
    terminalName: "Counter 1",
    location: "Main Store"
  });

  // Verify credentials against backend
  const [verifyResult, setVerifyResult] = useState<{valid: boolean; message?: string} | null>(null);

  const handleNext = async () => {
    if (step < 4) {
      if (step === 3) {
        setLoading(true);
        setError(null);
        try {
          // Call real backend to register terminal
          const res = await fetch(`${API_BASE}/merchant/v1/terminal/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ terminalName: data.terminalName || data.model })
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Registration failed (HTTP ${res.status}): ${errBody}`);
          }

          const result = await res.json();
          setCredentials({
            merchantId: result.merchantId,
            terminalId: result.terminalId,
            terminalSecret: result.terminalSecret,
            name: data.terminalName
          });
        } catch (e: any) {
          setError(e.message || "Registration failed");
          setLoading(false);
          return;
        }
        setLoading(false);
      }
      setStep(step + 1);
    } else {
      navigate("/terminals");
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleVerify = async () => {
    if (!credentials) return;
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/merchant/v1/terminal/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: credentials.merchantId,
          terminalId: credentials.terminalId,
          secretKey: credentials.terminalSecret
        })
      });
      const result = await res.json();
      setVerifyResult({ valid: result.valid, message: result.valid ? "Verified!" : result.message });
    } catch (e: any) {
      setVerifyResult({ valid: false, message: e.message });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Terminal Pairing & Activation</h1>
          <p className="text-sm text-gray-500 mt-1">Register a new POS terminal and get credentials for the Android app</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
        
        <div className="w-full max-w-2xl">
          <StepIndicator currentStep={step} totalSteps={4} />

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 relative overflow-hidden">
             {/* Decorative Background */}
             <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-50 to-purple-50 rounded-bl-full opacity-50 -z-0 pointer-events-none"></div>

             <div className="relative z-10 min-h-[400px] flex flex-col">
               
               {/* Step 1: Device Identification */}
               {step === 1 && (
                 <div className="animate-slide-in-right flex-1">
                   <h2 className="text-xl font-bold text-gray-900 mb-2">Identify Terminal</h2>
                   <p className="text-gray-500 text-sm mb-6">Enter your terminal's details. These will be used to register the terminal with the backend.</p>
                   
                   <div className="space-y-4">
                     <Input 
                       label="Terminal Name" 
                       value={data.terminalName} 
                       onChange={(e: any) => setData({...data, terminalName: e.target.value})} 
                       placeholder="e.g. Counter 1, Front Desk" 
                     />
                     <Input 
                       label="Terminal Model / Device" 
                       value={data.model} 
                       onChange={(e) => setData({...data, model: e.target.value})} 
                       placeholder="e.g. Android POS, Pax A920" 
                     />
                     <Input 
                       label="Location / Store" 
                       value={data.location} 
                       onChange={(e) => setData({...data, location: e.target.value})} 
                       placeholder="e.g. Main Store" 
                     />

                     <div className="p-3 bg-blue-50 rounded-lg flex items-start gap-3 text-xs text-blue-700 mb-4">
                       <Icons.Info />
                       <span>After registration, you'll receive a <strong>Merchant ID</strong>, <strong>Terminal ID</strong>, and <strong>Secret Key</strong>. Enter these in the Android app's Settings screen.</span>
                     </div>
                   </div>
                 </div>
               )}

               {/* Step 2: Show Credentials (was "Pairing Code") */}
               {step === 2 && (
                 <div className="animate-slide-in-right flex-1">
                   <h2 className="text-xl font-bold text-gray-900 mb-2">Terminal Credentials</h2>
                   <p className="text-gray-500 text-sm mb-6">
                     Your terminal has been identified. Below are the credentials. <strong>Copy these to your Android app's Settings screen.</strong>
                   </p>

                   {credentials ? (
                     <div className="bg-gray-900 text-white rounded-2xl p-6 mb-6 relative overflow-hidden">
                       <div className="space-y-0">
                         <CredentialRow label="Merchant ID" value={credentials.merchantId} />
                         <CredentialRow label="Terminal ID" value={credentials.terminalId} />
                         <CredentialRow label="Secret Key" value={credentials.terminalSecret} mask />
                       </div>
                     </div>
                   ) : (
                     <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
                       <p className="text-yellow-800 text-sm">No credentials yet. Go back and complete registration.</p>
                     </div>
                   )}

                   <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-xs text-amber-800">
                     <Icons.Key />
                     <div>
                       <strong>Important:</strong> Save the Secret Key now. It won't be shown again after you leave this page.
                       <br />Open Android App → Settings → Enter these 3 values → Save.
                     </div>
                   </div>

                   {/* Verify button */}
                   {credentials && (
                     <div className="mt-4">
                       <button
                         onClick={handleVerify}
                         className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-2"
                       >
                         <Icons.Check />
                         Verify Credentials with Backend
                       </button>
                       {verifyResult && (
                         <div className={`mt-2 text-sm font-medium ${verifyResult.valid ? "text-green-600" : "text-red-600"}`}>
                           {verifyResult.valid ? "✅ " : "❌ "}{verifyResult.message}
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               )}

               {/* Step 3: Activation Confirmation */}
               {step === 3 && (
                 <div className="animate-slide-in-right flex-1">
                   <h2 className="text-xl font-bold text-gray-900 mb-2">Confirm & Register</h2>
                   <p className="text-gray-500 text-sm mb-6">Review the terminal details and register it with the backend server.</p>

                   <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 mb-6">
                     <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-gray-900 text-lg">{data.model}</h3>
                          <p className="text-sm text-gray-500">Name: {data.terminalName}</p>
                          <p className="text-sm text-gray-500">Location: {data.location}</p>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold uppercase tracking-wide">
                          Ready
                        </div>
                     </div>
                     
                     {error && (
                       <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                         ❌ {error}
                       </div>
                     )}

                     {credentials && (
                       <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                         ✅ Terminal registered successfully!
                         <div className="mt-2 font-mono text-xs space-y-1">
                           <div>Merchant: <strong>{credentials.merchantId}</strong></div>
                           <div>Terminal: <strong>{credentials.terminalId}</strong></div>
                           <div>Secret: <strong>{credentials.terminalSecret.substring(0, 8)}...</strong></div>
                         </div>
                       </div>
                     )}
                   </div>
                 </div>
               )}

               {/* Step 4: Setup Complete */}
               {step === 4 && (
                 <div className="animate-slide-in-right flex-1 text-center flex flex-col items-center justify-center">
                   <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6 animate-bounce-in shadow-lg shadow-green-200">
                      <Icons.Check />
                   </div>
                   <h2 className="text-2xl font-bold text-gray-900 mb-2">Registration Complete!</h2>
                   <p className="text-gray-500 mb-4 max-w-md">
                     Your terminal <span className="font-semibold text-gray-900">{data.terminalName}</span> has been registered.
                   </p>
                   
                   {credentials && (
                     <div className="w-full max-w-md bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-left">
                       <h3 className="text-sm font-bold text-gray-700 mb-3">Enter these in Android App:</h3>
                       <div className="space-y-2 font-mono text-sm">
                         <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
                           <span className="text-gray-500">Server URL:</span>
                           <span className="text-gray-900 font-semibold">{API_BASE}/</span>
                         </div>
                         <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
                           <span className="text-gray-500">Merchant ID:</span>
                           <span className="text-gray-900 font-semibold">{credentials.merchantId}</span>
                         </div>
                         <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
                           <span className="text-gray-500">Terminal ID:</span>
                           <span className="text-gray-900 font-semibold">{credentials.terminalId}</span>
                         </div>
                         <div className="flex justify-between items-center py-1.5">
                           <span className="text-gray-500">Secret Key:</span>
                           <span className="text-gray-900 font-semibold text-xs">{credentials.terminalSecret}</span>
                         </div>
                       </div>
                       <button
                         onClick={() => {
                           const text = `Server URL: ${API_BASE}/\nMerchant ID: ${credentials.merchantId}\nTerminal ID: ${credentials.terminalId}\nSecret Key: ${credentials.terminalSecret}`;
                           navigator.clipboard.writeText(text);
                         }}
                         className="mt-3 w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                       >
                         <Icons.Copy />
                         Copy All Credentials
                       </button>
                     </div>
                   )}
                   
                   <div className="flex gap-4 w-full max-w-xs">
                     <button 
                       onClick={() => { setStep(1); setCredentials(null); setError(null); }}
                       className="flex-1 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                     >
                       Pair Another
                     </button>
                     <button 
                       onClick={() => navigate("/terminals")}
                       className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                     >
                       View Terminals
                     </button>
                   </div>
                 </div>
               )}

               {/* Navigation Buttons */}
               <div className="mt-auto pt-8 flex justify-between items-center border-t border-gray-100">
                 {step > 1 && step < 4 ? (
                   <button 
                     onClick={handleBack}
                     className="px-6 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                   >
                     Back
                   </button>
                 ) : <div></div>}
                 
                 <button 
                   onClick={handleNext}
                   disabled={loading || (step === 1 && !data.terminalName)}
                   className={`px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transition-all flex items-center gap-2 ${loading || (step === 1 && !data.terminalName) ? 'opacity-50 cursor-not-allowed' : ''}`}
                 >
                   {loading ? (
                     <>
                       <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                       Registering...
                     </>
                   ) : (
                     <>
                       {step === 4 ? "Go to Terminals" : step === 3 ? (credentials ? "Continue" : "Register Terminal") : step === 2 ? "Next" : "Next Step"}
                       {step < 4 && <Icons.ArrowRight />}
                     </>
                   )}
                 </button>
               </div>

             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
