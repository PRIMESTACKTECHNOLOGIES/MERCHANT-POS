import { useState, useEffect } from 'react';
import { processSecurePayment, fetchSettings } from '../lib/api';
import { 
  generateHmacSignature, 
  generateNonce, 
  generateLocalTxnId, 
  generateStan,
  generateBatchId 
} from '../lib/crypto';
import { useToast } from '../components/ui/Toast';

interface TransactionRecord {
  localTxnId: string;
  stan: string;
  amount: number;
  cardLast4: string;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  settlementCode?: string;
  timestamp: number;
  error?: string;
}

export const POSPageSecure = () => {
  const [amount, setAmount] = useState("0.00");
  const [loading, setLoading] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<TransactionRecord | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [forceOffline, setForceOffline] = useState(false);
  const [merchantConfig, setMerchantConfig] = useState({
    merchantId: 'MRC-1001',
    terminalId: 'WEB-TERMINAL',
    secretKey: 'sk_test_default_key_123'
  });

  const [merchantReceiptInfo, setMerchantReceiptInfo] = useState({
    companyName: '',
    address: '',
    phone: '',
    supportEmail: '',
    licenseNumber: '',
    taxId: '',
  });
  
  const [cardData, setCardData] = useState({ 
    pan: "", 
    expiry: "", 
    cvv: "" 
  });
  
  const { showToast } = useToast();

  // Load merchant config and pending transactions on mount
  useEffect(() => {
    loadMerchantConfig();
    loadTransactions();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadMerchantConfig = async () => {
    try {
      const settings = await fetchSettings();
      if (settings) {
        setMerchantConfig({
          merchantId: settings.merchant_id || 'MRC-1001',
          terminalId: settings.terminal_id || 'WEB-TERMINAL',
          secretKey: settings.api_key || 'sk_test_default_key_123'
        });
        setMerchantReceiptInfo({
          companyName: settings.merchant_name || '',
          address: settings.merchant_address || '',
          phone: settings.merchant_phone || '',
          supportEmail: settings.support_email || '',
          licenseNumber: settings.license_number || (settings as any)?.business?.licenseNumber || '',
          taxId: settings.tax_id || (settings as any)?.business?.taxId || (settings as any)?.business?.tax_id || '',
        });
      }
    } catch (e) {
      console.warn('Using default merchant config');
    }
  };

  const loadTransactions = () => {
    const stored = localStorage.getItem('dashboard_transactions');
    if (stored) {
      const parsed = JSON.parse(stored);
      setTransactions(parsed);
      setPendingCount(parsed.filter((t: TransactionRecord) => t.status === 'PENDING').length);
    }
  };

  const buildReceiptText = (txn: TransactionRecord) => {
    const dt = new Date(txn.timestamp);
    const statusLabel = txn.status === "SYNCED" ? "APPROVED" : txn.status === "FAILED" ? "FAILED" : "PENDING";
    const authMode = txn.status === "SYNCED" ? "ONLINE_APPROVED" : txn.status === "FAILED" ? "DECLINED" : "OFFLINE_PENDING";
    const entryMode = "MANUAL";
    const merchantId = merchantConfig.merchantId;
    const terminalId = merchantConfig.terminalId;
    const currency = "USD";

    const lines: string[] = [];
    const line = (s: string) => lines.push(s);
    const sep = () => line("--------------------------------");
    const wideSep = () => line("================================");

    wideSep();
    line(merchantReceiptInfo.companyName ? merchantReceiptInfo.companyName : "POS 201.3");
    line("TRANSACTION RECEIPT");
    sep();
    line(`Merchant ID: ${merchantId}`);
    line(`Terminal ID: ${terminalId}`);
    if (merchantReceiptInfo.licenseNumber) line(`License: ${merchantReceiptInfo.licenseNumber}`);
    if (merchantReceiptInfo.taxId) line(`Tax/VAT: ${merchantReceiptInfo.taxId}`);
    if (merchantReceiptInfo.address) line(`Address: ${merchantReceiptInfo.address}`);
    if (merchantReceiptInfo.phone) line(`Phone: ${merchantReceiptInfo.phone}`);
    if (merchantReceiptInfo.supportEmail) line(`Email: ${merchantReceiptInfo.supportEmail}`);
    line(`Date: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`);
    sep();
    line(`Txn ID: ${txn.localTxnId}`);
    line(`STAN: ${txn.stan}`);
    sep();
    line(`Card: **** **** **** ${txn.cardLast4}`);
    line(`Entry: ${entryMode}`);
    line(`Auth: ${authMode}`);
    sep();
    line(`Amount: $${txn.amount.toFixed(2)} ${currency}`);
    line(`Status: ${statusLabel}`);
    if (txn.settlementCode) {
      if (txn.status === "SYNCED") {
        line(`Settlement: ${txn.settlementCode}`);
      } else if (txn.status === "PENDING") {
        line(`Offline Code: ${txn.settlementCode}`);
      } else {
        line(`Ref: ${txn.settlementCode}`);
      }
    }
    if (txn.error) {
      sep();
      line(`Error: ${txn.error}`);
    }
    wideSep();
    line("THANK YOU");
    wideSep();
    return lines.join("\n");
  };

  const handlePrintReceipt = (txn: TransactionRecord) => {
    const text = buildReceiptText(txn);
    const w = window.open("", "receipt", "width=400,height=700");
    if (!w) {
      showToast("Pop-up blocked. Allow pop-ups to print.", "error");
      return;
    }
    w.document.open();
    w.document.write(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Receipt</title>
    <style>
      @page { margin: 0; }
      body { margin: 0; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.25; }
    </style>
  </head>
  <body>
    <pre>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
    <script>
      window.onload = function () {
        window.focus();
        window.print();
        window.close();
      };
    </script>
  </body>
</html>
    `);
    w.document.close();
  };

  const saveTransactions = (txns: TransactionRecord[]) => {
    localStorage.setItem('dashboard_transactions', JSON.stringify(txns));
    setTransactions(txns);
    setPendingCount(txns.filter(t => t.status === 'PENDING').length);
  };

  const handleKeyPress = (key: string) => {
    setAmount(prev => {
      if (key === 'C') return "0.00";
      if (prev === "0.00" && key !== '.') return key;
      if (key === '.' && prev.includes('.')) return prev;
      
      if (prev.includes('.')) {
        const [, decimal] = prev.split('.');
        if (decimal.length >= 2) return prev;
      }
      
      return prev + key;
    });
  };

  const validateCard = (): boolean => {
    // Remove spaces from card number
    const cleanPan = cardData.pan.replace(/\s/g, '');
    
    if (cleanPan.length < 13 || cleanPan.length > 19) {
      showToast('Card number must be 13-19 digits', 'error');
      return false;
    }
    
    if (!cardData.expiry.match(/^\d{2}\/\d{2}$/)) {
      showToast('Expiry must be in MM/YY format', 'error');
      return false;
    }
    
    const [month, year] = cardData.expiry.split('/').map(Number);
    const now = new Date();
    const expiryDate = new Date(2000 + year, month - 1);
    
    if (expiryDate < now) {
      showToast('Card has expired', 'error');
      return false;
    }
    
    if (cardData.cvv.length < 3) {
      showToast('CVV must be at least 3 digits', 'error');
      return false;
    }
    
    return true;
  };

  const handleChargeClick = () => {
    const amountVal = parseFloat(amount);
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    setShowCardForm(true);
  };

  const handleCharge = async () => {
    const amountVal = parseFloat(amount);
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }

    if (!validateCard()) {
      return;
    }

    setLoading(true);
    setShowCardForm(false);

    try {
      // Generate required IDs
      const localTxnId = generateLocalTxnId();
      const stan = generateStan();
      const batchId = generateBatchId();
      const nonce = generateNonce();
      const timestamp = Date.now();
      const amountMinor = Math.round(amountVal * 100);

      // Create transaction record
      const transaction: TransactionRecord = {
        localTxnId,
        stan,
        amount: amountVal,
        cardLast4: cardData.pan.slice(-4),
        status: 'PENDING',
        timestamp: Date.now()
      };

      // Generate HMAC signature
      const signature = await generateHmacSignature(
        "201.3",
        merchantConfig.merchantId,
        merchantConfig.terminalId,
        batchId,
        timestamp,
        nonce,
        1, // transaction count
        merchantConfig.secretKey
      );

      // Prepare payment data
      const paymentData = {
        protocolVersion: "201.3",
        merchantId: merchantConfig.merchantId,
        terminalId: merchantConfig.terminalId,
        batchId,
        timestamp,
        nonce,
        signature,
        transactions: [{
          localTxnId,
          stan,
          amountMinor,
          currency: "USD",
          pan: cardData.pan.replace(/\s/g, ''),
          expiry: cardData.expiry,
          cvv: cardData.cvv,
          txnType: "SALE",
          entryMode: "MANUAL",
          txnTimestamp: timestamp
        }]
      };

      // Decide whether to process online or offline
      if (isOnline && !forceOffline) {
        // Send to backend
        const result = await processSecurePayment(paymentData);

        if (result.success) {
          // Update transaction with settlement code
          transaction.status = 'SYNCED';
          transaction.settlementCode = result.settlementCode;
          
          showToast(
            `Payment Approved! Settlement: ${result.settlementCode}`, 
            'success'
          );
          
          setLastTransaction(transaction);
          setShowReceipt(true);
        } else {
          transaction.status = 'FAILED';
          transaction.error = result.error || 'Payment failed';
          showToast(transaction.error, 'error');
        }
      } else {
        // PROCESS OFFLINE (Mock Protocol 201.3 logic)
        // In a real device, this would generate an Auth Code locally
        const offlineAuthCode = "OFF-" + Math.floor(100000 + Math.random() * 900000);
        transaction.status = 'PENDING';
        transaction.settlementCode = offlineAuthCode;
        
        showToast(
          `Approved Offline! Auth Code: ${offlineAuthCode}`, 
          'success'
        );
        
        setLastTransaction(transaction);
        setShowReceipt(true);
      }

      // Save to history
      const updated = [...transactions, transaction];
      saveTransactions(updated);

    } catch (error: any) {
      // Create failed transaction record
      const failedTxn: TransactionRecord = {
        localTxnId: generateLocalTxnId(),
        stan: generateStan(),
        amount: amountVal,
        cardLast4: cardData.pan.slice(-4),
        status: 'FAILED',
        timestamp: Date.now(),
        error: error.message || 'Network error'
      };
      
      const updated = [...transactions, failedTxn];
      saveTransactions(updated);
      
      showToast(error.message || 'Payment failed', 'error');
    } finally {
      setLoading(false);
      setAmount("0.00");
      setCardData({ pan: "", expiry: "", cvv: "" });
    }
  };

  const handleRetry = async (txn: TransactionRecord) => {
    showToast('Retry not implemented for single transaction', 'info');
  };

  const formatCardDisplay = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = matches && matches[0] || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 w-full max-w-4xl mx-auto shadow-xl overflow-hidden rounded-xl">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
        <div>
          <h2 className="text-xl font-bold">POS Terminal (Secure)</h2>
          <p className="text-xs opacity-80">Merchant: {merchantConfig.merchantId} | Terminal: {merchantConfig.terminalId}</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Status and Toggle */}
          <div 
            className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full cursor-pointer hover:bg-white/20 transition-colors"
            onClick={() => setForceOffline(!forceOffline)}
            title={forceOffline ? "Click to resume automatic status" : "Click to force offline mode"}
          >
            <div className="relative">
              <span className={`block w-3 h-3 rounded-full ${isOnline && !forceOffline ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`}></span>
              {forceOffline && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              )}
            </div>
            <span className={`text-xs font-bold tracking-wider ${forceOffline ? 'animate-pulse-red' : ''}`}>
              {forceOffline ? 'FORCED OFFLINE' : (isOnline ? 'ONLINE' : 'OFFLINE')}
            </span>
            <div className={`w-8 h-4 rounded-full relative transition-colors ${forceOffline ? 'bg-red-500' : 'bg-green-500'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${forceOffline ? 'left-4.5' : 'left-0.5'}`}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: POS Keypad */}
        <div className="flex-1 flex flex-col p-6">
          {/* Amount Display */}
          <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
            <span className="text-gray-400 text-sm">Amount Due</span>
            <div className="text-5xl font-mono font-bold text-gray-800">
              ${amount}
            </div>
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '.'].map((key) => (
              <button
                key={key}
                onClick={() => handleKeyPress(key)}
                className={`
                  h-16 rounded-xl text-2xl font-semibold shadow-sm transition-all active:scale-95
                  ${key === 'C' 
                    ? 'bg-red-100 text-red-600 hover:bg-red-200' 
                    : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'}
                `}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Charge Button */}
          <button
            onClick={handleChargeClick}
            disabled={loading || parseFloat(amount) === 0}
            className={`
              w-full py-4 rounded-xl text-lg font-bold text-white shadow-lg transition-all
              ${loading || parseFloat(amount) === 0 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'}
            `}
          >
            {loading ? 'Processing...' : 'Charge'}
          </button>
        </div>

        {/* Right: Transaction History */}
        <div className="w-80 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <h3 className="font-bold text-gray-700 mb-4">Today's Transactions</h3>
          
          {pendingCount > 0 && (
            <div className="bg-amber-100 text-amber-800 px-3 py-2 rounded-lg mb-4 text-sm">
              {pendingCount} pending sync
            </div>
          )}

          <div className="space-y-3">
            {transactions.slice().reverse().map((txn, idx) => (
              <div 
                key={idx}
                className={`
                  p-3 rounded-lg border text-sm
                  ${txn.status === 'SYNCED' 
                    ? 'bg-green-50 border-green-200' 
                    : txn.status === 'FAILED'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-gray-50 border-gray-200'}
                `}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold">${txn.amount.toFixed(2)}</p>
                    <p className="text-gray-500">****{txn.cardLast4}</p>
                    <p className="text-xs text-gray-400">STAN: {txn.stan}</p>
                  </div>
                  <span className={`
                    text-xs px-2 py-1 rounded
                    ${txn.status === 'SYNCED' 
                      ? 'bg-green-200 text-green-800' 
                      : txn.status === 'FAILED'
                      ? 'bg-red-200 text-red-800'
                      : 'bg-gray-200 text-gray-800'}
                  `}>
                    {txn.status}
                  </span>
                </div>
                {txn.settlementCode && (
                  <p className="text-xs text-green-600 mt-1">
                    Settlement: {txn.settlementCode}
                  </p>
                )}
                {txn.error && (
                  <p className="text-xs text-red-600 mt-1">
                    {txn.error}
                  </p>
                )}
              </div>
            ))}
            
            {transactions.length === 0 && (
              <p className="text-gray-400 text-center py-8">No transactions today</p>
            )}
          </div>
        </div>
      </div>

      {/* Card Entry Modal */}
      {showCardForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Enter Card Details</h3>
              <button 
                onClick={() => setShowCardForm(false)} 
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                  Card Number
                </label>
                <input 
                  type="text" 
                  value={cardData.pan}
                  onChange={(e) => {
                    const formatted = formatCardDisplay(e.target.value);
                    setCardData({...cardData, pan: formatted});
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg font-mono"
                  placeholder="0000 0000 0000 0000"
                  maxLength={19}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Expiry (MM/YY)
                  </label>
                  <input 
                    type="text" 
                    value={cardData.expiry}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, '').substring(0, 4);
                      if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
                      setCardData({...cardData, expiry: val});
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center"
                    placeholder="MM/YY"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    CVV
                  </label>
                  <input 
                    type="password" 
                    value={cardData.cvv}
                    onChange={(e) => setCardData({...cardData, cvv: e.target.value.replace(/\D/g, '').substring(0, 4)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center"
                    placeholder="123"
                  />
                </div>
              </div>
              <button 
                onClick={handleCharge}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-[0.98] mt-2"
              >
                {loading ? 'Processing...' : `Pay $${amount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {showReceipt && lastTransaction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white shadow-2xl w-full max-w-[380px] animate-scale-in flex flex-col overflow-hidden rounded-2xl">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-gray-900 to-gray-800 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold tracking-widest uppercase text-white/70">POS 201.3</div>
                  <div className="text-lg font-extrabold tracking-tight">Receipt</div>
                  <div className="text-[11px] text-white/90 mt-1 font-semibold">
                    {merchantReceiptInfo.companyName || "Company Name"}
                  </div>
                  <div className="text-[11px] text-white/70 mt-1">Merchant ID: {merchantConfig.merchantId}</div>
                  <div className="text-[11px] text-white/70">Terminal ID: {merchantConfig.terminalId}</div>
                </div>
                <div className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                  lastTransaction.status === "SYNCED"
                    ? "bg-green-500/20 text-green-200 ring-1 ring-green-400/30"
                    : lastTransaction.status === "FAILED"
                      ? "bg-red-500/20 text-red-200 ring-1 ring-red-400/30"
                      : "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30"
                }`}>
                  {lastTransaction.status === "SYNCED" ? "APPROVED" : lastTransaction.status === "FAILED" ? "FAILED" : "PENDING"}
                </div>
              </div>
            </div>

            <div className="p-6 bg-white">
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 bg-white border-b border-gray-100 space-y-1">
                  {merchantReceiptInfo.licenseNumber && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">License</span>
                      <span className="font-medium text-gray-900 text-right">{merchantReceiptInfo.licenseNumber}</span>
                    </div>
                  )}
                  {merchantReceiptInfo.taxId && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">VAT/Tax</span>
                      <span className="font-medium text-gray-900 text-right">{merchantReceiptInfo.taxId}</span>
                    </div>
                  )}
                  {merchantReceiptInfo.phone && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">Phone</span>
                      <span className="font-medium text-gray-900 text-right">{merchantReceiptInfo.phone}</span>
                    </div>
                  )}
                  {merchantReceiptInfo.supportEmail && (
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-gray-500">Email</span>
                      <span className="font-medium text-gray-900 text-right break-all">{merchantReceiptInfo.supportEmail}</span>
                    </div>
                  )}
                  {merchantReceiptInfo.address && (
                    <div className="pt-2 text-xs text-gray-600 break-words">
                      {merchantReceiptInfo.address}
                    </div>
                  )}
                </div>
                <div className="p-4 bg-gray-50 border-b border-gray-100">
                  <div className="text-[11px] text-gray-500">Amount</div>
                  <div className="text-3xl font-extrabold tracking-tight text-gray-900">${lastTransaction.amount.toFixed(2)}</div>
                  <div className="text-[11px] text-gray-500 mt-1">Currency: USD</div>
                </div>

                <div className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Date/Time</span>
                    <span className="font-medium text-gray-900 text-right">
                      {new Date(lastTransaction.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Txn ID</span>
                    <span className="font-mono text-gray-900 text-right break-all">{lastTransaction.localTxnId}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">STAN</span>
                    <span className="font-mono font-bold text-gray-900">{lastTransaction.stan}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Card</span>
                    <span className="font-mono text-gray-900">**** **** **** {lastTransaction.cardLast4}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Entry Mode</span>
                    <span className="font-medium text-gray-900">MANUAL</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Auth Mode</span>
                    <span className="font-medium text-gray-900">
                      {lastTransaction.status === "SYNCED" ? "ONLINE_APPROVED" : lastTransaction.status === "FAILED" ? "DECLINED" : "OFFLINE_PENDING"}
                    </span>
                  </div>
                </div>

                {lastTransaction.settlementCode && (
                  <div className="p-4 border-t border-gray-100 bg-amber-50">
                    <div className="text-[11px] text-amber-800 font-semibold uppercase tracking-widest">
                      {lastTransaction.status === "SYNCED" ? "Settlement Code" : "Offline Reference"}
                    </div>
                    <div className="mt-1 text-2xl font-mono font-extrabold tracking-wider text-amber-900 break-all">
                      {lastTransaction.settlementCode}
                    </div>
                    <div className="text-[11px] text-amber-800 mt-1">
                      {lastTransaction.status === "SYNCED"
                        ? "Save this code for reconciliation."
                        : "Pending settlement. Sync when internet returns."}
                    </div>
                  </div>
                )}

                {lastTransaction.error && (
                  <div className="p-4 border-t border-gray-100 bg-red-50">
                    <div className="text-[11px] text-red-800 font-semibold uppercase tracking-widest">Error</div>
                    <div className="mt-1 text-sm text-red-900 break-words">{lastTransaction.error}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-5 bg-gray-50 border-t border-gray-100">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowReceipt(false)}
                  className="flex-1 py-2.5 text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-100"
                >
                  Close
                </button>
                <button
                  onClick={() => handlePrintReceipt(lastTransaction)}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-gray-900 rounded-xl hover:bg-black shadow-lg"
                >
                  Print
                </button>
              </div>
              <div className="mt-3 text-center text-[11px] text-gray-500">
                Powered by POS 201.3
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSPageSecure;
