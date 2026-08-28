import { useEffect, useState, useMemo } from "react";
import { fetchBatches } from "../lib/api";
import type { Batch } from "../lib/api";
import { useToast } from "../components/ui/Toast";

// --- Extended Types for Premium UI ---

interface BatchTransaction {
  id: string;
  time: string;
  amount: number;
  currency: string;
  status: "APPROVED" | "DECLINED" | "DUPLICATE" | "OFFLINE_APPROVED" | "STORED";
  cardLast4: string;
  cardType: string;
}

interface BatchUI extends Batch {
  // Enhanced fields
  terminalName: string;
  transactionCount: number;
  totalAmount: number;
  currency: string;
  
  // Breakdown
  approvedCount: number;
  declinedCount: number;
  duplicateCount: number;
  offlineApprovedCount: number;
  storedCount: number;
  
  // Metadata
  uploadDuration: string;
  firmwareVersion: string;
  connectionType: "WiFi" | "Ethernet" | "4G";
  ipAddress: string;
  
  // Error logs
  errors?: { code: string; message: string; timestamp: string }[];
  
  // Mock transactions for the drawer
  transactions: BatchTransaction[];
}

// --- Mock Data Generators ---

const generateMockTransactions = (count: number, batchId: string): BatchTransaction[] => {
  return []; // Fixed: Removed mock transactions
};

const enhanceBatchData = (b: Batch): BatchUI => {
  // Use real data from the batch object instead of generating mock values
  return {
    ...b,
    status: b.status || 'RECEIVED',
    terminalName: b.terminalName || `Terminal ${b.terminalId}`,
    transactionCount: b.transactionCount || 0,
    totalAmount: 0, // Should be calculated from real txns if available
    currency: "USD",
    
    approvedCount: b.approvedCount || 0,
    declinedCount: b.declinedCount || 0,
    duplicateCount: 0,
    offlineApprovedCount: 0,
    storedCount: 0,
    
    uploadDuration: "0ms",
    firmwareVersion: "v1.0.0",
    connectionType: "WiFi",
    ipAddress: "127.0.0.1",
    
    transactions: [] // Fixed: No mock transactions
  };
};

// --- Chart Components ---

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

const BarChart = ({ data, color, height = 60 }: { data: { label: string, value: number }[], color: string, height?: number }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value)) || 1;

  return (
    <div className="w-full flex items-end justify-between gap-1" style={{ height: `${height}px` }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 group relative">
          <div 
            className="w-full rounded-t-sm transition-all duration-500 ease-out opacity-80 group-hover:opacity-100"
            style={{ 
              height: `${(d.value / max) * 100}%`, 
              backgroundColor: color 
            }}
          ></div>
          {/* Tooltip */}
          <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10">
            {d.label}: {d.value}
          </div>
        </div>
      ))}
    </div>
  );
};

// --- Components ---

const StatCard = ({ title, value, subtext, icon, colorClass, chartData, chartType }: any) => (
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
    
    {/* Mini Chart Area */}
    {chartData && (
      <div className="mt-auto pt-2">
        {chartType === 'line' ? (
          <SmoothLineChart data={chartData} color={colorClass.includes('green') ? '#10b981' : colorClass.includes('purple') ? '#8b5cf6' : '#3b82f6'} height={40} />
        ) : (
          <BarChart data={chartData} color={colorClass.includes('orange') ? '#f97316' : '#3b82f6'} height={40} />
        )}
      </div>
    )}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    PROCESSED: "bg-emerald-50 text-emerald-700 border-emerald-100",
    SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-100",
    PARTIAL: "bg-amber-50 text-amber-700 border-amber-100",
    FAILED: "bg-rose-50 text-rose-700 border-rose-100",
    PENDING: "bg-blue-50 text-blue-700 border-blue-100",
    UPLOADED: "bg-indigo-50 text-indigo-700 border-indigo-100",
  };
  
  const dotColors: Record<string, string> = {
    PROCESSED: "bg-emerald-500",
    SUCCESS: "bg-emerald-500",
    PARTIAL: "bg-amber-500",
    FAILED: "bg-rose-500",
    PENDING: "bg-blue-500",
    UPLOADED: "bg-indigo-500",
  };

  const s = status?.toUpperCase() || 'PENDING';
  const label = s === 'PROCESSED' ? 'Success' : s.charAt(0) + s.slice(1).toLowerCase();

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[s] || styles.PENDING}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColors[s] || dotColors.PENDING}`}></span>
      {label}
    </span>
  );
};

const BatchDetailDrawer = ({ batch, isOpen, onClose, onReprocess }: { batch: BatchUI | null, isOpen: boolean, onClose: () => void, onReprocess: (batchId: string) => void }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'metadata'>('overview');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!batch) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-gray-900/20 backdrop-blur-sm transition-opacity duration-300 z-40 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className={`fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl transform transition-transform duration-300 ease-out z-50 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Batch Details</h2>
            <p className="text-sm text-gray-500 mt-1">ID: <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{batch.id}</span></p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-gray-100 flex space-x-6">
          {['overview', 'transactions', 'metadata'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-fade-in">
              {/* Status Banner */}
              <div className={`p-4 rounded-xl border ${
                batch.status === 'PROCESSED' ? 'bg-green-50 border-green-100' :
                batch.status === 'FAILED' ? 'bg-red-50 border-red-100' :
                'bg-blue-50 border-blue-100'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-full ${
                      batch.status === 'PROCESSED' ? 'bg-green-100 text-green-600' :
                      batch.status === 'FAILED' ? 'bg-red-100 text-red-600' :
                      'bg-blue-100 text-blue-600'
                    }`}>
                      {batch.status === 'PROCESSED' ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      )}
                    </div>
                    <div>
                      <h3 className={`font-semibold ${
                        batch.status === 'PROCESSED' ? 'text-green-900' :
                        batch.status === 'FAILED' ? 'text-red-900' :
                        'text-blue-900'
                      }`}>
                        Batch {batch.status === 'PROCESSED' ? 'Successful' : batch.status}
                      </h3>
                      <p className={`text-sm ${
                        batch.status === 'PROCESSED' ? 'text-green-700' :
                        batch.status === 'FAILED' ? 'text-red-700' :
                        'text-blue-700'
                      }`}>
                        Processed on {new Date(batch.uploadTimestamp).toLocaleDateString()} at {new Date(batch.uploadTimestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  {batch.status === 'FAILED' && (
                    <button 
                      onClick={() => onReprocess(batch.id)}
                      className="px-3 py-1.5 bg-white border border-red-200 text-red-700 rounded-lg text-sm font-medium shadow-sm hover:bg-red-50 transition-colors"
                    >
                      Reprocess
                    </button>
                  )}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <div className="text-sm text-gray-500 mb-1">Total Transactions</div>
                  <div className="text-2xl font-bold text-gray-900">{batch.transactionCount}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <div className="text-sm text-gray-500 mb-1">Total Amount</div>
                  <div className="text-2xl font-bold text-gray-900">${batch.totalAmount.toLocaleString()}</div>
                </div>
              </div>

              {/* Breakdown */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-900">Transaction Breakdown</div>
                <div className="divide-y divide-gray-100">
                  <div className="flex justify-between p-4 hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-600 flex items-center">
                      <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                      Approved
                    </span>
                    <span className="font-medium text-gray-900">{batch.approvedCount}</span>
                  </div>
                  <div className="flex justify-between p-4 hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-600 flex items-center">
                      <span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>
                      Declined
                    </span>
                    <span className="font-medium text-gray-900">{batch.declinedCount}</span>
                  </div>
                  <div className="flex justify-between p-4 hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-600 flex items-center">
                      <span className="w-2 h-2 rounded-full bg-amber-500 mr-2"></span>
                      Duplicate
                    </span>
                    <span className="font-medium text-gray-900">{batch.duplicateCount}</span>
                  </div>
                  <div className="flex justify-between p-4 hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-600 flex items-center">
                      <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
                      Offline Approved
                    </span>
                    <span className="font-medium text-gray-900">{batch.offlineApprovedCount}</span>
                  </div>
                  <div className="flex justify-between p-4 hover:bg-gray-50 transition-colors">
                    <span className="text-sm text-gray-600 flex items-center">
                      <span className="w-2 h-2 rounded-full bg-gray-500 mr-2"></span>
                      Stored
                    </span>
                    <span className="font-medium text-gray-900">{batch.storedCount}</span>
                  </div>
                </div>
              </div>

              {/* Error Logs */}
              {batch.errors && batch.errors.length > 0 && (
                <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-red-100 font-medium text-red-800 bg-red-50">Error Logs</div>
                  <div className="divide-y divide-red-100">
                    {batch.errors.map((err, i) => (
                      <div key={i} className="p-4 text-sm">
                        <div className="font-medium text-red-700">{err.code}</div>
                        <div className="text-red-600 mt-1">{err.message}</div>
                        <div className="text-xs text-red-400 mt-2">{new Date(err.timestamp).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in flex flex-col max-h-[500px]">
              <div className="overflow-y-auto">
                <table className="w-full text-sm text-left relative">
                  <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 bg-gray-50">Time</th>
                      <th className="px-4 py-3 bg-gray-50">Card</th>
                      <th className="px-4 py-3 bg-gray-50">Amount</th>
                      <th className="px-4 py-3 bg-gray-50">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batch.transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-600">{new Date(tx.time).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 text-gray-900 font-medium">
                          <span className="text-xs text-gray-400 mr-1">{tx.cardType}</span>
                          •••• {tx.cardLast4}
                        </td>
                        <td className="px-4 py-3 text-gray-900">${tx.amount.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            tx.status === 'APPROVED' || tx.status === 'OFFLINE_APPROVED' ? 'bg-green-100 text-green-700' :
                            tx.status === 'STORED' ? 'bg-gray-100 text-gray-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {tx.status === 'OFFLINE_APPROVED' ? 'OFFLINE' : tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in">
              <div className="divide-y divide-gray-100">
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Terminal ID</div>
                    <div className="font-mono text-sm">{batch.terminalId}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Firmware</div>
                    <div className="font-mono text-sm">{batch.firmwareVersion}</div>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Connection</div>
                    <div className="text-sm">{batch.connectionType}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">IP Address</div>
                    <div className="font-mono text-sm">{batch.ipAddress}</div>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Upload Duration</div>
                    <div className="text-sm">{batch.uploadDuration}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Batch Sequence</div>
                    <div className="font-mono text-sm">#{batch.batchSeq}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
        
        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium shadow-sm">
            Close
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-lg shadow-blue-500/30">
            Download Report
          </button>
        </div>
      </div>
    </>
  );
};

export const BatchesPage = () => {
  const [batches, setBatches] = useState<BatchUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<BatchUI | null>(null);
  const { showToast } = useToast();
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [terminalFilter, setTerminalFilter] = useState("ALL");
  const [dateRange, setDateRange] = useState("WEEK");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    fetchBatches()
      .then((data) => {
        const enhanced = data.map(enhanceBatchData);
        setBatches(enhanced);
      })
      .catch((err) => {
        console.error("Failed to load batches", err);
        setBatches([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Filter Logic
  const uniqueTerminals = useMemo(() => {
    const terminals = new Set(batches.map(b => b.terminalId));
    return Array.from(terminals);
  }, [batches]);

  const filteredBatches = useMemo(() => {
    return batches.filter(b => {
      const matchesSearch = b.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            b.terminalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            b.terminalId.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === "ALL" || 
                           (statusFilter === "SUCCESS" && b.status === "PROCESSED") ||
                           b.status === statusFilter;
      
      const matchesTerminal = terminalFilter === "ALL" || b.terminalId === terminalFilter;

      let matchesDate = true;
      const date = new Date(b.uploadTimestamp);
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
      
      return matchesSearch && matchesStatus && matchesTerminal && matchesDate;
    });
  }, [batches, searchTerm, statusFilter, terminalFilter, dateRange]);

  // Pagination Logic
  const paginatedBatches = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredBatches.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredBatches, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredBatches.length / itemsPerPage);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, terminalFilter, dateRange, itemsPerPage]);

  // Analytics Calculation
  const stats = useMemo(() => {
    const total = batches.length;
    const success = batches.filter(b => b.status === 'PROCESSED').length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    const offlineVol = batches.reduce((acc, b) => acc + b.offlineApprovedCount, 0);
    const totalTxns = batches.reduce((acc, b) => acc + b.transactionCount, 0);
    
    return { successRate, offlineVol, totalTxns, total };
  }, [batches]);

  // Actions
  const handleExport = () => {
    // Simple CSV Export
    const headers = ["Batch ID", "Terminal ID", "Upload Time", "Txns", "Approved", "Declined", "Status"];
    const rows = filteredBatches.map(b => [
      b.id,
      b.terminalId,
      new Date(b.uploadTimestamp).toISOString(),
      b.transactionCount,
      b.approvedCount,
      b.declinedCount,
      b.status
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `batches_export_${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleReprocess = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;

    if (window.confirm(`Are you sure you want to reprocess batch ${batchId}?`)) {
      showToast(`Reprocessing batch ${batchId}...`, "info");
      
      // Simulate API call - set to PENDING
      const updateStatus = (status: string, errors?: any[]) => {
        setBatches(prev => prev.map(b => 
          b.id === batchId ? { ...b, status: status, errors } : b
        ));
        
        if (selectedBatch && selectedBatch.id === batchId) {
          setSelectedBatch(prev => prev ? { ...prev, status: status, errors } : null);
        }
      };

      updateStatus('PENDING');
      
      // Simulate completion after 2 seconds
      setTimeout(() => {
        updateStatus('PROCESSED', undefined);
        showToast(`Batch ${batchId} reprocessed successfully`, "success");
      }, 2000);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Batch Upload History</h1>
          <p className="text-sm text-gray-500 mt-1">View and manage offline batch uploads from all terminals</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            {['TODAY', 'WEEK', 'MONTH'].map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  dateRange === range 
                    ? 'bg-gray-100 text-gray-900 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <button onClick={handleExport} className="flex items-center px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium shadow-sm">
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export
          </button>
        </div>
      </div>

      {/* Analytics Section (Premium) */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard 
                  title="Success Rate" 
                  value={`${stats.successRate}%`} 
                  subtext="Last 30 days" 
                  icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                  colorClass="text-green-500 bg-green-50"
                  chartType="line"
                  chartData={[85, 88, 92, 90, 95, 94, 98]}
                />
                <StatCard 
                  title="Offline Volume" 
                  value={stats.offlineVol.toLocaleString()} 
                  subtext="Transactions processed offline" 
                  icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
                  colorClass="text-purple-500 bg-purple-50"
                  chartType="line"
                  chartData={[12, 19, 15, 25, 32, 28, 45]}
                />
                <StatCard 
                  title="Total Transactions" 
                  value={stats.totalTxns.toLocaleString()} 
                  subtext="Across all batches" 
                  icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                  colorClass="text-blue-500 bg-blue-50"
                  chartType="bar"
                  chartData={[
                    {label:'Mon', value: 120}, {label:'Tue', value: 150}, {label:'Wed', value: 180}, 
                    {label:'Thu', value: 140}, {label:'Fri', value: 210}, {label:'Sat', value: 190}, {label:'Sun', value: 160}
                  ]}
                />
                <StatCard 
                  title="Active Batches" 
                  value={stats.total.toString()} 
                  subtext="Currently tracked" 
                  icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                  colorClass="text-orange-500 bg-orange-50"
                  chartType="bar"
                  chartData={[
                    {label:'T1', value: 5}, {label:'T2', value: 8}, {label:'T3', value: 3}, 
                    {label:'T4', value: 6}, {label:'T5', value: 2}
                  ]}
                />
              </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        
        {/* Filters Bar */}
        <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/30">
          <div className="relative max-w-md w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 sm:text-sm transition-all shadow-sm"
              placeholder="Search by Batch ID or Terminal..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3 overflow-x-auto pb-1 sm:pb-0">
            <select 
              className="block w-full pl-3 pr-10 py-2.5 text-sm border-gray-200 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-xl bg-white shadow-sm cursor-pointer hover:bg-gray-50 transition-colors"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="PARTIAL">Partial</option>
              <option value="FAILED">Failed</option>
            </select>
            <select 
              className="block w-full pl-3 pr-10 py-2.5 text-sm border-gray-200 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-xl bg-white shadow-sm cursor-pointer hover:bg-gray-50 transition-colors"
              value={terminalFilter}
              onChange={(e) => setTerminalFilter(e.target.value)}
            >
              <option value="ALL">All Terminals</option>
              {uniqueTerminals.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px] max-h-[600px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-100 relative">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Batch ID</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Terminal</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Upload Time</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Txns</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Breakdown</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Status</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading ? (
                // Skeleton Loader
                Array.from({ length: itemsPerPage }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-28"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-12"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-40"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"><div className="h-6 bg-gray-200 rounded-full w-20"></div></td>
                    <td className="px-6 py-4 whitespace-nowrap"></td>
                  </tr>
                ))
              ) : filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <p className="text-lg font-medium text-gray-900">No batches found</p>
                      <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or search terms</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedBatches.map((batch) => (
                  <tr 
                    key={batch.id} 
                    onClick={() => setSelectedBatch(batch)}
                    className="hover:bg-blue-50/30 hover:shadow-sm transition-all cursor-pointer group even:bg-gray-50/30 border-b border-transparent hover:border-blue-100"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{batch.id}</div>
                      <div className="text-xs text-gray-400">#{batch.batchSeq}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">{batch.terminalName}</div>
                      <div className="text-xs text-gray-500 font-mono">{batch.terminalId}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{new Date(batch.uploadTimestamp).toLocaleDateString()}</div>
                      <div className="text-xs text-gray-500">{new Date(batch.uploadTimestamp).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-bold">{batch.transactionCount}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3 text-xs">
                        <div className="flex flex-col items-center">
                          <span className="text-green-600 font-bold">{batch.approvedCount}</span>
                          <span className="text-gray-400 text-[10px]">OK</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-red-500 font-bold">{batch.declinedCount}</span>
                          <span className="text-gray-400 text-[10px]">FAIL</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-amber-500 font-bold">{batch.duplicateCount}</span>
                          <span className="text-gray-400 text-[10px]">DUP</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-blue-500 font-bold">{batch.offlineApprovedCount}</span>
                          <span className="text-gray-400 text-[10px]">OFF</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-gray-500 font-bold">{batch.storedCount}</span>
                          <span className="text-gray-400 text-[10px]">STR</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button className="text-gray-400 hover:text-blue-600 transition-colors p-2 rounded-full hover:bg-blue-50">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">
              Showing <span className="font-medium text-gray-900">{filteredBatches.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}</span> to <span className="font-medium text-gray-900">{Math.min(currentPage * itemsPerPage, filteredBatches.length)}</span> of <span className="font-medium text-gray-900">{filteredBatches.length}</span> results
            </div>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="text-sm border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 py-1"
            >
              <option value={5}>5 per page</option>
              <option value={10}>10 per page</option>
              <option value={20}>20 per page</option>
              <option value={50}>50 per page</option>
            </select>
          </div>
          
          <div className="flex space-x-2">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            
            {/* Page Numbers */}
            <div className="hidden sm:flex space-x-2">
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                // Simple logic to show first 5 pages or relevant window - for now just show first 5 or surrounding
                let pageNum = i + 1;
                if (totalPages > 5 && currentPage > 3) {
                  pageNum = currentPage - 2 + i;
                }
                if (pageNum > totalPages) return null;

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === pageNum
                        ? 'bg-blue-50 border border-blue-100 text-blue-600'
                        : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      <BatchDetailDrawer 
        batch={selectedBatch} 
        isOpen={!!selectedBatch} 
        onClose={() => setSelectedBatch(null)}
        onReprocess={handleReprocess}
      />
      
    </div>
  );
};
