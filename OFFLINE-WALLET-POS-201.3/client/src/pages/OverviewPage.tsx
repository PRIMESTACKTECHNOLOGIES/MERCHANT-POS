import { useEffect, useState } from "react";
import { fetchTerminals, fetchTransactions, type Transaction, type Terminal } from "../lib/api";
import { Link } from "react-router-dom";

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

// --- Mock Data Helpers ---

const generateChartData = (filter: string) => {
  return []; // Return empty data to remove mock chart
};

const enhanceTerminalData = (t: Terminal): TerminalUI => {
  const hash = t.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const statuses: ('ONLINE' | 'OFFLINE' | 'ERROR' | 'SYNCING')[] = ['ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE', 'SYNCING', 'ERROR'];
  const weightedStatus = hash % 10 < 7 ? 'ONLINE' : statuses[hash % statuses.length];
  
  return {
    ...t,
    status: weightedStatus,
  };
};

const INSIGHTS = {
  avgTicket: 42.50,
  peakHour: "12:00 PM - 2:00 PM",
  paymentMethods: [
    { type: "Chip (EMV)", percent: 65, color: "var(--accent-primary)" },
    { type: "Tap (NFC)", percent: 25, color: "var(--accent-secondary)" },
    { type: "Swipe", percent: 10, color: "var(--text-muted)" },
  ],
  offlineOnlineRatio: { offline: 15, online: 85 }
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
  
  const max = Math.max(...data.map(d => d.value)) * 1.1;
  const min = Math.min(...data.map(d => d.value)) * 0.8;
  const range = max - min;
  
  const getCoord = (d: { day: string; value: number }, i: number) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((d.value - min) / range) * 80 - 10;
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

export const OverviewPage = () => {
  const [terminals, setTerminals] = useState<TerminalUI[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartData, setChartData] = useState<{ day: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState('Today');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [terms, txns] = await Promise.all([fetchTerminals(), fetchTransactions()]);
        setTerminals(terms.map(enhanceTerminalData));
        setTransactions(txns.sort((a, b) => new Date(b.txnTimestamp).getTime() - new Date(a.txnTimestamp).getTime()));
        setChartData(generateChartData(timeFilter));
      } catch (err) {
        console.error("Failed to load dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [timeFilter]);

  // KPIs Calculations
  const multiplier = 1;
  const totalSales = (transactions.reduce((sum, t) => sum + t.amountMinor, 0) / 100);
  const perCurrencyTotals = transactions.reduce<Record<string, number>>((acc, t) => {
    const c = t.currency || 'USD';
    acc[c] = (acc[c] || 0) + (t.amountMinor / 100);
    return acc;
  }, {});
  const totalSalesDisplay = Object.entries(perCurrencyTotals).map(([c, v]) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(v)
  ).join(' · ') || '$0.00';
  const successfulTxns = transactions.filter(t => ['APPROVED','SETTLED','COMPLETED'].includes(t.status)).length;
  const declinedTxns = transactions.filter(t => t.status === 'DECLINED').length;
  const activeTerminals = terminals.filter(t => t.status === 'ONLINE').length; 
  
  const offlinePending = 0; // Fixed: No mock offline pending
  const chargebacks = 0; // Fixed: No mock chargebacks

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
          <p className="text-sm text-gray-500 mt-1">Welcome back, Merchant Admin</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          <button className="p-2 text-gray-500 hover:text-blue-600 bg-white hover:bg-gray-50 rounded-full border border-gray-200 shadow-sm transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
        <StatCard 
          title="Total Sales" 
          value={totalSalesDisplay}
          trend="+12.5%"
          trendUp={true}
          color="var(--accent-primary)"
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard 
          title="Offline Pending" 
          value={offlinePending}
          subtext="Est. $450.00"
          trend="Syncing..."
          trendUp={true} // Neutral
          color="#f59e0b" // Amber
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" /></svg>}
        />
        <StatCard 
          title="Successful Txns" 
          value={successfulTxns}
          trend="98.5% Rate"
          trendUp={true}
          color="#10b981" // Emerald
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard 
          title="Declined" 
          value={declinedTxns}
          trend="1.5% Rate"
          trendUp={false} 
          color="#ef4444" // Red
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard 
          title="Active Terminals" 
          value={`${activeTerminals}/${terminals.length}`}
          trend="All Online"
          trendUp={true}
          color="#3b82f6" // Blue
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
        />
        <StatCard 
          title="Chargebacks" 
          value={chargebacks}
          trend="Action Req."
          trendUp={false}
          color="#8b5cf6" // Violet
          icon={<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
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
                  <div className="text-2xl font-bold text-gray-900 tracking-tight">${INSIGHTS.avgTicket.toFixed(2)}</div>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                </div>
              </div>

              {/* Offline vs Online Ratio */}
              <div>
                <div className="flex justify-between items-end mb-2">
                   <div className="text-sm text-gray-500 font-medium">Transaction Mode</div>
                   <div className="text-xs font-semibold text-gray-500">{INSIGHTS.offlineOnlineRatio.online}% Online</div>
                </div>
                <div className="flex h-3 w-full rounded-full overflow-hidden">
                   <div className="bg-blue-500 h-full" style={{ width: `${INSIGHTS.offlineOnlineRatio.online}%` }} title="Online"></div>
                   <div className="bg-amber-500 h-full" style={{ width: `${INSIGHTS.offlineOnlineRatio.offline}%` }} title="Offline"></div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                   <span>Online</span>
                   <span>Offline ({INSIGHTS.offlineOnlineRatio.offline}%)</span>
                </div>
              </div>
              
              {/* Peak Hour */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div className="text-sm text-gray-500 font-medium">Peak Transaction Hour</div>
                  <div className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100">Busy Now</div>
                </div>
                <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  {INSIGHTS.peakHour}
                </div>
              </div>

              {/* Payment Methods */}
              <div>
                <div className="text-sm text-gray-500 mb-4 font-medium">Payment Methods</div>
                <div className="space-y-4">
                  {INSIGHTS.paymentMethods.map((method, i) => (
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
             
             {/* Opportunities / Alerts Panel */}
             <div className="card border border-orange-100 bg-orange-50/50 p-4 rounded-xl shadow-sm relative overflow-hidden">
                <div className="flex items-center gap-3 mb-2">
                   <div className="p-1.5 bg-orange-100 rounded-lg text-orange-600">
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                   </div>
                   <h3 className="text-sm font-bold text-orange-900">Attention Required</h3>
                </div>
                <div className="space-y-2">
                   <div className="flex items-start gap-2 text-xs text-orange-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></span>
                      <span>3 Offline batches pending upload (&gt; 2 hours)</span>
                   </div>
                   <div className="flex items-start gap-2 text-xs text-orange-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0"></span>
                      <span>Terminal <span className="font-mono font-semibold">T-8842</span> not synced today</span>
                   </div>
                </div>
                <Link 
                  to="/batches"
                  className="mt-3 block w-full py-1.5 bg-white border border-orange-200 text-orange-700 text-xs text-center font-semibold rounded-lg hover:bg-orange-50 transition-colors shadow-sm"
                >
                   Resolve Issues
                </Link>
             </div>

             {/* Accuracy Score */}
             <div className="card bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                   <svg width="60" height="60" fill="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div className="text-sm font-medium text-indigo-100 mb-1">Batch Accuracy</div>
                <div className="text-3xl font-bold mb-2">99.8%</div>
                <div className="text-xs text-indigo-100 bg-white/20 inline-block px-2 py-1 rounded-lg backdrop-blur-sm">
                   Top 5% of merchants
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
                            </div>
                         </div>
                         <div className="text-sm font-bold text-gray-900">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency || 'USD' }).format(txn.amountMinor / 100)}
                         </div>
                      </div>
                   ))}
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
            {terminals.slice(0, 5).map(term => (
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
                  <div className="text-xs font-bold text-gray-900">$1,240.50</div>
                  <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Today</div>
                </div>
              </div>
            ))}
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
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency || 'USD' }).format(txn.amountMinor / 100)}
                    </td>
                    <td className="py-3.5 text-xs font-medium text-gray-500">{txn.currency || 'USD'}</td>
                    <td className="py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border
                        ${['APPROVED','SETTLED','COMPLETED'].includes(txn.status) ? 'bg-green-50 text-green-700 border-green-100' : 
                          txn.status === 'DECLINED' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-gray-50 text-gray-700 border-gray-100'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 
                          ${['APPROVED','SETTLED','COMPLETED'].includes(txn.status) ? 'bg-green-500' : 
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
