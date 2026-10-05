import { useState, useEffect, useCallback } from 'react';
import {
  chargePayment,
  fetchSettings,
  readAcr122uCard,
  getAcr122uStatus,
  getCustomers,
  getWalletBalance,
  topupWalletWithCard,
  saveOfflinePinSale,
  getOfflinePinSales,
  checkBackendHealth,
  type Customer,
} from '../lib/api';
import { generateLocalTxnId, generateStan } from '../lib/crypto';
import { processEMVOffline, syncEMVTransactions } from '../lib/emv/emv-pos-bridge';
import { useToast } from '../components/ui/toastContext';
import { CURRENCIES, getCurrency, getTerminalCurrency, setTerminalCurrency } from '../lib/currencies';

type PosProtocol = 'NORMAL' | '101.1' | '101.6' | '201.3';

interface TransactionRecord {
  localTxnId: string;
  stan: string;
  amount: number;
  cardLast4: string;
  entryMode: 'MANUAL' | 'NFC';
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  protocolVersion?: PosProtocol;
  channel?: 'ONLINE' | 'OFFLINE';
  settlementCode?: string;
  timestamp: number;
  error?: string;
}

const getReceiptOutcome = (transaction: TransactionRecord) => {
  if (transaction.status === 'FAILED') {
    return transaction.channel ? `${transaction.channel} · DECLINED` : 'DECLINED';
  }
  if (transaction.status === 'PENDING') {
    return transaction.channel ? `${transaction.channel} · PENDING` : 'PENDING';
  }
  if (transaction.status === 'SYNCED' && transaction.channel === 'ONLINE') {
    return 'ONLINE · PROVIDER APPROVED';
  }
  if (transaction.status === 'SYNCED' && transaction.channel === 'OFFLINE') {
    return 'OFFLINE · SYNCED';
  }
  return 'SYNCED · CHANNEL UNKNOWN';
};

export const POSPageSecure = () => {
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState(getTerminalCurrency());
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<TransactionRecord | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [offlinePinPendingCount, setOfflinePinPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cardEntryMode, setCardEntryMode] = useState<'MANUAL' | 'NFC'>('MANUAL');
  const [forceOffline, setForceOffline] = useState(false);
  const [terminalSettings, setTerminalSettings] = useState({
    offlineMode: false,
    manualEntry: false
  });
  const [nfcStatus, setNfcStatus] = useState({ enabled: false, connected: false, loading: true });
  const [merchantConfig, setMerchantConfig] = useState({
    merchantId: 'MRC-1001',
    terminalId: 'WEB-TERMINAL',
    secretKey: ''
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerWalletBalance, setCustomerWalletBalance] = useState<number | null>(null);

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
  const [voiceAuth, setVoiceAuth] = useState(false);
  const [voiceAuthCode, setVoiceAuthCode] = useState("");
  const [posProtocol, setPosProtocol] = useState<PosProtocol>('NORMAL');
  
  const { showToast } = useToast();

  const loadTransactions = useCallback(() => {
    const stored = localStorage.getItem('dashboard_transactions');
    if (stored) {
      const parsed = JSON.parse(stored);
      setTransactions(parsed);
      setPendingCount(parsed.filter((t: TransactionRecord) => t.status === 'PENDING').length);
    }
  }, []);

  const loadOfflinePinCount = useCallback(() => {
    try {
      const pending = getOfflinePinSales().filter(item => !item.synced);
      setOfflinePinPendingCount(pending.length);
    } catch {
      setOfflinePinPendingCount(0);
    }
  }, []);

  const loadPendingCounts = useCallback(() => {
    loadTransactions();
    loadOfflinePinCount();
  }, [loadTransactions, loadOfflinePinCount]);

  const loadCustomerContext = useCallback(async (customerId: string) => {
    try {
      const balance = await getWalletBalance(customerId);
      setCustomerWalletBalance(Number(balance?.balance ?? 0));
    } catch (error) {
      console.warn('Unable to load customer wallet details', error);
      setCustomerWalletBalance(null);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
      setSelectedCustomerId((current) => current || data[0]?.id || null);
    } catch (error) {
      console.warn('Unable to load customers for POS', error);
    }
  }, []);

  const loadMerchantConfig = async () => {
    try {
      const settings = await fetchSettings();
      if (settings && typeof settings === 'object') {
        const typedSettings = settings as {
          merchant_id?: string;
          terminal_id?: string;
          api_key?: string;
          merchant_name?: string;
          merchant_address?: string;
          merchant_phone?: string;
          support_email?: string;
          license_number?: string;
          tax_id?: string;
          terminal?: {
            offlineMode?: boolean;
            features?: { manualEntry?: boolean };
          };
          business?: {
            licenseNumber?: string;
            taxId?: string;
            tax_id?: string;
          };
        };

        const business = typedSettings.business;

        setMerchantConfig({
          merchantId: typedSettings.merchant_id || 'MRC-1001',
          terminalId: typedSettings.terminal_id || 'WEB-TERMINAL',
          secretKey: typedSettings.api_key || ''
        });
        setMerchantReceiptInfo({
          companyName: typedSettings.merchant_name || '',
          address: typedSettings.merchant_address || '',
          phone: typedSettings.merchant_phone || '',
          supportEmail: typedSettings.support_email || '',
          licenseNumber: typedSettings.license_number || business?.licenseNumber || '',
          taxId: typedSettings.tax_id || business?.taxId || business?.tax_id || '',
        });
        setTerminalSettings({
          offlineMode: typedSettings.terminal?.offlineMode ?? false,
          manualEntry: typedSettings.terminal?.features?.manualEntry ?? false
        });
      }
    } catch (error) {
      console.warn('Using default merchant config', error);
    }
  };

  const fetchNfcStatus = async () => {
    try {
      const status = await getAcr122uStatus();
      setNfcStatus({ enabled: !!status.enabled, connected: !!status.connected, loading: false });
    } catch (error) {
      console.warn('NFC status fetch failed', error);
      setNfcStatus({ enabled: false, connected: false, loading: false });
    }
  };

  // Load merchant config and pending transactions on mount
  useEffect(() => {
    loadMerchantConfig();
    loadPendingCounts();
    loadCustomers();

    const handleOnline = async () => {
      try { await checkBackendHealth(2500); setIsOnline(true); } catch { setIsOnline(false); }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic server health check — calls PUBLIC `/api/health` (no JWT required).
    // Eliminates confusing "401 Unauthorized: Missing token" errors the operator
    // was seeing when the UI was trying to validate "online status" via a
    // protected endpoint before the operator had logged in.
    void handleOnline();
    let cancelled = false;
    const h = window.setInterval(async () => {
      if (cancelled) return;
      try { await checkBackendHealth(2500); setIsOnline(true); } catch { setIsOnline(false); }
    }, 10_000);

    fetchNfcStatus();

    return () => {
      cancelled = true;
      window.clearInterval(h);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadCustomers, loadPendingCounts]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    loadCustomerContext(selectedCustomerId);
  }, [selectedCustomerId, loadCustomerContext]);

  const handleSyncPending = async () => {
    showToast('Syncing pending data...', 'info');
    let synced = 0;
    const errors: string[] = [];

    try {
      const emvResult = await syncEMVTransactions(
        merchantConfig.merchantId,
        merchantConfig.terminalId,
        merchantConfig.secretKey
      );
      if (emvResult.synced > 0) {
        synced += emvResult.synced;
      }
      if (emvResult.failed > 0) {
        errors.push(`EMV sync failed for ${emvResult.failed}`);
      }
      if (emvResult.settlementCode) {
        showToast(`Batch settlement code: ${emvResult.settlementCode}`, 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message || 'EMV sync failed');
    }

    loadPendingCounts();

    if (synced > 0) {
      showToast(`Synced ${synced} pending item(s)`, 'success');
    }
    if (errors.length > 0 && synced === 0) {
      showToast(errors.join('; '), 'error');
    }
  };

  const buildReceiptText = (txn: TransactionRecord) => {
    const dt = new Date(txn.timestamp);
    const statusLabel = txn.status === "SYNCED" && txn.channel === 'ONLINE'
      ? 'PROVIDER APPROVED'
      : txn.status;
    const entryMode = txn.entryMode || "MANUAL";
    const merchantId = merchantConfig.merchantId;
    const terminalId = merchantConfig.terminalId;
    const currencyCode = getCurrency(currency).code;

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
    line(`Protocol: ${txn.protocolVersion || "NOT RECORDED"}`);
    line(`Channel: ${txn.channel || "UNKNOWN"}`);
    line(`Txn ID: ${txn.localTxnId}`);
    line(`STAN: ${txn.stan}`);
    sep();
    line(`Card: **** **** **** ${txn.cardLast4}`);
    line(`Entry: ${entryMode}`);
    line(`Outcome: ${getReceiptOutcome(txn)}`);
    sep();
    line(`Amount: ${getCurrency(currency).symbol}${txn.amount.toFixed(getCurrency(currency).decimals)} ${currencyCode}`);
    line(`Status: ${statusLabel}`);
    if (txn.settlementCode) {
      if (txn.status === "SYNCED" && txn.channel === "ONLINE") {
        line(`Settlement: ${txn.settlementCode}`);
      } else if (txn.status === "PENDING") {
        line(`Reference: ${txn.settlementCode}`);
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
    const dec = getCurrency(currency).decimals;
    setAmount(prev => {
      if (key === 'C') return "0";
      if (key === '.' && dec === 0) return prev; // JPY/KWD no decimals
      if (prev === "0" && key !== '.') return key;
      if (key === '.' && prev.includes('.')) return prev;
      if (prev.includes('.')) {
        const [, d] = prev.split('.');
        if (d.length >= dec) return prev;
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
    
    if (posProtocol !== '101.1' && cardData.cvv.length < 3) {
      showToast(`CVV must be at least 3 digits for ${posProtocol === 'NORMAL' ? 'normal card transactions' : posProtocol}`, 'error');
      return false;
    }
    if (posProtocol !== 'NORMAL' && !voiceAuthCode.trim()) {
      showToast(`Protocol ${posProtocol} requires the customer-provided Authorization Code`, 'error');
      return false;
    }
    
    return true;
  };

  const handleChargeClick = () => {
    const amountVal = parseFloat(amount);
    if (!amountVal || amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    if (!terminalSettings.manualEntry) {
      showToast('Manual card entry is disabled in Terminal Settings', 'error');
      return;
    }
    setShowCardForm(true);
  };

  const handleReaderTap = async () => {
    setLoading(true);
    try {
      const amountForNfc = Math.round(parseFloat(amount || '0') * Math.pow(10, getCurrency(currency).decimals));
      const result = await readAcr122uCard(amountForNfc, currency);
      if (result?.card?.uid && result?.card?.emvReady) {
        showToast('Contactless EMV payment card detected. Enter any required card details and continue.', 'success');
        setCardEntryMode('NFC');
      } else if (result?.nfcDetected) {
        showToast(result.error || 'NFC device detected, but it is not readable as an EMV payment card.', 'warning');
      } else {
        showToast('No card detected by ACR122U reader', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message || 'Reader unavailable', 'warning');
      setCardEntryMode('MANUAL');
    } finally {
      setLoading(false);
    }
  };

  const handleCreditCustomerWallet = async () => {
    const amountVal = parseFloat(amount);
    if (!selectedCustomerId) {
      showToast('Select a customer before crediting their wallet', 'error');
      return;
    }
    if (amountVal <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    if (!validateCard()) {
      return;
    }

    if (!selectedCustomerId) {
      showToast('Select the customer wallet to receive captured funds', 'error');
      return;
    }

    setLoading(true);
    setShowCardForm(false);

    try {
      const cleanPan = cardData.pan.replace(/\s/g, '');
      const result = await topupWalletWithCard(
        selectedCustomerId,
        amountVal,
        cleanPan,
        cleanPan.length > 0 ? '*'.repeat(Math.max(0, cleanPan.length - 4)) + cleanPan.slice(-4) : undefined,
        cardData.expiry,
        cardData.cvv,
        undefined,
        posProtocol,
        posProtocol !== 'NORMAL' ? voiceAuthCode.trim() : undefined
      );
      await loadCustomerContext(selectedCustomerId);
      showToast(`Wallet credited. Auth ${result?.authCode || 'N/A'}`, 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message || 'Unable to credit customer wallet', 'error');
    } finally {
      setLoading(false);
      setAmount('0');
      setCardData({ pan: '', expiry: '', cvv: '' });
      setVoiceAuth(false);
      setVoiceAuthCode("");
    }
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

    if ((!isOnline || forceOffline) && !terminalSettings.offlineMode) {
      showToast('Offline processing is disabled in Terminal Settings', 'error');
      return;
    }

    setLoading(true);
    setShowCardForm(false);

    const selectedProtocol = posProtocol;
    const transactionChannel = isOnline && !forceOffline ? 'ONLINE' : 'OFFLINE';

    try {
      // Generate required IDs
      const localTxnId = generateLocalTxnId();
      const stan = generateStan();
      const amountMinor = Math.round(amountVal * Math.pow(10, getCurrency(currency).decimals));

      // Create transaction record
      const transaction: TransactionRecord = {
        localTxnId,
        stan,
        amount: amountVal,
        cardLast4: cardData.pan.slice(-4),
        entryMode: cardEntryMode,
        status: 'PENDING',
        protocolVersion: selectedProtocol,
        channel: transactionChannel,
        timestamp: Date.now()
      };

      // Decide whether to process online or offline
      if (transactionChannel === 'ONLINE') {
        // Online card payments must go through the configured processor. The
        // backend credits the internal vault only after processor approval.
        const result = await chargePayment(
          amountMinor,
          currency,
          merchantConfig.merchantId,
          {
            pan: cardData.pan.replace(/\s/g, ''),
            expiry: cardData.expiry,
            cvv: selectedProtocol === '101.1' ? undefined : cardData.cvv,
            customerId: selectedCustomerId || undefined,
            terminalId: merchantConfig.terminalId,
            stan,
            entryMode: selectedProtocol === '201.3' ? 'OFFLINE_201_3' : selectedProtocol === '101.1' ? 'VOICE_AUTH' : selectedProtocol === '101.6' ? '101.6' : cardEntryMode,
            authCode: selectedProtocol !== 'NORMAL' ? voiceAuthCode.trim() : undefined,
            protocolVersion: selectedProtocol,
          }
        );

        const processorStatus = String(result.status || '').toUpperCase();
        const actualChannel = result.channel === 'ONLINE' || result.channel === 'OFFLINE'
          ? result.channel
          : null;
        transaction.channel = actualChannel || transactionChannel;
        transaction.settlementCode = result.settlementId || result.paymentIntentId || result.authCode;

        if (processorStatus === 'APPROVED' && result.success === true && actualChannel === 'ONLINE') {
          transaction.status = 'SYNCED';
          showToast(
            `Payment Approved! ${transaction.settlementCode || 'Processor confirmed'}`,
            'success'
          );
          setLastTransaction(transaction);
          setShowReceipt(true);
        } else if (
          processorStatus === 'PENDING' ||
          (processorStatus === 'APPROVED' && actualChannel !== 'ONLINE') ||
          (!processorStatus && result.success === true)
        ) {
          transaction.status = 'PENDING';
          showToast(
            actualChannel === 'OFFLINE' && processorStatus === 'APPROVED'
              ? 'Offline authorization recorded; pending settlement. This is not provider approval.'
              : result.reason || result.error || 'Payment is pending provider confirmation.',
            'warning'
          );
          setLastTransaction(transaction);
          setShowReceipt(true);
        } else {
          transaction.status = 'FAILED';
          transaction.error = result.error || result.reason || 'Payment failed';
          showToast(transaction.error || 'Payment failed', 'error');
        }
      } else {
        // PROCESS OFFLINE using real EMV engine
        const emvResult = await processEMVOffline(
          { pan: cardData.pan.replace(/\s/g, ''), expiry: cardData.expiry, cvv: voiceAuth ? '' : cardData.cvv },
          amountVal,
          currency,
          merchantConfig.terminalId,
          undefined,
          undefined,
          selectedCustomerId
        );

        if (emvResult.approved) {
          transaction.channel = 'OFFLINE';
          transaction.status = 'PENDING';
          transaction.settlementCode = voiceAuthCode.trim();
          showToast(`Offline transaction queued — pending provider capture (STAN: ${emvResult.stan}).`, 'warning');
          saveOfflinePinSale({
            merchantId: merchantConfig.merchantId,
            customerId: selectedCustomerId,
            terminalId: merchantConfig.terminalId,
            amountMinor,
            currency,
            panMasked: `****${cardData.pan.slice(-4)}`,
            txnType: 'SALE',
            authMode: 'OFFLINE_APPROVED',
            entryMode: cardEntryMode,
            cardBrand: cardData.pan.startsWith('4') ? 'visa' : cardData.pan.startsWith('5') ? 'mastercard' : 'unknown',
            pinVerified: false,
            stan,
            authCode: voiceAuthCode.trim(),
            emvData: {
              cryptogram: emvResult.cryptogram,
              atc: emvResult.atc,
              tvr: emvResult.tvr,
              tsi: emvResult.tsi,
            },
            localTxnId,
          });
          loadOfflinePinCount();
          setLastTransaction(transaction);
          setShowReceipt(true);
        } else if (emvResult.requiresOnline) {
          transaction.channel = 'OFFLINE';
          transaction.status = 'PENDING';
          transaction.settlementCode = voiceAuthCode.trim();
          transaction.error = 'Requires online auth — will sync when connected';
          showToast('Queued for online auth', 'warning');
          saveOfflinePinSale({
            merchantId: merchantConfig.merchantId,
            customerId: selectedCustomerId,
            terminalId: merchantConfig.terminalId,
            amountMinor,
            currency,
            panMasked: `****${cardData.pan.slice(-4)}`,
            txnType: 'SALE',
            authMode: 'OFFLINE_PENDING',
            entryMode: cardEntryMode,
            cardBrand: cardData.pan.startsWith('4') ? 'visa' : cardData.pan.startsWith('5') ? 'mastercard' : 'unknown',
            pinVerified: false,
            stan,
            authCode: voiceAuthCode.trim(),
            emvData: {
              cryptogram: emvResult.cryptogram,
              atc: emvResult.atc,
              tvr: emvResult.tvr,
              tsi: emvResult.tsi,
            },
            localTxnId,
          });
          loadOfflinePinCount();
          setLastTransaction(transaction);
          setShowReceipt(true);
        } else {
          transaction.status = 'FAILED';
          transaction.error = emvResult.reason || 'Card declined';
          showToast(`Declined: ${emvResult.reason}`, 'error');
        }
      }

      // Save to history
      const updated = [...transactions, transaction];
      saveTransactions(updated);

    } catch (error: unknown) {
      // Create failed transaction record
      const failedTxn: TransactionRecord = {
        localTxnId: generateLocalTxnId(),
        stan: generateStan(),
        amount: amountVal,
        cardLast4: cardData.pan.slice(-4),
        entryMode: cardEntryMode,
        status: 'FAILED',
        protocolVersion: selectedProtocol,
        channel: transactionChannel,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
      
      const updated = [...transactions, failedTxn];
      saveTransactions(updated);
      
      const message = error instanceof Error ? error.message : String(error);
      showToast(message || 'Payment failed', 'error');
    } finally {
      setLoading(false);
      setAmount("0");
      setCardData({ pan: "", expiry: "", cvv: "" });
      setVoiceAuth(false);
      setVoiceAuthCode("");
    }
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
          <h2 className="text-xl font-bold">Payment Processor</h2>
          <p className="text-xs opacity-80">All live card payments are collected by this processor · {merchantConfig.merchantId} · {merchantConfig.terminalId}</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Status and Toggle */}
          <div 
            onClick={() => terminalSettings.offlineMode && setForceOffline(!forceOffline)}
            title={!terminalSettings.offlineMode ? "Offline processing is disabled in Terminal Settings" : forceOffline ? "Click to resume automatic status" : "Click to force offline mode"}
            className={`flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full transition-colors ${terminalSettings.offlineMode ? 'cursor-pointer hover:bg-white/20' : 'cursor-not-allowed opacity-60'}`}
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
              {!terminalSettings.offlineMode ? 'OFFLINE DISABLED' : forceOffline ? 'FORCED OFFLINE' : (isOnline ? 'ONLINE' : 'OFFLINE')}
            </span>
            <div className={`w-8 h-4 rounded-full relative transition-colors ${forceOffline ? 'bg-red-500' : 'bg-green-500'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${forceOffline ? 'left-4.5' : 'left-0.5'}`}></div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-bold">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${nfcStatus.enabled ? 'bg-green-400' : 'bg-red-400'}`}></span>
            <span>{nfcStatus.loading ? 'Checking NFC...' : nfcStatus.enabled ? (nfcStatus.connected ? 'NFC Ready' : 'NFC Available') : 'NFC Disabled'}</span>
          </div>
        </div>
      </div>

      <div className="mx-6 mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>Processor-only live collection:</strong> online transactions are sent to the internal processor charge endpoint.
        Offline mode is available only for approved offline workflows and does not represent a live collection.
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: POS Keypad */}
        <div className="flex-1 flex flex-col p-6">
          {/* Amount Display */}
          <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-400 text-sm">Amount Due</span>
              {/* Currency Picker */}
              <button
                onClick={() => setShowCurrencyPicker(true)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-sm font-bold text-gray-700 transition-colors"
              >
                <span>{getCurrency(currency).flag}</span>
                <span>{currency}</span>
                <span className="text-gray-400 text-xs">▼</span>
              </button>
            </div>
            <div className="text-5xl font-mono font-bold text-gray-800 text-right">
              {getCurrency(currency).symbol}{amount}
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
              ${loading || parseFloat(amount) === 0 || !terminalSettings.manualEntry
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'}
            `}
          >
            {loading ? 'Processing...' : terminalSettings.manualEntry ? `Charge ${getCurrency(currency).symbol}${amount}` : 'Manual Entry Disabled'}
          </button>
        </div>

        {/* Right: Transaction History */}
        <div className="w-80 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <h3 className="font-bold text-gray-700 mb-4">Today's Transactions</h3>
          
          {(pendingCount > 0 || offlinePinPendingCount > 0) && (
            <div className="bg-amber-100 text-amber-800 px-3 py-2 rounded-lg mb-4 text-sm">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    ⚠ {pendingCount} EMV pending sync{pendingCount !== 1 ? 's' : ''}
                    {offlinePinPendingCount > 0 ? ` · ${offlinePinPendingCount} offline PIN uploads pending` : ''}
                  </span>
                  <button
                    onClick={handleSyncPending}
                    className="text-xs font-bold bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700"
                  >
                    Sync ↑
                  </button>
                </div>
                {!isOnline && (
                  <div className="text-xxs text-amber-700">Connect to the network to sync pending offline transactions.</div>
                )}
              </div>
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
                    <p className="font-bold">{getCurrency(currency).symbol}{txn.amount.toFixed(getCurrency(currency).decimals)}</p>
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
                onClick={() => { setShowCardForm(false); setVoiceAuth(false); setVoiceAuthCode(""); }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Use NFC tap or manual entry</p>
                  <p className="text-xs text-gray-500">Tap a card on the ACR122U reader if available.</p>
                </div>
                <button
                  onClick={handleReaderTap}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? 'Waiting...' : 'Tap NFC Card'}
                </button>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-sm text-blue-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Customer wallet credit</p>
                    <p className="text-xs text-blue-700">Select a customer to credit their wallet from this card.</p>
                  </div>
                  <select
                    value={selectedCustomerId || ''}
                    onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                  >
                    {customers.length === 0 ? (
                      <option value="">No customers yet</option>
                    ) : (
                      customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name?.trim() || '(Unnamed Customer)'}</option>
                      ))
                    )}
                  </select>
                </div>
                {selectedCustomerId && (
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-blue-700">
                    <span className="font-semibold">Available: ${((customerWalletBalance ?? 0).toFixed(2))}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                  Card Number
                </label>
                <input 
                  type="text" 
                  value={cardData.pan}
                  onChange={(e) => {
                    const formatted = formatCardDisplay(e.target.value);
                    setCardData(prev => ({...prev, pan: formatted}));
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg font-mono"
                  placeholder="0000 0000 0000 0000"
                  maxLength={19}
                />
              </div>
              {/* ── Protocol Selector: 101.1 | 101.6 | 201.3 ── */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Auth Protocol</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([['NORMAL','💳','Normal'],['101.1','📞','Voice Auth'],['101.6','💳','EMV Chip'],['201.3','🔒','Offline Batch']] as const).map(([proto, icon, label]) => (
                    <button
                      key={proto}
                      type="button"
                      onClick={() => {
                        setPosProtocol(proto);
                        setVoiceAuth(proto === '101.1');
                        if (proto !== '101.1') setVoiceAuthCode('');
                        if (proto !== '101.6') setCardData(prev => ({...prev, cvv: ''}));
                      }}
                      className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border-2 text-xs font-bold transition-all
                        ${posProtocol === proto
                          ? proto === '201.3' ? 'border-purple-500 bg-purple-50 text-purple-800'
                          : proto === '101.1' ? 'border-amber-400 bg-amber-50 text-amber-800'
                          : proto === 'NORMAL' ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300'}`}
                    >
                      <span className="text-base">{icon}</span>
                      <span className="font-mono">{proto}</span>
                      <span className="font-normal text-[9px] opacity-70 leading-none">{label}</span>
                    </button>
                  ))}
                </div>
                {posProtocol === '101.1' && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                    📞 <strong>101.1 Voice Auth</strong> — Enter the verbal auth code from the issuer. CVV not required.
                  </div>
                )}
                {posProtocol === 'NORMAL' && (
                  <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-800">
                    💳 <strong>Normal transaction</strong> — Enter the card number, expiry, and CVV for processor authorization.
                  </div>
                )}
                {posProtocol === '101.6' && (
                  <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                    💳 <strong>101.6 EMV Chip</strong> — Card present, chip read. CVV required.
                  </div>
                )}
                {posProtocol === '201.3' && (
                  <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-800">
                    🔒 <strong>201.3 Offline Batch</strong> — Enter CVV <em>and</em> the pre-auth code from an existing transaction. Wrong code = declined.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Expiry (MM/YY)</label>
                  <input
                    type="text"
                    value={cardData.expiry}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, '').substring(0, 4);
                      if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
                      setCardData(prev => ({...prev, expiry: val}));
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center"
                    placeholder="MM/YY"
                  />
                </div>
                {/* CVV is required for normal, 101.6, and 201.3 transactions. */}
                {posProtocol !== '101.1' && (
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${posProtocol === '201.3' ? 'text-purple-600' : 'text-gray-500'}`}>CVV</label>
                    <input
                      type="password"
                      value={cardData.cvv}
                      onChange={(e) => setCardData(prev => ({...prev, cvv: e.target.value.replace(/\D/g, '').substring(0, 4)}))}
                      className={`w-full px-4 py-2 border-2 rounded-lg outline-none text-center ${posProtocol === '201.3' ? 'border-purple-300 focus:border-purple-500 bg-purple-50/30' : 'border-gray-300 focus:ring-2 focus:ring-blue-500'}`}
                      placeholder="123"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                    />
                  </div>
                )}
                {/* Auth Code — customer-provided for every explicit protocol */}
                {posProtocol !== 'NORMAL' && (
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-1 ${posProtocol === '201.3' ? 'text-purple-600' : 'text-amber-600'}`}>
                      Auth Code {posProtocol === '201.3' ? '*' : ''}
                    </label>
                    <input
                      type="text"
                      value={voiceAuthCode}
                      onChange={(e) => setVoiceAuthCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 32))}
                      className={`w-full px-4 py-2 border-2 rounded-lg outline-none text-center font-mono tracking-widest font-bold
                        ${posProtocol === '201.3'
                          ? 'border-purple-300 focus:border-purple-500 bg-purple-50 text-purple-900'
                          : 'border-amber-300 focus:border-amber-500 bg-amber-50 text-amber-900'}`}
                      placeholder="Enter customer auth code"
                      autoFocus={posProtocol === '101.1'}
                    />
                    <p className="text-[10px] text-gray-600 mt-0.5">Provided by the customer; do not use a generated or previous code.</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 mt-2">
                <button 
                  onClick={handleCharge}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-[0.98]"
                >
                  {loading ? 'Processing...' : `Pay ${getCurrency(currency).symbol}${amount}`}
                </button>
                <button 
                  onClick={handleCreditCustomerWallet}
                  disabled={loading || !selectedCustomerId}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow-md transition-transform active:scale-[0.98] disabled:bg-gray-300"
                >
                  {loading ? 'Processing...' : `Credit Wallet`}
                </button>
              </div>
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
                  <div className="text-xs font-semibold tracking-widest uppercase text-white/70">PRIME · ICICI VAULT</div>
                  <div className="text-lg font-extrabold tracking-tight">Receipt</div>
                  <div className="text-[11px] text-white/90 mt-1 font-semibold">
                    {merchantReceiptInfo.companyName || "Company Name"}
                  </div>
                  <div className="text-[11px] text-white/70 mt-1">Merchant ID: {merchantConfig.merchantId}</div>
                  <div className="text-[11px] text-white/70">Terminal ID: {merchantConfig.terminalId}</div>
                  <div className="text-[11px] text-white/70">Channel: {lastTransaction.channel || "Unknown"}</div>
                </div>
                <div className={`max-w-[150px] px-2.5 py-1 rounded-full text-[11px] font-bold text-center ${
                  lastTransaction.status === "FAILED"
                    ? "bg-red-500/20 text-red-200 ring-1 ring-red-400/30"
                    : lastTransaction.status === "PENDING"
                      ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30"
                      : lastTransaction.status === "SYNCED" && lastTransaction.channel === "ONLINE"
                        ? "bg-green-500/20 text-green-200 ring-1 ring-green-400/30"
                        : "bg-white/15 text-white ring-1 ring-white/30"
                }`}>
                  {getReceiptOutcome(lastTransaction)}
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
                  <div className="text-3xl font-extrabold tracking-tight text-gray-900">{getCurrency(currency).symbol}{lastTransaction.amount.toFixed(getCurrency(currency).decimals)}</div>
                  <div className="text-[11px] text-gray-500 mt-1">Currency: {currency}</div>
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
                    <span className="text-gray-500">Protocol</span>
                    <span className="font-medium text-gray-900">{lastTransaction.protocolVersion || 'Not recorded'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Card</span>
                    <span className="font-mono text-gray-900">**** **** **** {lastTransaction.cardLast4}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Entry Mode</span>
                    <span className="font-medium text-gray-900">{lastTransaction.entryMode || 'MANUAL'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Outcome</span>
                    <span className="font-semibold text-gray-900 text-right">{getReceiptOutcome(lastTransaction)}</span>
                  </div>
                </div>

                {lastTransaction.settlementCode && (
                  <div className="p-4 border-t border-gray-100 bg-amber-50">
                    <div className="text-[11px] text-amber-800 font-semibold uppercase tracking-widest">
                      {lastTransaction.status === "SYNCED" && lastTransaction.channel === "ONLINE" ? "Settlement Code" : "Transaction Reference"}
                    </div>
                    <div className="mt-1 text-2xl font-mono font-extrabold tracking-wider text-amber-900 break-all">
                      {lastTransaction.settlementCode}
                    </div>
                    <div className="text-[11px] text-amber-800 mt-1">
                      {lastTransaction.status === "SYNCED" && lastTransaction.channel === "ONLINE"
                        ? "Save this code for reconciliation."
                        : lastTransaction.status === "PENDING" && lastTransaction.channel === "OFFLINE"
                          ? "Offline transaction is pending sync or settlement; it has not been provider-approved."
                          : lastTransaction.status === "PENDING"
                            ? "Submitted online and awaiting provider confirmation; it is not approved yet."
                            : "Keep this reference for reconciliation."}
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
              <button
                onClick={() => {
                  const blob = new Blob([buildReceiptText(lastTransaction)], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `receipt-${lastTransaction.localTxnId}.txt`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
                className="mt-3 w-full py-2.5 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100"
              >
                Download Thermal Receipt
              </button>
              <div className="mt-3 text-center text-[11px] text-gray-500">
                PRIME POS · ICICI Vault
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Currency Picker Modal */}
      {showCurrencyPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">Select Currency</h3>
              <button onClick={() => setShowCurrencyPicker(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {CURRENCIES.map(c => (
                <button
                  key={c.code}
                  onClick={() => {
                    setCurrency(c.code);
                    setTerminalCurrency(c.code);
                    setAmount("0");
                    setShowCurrencyPicker(false);
                  }}
                  className={`w-full flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 ${currency === c.code ? 'bg-blue-50' : ''}`}
                >
                  <span className="text-2xl">{c.flag}</span>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-800">{c.code} <span className="text-gray-400 font-normal text-sm">— {c.name}</span></div>
                    <div className="text-xs text-gray-400">{c.countryName}</div>
                  </div>
                  <span className="text-gray-500 font-mono font-bold">{c.symbol}</span>
                  {currency === c.code && <span className="text-blue-600 font-bold">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default POSPageSecure;