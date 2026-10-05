import { useEffect, useState } from "react";
import { 
  fetchTerminals, 
  fetchTransactions, 
  fetchProducts,
  fetchBatches,
  getCustomers,
  getWalletBalance,
  getCashouts,
  getCryptoWallets,
  getCryptoPrice,
  getMerchantBalance,
  type Transaction, 
  type Terminal,
  type Product,
  type Batch,
  type Customer,
  type Cashout,
  type CryptoWallet,
  type MerchantWallet,
  exportTransactionsToCSV 
} from "../lib/api";
import { resolveApiBaseUrl } from "../lib/backendUrl";
import { Link, useNavigate } from "react-router-dom";
import { useNotifications } from "../contexts/useNotifications";

const BASE_URL = resolveApiBaseUrl({
  envValue: import.meta.env.VITE_API_URL,
  currentOrigin: window.location.origin,
});

// --- Types ---

interface TerminalUI extends Terminal {
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'SYNCING';
}

interface StatCardProps {
  title: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  icon: React.ReactNode;
  color: string;
  subtext?: string;
}

// Dashboard KPIs below are computed from real API terminal/transaction data, not hardcoded placeholders.
const enhanceTerminalData = (t: Terminal): TerminalUI => {
  return { ...t, status: (t as any).status || 'OFFLINE' };
};

// --- Components ---

const StatCard = ({ title, value, trend, trendUp, icon, color, subtext }: StatCardProps) => (
  <div className="card stat-card group relative overflow-hidden bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300">
    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
      {icon}
    </div>
    <div className="flex justify-between items-start mb-4 relative z-10">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className={`p-2 rounded-lg bg-opacity-10 transition-colors`} style={{ backgroundColor: `${color}15`, color: color }}>
        {icon}
      </div>
    </div>
    <div className="text-2xl font-bold text-gray-900 mb-1 relative z-10">{value}</div>
    {trend && (
      <div className={`text-xs font-medium flex items-center relative z-10 ${trendUp ? 'text-green-600' : 'text-red-500'}`}>
        {trendUp ? (
          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
        ) : (
          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
        )}
        {trend}
      </div>
    )}
    {subtext && <div className="text-xs text-gray-400 mt-1 relative z-10">{subtext}</div>}
  </div>
);

const SmoothAreaChart = ({ data }: { data: { day: string; value: number }[] }) => {
  if (!data || data.length === 0) return null;
  
  const values = data.map(d => d.value);
  const max = Math.max(...values) * 1.1;
  const min = Math.min(...values) * 0.8;
  const range = max - min;
  
  const getCoord = (d: { day: string; value: number }, i: number) => {
    const x = (i / (data.length - 1)) * 100;
    const y = range > 0
      ? 100 - ((d.value - min) / range) * 80 - 10
      : 50;
    return [x, y];
  };

  let dPath = `M ${getCoord(data[0], 0)[0]},${getCoord(data[0], 0)[1]}`;
  for (let i = 1; i < data.length; i++) {
    const [x0, y0] = getCoord(data[i-1], i-1);
    const [x1, y1] = getCoord(data[i], i);
    const cp1x = x0 + (x1 - x0) / 2;
    const cp1y = y0;
    const cp2x = x1 - (x1 - x0) / 2;
    const cp2y = y1;
    dPath += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x1},${y1}`;
  }

  const areaPath = `${dPath} L 100,100 L 0,100 Z`;

  return (
    <div className="w-full h-72 relative">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        {[25, 50, 75].map(y => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--border-subtle)" strokeWidth="0.5" strokeDasharray="3" />
        ))}
        
        <path d={areaPath} fill="url(#chartGradient)" />
        <path d={dPath} fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" filter="url(#glow)" />
        
        {data.map((d, i) => {
          const [x, y] = getCoord(d, i);
          return (
            <g key={i} className="group cursor-pointer">
              <circle cx={x} cy={y} r="2" fill="var(--bg-card)" stroke="var(--accent-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="opacity-0 group-hover:opacity-100 transition-all duration-300" />
              <circle cx={x} cy={y} r="6" fill="transparent" className="cursor-pointer" />
              <foreignObject x={x - 15} y={y - 25} width="30" height="20" className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none overflow-visible">
                <div className="bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap transform -translate-x-1/2">
                  ${d.value}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between mt-4 text-xs font-medium text-gray-400 px-2">
        {data.map((d, i) => <span key={i}>{d.day}</span>)}
      </div>
    </div>
  );
};

// Generate chart data from real transactions
const generateChartData = (timeFilter: string, transactions: Transaction[]) => {
  const now = new Date();
  const data: { day: string; value: number }[] = [];

  if (timeFilter === 'Today') {
    // Last 8 hours
    for (let i = 7; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourStart = new Date(hour);
      hourStart.setMinutes(0, 0, 0);
      const hourEnd = new Date(hour);
      hourEnd.setMinutes(59, 59, 999);
      const hourTxns = transactions.filter(t => {
        const tDate = new Date(t.txnTimestamp);
        return tDate >= hourStart && tDate <= hourEnd;
      });
      const total = hourTxns.reduce((sum, t) => sum + t.amountMinor, 0) / 100;
      data.push({
        day: `${hour.getHours() % 12 || 12} ${hour.getHours() >= 12 ? 'PM' : 'AM'}`,
        value: total
      });
    }
  } else if (timeFilter === 'Week') {
    // Last 7 days
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);
      const dayTxns = transactions.filter(t => {
        const tDate = new Date(t.txnTimestamp);
        return tDate >= dayStart && tDate <= dayEnd;
      });
      const total = dayTxns.reduce((sum, t) => sum + t.amountMinor, 0) / 100;
      data.push({
        day: day.toLocaleDateString('en-US', { weekday: 'short' }),
        value: total
      });
    }
  } else if (timeFilter === 'Month') {
    // Last 4 weeks
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const weekTxns = transactions.filter(t => {
        const tDate = new Date(t.txnTimestamp);
        return tDate >= weekStart && tDate <= weekEnd;
      });
      const total = weekTxns.reduce((sum, t) => sum + t.amountMinor, 0) / 100;
      data.push({
        day: `Week ${4 - i}`,
        value: total
      });
    }
  } else if (timeFilter === 'Year') {
    // Last 6 months
    for (let i = 5; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
      const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const monthTxns = transactions.filter(t => {
        const tDate = new Date(t.txnTimestamp);
        return tDate >= monthStart && tDate <= monthEnd;
      });
      const total = monthTxns.reduce((sum, t) => sum + t.amountMinor, 0) / 100;
      data.push({
        day: month.toLocaleDateString('en-US', { month: 'short' }),
        value: total
      });
    }
  }

  return data;
};

export const OverviewPage = () => {
  const [terminals, setTerminals] = useState<TerminalUI[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartData, setChartData] = useState<{ day: string; value: number }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [totalWalletBalance, setTotalWalletBalance] = useState(0);
  const [totalCryptoValueUSD, setTotalCryptoValueUSD] = useState(0);
  const [merchantWallet, setMerchantWallet] = useState<MerchantWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState('Today');
  const [lastTransactionCount, setLastTransactionCount] = useState(0);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // These records are awaiting provider or bank confirmation; they are not wallet funds.
  const [unprocessed, setUnprocessed] = useState<{ totalTransactions: number; byCurrency: { currency: string; count: number; totalAmount: number }[] } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<{ success: boolean; message: string; totalAmountCredited: number } | null>(null);

  const { addNotification } = useNotifications();
  const navigate = useNavigate();

  const getMerchantId = () => {
    try { return JSON.parse(localStorage.getItem('settings') || '{}').merchant_id || 'MRC-1001'; } catch { return 'MRC-1001'; }
  };

  const loadUnprocessed = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE_URL}/api/dashboard/unprocessed`, {
        headers: { Authorization: `Bearer ${token}`, 'x-merchant-id': getMerchantId() },
      });
      if (res.ok) {
        const data = await res.json();
        setUnprocessed(data);
      }
    } catch { /* ignore */ }
  };

  const handleProcessBatch = async () => {
    if (processing) return;
    setProcessing(true);
    setProcessResult(null);
    try {
      const token = localStorage.getItem('token');
      const merchantId = getMerchantId();
      const res = await fetch(`${BASE_URL}/api/dashboard/process-batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-merchant-id': merchantId,
        },
        body: JSON.stringify({ merchantId }),
      });
      const data = await res.json().catch(() => ({}));
      const message = typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : `Settlement request failed with HTTP ${res.status}.`;
      const result = {
        success: data.success === true && res.ok,
        message,
        totalAmountCredited: Number(data.totalAmountCredited || 0),
      };
      setProcessResult(result);
      if (result.success) {
        addNotification('Batch Processed', result.message, 'success', true);
        await loadUnprocessed();
        await loadData();
      } else {
        addNotification('Process Failed', result.message, 'error', true);
      }
    } catch (err: unknown) {
      const message = err instanceof Error && err.message
        ? err.message
        : 'Batch processing failed.';
      setProcessResult({ success: false, message, totalAmountCredited: 0 });
      addNotification('Error', message, 'error', true);
    } finally {
      setProcessing(false);
    }
  };

  const loadData = async () => {
    try {
      const [terms, txns, prods, bts, custs, cashs, mwallet] = await Promise.all([
        fetchTerminals(),
        fetchTransactions(),
        fetchProducts().catch(() => [] as Product[]),
        fetchBatches().catch(() => [] as Batch[]),
        getCustomers().catch(() => [] as Customer[]),
        getCashouts().catch(() => [] as Cashout[]),
        getMerchantBalance((() => { try { return JSON.parse(localStorage.getItem('settings')||'{}').merchant_id || 'MRC-1001'; } catch { return 'MRC-1001'; } })()).catch(() => null),
      ]);
      
      setTerminals(terms.map(enhanceTerminalData));
      if (mwallet) setMerchantWallet(mwallet);
      const sortedTxns = txns.sort((a, b) => new Date(b.txnTimestamp).getTime() - new Date(a.txnTimestamp).getTime());
      setTransactions(sortedTxns);
      setChartData(generateChartData(timeFilter, sortedTxns));
      setProducts(prods || []);
      setBatches(bts || []);
      setCustomers(custs || []);
      setCashouts(cashs || []);

      // Aggregate wallet balances and crypto wallets across all customers
      let aggBalance = 0;
      let allCryptos: CryptoWallet[] = [];
      if (custs && custs.length > 0) {
        const cappedCustomers = custs.slice(0, 10);
        const perCustomerData = await Promise.all(
          cappedCustomers.map(async (c) => {
            try {
              const [bal, cryptos] = await Promise.all([
                getWalletBalance(c.id).catch(() => ({ balance: 0, currency: 'USD' })),
                getCryptoWallets(c.id).catch(() => [])
              ]);
              return { bal, cryptos };
            } catch {
              return { bal: { balance: 0, currency: 'USD' }, cryptos: [] };
            }
          })
        );
        for (const pd of perCustomerData) {
          aggBalance += Number(pd.bal?.balance) || 0;
          allCryptos = [...allCryptos, ...(pd.cryptos || [])];
        }
      }
      setTotalWalletBalance(aggBalance);
      setCryptoWallets(allCryptos);

      // Aggregate crypto portfolio value
      let totalCryptoVal = 0;
      const uniqueCoins = [...new Set((allCryptos || []).map(c => c.crypto_coin))];
      for (const coin of uniqueCoins) {
        const coinWallets = (allCryptos || []).filter(c => c.crypto_coin === coin);
        const coinBal = coinWallets.reduce((s, w) => s + Number(w.balance || 0), 0);
        if (coinBal > 0) {
          try {
            const priceData = await getCryptoPrice(coin).catch(() => ({ price: 0 }));
            totalCryptoVal += coinBal * (priceData.price || 0);
          } catch { /* skip */ }
        }
      }
      setTotalCryptoValueUSD(totalCryptoVal);

      if (lastTransactionCount > 0 && sortedTxns.length > lastTransactionCount) {
        const newTxns = sortedTxns.length - lastTransactionCount;
        addNotification(
          "New Transaction",
          `${newTxns} new transaction${newTxns > 1 ? 's' : ''} received`,
          'success',
          true
        );
      }
      setLastTransactionCount(sortedTxns.length);
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadUnprocessed();
  }, [timeFilter]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, [timeFilter]);

  useEffect(() => {
    const handleClickOutside = () => setExportMenuOpen(false);
    if (exportMenuOpen) {
      setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [exportMenuOpen]);

  // ── Period-over-Period Comparator ──────────────────────────────────────────
  const splitTransactionsByPeriod = (filter: string, txns: Transaction[]) => {
    const now = new Date();
    let currentStart: Date, prevStart: Date, prevEnd: Date;

    if (filter === 'Today') {
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      prevEnd = new Date(currentStart.getTime() - 1);
      prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate());
    } else if (filter === 'Week') {
      currentStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      currentStart.setHours(0, 0, 0, 0);
      prevEnd = new Date(currentStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - 6 * 24 * 60 * 60 * 1000);
      prevStart.setHours(0, 0, 0, 0);
    } else if (filter === 'Month') {
      currentStart = new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000);
      currentStart.setHours(0, 0, 0, 0);
      prevEnd = new Date(currentStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - 27 * 24 * 60 * 60 * 1000);
      prevStart.setHours(0, 0, 0, 0);
    } else {
      currentStart = new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000);
      currentStart.setHours(0, 0, 0, 0);
      prevEnd = new Date(currentStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - 179 * 24 * 60 * 60 * 1000);
      prevStart.setHours(0, 0, 0, 0);
    }

    const current = txns.filter(t => {
      const d = new Date(t.txnTimestamp);
      return d >= currentStart;
    });
    const previous = txns.filter(t => {
      const d = new Date(t.txnTimestamp);
      return d >= prevStart && d <= prevEnd;
    });
    return { current, previous };
  };

  const { current: currentTxns, previous: previousTxns } = splitTransactionsByPeriod(timeFilter, transactions);
  
  const currentSales = currentTxns.reduce((s, t) => s + (t.amountMinor || 0), 0) / 100;
  const previousSales = previousTxns.reduce((s, t) => s + (t.amountMinor || 0), 0) / 100;
  const salesDelta = previousSales > 0 ? ((currentSales - previousSales) / previousSales) * 100 : 0;

  const currentApprovals = currentTxns.filter(t => ['APPROVED','SYNCED'].includes(t.status)).length;
  const prevApprovals = previousTxns.filter(t => ['APPROVED','SYNCED'].includes(t.status)).length;
  const approvalDelta = prevApprovals > 0 ? ((currentApprovals - prevApprovals) / prevApprovals) * 100 : 0;

  const formatDelta = (val: number, unit = '%') => {
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}${unit}`;
  };

  // KPIs — all computed from real data
  const totalSales = transactions.reduce((sum, t) => sum + (t.amountMinor || 0), 0) / 100;
  const merchantSettlementBalance = merchantWallet?.balance ?? 0; // money credited after batch syncs
  const successfulTxns = transactions.filter(t => ['APPROVED','SYNCED'].includes(t.status)).length;
  const declinedTxns = transactions.filter(t => t.status === 'DECLINED').length;
  const activeTerminals = terminals.filter(t => t.status === 'ONLINE').length;
  const offlinePending = transactions.filter(t => t.status === 'PENDING').length;
  const chargebacks = transactions.filter(t => t.status && t.status.toUpperCase().includes('CHARGEBACK')).length;
  const avgTicket = transactions.length > 0 ? (totalSales / transactions.length) : 0;
  const offlineCount = transactions.filter(t => t.authMode === 'OFFLINE_APPROVED').length;
  const offlinePct = transactions.length > 0 ? Math.round((offlineCount / transactions.length) * 100) : 0;
  const onlinePct = 100 - offlinePct;

  // Inventory Metrics
  const inventoryCount = products.length;
  const inventoryValue = products.reduce((sum, p) => sum + ((p.price_minor || 0) * (p.stock || 0)), 0) / 100;
  const lowStockCount = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) < 10).length;
  const outOfStockCount = products.filter(p => (p.stock || 0) === 0).length;

  // Wallet & Customer Metrics
  const customerCount = customers.length;

  // Settlement / Cashout Metrics
  const pendingCashouts = cashouts.filter(c => c.status === 'PENDING' || c.status === 'PROCESSING').length;
  const completedCashouts = cashouts.filter(c => c.status === 'COMPLETED').length;
  const pendingSettlementBatches = batches.filter(b => b.status === 'PENDING_UPLOAD' || b.status === 'UPLOADED' || b.status === 'OPEN').length;

  // Crypto Portfolio Metrics
  const cryptoCoinCount = cryptoWallets.length;
  const activeCryptoCoins = cryptoWallets.filter(c => Number(c.balance || 0) > 0).length;

  // Settlement period payout total (same window as timeFilter)
  const periodStartMs = (() => {
    const now = new Date();
    if (timeFilter === 'Today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (timeFilter === 'Week') return now.getTime() - 6 * 24 * 60 * 60 * 1000;
    if (timeFilter === 'Month') return now.getTime() - 27 * 24 * 60 * 60 * 1000;
    return now.getTime() - 179 * 24 * 60 * 60 * 1000;
  })();
  const periodCashouts = cashouts.filter(c => new Date(c.created_at).getTime() >= periodStartMs);
  const periodPayouts = periodCashouts.reduce((s, c) => s + (c.net_amount_minor || c.amount_minor || 0), 0) / 100;

  // Entry mode breakdown
  const chipCount = transactions.filter(t => t.entryMode === 'CHIP').length;
  const contactlessCount = transactions.filter(t => t.entryMode === 'CONTACTLESS').length;
  const manualCount = transactions.filter(t => t.entryMode === 'MANUAL').length;
  const totalEntries = Math.max(chipCount + contactlessCount + manualCount, 1);
  const paymentMethods = [
    { type: 'Chip (EMV)', percent: Math.round((chipCount / totalEntries) * 100) || 0, color: 'var(--accent-primary)' },
    { type: 'Contactless', percent: Math.round((contactlessCount / totalEntries) * 100) || 0, color: 'var(--accent-secondary)' },
    { type: 'Manual', percent: Math.round((manualCount / totalEntries) * 100) || 0, color: 'var(--text-muted)' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm text-gray-500 font-medium">Loading Dashboard...</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Welcome back, Merchant Admin — here's your business pulse.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          <button 
            onClick={loadData}
            className="p-2 text-gray-500 hover:text-blue-600 bg-white hover:bg-gray-50 rounded-full border border-gray-200 shadow-sm transition-colors"
            title="Refresh data"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>
          </button>
          <div className="relative">
            <button 
              onClick={(e) => { e.stopPropagation(); setExportMenuOpen(v => !v); }}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 rounded-lg border border-gray-200 shadow-sm transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Export
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-200 rounded-lg shadow-xl z-50 animate-fade-in overflow-hidden">
                <button 
                  onClick={() => { exportTransactionsToCSV(transactions); setExportMenuOpen(false); addNotification('Export', 'Transactions CSV exported', 'success', false); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Transactions (CSV)
                </button>
                <button 
                  onClick={() => { navigate('/transactions'); setExportMenuOpen(false); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2" /></svg>
                  Sales Report (PDF)
                </button>
                <button 
                  onClick={() => { navigate('/settlements'); setExportMenuOpen(false); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors border-t border-gray-100"
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                  Settlement Report
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Unprocessed Transactions Banner ─────────────────────────────── */}
      {unprocessed && unprocessed.totalTransactions > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-400/5 to-orange-400/5 pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <svg width="24" height="24" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-amber-900">
                  POS Transactions Awaiting Settlement Confirmation
                </h3>
                <p className="text-sm text-amber-700 mt-0.5">
                  <span className="font-bold text-amber-900">{unprocessed.totalTransactions} transactions</span> are awaiting external provider or bank confirmation. They are not available to credit to the merchant wallet.
                </p>
                {unprocessed.byCurrency.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {unprocessed.byCurrency.map((c) => (
                      <span key={c.currency} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                        {c.currency}: {c.count} txns · {new Intl.NumberFormat('en-US', { style: 'currency', currency: c.currency }).format(c.totalAmount)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
              {/* Download CSV */}
              <a
                href={`${BASE_URL}/api/batch-file/csv?merchantId=${getMerchantId()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200"
                title="Download CSV batch file for bank upload"
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSV File
              </a>
              {/* Download MT103 SWIFT */}
              <a
                href={`${BASE_URL}/api/batch-file/mt103?merchantId=${getMerchantId()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200"
                title="Download MT103 SWIFT wire instruction file"
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                MT103 SWIFT
              </a>
              <p className="max-w-xs text-xs font-medium text-amber-800">
                Manual wallet credit is disabled. Funds post only after provider or signed bank confirmation.
              </p>
            </div>
          </div>
        </div>
      )}

      {unprocessed && unprocessed.totalTransactions === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-medium">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          No POS transactions are currently awaiting settlement confirmation.
        </div>
      )}

      {/* Quick Actions Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'New Charge', path: '/pos', icon: 'credit-card', color: 'from-blue-500 to-blue-600' },
          { label: 'Add Product', path: '/inventory', icon: 'box', color: 'from-emerald-500 to-emerald-600' },
          { label: 'Pair Terminal', path: '/terminal-pairing', icon: 'terminal', color: 'from-violet-500 to-violet-600' },
          { label: 'Settle Batch', path: '/batches', icon: 'check-circle', color: 'from-amber-500 to-amber-600' },
        ].map((action, i) => (
          <button
            key={i}
            onClick={() => navigate(action.path)}
            className={`group relative overflow-hidden rounded-xl p-4 bg-gradient-to-br ${action.color} text-white shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5`}
          >
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110">
              {action.icon === 'credit-card' && <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>}
              {action.icon === 'box' && <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>}
              {action.icon === 'terminal' && <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>}
              {action.icon === 'check-circle' && <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            </div>
            <div className="relative z-10 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
                {action.icon === 'credit-card' && <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>}
                {action.icon === 'box' && <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>}
                {action.icon === 'terminal' && <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18"/></svg>}
                {action.icon === 'check-circle' && <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 4 12 14.01 9 11.01"/></svg>}
              </div>
              <div className="text-sm font-semibold text-left">{action.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* KPI Cards Grid — Row 1: Core Payment KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
        <StatCard 
          title="Total Sales" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentSales)}
          trend={transactions.length > 0 ? formatDelta(salesDelta) : 'No data'}
          trendUp={salesDelta >= 0}
          subtext={`${currentTxns.length} txns · vs ${previousTxns.length} prev.`}
          color="var(--accent-primary)"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard
          title="Settlement Balance"
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(merchantSettlementBalance)}
          trend={merchantSettlementBalance > 0 ? 'Credited from syncs' : 'No synced batches'}
          trendUp={merchantSettlementBalance > 0}
          subtext="Auto-credited on batch sync"
          color="#16a34a"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" /></svg>}
        />
        <StatCard 
          title="Offline Pending" 
          value={offlinePending}
          subtext={offlinePending > 0 ? `Est. $${(offlinePending * avgTicket || 50).toFixed(2)}` : 'All synced'}
          trend={offlinePending > 0 ? 'Syncing...' : 'Complete'}
          trendUp={true}
          color="#f59e0b"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" /></svg>}
        />
        <StatCard 
          title="Approved Txns" 
          value={currentApprovals}
          trend={transactions.length > 0 ? formatDelta(approvalDelta) : '0% Rate'}
          trendUp={approvalDelta >= 0}
          subtext={transactions.length > 0 ? `${Math.round((successfulTxns / transactions.length) * 100)}% lifetime rate` : 'No data yet'}
          color="#10b981"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard 
          title="Declined" 
          value={declinedTxns}
          trend={transactions.length > 0 ? `${Math.round((declinedTxns / transactions.length) * 100)}% Rate` : '0% Rate'}
          trendUp={false} 
          color="#ef4444"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard 
          title="Active Terminals" 
          value={`${activeTerminals}/${terminals.length}`}
          trend={terminals.length === 0 ? 'No terminals' : activeTerminals === terminals.length ? 'All Online' : `${terminals.length - activeTerminals} offline`}
          trendUp={activeTerminals === terminals.length}
          color="#3b82f6"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
        />
        <StatCard 
          title="Chargebacks" 
          value={chargebacks}
          trend={chargebacks > 0 ? `${chargebacks} open cases` : 'None reported'}
          trendUp={chargebacks === 0}
          color={chargebacks > 0 ? '#ef4444' : '#8b5cf6'}
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        />
      </div>

      {/* KPI Cards Grid — Row 2: Inventory, Wallets, Settlements, Crypto */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
        {/* Inventory Value */}
        <StatCard 
          title="Inventory Value" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(inventoryValue)}
          trend={`${inventoryCount} SKUs`}
          trendUp={true}
          subtext={lowStockCount > 0 || outOfStockCount > 0 ? `${lowStockCount} low · ${outOfStockCount} out` : 'Stock healthy'}
          color="#0891b2"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} points="3.27 6.96 12 12.01 20.73 6.96" /><line strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} x1="12" y1="22.08" x2="12" y2="12" /></svg>}
        />
        {/* Customer Wallet Balance */}
        <StatCard 
          title="Wallet Balances" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalWalletBalance)}
          trend={customerCount > 0 ? `${customerCount} customers` : 'No customers'}
          trendUp={true}
          subtext={customerCount > 0 ? `Avg $${(customerCount > 0 ? (totalWalletBalance / customerCount).toFixed(2) : '0.00')} / customer` : 'Create customer first'}
          color="#0ea5e9"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" /></svg>}
        />
        {/* Settlements / Payouts */}
        <StatCard 
          title="Period Payouts" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(periodPayouts)}
          trend={`${completedCashouts} completed`}
          trendUp={completedCashouts > 0}
          subtext={pendingCashouts > 0 ? `${pendingCashouts} pending · ${pendingSettlementBatches} batches` : `${cashouts.length} all-time payouts`}
          color="#14b8a6"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>}
        />
        {/* Crypto Portfolio */}
        <StatCard 
          title="Crypto Portfolio" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCryptoValueUSD)}
          trend={`${activeCryptoCoins} active${cryptoCoinCount > 0 ? ` / ${cryptoCoinCount} wallets` : ''}`}
          trendUp={totalCryptoValueUSD > 0}
          subtext={totalCryptoValueUSD > 0 ? 'Live prices from exchange' : 'Buy from Wallets → Crypto'}
          color="#f97316"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
        />
        {/* Customers */}
        <StatCard 
          title="Customers" 
          value={customerCount}
          trend={customerCount > 0 ? `$${totalWalletBalance.toLocaleString()} held` : 'Acquire first'}
          trendUp={customerCount > 0}
          subtext={customerCount > 0 ? `${periodCashouts.length} payouts` : 'Manage in Wallets page'}
          color="#ec4899"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>}
        />
      </div>

      {/* Main Content Grid: Analytics + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Large Analytics Chart */}
        <div className="card lg:col-span-2 shadow-sm border border-gray-100 bg-white rounded-xl p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Revenue Analytics</h2>
              <p className="text-sm text-gray-500">Gross transaction volume over time</p>
            </div>
            <div className="flex bg-gray-50 p-1 rounded-lg border border-gray-200">
              {['Today', 'Week', 'Month', 'Year'].map((filter) => (
                <button 
                  key={filter} 
                  onClick={() => setTimeFilter(filter)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${timeFilter === filter ? 'bg-white text-blue-600 shadow-sm border border-gray-100' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <SmoothAreaChart data={chartData} />
        </div>

        {/* Merchant Insights & Additional Panels */}
        <div className="space-y-6">
          
          {/* Insights Card */}
          <div className="card shadow-sm border border-gray-100 h-fit bg-white rounded-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-900">Merchant Insights</h2>
              <button className="text-gray-400 hover:text-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
              </button>
            </div>
            
            <div className="space-y-6">
              {/* Avg Ticket */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <div className="text-sm text-gray-500 mb-1 font-medium">Average Ticket Size</div>
                  <div className="text-2xl font-bold text-gray-900 tracking-tight">${avgTicket.toFixed(2)}</div>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                </div>
              </div>

              {/* Offline vs Online Ratio */}
              <div>
                <div className="flex justify-between items-end mb-2">
                   <div className="text-sm text-gray-500 font-medium">Transaction Mode</div>
                   <div className="text-xs font-semibold text-gray-500">{onlinePct}% Online</div>
                </div>
                <div className="flex h-3 w-full rounded-full overflow-hidden">
                   <div className="bg-blue-500 h-full" style={{ width: `${onlinePct}%` }} title="Online"></div>
                   <div className="bg-amber-500 h-full" style={{ width: `${offlinePct}%` }} title="Offline"></div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                   <span>Online</span>
                   <span>Offline ({offlinePct}%)</span>
                </div>
              </div>
              
              {/* Peak Hour — computed from real transactions */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="text-sm text-gray-500 font-medium">Most Active Period</div>
                </div>
                <div className="text-lg font-semibold text-gray-900">
                  {transactions.length > 0
                    ? (() => {
                        const hours: Record<number, number> = {};
                        transactions.forEach(t => { const h = new Date(t.txnTimestamp).getHours(); hours[h] = (hours[h] || 0) + 1; });
                        const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
                        if (!peak) return 'No data';
                        const h = parseInt(peak[0]);
                        return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'} — ${(h + 1) % 12 || 12}:00 ${h + 1 < 12 ? 'AM' : 'PM'}`;
                      })()
                    : 'No data yet'}
                </div>
              </div>

              {/* Payment Methods */}
              <div>
                <div className="text-sm text-gray-500 mb-4 font-medium">Entry Methods</div>
                <div className="space-y-4">
                  {paymentMethods.map((method, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1.5 font-medium text-gray-600">
                        <span>{method.type}</span>
                        <span>{method.percent}%</span>
                      </div>
                      <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${method.percent}%`, backgroundColor: method.color }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Additional Panels: Alerts & Accuracy & Recent Purchase History */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
             
             {/* Opportunities / Alerts Panel (consolidated: batches + inventory + payouts) */}
             {(() => {
               const pendingBatches = transactions.filter(t => t.status === 'PENDING');
               const hasInventoryIssues = lowStockCount > 0 || outOfStockCount > 0;
               const hasPayoutPending = pendingCashouts > 0 || pendingSettlementBatches > 0;
               const hasAlerts = pendingBatches.length > 0 || hasInventoryIssues || hasPayoutPending || chargebacks > 0;
               
               if (!hasAlerts) {
                 return (
                   <div className="card border border-green-100 bg-green-50/50 p-4 rounded-xl shadow-sm relative overflow-hidden">
                     <div className="flex items-center gap-3 mb-2">
                       <div className="p-1.5 bg-green-100 rounded-lg text-green-600">
                         <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                       </div>
                       <h3 className="text-sm font-bold text-green-900">All Systems Operational</h3>
                     </div>
                     <div className="text-xs text-green-800">No pending batches, inventory issues, or chargebacks</div>
                   </div>
                 );
               }
               
               return (
                 <div className="card border border-orange-100 bg-orange-50/50 p-4 rounded-xl shadow-sm relative overflow-hidden">
                   <div className="flex items-center gap-3 mb-2">
                     <div className="p-1.5 bg-orange-100 rounded-lg text-orange-600">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                     </div>
                     <h3 className="text-sm font-bold text-orange-900">Attention Required</h3>
                   </div>
                   <div className="space-y-2">
                     {pendingBatches.length > 0 && (
                       <div className="flex items-start gap-2 text-xs text-orange-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></span>
                          <span>{pendingBatches.length} Offline batch{pendingBatches.length !== 1 ? 'es' : ''} pending upload</span>
                       </div>
                     )}
                     {hasInventoryIssues && (
                       <div className="flex items-start gap-2 text-xs text-orange-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0"></span>
                          <span>{lowStockCount} low stock · {outOfStockCount} out of stock SKU{outOfStockCount !== 1 ? 's' : ''}</span>
                       </div>
                     )}
                     {hasPayoutPending && (
                       <div className="flex items-start gap-2 text-xs text-orange-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5 flex-shrink-0"></span>
                          <span>{pendingCashouts} payout{pendingCashouts !== 1 ? 's' : ''} pending · {pendingSettlementBatches} open batch{pendingSettlementBatches !== 1 ? 'es' : ''}</span>
                       </div>
                     )}
                     {chargebacks > 0 && (
                       <div className="flex items-start gap-2 text-xs text-red-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></span>
                          <span>{chargebacks} open chargeback case{chargebacks !== 1 ? 's' : ''}</span>
                       </div>
                     )}
                   </div>
                   <div className="mt-3 flex gap-2">
                     {(pendingBatches.length > 0 || hasPayoutPending) && (
                       <Link 
                         to="/batches"
                         className="flex-1 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs text-center font-semibold rounded-lg hover:bg-orange-50 transition-colors shadow-sm"
                       >
                          Batches
                       </Link>
                     )}
                     {hasInventoryIssues && (
                       <Link 
                         to="/inventory"
                         className="flex-1 py-1.5 bg-white border border-amber-200 text-amber-700 text-xs text-center font-semibold rounded-lg hover:bg-amber-50 transition-colors shadow-sm"
                       >
                          Inventory
                       </Link>
                     )}
                   </div>
                 </div>
               );
             })()}

             {/* Accuracy Score — computed from real transaction data */}
             <div className="card bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                   <svg width="60" height="60" fill="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div className="text-sm font-medium text-indigo-100 mb-1">Approval Rate</div>
                <div className="text-3xl font-bold mb-2">
                  {transactions.length > 0
                    ? `${Math.round((successfulTxns / transactions.length) * 100)}%`
                    : '—'}
                </div>
                <div className="text-xs text-indigo-100 bg-white/20 inline-block px-2 py-1 rounded-lg backdrop-blur-sm">
                  {transactions.length > 0
                    ? `${successfulTxns} of ${transactions.length} approved`
                    : 'No transactions yet'}
                </div>
             </div>

             {/* Wallet & Inventory Quick Summary — new panel */}
             <div className="card border border-gray-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 rounded-2xl shadow-sm relative">
                <div className="flex items-center justify-between mb-3">
                   <div className="text-sm font-bold text-gray-900">Financial Snapshot</div>
                   <Link to="/wallets" className="text-xs text-blue-600 font-semibold hover:underline">Wallets</Link>
                </div>
                <div className="space-y-3">
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" /></svg>
                         </div>
                         <span className="text-xs font-medium text-gray-600">Wallet Balances</span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">${totalWalletBalance.toLocaleString()}</span>
                   </div>
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                         </div>
                         <span className="text-xs font-medium text-gray-600">Crypto (USD)</span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">${totalCryptoValueUSD.toLocaleString()}</span>
                   </div>
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75" /></svg>
                         </div>
                         <span className="text-xs font-medium text-gray-600">Period Payouts</span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">${periodPayouts.toLocaleString()}</span>
                   </div>
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <div className="w-7 h-7 rounded-lg bg-cyan-100 text-cyan-600 flex items-center justify-center">
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
                         </div>
                         <span className="text-xs font-medium text-gray-600">Inventory Value</span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">${inventoryValue.toLocaleString()}</span>
                   </div>
                </div>
             </div>

             {/* Recent Purchase History (New Panel) */}
             <div className="card border border-gray-200 bg-white p-5 rounded-2xl shadow-sm relative">
                <div className="flex items-center justify-between mb-4">
                   <div className="text-sm font-bold text-gray-900">Recent Purchase History</div>
                   <Link to="/transactions" className="text-xs text-blue-600 font-semibold hover:underline">View All</Link>
                </div>
                <div className="space-y-3">
                   {transactions.slice(0, 3).map((txn, i) => (
                      <div key={i} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                         <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                               {txn.currency?.[0] || '$'}
                            </div>
                            <div>
                               <div className="text-xs font-semibold text-gray-900">Purchase</div>
                               <div className="text-[10px] text-gray-500">{new Date(txn.txnTimestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                               {(txn.readerSource || txn.cardBrand) && (
                                 <div className="text-[10px] text-emerald-600 font-medium">
                                   {txn.readerSource === 'NFC_CONTACTLESS' ? 'NFC' : txn.readerSource === 'EMV_CHIP' ? 'EMV' : txn.cardBrand || 'Card'}
                                 </div>
                               )}
                            </div>
                         </div>
                         <div className="text-sm font-bold text-gray-900">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(txn.amountMinor / 100)}
                         </div>
                      </div>
                   ))}
                   {transactions.length === 0 && (
                      <div className="text-xs text-gray-400 text-center py-2">No transactions yet</div>
                   )}
                </div>
             </div>
          </div>
          
        </div>
      </div>

      {/* Bottom Grid: Terminals + Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Terminal Performance */}
        <div className="card shadow-sm border border-gray-100 bg-white rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-900">Terminal Status</h2>
            <Link to="/terminals" className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline">View All</Link>
          </div>
          <div className="space-y-3">
            {terminals.slice(0, 5).map(term => {
              // Calculate today's total for this terminal
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const terminalTxns = transactions.filter(t => {
                const tDate = new Date(t.txnTimestamp);
                return t.terminalId === term.terminalId && tDate >= today;
              });
              const terminalTotal = terminalTxns.reduce((sum, t) => sum + t.amountMinor, 0) / 100;
              
              return (
                <div key={term.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all duration-200 border border-transparent hover:border-gray-100 cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      term.status === 'ONLINE' ? 'bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                      term.status === 'OFFLINE' ? 'bg-amber-500' :
                      term.status === 'ERROR' ? 'bg-red-500' : 'bg-blue-500'
                    }`}></div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{term.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{term.terminalId}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-gray-900">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(terminalTotal)}
                    </div>
                    <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Today</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card lg:col-span-2 shadow-sm border border-gray-100 bg-white rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-900">Recent Transactions</h2>
            <Link to="/transactions" className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline">View All</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100 uppercase tracking-wider font-semibold">
                  <th className="py-3 pl-4">Time</th>
                  <th className="py-3">Terminal</th>
                  <th className="py-3">Amount</th>
                  <th className="py-3">Curr</th>
                  <th className="py-3">Status</th>
                  <th className="py-3">STAN</th>
                  <th className="py-3 pr-4 text-right">Batch ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.slice(0, 7).map((txn, i) => (
                  <tr key={txn.id || i} className="group hover:bg-gray-50 even:bg-gray-50/50 transition-colors text-sm">
                    <td className="py-3.5 pl-4 text-gray-500 font-mono text-xs">
                      {new Date(txn.txnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 text-gray-900 font-medium">{txn.terminalId}</td>
                    <td className="py-3.5 font-bold text-gray-900 tracking-tight">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(txn.amountMinor / 100)}
                    </td>
                    <td className="py-3.5 text-xs font-medium text-gray-500">{txn.currency || 'USD'}</td>
                    <td className="py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border
                        ${txn.status === 'APPROVED' ? 'bg-green-50 text-green-700 border-green-100' : 
                          txn.status === 'DECLINED' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-gray-50 text-gray-700 border-gray-100'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 
                          ${txn.status === 'APPROVED' ? 'bg-green-500' : 
                            txn.status === 'DECLINED' ? 'bg-red-500' : 'bg-gray-400'}`}></span>
                        {txn.status}
                      </span>
                    </td>
                    <td className="py-3.5 text-xs font-mono text-gray-500">{txn.stan || Math.floor(100000 + Math.random() * 900000)}</td>
                    <td className="py-3.5 pr-4 text-right font-mono text-xs text-gray-500">
                      #{txn.batchId || "PND"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>

      </div>
    </div>
  );
};
