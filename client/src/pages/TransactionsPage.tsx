import { useEffect, useState, useMemo } from "react";
import { fetchTransactions, type Transaction } from "../lib/api";

// --- Reusable Components (Local Definition) ---

const SmoothLineChart = ({ data, color, height = 60 }: { data: number[], color: string, height?: number }) => {
  if (!data || data.length === 0) return null;
  
  const max = Math.max(...data) || 1;
  const min = Math.min(...data) || 0;
  const range = max - min || 1;
  
  const getCoord = (val: number, i: number) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 80 - 10;
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

  return (
    <div className="w-full relative" style={{ height: `${height}px` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <path d={dPath} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <path d={`${dPath} L 100,120 L 0,120 Z`} fill={color} fillOpacity="0.1" />
      </svg>
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string;
  subtext: React.ReactNode;
  icon: React.ReactNode;
  colorClass: string;
  chartData?: number[];
}

const StatCard = ({ title, value, subtext, icon, colorClass, chartData }: StatCardProps) => (
  <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group flex flex-col justify-between h-full">
    <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500 ${colorClass}`}>
      {icon}
    </div>
    <div className="relative z-10">
      <div className="text-sm font-medium text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold text-gray-900 mb-2">{value}</div>
      <div className="text-xs text-gray-400 flex items-center mb-4">
        {subtext}
      </div>
    </div>
    
    {chartData && (
      <div className="mt-auto pt-2">
        <SmoothLineChart data={chartData} color={colorClass.includes('green') ? '#10b981' : colorClass.includes('purple') ? '#8b5cf6' : '#3b82f6'} height={40} />
      </div>
    )}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    APPROVED: "bg-green-50 text-green-700 border-green-100 ring-green-500/20",
    DECLINED: "bg-red-50 text-red-700 border-red-100 ring-red-500/20",
    PENDING: "bg-amber-50 text-amber-700 border-amber-100 ring-amber-500/20",
    ERROR: "bg-red-50 text-red-700 border-red-100 ring-red-500/20",
    OFFLINE_APPROVED: "bg-blue-50 text-blue-700 border-blue-100 ring-blue-500/20",
    STORED: "bg-gray-100 text-gray-700 border-gray-200 ring-gray-500/20",
    SYNCED: "bg-green-50 text-green-700 border-green-100 ring-green-500/20",
    VOIDED_UNVERIFIED: "bg-gray-100 text-gray-700 border-gray-200 ring-gray-500/20",
    PENDING_CAPTURE: "bg-orange-50 text-orange-800 border-orange-200 ring-orange-500/20",
  };

  const dotColors: Record<string, string> = {
    APPROVED: "bg-green-500",
    DECLINED: "bg-red-500",
    PENDING: "bg-amber-500",
    ERROR: "bg-red-500",
    OFFLINE_APPROVED: "bg-blue-500",
    STORED: "bg-gray-500",
    SYNCED: "bg-green-500",
    VOIDED_UNVERIFIED: "bg-gray-500",
    PENDING_CAPTURE: "bg-orange-500",
  };

  const s = status?.toUpperCase() || 'PENDING';
  const displayStatus = s.replaceAll('_', ' ');

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ring-1 ring-inset ${styles[s] || styles.PENDING}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColors[s] || dotColors.PENDING}`}></span>
      {displayStatus}
    </span>
  );
};

// --- Main Component ---

export const TransactionsPage = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  
  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dateRange, setDateRange] = useState("ALL"); // ALL, TODAY, WEEK, MONTH
  
  // Pagination
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const serverData = await fetchTransactions();
      const sorted = [...serverData].sort((a, b) => new Date(b.txnTimestamp).getTime() - new Date(a.txnTimestamp).getTime());
      setTransactions(sorted);
    } catch (e) {
      console.error("Failed to load transactions:", e);
      setLoadError(e instanceof Error ? e.message : "Transactions could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Reset pagination on filter change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateRange, itemsPerPage]);

  const filteredTxns = useMemo(() => {
    return transactions.filter(t => {
      const matchesSearch = 
        t.id.toLowerCase().includes(search.toLowerCase()) || 
        t.terminalId.toLowerCase().includes(search.toLowerCase()) ||
        (t.stan && t.stan.includes(search)) ||
        (t.batchId && t.batchId.includes(search));
      
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      
      let matchesDate = true;
      const date = new Date(t.txnTimestamp);
      const now = new Date();
      if (dateRange === "TODAY") {
        matchesDate = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      } else if (dateRange === "WEEK") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        matchesDate = date >= weekAgo;
      } else if (dateRange === "MONTH") {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        matchesDate = date >= monthAgo;
      }
      
      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [transactions, search, statusFilter, dateRange]);

  const paginatedTxns = useMemo(() => {
    const startIndex = (page - 1) * itemsPerPage;
    return filteredTxns.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTxns, page, itemsPerPage]);

  const totalPages = Math.ceil(filteredTxns.length / itemsPerPage);

  // Statistics
  const stats = useMemo(() => {
    const totalCount = filteredTxns.length;
    const totalVolume = filteredTxns.reduce((sum, t) => sum + (t.amountMinor || 0), 0) / 100;
    const approvedCount = filteredTxns.filter(t => t.status === 'APPROVED' || t.status === 'SYNCED').length;
    const approvalRate = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;

    // Volume chart data: last 10 transactions (real)
    const volumeData = filteredTxns.slice(0, 10).map(t => t.amountMinor / 100).reverse();

    // Period-over-period volume delta (real comparison)
    const now = Date.now();
    const periodMs = dateRange === 'TODAY' ? 24 * 60 * 60 * 1000
                  : dateRange === 'WEEK' ? 7 * 24 * 60 * 60 * 1000
                  : dateRange === 'MONTH' ? 30 * 24 * 60 * 60 * 1000
                  : 365 * 24 * 60 * 60 * 1000;
    const periodStart = now - periodMs;
    const prevStart = periodStart - periodMs;

    const currentPeriodVolume = filteredTxns
      .filter(t => new Date(t.txnTimestamp).getTime() >= periodStart)
      .reduce((s, t) => s + (t.amountMinor || 0), 0) / 100;
    const prevPeriodVolume = filteredTxns
      .filter(t => {
        const d = new Date(t.txnTimestamp).getTime();
        return d >= prevStart && d < periodStart;
      })
      .reduce((s, t) => s + (t.amountMinor || 0), 0) / 100;

    const volumeDeltaPct = prevPeriodVolume > 0
      ? ((currentPeriodVolume - prevPeriodVolume) / prevPeriodVolume) * 100
      : 0;

    // Count chart data: up to 7 real chronological bins of txn counts
    let countData: number[] = [];
    try {
      const bins = 7;
      if (totalCount >= bins) {
        const sorted = [...filteredTxns].sort((a, b) =>
          new Date(a.txnTimestamp).getTime() - new Date(b.txnTimestamp).getTime()
        );
        const perBin = Math.ceil(sorted.length / bins);
        for (let i = 0; i < bins; i++) {
          countData.push(sorted.slice(i * perBin, (i + 1) * perBin).length);
        }
      } else if (totalCount > 0) {
        countData = Array(Math.min(bins, totalCount)).fill(0).map((_, i) =>
          i === 0 ? totalCount : 0
        );
      }
    } catch {
      countData = totalCount > 0 ? [totalCount] : [];
    }

    // Approval rate chart data: up to 7 real points from filtered transactions grouped chronologically
    let approvalChartData: number[] = [];
    try {
      const bins = 7;
      if (totalCount >= bins) {
        const sorted = [...filteredTxns].sort((a, b) =>
          new Date(a.txnTimestamp).getTime() - new Date(b.txnTimestamp).getTime()
        );
        const perBin = Math.ceil(sorted.length / bins);
        for (let i = 0; i < bins; i++) {
          const slice = sorted.slice(i * perBin, (i + 1) * perBin);
          const sliceApp = slice.filter(t => t.status === 'APPROVED' || t.status === 'SYNCED').length;
          const sliceRate = slice.length > 0 ? Math.round((sliceApp / slice.length) * 100) : 0;
          approvalChartData.push(sliceRate);
        }
      } else if (totalCount > 0) {
        approvalChartData = Array(Math.min(bins, totalCount)).fill(0).map(() => Math.round(approvalRate));
      }
    } catch {
      approvalChartData = totalCount > 0 ? [Math.round(approvalRate)] : [];
    }

    return {
      totalCount,
      totalVolume,
      approvalRate,
      volumeData,
      countData,
      approvalChartData,
      volumeDeltaPct,
      currentPeriodVolume,
      prevPeriodVolume
    };
  }, [filteredTxns, dateRange]);

  const escapeCsvValue = (value: unknown) => {
    const stringValue = String(value ?? "");
    const needsQuotes = /[",\n]/.test(stringValue);
    return needsQuotes ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  };

  const exportTransactions = (txns: Transaction[], fileName: string) => {
    // Batch payment CSV format
    const headers = [
      "name",
      "recipientEmail",
      "paymentReference",
      "referenceNumber",
      "receiverType",
      "amount",
      "sourceCurrency",
      "targetCurrency",
      "batchId",
      "stan",
      "authMode",
      "entryMode",
      "status",
      "date"
    ];
    const rows = txns.map(t => [
      t.merchantId || 'Merchant',              // name
      '',                                       // recipientEmail
      `REF-${t.id}`,                            // paymentReference
      t.id,                                     // referenceNumber
      'BUSINESS',                               // receiverType
      (t.amountMinor / 100).toFixed(2),         // amount
      t.currency || 'USD',                      // sourceCurrency
      t.currency || 'USD',                      // targetCurrency
      t.batchId || '',                          // batchId
      t.stan || '',                             // stan
      t.authMode || '',                         // authMode
      t.entryMode || '',                        // entryMode
      t.status,                                 // status
      new Date(t.txnTimestamp).toISOString(),   // date
    ]);

    const csvContent = [
      headers.map(escapeCsvValue).join(","),
      ...rows.map(row => row.map(escapeCsvValue).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileName);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleExport = () => {
    exportTransactions(filteredTxns, `transactions_export_${new Date().toISOString().slice(0,10)}.csv`);
  };

  const handleExportSingleTransaction = (txn: Transaction) => {
    exportTransactions([txn], `transaction_${txn.id}.csv`);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <div className="text-sm text-gray-500 font-medium">Loading Transactions...</div>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
      <h1 className="text-lg font-semibold">Transactions could not be loaded</h1>
      <p className="mt-2 text-sm">{loadError}</p>
      <button
        type="button"
        onClick={fetchData}
        className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
      >
        Retry
      </button>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and analyze real-time transaction data</p>
        </div>
        <div className="flex gap-2">
           <button 
             onClick={handleExport}
             className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-2"
           >
             <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
             Export CSV
           </button>
           <button 
             onClick={fetchData}
             className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
           >
             <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
             Refresh
           </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Total Volume" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stats.totalVolume)} 
          subtext={
            <span className={`flex items-center ${stats.volumeDeltaPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                   style={{ transform: stats.volumeDeltaPct >= 0 ? 'rotate(0deg)' : 'rotate(180deg)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              {stats.volumeDeltaPct >= 0 ? '+' : ''}{stats.volumeDeltaPct.toFixed(1)}% vs last period
            </span>
          }
          icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          colorClass="text-blue-600"
          chartData={stats.volumeData}
        />
        <StatCard 
          title="Transaction Count" 
          value={stats.totalCount.toLocaleString()} 
          subtext={
            <span className="flex items-center text-gray-500">
              Across all terminals
            </span>
          }
          icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
          colorClass="text-purple-600"
          chartData={stats.countData}
        />
        <StatCard 
          title="Approval Rate" 
          value={`${stats.approvalRate.toFixed(1)}%`} 
          subtext={
            <span className={`flex items-center ${stats.approvalRate >= 95 ? 'text-green-600' : stats.approvalRate >= 85 ? 'text-amber-600' : 'text-red-600'}`}>
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {stats.approvalRate >= 85
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />}
              </svg>
              {stats.approvalRate >= 95 ? 'Optimal Performance'
               : stats.approvalRate >= 85 ? 'Stable — Monitor Edge Cases'
               : 'Attention — Elevated Decline Rate'}
            </span>
          }
          icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          colorClass="text-green-600"
          chartData={stats.approvalChartData}
        />
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input 
            type="text" 
            placeholder="Search ID, Terminal, STAN..." 
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm bg-gray-50/50 hover:bg-white focus:bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide items-center">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden p-1 bg-gray-50/50">
            {['ALL', 'TODAY', 'WEEK', 'MONTH'].map(range => (
               <button
                 key={range}
                 onClick={() => setDateRange(range)}
                 className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                   dateRange === range 
                     ? 'bg-white text-blue-600 shadow-sm' 
                     : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                 }`}
               >
                 {range}
               </button>
            ))}
          </div>
          <div className="h-6 w-px bg-gray-200 mx-2 hidden md:block"></div>
          <select 
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Status</option>
            <option value="APPROVED">Approved</option>
            <option value="DECLINED">Declined</option>
            <option value="PENDING">Pending</option>
            <option value="PENDING_CAPTURE">Pending Capture</option>
            <option value="OFFLINE_APPROVED">Offline Approved</option>
            <option value="STORED">Stored</option>
            <option value="VOIDED_UNVERIFIED">Voided · unverified</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[600px]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse relative">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                <th className="px-6 py-4 bg-gray-50">Date & Time</th>
                <th className="px-6 py-4 bg-gray-50">Terminal</th>
                <th className="px-6 py-4 bg-gray-50">Card / Brand</th>
                <th className="px-6 py-4 bg-gray-50">Amount</th>
                <th className="px-6 py-4 bg-gray-50">Status</th>
                <th className="px-6 py-4 bg-gray-50">Ref ID</th>
                <th className="px-6 py-4 text-right bg-gray-50">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedTxns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-400">
                      <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mb-4 text-gray-200"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                      <p className="text-lg font-medium text-gray-500">No transactions found</p>
                      <p className="text-sm">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedTxns.map((t, idx) => (
                  <tr 
                    key={t.id} 
                    className={`group hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {new Date(t.txnTimestamp).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {new Date(t.txnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 font-medium">
                      {t.terminalId}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-5 bg-gray-100 rounded flex items-center justify-center text-[10px] font-bold text-gray-400">
                          {t.cardBrand ? t.cardBrand.substring(0, 4) : 'CARD'}
                        </div>
                        <div className="text-xs text-gray-600 font-medium">
                          {t.cardBrand || (t.panMasked ? 'VISA' : 'UNKNOWN')}
                        </div>
                        {t.readerSource && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {t.readerSource === 'NFC_CONTACTLESS' ? 'NFC' : t.readerSource === 'EMV_CHIP' ? 'EMV' : 'CARD'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-gray-900 tracking-tight">
                      <div className="flex items-center">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: t.currency || 'USD' }).format(t.amountMinor / 100)}
                        {(t.status === 'OFFLINE_APPROVED' || t.status === 'STORED' || t.terminalId === 'FLUTTER-POS') && (
                          <span title="Offline Sync Transaction" className="ml-2 text-blue-500">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-gray-500">
                      {t.invoiceId || t.stan || t.id.substring(0, 8)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportSingleTransaction(t);
                          }}
                          className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                          title="Export this transaction"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mr-1"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          CSV
                        </button>
                        <button 
                          onClick={() => setSelectedTxn(t)}
                          className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded-md hover:bg-blue-50"
                          title="View Details"
                        >
                          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {totalPages > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50 gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                Showing <span className="font-medium">{(page - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(page * itemsPerPage, filteredTxns.length)}</span> of <span className="font-medium">{filteredTxns.length}</span> results
              </span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-gray-600 transition-colors"
              >
                Previous
              </button>
              <div className="flex gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let p = i + 1;
                  if (totalPages > 5 && page > 3) {
                    p = page - 2 + i;
                  }
                  if (p > totalPages) return null;
                  
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 flex items-center justify-center text-xs rounded-md transition-colors ${
                        page === p 
                          ? 'bg-blue-600 text-white shadow-sm' 
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-gray-600 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-900">Transaction Details</h3>
              <button 
                onClick={() => setSelectedTxn(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Amount</span>
                <span className="text-2xl font-bold text-gray-900">{new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedTxn.currency || 'USD' }).format(selectedTxn.amountMinor / 100)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Status</span>
                <StatusBadge status={selectedTxn.status} />
              </div>
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Date</span>
                  <span className="text-gray-900 font-medium">{new Date(selectedTxn.txnTimestamp).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Transaction ID</span>
                  <span className="text-gray-900 font-mono text-xs">{selectedTxn.id}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Terminal ID</span>
                  <span className="text-gray-900 font-medium">{selectedTxn.terminalId}</span>
                </div>
                {selectedTxn.cardBrand && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Card Brand</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.cardBrand}</span>
                  </div>
                )}
                {selectedTxn.readerSource && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Entry Mode</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.readerSource}</span>
                  </div>
                )}
                {selectedTxn.cvmResult && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">CVM</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.cvmResult}</span>
                  </div>
                )}
                {typeof selectedTxn.pinVerified === 'boolean' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">PIN Verified</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.pinVerified ? 'Yes' : 'No'}</span>
                  </div>
                )}
                {selectedTxn.invoiceId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Invoice ID</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.invoiceId}</span>
                  </div>
                )}
                {selectedTxn.paymentId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Payment ID</span>
                    <span className="text-gray-900 font-medium">{selectedTxn.paymentId}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">STAN</span>
                  <span className="text-gray-900 font-medium">{selectedTxn.stan || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Batch ID</span>
                  <span className="text-gray-900 font-medium">{selectedTxn.batchId || '-'}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button 
                onClick={() => setSelectedTxn(null)}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
