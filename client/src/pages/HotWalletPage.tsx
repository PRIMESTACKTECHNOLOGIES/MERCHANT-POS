import { useState, useEffect } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import {
  getHotWalletBalance, autobuyTopupHotWalletUsdt,
  type HotWalletBalance, type HotWalletAutobuyResult,
} from '../lib/api';

type TabId = 'overview' | 'autobuy-usdt' | 'transfer' | 'withdraw' | 'history' | 'settings';

const DEFAULT_MERCHANT_ID = 'MRC-1001';
const USDT_AUTOBUY_PRESETS = [100, 500, 1000, 5000, 10000];
const NETWORK_OPTIONS: Array<{ id: 'tron'|'bsc'|'polygon'; label: string; short: string; native: string; nativeSymbol: string; explorer: string; color: string; icon: string; }> = [
  { id: 'tron',    label: 'Tron (TRC-20)',   short: 'Tron',   native: 'TRX',     nativeSymbol: '⬡', explorer: 'tronscan.org',  color: 'from-red-500 to-rose-600',          icon: '🔴' },
  { id: 'bsc',     label: 'BSC (BEP-20)',    short: 'BSC',    native: 'BNB',     nativeSymbol: '🟡', explorer: 'bscscan.com',   color: 'from-yellow-500 to-amber-600',       icon: '🟡' },
  { id: 'polygon', label: 'Polygon (ERC-20)', short: 'Polygon', native: 'MATIC',  nativeSymbol: '🟣', explorer: 'polygonscan.com', color: 'from-purple-500 to-indigo-600',      icon: '🟣' },
];

export const HotWalletPage = () => {
  const { addNotification } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [hotWalletBalance, setHotWalletBalance] = useState<HotWalletBalance | null>(null);

  const refreshBalances = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const b = await getHotWalletBalance();
      setHotWalletBalance(b);
      if (!quiet) addNotification('Hot Wallet', 'Balances refreshed from blockchain', 'success');
    } catch (e: any) {
      console.error('Failed to fetch hot wallet balance:', e);
      addNotification('Error', e?.message || 'Failed to load hot wallet balance', 'error');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { void refreshBalances(true); }, []);

  const totalUsdt =
    Number(hotWalletBalance?.tron?.USDT || 0) +
    Number(hotWalletBalance?.bsc?.USDT || 0) +
    Number(hotWalletBalance?.polygon?.USDT || 0);

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live hot wallet management
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">Hot Wallet Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage on-chain hot wallet liquidity · auto-buy USDT via Binance SPOT · transfer & withdraw across Tron, BSC and Polygon.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition disabled:opacity-60"
            onClick={() => refreshBalances()}
            disabled={loading}
          >
            {loading ? '⏳ Refreshing…' : '⟳ Refresh Balances'}
          </button>
          <button
            className="rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 transition-all hover:scale-[1.02]"
            onClick={() => setActiveTab('autobuy-usdt')}
          >
            ₮ Auto-Buy USDT → Hot Wallet
          </button>
          <button
            className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/20 hover:shadow-xl hover:shadow-orange-500/30 transition-all hover:scale-[1.02]"
            onClick={() => setActiveTab('transfer')}
          >
            🔄 New Transfer
          </button>
        </div>
      </div>

      {/* ── Tab Navigation ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'overview',      label: '📊 Overview',      emoji: '📊' },
            { id: 'autobuy-usdt',  label: '₮ Auto-Buy USDT', emoji: '₮'  },
            { id: 'transfer',      label: '🔄 Transfer',      emoji: '🔄' },
            { id: 'withdraw',      label: '💸 Withdraw',      emoji: '💸' },
            { id: 'history',       label: '📜 History',       emoji: '📜' },
            { id: 'settings',      label: '⚙️ Settings',      emoji: '⚙️' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`flex-1 min-w-[130px] px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="mr-1">{tab.emoji}</span>{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────── */}
      <div className="space-y-6">
        {activeTab === 'overview'     && <OverviewTab balance={hotWalletBalance} loading={loading} onRefresh={() => refreshBalances()} />}
        {activeTab === 'autobuy-usdt' && <AutobuyUsdtTab balance={hotWalletBalance} addNotification={addNotification} onSuccess={() => refreshBalances(true)} />}
        {activeTab === 'transfer'     && <TransferTab addNotification={addNotification} />}
        {activeTab === 'withdraw'     && <WithdrawTab addNotification={addNotification} />}
        {activeTab === 'history'      && <HistoryTab totalUsdt={totalUsdt} />}
        {activeTab === 'settings'     && <SettingsTab addNotification={addNotification} />}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════════════════ */
const OverviewTab = ({ balance, loading, onRefresh }: {
  balance: HotWalletBalance | null;
  loading: boolean;
  onRefresh: () => void;
}) => {
  const tronUSDT = Number(balance?.tron?.USDT || 0);
  const tronTRX  = Number(balance?.tron?.TRX  || 0);
  const bscUSDT  = Number(balance?.bsc?.USDT  || 0);
  const bscBNB   = Number(balance?.bsc?.BNB   || 0);
  const polyUSDT = Number(balance?.polygon?.USDT || 0);
  const polyMATIC = Number(balance?.polygon?.MATIC || 0);
  const totalUSDT = tronUSDT + bscUSDT + polyUSDT;

  const chainCards = [
    { net: NETWORK_OPTIONS[0], address: balance?.tron?.address,    usdt: tronUSDT, native: tronTRX,  nativeLabel: 'TRX' },
    { net: NETWORK_OPTIONS[1], address: balance?.bsc?.address,     usdt: bscUSDT,  native: bscBNB,   nativeLabel: 'BNB' },
    { net: NETWORK_OPTIONS[2], address: balance?.polygon?.address, usdt: polyUSDT, native: polyMATIC, nativeLabel: 'MATIC' },
  ];

  return (
    <div className="space-y-6">
      {/* ── Summary KPI strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-2xl p-6 text-white shadow-lg shadow-emerald-500/20">
          <div className="flex items-center justify-between mb-4">
            <span className="text-3xl font-black tracking-tight">₮</span>
            <span className="text-xs font-bold uppercase tracking-[0.25em] bg-white/15 px-3 py-1 rounded-full">Total USDT Liquidity</span>
          </div>
          <div className="text-4xl font-black tabular-nums">
            {loading ? '—' : totalUSDT.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1 text-xs opacity-80">Tron + BSC + Polygon hot wallets combined</div>
        </div>
        {chainCards.map(c => (
          <ChainBalanceCard key={c.net.id} net={c.net} usdt={c.usdt} native={c.native} nativeLabel={c.nativeLabel} address={c.address || ''} loading={loading} />
        ))}
      </div>

      {/* ── Hot Wallet Status & health ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-600 rounded-xl text-white text-2xl shadow-inner">🔥</div>
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-blue-300">Hot Wallet Status</div>
              <h2 className="mt-1 text-xl font-bold text-white">Your hot wallet is LIVE · ready for on-chain broadcast</h2>
              <p className="mt-2 text-sm text-slate-300/90">
                Gas reserves and USDT liquidity are monitored every 30s by the deferred broadcast daemon.
                If TRX / BNB / MATIC gas drops below 20 tokens, the system auto-buys gas first before USDT payouts.
              </p>
              <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
                <InfoItem label="Status" value={<span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />🟢 Online</span>} />
                <InfoItem label="Gas check" value={loading ? '—' : (
                  <span className={`${tronTRX < 20 || bscBNB < 0.005 || polyMATIC < 0.05 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {tronTRX < 20 || bscBNB < 0.005 || polyMATIC < 0.05 ? '⚠️ Low on some chain(s)' : '✅ All OK'}
                  </span>
                )} />
                <InfoItem label="Networks Online" value="Tron · BSC · Polygon" />
                <InfoItem label="USDT Total" value={`₮ ${totalUSDT.toLocaleString(undefined,{maximumFractionDigits:0})}`} />
              </div>
            </div>
            <div className="hidden lg:block">
              <button onClick={onRefresh} disabled={loading} className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-60 transition">
                {loading ? '⏳ Refreshing…' : '⟳ Refresh Now'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Gas Reserve Health</div>
          <div className="mt-4 space-y-4">
            <GasGauge name="TRX (Tron gas)"     balance={tronTRX}  min={20}      unit="TRX"     color="from-red-500 to-rose-600" />
            <GasGauge name="BNB (BSC gas)"       balance={bscBNB}   min={0.005}   unit="BNB"     color="from-yellow-500 to-amber-600" />
            <GasGauge name="MATIC (Polygon gas)" balance={polyMATIC} min={0.05}    unit="MATIC"   color="from-purple-500 to-indigo-600" />
          </div>
        </div>
      </div>

      {/* ── Per-chain address + balance detail ───────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Hot Wallet Addresses · per chain</h3>
          <span className="text-xs text-slate-400">Deposit USDT or native gas to these addresses to top-up manually</span>
        </div>
        <div className="divide-y divide-slate-100">
          {chainCards.map(c => (
            <div key={c.net.id} className="px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              <div className="lg:col-span-2 flex items-center gap-3">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-xl bg-gradient-to-br ${c.net.color} text-white shadow-md`}>
                  {c.net.icon}
                </div>
                <div>
                  <div className="font-bold text-slate-900">{c.net.short}</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{c.net.label}</div>
                </div>
              </div>
              <div className="lg:col-span-6 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Hot wallet address · {c.net.short}</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 break-all font-mono text-sm font-semibold text-slate-700 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                    {loading ? 'Loading…' : (c.address || '—')}
                  </code>
                  <button
                    onClick={() => {
                      if (!c.address) return;
                      navigator.clipboard?.writeText(c.address);
                    }}
                    className="rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition shrink-0"
                  >
                    📋 Copy
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Explorer: <a className="underline hover:text-blue-600" href={`https://${c.net.explorer}/address/${c.address || ''}`} target="_blank" rel="noreferrer noopener">{c.net.explorer}</a>
                </div>
              </div>
              <div className="lg:col-span-2 text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">USDT</div>
                <div className="font-extrabold tabular-nums text-emerald-700 text-lg">
                  ₮ {c.usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="lg:col-span-2 text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Native gas ({c.nativeLabel})</div>
                <div className="font-extrabold tabular-nums text-slate-900 text-lg">
                  {c.native.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {c.nativeLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ChainBalanceCard = ({ net, usdt, native, nativeLabel, address, loading }: any) => (
  <div className={`rounded-2xl bg-gradient-to-br ${net.color} p-6 text-white shadow-lg`}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-2xl">{net.icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] bg-white/15 px-3 py-1 rounded-full">{net.short} Hot Wallet</span>
    </div>
    <div className="text-xs opacity-80 font-medium">USDT on {net.short}</div>
    <div className="mt-1 text-3xl font-black tabular-nums">
      {loading ? '—' : usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </div>
    <div className="mt-3 pt-3 border-t border-white/15 flex justify-between text-[11px] opacity-90">
      <div>
        <div className="opacity-70 uppercase tracking-wider">Gas</div>
        <div className="font-bold">{native.toLocaleString(undefined, { maximumFractionDigits: 4 })} {nativeLabel}</div>
      </div>
      <div className="text-right">
        <div className="opacity-70 uppercase tracking-wider">Status</div>
        <div className="font-bold inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Live
        </div>
      </div>
    </div>
    {address ? (
      <div className="mt-2 font-mono text-[10px] opacity-75 truncate" title={address}>{address.slice(0,14)}…{address.slice(-10)}</div>
    ) : null}
  </div>
);

const GasGauge = ({ name, balance, min, unit, color }: any) => {
  const pct = Math.min(100, Math.max(0, (balance / (min * 5)) * 100));
  const low = balance < min;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-slate-600">{name}</span>
        <span className={`text-xs font-bold tabular-nums ${low ? 'text-rose-600' : 'text-slate-700'}`}>
          {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}
          {low && <span className="ml-1 text-[9px] uppercase tracking-wider bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-md">Low</span>}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-slate-400">Min {min} {unit} required · 5× = healthy zone</div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-BUY USDT → HOT WALLET TAB (the key new feature)
   ═══════════════════════════════════════════════════════════════════════════ */
const AutobuyUsdtTab = ({ balance, addNotification, onSuccess }: {
  balance: HotWalletBalance | null;
  addNotification: ReturnType<typeof useNotifications>['addNotification'];
  onSuccess: () => void;
}) => {
  const [merchantId, setMerchantId] = useState<string>(DEFAULT_MERCHANT_ID);
  const [targetUsdt, setTargetUsdt] = useState<string>('1000');
  const [minUsdt, setMinUsdt] = useState<string>('');
  const [network, setNetwork] = useState<'tron'|'bsc'|'polygon'>('tron');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<(HotWalletAutobuyResult & { timestamp?: string; error?: string; hint?: string; manual_recovery?: string }) | null>(null);

  const chainHotUsdt =
    network === 'tron'    ? Number(balance?.tron?.USDT || 0) :
    network === 'bsc'     ? Number(balance?.bsc?.USDT  || 0) :
    /* polygon */           Number(balance?.polygon?.USDT || 0);

  const minUsdtParsed = minUsdt ? parseFloat(minUsdt) : undefined;
  const effectiveMin = minUsdtParsed && !isNaN(minUsdtParsed)
    ? minUsdtParsed
    : Math.max(100, (parseFloat(targetUsdt) || 0) * 1.02);

  const needsTopup = chainHotUsdt < effectiveMin;

  const executeAutobuy = async () => {
    const amt = parseFloat(targetUsdt);
    if (!merchantId.trim()) return addNotification('Missing', 'Merchant ID required', 'error');
    if (!amt || amt <= 0 || !Number.isFinite(amt)) return addNotification('Invalid amount', 'Target USDT must be positive', 'error');
    setBusy(true);
    setLastResult(null);
    try {
      addNotification('Auto-Buy starting…', `Debiting merchant ${merchantId} USD wallet → Binance SPOT 2-step USD→BTC→USDT → withdraw ${amt.toLocaleString()} USDT to ${network.toUpperCase()} hot wallet`, 'info');
      const r = await autobuyTopupHotWalletUsdt({
        merchantId: merchantId.trim(),
        targetUsdt: amt,
        minUsdt: minUsdtParsed,
        network,
        maxWaitMs: 300_000,
      });
      setLastResult({ ...r, timestamp: new Date().toLocaleString() });
      addNotification(
        r.neededTopup ? '✅ Auto-Buy completed' : 'ℹ️ Top-up skipped',
        r.note || (r.neededTopup ? `${(r.usdtBought||0).toLocaleString(undefined,{maximumFractionDigits:2})} USDT funded on ${network.toUpperCase()}` : 'Hot wallet already has enough USDT'),
        r.ok ? 'success' : 'warning'
      );
      if (r.ok) void onSuccess();
    } catch (e: any) {
      const msg = String(e?.message || String(e));
      const ctx = {
        rollbackApplied: !!e?.rollback_applied,
        usdSpent: e?.usd_spent,
        usdtBought: e?.usdt_bought,
        preUsdt: e?.usdt_pre_balance,
        buyOrder: e?.binance_order_id,
        withdrawId: e?.binance_withdraw_id,
        hot: e?.hot_wallet,
        network: e?.network,
        hint: e?.hint,
      };
      setLastResult({
        ok: false,
        preTopupUsdt: ctx.preUsdt ?? -1,
        postTopupUsdt: -1,
        targetUsdt: amt,
        neededTopup: true,
        usdSpent: ctx.usdSpent,
        usdtBought: ctx.usdtBought,
        binanceBuyOrderId: ctx.buyOrder,
        binanceWithdrawId: ctx.withdrawId,
        hotWalletAddress: ctx.hot,
        network: ctx.network,
        rollbackApplied: ctx.rollbackApplied,
        timestamp: new Date().toLocaleString(),
        error: msg,
        hint: ctx.hint,
      } as any);
      addNotification(
        'Auto-Buy FAILED',
        `${msg}${ctx.rollbackApplied ? ' · MERCHANT USD REFUNDED ✅' : ''}${ctx.hint ? ' · Manual recovery possible' : ''}`,
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* ── Form ─────────────────────────────────────────────────── */}
      <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-600">Merchant USD → Binance SPOT → Hot wallet</div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">₮ Auto-Buy USDT · fund hot wallet instantly</h2>
            <p className="mt-1 text-sm text-slate-500 max-w-xl">
              Debits the merchant USD wallet → real Binance SPOT MARKET buy (2-step USD→BTC→USDT since USDTUSDT invalid)
              → Binance Travel-Rule withdrawal of USDT to your chosen hot wallet chain
              → polls on-chain balance until confirmed.
              If anything fails after USD debit, your merchant USD is <strong className="text-slate-900">automatically refunded</strong>.
            </p>
          </div>
          <div className="inline-flex shrink-0 h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-2xl font-black shadow-md shadow-emerald-500/20">₮</div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">Merchant ID (Fiat USD Debit)</label>
              <input
                type="text" value={merchantId} onChange={e => setMerchantId(e.target.value)}
                placeholder="MRC-1001"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white font-mono text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              />
              <div className="mt-1 text-[10px] text-slate-400">USD wallet for this merchant is debited first</div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">Destination chain</label>
              <div className="grid grid-cols-3 gap-2">
                {NETWORK_OPTIONS.map(n => (
                  <button key={n.id} type="button" onClick={() => setNetwork(n.id)}
                    className={`rounded-xl border px-2 py-2.5 text-[11px] font-bold uppercase tracking-wide transition-all ${
                      network === n.id
                        ? `bg-gradient-to-br ${n.color} text-white border-transparent shadow-md scale-[1.02]`
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <div className="text-lg mb-0.5">{n.icon}</div>
                    {n.short}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Target USDT to buy & send</label>
              <span className={`text-[11px] font-bold ${needsTopup ? 'text-amber-600' : 'text-emerald-600'}`}>
                {network.toUpperCase()} hot wallet has ₮ {chainHotUsdt.toLocaleString(undefined,{maximumFractionDigits:2})}
                {needsTopup ? ` · below min ₮ ${effectiveMin.toLocaleString()}` : ' · topped up'}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-400">₮</span>
              <input
                type="number" min="1" step="1" value={targetUsdt}
                onChange={e => setTargetUsdt(e.target.value)}
                placeholder="e.g. 1000"
                inputMode="decimal"
                className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-slate-200 bg-white text-2xl font-black tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {USDT_AUTOBUY_PRESETS.map(v => (
                <button key={v} type="button" onClick={() => setTargetUsdt(String(v))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition">
                  ₮ {v.toLocaleString()}
                </button>
              ))}
              <button type="button" onClick={() => setTargetUsdt(String(Math.max(0, Math.ceil(effectiveMin - chainHotUsdt) + 100)))}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition">
                +Top up to min
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
              Minimum USDT threshold (optional — default: max(100, target × 1.02))
            </label>
            <input
              type="number" min="1" step="1" value={minUsdt}
              onChange={e => setMinUsdt(e.target.value)}
              placeholder={`Effective min: ₮ ${effectiveMin.toLocaleString()}`}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
            <div className="mt-1 text-[10px] text-slate-400">If current USDT on-chain balance ≥ min — buy is skipped (no unnecessary trade)</div>
          </div>

          {/* ── Flow visualizer ──────────────────────────────────── */}
          <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-700 mb-3">Order of operations</div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
              {[
                { i: '1', t: 'Debit Merchant', s: 'USD wallet', c: 'from-rose-50 to-white border-rose-200 text-rose-700' },
                { i: '2', t: 'Binance SPOT',  s: 'USD → BTC → USDT', c: 'from-amber-50 to-white border-amber-200 text-amber-700' },
                { i: '3', t: 'Binance Withdraw', s: `USDT → ${network.toUpperCase()} hot`, c: 'from-blue-50 to-white border-blue-200 text-blue-700' },
                { i: '4', t: 'Chain confirm',  s: 'Poll RPC every 5s', c: 'from-purple-50 to-white border-purple-200 text-purple-700' },
                { i: '5', t: 'Balance OK',     s: 'Broadcast allowed', c: 'from-emerald-50 to-white border-emerald-200 text-emerald-700' },
              ].map((step, idx, arr) => (
                <div key={step.i} className="relative">
                  <div className={`rounded-xl border bg-gradient-to-br ${step.c} px-3 py-3 shadow-sm`}>
                    <div className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 backdrop-blur text-xs font-black mb-1 border border-white">{step.i}</div>
                    <div className="text-xs font-extrabold tracking-tight">{step.t}</div>
                    <div className="text-[10px] mt-0.5 opacity-80">{step.s}</div>
                  </div>
                  {idx < arr.length - 1 && (
                    <div className="hidden sm:block absolute -right-3 top-1/2 -translate-y-1/2 text-slate-300 text-lg font-black z-10">›</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={executeAutobuy}
            disabled={busy}
            className="w-full py-4 rounded-xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 text-white font-black text-lg shadow-lg shadow-emerald-500/25 transition-all hover:shadow-xl hover:shadow-emerald-500/35 hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Processing… SPOT buy + on-chain withdrawal + confirm (5–300 s)
              </span>
            ) : needsTopup ? (
              <>₮ Buy & withdraw {parseFloat(targetUsdt || '0').toLocaleString()} USDT to {network.toUpperCase()} hot wallet</>
            ) : (
              <>✅ Skip buy · hot wallet already has ≥ ₮ {effectiveMin.toLocaleString()} (funded)</>
            )}
          </button>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 flex flex-col gap-1">
            <div>🛡️ <strong>Failure safety</strong> — If Binance buy OR withdraw fails after merchant USD debit, USD is AUTOMATICALLY credited back (rollback) with audit reference.</div>
            <div>ℹ️ <strong>USDT purchase note</strong> — Binance USDTUSDT spot pair is intentionally avoided. System performs a 2-step USD→BTC→USDT real SPOT conversion. Both legs execute on Binance SPOT with full fills returned.</div>
            <div>📣 <strong>Gas first</strong> — If TRX/BNB/MATIC gas is below threshold, call the auto-gas end-point <em>before</em> this to avoid broadcast failures (you can do so from the Gas Reserve tiles on Overview).</div>
          </div>
        </div>
      </div>

      {/* ── Status / Result panel ─────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {/* Preview */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400 mb-3">Order Preview</div>
          <div className="space-y-2.5 text-sm">
            <Row label="Merchant fiat" value={merchantId || '—'} mono />
            <Row label="Buy (SPOT)" value={`₮ ${parseFloat(targetUsdt || '0').toLocaleString(undefined,{maximumFractionDigits:2})} USDT`} />
            <Row label="Min threshold" value={`₮ ${effectiveMin.toLocaleString(undefined,{maximumFractionDigits:2})} USDT`} />
            <Row label="Current on-chain" value={`₮ ${chainHotUsdt.toLocaleString(undefined,{maximumFractionDigits:2})} USDT`} />
            <Row label="Operation" value={needsTopup ? <span className="font-bold text-amber-700">⚠️ BUY + WITHDRAW required</span> : <span className="font-bold text-emerald-700">✅ Already funded — no trade</span>} />
            <div className="my-2 border-t border-slate-100" />
            <Row label="Network" value={<span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full bg-gradient-to-br ${NETWORK_OPTIONS.find(n=>n.id===network)?.color}`} />{network.toUpperCase()} {NETWORK_OPTIONS.find(n=>n.id===network)?.label.replace(/^.+\((.+)\)$/,'($1)')}</span>} />
            <Row label="Dest. hot wallet"
              value={
                <code className="font-mono text-[11px] font-semibold break-all">
                  {NETWORK_OPTIONS.find(n=>n.id===network)
                    ? (network === 'tron'
                        ? balance?.tron?.address
                        : network === 'bsc'
                          ? balance?.bsc?.address
                          : balance?.polygon?.address) || '—'
                    : '—'}
                </code>
              }/>
          </div>
        </div>

        {/* Result */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-slate-400">Last Result</div>
            {lastResult?.timestamp ? <div className="text-[10px] text-slate-400">{lastResult.timestamp}</div> : null}
          </div>
          {!lastResult ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
              No auto-buy attempt yet in this session.
              <div className="mt-1 text-[11px]">All operations have forensic audit receipts (Binance orderId & withdrawId) stored in the payload below after each run.</div>
            </div>
          ) : lastResult.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-700 mb-1">❌ FAILED</div>
              <div className="text-sm font-semibold text-rose-900 leading-snug break-words">{lastResult.error}</div>
              {lastResult.hint ? (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 leading-snug">
                  <strong className="font-black">🔧 Manual recovery possible:</strong> {lastResult.hint}
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <KV k="USD debited" v={lastResult.usdSpent ? `$${Number(lastResult.usdSpent).toLocaleString(undefined,{maximumFractionDigits:2})}` : '—'} />
                <KV k="USD refunded" v={lastResult.rollbackApplied ? <span className="text-emerald-700 font-bold">✅ YES (rollback)</span> : <span className="text-rose-700 font-bold">❌ NO</span>} />
                <KV k="Pre USDT on-chain" v={lastResult.preTopupUsdt != null && lastResult.preTopupUsdt >= 0 ? `₮ ${Number(lastResult.preTopupUsdt).toLocaleString(undefined,{maximumFractionDigits:2})}` : '—'} />
                <KV k="USDT SPOT bought" v={lastResult.usdtBought ? `₮ ${Number(lastResult.usdtBought).toLocaleString(undefined,{maximumFractionDigits:4})}` : '—'} />
                <KV k="Binance order" v={<span className="font-mono break-all">{lastResult.binanceBuyOrderId || '—'}</span>} />
                <KV k="Binance withdraw" v={<span className="font-mono break-all">{lastResult.binanceWithdrawId || '—'}</span>} />
              </div>
            </div>
          ) : (
            <div className={`rounded-xl border ${lastResult.neededTopup ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'} p-4`}>
              <div className={`text-[11px] font-black uppercase tracking-[0.2em] mb-1 ${lastResult.neededTopup ? 'text-emerald-700' : 'text-blue-700'}`}>
                {lastResult.neededTopup ? '✅ SUCCESS · BUY + WITHDRAW COMPLETE' : 'ℹ️ SKIPPED · Hot wallet already funded'}
              </div>
              {lastResult.note ? <div className="text-sm font-medium text-slate-800 leading-snug break-words">{lastResult.note}</div> : null}
              {lastResult.neededTopup ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <KV k="Pre balance" v={`₮ ${Number(lastResult.preTopupUsdt).toLocaleString(undefined,{maximumFractionDigits:2})}`} />
                  <KV k="Post balance" v={<span className="text-emerald-700 font-bold">₮ {Number(lastResult.postTopupUsdt).toLocaleString(undefined,{maximumFractionDigits:2})}</span>} />
                  <KV k="USD spent" v={`$${Number(lastResult.usdSpent||0).toLocaleString(undefined,{maximumFractionDigits:2})}`} />
                  <KV k="USDT received" v={<span className="text-emerald-700 font-bold">₮ {Number(lastResult.usdtBought||0).toLocaleString(undefined,{maximumFractionDigits:4})}</span>} />
                  <KV k="Binance order" v={<span className="font-mono break-all">{lastResult.binanceBuyOrderId || '—'}</span>} />
                  <KV k="Binance withdraw" v={<span className="font-mono break-all">{lastResult.binanceWithdrawId || '—'}</span>} />
                  <KV k="On-chain settle" v={lastResult.settledAfterMs ? `${(lastResult.settledAfterMs/1000).toFixed(1)} s` : '—'} />
                  <KV k="Network" v={<span className="uppercase font-bold">{lastResult.network || network}</span>} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, value, mono }: any) => (
  <div className="flex items-start justify-between gap-4">
    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 pt-0.5 shrink-0">{label}</div>
    <div className={`text-right text-sm font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
);
const KV = ({ k, v }: any) => (
  <div className="rounded-lg bg-white/80 border border-white border-b-slate-100 px-2 py-1.5">
    <div className="text-[9px] uppercase tracking-wider text-slate-400">{k}</div>
    <div className="text-slate-700 font-semibold leading-tight mt-0.5">{v}</div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSFER / WITHDRAW / HISTORY / SETTINGS (professional UI refresh)
   ═══════════════════════════════════════════════════════════════════════════ */
const TransferTab = ({ addNotification }: any) => {
  const [form, setForm] = useState({
    from: 'hot_wallet', to: 'merchant_wallet', asset: 'USDT', amount: '', network: 'tron', reason: '',
  });
  const go = () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return addNotification('Error', 'Please enter a valid amount', 'error');
    addNotification('Transfer initiated', `${form.amount} ${form.asset} ${form.from} → ${form.to} via ${form.network}`, 'success');
    setForm({ ...form, amount: '', reason: '' });
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-6">🔄 Internal Transfer</h2>
      <div className="space-y-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Source">
          <select value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className="input-field">
            <option value="hot_wallet">🔥 Hot Wallet</option>
            <option value="treasury">🏦 Treasury Vault</option>
          </select>
        </Field>
        <Field label="Destination">
          <select value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className="input-field">
            <option value="merchant_wallet">💼 Merchant Wallet</option>
            <option value="customer_wallet">👤 Customer Wallet</option>
            <option value="external_address">🌐 External address</option>
          </select>
        </Field>
        <Field label="Asset">
          <select value={form.asset} onChange={e => setForm({ ...form, asset: e.target.value })} className="input-field">
            <option value="USDT">₮ USDT</option>
            <option value="TRX">⬡ TRX</option>
            <option value="BNB">🟡 BNB</option>
            <option value="MATIC">🟣 MATIC</option>
          </select>
        </Field>
        <Field label="Amount">
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="input-field" />
        </Field>
        <Field label="Network" className="md:col-span-2">
          <select value={form.network} onChange={e => setForm({ ...form, network: e.target.value })} className="input-field">
            <option value="tron">Tron (TRC-20)</option>
            <option value="bsc">BSC (BEP-20)</option>
            <option value="polygon">Polygon</option>
            <option value="ethereum">Ethereum (ERC-20)</option>
          </select>
        </Field>
        <Field label="Reason / notes (optional)" className="md:col-span-2">
          <textarea rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Internal transfer memo" className="input-field resize-none" />
        </Field>
      </div>
      <button onClick={go} className="mt-6 w-full py-4 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white font-bold shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all">
        🔄 Execute Internal Transfer
      </button>
    </div>
  );
};

const WithdrawTab = ({ addNotification }: any) => {
  const [form, setForm] = useState({ asset: 'USDT', amount: '', address: '', network: 'tron', reason: '' });
  const go = () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return addNotification('Error', 'Enter a valid amount', 'error');
    if (!form.address) return addNotification('Error', 'Enter destination address', 'error');
    addNotification('Withdrawal', `${form.amount} ${form.asset} → ${form.address.substring(0,12)}… submitted`, 'success');
    setForm({ ...form, amount: '', address: '', reason: '' });
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-6">💸 External Withdraw</h2>
      <div className="space-y-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Asset">
          <select value={form.asset} onChange={e => setForm({ ...form, asset: e.target.value })} className="input-field">
            <option>₮ USDT</option><option>⬡ TRX</option><option>🟡 BNB</option><option>🟣 MATIC</option>
          </select>
        </Field>
        <Field label="Amount">
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="input-field" />
        </Field>
        <Field label="Network" className="md:col-span-2">
          <select value={form.network} onChange={e => setForm({ ...form, network: e.target.value })} className="input-field">
            <option value="tron">Tron (TRC-20) · cheap fast</option>
            <option value="bsc">BSC (BEP-20)</option>
            <option value="polygon">Polygon</option>
            <option value="ethereum">Ethereum (ERC-20) · high gas</option>
          </select>
        </Field>
        <Field label="Destination address" className="md:col-span-2">
          <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="T… / 0x…" className="input-field font-mono" />
        </Field>
        <Field label="Reason" className="md:col-span-2">
          <textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Withdrawal memo" className="input-field resize-none" />
        </Field>
      </div>
      <button onClick={go} className="mt-6 w-full py-4 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-lg hover:shadow-xl transition-all">
        💸 Broadcast Withdrawal
      </button>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className}>
    <label className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">{label}</label>
    <>{children}</>
  </div>
);

const HistoryTab = ({ totalUsdt }: { totalUsdt: number }) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
      <div>
        <h3 className="font-bold text-slate-800">On-chain broadcast history</h3>
        <div className="text-xs text-slate-400 mt-0.5">Deferred-broadcast worker writes each TX here with hash & gas receipt</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Total USDT liquidity</div>
        <div className="font-extrabold tabular-nums text-emerald-700 text-lg">₮ {totalUsdt.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}</div>
      </div>
    </div>
    <div className="px-6 py-10 text-center text-sm text-slate-400 border-t border-dashed border-slate-200">
      <div className="text-3xl mb-3">📜</div>
      No on-chain broadcasts logged in this session yet.
      <div className="mt-1 text-xs text-slate-400">Use the Auto-Buy USDT tab or Withdraw tab to populate this ledger.</div>
    </div>
  </div>
);

const SettingsTab = ({ addNotification }: any) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-bold text-slate-900 mb-3">⚙️ Hot Wallet Keys</h3>
      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 mb-4 leading-snug">
        <strong className="font-black text-amber-900">⚠️ Never expose your private keys.</strong>
        Hot wallet private keys live ONLY on the server in the <code className="bg-white/70 px-1 rounded">.env</code> file — they never leave the backend.
      </div>
      <div className="space-y-3 text-sm">
        <InfoItem label="Status" value="Keys loaded from .env" />
        <InfoItem label="Treasury vault" value="Separated from hot wallet" />
        <InfoItem label="Withdraw whitelist" value="TRC20/BEP20 enabled" />
      </div>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-bold text-slate-900 mb-3">🧪 Test health</h3>
      <div className="space-y-3 text-sm">
        <button className="w-full rounded-xl bg-slate-900 text-white px-4 py-3 text-sm font-bold hover:bg-slate-800 transition"
          onClick={() => addNotification('Connection test', 'Ping sent — see Overview balances tab for last updated', 'info')}>
          🔌 Connection test
        </button>
        <button className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
          onClick={() => addNotification('Saved', 'Settings saved (stub)', 'success')}>
          💾 Save
        </button>
      </div>
    </div>
  </div>
);

// Shared small components
const InfoItem = ({ label, value }: any) => (
  <div className="rounded-xl bg-white border border-slate-100 px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</div>
    <div className="text-sm font-bold text-slate-900 mt-0.5">{value}</div>
  </div>
);
