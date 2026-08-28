import { useState, useEffect, useMemo } from "react";
import { CardSkeleton, TableSkeleton } from "../components/ui/Skeleton";
import { cashoutMyFatoorah, fetchBatches } from "../lib/api";
import { useToast } from "../components/ui/Toast";

// --- Types ---

interface BatchTransaction {
  id: string;
  time: string;
  stan: string;
  amount: number;
  cardType: string;
  isOffline: boolean;
  status: 'APPROVED' | 'DECLINED' | 'OFFLINE_APPROVED' | 'REVERSED' | 'STORED';
  hostResponse?: string;
}

interface Batch {
  id: string;
  terminalId: string;
  terminalName: string;
  openTime: string;
  closeTime: string;
  uploadTime: string | null;
  totalTxCount: number;
  offlineTxCount: number;
  storedTxCount: number;
  totalAmount: number;
  status: 'OPEN' | 'PENDING_UPLOAD' | 'UPLOADED' | 'ACCEPTED' | 'DECLINED' | 'PARTIALLY_ACCEPTED';
  hostResponseCode?: string;
  transactions: BatchTransaction[];
  errors?: { timestamp: string; message: string }[];
}

interface SettlementTransaction {
  stan: string;
  rrn?: string;
  amount: number;
  cardType: string;
  terminalId: string;
  batchId: string;
  status: 'SETTLED' | 'PENDING' | 'ADJUSTED';
  reversalInfo?: string;
}

interface Settlement {
  id: string; // Payout ID or Date-Merchant key
  date: string;
  merchant: string;
  grossAmount: number;
  fees: number;
  netAmount: number;
  txCount: number;
  status: 'SETTLED' | 'PENDING' | 'ADJUSTED';
  cardBrandBreakdown: Record<string, number>;
  transactions: SettlementTransaction[];
}

// --- Mock Data ---

const generateMockBatches = (count: number): Batch[] => {
  return []; // Fixed: Removed mock batches
};

const generateMockSettlements = (count: number): Settlement[] => {
  return []; // Fixed: Removed mock settlements
};

// --- Icons ---

const Icons = {
  Search: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
  Filter: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
  Download: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>,
  X: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
  ChevronRight: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>,
  Check: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  Alert: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  Upload: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m-4-4v12" /></svg>,
  Currency: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

// --- Components ---

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    OPEN: "bg-blue-100 text-blue-800",
    PENDING_UPLOAD: "bg-amber-100 text-amber-800",
    UPLOADED: "bg-indigo-100 text-indigo-800",
    ACCEPTED: "bg-green-100 text-green-800",
    DECLINED: "bg-red-100 text-red-800",
    PARTIALLY_ACCEPTED: "bg-orange-100 text-orange-800",
    SETTLED: "bg-green-100 text-green-800",
    PENDING: "bg-gray-100 text-gray-800",
    ADJUSTED: "bg-purple-100 text-purple-800",
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  colorClass: string;
}

const StatCard = ({ title, value, subtext, icon, colorClass }: StatCardProps) => (
  <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow">
    <div>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {subtext && <p className="mt-1 text-xs text-gray-500">{subtext}</p>}
    </div>
    <div className={`p-3 rounded-lg ${colorClass} bg-opacity-10 text-opacity-80`}>
      {icon}
    </div>
  </div>
);

const BatchDrawer = ({ batch, onClose }: { batch: Batch, onClose: () => void }) => {
  if (!batch) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
        <div className="fixed inset-y-0 right-0 pl-10 max-w-full flex">
          <div className="w-screen max-w-2xl transform transition ease-in-out duration-500 sm:duration-700 bg-white shadow-xl flex flex-col">
            <div className="px-4 py-6 bg-gray-50 border-b border-gray-200 sm:px-6 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-medium text-gray-900">Batch Details</h2>
                <p className="text-sm text-gray-500">ID: {batch.id}</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-500"><Icons.X /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Summary */}
              <section className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-500 block">Terminal</span>
                  <span className="text-sm font-medium">{batch.terminalName}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Status</span>
                  <StatusBadge status={batch.status} />
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Total Amount</span>
                  <span className="text-lg font-bold">${batch.totalAmount.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Transactions</span>
                  <span className="text-sm">{batch.totalTxCount} ({batch.offlineTxCount} offline)</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Open Time</span>
                  <span className="text-sm">{new Date(batch.openTime).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Close Time</span>
                  <span className="text-sm">{new Date(batch.closeTime).toLocaleString()}</span>
                </div>
              </section>

              {/* Transactions Table */}
              <section>
                <h3 className="text-sm font-medium text-gray-900 border-b border-gray-200 pb-2 mb-4">Transactions</h3>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">STAN</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {batch.transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="px-3 py-2 text-sm font-mono text-gray-500">{tx.stan}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">{new Date(tx.time).toLocaleTimeString()}</td>
                          <td className="px-3 py-2 text-sm font-medium text-gray-900">${tx.amount.toFixed(2)}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">
                            {tx.cardType}
                            {tx.isOffline && <span className="ml-1 text-[10px] bg-gray-200 px-1 rounded">OFFLINE</span>}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-500">{tx.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Errors */}
              {batch.errors && batch.errors.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-red-600 border-b border-red-200 pb-2 mb-4">Errors & Warnings</h3>
                  <ul className="space-y-2">
                    {batch.errors.map((err, i) => (
                      <li key={i} className="flex items-start text-sm text-red-600 bg-red-50 p-2 rounded">
                        <Icons.Alert />
                        <span className="ml-2">{err.message}</span>
                        <span className="ml-auto text-xs opacity-75">{new Date(err.timestamp).toLocaleTimeString()}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Export CSV</button>
              {batch.status === 'UPLOADED' && (
                <button 
                  onClick={async () => {
                    try {
                      setCashoutLoading(true);
                      const result = await cashoutMyFatoorah([{ batchId: batch.id, id: batch.id }]);
                      if (result.success) {
                        showToast(`✓ Cashout successful! ${result.message}`, "success");
                        // Refresh batches
                        await loadBatches();
                      } else {
                        showToast(`✗ Cashout failed: ${result.message}`, "error");
                      }
                    } catch (err: any) {
                      showToast(`✗ Error: ${err.message}`, "error");
                    } finally {
                      setCashoutLoading(false);
                    }
                  }}
                  disabled={cashoutLoading}
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400"
                >
                  {cashoutLoading ? 'Processing...' : '💰 Cashout to MyFatoorah'}
                </button>
              )}
              {batch.status === 'DECLINED' && (
                <button className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Retry Upload</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main Page Component ---

export function SettlementsPage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'batches' | 'settlement'>('batches');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const { showToast } = useToast();
  
  // Filter States
  const [batchSearch, setBatchSearch] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState("ALL");
  const [settlementDate, setSettlementDate] = useState("");

  // Load real batches from API
  useEffect(() => {
    loadBatches();
  }, []);

  const loadBatches = async () => {
    try {
      setLoading(true);
      const data = await fetchBatches();
      // Transform API batches to UI format
      const transformedBatches: Batch[] = data.map((b: any) => ({
        id: b.batch_id || b.id,
        terminalId: b.terminal_id,
        terminalName: `Terminal ${b.terminal_id}`,
        openTime: b.created_at,
        closeTime: b.updated_at || b.created_at,
        uploadTime: b.upload_timestamp || b.created_at,
        totalTxCount: b.txn_count || 0,
        offlineTxCount: 0,
        storedTxCount: 0,
        totalAmount: (b.total_amount || 0) / 100,
        status: b.status === 'PROCESSED' ? 'UPLOADED' : b.status === 'SETTLED' ? 'ACCEPTED' : 'PENDING_UPLOAD',
        transactions: []
      }));
      setBatches(transformedBatches);
      
      // Generate settlements from settled batches
      const settledBatches = transformedBatches.filter((b: Batch) => b.status === 'ACCEPTED');
      const generatedSettlements: Settlement[] = settledBatches.map((b: Batch, i: number) => ({
        id: `STL-${Date.now()}-${i}`,
        date: new Date(b.uploadTime).toISOString().split('T')[0],
        merchant: 'MRC-1001',
        grossAmount: b.totalAmount,
        fees: b.totalAmount * 0.029 + 0.30,
        netAmount: b.totalAmount - (b.totalAmount * 0.029 + 0.30),
        txCount: b.totalTxCount,
        status: 'SETTLED',
        cardBrandBreakdown: {},
        transactions: []
      }));
      setSettlements(generatedSettlements);
    } catch (err) {
      console.error("Failed to load batches:", err);
      showToast("Failed to load batches", "error");
    } finally {
      setLoading(false);
    }
  };

  // Filter Logic
  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      const matchesSearch = batch.id.toLowerCase().includes(batchSearch.toLowerCase()) || 
                            batch.terminalId.toLowerCase().includes(batchSearch.toLowerCase());
      const matchesStatus = batchStatusFilter === "ALL" || batch.status === batchStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [batches, batchSearch, batchStatusFilter]);

  const filteredSettlements = useMemo(() => {
    return settlements.filter(s => {
      if (!settlementDate) return true;
      return s.date === settlementDate;
    });
  }, [settlements, settlementDate]);

  // Handlers
  const handleExportBatches = () => {
    const headers = ["Batch ID", "Terminal", "Open Time", "Close Time", "Tx Count", "Total Amount", "Status"];
    const rows = filteredBatches.map(b => [
      b.id,
      b.terminalName,
      new Date(b.openTime).toLocaleString(),
      new Date(b.closeTime).toLocaleString(),
      b.totalTxCount,
      b.totalAmount.toFixed(2),
      b.status
    ]);
    downloadCSV(headers, rows, "batches_export");
  };

  const handleExportSettlements = () => {
    const headers = ["Date", "Payout ID", "Gross", "Fees", "Net", "Status"];
    const rows = filteredSettlements.map(s => [
      s.date,
      s.id,
      s.grossAmount.toFixed(2),
      s.fees.toFixed(2),
      s.netAmount.toFixed(2),
      s.status
    ]);
    downloadCSV(headers, rows, "settlements_export");
  };

  const downloadCSV = (headers: string[], rows: (string|number)[][], filename: string) => {
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batches & Settlement</h1>
          <p className="mt-1 text-sm text-gray-500">Track batch uploads, host responses, and settlement status across all terminals.</p>
        </div>
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg mt-4 sm:mt-0">
          <button
            onClick={() => setActiveTab('batches')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'batches' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Batches
          </button>
          <button
            onClick={() => setActiveTab('settlement')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'settlement' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Settlement
          </button>
        </div>
      </div>

      {/* --- BATCHES TAB --- */}
      {activeTab === 'batches' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
             <div className="flex items-center space-x-4 w-full sm:w-auto">
                <div className="relative rounded-md shadow-sm max-w-xs w-full">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm"><Icons.Search /></span>
                  </div>
                  <input 
                    type="text" 
                    className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md py-2" 
                    placeholder="Search Batch ID..." 
                    value={batchSearch}
                    onChange={(e) => setBatchSearch(e.target.value)}
                  />
                </div>
                <select 
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                  value={batchStatusFilter}
                  onChange={(e) => setBatchStatusFilter(e.target.value)}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="UPLOADED">Uploaded</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="DECLINED">Declined</option>
                </select>
             </div>
             <button 
               onClick={handleExportBatches}
               className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
             >
                <Icons.Download />
                <span className="ml-2">Export</span>
             </button>
          </div>

          {/* Batch List */}
          <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Batch ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Terminal</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Times</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transactions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBatches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedBatch(batch)}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{batch.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{batch.terminalName}</div>
                        <div className="text-xs text-gray-500">{batch.terminalId}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                         <div className="text-xs text-gray-500">
                           <div>Op: {new Date(batch.openTime).toLocaleTimeString()}</div>
                           <div>Cl: {new Date(batch.closeTime).toLocaleTimeString()}</div>
                         </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {batch.totalTxCount} ({batch.offlineTxCount} offline, {batch.storedTxCount} stored)
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                        ${batch.totalAmount.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={batch.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                         <button className="text-indigo-600 hover:text-indigo-900">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- SETTLEMENT TAB --- */}
      {activeTab === 'settlement' && (
        <div className="space-y-6 animate-fadeIn">
           {/* Widgets */}
           <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
             {loading ? (
               <>
                 <CardSkeleton />
                 <CardSkeleton />
                 <CardSkeleton />
                 <CardSkeleton />
               </>
             ) : (
               <>
                 <StatCard title="Total Settled" value="$42,500.00" icon={<Icons.Currency />} colorClass="bg-green-500 text-green-600" />
                 <StatCard title="Fees" value="$1,232.50" icon={<Icons.Alert />} colorClass="bg-red-500 text-red-600" />
                 <StatCard title="Net Payout" value="$41,267.50" icon={<Icons.Check />} colorClass="bg-indigo-500 text-indigo-600" />
                 <StatCard title="Transactions" value="842" icon={<Icons.Upload />} colorClass="bg-blue-500 text-blue-600" />
               </>
             )}
           </div>

           {/* Filters */}
           <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
              <div className="flex space-x-4">
                 <input 
                   type="date" 
                   className="border-gray-300 rounded-md shadow-sm sm:text-sm" 
                   value={settlementDate}
                   onChange={(e) => setSettlementDate(e.target.value)}
                 />
                 <select className="border-gray-300 rounded-md shadow-sm sm:text-sm"><option>All Merchants</option></select>
                 <select className="border-gray-300 rounded-md shadow-sm sm:text-sm"><option>All Statuses</option></select>
              </div>
              <button 
                onClick={handleExportSettlements}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                 <Icons.Download />
                 <span className="ml-2">Export Report</span>
              </button>
           </div>

           {/* Settlement Table */}
           <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden relative min-h-[400px]">
             {loading ? (
               <div className="p-6">
                 <TableSkeleton rows={8} columns={6} />
               </div>
             ) : (
             <div className="overflow-x-auto max-h-[600px]">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                   <tr>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Date</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Payout ID</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Gross</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Fees</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Net</th>
                     <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Status</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {filteredSettlements.length === 0 ? (
                     <tr>
                       <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                         No settlements found.
                       </td>
                     </tr>
                   ) : (
                   filteredSettlements.map((settlement) => (
                     <tr key={settlement.id} className="hover:bg-gray-50">
                       <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{settlement.date}</td>
                       <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{settlement.id}</td>
                       <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${settlement.grossAmount.toFixed(2)}</td>
                       <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">-${settlement.fees.toFixed(2)}</td>
                       <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">${settlement.netAmount.toFixed(2)}</td>
                       <td className="px-6 py-4 whitespace-nowrap">
                         <StatusBadge status={settlement.status} />
                       </td>
                     </tr>
                   )))}
                 </tbody>
               </table>
             </div>
             )}
           </div>
        </div>
      )}

      {/* Drawers */}
      {selectedBatch && (
        <BatchDrawer batch={selectedBatch} onClose={() => setSelectedBatch(null)} />
      )}
    </div>
  );
}
