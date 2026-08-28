import { useState, useEffect } from "react";
import { useToast } from "../components/ui/Toast";
import { useNotifications } from "../contexts/NotificationContext";
import { Skeleton } from "../components/ui/Skeleton";
import { ConfirmModal } from "../components/ui/Modal";

const Icons = {
  Printer: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5h15a2.25 2.25 0 012.25 2.25v6a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 18.75v-6a2.25 2.25 0 012.25-2.25z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a2.25 2.25 0 00-2.25-2.25H9.75a2.25 2.25 0 00-2.25 2.25v3.75" />
    </svg>
  ),
  Receipt: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  Edit: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
    </svg>
  ),
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  Upload: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  QrCode: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
    </svg>
  )
};

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

const Toggle = ({ label, checked, onChange, description }: ToggleProps) => (
  <div className="flex items-start justify-between py-3">
    <div className="flex flex-col">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      {description && <span className="text-xs text-gray-500 mt-0.5">{description}</span>}
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? 'bg-blue-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);

export const ReceiptPrinterPage = () => {
  // --- EXISTING STATE ---
  const [headerText, setHeaderText] = useState("MERCHANT NAME\n123 Commerce St, City\nMID: 123456789012345");
  const [customFooter, setCustomFooter] = useState("Thank you for your business!");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState("Medium"); 
  const [paperWidth, setPaperWidth] = useState("80mm");

  // --- NEW STATE: OFFLINE DISCLAIMER ---
  const [showOfflineDisclaimer, setShowOfflineDisclaimer] = useState(true);
  const [offlineDisclaimerText, setOfflineDisclaimerText] = useState("This transaction was approved offline. Final confirmation depends on issuer approval.");

  // --- NEW STATE: SIGNATURE LINES ---
  const [requireSignatureOffline, setRequireSignatureOffline] = useState(true);
  const [signatureThreshold, setSignatureThreshold] = useState(25);
  const [signatureLineStyle, setSignatureLineStyle] = useState("Solid"); // Solid, Dotted, Hidden

  // --- NEW STATE: COPIES ---
  const [printCustomerCopy, setPrintCustomerCopy] = useState(true);
  const [printMerchantCopy, setPrintMerchantCopy] = useState(true);
  const [printMerchantCopyOfflineOnly, setPrintMerchantCopyOfflineOnly] = useState(false);
  const [numberOfCopies, setNumberOfCopies] = useState(1);

  // --- NEW STATE: STORED RECEIPT RE-PRINTING ---
  const [enableReprint, setEnableReprint] = useState(true);
  const [reprintRetention, setReprintRetention] = useState("30 days");
  const [reprintAccess, setReprintAccess] = useState("Cashier");

  // --- NEW STATE: RECEIPT CONTENT CONTROLS ---
  const [showSTAN, setShowSTAN] = useState(true);
  const [showTerminalID, setShowTerminalID] = useState(true);
  const [showBatchNumber, setShowBatchNumber] = useState(true);
  const [showOfflineIndicator, setShowOfflineIndicator] = useState(true);
  const [showCardType, setShowCardType] = useState(true);
  const [panMasking, setPanMasking] = useState("First 6 + last 4"); // First 6 + last 4, Last 4 only, Fully masked

  // --- NEW STATE: PRINTER HARDWARE ---
  const [printerType, setPrinterType] = useState("Built-in");
  const [paperCutMode, setPaperCutMode] = useState("Auto");
  const [printDensity, setPrintDensity] = useState("Medium");
  const [printSpeed, setPrintSpeed] = useState("Normal");

  // --- NEW STATE: OFFLINE RECEIPT BEHAVIOR ---
  const [printImmediatelyOffline, setPrintImmediatelyOffline] = useState(true);
  const [printPendingLabel, setPrintPendingLabel] = useState(true);
  const [printOfflineSummary, setPrintOfflineSummary] = useState(true);

  // --- NEW STATE: DIGITAL RECEIPTS ---
  const [enableDigital, setEnableDigital] = useState(false);
  const [showQRCode, setShowQRCode] = useState(true);
  const [qrCodeExpiry, setQrCodeExpiry] = useState("24 hours");

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const { showToast } = useToast();
  const { addNotification } = useNotifications();

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      showToast("Receipt settings saved successfully", "success");
      addNotification("Receipt Settings Updated", "Your receipt printer configuration has been saved successfully.", "success");
    }, 1500);
  };

  const handleReset = () => {
    setHeaderText("MERCHANT NAME\n123 Commerce St, City\nMID: 123456789012345");
    setCustomFooter("Thank you for your business!");
    setLogoUrl(null);
    setFontSize("Medium");
    setPaperWidth("80mm");
    setShowOfflineDisclaimer(true);
    setOfflineDisclaimerText("This transaction was approved offline. Final confirmation depends on issuer approval.");
    setRequireSignatureOffline(true);
    setSignatureThreshold(25);
    setSignatureLineStyle("Solid");
    setPrintCustomerCopy(true);
    setPrintMerchantCopy(true);
    setPrintMerchantCopyOfflineOnly(false);
    setNumberOfCopies(1);
    setEnableReprint(true);
    setReprintRetention("30 days");
    setReprintAccess("Cashier");
    setShowSTAN(true);
    setShowTerminalID(true);
    setShowBatchNumber(true);
    setShowOfflineIndicator(true);
    setShowCardType(true);
    setPanMasking("First 6 + last 4");
    setPrinterType("Built-in");
    setPaperCutMode("Auto");
    setPrintDensity("Medium");
    setPrintSpeed("Normal");
    setPrintImmediatelyOffline(true);
    setPrintPendingLabel(true);
    setPrintOfflineSummary(true);
    setEnableDigital(false);
    setShowQRCode(true);
    setQrCodeExpiry("24 hours");
    
    setConfirmResetOpen(false);
    showToast("Settings reset to defaults", "info");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- RENDER HELPERS ---
  const getPaperWidthClass = () => paperWidth === "58mm" ? "w-[240px]" : "w-[320px]";
  const getFontSizeClass = () => fontSize === "Small" ? "text-[10px]" : fontSize === "Large" ? "text-sm" : "text-xs";

  // Helper to render masked PAN
  const renderMaskedPAN = () => {
    const pan = "4242424242424242"; // Mock PAN
    if (panMasking === "Fully masked") return "****************";
    if (panMasking === "Last 4 only") return "************4242";
    // First 6 + last 4
    return "424242******4242";
  };

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-8">
            <Skeleton className="h-[400px] w-full rounded-xl" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
          <div className="xl:col-span-1">
             <Skeleton className="h-[600px] w-full rounded-xl sticky top-6" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receipt Printer & Content</h1>
          <p className="text-gray-500 mt-1">Customize receipt layout, offline disclaimers, and printer hardware settings</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className={`flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all shadow-sm active:scale-95 ${isSaving ? 'opacity-75 cursor-not-allowed' : ''}`}
        >
          {isSaving ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <Icons.Check />
          )}
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* LEFT COLUMN: Settings */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* 1. Receipt Layout & Content */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Receipt Layout & Content</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Header & Logo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Header Text</label>
                    <textarea 
                      rows={3}
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer shadow-sm transition-colors">
                        <Icons.Upload /> Upload
                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                      </label>
                      {logoUrl && (
                        <button onClick={() => setLogoUrl(null)} className="text-sm text-red-600 hover:underline">Remove</button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                   <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Font Size</label>
                      <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                        <option>Small</option>
                        <option>Medium</option>
                        <option>Large</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Paper Width</label>
                      <select value={paperWidth} onChange={(e) => setPaperWidth(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                        <option>58mm</option>
                        <option>80mm</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text</label>
                    <textarea 
                      rows={2}
                      value={customFooter}
                      onChange={(e) => setCustomFooter(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                 <h3 className="text-sm font-semibold text-gray-900 mb-3">Visible Fields</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
                   <Toggle label="Show STAN" checked={showSTAN} onChange={setShowSTAN} />
                   <Toggle label="Show Terminal ID" checked={showTerminalID} onChange={setShowTerminalID} />
                   <Toggle label="Show Batch Number" checked={showBatchNumber} onChange={setShowBatchNumber} />
                   <Toggle label="Show Offline Indicator" checked={showOfflineIndicator} onChange={setShowOfflineIndicator} />
                   <Toggle label="Show Card Type" checked={showCardType} onChange={setShowCardType} />
                 </div>
                 <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">PAN Masking</label>
                    <div className="flex gap-4">
                      {["First 6 + last 4", "Last 4 only", "Fully masked"].map((opt) => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="panMasking" checked={panMasking === opt} onChange={() => setPanMasking(opt)} className="text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm text-gray-700">{opt}</span>
                        </label>
                      ))}
                    </div>
                 </div>
              </div>
            </div>
          </section>

          {/* 2. Offline Disclaimer & Signature */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Offline Disclaimer & Signature</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 uppercase">Compliance</span>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <Toggle label="Show Offline Disclaimer on Receipt" checked={showOfflineDisclaimer} onChange={setShowOfflineDisclaimer} />
                {showOfflineDisclaimer && (
                  <div className="mt-2 relative">
                    <input 
                      type="text" 
                      value={offlineDisclaimerText}
                      onChange={(e) => setOfflineDisclaimerText(e.target.value)}
                      className="w-full px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                    <div className="absolute right-3 top-2.5 text-gray-400"><Icons.Edit /></div>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Signature Requirements</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <Toggle label="Require Signature Offline" checked={requireSignatureOffline} onChange={setRequireSignatureOffline} description="Force signature line for offline txns" />
                    <div className="mt-2">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Require Above Amount ($)</label>
                       <input 
                         type="number" 
                         value={signatureThreshold}
                         onChange={(e) => setSignatureThreshold(Number(e.target.value))}
                         className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                       />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Signature Line Style</label>
                    <div className="space-y-2">
                      {["Solid", "Dotted", "Hidden"].map((style) => (
                        <label key={style} className="flex items-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50">
                          <input type="radio" name="sigStyle" checked={signatureLineStyle === style} onChange={() => setSignatureLineStyle(style)} className="text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm text-gray-700">{style}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Copies & Behavior */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
             <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Copies & Behavior</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Copies */}
                <div>
                   <h3 className="text-sm font-semibold text-gray-900 mb-2">Print Copies</h3>
                   <div className="space-y-1">
                     <Toggle label="Print Customer Copy" checked={printCustomerCopy} onChange={setPrintCustomerCopy} />
                     <Toggle label="Print Merchant Copy" checked={printMerchantCopy} onChange={setPrintMerchantCopy} />
                     <Toggle label="Merchant Copy Offline Only" checked={printMerchantCopyOfflineOnly} onChange={setPrintMerchantCopyOfflineOnly} description="Only print merchant copy for offline approvals" />
                   </div>
                   <div className="mt-4">
                     <label className="block text-sm font-medium text-gray-700 mb-1">Number of Copies</label>
                     <div className="flex gap-2">
                       {[1, 2, 3].map(num => (
                         <button 
                           key={num}
                           onClick={() => setNumberOfCopies(num)}
                           className={`w-10 h-10 rounded-lg border text-sm font-medium transition-all ${numberOfCopies === num ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                         >
                           {num}
                         </button>
                       ))}
                     </div>
                   </div>
                </div>

                {/* Re-Printing */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Stored Receipt Re-Printing</h3>
                  <Toggle label="Enable Re-Print" checked={enableReprint} onChange={setEnableReprint} />
                  {enableReprint && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Retention Period</label>
                        <select value={reprintRetention} onChange={(e) => setReprintRetention(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>24 hours</option>
                          <option>7 days</option>
                          <option>30 days</option>
                          <option>Until batch upload</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Access Control</label>
                         <select value={reprintAccess} onChange={(e) => setReprintAccess(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>Cashier</option>
                          <option>Manager PIN required</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Offline Behavior */}
              <div className="border-t border-gray-100 pt-4">
                 <h3 className="text-sm font-semibold text-gray-900 mb-3">Offline Receipt Behavior</h3>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                   <Toggle label="Print Immediately (Offline)" checked={printImmediatelyOffline} onChange={setPrintImmediatelyOffline} description="Don't wait for sync" />
                   <Toggle label="Show 'Pending Settlement' Label" checked={printPendingLabel} onChange={setPrintPendingLabel} />
                   <Toggle label="Print Offline Summary at Batch Close" checked={printOfflineSummary} onChange={setPrintOfflineSummary} />
                 </div>
              </div>
            </div>
          </section>

          {/* 4. Printer Hardware & Digital */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
             <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Hardware & Digital</h2>
            </div>
            <div className="p-6 space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Hardware */}
                 <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-900">Printer Hardware</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Printer Type</label>
                        <select value={printerType} onChange={(e) => setPrinterType(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>Built-in</option>
                          <option>Bluetooth</option>
                          <option>USB</option>
                          <option>Network</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Cut Mode</label>
                        <select value={paperCutMode} onChange={(e) => setPaperCutMode(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>Auto</option>
                          <option>Partial</option>
                          <option>None</option>
                        </select>
                      </div>
                       <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Density</label>
                        <select value={printDensity} onChange={(e) => setPrintDensity(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>Low</option>
                          <option>Medium</option>
                          <option>High</option>
                        </select>
                      </div>
                       <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Speed</label>
                        <select value={printSpeed} onChange={(e) => setPrintSpeed(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <option>Slow</option>
                          <option>Normal</option>
                          <option>Fast</option>
                        </select>
                      </div>
                    </div>
                 </div>

                 {/* Digital Receipts */}
                 <div className="space-y-4">
                   <h3 className="text-sm font-semibold text-gray-900">Digital Receipts</h3>
                   <Toggle label="Enable Digital Receipts" checked={enableDigital} onChange={setEnableDigital} />
                   {enableDigital && (
                     <div className="pl-4 border-l-2 border-gray-100 space-y-3">
                       <Toggle label="Show QR Code" checked={showQRCode} onChange={setShowQRCode} />
                       <div>
                         <label className="block text-xs font-medium text-gray-500 mb-1">QR Expiry</label>
                         <select value={qrCodeExpiry} onChange={(e) => setQrCodeExpiry(e.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                           <option>1 hour</option>
                           <option>24 hours</option>
                           <option>7 days</option>
                         </select>
                       </div>
                     </div>
                   )}
                 </div>
               </div>
            </div>
          </section>

        </div>

        {/* RIGHT COLUMN: Live Preview */}
        <div className="xl:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sticky top-6">
            <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                <Icons.Receipt /> Live Preview
              </h2>
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-gray-400 font-mono">{paperWidth} Thermal</span>
                {printPendingLabel && <span className="text-[10px] text-amber-600 font-bold">PENDING SETTLEMENT</span>}
              </div>
            </div>
            
            {/* Receipt Mockup */}
            <div className="p-8 bg-gray-100 flex justify-center min-h-[600px] overflow-y-auto">
              <div className={`w-full ${getPaperWidthClass()} bg-white shadow-md p-4 font-mono text-gray-800 leading-tight transition-all duration-300 ${getFontSizeClass()} flex flex-col`}>
                
                {/* Logo */}
                {logoUrl && (
                  <div className="flex justify-center mb-4">
                    <img src={logoUrl} alt="Logo" className="max-h-16 object-contain" />
                  </div>
                )}

                {/* Header Text */}
                <div className="text-center mb-4 whitespace-pre-wrap">
                  {headerText}
                </div>

                <div className="text-center mb-4 space-y-0.5">
                  {showTerminalID && <div>TID: 00000001</div>}
                  <div>MID: 123456789012345</div>
                </div>

                <div className="flex justify-between mb-1">
                  <span>DATE: 2023-10-27</span>
                  <span>TIME: 14:30:05</span>
                </div>
                <div className="mb-4">
                  {showBatchNumber && <span>BATCH: 000123</span>}
                  {showSTAN && <span className="float-right">STAN: 004512</span>}
                </div>

                <div className="border-b border-dashed border-gray-300 mb-4"></div>

                <div className="flex justify-between font-bold mb-4">
                  <span>SALE</span>
                  <span>$ 45.00</span>
                </div>

                <div className="mb-4 space-y-1">
                  {showCardType && <div>VISA DEBIT</div>}
                  <div>{renderMaskedPAN()}</div>
                  <div>AID: A0000000031010</div>
                  <div>TVR: 0000008000</div>
                  <div>IAD: 06010A03608000</div>
                </div>

                {/* Dynamic Offline Disclaimer */}
                {showOfflineDisclaimer && (
                   <div className="my-4 text-center font-bold border-2 border-gray-800 p-2 uppercase text-[0.9em]">
                    {offlineDisclaimerText}
                  </div>
                )}
                
                {/* Offline Indicator */}
                {showOfflineIndicator && (
                  <div className="mb-4 text-center text-xs font-bold text-gray-500">
                    -- OFFLINE APPROVED --
                  </div>
                )}

                {/* Dynamic Signature Line */}
                {signatureLineStyle !== "Hidden" && (
                  <div className="mt-6 mb-4">
                    <div className={`border-b ${signatureLineStyle === 'Dotted' ? 'border-dashed' : 'border-solid'} border-gray-400 mb-2`}></div>
                    <div className="text-center text-[10px] text-gray-500">CARDHOLDER SIGNATURE</div>
                  </div>
                )}

                <div className="text-center text-[10px] mb-4">
                  I AGREE TO PAY ABOVE TOTAL AMOUNT ACCORDING TO CARD ISSUER AGREEMENT
                </div>

                {/* QR Code */}
                {enableDigital && showQRCode && (
                  <div className="flex flex-col items-center mb-4 mt-2">
                    <div className="w-24 h-24 bg-gray-900 flex items-center justify-center text-white mb-1">
                       <Icons.QrCode />
                    </div>
                    <span className="text-[9px] text-gray-500">Scan for Digital Receipt</span>
                  </div>
                )}

                {/* Dynamic Footer */}
                <div className="text-center font-medium mt-auto pt-4 border-t border-dashed border-gray-300 whitespace-pre-wrap">
                  {customFooter}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={handleReset}
        title="Reset Receipt Settings?"
        message="Are you sure you want to reset all receipt and printer settings to their default values? This action cannot be undone."
        confirmText="Reset to Defaults"
        type="danger"
      />
    </div>
  );
};
