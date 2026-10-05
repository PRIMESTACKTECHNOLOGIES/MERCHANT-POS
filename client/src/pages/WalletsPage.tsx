import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import './WalletsPage.css';
import {
  getCustomers, createCustomer, updateCustomerKYC,
  fetchSettings,
  getWalletBalance, getWalletTransactions, topupWalletWithCard, debitWallet,
  walletTransfer,
  sendToHotWallet,
  getBankAccounts, addBankAccount, bankPayout, getBankPayouts,
  getCryptoWallets, getCryptoPrice, buyCryptoWithWallet, sellCrypto, getCryptoTransactions, withdrawCrypto,
  getMerchantBalance, getMerchantTransactions, buyCryptoWithMerchant, merchantToCustomerTransfer,
  merchantCryptoPayout, createVirtualAccount, listVirtualAccounts,
  getMerchantBankAccounts, getMerchantPayouts, merchantBankPayout,
  approveMerchantPayout, rejectMerchantPayout,
  downloadPayoutReceipt,
  transakSendUserOtp, transakVerifyUserOtp, transakGetUserLimits, transakGetUserDetails, transakRefreshUserAccessToken, transakLogoutUser, transakOnboardUser, transakVerifyWalletAddress,
  checkBackendHealth,
  type Customer, type WalletBalance, type WalletTransaction,
  type BankAccount, type BankPayout,
  type CryptoWallet, type CryptoTransaction, type MerchantWallet, type MerchantWalletTransaction, type BankTransferTransaction,
  type MerchantBankAccount, type MerchantPayout,
} from "../lib/api";
import { resolveApiBaseUrl } from "../lib/backendUrl";
import { useNotifications } from "../contexts/useNotifications";
import "../styles/wallet-codepen-theme.css";
import {
  enqueue, cacheBalance, getCachedBalance, applyLocalBalance, pendingCount as offlinePending
} from "../lib/offline-queue";
import { TransakWidgetModal, type TransakFlow } from "../components/TransakWidgetModal";

type Tab = 'wallet' | 'bank' | 'crypto';
type Modal =
  | 'create-customer' | 'topup' | 'debit' | 'transfer'
  | 'add-bank' | 'bank-payout'
  | 'buy-crypto' | 'sell-crypto' | 'withdraw-crypto' | 'merchant-buy'
  | 'merchant-to-customer' | 'hot-wallet-payout' | 'virtual-account' | 'send-to-hot-wallet'
  | 'merchant-bank-payout' | 'merchant-approve-payout' | 'merchant-reject-payout' | null;

const COINS = ['BTC','ETH','USDT','SOL','DOGE','BNB','XRP','ADA','AVAX','LINK','MATIC'];
const COIN_ICONS: Record<string,string> = {
  BTC:'btc', ETH:'eth', USDT:'usdt', SOL:'sol', DOGE:'doge',
  BNB:'bnb', XRP:'xrp', ADA:'ada', AVAX:'avax', LINK:'link', MATIC:'matic'
};
// Helper: render coin logo — image if available, else fallback emoji
const COIN_FALLBACK: Record<string,string> = {
  BTC:'\u20BF', ETH:'\u039E', USDT:'\u20AE', SOL:'\u25CE', DOGE:'D',
  BNB:'\uD83D\uDFE1', XRP:'\u25C8', ADA:'\u20B3', AVAX:'\uD83D\uDD3A', LINK:'\u2B21', MATIC:'\uD83D\uDFE3'
};
function CoinLogo({coin,size=24}:{coin:string;size?:number}) {
  const name = COIN_ICONS[coin];
  if (!name) return <span style={{fontSize:size*0.75}}>{COIN_FALLBACK[coin]||'\uD83E\uDE99'}</span>;
  return <img src={`/coins/${name}.png`} alt={coin} width={size} height={size} style={{objectFit:'contain',borderRadius:'50%'}} onError={(e)=>{(e.target as HTMLImageElement).style.display='none';}} />;
}
const NETWORK_OPTIONS: Record<string, string[]> = {
  BTC: ['bitcoin', 'lightning'],
  ETH: ['ethereum', 'arbitrum', 'optimism'],
  USDT: ['tron', 'bsc', 'polygon', 'ethereum', 'solana'],
  SOL: ['solana', 'spl'],
  DOGE: ['dogecoin'],
  BNB: ['bsc'],
  XRP: ['ripple'],
  ADA: ['cardano'],
  AVAX: ['avalanche'],
  LINK: ['ethereum'],
  MATIC: ['polygon'],
};

const DIRECT_RAIL_NETWORKS: Record<string, string[]> = {
  USDT: ['tron', 'bsc', 'polygon'],
};
const getNetworkOptions = (coin: string) => NETWORK_OPTIONS[coin] || ['mainnet'];

function sourceLabel(raw: string | null | undefined): string {
  const map: Record<string,string> = {
    manual:'Admin Credit', admin_credit:'Admin Credit', admin_debit:'Admin Debit',
    offline_sync:'POS Offline Sync', offline_pos:'POS Sale', topup_card:'Card Top-Up',
    bank_payout:'Bank Payout', crypto_purchase:'Crypto Purchase', crypto_sale:'Crypto Sale',
    wallet_transfer:'Wallet Transfer', virtual_card_topup:'Virtual Card Top-Up',
  };
  if (!raw) return 'Wallet Activity';
  if (map[raw]) return map[raw];
  return raw.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

// â”€â”€ Stable module-level components (no re-mount on parent re-render) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FormInput: React.FC<{
  f: Record<string,string>; setF: React.Dispatch<React.SetStateAction<Record<string,string>>>;
  name: string; placeholder: string; type?: string; required?: boolean;
}> = ({ f, setF, name, placeholder, type='text', required=false }) => (
  <input type={type} placeholder={placeholder} required={required} autoComplete="off"
    value={f[name]||''} onChange={e => setF(p => ({...p,[name]:e.target.value}))}
    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition" />
);

const ModalShell: React.FC<{
  title: string; onConfirm:()=>void; confirmLabel?:string; confirmColor?:string;
  onClose:()=>void; busy:boolean; children: React.ReactNode;
}> = ({ title, onConfirm, confirmLabel='Confirm', confirmColor='bg-blue-600 hover:bg-blue-700', onClose, busy, children }) => (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e=>e.stopPropagation()}>
      <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl" type="button">âœ•</button>
      </div>
      <div className="p-6 space-y-3">{children}</div>
      <div className="px-6 pb-6 flex gap-3">
        <button onClick={onClose} disabled={busy} type="button"
          className="flex-1 py-3 rounded-xl border border-gray-200 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
        <button onClick={onConfirm} disabled={busy} type="button"
          className={`flex-1 py-3 rounded-xl font-medium text-white ${confirmColor} disabled:opacity-50`}>
          {busy ? 'â³ Processing...' : confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

const formatCardNumber = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
};

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

const cleanCardNumber = (value: string) => value.replace(/\D/g, '');

export const WalletsPage = () => {
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('wallet');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedOps, setQueuedOps] = useState(offlinePending());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selId, setSelId] = useState<string|null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [loadingCust, setLoadingCust] = useState(true);
  const [balance, setBalance] = useState<WalletBalance>({ balance:0, currency:'USD' });
  const [walletTxns, setWalletTxns] = useState<WalletTransaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankPayouts, setBankPayouts] = useState<BankPayout[]>([]);
  const [selBank, setSelBank] = useState('');
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [cryptoTxns, setCryptoTxns] = useState<CryptoTransaction[]>([]);
  const [merchantWallet, setMerchantWallet] = useState<MerchantWallet | null>(null);
  const [merchantTxns, setMerchantTxns] = useState<MerchantWalletTransaction[]>([]);
  const [merchantBankAccounts, setMerchantBankAccounts] = useState<MerchantBankAccount[]>([]);
  const [merchantPayouts, setMerchantPayouts] = useState<MerchantPayout[]>([]);
  const [selMerchantBank, setSelMerchantBank] = useState<string>('');
  const [selPayout, setSelPayout] = useState<MerchantPayout | null>(null);
  const [virtualAccounts, setVirtualAccounts] = useState<BankTransferTransaction[]>([]);
  const [selCoin, setSelCoin] = useState('BTC');
  const [selectedNetwork, setSelectedNetwork] = useState('bitcoin');
  const [coinPrice, setCoinPrice] = useState(0);
  const DEFAULT_MERCHANT_ID = 'MRC-1001';
  const [f, setF] = useState<Record<string,string>>({ merchantId: DEFAULT_MERCHANT_ID });
  const [coinPriceMap, setCoinPriceMap] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    COINS.forEach(c => { map[c] = 0; });
    return map;
  });
  const selectedNetworkMap: Record<string, string> = {};
  COINS.forEach(c => { selectedNetworkMap[c] = getNetworkOptions(c)[0]; });
  const sel = customers.find(c => c.id === selId);

  const [transakOpen, setTransakOpen] = useState(false);
  const [transakFlow, setTransakFlow] = useState<TransakFlow>('BUY');
  const [transakPresets, setTransakPresets] = useState<{
    defaultCryptoCurrency: string;
    defaultNetwork?: string;
    defaultFiatAmount?: number;
    defaultFiatCurrency: string;
    partnerCustomerId?: string;
    walletCode?: string;
    walletAddress?: string;
  }>({
    defaultCryptoCurrency: 'USDT',
    defaultFiatCurrency: 'USD',
  });

  const openTransak = (
    flow: TransakFlow,
    opts?: Partial<typeof transakPresets>
  ) => {
    setTransakPresets({
      defaultCryptoCurrency: opts?.defaultCryptoCurrency || selCoin || 'USDT',
      defaultNetwork: opts?.defaultNetwork || selectedNetwork,
      defaultFiatAmount: opts?.defaultFiatAmount,
      defaultFiatCurrency: opts?.defaultFiatCurrency || balance.currency || 'USD',
      partnerCustomerId: sel?.id ? sel.id : undefined,
      walletCode: sel?.wallet_code ? sel.wallet_code : undefined,
      walletAddress: opts?.walletAddress,
    });
    setTransakFlow(flow);
    setTransakOpen(true);
  };

  const handleTransakOrderSuccessful = async (order: any) => {
    const oid = order?.id || order?.orderId || 'n/a';
    const fiat = typeof order?.fiatAmount === 'number' ? order.fiatAmount : 0;
    const cur = order?.fiatCurrency || 'USD';
    const coin = order?.cryptoCurrency || transakPresets.defaultCryptoCurrency;
    const qty = typeof order?.cryptoAmount === 'number' ? order.cryptoAmount : 0;
    addNotification(
      'Transak Order Successful',
      `Order ${oid}\nPaid ${cur} ${fiat.toFixed(2)}\nReceived ${qty} ${coin}${order?.network ? ` on ${order.network}` : ''}\nRefreshing balances now.`,
      'success'
    );
    try {
      await Promise.all([refreshWallet(), refreshCrypto()]);
      if (f.merchantId) await refreshMerchantWallet(f.merchantId);
    } catch { /* ignore */ }
  };

  const handleTransakOrderFailed = (order: any) => {
    addNotification(
      'Transak Order Failed',
      order?.statusMessage || order?.errorMessage || `Order ${order?.id || 'n/a'} failed. Please retry or check Transak dashboard.`,
      'error'
    );
  };

  const refreshMerchantWallet = async (merchantIdOverride?: string) => {
    const targetMerchantId = merchantIdOverride || f.merchantId || '';
    if (!targetMerchantId) {
      setMerchantWallet(null);
      setMerchantTxns([]);
      return;
    }

    try {
      const [wallet, txns] = await Promise.all([
        getMerchantBalance(targetMerchantId),
        getMerchantTransactions(targetMerchantId),
      ]);
      setMerchantWallet(wallet);
      setMerchantTxns(txns);
    } catch (error) {
      console.warn('[Merchant wallet] refresh failed', error);
      setMerchantWallet(null);
      setMerchantTxns([]);
    } finally {
    }
  };

  useEffect(() => {
    const up = async () => {
      try { await checkBackendHealth(2500); setIsOnline(true); } catch { setIsOnline(false); }
      setQueuedOps(offlinePending());
    };
    const dn = () => setIsOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', dn);

    // ══ Periodic BACKEND HEALTH CHECK EVERY 10s ══
    // This uses the PUBLIC `/api/health` endpoint (NO JWT REQUIRED), so even if
    // the user is not logged in, the "online indicator" dot in the UI will show
    // GREEN if server is alive / RED if server is down.  This eliminates the
    // confusing 401 {"error":"Unauthorized: Missing token"} error that was
    // appearing previously because the UI tried pinging protected endpoints
    // before login to check server health.
    void up();
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      try { await checkBackendHealth(2500); setIsOnline(true); } catch { setIsOnline(false); }
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', up); window.removeEventListener('offline', dn);
    };
  }, []);

  useEffect(() => {
    if (!selId) return;
    const socket = io(resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin }), {
      path: "/socket.io",
      query: { customerId: selId },
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("[WS] connected", socket.id);
    });

    socket.on("wallet.refresh", async () => {
      console.log("[WS] wallet.refresh received for", selId);
      try {
        const [bal, wt] = await Promise.all([getWalletBalance(selId), getWalletTransactions(selId)]);
        setBalance(bal);
        setWalletTxns(wt);
        cacheBalance(selId, Number(bal.balance), bal.currency);
      } catch (error) {
        console.warn("[WS] wallet.refresh failed", error);
      }
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [selId]);

  useEffect(() => {
    getCustomers().then(d => {
      setCustomers(d);
      if (d.length > 0) setSelId(d[0].id);
      setLoadingCust(false);
    }).catch(() => setLoadingCust(false));
    // also fetch settings to get merchant id for merchant buys
    fetchSettings().then(s => {
      const merchantId = s?.merchant_id || DEFAULT_MERCHANT_ID;
      setF(p => ({ ...p, merchantId }));
      void refreshMerchantWallet(merchantId);
    }).catch(() => {
      setF(p => ({ ...p, merchantId: DEFAULT_MERCHANT_ID }));
      void refreshMerchantWallet(DEFAULT_MERCHANT_ID).catch(()=>{});
    });
  }, []);

  useEffect(() => {
    const effectiveMerchantId = f.merchantId?.trim() || DEFAULT_MERCHANT_ID;
    if (!f.merchantId) {
      setF(p => ({ ...p, merchantId: effectiveMerchantId }));
    }
    void refreshMerchantWallet(effectiveMerchantId);
    listVirtualAccounts(effectiveMerchantId).then(result => setVirtualAccounts(result.transactions || [])).catch(() => setVirtualAccounts([]));
    getMerchantBankAccounts(effectiveMerchantId).then(accounts => {
      setMerchantBankAccounts(accounts);
      if (accounts.length > 0) {
        const def = accounts.find(a => Number(a.is_default) === 1) || accounts[0];
        setSelMerchantBank(def.id);
      }
    }).catch(() => { setMerchantBankAccounts([]); });
    getMerchantPayouts(effectiveMerchantId).then(payouts => setMerchantPayouts(payouts)).catch(() => setMerchantPayouts([]));
  }, [f.merchantId]);

  useEffect(() => {
    if (!selId) return;
    getWalletBalance(selId).then(b => { setBalance(b); cacheBalance(selId, Number(b.balance), b.currency); })
      .catch(() => { const c = getCachedBalance(selId); if (c) setBalance(c); });
    getWalletTransactions(selId).then(setWalletTxns).catch(()=>{});
    getBankAccounts(selId).then(ba => { setBankAccounts(ba); if (ba.length>0) setSelBank(ba[0].id); }).catch(()=>{});
    getBankPayouts(selId).then(setBankPayouts).catch(()=>{});
    getCryptoWallets(selId).then(setCryptoWallets).catch(()=>{});
    getCryptoTransactions(selId).then(setCryptoTxns).catch(()=>{});
  }, [selId]);

  useEffect(() => {
    const options = getNetworkOptions(selCoin);
    setSelectedNetwork(prev => options.includes(prev) ? prev : (options[0] || 'mainnet'));
  }, [selCoin]);

  useEffect(() => {
    if (modal==='buy-crypto'||modal==='sell-crypto')
      getCryptoPrice(selCoin).then(r=>setCoinPrice(r.price)).catch(()=>{});
  }, [modal, selCoin]);

  useEffect(() => {
    let cancelled = false;
    const preload = async () => {
      const entries: [string, number][] = [];
      for (const coin of COINS) {
        try {
          const r = await getCryptoPrice(coin);
          if (!cancelled) entries.push([coin, r.price]);
        } catch {
          // Leave the cached price unchanged when a quote is temporarily unavailable.
        }
      }
      if (!cancelled && entries.length) {
        setCoinPriceMap(prev => {
          const next = { ...prev };
          for (const [coin, price] of entries) next[coin] = price;
          return next;
        });
      }
    };
    preload();
    const interval = setInterval(preload, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const refreshWallet = async () => {
    if (!selId) return;
    try {
      const [bal, wt] = await Promise.all([getWalletBalance(selId), getWalletTransactions(selId)]);
      setBalance(bal); setWalletTxns(wt); cacheBalance(selId, Number(bal.balance), bal.currency);
    } catch { const c = getCachedBalance(selId); if (c) setBalance(c); }
    setQueuedOps(offlinePending());
  };
  const refreshBank  = async () => {
    if (!selId) return;
    const [ba, bp] = await Promise.all([getBankAccounts(selId), getBankPayouts(selId)]);
    setBankAccounts(ba); setBankPayouts(bp); if (ba.length>0) setSelBank(ba[0].id);
  };
  const refreshCrypto = async () => {
    if (!selId) return;
    setCryptoWallets(await getCryptoWallets(selId));
    setCryptoTxns(await getCryptoTransactions(selId));
  };

  const closeAll = () => { setModal(null); setF({}); };

  // ── Send customer asset to hot wallet ─────────────────────────────────────
  const handleSendToHotWallet = () => act(async () => {
    const snapF = { ...f };
    const snapSelId = selId;
    const merchantId = snapF.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || DEFAULT_MERCHANT_ID;

    if (!snapSelId) throw new Error('No customer selected');
    if (!snapF.sthAssetType) throw new Error('Select asset type (Fiat or Crypto)');
    const amt = parseFloat(snapF.sthAmount || '');
    if (!amt || amt <= 0) throw new Error('Enter a valid amount');
    if (snapF.sthAssetType === 'crypto' && !snapF.sthCoin) throw new Error('Select a coin');

    const result = await sendToHotWallet({
      customerId: snapSelId,
      merchantId,
      assetType: snapF.sthAssetType as 'fiat' | 'crypto',
      amount: amt,
      cryptoCoin: snapF.sthAssetType === 'crypto' ? snapF.sthCoin : undefined,
      reason: snapF.sthReason || undefined,
      currency: balance.currency || 'USD',
    });

    if (snapF.sthAssetType === 'fiat') await refreshWallet();
    else await refreshCrypto();

    addNotification(
      '✅ Sweep Complete',
      `${snapF.sthAssetType === 'crypto' ? `${amt} ${snapF.sthCoin}` : `$${amt.toFixed(2)} USD`} swept from ${result.customerName} → hot wallet.\nRef: ${result.reference}`,
      'success'
    );
  }, '');
  const act = async (fn: ()=>Promise<any>, msg: string, detail?: (result: any) => string | null) => {
    setBusy(true);
    try {
      const result = await fn();
      if (msg) {
        const extra = detail ? detail(result) : null;
        addNotification('Success', extra ? `${msg}\n\n${extra}` : msg, 'success');
      }
      closeAll();
    }
    catch (e:any) { 
      console.error('[Action Error]', e);
      addNotification('Error', e.message||'An error occurred', 'error'); 
      // Don't close the modal on error so user can see what went wrong and retry
    }
    finally { setBusy(false); }
  };
  const inp = (name:string, ph:string, type='text', req=false) =>
    <FormInput key={`inp-${name}`} f={f} setF={setF} name={name} placeholder={ph} type={type} required={req} />;

  // Handlers
  // Handlers
  const handleCreateCustomer = () => act(async () => {
    const snapF = { ...f };
    const formName  = (snapF.name  || '').trim();
    const formEmail = (snapF.email || '').trim();
    const formPhone = (snapF.phone || '').trim();
    if (!formName) throw new Error('Name required');
    if (formName.length < 2) throw new Error('Name must be at least 2 characters');
    const c = await createCustomer(formName, formEmail || undefined, formPhone || undefined);
    if (!c || !c.id) throw new Error('Server returned an invalid customer record');
    const savedName = (c.name || '').trim() || formName;
    const safeCustomer = { ...c, name: savedName, email: c.email ?? (formEmail || undefined), phone: c.phone ?? (formPhone || undefined) };
    // Submit KYC fields if any were provided
    const kycKeys = ['id_type','id_number','id_expiry','id_country','date_of_birth','nationality','address_line1','address_line2','city','country','postal_code','occupation','kyc_status','risk_level','notes'];
    const kycPayload: Record<string, string> = {};
    for (const key of kycKeys) { const val = (snapF as any)[key]; if (val && String(val).trim()) kycPayload[key] = String(val).trim(); }
    if (Object.keys(kycPayload).length > 0) { try { await updateCustomerKYC(c.id, kycPayload); } catch { /* non-fatal */ } }
    setCustomers(p => [...p, safeCustomer]);
    setSelId(safeCustomer.id);
    try {
      await getWalletBalance(safeCustomer.id);
      addNotification('Wallet Created', `${savedName}'s wallet is ready. Open the customer profile to view wallet details.`, 'success');
    } catch {
      addNotification('Wallet Created', `${savedName}'s wallet created — ID: ${safeCustomer.id}`, 'success');
    }
  }, `Customer created`);

  const handleTopup = () => act(async () => {
    // â”€â”€ Snapshot ALL state into local constants BEFORE any await.
    const snapF = { ...f };
    const snapSelId = selId;
    const snapIsOnline = isOnline;

    if (!snapSelId) throw new Error('No customer selected');
    const amt = parseFloat(snapF.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid top-up amount');
    const pan = cleanCardNumber(snapF.topupPan || '');
    const expiry = snapF.topupExpiry || '';
    const cvv = (snapF.topupCvv || '').trim();
    if (!pan || pan.length < 13 || pan.length > 19) throw new Error('Enter a valid card number');
    if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) throw new Error('Enter card expiry as MM/YY');
    if (!cvv || !/^\d{3,4}$/.test(cvv)) throw new Error('Enter a valid CVV');
    const panMasked = '*'.repeat(pan.length - 4) + pan.slice(-4);

    if (!snapIsOnline) {
      enqueue('wallet_topup_card', {
        customerId: snapSelId,
        amount: amt,
        cardNumber: pan,
        panMasked,
        expiry,
        cvv,
      });
      applyLocalBalance(snapSelId, amt);
      setBalance(prev => ({ ...prev, balance: prev.balance + amt }));
      setQueuedOps(offlinePending());
      addNotification('Queued for Sync', `Card top-up of $${amt.toFixed(2)} is queued and will be applied when the connection returns.`, 'success');
      return;
    }

    const result = await topupWalletWithCard(snapSelId, amt, pan, panMasked, expiry, cvv);
    await refreshWallet();
    addNotification('Top Up Complete', `Amount $${amt.toFixed(2)} credited. Auth: ${result.authCode || 'N/A'}${result.processorId ? ` Â· Processor: ${result.processorId}` : ''}`, 'success');
  }, '');

  const handleDebit = () => act(async () => {
    // â”€â”€ Snapshot ALL state into local constants BEFORE any await.
    const snapF = { ...f };
    const snapSelId = selId;
    const snapIsOnline = isOnline;

    if (!snapSelId) throw new Error('No customer');
    const amt = parseFloat(snapF.amount);
    if (!snapIsOnline) { const c=getCachedBalance(snapSelId); if(c&&c.balance<amt) throw new Error('Insufficient balance'); enqueue('wallet_debit',{customerId:snapSelId,amount:amt,source:'admin_debit'}); applyLocalBalance(snapSelId,-amt); }
    else await debitWallet(snapSelId, amt, 'admin_debit');
    await refreshWallet();
  }, 'Debit applied');

  const handleTransfer = () => act(async () => {
    // â”€â”€ Snapshot ALL state into local constants BEFORE any await.
    const snapF = { ...f };
    const snapSelId = selId;
    const snapIsOnline = isOnline;

    if (!snapSelId) throw new Error('No customer');
    const amt = parseFloat(snapF.amount);
    if (!snapIsOnline) { enqueue('wallet_transfer',{senderCustomerId:snapSelId,receiverCustomerId:snapF.receiverId,amount:amt,note:snapF.note}); applyLocalBalance(snapSelId,-amt); }
    else await walletTransfer(snapSelId, snapF.receiverId, amt, snapF.note);
    await refreshWallet();
  }, 'Transfer sent');

  const handleAddBank = () => act(async () => {
    // â”€â”€ Snapshot ALL state into local constants BEFORE any await.
    const snapF = { ...f };
    const snapSelId = selId;

    if (!snapSelId) throw new Error('No customer');
    await addBankAccount({customerId:snapSelId,bankName:snapF.bankName,accountHolder:snapF.holder,accountNumber:snapF.accountNumber,routingNumber:snapF.routing,iban:snapF.iban,swiftCode:snapF.swift,currency:snapF.currency||'USD'});
    await refreshBank();
  }, 'Bank account added');

  const handleBankPayout = () => act(async () => {
    // â”€â”€ Snapshot ALL state into local constants BEFORE any await.
    const snapF = { ...f };
    const snapSelId = selId;
    const snapSelBank = selBank;

    if (!snapSelId||!snapSelBank) throw new Error('Select bank account');
    const selectedAccount = bankAccounts.find((account) => account.id === snapSelBank);
    const payoutCurrency = String(snapF.currency || balance.currency || 'USD').toUpperCase();
    if (selectedAccount?.currency && selectedAccount.currency.toUpperCase() !== payoutCurrency) {
      throw new Error(`Selected bank account accepts ${selectedAccount.currency}, not ${payoutCurrency}`);
    }
    await bankPayout(snapSelId, snapSelBank, parseFloat(snapF.amount), payoutCurrency);
    await refreshWallet(); await refreshBank();
  }, 'Payout initiated');

  const handleBuyCrypto = () => act(async () => {
    const snapF = { ...f };
    const snapSelId = selId;
    const snapSelCoin = selCoin;
    const snapSelectedNetwork = selectedNetwork;
    const snapIsOnline = isOnline;
    const snapCurrency = balance.currency; // use customer's actual wallet currency

    if (!snapSelId) throw new Error('No customer');
    if (!snapIsOnline) throw new Error('Online connection required for crypto purchases');
    const amt = parseFloat(snapF.amount);
    if (!amt || amt <= 0) throw new Error(`Enter a valid ${snapCurrency} amount to spend`);
    await buyCryptoWithWallet(snapSelId, snapSelCoin, amt, snapSelectedNetwork, snapCurrency);
    await refreshCrypto();
    await refreshWallet();
  }, 'Crypto purchase complete');

  const handleMerchantBuy = () => act(async () => {
    // ══ Snapshot ALL state into local constants BEFORE any await.
    //    This defends against stale closures if any UI path calls setF({}) mid-flight.
    const snapF = { ...f };
    const snapSelCoin = selCoin;
    const snapSelectedNetwork = selectedNetwork;
    const snapMerchantWallet = merchantWallet;

    const merchantId =
      snapF.merchantId?.trim() ||
      snapMerchantWallet?.merchant_id?.trim() ||
      snapMerchantWallet?.id?.trim() ||
      DEFAULT_MERCHANT_ID;

    if (!isOnline) throw new Error('Online connection required for merchant buys');

    const amt = parseFloat(snapF.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid USD amount to spend');

    const result = await buyCryptoWithMerchant(merchantId, snapSelCoin, amt, snapSelectedNetwork);
    if (result.ok === false || result.mode !== 'live' || result.is_mock === true || result.mock === true) {
      throw new Error(result.error || 'Live exchange purchase required. Simulation responses are disabled.');
    }

    await refreshMerchantWallet(merchantId);
    const received = Number(result.asset_received || 0);
    const orderId = result.exchange_order?.orderId || result.exchange_order?.clientOrderId || result.exchange_order?.order_id || '-';
    const provider = result.provider_used || 'exchange';
    addNotification(
      'Real purchase executed',
      `Merchant bought ${received > 0 ? received.toFixed(8) : '-'} ${snapSelCoin} on ${snapSelectedNetwork} for $${amt.toFixed(2)} via ${provider}. Order ID: ${orderId}. Avg price: ${result.avg_price_per_unit ? '$' + Number(result.avg_price_per_unit).toLocaleString() : '-'}`,
      'success'
    );
    closeAll();
  }, 'Merchant crypto buy');


  const handleMerchantToCustomer = () => act(async () => {
    const snapF = { ...f };
    const snapMerchantWallet = merchantWallet;
    const merchantId =
      snapF.merchantId?.trim() ||
      snapMerchantWallet?.merchant_id?.trim() ||
      snapMerchantWallet?.id?.trim() ||
      DEFAULT_MERCHANT_ID;
    const targetCustomerId = snapF.targetCustomerId?.trim();
    if (!targetCustomerId) throw new Error('Please select a customer');
    const amt = parseFloat(snapF.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid amount');
    const result = await merchantToCustomerTransfer(merchantId, targetCustomerId, amt, snapF.note || undefined, snapF.transferCurrency || balance.currency || 'USD');
    await refreshMerchantWallet(merchantId);
    if (targetCustomerId === selId) await refreshWallet();
    addNotification('Transfer Complete', `$${amt.toFixed(2)} sent to ${result.customerName}. Ref: ${result.reference}`, 'success');
    closeAll();
  }, '');

  const handleHotWalletPayout = () => act(async () => {
    const snapF = { ...f };
    const merchantId = snapF.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || DEFAULT_MERCHANT_ID;
    const amount = Number(snapF.amount || 0);
    const address = snapF.address?.trim() || '';
    
    // Validate required fields
    if (!isOnline) throw new Error('Hot-wallet delivery requires an online connection');
    if (!amount || amount <= 0) throw new Error('Enter a valid USD amount');
    if (!address) throw new Error('Enter the destination wallet address');
    
    // Validate authorized person information
    if (!snapF.authorizedPersonName?.trim()) throw new Error('Authorized person name is required');
    if (!snapF.authorizationRole?.trim()) throw new Error('Authorization role/title is required');
    if (!snapF.authorizedEmail?.trim()) throw new Error('Authorized person email is required');
    
    // Validate business information
    if (!snapF.businessName?.trim()) throw new Error('Business legal name is required');
    if (!snapF.businessAddress?.trim()) throw new Error('Business address is required');
    
    const result = await merchantCryptoPayout(merchantId, {
      amount_usd: amount,
      asset: snapF.asset || 'USDT',
      address,
      network: snapF.network || 'tron',
      sender_mode: 'hot',
      authorizedPerson: {
        name: snapF.authorizedPersonName.trim(),
        role: snapF.authorizationRole.trim(),
        email: snapF.authorizedEmail.trim(),
        phone: snapF.authorizedPhone?.trim(),
      },
      businessInfo: {
        businessName: snapF.businessName.trim(),
        businessRegNumber: snapF.businessRegNumber?.trim(),
        businessAddress: snapF.businessAddress.trim(),
        businessPhone: snapF.businessPhone?.trim(),
        taxId: snapF.taxId?.trim(),
      },
      payoutReason: snapF.payoutReason?.trim(),
    });
    if (result.status === 'simulation' || result.is_mock === true || result.mock === true) {
      throw new Error('Simulation responses are disabled. Configure a live hot-wallet rail.');
    }
    return result;
  }, 'Hot-wallet delivery recorded');

  const handleMerchantBankPayout = () => act(async () => {
    const snapF = { ...f };
    const snapMerchantWallet = merchantWallet;
    const snapSelMerchantBank = selMerchantBank;
    const snapMerchantBankAccounts = merchantBankAccounts;

    const merchantId =
      snapF.merchantId?.trim() ||
      snapMerchantWallet?.merchant_id?.trim() ||
      snapMerchantWallet?.id?.trim() ||
      DEFAULT_MERCHANT_ID;

    if (!isOnline) throw new Error('Online connection required for bank payouts');

    const amt = parseFloat(snapF.amount || '0');
    if (!amt || amt <= 0) throw new Error('Enter a valid payout amount');

    const currency = (snapF.currency || 'USD').toUpperCase();

    let bank_account_id: string | undefined = snapSelMerchantBank || snapF.selectedBankId || undefined;
    let bank_account: any = undefined;

    if (snapF.useAdhocBank === 'true') {
      if (!snapF.adhocBankName?.trim()) throw new Error('Enter the receiving bank name');
      if (!snapF.adhocAccountHolder?.trim()) throw new Error('Enter the account holder name');
      if (!snapF.adhocAccountNumber?.trim()) throw new Error('Enter the account number / IBAN');
      bank_account = {
        bank_name: snapF.adhocBankName.trim(),
        account_holder: snapF.adhocAccountHolder.trim(),
        account_number: snapF.adhocAccountNumber.trim(),
        ...(snapF.adhocRouting?.trim() ? { routing_number: snapF.adhocRouting.trim() } : {}),
        ...(snapF.adhocSwift?.trim() ? { swift_code: snapF.adhocSwift.trim() } : {}),
        ...(snapF.adhocIban?.trim() ? { iban: snapF.adhocIban.trim() } : {}),
        currency,
      };
      bank_account_id = undefined;
    } else {
      if (!bank_account_id && snapMerchantBankAccounts.length > 0) {
        const def = snapMerchantBankAccounts.find((b: any) => Number(b.is_default) === 1 && String(b.currency || '').toUpperCase() === currency)
          || snapMerchantBankAccounts.find((b: any) => Number(b.is_default) === 1)
          || snapMerchantBankAccounts[0];
        if (def) bank_account_id = def.id;
      }
      if (!bank_account_id && snapMerchantBankAccounts.length === 0) {
        throw new Error('No bank accounts saved for merchant. Either save an account in Settings or enable "Ad-hoc" bank details.');
      }
    }

    const payload: any = { amount: amt, currency };
    if (bank_account) payload.bank_account = bank_account;
    if (bank_account_id) payload.bank_account_id = bank_account_id;

    const result = await merchantBankPayout(merchantId, payload);
    await refreshMerchantWallet(merchantId);
    try {
      const payouts = await getMerchantPayouts(merchantId);
      setMerchantPayouts(payouts);
    } catch { /* ignore */ }

    const status = String(result.status || 'pending').toUpperCase();
    const providerRef = result.provider_reference || result.providerRef || '-';
    addNotification(
      'Withdrawal requested — wallet debited',
      `${currency} ${amt.toFixed(2)} is being moved to ${bank_account ? bank_account.bank_name : (snapMerchantBankAccounts.find(b => b.id === bank_account_id)?.bank_name || 'your saved bank account')}.\nOnce funds arrive in your bank, click "Confirm Received" on the payout history row.\nStatus: ${status}. Withdrawal ref: ${providerRef}`,
      'success'
    );
    closeAll();
    return result;
  }, 'Bank payout submitted');

  const handleApprovePayout = () => act(async () => {
    const snapSelPayout = selPayout;
    if (!snapSelPayout) throw new Error('No payout selected');
    const wireRef = (f.wire_reference || '').trim();
    const wireNote = (f.wire_note || '').trim();
    const result = await approveMerchantPayout(snapSelPayout.id, {
      external_reference: wireRef,
      tx_proof: wireNote,
    });
    // refresh
    const mId = snapSelPayout.merchant_id || f.merchantId || merchantWallet?.merchant_id || '';
    if (mId) {
      setMerchantPayouts(await getMerchantPayouts(mId).catch(() => []));
      refreshMerchantWallet(mId).catch(() => {});
    }
    addNotification(
      'Withdrawal closed',
      `You confirmed ${snapSelPayout.currency} ${Number(snapSelPayout.amount).toFixed(2)} arrived in your saved bank account.\nBank reference: ${result.provider_reference || wireRef || '-'}`,
      'success'
    );
    closeAll();
  }, 'Merchant bank arrival confirmed');

  const handleRejectPayout = () => act(async () => {
    const snapSelPayout = selPayout;
    if (!snapSelPayout) throw new Error('No payout selected');
    const reason = (f.reject_reason || '').trim() || 'Merchant cancelled (withdrawal not deposited yet)';
    const result = await rejectMerchantPayout(snapSelPayout.id, { reason });
    const mId = snapSelPayout.merchant_id || f.merchantId || merchantWallet?.merchant_id || '';
    if (mId) {
      setMerchantPayouts(await getMerchantPayouts(mId).catch(() => []));
      refreshMerchantWallet(mId).catch(() => {});
    }
    addNotification(
      'Withdrawal cancelled — balance returned',
      result.merchant_wallet_refunded
        ? `Returned ${snapSelPayout.currency} ${Number(result.refunded_amount || 0).toFixed(2)} back to your merchant wallet balance.`
        : `Withdrawal ${snapSelPayout.id} cancelled.`,
      'warning'
    );
    closeAll();
  }, 'Withdrawal cancelled');

  const handleCreateVirtualAccount = () => act(async () => {
    try {
      const snapF = { ...f };
      const merchantId = snapF.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || DEFAULT_MERCHANT_ID;
      if (!isOnline) throw new Error('Virtual-account creation requires an online connection');
      if (!snapF.transakAccessToken && !snapF.transakAuthRelianceEmail) throw new Error('Verify the merchant email with OTP or Auth Reliance first');
      if (!snapF.fiatCurrency || !snapF.paymentMethod) throw new Error('Select the merchant fiat currency and payment method');
      if (!snapF.asset || !snapF.network || !snapF.address?.trim()) throw new Error('Enter the merchant crypto destination (Trust Wallet address)');
      if (snapF.transakWalletVerified !== 'true') throw new Error('Verify the wallet address first - this ensures Trust Wallet can receive payments');
      
      console.log('[Virtual Account] Creating with:', { merchantId, fiatCurrency: snapF.fiatCurrency, asset: snapF.asset, network: snapF.network });
      
      const result = await createVirtualAccount(merchantId, {
        source: {
          fiatCurrency: snapF.fiatCurrency,
          paymentMethod: snapF.paymentMethod,
        },
        destination: {
          cryptoCurrency: snapF.asset,
          walletAddress: snapF.address.trim(),
          network: snapF.network,
        },
        transakAccessToken: snapF.transakAccessToken,
        transakAuthRelianceEmail: snapF.transakAuthRelianceEmail,
      });
      
      console.log('[Virtual Account] Created successfully:', result);
      
      setVirtualAccounts(previous => [result.transaction, ...previous.filter(item => item.id !== result.transaction.id)]);
      addNotification('Merchant Virtual Account Created', `Transak account created successfully.\nCrypto will be sent to your Trust Wallet address:\n${snapF.address.trim().substring(0, 10)}...${snapF.address.trim().substring(snapF.address.trim().length - 6)}`, 'success');
      return result;
    } catch (error: any) {
      console.error('[Virtual Account] Creation failed:', error);
      // Re-throw to be caught by act() function
      throw error;
    }
  }, 'Virtual account created');

  const handleSendMerchantOtp = async () => {
    const email = (f.merchantEmail || '').trim();
    if (!email) {
      addNotification('Merchant email required', 'Enter the merchant email registered with Transak.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await transakSendUserOtp(email);
      setF(previous => ({ ...previous, transakStateToken: result.stateToken, transakOtpSent: 'true' }));
      addNotification('OTP sent', `Transak sent a verification code to ${email}.`, 'success');
    } catch (error: any) {
      addNotification('OTP failed', error?.message || 'Unable to send the Transak verification code.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOnboardMerchantAuthReliance = async () => {
    const email = (f.merchantEmail || '').trim();
    if (!email) {
      addNotification('Merchant email required', 'Enter the merchant email registered with Transak.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await transakOnboardUser(email);
      setF(previous => ({
        ...previous,
        transakAuthRelianceEmail: result.user.email,
        transakUserEmail: result.user.email,
        transakKycStatus: result.user.kyc?.status || 'UNKNOWN',
        transakKycType: result.user.kyc?.type || 'UNKNOWN',
      }));
      addNotification('Merchant onboarded', 'Auth Reliance onboarding returned a live Transak merchant profile.', 'success');
    } catch (error: any) {
      addNotification('Onboarding failed', error?.message || 'Auth Reliance is not enabled for this partner.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMerchantWalletAddress = async () => {
    const cryptoCurrency = (f.asset || 'USDT').trim();
    const network = (f.network || 'tron').trim();
    const walletAddress = (f.address || '').trim();
    if (!walletAddress) {
      addNotification('Wallet address required', 'Enter the merchant destination address first.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await transakVerifyWalletAddress({ cryptoCurrency, network, walletAddress });
      if (!result.response) {
        setF(previous => ({ ...previous, transakWalletVerified: 'false' }));
        addNotification('Wallet address rejected', `Transak rejected this ${cryptoCurrency} address for ${network}.`, 'error');
        return;
      }
      setF(previous => ({ ...previous, transakWalletVerified: 'true' }));
      addNotification('Wallet address verified', `Transak accepted this ${cryptoCurrency} address for ${network}.`, 'success');
    } catch (error: any) {
      setF(previous => ({ ...previous, transakWalletVerified: 'false' }));
      addNotification('Verification failed', error?.message || 'Unable to verify the wallet address with Transak.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMerchantOtp = async () => {
    const email = (f.merchantEmail || '').trim();
    const otp = (f.transakOtp || '').trim();
    const stateToken = (f.transakStateToken || '').trim();
    if (!email || !otp || !stateToken) {
      addNotification('OTP required', 'Send the OTP first, then enter the verification code.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await transakVerifyUserOtp(email, otp, stateToken);
      let limitState: Record<string, string> = {};
      let userState: Record<string, string> = {};
      try {
        const userResult = await transakGetUserDetails(result.accessToken);
        userState = {
          transakUserEmail: userResult.user.email,
          transakKycStatus: userResult.user.kyc?.status || 'UNKNOWN',
          transakKycType: userResult.user.kyc?.type || 'UNKNOWN',
        };
      } catch {
        addNotification('Profile unavailable', 'Merchant verified, but Transak profile details could not be loaded.', 'info');
      }
      try {
        const limitResult = await transakGetUserLimits({
          accessToken: result.accessToken,
          fiatCurrency: f.fiatCurrency || 'GBP',
          paymentCategory: f.paymentMethod || 'gbp_bank_transfer',
          kycType: 'STANDARD',
        });
        limitState = {
          limitDaily: String(limitResult.limits.remaining['1'] ?? 0),
          limitMonthly: String(limitResult.limits.remaining['30'] ?? 0),
          limitYearly: String(limitResult.limits.remaining['365'] ?? 0),
        };
      } catch {
        addNotification('Limits unavailable', 'Merchant verified, but Transak limits could not be loaded yet.', 'info');
      }
      setF(previous => ({ ...previous, transakAccessToken: result.accessToken, transakOtpVerified: 'true', ...userState, ...limitState }));
      addNotification('Merchant verified', 'The merchant Transak session is ready for VBA creation.', 'success');
    } catch (error: any) {
      addNotification('Verification failed', error?.message || 'Invalid or expired Transak OTP.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshMerchantSession = async () => {
    const accessToken = (f.transakAccessToken || '').trim();
    if (!accessToken) return;
    setBusy(true);
    try {
      const result = await transakRefreshUserAccessToken(accessToken);
      setF(previous => ({ ...previous, transakAccessToken: result.accessToken }));
      addNotification('Session refreshed', 'The merchant Transak access token was refreshed.', 'success');
    } catch (error: any) {
      addNotification('Refresh failed', error?.message || 'The token expired; request a new OTP.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLogoutMerchantSession = async () => {
    const accessToken = (f.transakAccessToken || '').trim();
    if (!accessToken) return;
    setBusy(true);
    try {
      await transakLogoutUser(accessToken);
      setF(previous => ({ ...previous, transakAccessToken: '', transakOtpVerified: '', transakStateToken: '', transakOtpSent: '', transakUserEmail: '', transakKycStatus: '', transakKycType: '', limitDaily: '', limitMonthly: '', limitYearly: '' }));
      addNotification('Session ended', 'The merchant Transak session was logged out.', 'success');
    } catch (error: any) {
      addNotification('Logout failed', error?.message || 'Unable to log out of Transak.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSellCrypto = () => act(async () => {
    const snapF = { ...f };
    const snapSelId = selId;
    const snapSelCoin = selCoin;
    const snapSelectedNetwork = selectedNetwork;
    const snapIsOnline = isOnline;
    if (!snapSelId) throw new Error('No customer');
    if (!snapIsOnline) throw new Error('Crypto sell requires internet');
    await sellCrypto(snapSelId, snapSelCoin, parseFloat(snapF.amount), snapSelectedNetwork);
    await refreshWallet(); await refreshCrypto();
  }, 'Crypto sale complete');

  const handleWithdrawCrypto = () => act(async () => {
    const snapF = { ...f };
    const snapSelId = selId;
    const snapSelCoin = selCoin;
    const snapSelectedNetwork = selectedNetwork;
    const snapIsOnline = isOnline;
    if (!snapSelId) throw new Error('No customer selected');
    if (!snapIsOnline) throw new Error('Crypto withdrawal requires internet (for on-chain broadcast or exchange API)');
    const amt = parseFloat(snapF.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid amount');
    const addr = snapF.address?.trim();
    if (!addr || addr.length < 10) throw new Error('Enter a valid wallet address');

    // ── Per-network address format validation (pre-submit UX) ──
    const net = String(snapSelectedNetwork || '').toLowerCase();
    const coin = String(snapSelCoin || '').toUpperCase();
    const tronLike = addr.startsWith('T') && addr.length >= 33 && addr.length <= 36;
    const evmLike = /^0x[a-fA-F0-9]{40}$/.test(addr);
    const btcLike = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);
    const solLike = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    const xrpLike = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr);

    if (coin === 'USDT' && (net === 'tron' || net === 'trc20' || net === 'trx')) {
      if (!tronLike) throw new Error('TronLink / TRC-20 addresses start with "T" and are ~34 characters long.');
    }
    if (coin === 'USDT' && (net === 'bsc' || net === 'bep20' || net === 'polygon' || net === 'erc20' || net === 'ethereum' || net === 'eth')) {
      if (!evmLike) throw new Error(`${net.toUpperCase()} addresses must be a 0x-prefixed 42-char hex EVM address (Trust Wallet format).`);
    }
    if (coin === 'BTC' || net === 'bitcoin' || net === 'btc') {
      if (!btcLike && !tronLike && !evmLike) throw new Error('BTC address format not recognized. Use bech32 (bc1…) or legacy (1…/3…).');
    }
    if (coin === 'SOL' || net === 'solana' || net === 'spl') {
      if (!solLike) throw new Error('Solana addresses are 32–44 char base58 (no l/I/0/O).');
    }
    if (coin === 'XRP' || net === 'ripple' || net === 'xrp') {
      if (!xrpLike) throw new Error('Ripple/XRP addresses start with "r" (r…). Note: destination tag required for exchanges (add in remarks during audit).');
    }
    if (coin === 'BNB' || net === 'bsc' || net === 'bep2') {
      if (net === 'bsc' && !evmLike) throw new Error('BNB (BSC) addresses are 0x-prefixed EVM format.');
      if (net === 'bep2' && !(addr.startsWith('bnb') || btcLike)) throw new Error('BNB Beacon Chain (BEP2) addresses start with "bnb".');
    }

    const isUsdt = coin === 'USDT';
    const looksTron = tronLike;
    const looksEvm = evmLike;

    if (isUsdt) {
      if (looksTron && net !== 'tron' && net !== 'trc20' && net !== 'trx') {
        console.warn('[withdraw] Address is Tron (T-addr) but network not TRON — backend will auto-route via tronweb direct rail.');
      }
      if (looksEvm && !['bsc', 'polygon', 'ethereum', 'eth', 'erc20', 'bep20'].includes(net)) {
        console.warn('[withdraw] Address is EVM (0x) but network not BSC/Polygon — backend will auto-detect direct rail.');
      }
    }

    const result = await withdrawCrypto(snapSelId, coin, amt, addr, snapSelectedNetwork);
    await refreshCrypto();
    return result;
  }, `${selCoin} withdrawal submitted`, (result: any) => {
    if (!result) return null;
    const provider = result.provider || '';
    const isDirect = ['tronweb', 'bscweb', 'polygonweb'].includes(String(provider).toLowerCase());
    const lines: string[] = [];
    if (isDirect) {
      lines.push(`Route: Direct blockchain rail (${provider.toUpperCase()}) — 0 exchange, 0 KYC, 0 Travel Rule`);
    } else if (provider) {
      lines.push(`Route: Exchange provider ${String(provider).toUpperCase()}`);
    }
    if (result.withdrawalRef) lines.push(`Ref: ${result.withdrawalRef}`);
    if (result.txUrl) lines.push(`Tx: ${result.txUrl}`);
    if (result.message) lines.push(result.message);
    return lines.length ? lines.join('\n') : null;
  });


  return (
    <div className="animate-fade-in space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Offline POS 201.3
            </div>
            <h1 className="mt-3 text-2xl font-bold">Customer & Merchant Wallets</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">Manage customer balances, merchant settlement funds, cards, bank payouts, and crypto purchases in one offline-first dashboard.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => {
                const prev = f;
                const resolvedMerchantId =
                  prev.merchantId?.trim() ||
                  merchantWallet?.merchant_id?.trim() ||
                  merchantWallet?.id?.trim() ||
                  'MRC-1001';
                setF({ merchantId: resolvedMerchantId });
                setModal('merchant-buy');
              }}
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/25">Merchant Buy Crypto</button>
            <button onClick={() => {
                const prev = f;
                const resolvedMerchantId =
                  prev.merchantId?.trim() ||
                  merchantWallet?.merchant_id?.trim() ||
                  merchantWallet?.id?.trim() || '';
                setF({ merchantId: resolvedMerchantId, targetCustomerId: selId || '' });
                setModal('merchant-to-customer');
              }}
              className="rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/25">
              &#8594; Send to Customer
            </button>
            <button onClick={() => {
                const merchantId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                
                // Load saved business information from localStorage
                const savedBusinessInfo = localStorage.getItem('businessInfo');
                const businessInfo = savedBusinessInfo ? JSON.parse(savedBusinessInfo) : {
                  authorizedPersonName: 'Jukruti Jacob Dumba',
                  authorizationRole: 'Account Signatory',
                  authorizedEmail: 'Jukrutidumba@gmail.com',
                  authorizedPhone: '0607289532',
                  businessName: 'Jukruti Logistics (Pty) Ltd',
                  businessRegNumber: '2014/215965/07',
                  businessAddress: '9 Houtkapper Str, Olifantshoek, Northern Cape, 8450, South Africa',
                  businessPhone: '0607289532',
                  taxId: '9205076330089'
                };
                
                setF({ 
                  merchantId, 
                  asset: 'USDT', 
                  network: 'tron',
                  ...businessInfo
                });
                setModal('hot-wallet-payout');
              }}
              className="rounded-xl border border-orange-400/30 bg-orange-500/15 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/25">
              🔥 Hot Wallet Payout
            </button>
            <button onClick={() => {
                const merchantId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                setF({ merchantId, sthAssetType: 'fiat' });
                setModal('send-to-hot-wallet');
              }}
              className="rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/25">
              ⬆️ Send to Hot Wallet
            </button>
            {false && (
            <button onClick={() => {
                const merchantId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                setF({ merchantId, currency: merchantWallet?.currency || 'USD' });
                setModal('merchant-bank-payout');
              }}
              className="rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25">
              🏦 Merchant Bank Payout
            </button>
            )}
            <button onClick={() => {
                const merchantId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                setF({ merchantId });
                setModal('virtual-account');
              }}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/25">
              Virtual Account
            </button>
            <button onClick={() => { setF({}); setModal('create-customer'); }}
              className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400">+ New Customer</button>
          </div>
        </div>
      </div>

      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span>ðŸ“¡</span>
          <div className="flex-1">
            <div className="font-semibold text-amber-800 text-sm">Offline mode</div>
            <div className="text-amber-600 text-xs">Operations queued locally â€” syncing when reconnected{queuedOps>0?` (${queuedOps} pending)`:''}</div>
          </div>
        </div>
      )}
      {isOnline && queuedOps > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3">
          <span>ðŸ”„</span>
          <div className="text-green-800 text-sm font-semibold">{queuedOps} operation(s) syncing now...</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Customer list */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h2 className="font-bold text-gray-700 mb-3 text-xs uppercase tracking-wide">Customers</h2>
          {loadingCust
            ? [1,2,3].map(i=><div key={i} className="h-10 bg-gray-100 rounded animate-pulse mb-1"/>)
            : customers.length === 0
            ? <p className="text-sm text-gray-400 text-center py-4">No customers yet</p>
            : customers.map(c => (
              <div key={c.id} className={`rounded-lg mb-1 text-sm transition-all ${selId===c.id?'bg-blue-50 border border-blue-200':'border border-transparent hover:bg-gray-50'}`}>
                <button onClick={() => setSelId(c.id)}
                  className="w-full text-left p-3">
                  <div className={`font-semibold ${selId===c.id?'text-blue-700':'text-gray-700'}`}>{c.name?.trim() || <span className="text-red-500 italic">(Unnamed Customer)</span>}</div>
                  {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  {c.phone && <div className="text-xs text-gray-400">📞 {c.phone}</div>}
                </button>
                {selId===c.id && (
                  <div className="px-3 pb-2">
                    <button
                      onClick={() => navigate(`/customer-wallet/${c.id}`)}
                      className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold underline"
                    >View Customer Wallet →</button>
                  </div>
                )}
              </div>
            ))
          }
        </div>

        {sel ? (
          <div className="lg:col-span-3 space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Merchant wallet</div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900">Settlement balance</h3>
                    <p className="mt-2 max-w-xl text-sm text-slate-600">
                      Live merchant funds credited from offline POS batches and reduced by payouts or crypto purchases.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-700">Live available balance</div>
                    <div className="mt-1 text-3xl font-extrabold tabular-nums text-emerald-900">
                      {merchantWallet ? `${merchantWallet.currency} ${Number(merchantWallet.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Loading...'}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">{merchantWallet ? `${merchantTxns.length} recent ledger records loaded` : 'Reading merchant wallet'}</div>
                  </div>
                </div>
                <div className="mt-6 rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-600">
                  {merchantWallet
                    ? <>Merchant wallet <span className="font-mono font-semibold text-slate-900">{merchantWallet.merchant_id}</span> is connected to the live settlement ledger. Last update: <span className="font-semibold text-slate-900">{merchantWallet.updated_at ? new Date(merchantWallet.updated_at).toLocaleString() : 'available from provider'}</span>.</>
                    : 'Merchant wallet data is not available yet.'}
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Customer wallet</div>
                <div className="mt-4 text-sm text-slate-600">
                  <div className="font-semibold text-slate-900">{sel.name?.trim() || <span className="text-red-500 italic">(Unnamed Customer)</span>}</div>
                  {sel.email && <div className="mt-1">{sel.email}</div>}
                  {sel.phone && <div className="mt-1 text-slate-500">ðŸ“ž {sel.phone}</div>}
                </div>
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => navigate(`/customer-wallet-profile/${sel.id}`)}
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Open customer profile for wallet details
                  </button>
                </div>
              </div>
            </div>


            {false && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-base text-white">💸</div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-700">Merchant Payout History</div>
                      <h3 className="mt-0.5 text-base font-bold text-slate-900">Bank payouts & transfers</h3>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={async () => {
                    const mId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                    if (!mId) return;
                    try {
                      const payouts = await getMerchantPayouts(mId);
                      setMerchantPayouts(payouts);
                      addNotification('Refreshed', `Loaded ${payouts.length} payout records.`, 'success');
                    } catch { /* ignore */ }
                  }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">↻ Refresh</button>
                </div>
              </div>
              <div className="p-5">
                {merchantPayouts.length === 0
                  ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-5 py-8 text-center">
                      <div className="text-sm font-semibold text-slate-700">No merchant payouts yet</div>
                      <div className="mt-1 text-xs text-slate-500">Use <span className="font-semibold">🏦 Merchant Bank Payout</span> above to send settled funds to a bank account.</div>
                    </div>
                  : <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="max-h-[540px] overflow-y-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="sticky top-0 bg-gradient-to-br from-slate-50 to-slate-100/70 text-[11px] uppercase tracking-[0.18em] text-slate-600 z-10 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
                            <tr>
                              <th className="px-4 py-3 font-bold">Date</th>
                              <th className="px-4 py-3 font-bold">
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-rose-100 text-rose-600 text-[10px] font-black">↑</span>
                                  Sender (Debit)
                                </div>
                              </th>
                              <th className="px-4 py-3 font-bold">
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 text-emerald-600 text-[10px] font-black">↓</span>
                                  Receiver (Credit)
                                </div>
                              </th>
                              <th className="px-4 py-3 font-bold text-right">Amount</th>
                              <th className="px-4 py-3 font-bold">Status</th>
                              <th className="px-4 py-3 font-bold">Reference</th>
                              <th className="px-4 py-3 font-bold text-right whitespace-nowrap">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {merchantPayouts.map(p => {
                              const statusRaw = String(p.status || 'unknown').toUpperCase();
                              const statusClass: Record<string, string> = {
                                COMPLETED: 'bg-green-100 text-green-800',
                                SENT: 'bg-green-100 text-green-800',
                                OUTGOING_PAYMENT_SENT: 'bg-green-100 text-green-800',
                                CONVERTED: 'bg-green-100 text-green-800',
                                PENDING: 'bg-amber-100 text-amber-800',
                                PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
                                PENDING_BANK_CONFIRMATION: 'bg-purple-100 text-purple-800',
                                PENDING_MANUAL_TRANSFER:  'bg-purple-100 text-purple-800',
                                SUBMITTED: 'bg-blue-100 text-blue-800',
                                PROCESSING: 'bg-blue-100 text-blue-800',
                                INCOMING_PAYMENT_WAITING: 'bg-blue-100 text-blue-800',
                                FAILED: 'bg-red-100 text-red-800',
                                CANCELLED: 'bg-red-100 text-red-800',
                                REJECTED: 'bg-red-100 text-red-800',
                              };
                              const canApprove = new Set(['PENDING','PENDING_APPROVAL','PENDING_BANK_CONFIRMATION','PENDING_MANUAL_TRANSFER','SUBMITTED','PROCESSING','INCOMING_PAYMENT_WAITING']).has(statusRaw);
                              const canReject = new Set(['PENDING','PENDING_APPROVAL','PENDING_BANK_CONFIRMATION','PENDING_MANUAL_TRANSFER','SUBMITTED','PROCESSING','INCOMING_PAYMENT_WAITING','FAILED']).has(statusRaw);

                              // ── Sender (debit side) ──────────────────────────────────────
                              const senderMerchantId = p.sender_merchant_id || f.merchantId?.trim() || merchantWallet?.merchant_id || 'MRC-1001';
                              const senderName = p.sender_account_name || p.sender_label || `Merchant ${senderMerchantId}`;
                              const senderCurrency = p.sender_wallet_currency || p.currency || 'USD';
                              const isCryptoReceiver = (p.receiver_type === 'crypto') || (!!p.receiver_crypto_address || !!p.crypto_coin);
                              const isBankReceiver = (p.receiver_type === 'bank') || (!isCryptoReceiver && (!!p.receiver_bank_name || !!p.receiver_account_holder || !!p.receiver_account_number_masked));
                              const receiverType = isCryptoReceiver ? 'crypto' : isBankReceiver ? 'bank' : (p.receiver_type || 'bank');

                              let receiverTitle = '—';
                              let receiverSub = '';
                              let receiverBadge: { label: string; cls: string } | null = null;
                              if (receiverType === 'crypto') {
                                const coin = p.receiver_crypto_coin || p.crypto_coin || 'CRYPTO';
                                const network = p.receiver_crypto_network || p.crypto_network || '';
                                const addr = p.receiver_crypto_address || '';
                                receiverBadge = { label: `${coin}${network ? ' · ' + network.toUpperCase() : ''}`, cls: 'bg-orange-100 text-orange-700' };
                                receiverTitle = addr ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : `${coin} ${network || ''} wallet`;
                                receiverSub = coin ? `Crypto receive · ${coin}${p.crypto_amount ? ' ' + Number(p.crypto_amount).toLocaleString(undefined,{maximumFractionDigits:8}) : ''}` : 'On-chain receive';
                              } else {
                                receiverBadge = { label: 'Bank Transfer', cls: 'bg-indigo-100 text-indigo-700' };
                                const bankName = p.receiver_bank_name || 'Saved bank account';
                                const holder = p.receiver_account_holder || p.receiver_label || '';
                                const acct = p.receiver_account_number_masked ? `• ${p.receiver_account_number_masked}` : (p.receiver_iban ? `IBAN ${p.receiver_iban.slice(0,6)}…${p.receiver_iban.slice(-4)}` : '');
                                receiverTitle = bankName;
                                receiverSub = [holder, acct].filter(Boolean).join(' · ');
                              }

                              return (
                                <tr key={p.id} className="hover:bg-slate-50/80 align-top transition-colors">
                                  <td className="px-4 py-3 text-xs font-medium text-slate-600 whitespace-nowrap align-top">
                                    <div className="font-semibold">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{p.created_at ? new Date(p.created_at).toLocaleTimeString() : ''}</div>
                                  </td>
                                  <td className="px-4 py-3 align-top">
                                    <div className="flex items-start gap-2.5">
                                      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-sm">
                                        <span className="text-[13px] font-black">↑</span>
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <div className="text-sm font-bold text-slate-900">{senderName}</div>
                                          <span className="rounded-md bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Debit</span>
                                        </div>
                                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">{senderMerchantId} · Wallet {senderCurrency}</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">Merchant settlement balance</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 align-top">
                                    <div className="flex items-start gap-2.5">
                                      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm">
                                        <span className="text-[13px] font-black">↓</span>
                                      </div>
                                      <div className="min-w-0 max-w-[240px]">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <div className="text-sm font-bold text-slate-900 truncate">{receiverTitle}</div>
                                          {receiverBadge && (
                                            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${receiverBadge.cls}`}>{receiverBadge.label}</span>
                                          )}
                                          <span className="rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">Credit</span>
                                        </div>
                                        {receiverSub && <div className="text-[11px] text-slate-500 mt-0.5 break-words">{receiverSub}</div>}
                                        {p.crypto_amount ? (
                                          <div className="mt-0.5 text-[10px] font-semibold text-orange-700">
                                            {Number(p.crypto_amount).toLocaleString(undefined,{maximumFractionDigits:8})} {p.crypto_coin || ''}{p.exchange_rate ? ` @ $${Number(p.exchange_rate).toLocaleString()}/${p.crypto_coin||''}` : ''}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap align-top">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">{p.currency || 'USD'}</div>
                                    <div className="text-base font-extrabold tabular-nums text-slate-900">
                                      {Number(p.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 align-top">
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass[statusRaw] || 'bg-slate-100 text-slate-700'}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${/(FAIL|CANCEL|REJECT)/.test(statusRaw)?'bg-red-500':/(PENDING|WAIT|PROCESS)/.test(statusRaw)?'bg-amber-500 animate-pulse':'bg-green-500'}`} />
                                      {statusRaw.replace(/_/g, ' ')}
                                    </span>
                                    {p.provider ? <div className="mt-1 text-[10px] font-semibold text-slate-500">{p.provider}</div> : null}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 break-all max-w-[160px] align-top">
                                    <div>{p.provider_reference || p.id?.slice(0, 16) || '-'}</div>
                                    {p.error_message ? <div className="text-red-600 mt-1 leading-snug">{p.error_message}</div> : null}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-right align-top">
                                    <div className="flex flex-col sm:flex-row sm:justify-end gap-1.5">
                                      <button type="button" onClick={() => downloadPayoutReceipt(p.id)} title="Open full payout transaction slip (printable)" className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700 shadow-sm transition hover:bg-indigo-100">
                                        Receipt
                                      </button>
                                      {canApprove ? (
                                        <button type="button" onClick={() => {
                                          setSelPayout(p);
                                          setF({ wire_reference: '', wire_note: '' });
                                          setModal('merchant-approve-payout');
                                        }} className="inline-flex items-center justify-center rounded-xl border border-green-500/30 bg-green-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-green-700">
                                          ✅ Confirm Received
                                        </button>
                                      ) : null}
                                      {canReject ? (
                                        <button type="button" onClick={() => {
                                          setSelPayout(p);
                                          setF({ reject_reason: '' });
                                          setModal('merchant-reject-payout');
                                        }} className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100">
                                          ✕ Cancel
                                        </button>
                                      ) : null}
                                      {!canApprove && !canReject ? (
                                        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold px-2 py-1">Finalized</span>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-slate-100 bg-gradient-to-br from-slate-50/70 to-slate-100/50 px-5 py-3.5 text-[11px] text-slate-600 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-rose-50 text-rose-600 text-[10px] font-black shrink-0">↑</span>
                          <span><strong className="text-rose-700">Sender (Debit)</strong> · Merchant settlement wallet debited immediately when payout is created — your gold-sale / POS-batch proceeds are reserved out the door.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-black shrink-0">↓</span>
                          <span><strong className="text-emerald-700">Receiver (Credit)</strong> · Saved bank account or on-chain crypto wallet receiving the funds. For banks: once the deposit physically arrives in your bank statement, click <strong>✅ Confirm Received</strong> with the wire reference to close the payout.</span>
                        </div>
                        <div><span className="inline-block rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 font-bold mr-2">PENDING BANK ARRIVAL</span> Your merchant wallet has already been debited. This row stays in PENDING until you confirm the funds physically arrived at the receiving bank from your saved bank statement deposit/transfer reference.</div>
                        <div><span className="inline-block rounded-full bg-green-100 text-green-800 px-2 py-0.5 font-bold mr-2">COMPLETED</span> You confirmed funds arrived at the receiver. Payout finalized, ledger closed, receipt is printable.</div>
                        <div><span className="inline-block rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 font-bold mr-2">CANCEL / REJECT</span> Reverse this withdrawal request — the debited amount is credited BACK to your merchant wallet automatically (only valid if you have NOT already received the funds in your bank).</div>
                      </div>
                    </div>}
              </div>
            </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-sky-50 shadow-sm">
              <div className="flex flex-col gap-4 border-b border-cyan-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600 text-xl text-white">$</div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-cyan-700">Merchant Virtual Account</div>
                      <h3 className="mt-1 text-lg font-bold text-slate-900">Fiat receiving account</h3>
                    </div>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm text-slate-600">Receive merchant bank transfers through Transak and route settled crypto to the merchant destination wallet. Customers do not create accounts here.</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => {
                    const merchantId = f.merchantId?.trim() || merchantWallet?.merchant_id?.trim() || '';
                    setF({ merchantId, asset: 'USDT', network: 'tron', fiatCurrency: 'GBP', paymentMethod: 'gbp_bank_transfer' });
                    setModal('virtual-account');
                  }} className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700">+ New Virtual Account</button>
                </div>
              </div>
              <div className="p-5">
                {virtualAccounts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-cyan-200 bg-white/70 px-5 py-8 text-center">
                    <div className="text-sm font-semibold text-slate-700">No merchant virtual accounts yet</div>
                    <div className="mt-1 text-xs text-slate-500">Create a live account to receive fiat transfers for this merchant.</div>
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {virtualAccounts.slice(0, 6).map(account => {
                      const details: any = account.accountDetails || {};
                      const source = details.source || {};
                      const bankAccount = details.bankAccount || source.bankAccount || {};
                      const bankLocalCode = details.bankLocalCode || source.bankLocalCode || {};
                      const destination = details.destination || {};
                      return (
                        <div key={account.id} className="rounded-xl border border-cyan-100 bg-white p-4 text-sm shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-slate-900">{source.fiatCurrency || account.currency} receiving account</div>
                              <div className="mt-1 font-mono text-[11px] text-slate-400">VBA {account.virtualAccountId}</div>
                            </div>
                            <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[10px] font-bold uppercase text-cyan-700">{account.status}</span>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Bank account</div><div className="mt-1 font-mono font-semibold text-slate-900">{bankAccount.value || 'Pending provider details'}</div></div>
                            <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">Routing / sort code</div><div className="mt-1 font-mono font-semibold text-slate-900">{bankLocalCode.value || 'Pending provider details'}</div></div>
                            <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2"><div className="text-[10px] uppercase tracking-wider text-slate-400">Crypto destination</div><div className="mt-1 break-all font-mono text-xs font-semibold text-slate-900">{destination.walletAddress || 'Pending provider details'}</div><div className="mt-1 text-xs text-slate-500">{destination.cryptoCurrency || '—'} · {destination.network || '—'}</div></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {(['wallet','bank','crypto'] as Tab[]).map(t => (
                <button key={t} onClick={()=>setTab(t)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${tab===t?'bg-white shadow text-blue-600':'text-gray-500 hover:text-gray-700'}`}>
                  {t==='wallet'?'ðŸ’³ Wallet':t==='bank'?'ðŸ¦ Bank':'â‚¿ Crypto'}
                </button>
              ))}
            </div>

            {/* WALLET */}
            {tab==='wallet' && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="font-bold text-gray-800 mb-4">Transaction History</h3>
                {walletTxns.filter((t:any) => t.source !== 'card_topup').length === 0
                  ? <p className="text-center text-gray-400 py-8">No transactions yet</p>
                  : <div className="space-y-2 max-h-96 overflow-y-auto">
                      {walletTxns.filter((t:any) => t.source !== 'card_topup').map((t, index) => (
                        <div key={t.id || `wallet-txn-${index}`} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${t.type==='credit'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{t.type==='credit'?'+':'â€“'}</div>
                            <div>
                              <div className="text-sm font-semibold text-gray-800">{sourceLabel(t.source)}</div>
                              <div className="text-xs text-gray-400">{new Date(t.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                          <div className={`font-bold ${t.type==='credit'?'text-green-600':'text-red-600'}`}>{t.type==='credit'?'+':'â€“'}${Number(t.amount).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}

            {/* BANK */}
            {tab==='bank' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-800">Bank Accounts</h3>
                  <button onClick={()=>{setF({});setModal('add-bank');}} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Add Bank</button>
                </div>
                {bankAccounts.length === 0
                  ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">No bank accounts</div>
                  : bankAccounts.map((b, index) => (
                      <div key={b.id || `bank-${index}`} onClick={()=>setSelBank(b.id)}
                        className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${selBank===b.id?'border-blue-400 ring-1 ring-blue-400':'border-gray-200'}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-bold text-gray-800">{b.bank_name}</div>
                            <div className="text-sm text-gray-500">{b.account_holder} Â· â€¢â€¢â€¢â€¢ {b.account_number.slice(-4)}</div>
                            {b.iban && <div className="text-xs text-gray-400">IBAN: {b.iban}</div>}
                            {b.swift_code && <div className="text-xs text-gray-400">SWIFT: {b.swift_code}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-gray-600">{b.currency}</div>
                            <button onClick={e=>{e.stopPropagation();setSelBank(b.id);setF({});setModal('bank-payout');}}
                              className="mt-1 bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium">Send Payout</button>
                          </div>
                        </div>
                      </div>
                    ))
                }
                {false && bankPayouts.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h4 className="font-bold text-gray-700 mb-3 text-sm">Payout History</h4>
                    {bankPayouts.map((p, index) => (
                      <div key={p.id || `payout-${index}`} className="flex justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <div className="font-medium">{p.bank_name} â€¢â€¢â€¢â€¢ {String(p.account_number).slice(-4)}</div>
                          <div className="text-xs text-gray-400">{new Date(p.created_at).toLocaleString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">${Number(p.net_amount).toFixed(2)}</div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${p.status==='PENDING'?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}`}>{p.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CRYPTO â€” PROFESSIONAL INTERNAL WALLET EXCHANGE */}
            {tab==='crypto' && (
              <div className="space-y-5">
                {/* Money Flow Visualization */}
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-5 text-white shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-300">Internal Wallet Loop</div>
                      <h3 className="mt-1 text-lg font-semibold">Money Flow Â· Card â†’ Wallet â†’ Crypto</h3>
                    </div>
                    <div className="text-xs text-slate-400">Atomic Â· Offline-hardened Â· Ledger-attested</div>
                  </div>
                  <div className="grid grid-cols-5 gap-2 items-center">
                    {[
                      {label:'Customer Card', sub:'Debit / Credit', icon:'ðŸ’³', amt:null, color:'from-sky-500/20 to-sky-500/5', border:'border-sky-400/30'},
                      {label:'Top-Up Engine', sub:'Auth â†’ Ledger', icon:'âš¡', amt:null, color:'from-violet-500/20 to-violet-500/5', border:'border-violet-400/30'},
                      {label:'Fiat Wallet', sub:`${balance.currency || 'USD'} Balance`, icon:'🏦', amt:balance.balance, color:'from-emerald-500/20 to-emerald-500/5', border:'border-emerald-400/30'},
                      {label:'Spot Engine', sub:'Internal Swap', icon:'ðŸ”', amt:null, color:'from-amber-500/20 to-amber-500/5', border:'border-amber-400/30'},
                      {label:'Crypto Vault', sub:'Cold-internal', icon:'ðŸª™', amt:cryptoWallets.reduce((s:number,w)=>s+Number(w.balance)*(coinPriceMap[w.crypto_coin]||0),0), color:'from-orange-500/20 to-orange-500/5', border:'border-orange-400/30'},
                    ].map((node, i, arr) => (
                      <React.Fragment key={`flow-node-${i}`}>
                        <div className={`relative rounded-2xl border ${node.border} bg-gradient-to-br ${node.color} p-3 backdrop-blur-sm`}>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="text-2xl">{node.icon}</div>
                            <div>
                              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-200">{node.label}</div>
                              <div className="text-[10px] text-slate-400">{node.sub}</div>
                            </div>
                          </div>
                          {node.amt !== null && (
                            <div className="mt-2 rounded-xl bg-black/30 px-2 py-1.5">
                              <div className="text-[10px] uppercase tracking-wider text-slate-400">Value</div>
                              <div className="text-sm font-bold text-white">${Number(node.amt).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                            </div>
                          )}
                        </div>
                        {i < arr.length - 1 && (
                          <div className="hidden md:flex flex-col items-center justify-center">
                            <div className="w-full h-0.5 bg-gradient-to-r from-white/20 via-white/60 to-white/20 relative">
                              <div className="absolute right-0 -top-[5px] w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[10px] border-l-white/60" />
                            </div>
                            <div className="text-[9px] text-slate-400 mt-1 uppercase tracking-wider">atomic</div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Portfolio Summary + Ticker Strip */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Portfolio Value</div>
                        <div className="mt-1 text-3xl font-extrabold text-slate-900 tracking-tight">
                          ${(
                            Number(balance.balance) +
                            cryptoWallets.reduce((s:number,w)=>s+Number(w.balance)*(coinPriceMap[w.crypto_coin]||0),0)
                          ).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Fiat ${Number(balance.balance).toLocaleString(undefined,{minimumFractionDigits:2})} Â· Crypto ${cryptoWallets.reduce((s:number,w)=>s+Number(w.balance)*(coinPriceMap[w.crypto_coin]||0),0).toLocaleString(undefined,{minimumFractionDigits:2})}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={()=>{if(isOnline){setF({});setModal('buy-crypto');}}} disabled={!isOnline}
                          className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all ${isOnline?'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500':'bg-emerald-300 cursor-not-allowed'}`}>
                          Buy Crypto
                        </button>
                        <button onClick={()=>{if(isOnline){setF({});setModal('sell-crypto');}}} disabled={!isOnline || cryptoWallets.every(w=>Number(w.balance)<=0)}
                          className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all ${(isOnline && cryptoWallets.some(w=>Number(w.balance)>0))?'bg-gradient-to-br from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500':'bg-rose-300 cursor-not-allowed'}`}>
                          Sell Crypto
                        </button>
                        <button onClick={()=>{if(isOnline){openTransak('BUY');}}} disabled={!isOnline}
                          className={`px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all border ${isOnline?'bg-white border-sky-500 text-sky-700 hover:bg-sky-50':'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          Buy via Transak
                        </button>
                        <button onClick={()=>{if(isOnline){openTransak('SELL');}}} disabled={!isOnline || cryptoWallets.every(w=>Number(w.balance)<=0)}
                          className={`px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all border ${(isOnline && cryptoWallets.some(w=>Number(w.balance)>0))?'bg-white border-amber-500 text-amber-700 hover:bg-amber-50':'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'}`}>
                          Sell via Transak
                        </button>
                      </div>
                    </div>

                    {/* Live mini ticker */}
                    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                      {COINS.map(coin => (
                        <div key={`ticker-${coin}`}
                          onClick={()=>{setSelCoin(coin); if(isOnline) getCryptoPrice(coin).then(r=>setCoinPriceMap(p=>({...p,[coin]:r.price})));}}
                          className={`group cursor-pointer rounded-xl px-3 py-2 border transition-all ${selCoin===coin?'border-emerald-400 bg-emerald-50 shadow-sm':'border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-white'}`}>
                          <div className="flex items-center gap-2">
                          <span className="text-lg leading-none"><CoinLogo coin={coin} size={20}/></span>
                            <div>
                              <div className="text-[11px] font-bold text-slate-800">{coin}</div>
                              <div className="text-[11px] font-semibold text-slate-500 tabular-nums">${(coinPriceMap[coin]||0).toLocaleString(undefined,{maximumFractionDigits:coinPriceMap[coin]&&coinPriceMap[coin]>100?2:6})}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Spot Engine Â· Status</div>
                    <div className="mt-3 space-y-2.5">
                      <div className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2">
                        <span className="text-xs text-slate-600">Engine Mode</span>
                        <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">INTERNAL Â· NO FEES</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2">
                        <span className="text-xs text-slate-600">Price Source</span>
                        <span className="text-xs font-semibold text-slate-800">CoinGecko Â· Spot</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2">
                        <span className="text-xs text-slate-600">Settlement</span>
                        <span className="text-xs font-semibold text-emerald-700">Instant Â· Atomic</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2">
                        <span className="text-xs text-slate-600">Ledger</span>
                        <span className="text-xs font-semibold text-indigo-700">Double-entry Â· DB Tx</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Asset Grid */}
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">Digital Asset Vault</h3>
                    <span className="text-xs text-slate-400">{cryptoWallets.length} asset{ cryptoWallets.length===1?'':'s'}</span>
                  </div>
                  {cryptoWallets.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center text-3xl mb-4">ðŸª™</div>
                      <div className="text-sm font-semibold text-slate-700 mb-1">No assets held</div>
                      <div className="text-xs text-slate-400 mb-4">Buy BTC, ETH, SOL or 9 other assets directly from your wallet.</div>
                      <button onClick={()=>{if(isOnline){setF({});setModal('buy-crypto');}}}
                        className="rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-sm">
                        Buy First Asset
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      <div className="grid grid-cols-12 gap-2 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 bg-slate-50/50">
                        <div className="col-span-3">Asset</div>
                        <div className="col-span-3 text-right">Balance</div>
                        <div className="col-span-2 text-right">Spot Rate</div>
                        <div className="col-span-2 text-right">Market Value</div>
                        <div className="col-span-2 text-right">Actions</div>
                      </div>
                      {cryptoWallets.map((w, index) => {
                        const price = coinPriceMap[w.crypto_coin] || 0;
                        const value = Number(w.balance) * price;
                        return (
                          <div key={w.id || `vault-${index}`} className="grid grid-cols-12 gap-2 px-5 py-3.5 items-center hover:bg-slate-50/50 transition">
                            <div className="col-span-3 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center text-white text-lg shadow-sm">
                                <CoinLogo coin={w.crypto_coin} size={32}/>
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 text-sm">{w.crypto_coin}</div>
                                <div className="text-[11px] text-slate-400">Internal Wallet Â· {selectedNetworkMap[w.crypto_coin]||'primary'}</div>
                              </div>
                            </div>
                            <div className="col-span-3 text-right">
                              <div className="font-bold text-slate-900 tabular-nums">{Number(w.balance).toLocaleString(undefined,{maximumFractionDigits:8})}</div>
                              <div className="text-[11px] text-slate-400">{w.crypto_coin}</div>
                            </div>
                            <div className="col-span-2 text-right">
                              <div className="text-sm font-semibold text-slate-700 tabular-nums">${price.toLocaleString(undefined,{maximumFractionDigits:price>100?2:6})}</div>
                              <div className="text-[10px] text-slate-400">USD / {w.crypto_coin}</div>
                            </div>
                            <div className="col-span-2 text-right">
                              <div className="font-extrabold text-slate-900 tabular-nums">${value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                            </div>
                            <div className="col-span-2 text-right flex justify-end gap-1.5">
                              <button onClick={()=>{setSelCoin(w.crypto_coin);setF({});setModal('buy-crypto');}}
                                className="rounded-lg bg-emerald-50 text-emerald-700 px-3 py-1.5 text-xs font-bold hover:bg-emerald-100 transition">Buy</button>
                              <button onClick={()=>{if(isOnline) openTransak('BUY', { defaultCryptoCurrency: w.crypto_coin });}} disabled={!isOnline}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${isOnline?'bg-sky-50 text-sky-700 hover:bg-sky-100':'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>Transak</button>
                              <button onClick={()=>{setSelCoin(w.crypto_coin);setF({});setModal('sell-crypto');}} disabled={Number(w.balance)<=0}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${Number(w.balance)>0?'bg-rose-50 text-rose-700 hover:bg-rose-100':'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>Sell</button>
                              <button onClick={()=>{setSelCoin(w.crypto_coin);setSelectedNetwork(getNetworkOptions(w.crypto_coin)[0]);setF({});setModal('withdraw-crypto');}} disabled={Number(w.balance)<=0}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${Number(w.balance)>0?'bg-orange-50 text-orange-700 hover:bg-orange-100':'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>Withdraw</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Quick Trade Panel + Transaction History */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                  {/* Quick Buy */}
                  <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-600">Express Buy</div>
                        <h3 className="mt-1 font-bold text-slate-900">Instant Swap Â· Fiat â†’ Crypto</h3>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">â†—</div>
                    </div>
                    <div className="mb-3">
                      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Asset</label>
                      <select value={selCoin} onChange={async e=>{setSelCoin(e.target.value); if(isOnline){const r=await getCryptoPrice(e.target.value); setCoinPrice(r.price); setCoinPriceMap(p=>({...p,[e.target.value]:r.price}));}}}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500">
                        {COINS.map(c=><option key={c} value={c}>{COIN_ICONS[c]||'ðŸª™'} {c} Â· ${(coinPriceMap[c]||0).toLocaleString(undefined,{maximumFractionDigits:coinPriceMap[c]&&coinPriceMap[c]>100?2:6})}</option>)}
                      </select>
                    </div>
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">USD Amount</label>
                        <span className="text-[11px] text-slate-400">Bal: ${Number(balance.balance).toLocaleString(undefined,{maximumFractionDigits:2})}</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input type="number" min="1" step="0.01"
                          value={f.fiatAmount||''}
                          onChange={e=>{
                            const usd = parseFloat(e.target.value||'0');
                            const price = coinPriceMap[selCoin]||0;
                            setF(p=>({...p,fiatAmount: isNaN(usd)?'':String(usd), cryptoAmount: price>0 && usd>0 ? (usd/price).toFixed(8) : ''}));
                          }}
                          placeholder="0.00" inputMode="decimal"
                          className="w-full pl-7 pr-3 py-3 rounded-xl border border-slate-200 bg-white text-lg font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                      </div>
                    </div>
                    <div className="flex gap-1.5 mb-3">
                      {[25,100,500,1000].map(amt=>(
                        <button key={`quick-${amt}`} type="button" onClick={()=>{
                          const price = coinPriceMap[selCoin]||0;
                          setF(p=>({...p,fiatAmount:String(amt), cryptoAmount: price>0?(amt/price).toFixed(8):''}));
                        }} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-bold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition">
                          ${amt}
                        </button>
                      ))}
                      <button type="button" onClick={()=>{
                        const max = Number(balance.balance);
                        const price = coinPriceMap[selCoin]||0;
                        setF(p=>({...p,fiatAmount:String(max), cryptoAmount: price>0 && max>0?(max/price).toFixed(8):''}));
                      }} className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">Max</button>
                    </div>
                    <div className="rounded-xl bg-slate-900 text-white p-3 mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">You receive</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">â‰ˆ</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <div className="text-2xl font-extrabold tabular-nums">{f.cryptoAmount ? Number(f.cryptoAmount).toLocaleString(undefined,{maximumFractionDigits:8}) : '0.00000000'}</div>
                        <div className="text-xs font-bold text-emerald-300">{selCoin}</div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Rate</span>
                        <span className="text-slate-200 tabular-nums">${(coinPriceMap[selCoin]||0).toLocaleString(undefined,{maximumFractionDigits:coinPriceMap[selCoin]&&coinPriceMap[selCoin]>100?2:6})} / {selCoin}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                        <span>Network</span>
                        <span className="text-slate-200">{selectedNetworkMap[selCoin]||getNetworkOptions(selCoin)[0]}</span>
                      </div>
                    </div>
                    <button onClick={()=>{if(!f.fiatAmount){addNotification('Enter amount','Enter a USD amount first','info');return;} if(!isOnline){addNotification('Offline','Crypto buys require internet','error');return;} setSelCoin(selCoin); setF({...f, amount:String(f.fiatAmount)}); handleBuyCrypto();}}
                      className="w-full py-3 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-sm hover:from-emerald-400 hover:to-emerald-500 transition-all">
                      Buy {selCoin} Now
                    </button>
                  </div>

                  {/* Tx History */}
                  <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                      <h3 className="font-bold text-slate-800">Transaction Ledger</h3>
                      <span className="text-xs text-slate-400">{cryptoTxns.length} records</span>
                    </div>
                    {cryptoTxns.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-400">No crypto transactions yet â€” use the Express Buy panel above.</div>
                    ) : (
                      <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                        {cryptoTxns.map((t, index) => {
                          const isBuy = t.transaction_type === 'buy';
                          return (
                            <div key={t.id || `ledger-${index}`} className="px-5 py-3.5 flex items-center gap-3 hover:bg-slate-50/50 transition">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-sm ${isBuy?'bg-gradient-to-br from-emerald-500 to-emerald-600':'bg-gradient-to-br from-rose-500 to-rose-600'}`}>
                                {isBuy?'â†—':'â†˜'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-slate-900">{isBuy?'Bought':'Sold'} {t.crypto_coin}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status==='completed'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{String(t.status||'PENDING').toUpperCase()}</span>
                                </div>
                                <div className="text-[11px] text-slate-400">{new Date(t.created_at).toLocaleString()} Â· Rate ${Number(t.exchange_rate).toLocaleString()}</div>
                              </div>
                              <div className="text-right">
                                <div className={`text-sm font-bold tabular-nums ${isBuy?'text-emerald-700':'text-rose-700'}`}>
                                  {isBuy?'+':'â€“'}{Number(t.crypto_amount).toLocaleString(undefined,{maximumFractionDigits:8})} {t.crypto_coin}
                                </div>
                                <div className="text-[11px] text-slate-500 tabular-nums">{isBuy?'â€“':'+'}${Number(t.fiat_amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 flex items-center justify-center min-h-64">
            <p className="text-gray-400">Select a customer to view wallet</p>
          </div>
        )}
      </div>

      {/* â•â• MODALS â•â• */}
      {/* ══ NEW CUSTOMER MODAL — full KYC ══ */}
      {modal==='create-customer' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeAll}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">New Customer</h3>
                <p className="text-xs text-gray-500 mt-0.5">Fill basic details now — complete KYC anytime from the profile page</p>
              </div>
              <button onClick={closeAll} className="text-gray-400 hover:text-gray-600 text-xl" type="button">✕</button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-5">

              {/* ── Basic info ── */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Basic Info <span className="text-red-400">*required</span></p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">{inp('name','Full Name *','text',true)}</div>
                  {inp('email','Email','email')}
                  {inp('phone','Phone','tel')}
                </div>
              </div>

              {/* ── Identity document ── */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Identity Document</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Doc Type</label>
                    <select value={f.id_type||''} onChange={e=>setF(p=>({...p,id_type:e.target.value}))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white">
                      <option value="">— select —</option>
                      {['PASSPORT','NATIONAL_ID','DRIVING_LICENSE','RESIDENT_ID','OTHER'].map(t=><option key={t} value={t}>{t.replace('_',' ')}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">{inp('id_number','Document Number')}</div>
                  {inp('id_expiry','Expiry (YYYY-MM-DD)')}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {inp('id_country','Issuing Country (e.g. ZA)')}
                  {inp('date_of_birth','Date of Birth (YYYY-MM-DD)')}
                  {inp('nationality','Nationality (e.g. ZA)')}
                  {inp('occupation','Occupation')}
                </div>
              </div>

              {/* ── Address ── */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Address</p>
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    {inp('address_line1','Address Line 1')}
                    {inp('address_line2','Address Line 2')}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {inp('city','City')}
                    {inp('postal_code','Postal Code')}
                    {inp('country','Country')}
                  </div>
                </div>
              </div>

              {/* ── KYC status ── */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">KYC Status</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">KYC Status</label>
                    <select value={f.kyc_status||'PENDING'} onChange={e=>setF(p=>({...p,kyc_status:e.target.value}))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white">
                      {['PENDING','VERIFIED','REJECTED'].map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Risk Level</label>
                    <select value={f.risk_level||'LOW'} onChange={e=>setF(p=>({...p,risk_level:e.target.value}))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500 bg-white">
                      {['LOW','MEDIUM','HIGH'].map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Notes ── */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Notes</label>
                <textarea rows={2} placeholder="Internal notes..."
                  value={f.notes||''} onChange={e=>setF(p=>({...p,notes:e.target.value}))}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition resize-none" />
              </div>

            </div>
            <div className="px-6 pb-5 flex gap-3 shrink-0 border-t border-gray-100 pt-4">
              <button onClick={closeAll} disabled={busy} type="button"
                className="flex-1 py-3 rounded-xl border border-gray-200 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={handleCreateCustomer} disabled={busy} type="button"
                className="flex-1 py-3 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                {busy ? '⏳ Creating...' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal==='topup' && <ModalShell onClose={closeAll} busy={busy} title="Top Up Wallet (Card Required)" onConfirm={handleTopup} confirmLabel="Top Up" confirmColor="bg-green-600 hover:bg-green-700">
        <p className="text-sm text-gray-500">Balance: <strong>{balance.currency} {Number(balance.balance).toFixed(2)}</strong></p>
        <div className="mt-2">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Amount (USD)</label>
          <input type="number" min="1" step="0.01" value={f.amount||''} onChange={e=>setF(p=>({...p,amount:e.target.value}))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
            placeholder="10.00" inputMode="decimal" />
        </div>
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Card Number</label>
          <input type="tel" value={f.topupPan||''} onChange={e=>setF(p=>({...p,topupPan: formatCardNumber(e.target.value)}))}
            placeholder="â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢" maxLength={23} autoComplete="cc-number" inputMode="numeric"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Expiry</label>
            <input type="tel" value={f.topupExpiry||''} onChange={e=>setF(p=>({...p,topupExpiry: formatExpiry(e.target.value)}))}
              placeholder="MM/YY" maxLength={5} autoComplete="cc-exp" inputMode="numeric"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">CVV</label>
            <input type="tel" value={f.topupCvv||''} onChange={e=>setF(p=>({...p,topupCvv: e.target.value.replace(/\D/g, '').slice(0, 4)}))}
              placeholder="123" maxLength={4} autoComplete="cc-csc" inputMode="numeric"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500" />
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-3">Enter a real card. Your wallet will only be credited after a real authorization response from a configured processor.</p>
        <p className="text-xs text-amber-600 mt-2">âš  Card details alone are not enough; the server now requires an authorization signal before crediting the wallet.</p>
      </ModalShell>}
      {modal==='debit' && <ModalShell onClose={closeAll} busy={busy} title="Debit Wallet" onConfirm={handleDebit} confirmLabel="Debit" confirmColor="bg-red-600 hover:bg-red-700"><p className="text-sm text-gray-500">Available: <strong>${Number(balance.balance).toFixed(2)}</strong></p>{inp('amount','Amount','number',true)}</ModalShell>}
      {modal==='transfer' && (
        <ModalShell onClose={closeAll} busy={busy} title="Wallet â†’ Wallet Transfer" onConfirm={handleTransfer} confirmLabel="Send" confirmColor="bg-indigo-600 hover:bg-indigo-700">
          <p className="text-sm text-gray-500">From: <strong>{sel?.name?.trim() || '(Unnamed Customer)'}</strong></p>
          <select value={f.receiverId||''} onChange={e=>setF(p=>({...p,receiverId:e.target.value}))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            <option value="">Select recipient...</option>
            {customers.filter(c=>c.id!==selId).map((c, index)=><option key={c.id || `recipient-${index}`} value={c.id}>{c.name?.trim() || '(Unnamed Customer)'}</option>)}
          </select>
          {inp('amount','Amount (USD)','number',true)}{inp('note','Note (optional)')}
        </ModalShell>
      )}
      {modal==='add-bank' && (
        <ModalShell onClose={closeAll} busy={busy} title="Add Bank Account" onConfirm={handleAddBank} confirmLabel="Add" confirmColor="bg-green-600 hover:bg-green-700">
          {inp('bankName','Bank Name','text',true)}{inp('holder','Account Holder','text',true)}{inp('accountNumber','Account Number','text',true)}
          {inp('routing','Routing Number (US)')}{inp('iban','IBAN (international)')}{inp('swift','SWIFT / BIC')}
          <select value={f.currency||'USD'} onChange={e=>setF(p=>({...p,currency:e.target.value}))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {['USD','EUR','GBP','AED','SAR','INR','CAD','AUD'].map(c=><option key={c}>{c}</option>)}
          </select>
        </ModalShell>
      )}
      {modal==='bank-payout' && (
        <ModalShell onClose={closeAll} busy={busy} title="Send Bank Payout" onConfirm={handleBankPayout} confirmLabel="Send" confirmColor="bg-green-600 hover:bg-green-700">
          <p className="text-sm text-gray-500">Available: <strong>{balance.currency} {Number(balance.balance).toFixed(2)}</strong></p>
          {bankAccounts.length===0 ? <p className="text-red-500 text-sm">Add a bank account first</p>
            : <select value={selBank} onChange={e=>setSelBank(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
                {bankAccounts.map((b, index)=><option key={b.id || `bank-option-${index}`} value={b.id}>{b.bank_name} · {b.currency || 'USD'} ····{b.account_number.slice(-4)}</option>)}
              </select>}
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Payout Currency</label>
          <select value={f.currency || balance.currency || 'USD'} onChange={e=>setF(p=>({...p,currency:e.target.value}))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {['USD','EUR','GBP','AED','SAR','INR','CAD','AUD'].map(c=><option key={c}>{c}</option>)}
          </select>
          {inp('amount','Amount','number',true)}
          {f.amount && <p className="text-sm text-green-700">Net: {f.currency || balance.currency || 'USD'} {(parseFloat(f.amount||'0')*0.995).toFixed(2)} (fee 0.5%)</p>}
        </ModalShell>
      )}
      {modal==='buy-crypto' && (() => {
        const price = coinPrice > 0 ? coinPrice : coinPriceMap[selCoin] || 0;
        const usdIn = parseFloat(f.amount || f.fiatAmount || '0') || 0;
        const coinOut = price > 0 ? usdIn / price : 0;
        return (
          <ModalShell onClose={closeAll} busy={busy} title={`Buy ${selCoin}`} onConfirm={handleBuyCrypto} confirmLabel={`Buy ${selCoin}`} confirmColor="bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500">
            <div className="space-y-4">
              <div className="rounded-xl bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 border border-emerald-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-600">Fiat Wallet</div>
                    <div className="mt-0.5 text-sm text-slate-500">{sel?.name || 'Customer'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Available</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">${Number(balance.balance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-emerald-100/60">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-500">Destination</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <span className="flex items-center gap-1.5"><CoinLogo coin={selCoin} size={18}/> {selCoin} Internal Vault</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Spot</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">${price.toLocaleString(undefined,{maximumFractionDigits:price>100?2:6})}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">Asset</label>
                <select value={selCoin} onChange={async e=>{setSelCoin(e.target.value); try{const r=await getCryptoPrice(e.target.value); setCoinPrice(r.price); setCoinPriceMap(p=>({...p,[e.target.value]:r.price}));}catch{/* Keep the last quoted price if refreshing fails. */}}}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500">
                  {COINS.map(c => (
                    <option key={c} value={c}>
                      {c}{coinPriceMap[c] ? ` · $${coinPriceMap[c].toLocaleString(undefined, { maximumFractionDigits: coinPriceMap[c] > 100 ? 2 : 6 })}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">Network</label>
                <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500">
                  {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">USD Spend</label>
                  {usdIn > 0 && usdIn > Number(balance.balance) && <span className="text-[10px] text-rose-600 font-bold">Insufficient balance</span>}
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold">$</span>
                  <input type="number" min="1" step="0.01" autoFocus
                    value={f.amount || f.fiatAmount || ''}
                    onChange={e=>setF(p=>({...p,amount:e.target.value, fiatAmount:e.target.value}))}
                    placeholder="0.00" inputMode="decimal"
                    className="w-full pl-8 pr-4 py-3.5 rounded-xl border border-slate-200 bg-white text-xl font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                </div>
                <div className="flex gap-1.5 mt-2">
                  {[25,100,250,1000].map(amt=>(
                    <button key={`quick-buy-${amt}`} type="button" onClick={()=>setF(p=>({...p,amount:String(amt),fiatAmount:String(amt)}))}
                      className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition">
                      ${amt}
                    </button>
                  ))}
                  <button type="button" onClick={()=>setF(p=>({...p,amount:String(balance.balance),fiatAmount:String(balance.balance)}))}
                    className="flex-1 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition">Max</button>
                </div>
              </div>

              {(price > 0) && (
                <div className="rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/30 to-emerald-500/10 flex items-center justify-center">â†—</div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/80 font-bold">You receive</div>
                        <div className="text-[10px] text-slate-400">Instant Â· Internal Settlement</div>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-emerald-400/20">No Fee</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <div className="text-3xl font-extrabold tabular-nums tracking-tight">
                      {usdIn>0 ? coinOut.toLocaleString(undefined,{maximumFractionDigits:8}) : '0.00000000'}
                    </div>
                    <div className="text-base font-bold text-emerald-300">{selCoin}</div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Spot Rate</span>
                      <span className="text-slate-200 tabular-nums font-semibold">${price.toLocaleString(undefined,{maximumFractionDigits:price>100?2:6})} / {selCoin}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Network</span>
                      <span className="text-slate-200 font-semibold">{selectedNetwork}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Trade Value</span>
                      <span className="text-slate-200 tabular-nums font-semibold">${usdIn.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ModalShell>
        );
      })()}
      {modal==='merchant-to-customer' && (
        <ModalShell
          onClose={closeAll} busy={busy}
          title="Send Funds to Customer"
          onConfirm={handleMerchantToCustomer}
          confirmLabel="Send Funds"
          confirmColor="bg-violet-600 hover:bg-violet-700"
        >
          {/* Merchant balance preview */}
          <div className="rounded-xl bg-violet-50 border border-violet-100 p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-500">Merchant Balance</div>
              <div className="text-xl font-bold text-violet-800">
                ${Number(merchantWallet?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-3xl">&#128176;</div>
          </div>

          {/* Customer selector */}
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mt-1">Select Customer</label>
          <select
            value={f.targetCustomerId || ''}
            onChange={e => setF(p => ({ ...p, targetCustomerId: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 text-sm outline-none transition"
          >
            <option value="">-- Choose a customer --</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.wallet_code ? ` (${c.wallet_code})` : ''}
              </option>
            ))}
          </select>

          {/* Amount */}
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Amount (USD)</label>
          <input
            type="number" min="0.01" step="0.01" placeholder="0.00"
            value={f.amount || ''}
            onChange={e => setF(p => ({ ...p, amount: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 text-sm outline-none transition"
          />

          {/* Optional note */}
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Note (optional)</label>
          <input
            type="text" placeholder="e.g. Bonus credit, refund..."
            value={f.note || ''}
            onChange={e => setF(p => ({ ...p, note: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 text-sm outline-none transition"
          />

          {/* Live preview */}
          {f.targetCustomerId && f.amount && parseFloat(f.amount) > 0 && (() => {
            const cust = customers.find(c => c.id === f.targetCustomerId);
            const amt = parseFloat(f.amount);
            return (
              <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-sm">
                <div className="font-semibold text-green-800">
                  &#10003; Send <span className="text-green-700">${amt.toFixed(2)}</span> to <span className="text-green-700">{cust?.name}</span>
                </div>
                {cust?.wallet_code && <div className="text-xs text-green-600 mt-0.5">Wallet: {cust.wallet_code}</div>}
              </div>
            );
          })()}
        </ModalShell>
      )}
      {modal==='merchant-approve-payout' && (
        <ModalShell onClose={closeAll} busy={busy} title="Confirm Funds Received in Your Bank" onConfirm={handleApprovePayout} confirmLabel="✅ Confirm Received in Bank" confirmColor="bg-green-600 hover:bg-green-700">
          {selPayout ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                <div className="text-xs uppercase tracking-[0.2em] text-green-700 font-bold">Final confirmation</div>
                <div className="mt-2 font-semibold">
                  You (the merchant) have already received <span className="text-green-800 font-extrabold">{selPayout.currency || 'USD'} {Number(selPayout.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> into the saved bank account you entered in Settings. Use this form to close the bookkeeping loop and mark the withdrawal COMPLETED.
                </div>
                <div className="mt-2 text-xs text-green-800/80">
                  ⚠ After confirmation, this withdrawal is FINAL. Database status will be set to <strong>COMPLETED</strong>.
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-slate-500 font-medium">Withdrawal ID</span><span className="font-mono text-slate-900 text-xs">{selPayout.id}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-medium">Amount</span><span className="font-extrabold text-slate-900">{selPayout.currency || 'USD'} {Number(selPayout.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-medium">Current status</span><span className="uppercase font-bold tracking-wide text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full text-[10px]">{String(selPayout.status || '').replace(/_/g, ' ')}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 font-medium">Provider</span><span className="font-semibold text-slate-900">{selPayout.provider || 'manual'}</span></div>
              </div>
              <FormInput f={f} setF={setF} name="wire_reference" placeholder="Your bank deposit/transfer reference number (from your bank statement)" required />
              <FormInput f={f} setF={setF} name="wire_note" placeholder="Optional note / merchant memo (e.g. deposited at branch #12, cash pickup ref)" />
            </div>
          ) : <div>No payout selected.</div>}
        </ModalShell>
      )}
      {modal==='merchant-reject-payout' && (
        <ModalShell onClose={closeAll} busy={busy} title="Cancel Withdrawal & Return to Wallet" onConfirm={handleRejectPayout} confirmLabel="✕ Cancel & Return to My Wallet" confirmColor="bg-rose-600 hover:bg-rose-700">
          {selPayout ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                <div className="text-xs uppercase tracking-[0.2em] text-rose-700 font-bold">Reverse withdrawal</div>
                <div className="mt-2 font-semibold">
                  Cancel the pending withdrawal <span className="font-mono text-xs">{selPayout.id}</span>. System will automatically RETURN <span className="font-extrabold text-rose-800">{selPayout.currency || 'USD'} {Number(selPayout.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> back into your merchant wallet balance.
                </div>
                <div className="mt-2 text-xs text-rose-800/80">
                  ⚠ Only use this if the money has NOT yet arrived in your saved bank account. If funds are already in your bank, use the Confirm Received button instead.
                </div>
              </div>
              <FormInput f={f} setF={setF} name="reject_reason" placeholder="Reason (e.g. changed bank, wrong account, cancelled)" required />
            </div>
          ) : <div>No payout selected.</div>}
        </ModalShell>
      )}
      {modal==='merchant-buy' && (
        <ModalShell onClose={closeAll} busy={busy} title="Merchant Buy Crypto" onConfirm={handleMerchantBuy} confirmLabel="Buy" confirmColor="bg-green-600 hover:bg-green-700">
          <p className="text-sm text-gray-500">Merchant: <strong>{f.merchantId||'(not set)'}</strong></p>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Asset</label>
          <select value={selCoin} onChange={e=>setSelCoin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {COINS.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
          <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
          </select>
          {inp('amount','USD amount to spend','number',true)}
          {coinPrice>0 && f.amount && <div className="rounded-xl border border-green-100 bg-green-50 p-3 text-sm">
            <div className="text-xl font-extrabold text-green-600">{(parseFloat(f.amount)/coinPrice).toFixed(8)} {selCoin}</div>
            <div className="mt-1 text-xs text-gray-500">Network: {selectedNetwork} Â· Spot rate: ${coinPrice.toLocaleString()} / {selCoin}</div>
          </div>}
        </ModalShell>
      )}
      {modal==='merchant-bank-payout' && (
        <ModalShell onClose={closeAll} busy={busy} title="Withdraw to Your Bank Account" onConfirm={handleMerchantBankPayout} confirmLabel="Request Withdrawal" confirmColor="bg-rose-600 hover:bg-rose-700">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            You are withdrawing <strong>your own gold-sale proceeds</strong> from your merchant wallet to the saved bank account you entered in Settings. Your merchant wallet balance will be debited <strong>immediately</strong>. Once the funds physically arrive in your bank (any method — deposit/cash/wire/ACH), return to payout history and click <strong>"Confirm Received"</strong> to close the bookkeeping loop. No API key required.
          </div>
          <p className="text-sm text-gray-500">Merchant: <strong>{f.merchantId || '(not set)'}</strong></p>
          {merchantWallet && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 mt-3">
              <div><strong>Available:</strong> {merchantWallet.currency} {Number(merchantWallet.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          )}

          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mt-3">Currency</label>
          <select value={f.currency || 'USD'} onChange={e => setF(p => ({ ...p, currency: e.target.value }))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {['USD','EUR','GBP','ZAR','NGN','KES','AED','INR'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {inp('amount','Payout amount','number',true)}

          {merchantWallet && f.amount && parseFloat(f.amount) > 0 && (
            <div className={`rounded-xl border p-3 text-sm ${parseFloat(f.amount) > Number(merchantWallet.balance || 0) ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {parseFloat(f.amount) > Number(merchantWallet.balance || 0)
                ? <div>⚠ Insufficient balance. Have {Number(merchantWallet.balance || 0).toFixed(2)}, need {parseFloat(f.amount).toFixed(2)}.</div>
                : <div>✓ Net payout: {(f.currency || 'USD')} {parseFloat(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <input id="adhocBankToggle" type="checkbox" checked={f.useAdhocBank === 'true'}
              onChange={e => setF(p => ({ ...p, useAdhocBank: e.target.checked ? 'true' : 'false' }))}
              className="w-4 h-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500" />
            <label htmlFor="adhocBankToggle" className="text-sm font-medium text-gray-700 cursor-pointer">Use ad-hoc bank details (not saved)</label>
          </div>

          {f.useAdhocBank !== 'true' && (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mt-3">Saved Bank Account</label>
              {merchantBankAccounts.length === 0
                ? <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-1">
                    No saved accounts. Enable "Ad-hoc" above or configure a bank account in Settings → Banking.
                  </div>
                : <select value={selMerchantBank} onChange={e => setSelMerchantBank(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm mt-1">
                    {merchantBankAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.bank_name} · {acc.account_holder} · ***{String(acc.account_number || '').slice(-4)} · {acc.currency}
                        {Number(acc.is_default) === 1 ? ' (Default)' : ''}
                        {Number(acc.verified) === 0 ? ' · UNVERIFIED' : ''}
                      </option>
                    ))}
                  </select>}
            </>
          )}

          {f.useAdhocBank === 'true' && (
            <div className="space-y-3 mt-4 border-t border-gray-100 pt-3">
              <FormInput f={f} setF={setF} name="adhocBankName" placeholder="Bank name (e.g. Standard Bank, Barclays, Chase)" required />
              <FormInput f={f} setF={setF} name="adhocAccountHolder" placeholder="Account holder name (exact match to bank)" required />
              <FormInput f={f} setF={setF} name="adhocAccountNumber" placeholder="Account number or IBAN" required />
              <div className="grid grid-cols-2 gap-2">
                <FormInput f={f} setF={setF} name="adhocRouting" placeholder="Routing / Sort (optional)" />
                <FormInput f={f} setF={setF} name="adhocSwift" placeholder="SWIFT / BIC (optional)" />
              </div>
              <FormInput f={f} setF={setF} name="adhocIban" placeholder="IBAN (optional - if separate)" />
            </div>
          )}
        </ModalShell>
      )}
      {modal==='hot-wallet-payout' && (
        <ModalShell onClose={closeAll} busy={busy} title="Hot Wallet Delivery" onConfirm={handleHotWalletPayout} confirmLabel="Send from Hot Wallet" confirmColor="bg-orange-600 hover:bg-orange-700">
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
            This sends a real on-chain payout through the merchant hot-wallet rail. No simulation or demo fallback is allowed.
          </div>
          <p className="text-sm text-gray-500">Merchant: <strong>{f.merchantId || '(not set)'}</strong></p>
          
          {/* Authorized Merchant Information */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mt-3">
            <h3 className="text-sm font-bold text-blue-900 mb-3">📋 Authorized Merchant Information</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-blue-700 mb-1">Authorized Person Name</label>
                <input 
                  type="text" 
                  value={f.authorizedPersonName || ''} 
                  onChange={e => setF(p => ({ ...p, authorizedPersonName: e.target.value }))} 
                  placeholder="Full name of person authorizing payout"
                  className="w-full px-3 py-2.5 rounded-lg border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500/20" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-blue-700 mb-1">Authorization Role/Title</label>
                <input 
                  type="text" 
                  value={f.authorizationRole || ''} 
                  onChange={e => setF(p => ({ ...p, authorizationRole: e.target.value }))} 
                  placeholder="e.g., CFO, Finance Manager, Owner"
                  className="w-full px-3 py-2.5 rounded-lg border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500/20" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-blue-700 mb-1">Contact Email</label>
                <input 
                  type="email" 
                  value={f.authorizedEmail || ''} 
                  onChange={e => setF(p => ({ ...p, authorizedEmail: e.target.value }))} 
                  placeholder="authorized.person@business.com"
                  className="w-full px-3 py-2.5 rounded-lg border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500/20" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-blue-700 mb-1">Contact Phone</label>
                <input 
                  type="tel" 
                  value={f.authorizedPhone || ''} 
                  onChange={e => setF(p => ({ ...p, authorizedPhone: e.target.value }))} 
                  placeholder="+1234567890"
                  className="w-full px-3 py-2.5 rounded-lg border border-blue-200 text-sm focus:ring-2 focus:ring-blue-500/20" 
                />
              </div>
            </div>
          </div>

          {/* Business Information */}
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 mt-3">
            <h3 className="text-sm font-bold text-purple-900 mb-3">🏢 Business Information</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">Business Legal Name</label>
                <input 
                  type="text" 
                  value={f.businessName || ''} 
                  onChange={e => setF(p => ({ ...p, businessName: e.target.value }))} 
                  placeholder="Legal registered business name"
                  className="w-full px-3 py-2.5 rounded-lg border border-purple-200 text-sm focus:ring-2 focus:ring-purple-500/20" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">Business Registration Number</label>
                <input 
                  type="text" 
                  value={f.businessRegNumber || ''} 
                  onChange={e => setF(p => ({ ...p, businessRegNumber: e.target.value }))} 
                  placeholder="Company registration number"
                  className="w-full px-3 py-2.5 rounded-lg border border-purple-200 text-sm focus:ring-2 focus:ring-purple-500/20" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">Business Address</label>
                <textarea 
                  value={f.businessAddress || ''} 
                  onChange={e => setF(p => ({ ...p, businessAddress: e.target.value }))} 
                  placeholder="Full registered business address"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg border border-purple-200 text-sm focus:ring-2 focus:ring-purple-500/20" 
                  required 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">Business Phone</label>
                  <input 
                    type="tel" 
                    value={f.businessPhone || ''} 
                    onChange={e => setF(p => ({ ...p, businessPhone: e.target.value }))} 
                    placeholder="+1234567890"
                    className="w-full px-3 py-2.5 rounded-lg border border-purple-200 text-sm focus:ring-2 focus:ring-purple-500/20" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">Tax ID / VAT Number</label>
                  <input 
                    type="text" 
                    value={f.taxId || ''} 
                    onChange={e => setF(p => ({ ...p, taxId: e.target.value }))} 
                    placeholder="Tax identification number"
                    className="w-full px-3 py-2.5 rounded-lg border border-purple-200 text-sm focus:ring-2 focus:ring-purple-500/20" 
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Payout Details */}
          <div className="space-y-3 mt-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Asset</label>
            <select value={f.asset || 'USDT'} onChange={e => setF(p => ({ ...p, asset: e.target.value }))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
              {['USDT', 'BTC', 'ETH', 'BNB', 'SOL'].map(asset => <option key={asset} value={asset}>{asset}</option>)}
            </select>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
            <input type="text" value={f.network || ''} onChange={e => setF(p => ({ ...p, network: e.target.value }))} placeholder="tron, bsc, ethereum..." className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm" required />
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Destination address</label>
            <input type="text" value={f.address || ''} onChange={e => setF(p => ({ ...p, address: e.target.value }))} placeholder="Recipient on-chain address" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono" required />
            {inp('amount', 'USD amount', 'number', true)}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Payout Reason / Notes</label>
              <textarea 
                value={f.payoutReason || ''} 
                onChange={e => setF(p => ({ ...p, payoutReason: e.target.value }))} 
                placeholder="Purpose of this payout (e.g., Monthly settlement, Supplier payment, Refund)"
                rows={2}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm" 
              />
            </div>
            
            {/* Save Business Info Checkbox */}
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <input 
                type="checkbox" 
                id="saveBusinessInfo"
                checked={f.saveBusinessInfo === 'true'}
                onChange={e => {
                  setF(p => ({ ...p, saveBusinessInfo: e.target.checked ? 'true' : 'false' }));
                  if (e.target.checked) {
                    // Save to localStorage
                    const businessData = {
                      authorizedPersonName: f.authorizedPersonName || '',
                      authorizationRole: f.authorizationRole || '',
                      authorizedEmail: f.authorizedEmail || '',
                      authorizedPhone: f.authorizedPhone || '',
                      businessName: f.businessName || '',
                      businessRegNumber: f.businessRegNumber || '',
                      businessAddress: f.businessAddress || '',
                      businessPhone: f.businessPhone || '',
                      taxId: f.taxId || ''
                    };
                    localStorage.setItem('businessInfo', JSON.stringify(businessData));
                  }
                }}
                className="w-4 h-4 text-blue-600 bg-white border-blue-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="saveBusinessInfo" className="text-sm font-semibold text-blue-900 cursor-pointer">
                💾 Save business information for future payouts
              </label>
            </div>
          </div>
        </ModalShell>
      )}
      {modal==='virtual-account' && (
        <ModalShell onClose={closeAll} busy={busy} title="Create Transak Virtual Account" onConfirm={handleCreateVirtualAccount} confirmLabel="Create Live Account" confirmColor="bg-cyan-600 hover:bg-cyan-700">
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
            Verify the merchant’s Transak email first. This creates one live merchant receiving account; customers do not create virtual accounts.
          </div>
          <p className="text-sm text-gray-500">Merchant: <strong>{f.merchantId || '(not set)'}</strong></p>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Merchant Transak email</label>
            <div className="mt-2 flex gap-2">
              <input type="email" value={f.merchantEmail || ''} onChange={e => setF(p => ({ ...p, merchantEmail: e.target.value, transakOtpVerified: '' }))} placeholder="merchant@example.com" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
              <div className="flex gap-1.5"><button type="button" onClick={handleSendMerchantOtp} disabled={busy} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Send OTP</button><button type="button" onClick={handleOnboardMerchantAuthReliance} disabled={busy} className="rounded-xl border border-cyan-600 px-3 py-2 text-xs font-semibold text-cyan-700 disabled:opacity-50">Auth Reliance</button></div>
            </div>
            {f.transakOtpSent === 'true' && !f.transakOtpVerified && <div className="mt-3 flex gap-2"><input type="text" inputMode="numeric" maxLength={8} value={f.transakOtp || ''} onChange={e => setF(p => ({ ...p, transakOtp: e.target.value.replace(/\D/g, '') }))} placeholder="Enter OTP" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono" /><button type="button" onClick={handleVerifyMerchantOtp} disabled={busy} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Verify</button></div>}
            {f.transakOtpVerified === 'true' && <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><span>Merchant Transak authentication verified.</span><div className="flex gap-1.5"><button type="button" onClick={handleRefreshMerchantSession} disabled={busy} className="rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 shadow-sm disabled:opacity-50">Refresh</button><button type="button" onClick={handleLogoutMerchantSession} disabled={busy} className="rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-rose-700 shadow-sm disabled:opacity-50">Logout</button></div></div>}
            {f.transakUserEmail && <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"><div><span className="font-semibold">Verified email:</span> {f.transakUserEmail}</div><div className="mt-1"><span className="font-semibold">KYC:</span> {f.transakKycStatus || 'UNKNOWN'} · {f.transakKycType || 'UNKNOWN'}</div></div>}
            {f.transakOtpVerified === 'true' && (f.limitDaily || f.limitMonthly || f.limitYearly) && <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Daily left</div><div className="mt-1 text-xs font-bold text-slate-800">{f.fiatCurrency || 'GBP'} {Number(f.limitDaily || 0).toFixed(2)}</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">30 days left</div><div className="mt-1 text-xs font-bold text-slate-800">{f.fiatCurrency || 'GBP'} {Number(f.limitMonthly || 0).toFixed(2)}</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-400">Year left</div><div className="mt-1 text-xs font-bold text-slate-800">{f.fiatCurrency || 'GBP'} {Number(f.limitYearly || 0).toFixed(2)}</div></div></div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Fiat currency</label>
              <select value={f.fiatCurrency || 'GBP'} onChange={e => setF(p => ({ ...p, fiatCurrency: e.target.value }))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
                {['GBP', 'EUR', 'USD'].map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Payment method</label>
              <select value={f.paymentMethod || 'gbp_bank_transfer'} onChange={e => setF(p => ({ ...p, paymentMethod: e.target.value }))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
                <option value="gbp_bank_transfer">GBP bank transfer</option>
                <option value="sepa_bank_transfer">SEPA bank transfer</option>
                <option value="usd_bank_transfer">USD bank transfer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Crypto asset</label>
              <select value={f.asset || 'USDT'} onChange={e => setF(p => ({ ...p, asset: e.target.value, transakWalletVerified: '' }))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
                {['USDT', 'USDC', 'BTC', 'ETH'].map(asset => <option key={asset} value={asset}>{asset}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
              <input value={f.network || 'tron'} onChange={e => setF(p => ({ ...p, network: e.target.value, transakWalletVerified: '' }))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Trust Wallet / Destination Address (where crypto will be sent)</label>
            <div className="mt-2 flex gap-2">
              <input value={f.address || ''} onChange={e => setF(p => ({ ...p, address: e.target.value, transakWalletVerified: '' }))} placeholder="Your Trust Wallet address (e.g., TXyz...123)" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono" required />
              <button type="button" onClick={handleVerifyMerchantWalletAddress} disabled={busy} className="rounded-xl border border-emerald-600 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50">Verify</button>
            </div>
            {f.transakWalletVerified === 'true' && <div className="mt-2 text-xs font-semibold text-emerald-700">✓ Trust Wallet address verified by Transak.</div>}
            {f.transakWalletVerified === 'false' && <div className="mt-2 text-xs font-semibold text-rose-700">✗ Wallet address was not accepted by Transak. Please check the address and network.</div>}
          </div>
          {virtualAccounts.length > 0 && <p className="text-xs text-gray-500">Existing live records: {virtualAccounts.length}</p>}
        </ModalShell>
      )}
      {modal==='sell-crypto' && (() => {
        const price = coinPrice > 0 ? coinPrice : coinPriceMap[selCoin] || 0;
        const cw = cryptoWallets.find(w => w.crypto_coin === selCoin);
        const balance = cw ? Number(cw.balance) : 0;
        const coinIn = parseFloat(f.amount || f.cryptoAmount || '0') || 0;
        const usdOut = price > 0 ? coinIn * price : 0;
        return (
          <ModalShell onClose={closeAll} busy={busy} title={`Sell ${selCoin}`} onConfirm={handleSellCrypto} confirmLabel={`Sell ${selCoin}`} confirmColor="bg-gradient-to-br from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500">
            <div className="space-y-4">
              <div className="rounded-xl bg-gradient-to-br from-rose-50 via-white to-rose-50/50 border border-rose-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-600">Crypto Vault</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <span className="flex items-center gap-1.5"><CoinLogo coin={selCoin} size={18}/> {selCoin} Balance</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Holding</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">{balance.toLocaleString(undefined,{maximumFractionDigits:8})} {selCoin}</div>
                    <div className="text-[10px] text-slate-400 tabular-nums">â‰ˆ ${(balance*price).toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-rose-100/60">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-600">Credit</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-800">Fiat Wallet Â· USD</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Spot</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">${price.toLocaleString(undefined,{maximumFractionDigits:price>100?2:6})}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">Asset to Sell</label>
                <select value={selCoin} onChange={async e=>{setSelCoin(e.target.value); try{const r=await getCryptoPrice(e.target.value); setCoinPrice(r.price); setCoinPriceMap(p=>({...p,[e.target.value]:r.price}));}catch{/* Keep the last quoted price if refreshing fails. */}}}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500">
                  {cryptoWallets.filter(w=>Number(w.balance)>0).length===0
                    ? <option value="">No crypto balances available</option>
                    : cryptoWallets.filter(w=>Number(w.balance)>0).map((w,i)=><option key={w.id||`sell-opt-${i}`} value={w.crypto_coin}>{w.crypto_coin} · {Number(w.balance).toLocaleString(undefined,{maximumFractionDigits:6})}</option>)
                  }
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">Network</label>
                <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500">
                  {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{selCoin} Amount</label>
                  {coinIn > 0 && coinIn > balance && <span className="text-[10px] text-rose-600 font-bold">Insufficient balance</span>}
                </div>
                <div className="relative">
                  <input type="number" min="0" step="0.00000001" autoFocus
                    value={f.amount || f.cryptoAmount || ''}
                    onChange={e=>setF(p=>({...p,amount:e.target.value, cryptoAmount:e.target.value}))}
                    placeholder="0.00000000" inputMode="decimal"
                    className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-white text-xl font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">{selCoin}</span>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {[0.25, 0.5, 0.75, 1].map((pct,i)=>(
                    <button key={`sell-pct-${i}`} type="button" onClick={()=>setF(p=>({...p,amount:String(Number((balance*pct).toFixed(8))),cryptoAmount:String(Number((balance*pct).toFixed(8)))}))}
                      className="flex-1 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition">
                      {Math.round(pct*100)}%
                    </button>
                  ))}
                  <button type="button" onClick={()=>setF(p=>({...p,amount:String(Number(balance.toFixed(8))),cryptoAmount:String(Number(balance.toFixed(8)))}))}
                    className="flex-1 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition">Max</button>
                </div>
              </div>

              {(price > 0) && (
                <div className="rounded-xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-400/30 to-rose-500/10 flex items-center justify-center">â†˜</div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-rose-300/80 font-bold">Fiat You Receive</div>
                        <div className="text-[10px] text-slate-400">Instant Â· Internal Settlement</div>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-400/15 text-emerald-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-emerald-400/20">No Fee</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <div className="text-slate-400 text-base font-bold">$</div>
                    <div className="text-3xl font-extrabold tabular-nums tracking-tight text-emerald-300">
                      {coinIn>0 ? usdOut.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '0.00'}
                    </div>
                    <div className="text-base font-bold text-slate-300">USD</div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Spot Rate</span>
                      <span className="text-slate-200 tabular-nums font-semibold">${price.toLocaleString(undefined,{maximumFractionDigits:price>100?2:6})} / {selCoin}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Network</span>
                      <span className="text-slate-200 font-semibold">{selectedNetwork}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Tokens Sold</span>
                      <span className="text-slate-200 tabular-nums font-semibold">{coinIn.toLocaleString(undefined,{maximumFractionDigits:8})} {selCoin}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ModalShell>
        );
      })()}

      {modal==='withdraw-crypto' && (
        <ModalShell
          onClose={() => { setModal(null); setF({}); }}
          busy={busy}
          title={`Withdraw ${selCoin}`}
          onConfirm={handleWithdrawCrypto}
          confirmLabel={`Send ${selCoin}`}
          confirmColor="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500"
        >
          {(() => {
            const currentWal = cryptoWallets.find(w => w.crypto_coin === selCoin);
            const bal = Number(currentWal?.balance || 0);
            const addr = (f.address || '').trim();
            const isUsdt = selCoin === 'USDT';
            const looksTron = addr.startsWith('T') && addr.length >= 34;
            const looksEvm = /^0x[a-fA-F0-9]{40}$/.test(addr);
            const directRails = DIRECT_RAIL_NETWORKS[selCoin] || [];
            const isDirectRail = directRails.includes(selectedNetwork);
            let autoSwitchHint: React.ReactNode = null;

            if (isUsdt && looksTron && selectedNetwork !== 'tron') {
              autoSwitchHint = (
                <button type="button"
                  onClick={() => setSelectedNetwork('tron')}
                  className="text-xs w-full mt-1 text-left text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-lg px-2.5 py-1.5 hover:bg-cyan-100 transition">
                  Detected TronLink/T-address → click to switch to TRON (TRC-20) direct rail
                </button>
              );
            } else if (isUsdt && looksEvm && !['bsc', 'polygon'].includes(selectedNetwork)) {
              autoSwitchHint = (
                <div className="flex gap-1.5 w-full mt-1">
                  <button type="button"
                    onClick={() => setSelectedNetwork('bsc')}
                    className="text-xs flex-1 text-left text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 hover:bg-amber-100 transition">
                    EVM 0x detected → BSC (BEP-20)
                  </button>
                  <button type="button"
                    onClick={() => setSelectedNetwork('polygon')}
                    className="text-xs flex-1 text-left text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1.5 hover:bg-purple-100 transition">
                    Polygon (ERC-20)
                  </button>
                </div>
              );
            }

            return (
              <div className="space-y-4">
                {/* Trust Wallet withdrawal info banner */}
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                  <strong>💰 Withdraw to Trust Wallet:</strong> Send your crypto directly to your Trust Wallet or any external wallet. Make sure the network matches your wallet address.
                  <div className="mt-2 text-xs text-orange-800">
                    <strong>⚠️ Important:</strong> Double-check your address and network. Crypto transactions are irreversible!
                  </div>
                </div>

                {/* Available balance banner */}
                <div className="rounded-xl bg-slate-900 text-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Available</div>
                      <div className="mt-1 text-2xl font-extrabold tabular-nums">
                        {bal.toFixed(8)} <span className="text-lg text-slate-400">{selCoin}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => setF(p => ({ ...p, amount: String(bal) }))}
                      disabled={bal <= 0}
                      className="rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 px-3 py-2 text-xs font-bold text-white border border-white/15 transition">
                      MAX
                    </button>
                  </div>
                </div>

                {/* Crypto selection */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Asset</label>
                  <select value={selCoin} onChange={e => { setSelCoin(e.target.value); setSelectedNetwork(getNetworkOptions(e.target.value)[0]); }}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20">
                    {cryptoWallets.filter(w => Number(w.balance) > 0).map((w, i) => (
                      <option key={w.id || i} value={w.crypto_coin}>
                        {w.crypto_coin} · Balance: {Number(w.balance).toFixed(6)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Network */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Network</label>
                  <select value={selectedNetwork} onChange={e => setSelectedNetwork(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20">
                    {getNetworkOptions(selCoin).map(net => {
                      const isDirect = (DIRECT_RAIL_NETWORKS[selCoin] || []).includes(net);
                      return (
                        <option key={net} value={net}>
                          {net.toUpperCase()}{isDirect ? ' ⚡ Direct Rail' : ' (Exchange)'}
                        </option>
                      );
                    })}
                  </select>
                  {selCoin === 'USDT' && selectedNetwork === 'tron' && (
                    <p className="text-xs text-emerald-600 mt-1.5 font-medium">✅ TRC-20 selected — Direct blockchain rail. 0 exchange, 0 KYC, 0 Travel Rule.</p>
                  )}
                  {selCoin === 'USDT' && selectedNetwork === 'bsc' && (
                    <p className="text-xs text-amber-600 mt-1.5 font-medium">✅ BEP-20 selected — Direct BSC blockchain rail. 0 exchange, 0 KYC.</p>
                  )}
                  {selCoin === 'USDT' && selectedNetwork === 'polygon' && (
                    <p className="text-xs text-purple-600 mt-1.5 font-medium">✅ Polygon selected — Direct Polygon blockchain rail. 0 exchange, 0 KYC.</p>
                  )}
                  {selCoin === 'USDT' && !['tron', 'bsc', 'polygon'].includes(selectedNetwork) && (
                    <p className="text-xs text-amber-700 mt-1.5 font-medium">⚠️ Exchange-mediated path. For TronLink/Trust Wallet USDT, choose TRON/BSC/Polygon above for instant direct rail.</p>
                  )}
                </div>

                {/* Destination address */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Destination Address (Trust Wallet / External Wallet)
                  </label>
                  <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
                    <strong>📱 Trust Wallet Users:</strong> Open Trust Wallet → Select {selCoin} → Tap "Receive" → Copy your address
                  </div>
                  <input type="text"
                    placeholder={
                      selCoin === 'USDT' && selectedNetwork === 'tron'
                        ? 'Trust Wallet TRC-20 address (starts with T...)'
                        : selCoin === 'USDT' && (selectedNetwork === 'bsc' || selectedNetwork === 'polygon')
                        ? 'Trust Wallet 0x address (BEP-20 / Polygon ERC-20)'
                        : 'Your wallet address where you want to receive crypto'
                    }
                    value={f.address || ''}
                    onChange={e => setF(p => ({ ...p, address: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500/20" />
                  {autoSwitchHint}
                  {addr && addr.length > 10 && (
                    <div className="mt-2 text-xs">
                      {(() => {
                        const isTronAddr = addr.startsWith('T') && addr.length >= 34;
                        const isEvmAddr = /^0x[a-fA-F0-9]{40}$/.test(addr);
                        if (selCoin === 'USDT' && selectedNetwork === 'tron' && isTronAddr) {
                          return <span className="text-emerald-600 font-semibold">✓ Valid Tron address detected</span>;
                        }
                        if (selCoin === 'USDT' && (selectedNetwork === 'bsc' || selectedNetwork === 'polygon') && isEvmAddr) {
                          return <span className="text-emerald-600 font-semibold">✓ Valid {selectedNetwork.toUpperCase()} address detected</span>;
                        }
                        if (selCoin === 'USDT' && selectedNetwork === 'tron' && !isTronAddr) {
                          return <span className="text-rose-600 font-semibold">⚠️ Tron addresses start with "T"</span>;
                        }
                        if (selCoin === 'USDT' && (selectedNetwork === 'bsc' || selectedNetwork === 'polygon') && !isEvmAddr) {
                          return <span className="text-rose-600 font-semibold">⚠️ {selectedNetwork.toUpperCase()} addresses start with "0x"</span>;
                        }
                        return <span className="text-slate-500">Address entered</span>;
                      })()}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Amount</label>
                  <div className="relative">
                    <input type="number" min="0" step="0.000001" placeholder="0.000000"
                      value={f.amount || ''} onChange={e => setF(p => ({ ...p, amount: e.target.value }))}
                      className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-white text-xl font-extrabold focus:outline-none focus:ring-2 focus:ring-orange-500/20" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">{selCoin}</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[25, 50, 75, 100].map(pct => (
                      <button key={pct} type="button"
                        onClick={() => setF(p => ({ ...p, amount: String(Number((bal * pct / 100).toFixed(8))) }))}
                        disabled={bal <= 0}
                        className="flex-1 rounded-lg border border-slate-200 bg-white disabled:opacity-40 text-xs font-bold text-slate-600 hover:bg-slate-50 py-1.5 transition">
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deduction source + delivery preview (DIRECT RAIL ONLY) */}
                {isDirectRail && (() => {
                  const amt = parseFloat(f.amount || '0') || 0;
                  const fee = selectedNetwork === 'tron'
                    ? 'TRX gas (hot wallet pays ~0.3 TRX)'
                    : selectedNetwork === 'bsc'
                    ? 'BNB gas (hot wallet pays ~0.0005 BNB)'
                    : 'MATIC gas (hot wallet pays ~0.01 MATIC)';
                  const receives = amt > 0 ? amt : 0;
                  const remaining = amt > 0 ? Number((bal - amt).toFixed(8)) : bal;
                  return (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Deduction Source</span>
                        <span className="font-bold text-slate-800">Customer Internal Balance</span>
                      </div>
                      <div className="h-px bg-slate-200" />
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Deducted from this customer</span>
                        <span className="font-extrabold text-slate-900 tabular-nums">
                          {amt.toFixed(8)} <span className="text-slate-400 font-bold">{selCoin}</span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Customer balance after</span>
                        <span className="font-bold text-slate-600 tabular-nums">
                          {remaining.toFixed(8)} <span className="text-slate-400 font-bold">{selCoin}</span>
                        </span>
                      </div>
                      <div className="h-px bg-slate-200" />
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Delivery</span>
                        <span className="font-bold text-emerald-700">Exact amount</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Recipient receives (Trust Wallet)</span>
                        <span className="font-extrabold text-emerald-700 tabular-nums">
                          {receives.toFixed(8)} <span className="text-emerald-500 font-bold">{selCoin}</span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Network fee</span>
                        <span className="font-semibold text-emerald-700">{fee} · Platform pays</span>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <span className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Physical delivery</span>
                        <span className="font-semibold text-slate-700">Hot wallet → {selectedNetwork.toUpperCase()} chain</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Route / info banner */}
                <div className={`rounded-xl border p-3 text-xs ${
                  isDirectRail
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  {isDirectRail
                    ? <>⚡ <strong>Direct blockchain rail</strong> via {selectedNetwork.toUpperCase()}. Customer internal balance is deducted; hot wallet delivers USDT on-chain. Customer receives the EXACT withdrawal amount. Network fees ({selectedNetwork === 'tron' ? 'TRX' : selectedNetwork === 'bsc' ? 'BNB' : 'MATIC'} gas) are paid by the platform hot wallet — nothing is subtracted from the customer's USDT.</>
                    : <>⚠️ <strong>Exchange-mediated path</strong> selected. Withdrawal will attempt {selectedNetwork.toUpperCase()} via exchange. If you are sending to TronLink (T-address) or Trust Wallet (0x-address), choose TRON / BSC / Polygon above for guaranteed instant delivery with 0 exchange friction.</>
                  }
                </div>

                {/* Irreversible warning */}
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
                  ⛔ Crypto withdrawals are <strong>irreversible</strong>. Triple-check the address ({addr?.slice(0,10) || '...'}{addr ? '…' : ''}) and network ({selectedNetwork.toUpperCase()}) before confirming.
                </div>
              </div>
            );
          })()}
        </ModalShell>
      )}

      {/* ── Send Customer Asset to Hot Wallet ──────────────────────────── */}
      {modal==='send-to-hot-wallet' && sel && (
        <ModalShell
          onClose={closeAll} busy={busy}
          title="Send to Hot Wallet"
          onConfirm={handleSendToHotWallet}
          confirmLabel="🔥 Sweep to Hot Wallet"
          confirmColor="bg-gradient-to-br from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500"
        >
          {/* Warning */}
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            🔥 This moves the customer's assets into the merchant hot wallet. The debit is <strong>final and irreversible</strong>.
          </div>

          {/* Customer + merchant */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-semibold text-slate-800">{sel.name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Merchant</span><span className="font-mono text-xs text-slate-700">{f.merchantId || merchantWallet?.merchant_id || '—'}</span></div>
          </div>

          {/* Asset type */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Asset Type</label>
            <div className="flex gap-2">
              {(['fiat', 'crypto'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => setF(p => ({ ...p, sthAssetType: t, sthCoin: '', sthAmount: '' }))}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition ${
                    f.sthAssetType === t
                      ? t === 'fiat' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-orange-500 bg-orange-50 text-orange-800'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  {t === 'fiat' ? '💵 Fiat (USD)' : '🪙 Crypto'}
                </button>
              ))}
            </div>
          </div>

          {/* Fiat balance */}
          {f.sthAssetType === 'fiat' && (
            <div className="rounded-xl bg-emerald-900 text-white p-4 flex items-center justify-between">
              <span className="text-sm text-emerald-300 uppercase tracking-wider">Available</span>
              <span className="text-2xl font-extrabold tabular-nums">
                {balance.currency} {Number(balance.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Crypto coin selector */}
          {f.sthAssetType === 'crypto' && (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Coin</label>
                <select value={f.sthCoin || ''} onChange={e => setF(p => ({ ...p, sthCoin: e.target.value, sthAmount: '' }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400/20">
                  <option value="">Select coin...</option>
                  {cryptoWallets.filter(w => Number(w.balance) > 0).map(w => (
                    <option key={w.id} value={w.crypto_coin}>
                      {w.crypto_coin} — Balance: {Number(w.balance).toFixed(6)}
                    </option>
                  ))}
                </select>
              </div>
              {f.sthCoin && (
                <div className="rounded-xl bg-orange-900 text-white p-4 flex items-center justify-between">
                  <span className="text-sm text-orange-300 uppercase tracking-wider">Available</span>
                  <span className="text-2xl font-extrabold tabular-nums">
                    {Number(cryptoWallets.find(w => w.crypto_coin === f.sthCoin)?.balance || 0).toFixed(6)} {f.sthCoin}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Amount */}
          {f.sthAssetType && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Amount {f.sthAssetType === 'fiat' ? '(USD)' : f.sthCoin ? `(${f.sthCoin})` : ''}
              </label>
              <div className="relative">
                <input type="number" min="0.000001" step="any"
                  value={f.sthAmount || ''}
                  onChange={e => setF(p => ({ ...p, sthAmount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-4 py-3.5 rounded-xl border border-slate-200 text-xl font-extrabold focus:outline-none focus:ring-2 focus:ring-red-400/20"
                />
                <button type="button"
                  onClick={() => {
                    if (f.sthAssetType === 'fiat') setF(p => ({ ...p, sthAmount: String(balance.balance) }));
                    else { const bal = cryptoWallets.find(w => w.crypto_coin === f.sthCoin)?.balance || 0; setF(p => ({ ...p, sthAmount: String(bal) })); }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600 transition">
                  MAX
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                {[25, 50, 75, 100].map(pct => {
                  const max = f.sthAssetType === 'fiat'
                    ? Number(balance.balance)
                    : Number(cryptoWallets.find(w => w.crypto_coin === f.sthCoin)?.balance || 0);
                  return (
                    <button key={pct} type="button"
                      onClick={() => setF(p => ({ ...p, sthAmount: String(Number((max * pct / 100).toFixed(8))) }))}
                      disabled={max <= 0}
                      className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Reason <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="text" value={f.sthReason || ''}
              onChange={e => setF(p => ({ ...p, sthReason: e.target.value }))}
              placeholder="e.g. Settlement, Fee collection, Manual sweep..."
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/20"
            />
          </div>

          {/* Summary */}
          {f.sthAssetType && f.sthAmount && parseFloat(f.sthAmount) > 0 && (
            <div className="rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 p-3 text-sm text-red-900">
              Sweeping <strong>{f.sthAssetType === 'fiat' ? `$${parseFloat(f.sthAmount).toFixed(2)} USD` : `${f.sthAmount} ${f.sthCoin}`}</strong> from <strong>{sel.name}</strong> → 🔥 hot wallet
            </div>
          )}
        </ModalShell>
      )}

      <TransakWidgetModal
        open={transakOpen}
        onClose={() => setTransakOpen(false)}
        flow={transakFlow}
        defaultCryptoCurrency={transakPresets.defaultCryptoCurrency}
        defaultNetwork={transakPresets.defaultNetwork}
        defaultFiatAmount={transakPresets.defaultFiatAmount}
        defaultFiatCurrency={transakPresets.defaultFiatCurrency}
        partnerCustomerId={transakPresets.partnerCustomerId}
        walletCode={transakPresets.walletCode}
        walletAddress={transakPresets.walletAddress}
        onOrderSuccessful={handleTransakOrderSuccessful}
        onOrderFailed={handleTransakOrderFailed}
        onOrderCancelled={(o) => addNotification('Transak Order Cancelled', `Order ${o?.id || 'n/a'} was cancelled.`, 'info')}
        size="xl"
      />
    </div>
  );
};