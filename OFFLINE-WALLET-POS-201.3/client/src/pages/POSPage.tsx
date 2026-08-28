import { useState, useEffect } from 'react';
import { uploadBatch, chargePayment, cashoutBraintree, fetchTerminals } from '../lib/api';
import type { Terminal } from '../types';
import { MockDataGenerator } from "../lib/emv/mock-data-generator";
import { TerminalRiskManagement } from "../lib/emv/terminal-risk-management";
import { useToast } from '../components/ui/Toast';

// Initialize Risk Management (Floor Limit: $50)
const riskManagement = new TerminalRiskManagement({
  floorLimit: 50,
  randomSelectionPercentage: 20,
  cumulativeOfflineLimit: 200,
  consecutiveOfflineLimit: 3
});

export const POSPage = () => {
  const [amount, setAmount] = useState("0.00");
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardData, setCardData] = useState({ pan: "", expiry: "", cvv: "" });
  const { showToast } = useToast();

  useEffect(() => {
    updatePendingCount();
  }, []);

  const updatePendingCount = () => {
    const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
    setPendingCount(pending.length);
  };

  const handleKeyPress = (key: string) => {
    setAmount(prev => {
      if (key === 'C') return "0.00";
      if (prev === "0.00" && key !== '.') return key;
      if (key === '.' && prev.includes('.')) return prev;
      
      // Limit decimals to 2
      if (prev.includes('.')) {
        const [, decimal] = prev.split('.');
        if (decimal.length >= 2) return prev;
      }
      
      return prev + key;
    });
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

    if (!cardData.pan || cardData.pan.length < 13) {
      showToast('Invalid Card Number', 'error');
      return;
    }

    setLoading(true);
    setShowCardForm(false);

    // Create Transaction Object
    // Generate STAN (Auto-incrementing 6-digit)
    let lastStan = parseInt(localStorage.getItem('last_stan') || '0', 10);
    lastStan = (lastStan + 1) % 1000000;
    const currentStan = lastStan.toString().padStart(6, '0');
    localStorage.setItem('last_stan', lastStan.toString());

    const txn = {
      amountMinor: Math.round(parseFloat(amount) * 100),
      currency: "USD",
      timestamp: new Date().toISOString(),
      stan: currentStan,
      pan: cardData.pan.replace(/\s/g, ''), // Use entered card
      expiry: cardData.expiry
    };

    // Prepare Batch Data (Single Transaction Batch for Real-time Simulation)
    const batchData = {
      protocolVersion: "201.3",
      merchantId: "MRC-1001", // Should come from settings
      terminalId: "T2013-0001", // Should come from settings
      batchId: `batch-${Date.now()}`,
      timestamp: new Date().toISOString(),
      nonce: Math.random().toString(36).substring(7),
      transactions: [txn]
    };

    try {
      if (navigator.onLine && !simulateOffline) {
        const res = await chargePayment(
          txn.amountMinor, 
          txn.currency, 
          batchData.merchantId,
          { pan: txn.pan, expiry: txn.expiry }
        );
        if (res.status === 'APPROVED') {
          showToast('Transaction Approved (Online)', 'success');
        } else {
          showToast('Transaction Declined', 'error');
          setLoading(false);
          setAmount("0.00");
          return;
        }
      } else {
        throw new Error("Offline");
      }
    } catch (_error) {
      // --- OFFLINE AUTHORIZATION (201.3 PROTOCOL) ---
      
      // 1. Generate Mock TLV (Simulating Card Read)
      const mockTLV = MockDataGenerator.generateMockTLV(txn.amountMinor, txn.pan);
      
      // 2. Perform Risk Management
      const riskResult = riskManagement.checkTransaction(mockTLV, txn.amountMinor / 100);
      
      // 3. Decide: Approve or Decline
      let authCode = null;
      let cryptogram = null;
      
      if (riskResult.proceed && !riskResult.requiresOnline) {
        // APPROVED OFFLINE
        authCode = "OFF-" + Math.floor(Math.random() * 900000 + 100000);
        cryptogram = "TC-" + Math.random().toString(16).substring(2, 10).toUpperCase(); // Transaction Certificate
        showToast(`Approved Offline (Auth: ${authCode})`, 'success');
        
        // 4. Store Approved Transaction
        const offlineBatch = {
          ...batchData,
          transactions: [{
            ...txn,
            authCode,
            cryptogram,
            tlv: mockTLV // Store TLV for audit
          }]
        };
  
        const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
        pending.push(offlineBatch);
        localStorage.setItem('offline_transactions', JSON.stringify(pending));
      } else {
        // DECLINED OFFLINE (Requires Online but we are Offline)
        showToast(`Declined Offline: ${riskResult.reason || 'Risk Check Failed'}`, 'error');
        setLoading(false);
        setAmount("0.00");
        return; // Do not store declined transactions
      }
    } finally {
      setLoading(false);
      setAmount("0.00");
      updatePendingCount();
    }
  };

  const handleSync = async () => {
    const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
    if (pending.length === 0) return;

    setLoading(true);
    let successCount = 0;
    const failed = [];

    for (const batch of pending) {
      try {
        const res = await cashoutBraintree([batch]);
        if (res && res.synced > 0) {
          successCount++;
        } else {
          await uploadBatch(batch);
          successCount++;
        }
      } catch (_e) {
        failed.push(batch);
      }
    }

    localStorage.setItem('offline_transactions', JSON.stringify(failed));
    setPendingCount(failed.length);
    setLoading(false);
    
    if (successCount > 0) showToast(`Synced ${successCount} batches`, 'success');
    if (failed.length > 0) showToast(`Failed to sync ${failed.length} batches`, 'error');
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 w-full max-w-md mx-auto shadow-xl overflow-hidden border-x border-gray-200 min-h-[600px] rounded-xl">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md z-10">
        <h2 className="text-lg font-bold tracking-wide">POS Terminal</h2>
        <div className="flex items-center gap-2">
           <button 
             onClick={() => setSimulateOffline(!simulateOffline)}
             className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${simulateOffline ? 'bg-red-500 text-white' : 'bg-blue-700 text-blue-100 hover:bg-blue-800'}`}
           >
             {simulateOffline ? 'FORCE OFFLINE' : 'GO OFFLINE'}
           </button>
           <span className={`w-2.5 h-2.5 rounded-full ${(navigator.onLine && !simulateOffline) ? 'bg-green-400' : 'bg-red-400'}`}></span>
           <span className="text-xs font-medium opacity-90">{(navigator.onLine && !simulateOffline) ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </div>

      {/* Display */}
      <div className="bg-white p-8 flex flex-col items-end justify-center border-b border-gray-100 shadow-sm relative h-40">
        <span className="text-gray-400 text-sm font-medium mb-1">Amount Due</span>
        <div className="text-5xl font-mono font-bold text-gray-800 tracking-tight">
          ${amount}
        </div>
        {pendingCount > 0 && (
          <button 
            onClick={handleSync}
            className="absolute top-4 left-4 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-amber-200 transition-colors"
          >
            <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
            {pendingCount} Pending Sync
          </button>
        )}
      </div>

      {/* Card Entry Modal */}
      {showCardForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Enter Card Details</h3>
              <button onClick={() => setShowCardForm(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Card Number</label>
                <input 
                  type="text" 
                  value={cardData.pan}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').substring(0, 16);
                    setCardData({...cardData, pan: val});
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-lg font-mono tracking-wider"
                  placeholder="0000 0000 0000 0000"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Expiry</label>
                  <input 
                    type="text" 
                    value={cardData.expiry}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, '').substring(0, 4);
                      if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
                      setCardData({...cardData, expiry: val});
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-center"
                    placeholder="MM/YY"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">CVV</label>
                  <input 
                    type="password" 
                    value={cardData.cvv}
                    onChange={(e) => setCardData({...cardData, cvv: e.target.value.replace(/\D/g, '').substring(0, 4)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-center"
                    placeholder="123"
                  />
                </div>
              </div>
              <button 
                onClick={handleCharge}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-[0.98] mt-2"
              >
                Pay ${amount}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keypad */}
      <div className="flex-1 p-4 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '.'].map((key) => (
          <button
            key={key}
            onClick={() => handleKeyPress(key)}
            className={`
              rounded-xl text-2xl font-semibold shadow-sm transition-all active:scale-95
              ${key === 'C' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'}
              flex items-center justify-center h-16
            `}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="p-4 bg-white border-t border-gray-200">
        <button
          onClick={handleChargeClick}
          disabled={loading || parseFloat(amount) === 0}
          className={`
            w-full py-4 rounded-xl text-lg font-bold text-white shadow-lg transition-all
            ${loading || parseFloat(amount) === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-500/30 active:scale-[0.98]'}
            flex items-center justify-center gap-2
          `}
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </>
          ) : (
            'Charge'
          )}
        </button>
      </div>
    </div>
  );
};
