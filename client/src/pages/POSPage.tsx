import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  uploadBatch, 
  chargePayment, 
  getCustomers, 
  getWalletBalance, 
  debitWallet, 
  saveOfflineWalletPayment,
  syncOfflineWalletPayments,
  generateStan,
  fetchSettings,
  fetchProducts,
  fetchTransactions,
  readAcr122uCard,
  getAcr122uStatus,
  type Product,
  type Transaction
} from '../lib/api';
import {
  generateHmacSignature,
  generateNonce,
  generateBatchId,
  generateLocalTxnId,
} from '../lib/crypto';
import type { Customer, Settings } from '../lib/api';
import { TerminalRiskManagement } from "../lib/emv/terminal-risk-management";
import { processEMVOffline } from '../lib/emv/emv-pos-bridge';
import { useToast } from '../components/ui/toastContext';

interface CartItem {
  product: Product;
  qty: number;
}

const riskManagement = new TerminalRiskManagement({
  floorLimit: 50,
  randomOnlinePercentage: 20,
  forceOnline: false,
  allowOffline: true,
});

const TIP_PRESETS = [0, 10, 15, 18, 20, 25];

export const POSPage = () => {
  const [activeTab, setActiveTab] = useState<'keypad' | 'catalog'>('keypad');
  const [amount, setAmount] = useState("0.00");
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showCardForm, setShowCardForm] = useState(false);
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [cardData, setCardData] = useState({ pan: "", expiry: "", cvv: "" });
  const [voiceAuthCode, setVoiceAuthCode] = useState("");
  const posProtocol = '201.3' as const;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerWalletBalance, setCustomerWalletBalance] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tipPercent, setTipPercent] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const { showToast } = useToast();

  // NFC / ACR122U state
  const [nfcStatus, setNfcStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [nfcReading, setNfcReading] = useState(false);
  const [nfcCardData, setNfcCardData] = useState<{ uid?: string; aid?: string } | null>(null);
  const [nfcReaderName, setNfcReaderName] = useState<string>('');

  const cartSubtotal = useMemo(() => 
    cart.reduce((sum, ci) => sum + (ci.product.price_minor * ci.qty), 0) / 100,
    [cart]
  );

  const tipAmount = useMemo(() => {
    const base = cart.length > 0 ? cartSubtotal : parseFloat(amount || "0");
    const pct = tipPercent === -1 ? (parseFloat(customTip || "0") || 0) : tipPercent;
    return (base * pct) / 100;
  }, [tipPercent, customTip, cartSubtotal, amount]);

  const finalAmount = useMemo(() => {
    const base = cart.length > 0 ? cartSubtotal : parseFloat(amount || "0");
    return (base + tipAmount).toFixed(2);
  }, [cartSubtotal, tipAmount, amount]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p => 
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  }, [products, productSearch]);

  useEffect(() => {
    updatePendingCount();
    loadCustomers();
    loadSettings();
    loadProducts();
    loadRecentTxns();
  }, []);

  // ── NFC reader status poll (every 5 seconds) ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const checkNfc = async () => {
      try {
        const status = await getAcr122uStatus();
        if (!cancelled) {
          setNfcStatus(status.connected ? 'connected' : 'disconnected');
          if (status.readerName) setNfcReaderName(status.readerName);
        }
      } catch {
        if (!cancelled) setNfcStatus('disconnected');
      }
    };
    checkNfc();
    const interval = setInterval(checkNfc, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── NFC tap handler ───────────────────────────────────────────────────────
  const handleNfcTap = useCallback(async () => {
    if (nfcReading) return;
    setNfcReading(true);
    showToast('Tap your card on the reader...', 'info' as any);
    try {
      const result = await readAcr122uCard();
      if (!result?.success) {
        showToast(result?.error || 'No card detected', 'error');
        return;
      }
      const card = result.card;
      const emv = result.emv || {};

      // Extract PAN from EMV tag 5A, fallback to UID
      const panRaw: string = emv['5A'] || emv['57']?.split('D')?.[0] || '';
      const pan = panRaw.replace(/\s/g, '').replace(/F/gi, '').substring(0, 16);

      // Extract expiry from tag 5F24 (YYMMDD) → MM/YY
      const expiryRaw: string = emv['5F24'] || '';
      let expiry = '';
      if (expiryRaw.length >= 4) {
        const yy = expiryRaw.substring(0, 2);
        const mm = expiryRaw.substring(2, 4);
        expiry = `${mm}/${yy}`;
      }

      setCardData(prev => ({
        ...prev,
        pan: pan || prev.pan,
        expiry: expiry || prev.expiry,
      }));
      setNfcCardData({ uid: card?.uid, aid: card?.aid });
      showToast(`Card detected: ****${pan.slice(-4) || card?.uid?.slice(-4)}`, 'success');
      setShowCardForm(true);
    } catch (e: any) {
      showToast(e?.message || 'NFC read failed', 'error');
    } finally {
      setNfcReading(false);
    }
  }, [nfcReading, showToast]);

  const loadCustomers = async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (e) {
      console.error("Failed to load customers", e);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  };

  const loadProducts = async () => {
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch (e) {
      console.error("Failed to load products", e);
    }
  };

  const loadRecentTxns = async () => {
    try {
      const data = await fetchTransactions();
      setRecentTxns(data.slice(0, 10));
    } catch (e) {
      console.error("Failed to load transactions", e);
    }
  };

  const updatePendingCount = () => {
    const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
    setPendingCount(pending.length);
  };

  const handleKeyPress = (key: string) => {
    if (cart.length > 0) {
      setCart([]);
      showToast('Cart cleared for manual entry', 'info' as any);
    }
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

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(ci => ci.product.id === product.id);
      if (existing) {
        return prev.map(ci => 
          ci.product.id === product.id ? { ...ci, qty: ci.qty + 1 } : ci
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(ci => ci.product.id === productId);
      if (!existing) return prev;
      if (existing.qty <= 1) return prev.filter(ci => ci.product.id !== productId);
      return prev.map(ci =>
        ci.product.id === productId ? { ...ci, qty: ci.qty - 1 } : ci
      );
    });
  };

  const deleteFromCart = (productId: string) => {
    setCart(prev => prev.filter(ci => ci.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setTipPercent(0);
    setCustomTip("");
  };

  const handleChargeClick = () => {
    const amountVal = parseFloat(finalAmount);
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    setShowCardForm(true);
  };

  const handleWalletPaymentClick = () => {
    const amountVal = parseFloat(finalAmount);
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    setShowWalletForm(true);
    setSelectedCustomer(null);
    setCustomerWalletBalance(null);
  };

  const selectCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer);
    try {
      const balance = await getWalletBalance(customer.id);
      setCustomerWalletBalance(balance.balance);
    } catch (e) {
      console.error("Failed to load wallet balance", e);
      setCustomerWalletBalance(null);
    }
  };

  const handleWalletPayment = async () => {
    if (!selectedCustomer) {
      showToast('Please select a customer', 'error');
      return;
    }

    const amountVal = parseFloat(finalAmount);
    if (customerWalletBalance !== null && customerWalletBalance < amountVal) {
      showToast('Insufficient wallet balance', 'error');
      return;
    }

    setLoading(true);
    setShowWalletForm(false);

    const stan = generateStan();

    try {
      if (navigator.onLine) {
        await debitWallet(
          selectedCustomer.id,
          amountVal,
          "pos-terminal",
          `STAN:${stan}`
        );
        showToast('Wallet Payment Approved (Online)', 'success');
      } else {
        saveOfflineWalletPayment({
          customerId: selectedCustomer.id,
          amount: amountVal,
          currency: "USD",
          stan,
          terminalId: settings?.terminal_id || "T2013-0001",
          merchantId: settings?.merchant_id || "MRC-1001",
          timestamp: Date.now()
        });
        showToast('Wallet Payment Saved (Offline)', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Wallet payment failed', 'error');
    } finally {
      setLoading(false);
      setAmount("0.00");
      clearCart();
      loadRecentTxns();
      updatePendingCount();
    }
  };

  const handleSyncWallets = async () => {
    setLoading(true);
    const result = await syncOfflineWalletPayments();
    if (result.synced > 0) {
      showToast(`Synced ${result.synced} wallet payments`, 'success');
    }
    if (result.failed > 0) {
      showToast(`Failed to sync ${result.failed} wallet payments`, 'error');
    }
    setLoading(false);
  };

  const handleCharge = async () => {
    const amountVal = parseFloat(finalAmount);
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }

    if (!cardData.pan || cardData.pan.length < 13) {
      showToast('Invalid Card Number', 'error');
      return;
    }

    // CVV and Auth Code are always required
    if (!cardData.cvv.trim()) {
      showToast('CVV is required', 'error');
      return;
    }
    if (!voiceAuthCode.trim()) {
      showToast('Auth Code is required', 'error');
      return;
    }

    setLoading(true);
    setShowCardForm(false);

    let lastStan = parseInt(localStorage.getItem('last_stan') || '0', 10);
    lastStan = (lastStan + 1) % 1000000;
    const currentStan = lastStan.toString().padStart(6, '0');
    localStorage.setItem('last_stan', lastStan.toString());

    const merchantId = settings?.merchant_id || "MRC-1001";
    const terminalId = settings?.terminal_id || "T2013-0001";
    const secretKey  = (settings as any)?.api_key || '';
    const batchId    = generateBatchId();
    const nonce      = generateNonce();
    const timestamp  = Date.now();
    const localTxnId = generateLocalTxnId();

    const txn = {
      localTxnId,
      amountMinor: Math.round(amountVal * 100),
      currency: "USD",
      timestamp,
      stan: currentStan,
      pan: cardData.pan.replace(/\s/g, ''),
      expiry: cardData.expiry,
      ...(voiceAuthCode.trim() ? { authCode: voiceAuthCode.trim() } : {}),
      ...(cardData.cvv.trim() ? { cvv: cardData.cvv.trim() } : {}),
      entryMode: posProtocol === '201.3' ? 'OFFLINE_201_3' : posProtocol === '101.1' ? 'VOICE_AUTH' : 'MANUAL',
      txnType: posProtocol === '201.3' ? 'OFFLINE_BATCH' : posProtocol === '101.1' ? 'VOICE_AUTHORIZED' : 'SALE'
    };

    // Build HMAC signature required by protocol 201.3
    const signature = await generateHmacSignature(
      "201.3",
      merchantId,
      terminalId,
      batchId,
      timestamp,
      nonce,
      1,
      secretKey
    );

    const batchData = {
      protocolVersion: "201.3",
      merchantId,
      terminalId,
      batchId,
      timestamp,
      nonce,
      signature,
      transactions: [txn]
    };

    try {
      if (navigator.onLine) {
        const res = await chargePayment(
          txn.amountMinor, 
          txn.currency, 
          batchData.merchantId,
          { pan: txn.pan, expiry: txn.expiry,
            cvv: (posProtocol === '101.6' || posProtocol === '201.3') ? (cardData.cvv || undefined) : undefined,
            customerId: selectedCustomer?.id,
            entryMode: posProtocol === '201.3' ? 'OFFLINE_201_3' : posProtocol === '101.1' ? 'VOICE_AUTH' : 'MANUAL',
            authCode: (posProtocol === '101.1' || posProtocol === '201.3') ? (voiceAuthCode.trim() || undefined) : undefined,
          }
        );
        if (res.status === 'APPROVED') {
          showToast('Transaction Approved (Online)', 'success');
        } else {
          const detail =
            (res as any).reason ||
            (res as any).error ||
            (res as any).message;
          showToast(
            detail ? `Transaction Declined: ${detail}` : 'Transaction Declined',
            'error'
          );
          setLoading(false);
          setAmount("0.00");
          return;
        }
      } else {
        throw new Error("Offline");
      }
    } catch (_error) {
      try {
        const amountFloat = amountVal;
        const emvResult = await processEMVOffline(
          { pan: txn.pan, expiry: txn.expiry, cvv: cardData.cvv || '' },
          amountFloat,
          txn.currency,
          batchData.terminalId,
          '5999'
        );

        if (emvResult.approved && !emvResult.requiresOnline) {
          const authCode = emvResult.authCode || (`OFF-${Math.floor(Math.random() * 900000 + 100000)}`);
          const cryptogram = emvResult.cryptogram;
          showToast(`Approved Offline (Auth: ${authCode})`, 'success');

          const offlineBatch = {
            ...batchData,
            transactions: [{
              ...txn,
              authCode,
              cryptogram,
              emvRef: emvResult.offlineRef,
              emv_atc: emvResult.atc
            }]
          };

          const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
          pending.push(offlineBatch);
          localStorage.setItem('offline_transactions', JSON.stringify(pending));
        } else if (emvResult.requiresOnline) {
          const cryptogram = emvResult.cryptogram;
          showToast(
            `Queued for Online Auth: ${emvResult.reason || 'Issuer requires online authorization'}`,
            'warning'
          );

          const offlineBatch = {
            ...batchData,
            transactions: [{
              ...txn,
              decision: emvResult.decision || 'ARQC',
              cryptogram,
              emvRef: emvResult.offlineRef,
              emv_atc: emvResult.atc,
              requiresOnline: true,
              reason: emvResult.reason
            }]
          };

          const pending = JSON.parse(localStorage.getItem('offline_transactions') || '[]');
          pending.push(offlineBatch);
          localStorage.setItem('offline_transactions', JSON.stringify(pending));
        } else {
          const detail = emvResult.reason || 'Risk Check Failed';
          showToast(`Declined Offline: ${detail}`, 'error');
          setLoading(false);
          setAmount("0.00");
          return;
        }
      } catch (emvErr: any) {
        console.error('EMV processing error:', emvErr);
        const msg = emvErr?.message || 'EMV processing failed (offline)';
        showToast(`EMV processing failed: ${msg}`, 'error');
        setLoading(false);
        setAmount('0.00');
        return;
      }
    } finally {
      setLoading(false);
      setAmount("0.00");
      clearCart();
      loadRecentTxns();
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
        await uploadBatch(batch);
        successCount++;
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
    <div className="flex flex-col h-full bg-gray-50 w-full max-w-lg mx-auto shadow-xl overflow-hidden border-x border-gray-200 min-h-[720px] rounded-xl relative">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex justify-between items-center shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center backdrop-blur-sm">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          </div>
          <div>
            <h2 className="text-base font-bold tracking-wide leading-none">POS Terminal</h2>
            <p className="text-[10px] text-blue-200 mt-0.5">{settings?.merchant_name || 'Merchant Portal'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <button
             onClick={() => setShowRecent(true)}
             className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
             title="Recent transactions"
           >
             <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
           </button>
           <span className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)] ${navigator.onLine ? 'bg-green-400' : 'bg-red-400'}`}></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 flex">
        {[
          { id: 'keypad', label: 'Keypad', icon: 'dial' },
          { id: 'catalog', label: 'Catalog', icon: 'box' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-3 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border-b-2 ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.icon === 'dial' && <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 1v6m0 10v6m11-11h-6M7 12H1m15.07-6.07l-4.24 4.24M9.17 14.83l-4.24 4.24M21.07 16.93l-4.24-4.24M9.17 9.17L4.93 4.93"/></svg>}
            {tab.icon === 'box' && <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Display */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white p-5 flex flex-col justify-center border-b border-gray-700 relative min-h-[140px]">
        <div className="flex justify-between items-start mb-3">
          <div>
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">
              {cart.length > 0 ? `${cart.reduce((s,c)=>s+c.qty,0)} Items · Subtotal` : 'Amount Due'}
            </span>
          </div>
          {pendingCount > 0 && (
            <button 
              onClick={handleSync}
              className="text-[10px] bg-amber-500/20 text-amber-300 px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-amber-500/30 transition-colors border border-amber-500/30"
            >
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
              {pendingCount} Pending
            </button>
          )}
        </div>

        {cart.length > 0 ? (
          <div className="space-y-1.5 mb-3 max-h-24 overflow-y-auto pr-1">
            {cart.slice(-3).map(ci => (
              <div key={ci.product.id} className="flex justify-between text-xs">
                <span className="text-gray-400 truncate mr-2">{ci.qty}× {ci.product.name}</span>
                <span className="text-gray-200 font-mono whitespace-nowrap">${((ci.product.price_minor*ci.qty)/100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-1">
          {tipAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Tip {tipPercent === -1 ? customTip + '%' : tipPercent + '%'}</span>
              <span className="text-green-400 font-mono">+${tipAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-end items-baseline gap-2">
            <span className="text-gray-400 text-xs">Total</span>
            <span className="text-4xl font-mono font-bold tracking-tight text-white drop-shadow">
              ${finalAmount}
            </span>
          </div>
        </div>
      </div>

      {/* Tip Calculator */}
      {parseFloat(finalAmount) > 0 && (
        <div className="bg-white px-4 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Add Tip</span>
            {tipPercent !== 0 && (
              <button
                onClick={() => { setTipPercent(0); setCustomTip(""); }}
                className="text-[10px] font-semibold text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {TIP_PRESETS.map(pct => (
              <button
                key={pct}
                onClick={() => { setTipPercent(pct); setCustomTip(""); }}
                className={`flex-1 min-w-[44px] py-1.5 text-xs font-bold rounded-md transition-all ${
                  tipPercent === pct && customTip === ""
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {pct === 0 ? 'No' : pct + '%'}
              </button>
            ))}
            <div className="flex-1 min-w-[52px] flex items-center">
              <input
                type="number"
                min="0"
                max="100"
                placeholder="Custom %"
                value={customTip}
                onFocus={() => setTipPercent(-1)}
                onChange={(e) => {
                  setTipPercent(-1);
                  setCustomTip(e.target.value);
                }}
                className="w-full px-2 py-1.5 text-[11px] font-bold text-center rounded-md bg-gray-50 text-gray-700 border border-gray-200 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Catalog Tab */}
      {activeTab === 'catalog' && (
        <div className="flex-1 flex flex-col min-h-0 bg-white">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="Search products or SKU..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-50 border border-gray-200 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-gray-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <p className="text-sm font-medium text-gray-700">No products found</p>
                <p className="text-xs text-gray-400 mt-1">Add products in Inventory first</p>
              </div>
            ) : (
              filteredProducts.map(p => {
                const inCart = cart.find(ci => ci.product.id === p.id);
                const price = (p.price_minor || 0) / 100;
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors group">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="text-sm font-semibold text-gray-900 truncate">{p.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400 font-mono">{p.sku || 'SKU-' + p.id.slice(0, 6)}</span>
                        <span className={`text-[10px] font-medium ${p.stock > 10 ? 'text-green-600' : p.stock > 0 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {p.stock} in stock
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {inCart ? (
                        <div className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 p-0.5 shadow-sm">
                          <button
                            onClick={() => removeFromCart(p.id)}
                            className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-100 transition-colors flex items-center justify-center font-bold"
                          >–</button>
                          <span className="text-sm font-bold text-gray-800 w-5 text-center">{inCart.qty}</span>
                          <button
                            onClick={() => addToCart(p)}
                            disabled={p.stock <= inCart.qty}
                            className="w-7 h-7 rounded-md text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                          >+</button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-bold text-gray-800 mr-1">${price.toFixed(2)}</span>
                          <button
                            onClick={() => addToCart(p)}
                            disabled={p.stock <= 0}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded-lg shadow-sm transition-all active:scale-95"
                          >
                            Add
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Keypad Tab */}
      {activeTab === 'keypad' && (
        <div className="flex-1 p-4 grid grid-cols-3 gap-3 content-start">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '.'].map((key) => (
            <button
              key={key}
              onClick={() => handleKeyPress(key)}
              className={`
                rounded-xl text-2xl font-bold shadow-sm transition-all active:scale-95 select-none
                ${key === 'C' 
                  ? 'bg-gradient-to-br from-red-50 to-red-100 text-red-600 hover:from-red-100 hover:to-red-200 border border-red-100' 
                  : 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-200 hover:border-gray-300'}
                flex items-center justify-center h-16
              `}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Cart Summary Bar (shown when cart has items) */}
      {cart.length > 0 && activeTab === 'catalog' && (
        <div className="bg-white border-t border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={clearCart}
              className="text-[11px] font-semibold text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Clear Cart
            </button>
            <span className="text-xs text-gray-500 font-medium">
              {cart.reduce((s,c)=>s+c.qty,0)} items · ${cartSubtotal.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 bg-white border-t border-gray-200 space-y-3 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">

        {/* NFC Reader Status Bar */}
        <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium
          ${nfcStatus === 'connected' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
            nfcStatus === 'disconnected' ? 'bg-gray-50 text-gray-400 border border-gray-200' :
            'bg-gray-50 text-gray-300 border border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${nfcStatus === 'connected' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}/>
            <span>
              {nfcStatus === 'connected' ? `📡 ${nfcReaderName || 'ACR122U'} — Ready` :
               nfcStatus === 'disconnected' ? '🔌 NFC Reader not connected' :
               'Checking NFC reader...'}
            </span>
          </div>
          {nfcStatus === 'connected' && (
            <button
              onClick={handleNfcTap}
              disabled={nfcReading}
              className="ml-2 px-2.5 py-1 bg-blue-600 text-white rounded-md text-xs font-bold hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-60"
            >
              {nfcReading ? '⏳ Reading...' : '📡 Tap Now'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleChargeClick}
            disabled={loading || parseFloat(finalAmount) === 0}
            className={`
              py-3.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all
              ${loading || parseFloat(finalAmount) === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:shadow-blue-500/30 active:scale-[0.98]'}
              flex items-center justify-center gap-2
            `}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            Charge ${finalAmount}
          </button>
          <button
            onClick={handleWalletPaymentClick}
            disabled={loading || parseFloat(finalAmount) === 0}
            className={`
              py-3.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all
              ${loading || parseFloat(finalAmount) === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 hover:shadow-emerald-500/30 active:scale-[0.98]'}
              flex items-center justify-center gap-2
            `}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>
            Wallet
          </button>
        </div>
        
        <button
          onClick={handleSyncWallets}
          disabled={loading}
          className="w-full py-2.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          Sync Offline Data
        </button>
      </div>

      {/* Card Entry Modal */}
      {showCardForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-5 text-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Payment</p>
                  <p className="text-2xl font-bold mt-0.5">${finalAmount}</p>
                </div>
                <button onClick={() => { setShowCardForm(false); setVoiceAuthCode(""); }} className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="w-full h-8 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-lg opacity-50"></div>
            </div>
            <div className="p-6 space-y-4">
              {/* NFC Tap Button */}
              <button
                onClick={handleNfcTap}
                disabled={nfcReading || nfcStatus === 'disconnected'}
                className={`w-full flex items-center justify-center gap-3 py-3.5 rounded-xl border-2 font-semibold text-sm transition-all
                  ${nfcStatus === 'connected'
                    ? 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 active:scale-[0.98]'
                    : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'}`}
              >
                <svg className={`w-6 h-6 ${nfcReading ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M8.5 8.5C9.5 7.5 10.7 7 12 7s2.5.5 3.5 1.5"/>
                  <path strokeLinecap="round" strokeOpacity="0.5" d="M6 6C7.7 4.3 9.7 3.5 12 3.5s4.3.8 6 2.5"/>
                  <circle cx="12" cy="14" r="1.5" fill="currentColor"/>
                  <path strokeLinecap="round" d="M10 11.5c.5-.8 1.2-1.5 2-1.5s1.5.7 2 1.5"/>
                </svg>
                {nfcReading ? '📡 Reading card...' :
                  nfcStatus === 'connected' ? '📡 Tap Card on ACR122U Reader' :
                  '🔌 NFC Reader Not Connected'}
              </button>

              {/* NFC card detected indicator */}
              {nfcCardData && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  <span>✅ Card detected</span>
                  {nfcCardData.uid && <span>· UID: {nfcCardData.uid}</span>}
                  {nfcCardData.aid && <span>· AID: {nfcCardData.aid}</span>}
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200"/>
                <span className="text-xs text-gray-400 font-medium">or enter manually</span>
                <div className="h-px flex-1 bg-gray-200"/>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Card Number</label>
                <input 
                  type="text" 
                  value={cardData.pan}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').substring(0, 16);
                    setCardData(prev => ({...prev, pan: val}));
                  }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-lg font-mono tracking-widest bg-gray-50/50"
                  placeholder="0000 0000 0000 0000"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Expiry</label>
                  <input
                    type="text"
                    value={cardData.expiry}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, '').substring(0, 4);
                      if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
                      setCardData(prev => ({...prev, expiry: val}));
                    }}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-center font-mono bg-gray-50/50"
                    placeholder="MM/YY"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CVV</label>
                  <input
                    type="password"
                    value={cardData.cvv}
                    onChange={(e) => setCardData(prev => ({...prev, cvv: e.target.value.replace(/\D/g, '').substring(0, 4)}))}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-center font-mono bg-gray-50/50"
                    placeholder="123"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Auth Code</label>
                <input
                  type="text"
                  value={voiceAuthCode}
                  onChange={(e) => setVoiceAuthCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 32))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-center font-mono tracking-widest font-bold bg-gray-50/50"
                  placeholder="Auth code"
                  autoComplete="off"
                />
              </div>
              <button 
                onClick={handleCharge}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-500/25 transition-transform active:scale-[0.98] mt-2 text-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Processing...
                  </span>
                ) : `Confirm Payment $${finalAmount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Payment Modal */}
      {showWalletForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5 text-white">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-emerald-200 uppercase tracking-wider">Wallet Payment</p>
                  <p className="text-2xl font-bold mt-0.5">${finalAmount}</p>
                </div>
                <button onClick={() => setShowWalletForm(false)} className="text-emerald-200 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Select Customer</label>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50 bg-gray-50/30">
                  {customers.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">
                      No customers yet
                    </div>
                  ) : (
                    customers.map((customer) => (
                      <button
                        key={customer.id}
                        onClick={() => selectCustomer(customer)}
                        className={`w-full text-left p-3 transition-colors ${selectedCustomer?.id === customer.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-white'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm">
                            {(customer.name?.trim() || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm truncate">{customer.name?.trim() || <span className="text-red-500 italic text-xs">(Unnamed)</span>}</div>
                            {customer.email && <div className="text-xs text-gray-500 truncate">{customer.email}</div>}
                            {customer.phone && <div className="text-xs text-gray-400 truncate">📞 {customer.phone}</div>}
                          </div>
                          {selectedCustomer?.id === customer.id && (
                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                              <svg width="12" height="12" fill="none" stroke="white" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                            </div>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selectedCustomer && (
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-100">
                  <div className="flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Available</p>
                      <p className="text-xl font-bold text-emerald-800 mt-0.5 truncate">
                        ${customerWalletBalance?.toFixed(2) ?? "—"}
                      </p>
                      <p className="text-xs text-emerald-700/80 mt-1">Balance available for this customer</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5v14a2 2 0 0 0 2 2h16v-5"/></svg>
                    </div>
                  </div>
                  {customerWalletBalance !== null && customerWalletBalance < parseFloat(finalAmount) && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-medium">
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Shortfall: ${(parseFloat(finalAmount) - customerWalletBalance).toFixed(2)}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleWalletPayment}
                disabled={loading || !selectedCustomer || (customerWalletBalance !== null && customerWalletBalance < parseFloat(finalAmount))}
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:from-gray-300 disabled:to-gray-400 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-500/20 disabled:shadow-none transition-transform active:scale-[0.98] text-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Processing...
                  </span>
                ) : selectedCustomer ? `Pay $${finalAmount} from Wallet` : 'Select a customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Transactions Drawer */}
      {showRecent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-fade-in" onClick={() => setShowRecent(false)}>
          <div 
            className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl flex flex-col animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white px-5 py-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">History</p>
                <p className="text-lg font-bold">Recent Transactions</p>
              </div>
              <button onClick={() => setShowRecent(false)} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recentTxns.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                    <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-gray-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No transactions yet</p>
                  <p className="text-xs text-gray-400 mt-1">Completed payments will appear here</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentTxns.map((txn, i) => (
                    <div key={txn.id || i} className="px-5 py-3.5 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            txn.status === 'APPROVED' ? 'bg-green-100 text-green-600' :
                            txn.status === 'DECLINED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                          }`}>
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {txn.status === 'APPROVED'
                                ? <polyline points="20 6 9 17 4 12"/>
                                : txn.status === 'DECLINED'
                                ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                                : <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>}
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                                txn.status === 'APPROVED' ? 'bg-green-500' :
                                txn.status === 'DECLINED' ? 'bg-red-500' : 'bg-amber-500'
                              }`}></span>
                              <span className="text-sm font-semibold text-gray-800 truncate">{txn.status}</span>
                              {txn.authMode && (
                                <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-100 px-1.5 py-0.5 rounded">
                                  {txn.authMode.replace('_', ' ')}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 truncate font-mono">
                              {new Date(txn.txnTimestamp).toLocaleString([], {hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'})}
                              {' · '}{txn.terminalId || 'TERMINAL'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-gray-900">${(txn.amountMinor/100).toFixed(2)}</p>
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">{txn.stan || txn.id?.slice(0, 6)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500 text-center">
              Showing last {recentTxns.length} transactions
            </div>
          </div>
        </div>
      )}
    </div>
  );
};