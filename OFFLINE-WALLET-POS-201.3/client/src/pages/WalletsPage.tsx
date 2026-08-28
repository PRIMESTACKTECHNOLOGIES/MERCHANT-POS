import React, { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  getCustomers, createCustomer,
  fetchSettings,
  getWalletBalance, getWalletTransactions, topupWallet, topupWalletWithCard, debitWallet,
  walletTransfer,
  getVirtualCards, issueVirtualCard, topupVirtualCard, freezeCard, unfreezeCard,
  getBankAccounts, addBankAccount, bankPayout, getBankPayouts,
  getCryptoWallets, getCryptoPrice, buyCryptoWithWallet, sellCrypto, getCryptoTransactions,
  buyCryptoWithMerchant,
  type Customer, type WalletBalance, type WalletTransaction,
  type VirtualCard, type BankAccount, type BankPayout,
  type CryptoWallet, type CryptoTransaction,
} from "../lib/api";
import { resolveApiBaseUrl } from "../lib/backendUrl";
import { useNotifications } from "../contexts/NotificationContext";
import "../styles/wallet-codepen-theme.css";
import {
  enqueue, cacheBalance, getCachedBalance, applyLocalBalance, pendingCount as offlinePending
} from "../lib/offline-queue";

type Tab = 'wallet' | 'virtual-cards' | 'bank' | 'crypto';
type Modal =
  | 'create-customer' | 'topup' | 'debit' | 'transfer'
  | 'issue-card' | 'topup-card' | 'add-bank' | 'bank-payout'
  | 'buy-crypto' | 'sell-crypto' | 'merchant-buy' | null;

const COINS = ['BTC','ETH','USDT','SOL','DOGE','BNB','XRP','ADA','AVAX','LINK','MATIC'];
const COIN_ICONS: Record<string,string> = {
  BTC:'₿', ETH:'Ξ', USDT:'₮', SOL:'◎', DOGE:'Ð',
  BNB:'🟡', XRP:'◈', ADA:'₳', AVAX:'🔺', LINK:'⬡', MATIC:'🟣'
};
const NETWORK_OPTIONS: Record<string, string[]> = {
  BTC: ['bitcoin', 'lightning'],
  ETH: ['ethereum', 'arbitrum', 'optimism'],
  USDT: ['ethereum', 'tron', 'solana'],
  SOL: ['solana', 'spl'],
  DOGE: ['dogecoin'],
  BNB: ['bsc'],
  XRP: ['ripple'],
  ADA: ['cardano'],
  AVAX: ['avalanche'],
  LINK: ['ethereum'],
  MATIC: ['polygon'],
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

// ── Stable module-level components (no re-mount on parent re-render) ──────────
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
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl" type="button">✕</button>
      </div>
      <div className="p-6 space-y-3">{children}</div>
      <div className="px-6 pb-6 flex gap-3">
        <button onClick={onClose} disabled={busy} type="button"
          className="flex-1 py-3 rounded-xl border border-gray-200 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
        <button onClick={onConfirm} disabled={busy} type="button"
          className={`flex-1 py-3 rounded-xl font-medium text-white ${confirmColor} disabled:opacity-50`}>
          {busy ? '⏳ Processing...' : confirmLabel}
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
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [selCard, setSelCard] = useState<VirtualCard|null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankPayouts, setBankPayouts] = useState<BankPayout[]>([]);
  const [selBank, setSelBank] = useState('');
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [cryptoTxns, setCryptoTxns] = useState<CryptoTransaction[]>([]);
  const [selCoin, setSelCoin] = useState('BTC');
  const [selectedNetwork, setSelectedNetwork] = useState('bitcoin');
  const [coinPrice, setCoinPrice] = useState(0);
  const [f, setF] = useState<Record<string,string>>({});
  const sel = customers.find(c => c.id === selId);

  useEffect(() => {
    const up = () => { setIsOnline(true); setQueuedOps(offlinePending()); };
    const dn = () => setIsOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', dn);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', dn); };
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
      if (s?.merchant_id) {
        // store merchant id in form state for merchant buy
        setF(p => ({ ...p, merchantId: s.merchant_id }));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selId) return;
    getWalletBalance(selId).then(b => { setBalance(b); cacheBalance(selId, Number(b.balance), b.currency); })
      .catch(() => { const c = getCachedBalance(selId); if (c) setBalance(c); });
    getWalletTransactions(selId).then(setWalletTxns).catch(()=>{});
    getVirtualCards(selId).then(setCards).catch(()=>{});
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

  const refreshWallet = async () => {
    if (!selId) return;
    try {
      const [bal, wt] = await Promise.all([getWalletBalance(selId), getWalletTransactions(selId)]);
      setBalance(bal); setWalletTxns(wt); cacheBalance(selId, Number(bal.balance), bal.currency);
    } catch { const c = getCachedBalance(selId); if (c) setBalance(c); }
    setQueuedOps(offlinePending());
  };
  const refreshCards = async () => { if (selId) setCards(await getVirtualCards(selId)); };
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
  const act = async (fn: ()=>Promise<void>, msg: string) => {
    setBusy(true);
    try { await fn(); if (msg) addNotification('Success', msg, 'success'); closeAll(); }
    catch (e:any) { addNotification('Error', e.message||'Error', 'error'); }
    finally { setBusy(false); }
  };
  const inp = (name:string, ph:string, type='text', req=false) =>
    <FormInput key={`inp-${name}`} f={f} setF={setF} name={name} placeholder={ph} type={type} required={req} />;

  // Handlers
  const handleCreateCustomer = () => act(async () => {
    if (!f.name?.trim()) throw new Error('Name required');
    const c = await createCustomer(f.name, f.email, f.phone);
    setCustomers(p => [...p, c]); setSelId(c.id);
    // Fetch and display wallet ID
    try {
      const walBal = await getWalletBalance(c.id);
      addNotification('Wallet Created', `Customer wallet ready — ID: ${c.id}`, 'success');
    } catch {}
  }, 'Customer created');

  const handleTopup = () => act(async () => {
    if (!selId) throw new Error('No customer selected');
    const amt = parseFloat(f.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid USD top-up amount');
    const pan = cleanCardNumber(f.topupPan || '');
    const expiry = f.topupExpiry || '';
    const cvv = (f.topupCvv || '').trim();
    if (!pan || pan.length < 13 || pan.length > 19) throw new Error('Enter a valid card number');
    if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) throw new Error('Enter card expiry as MM/YY');
    if (!cvv || !/^\d{3,4}$/.test(cvv)) throw new Error('Enter a valid CVV');
    const panMasked = '*'.repeat(pan.length - 4) + pan.slice(-4);

    if (!isOnline) {
      const op = enqueue('wallet_topup_card', {
        customerId: selId,
        amount: amt,
        cardNumber: pan,
        panMasked,
        expiry,
        cvv,
      });
      applyLocalBalance(selId, amt);
      setBalance(prev => ({ ...prev, balance: prev.balance + amt }));
      setQueuedOps(offlinePending());
      addNotification('Queued for Sync', `Card top-up of $${amt.toFixed(2)} is queued and will be applied when the connection returns.`, 'success');
      return;
    }

    const result = await topupWalletWithCard(selId, amt, pan, panMasked, expiry, cvv);
    await refreshWallet();
    addNotification('Top Up Complete', `Amount $${amt.toFixed(2)} credited. Auth: ${result.authCode || 'N/A'}${result.processorId ? ` · Processor: ${result.processorId}` : ''}`, 'success');
  }, '');

  const handleDebit = () => act(async () => {
    if (!selId) throw new Error('No customer');
    const amt = parseFloat(f.amount);
    if (!isOnline) { const c=getCachedBalance(selId); if(c&&c.balance<amt) throw new Error('Insufficient balance'); enqueue('wallet_debit',{customerId:selId,amount:amt,source:'admin_debit'}); applyLocalBalance(selId,-amt); }
    else await debitWallet(selId, amt, 'admin_debit');
    await refreshWallet();
  }, `Debited $${f.amount}`);

  const handleTransfer = () => act(async () => {
    if (!selId) throw new Error('No customer');
    const amt = parseFloat(f.amount);
    if (!isOnline) { enqueue('wallet_transfer',{senderCustomerId:selId,receiverCustomerId:f.receiverId,amount:amt,note:f.note}); applyLocalBalance(selId,-amt); }
    else await walletTransfer(selId, f.receiverId, amt, f.note);
    await refreshWallet();
  }, 'Transfer sent');

  const handleIssueCard = () => act(async () => {
    if (!selId) throw new Error('No customer');
    const card = await issueVirtualCard(selId, f.name||sel?.name||'Card Holder', f.currency||'USD');
    addNotification('Card Issued', `Number: ${(card as any).cardNumber}  CVV: ${(card as any).cvv}`, 'success');
    await refreshWallet(); await refreshCards();
  }, '');

  const handleTopupCard = () => act(async () => {
    if (!selId||!selCard) throw new Error('Select a card');
    await topupVirtualCard(selId, selCard.id, parseFloat(f.amount));
    await refreshWallet(); await refreshCards();
  }, `Card topped up $${f.amount}`);

  const handleAddBank = () => act(async () => {
    if (!selId) throw new Error('No customer');
    await addBankAccount({customerId:selId,bankName:f.bankName,accountHolder:f.holder,accountNumber:f.accountNumber,routingNumber:f.routing,iban:f.iban,swiftCode:f.swift,currency:f.currency||'USD'});
    await refreshBank();
  }, 'Bank account added');

  const handleBankPayout = () => act(async () => {
    if (!selId||!selBank) throw new Error('Select bank account');
    await bankPayout(selId, selBank, parseFloat(f.amount));
    await refreshWallet(); await refreshBank();
  }, `Payout of $${f.amount} initiated`);

  const handleBuyCrypto = () => act(async () => {
    if (!selId) throw new Error('No customer');
    if (!isOnline) throw new Error('Online connection required for crypto purchases');
    const amt = parseFloat(f.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid USD amount to spend');
    await buyCryptoWithWallet(selId, selCoin, amt, selectedNetwork);
    await refreshCrypto();
    await refreshWallet();
  }, `Bought ${selCoin}`);

  const handleMerchantBuy = () => act(async () => {
    const merchantId = f.merchantId || '';
    if (!merchantId) throw new Error('Merchant ID not configured');
    if (!isOnline) throw new Error('Online connection required for merchant buys');
    const amt = parseFloat(f.amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid USD amount to spend');
    await buyCryptoWithMerchant(merchantId, selCoin, amt, selectedNetwork);
    addNotification('Success', `Merchant bought ${selCoin} on ${selectedNetwork} for $${amt}`, 'success');
    closeAll();
  }, 'Merchant buy executed');

  const handleSellCrypto = () => act(async () => {
    if (!selId) throw new Error('No customer');
    if (!isOnline) throw new Error('Crypto sell requires internet');
    await sellCrypto(selId, selCoin, parseFloat(f.amount), selectedNetwork);
    await refreshWallet(); await refreshCrypto();
  }, `Sold ${selCoin}`);


  return (
    <div className="animate-fade-in space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> PrimeStack 201.3 Offline
            </div>
            <h1 className="mt-3 text-2xl font-bold">Customer Wallets</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">Manage fiat, cards, bank payouts, and crypto purchases with an offline-first experience designed for live retail flow.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => { setF({}); setModal('merchant-buy'); }}
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/25">Merchant Buy Crypto</button>
            <button onClick={() => { setF({}); setModal('create-customer'); }}
              className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400">+ New Customer</button>
          </div>
        </div>
      </div>

      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <span>📡</span>
          <div className="flex-1">
            <div className="font-semibold text-amber-800 text-sm">Offline mode</div>
            <div className="text-amber-600 text-xs">Operations queued locally — syncing when reconnected{queuedOps>0?` (${queuedOps} pending)`:''}</div>
          </div>
        </div>
      )}
      {isOnline && queuedOps > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3">
          <span>🔄</span>
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
              <button key={c.id} onClick={() => setSelId(c.id)}
                className={`w-full text-left p-3 rounded-lg mb-1 text-sm transition-all ${selId===c.id?'bg-blue-50 border border-blue-200 text-blue-700':'hover:bg-gray-50 text-gray-700'}`}>
                <div className="font-semibold">{c.name}</div>
                {c.wallet_code && <div className="text-xs font-mono text-blue-500">{c.wallet_code}</div>}
                {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
              </button>
            ))
          }
        </div>

        {sel ? (
          <div className="lg:col-span-3 space-y-4">
            {/* Balance hero — wp-card theme, correct ISO 7810 ID-1 bank card ratio */}
            <div className="wp-card-wrap wp-card-balance-hero">
              <div className="wp-card wp-card-balance">
                <div className="wp-card-head">
                  <div style={{display:'flex',alignItems:'center',gap:'0.8em'}}>
                    <div className="wp-card-chip" />
                    <div>
                      <div className="wp-card-label">Fiat Balance</div>
                      <div className="wp-card-sub">{sel.name}{sel.email ? ` · ${sel.email}` : ''}</div>
                      {sel.wallet_code && <div className="wp-card-sub" style={{fontFamily:'monospace',fontSize:'0.65rem',opacity:0.7}}>{sel.wallet_code}</div>}
                    </div>
                  </div>
                  <div className="wp-card-wifi">
                    <span /><span /><span /><span />
                  </div>
                </div>

                <div className="wp-card-amount">
                  {balance.currency} {Number(balance.balance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                </div>

                <div className="wp-card-foot">
                  <div className="wp-card-number">
                    <span>••••</span><span>••••</span><span>••••</span><span>••••</span>
                  </div>
                  <div style={{display:'flex',gap:'0.5em'}}>
                    <button onClick={()=>{setF({});setModal('topup');}} className="wp-card-pill" style={{cursor:'pointer'}}>+ Top Up</button>
                    <button onClick={()=>{setF({});setModal('debit');}} className="wp-card-pill" style={{cursor:'pointer'}}>– Debit</button>
                    <button onClick={()=>{setF({});setModal('transfer');}} className="wp-card-pill" style={{cursor:'pointer'}}>⇄ Transfer</button>
                    <button onClick={()=>{setF({});setModal('bank-payout');}} className="wp-card-pill" style={{cursor:'pointer',background:'rgba(34,197,94,0.25)'}}>🏦 Payout</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {(['wallet','virtual-cards','bank','crypto'] as Tab[]).map(t => (
                <button key={t} onClick={()=>setTab(t)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${tab===t?'bg-white shadow text-blue-600':'text-gray-500 hover:text-gray-700'}`}>
                  {t==='wallet'?'💳 Wallet':t==='virtual-cards'?'🔐 Cards':t==='bank'?'🏦 Bank':'₿ Crypto'}
                </button>
              ))}
            </div>

            {/* WALLET */}
            {tab==='wallet' && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="font-bold text-gray-800 mb-4">Transaction History</h3>
                {walletTxns.length === 0
                  ? <p className="text-center text-gray-400 py-8">No transactions yet</p>
                  : <div className="space-y-2 max-h-96 overflow-y-auto">
                      {walletTxns.map(t => (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${t.type==='credit'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{t.type==='credit'?'+':'–'}</div>
                            <div>
                              <div className="text-sm font-semibold text-gray-800">{sourceLabel(t.source)}</div>
                              <div className="text-xs text-gray-400">{new Date(t.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                          <div className={`font-bold ${t.type==='credit'?'text-green-600':'text-red-600'}`}>{t.type==='credit'?'+':'–'}${Number(t.amount).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}

            {/* VIRTUAL CARDS */}
            {tab==='virtual-cards' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-800">Virtual Cards</h3>
                  <button onClick={()=>{setF({});setModal('issue-card');}} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Issue Card</button>
                </div>
                {cards.length === 0
                  ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">No cards — issue one to get started</div>
                  : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {cards.map(card => {
                        const frozen = card.status?.toUpperCase() === 'FROZEN';
                        const mm = String(card.expiry_month||0).padStart(2,'0');
                        const yy = String(card.expiry_year||0).slice(-2);
                        const maskedParts = (card.masked_number||'**** **** **** ****').split(' ');
                        const isFlipped = flippedCardId === card.id;
                        return (
                          <div key={card.id} className="flex flex-col gap-3">
                            <div
                              className={`wp-card-wrap wp-card-id1 cursor-pointer ${selCard?.id===card.id?'wp-card-selected':''}`}
                              onClick={() => {
                                setSelCard(card);
                                setFlippedCardId(prev => prev === card.id ? null : card.id);
                              }}
                            >
                              <div className={`wp-card wp-card-dark ${frozen?'wp-card-frozen':''} ${isFlipped?'wp-card-flipped':''}`}>
                                <div className="wp-card-face">
                                  <div className="wp-card-head">
                                    <div style={{display:'flex',alignItems:'center',gap:'0.7em'}}>
                                      <div className="wp-card-chip" />
                                      <div>
                                        <div className="wp-card-label">{card.card_type||'VISA'}</div>
                                        <div className="wp-card-pill" style={{marginTop:'0.2em',fontSize:'0.6rem'}}>{frozen?'FROZEN':'ACTIVE'}</div>
                                      </div>
                                    </div>
                                    <div className="wp-card-wifi"><span /><span /><span /><span /></div>
                                  </div>

                                  <div className="wp-card-number">
                                    {maskedParts.map((s,i)=><span key={i}>{s}</span>)}
                                  </div>

                                  <div className="wp-card-foot">
                                    <div>
                                      <div className="wp-card-block-label">Cardholder</div>
                                      <div className="wp-card-block-value">{card.cardholder_name}</div>
                                    </div>
                                    <div>
                                      <div className="wp-card-block-label">Expires</div>
                                      <div className="wp-card-block-value">{mm}/{yy}</div>
                                    </div>
                                    <div>
                                      <div className="wp-card-block-label">Balance</div>
                                      <div className="wp-card-block-value" style={{color:'#34d399',fontWeight:700}}>${Number(card.balance).toFixed(2)}</div>
                                    </div>
                                    <div className="wp-card-brand wp-brand-visa">VISA</div>
                                  </div>
                                </div>

                                <div className="wp-card-face wp-card-face-back">
                                  <div className="wp-card-magstripe" />
                                  <div className="wp-card-sig-cvv">
                                    <div className="wp-card-signature" />
                                    <div className="wp-card-cvv">***</div>
                                  </div>
                                  <div className="px-4 pt-3 text-sm text-slate-200">
                                    <div className="font-semibold uppercase tracking-[0.2em] text-[10px] text-slate-400">PrimeStack Multi-Currency Card</div>
                                    <div className="mt-2 text-xs leading-5 text-slate-300">Use this card for secure top-ups, wallet loading, and domestic or cross-border spending. Keep your CVV private and never share it with anyone.</div>
                                  </div>
                                  <div className="absolute bottom-4 right-4 text-[11px] uppercase tracking-[0.25em] text-slate-400">Secure</div>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button onClick={e=>{e.stopPropagation();setSelCard(card);setF({});setModal('topup-card');}}
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">+ Top Up</button>
                              <button onClick={e=>{e.stopPropagation();act(async()=>{frozen?await unfreezeCard(selId!,card.id):await freezeCard(selId!,card.id);await refreshCards();},frozen?'Card unfrozen':'Card frozen');}}
                                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${frozen?'bg-emerald-50 text-emerald-700 hover:bg-emerald-100':'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>{frozen?'🔓 Unfreeze':'🔒 Freeze'}</button>
                            </div>
                          </div>
                        );
                      })}
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
                  : bankAccounts.map(b => (
                      <div key={b.id} onClick={()=>setSelBank(b.id)}
                        className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${selBank===b.id?'border-blue-400 ring-1 ring-blue-400':'border-gray-200'}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-bold text-gray-800">{b.bank_name}</div>
                            <div className="text-sm text-gray-500">{b.account_holder} · •••• {b.account_number.slice(-4)}</div>
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
                {bankPayouts.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h4 className="font-bold text-gray-700 mb-3 text-sm">Payout History</h4>
                    {bankPayouts.map(p => (
                      <div key={p.id} className="flex justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <div className="font-medium">{p.bank_name} •••• {String(p.account_number).slice(-4)}</div>
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

            {/* CRYPTO */}
            {tab==='crypto' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-800">Crypto Wallets</h3>
                  <div className="flex gap-2">
                    <button onClick={()=>{if(isOnline){setF({});setModal('buy-crypto');}}} disabled={!isOnline}
                      className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${isOnline?'bg-orange-500 hover:bg-orange-600 bg-orange-500':'bg-orange-200 cursor-not-allowed'}`}>🟢 Buy</button>
                    <button onClick={()=>{if(isOnline){setF({});setModal('sell-crypto');}}} disabled={!isOnline}
                      className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${isOnline?'bg-purple-600 hover:bg-purple-700 bg-purple-600':'bg-purple-200 cursor-not-allowed'}`}>🔴 Sell</button>
                  </div>
                </div>
                {cryptoWallets.length === 0
                  ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">No crypto yet — buy some above</div>
                  : <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {cryptoWallets.map(w => (
                        <div key={w.id} className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-xl p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-2xl mb-1">{COIN_ICONS[w.crypto_coin]||'🪙'}</div>
                              <div className="font-bold text-sm">{w.crypto_coin}</div>
                              <div className="text-lg font-extrabold text-amber-400">{Number(w.balance).toFixed(8)}</div>
                            </div>
                            <div className="text-xs text-right">
                              <div>Wallet ID</div>
                              <div className="font-mono text-[10px]">{w.id}</div>
                            </div>
                          </div>
                          {w.crypto_address && (
                            <div className="mt-3 bg-white/10 rounded p-2 text-xs flex items-center justify-between">
                              <div className="truncate mr-3">{w.crypto_address}</div>
                              <button onClick={()=>{navigator.clipboard?.writeText(w.crypto_address||''); addNotification('Copied','Address copied to clipboard','success');}}
                                className="ml-2 text-[11px] bg-white/10 px-2 py-1 rounded">Copy</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                }
                {cryptoTxns.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h4 className="font-bold text-gray-700 mb-3 text-sm">Crypto Transactions</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {cryptoTxns.map(t => (
                        <div key={t.id} className="flex justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-2">
                            <span>{t.transaction_type==='buy'?'🟢':'🔴'}</span>
                            <div>
                              <div className="font-semibold">{t.transaction_type==='buy'?'Bought':'Sold'} {t.crypto_coin}</div>
                              <div className="text-xs text-gray-400">{new Date(t.created_at).toLocaleString()} @ ${Number(t.exchange_rate).toLocaleString()}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-indigo-600">{Number(t.crypto_amount).toFixed(8)} {t.crypto_coin}</div>
                            <div className="text-xs text-gray-500">${Number(t.fiat_amount).toFixed(2)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 flex items-center justify-center min-h-64">
            <p className="text-gray-400">Select a customer to view wallet</p>
          </div>
        )}
      </div>

      {/* ══ MODALS ══ */}
      {modal==='create-customer' && <ModalShell onClose={closeAll} busy={busy} title="New Customer" onConfirm={handleCreateCustomer} confirmLabel="Create">{inp('name','Full Name','text',true)}{inp('email','Email (optional)','email')}{inp('phone','Phone (optional)','tel')}</ModalShell>}
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
            placeholder="•••• •••• •••• ••••" maxLength={23} autoComplete="cc-number" inputMode="numeric"
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
        <p className="text-sm text-gray-500 mt-3">Enter a real card. Your wallet will be credited after successful processor authorization.</p>
        <p className="text-xs text-amber-600 mt-2">⚠ Real card details required — topup is processed through the payment network.</p>
      </ModalShell>}
      {modal==='debit' && <ModalShell onClose={closeAll} busy={busy} title="Debit Wallet" onConfirm={handleDebit} confirmLabel="Debit" confirmColor="bg-red-600 hover:bg-red-700"><p className="text-sm text-gray-500">Available: <strong>${Number(balance.balance).toFixed(2)}</strong></p>{inp('amount','Amount','number',true)}</ModalShell>}
      {modal==='transfer' && (
        <ModalShell onClose={closeAll} busy={busy} title="Wallet → Wallet Transfer" onConfirm={handleTransfer} confirmLabel="Send" confirmColor="bg-indigo-600 hover:bg-indigo-700">
          <p className="text-sm text-gray-500">From: <strong>{sel?.name}</strong></p>
          <select value={f.receiverId||''} onChange={e=>setF(p=>({...p,receiverId:e.target.value}))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            <option value="">Select recipient...</option>
            {customers.filter(c=>c.id!==selId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {inp('amount','Amount (USD)','number',true)}{inp('note','Note (optional)')}
        </ModalShell>
      )}
      {modal==='issue-card' && (
        <ModalShell onClose={closeAll} busy={busy} title="Issue Virtual Card" onConfirm={handleIssueCard} confirmLabel="Issue" confirmColor="bg-slate-700 hover:bg-slate-800">
          {inp('name',`Cardholder (default: ${sel?.name||''})`)}
          <select value={f.currency||'USD'} onChange={e=>setF(p=>({...p,currency:e.target.value}))} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {['USD','EUR','GBP','AED','SAR','INR','CAD','AUD'].map(c=><option key={c}>{c}</option>)}
          </select>
        </ModalShell>
      )}
      {modal==='topup-card' && selCard && (
        <ModalShell onClose={closeAll} busy={busy} title={`Top Up ···· ${selCard.masked_number.slice(-4)}`} onConfirm={handleTopupCard} confirmLabel="Top Up" confirmColor="bg-blue-600 hover:bg-blue-700">
          <p className="text-sm text-gray-500">Wallet: <strong>${Number(balance.balance).toFixed(2)}</strong> · Card: <strong>${Number(selCard.balance).toFixed(2)}</strong></p>
          {inp('amount','Amount','number',true)}
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
          <p className="text-sm text-gray-500">Available: <strong>${Number(balance.balance).toFixed(2)}</strong></p>
          {bankAccounts.length===0 ? <p className="text-red-500 text-sm">Add a bank account first</p>
            : <select value={selBank} onChange={e=>setSelBank(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
                {bankAccounts.map(b=><option key={b.id} value={b.id}>{b.bank_name} •••• {b.account_number.slice(-4)}</option>)}
              </select>}
          {inp('amount','Amount','number',true)}
          {f.amount && <p className="text-sm text-green-700">Net: ${(parseFloat(f.amount||'0')*0.995).toFixed(2)} (fee 0.5%)</p>}
        </ModalShell>
      )}
      {modal==='buy-crypto' && (
        <ModalShell onClose={closeAll} busy={busy} title="Buy Crypto" onConfirm={handleBuyCrypto} confirmLabel="Buy" confirmColor="bg-orange-500 hover:bg-orange-600">
          <p className="text-sm text-gray-500">Balance: <strong>${Number(balance.balance).toFixed(2)}</strong></p>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Asset</label>
          <select value={selCoin} onChange={e=>setSelCoin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {COINS.map(c=><option key={c} value={c}>{COIN_ICONS[c]} {c}</option>)}
          </select>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
          <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
          </select>
          {inp('amount','USD amount to spend','number',true)}
          {coinPrice>0 && f.amount && <div className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-sm">
            <div className="text-xl font-extrabold text-orange-600">{(parseFloat(f.amount)/coinPrice).toFixed(8)} {selCoin}</div>
            <div className="mt-1 text-xs text-gray-500">Network: {selectedNetwork} · Spot rate: ${coinPrice.toLocaleString()} / {selCoin}</div>
          </div>}
        </ModalShell>
      )}
      {modal==='merchant-buy' && (
        <ModalShell onClose={closeAll} busy={busy} title="Merchant Buy Crypto" onConfirm={handleMerchantBuy} confirmLabel="Buy" confirmColor="bg-green-600 hover:bg-green-700">
          <p className="text-sm text-gray-500">Merchant: <strong>{f.merchantId||'(not set)'}</strong></p>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Asset</label>
          <select value={selCoin} onChange={e=>setSelCoin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {COINS.map(c=><option key={c} value={c}>{COIN_ICONS[c]} {c}</option>)}
          </select>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
          <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
          </select>
          {inp('amount','USD amount to spend','number',true)}
          {coinPrice>0 && f.amount && <div className="rounded-xl border border-green-100 bg-green-50 p-3 text-sm">
            <div className="text-xl font-extrabold text-green-600">{(parseFloat(f.amount)/coinPrice).toFixed(8)} {selCoin}</div>
            <div className="mt-1 text-xs text-gray-500">Network: {selectedNetwork} · Spot rate: ${coinPrice.toLocaleString()} / {selCoin}</div>
          </div>}
        </ModalShell>
      )}
      {modal==='sell-crypto' && (
        <ModalShell onClose={closeAll} busy={busy} title="Sell Crypto" onConfirm={handleSellCrypto} confirmLabel="Sell" confirmColor="bg-purple-600 hover:bg-purple-700">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Asset</label>
          <select value={selCoin} onChange={e=>setSelCoin(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {cryptoWallets.map(w=><option key={w.id} value={w.crypto_coin}>{COIN_ICONS[w.crypto_coin]} {w.crypto_coin} — {Number(w.balance).toFixed(8)}</option>)}
          </select>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Network</label>
          <select value={selectedNetwork} onChange={e=>setSelectedNetwork(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm">
            {getNetworkOptions(selCoin).map(net=><option key={net} value={net}>{net}</option>)}
          </select>
          {inp('amount','Crypto amount to sell','number',true)}
          {coinPrice>0 && f.amount && <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-sm">
            <div className="text-xl font-extrabold text-purple-600">${(parseFloat(f.amount)*coinPrice).toFixed(2)} USD</div>
            <div className="mt-1 text-xs text-gray-500">Network: {selectedNetwork} · Spot rate: ${coinPrice.toLocaleString()} / {selCoin}</div>
          </div>}
        </ModalShell>
      )}
    </div>
  );
};
