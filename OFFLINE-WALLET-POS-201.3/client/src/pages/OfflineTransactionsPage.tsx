import { useState, useEffect } from "react";
import { useToast } from "../components/ui/Toast";
import { Skeleton, TableSkeleton } from "../components/ui/Skeleton";

// --- Icons ---
const Icons = {
  Offline: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>,
  Upload: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>,
  Clock: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Search: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
  Filter: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
};

// --- Mock Data ---
interface OfflineTransaction {
  id: string;
  amount: number;
  currency: string;
  timestamp: string;
  cardLast4: string;
  cardType: string;
  status: 'STORED' | 'SYNCING' | 'FAILED';
  terminalId: string;
  authCode: string;
}

const MOCK_TRANSACTIONS: OfflineTransaction[] = [
  { id: 'off_1', amount: 45.50, currency: 'USD', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), cardLast4: '4242', cardType: 'Visa', status: 'STORED', terminalId: 'T101', authCode: 'OFF001' },
  { id: 'off_2', amount: 120.00, currency: 'USD', timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), cardLast4: '8888', cardType: 'Mastercard', status: 'STORED', terminalId: 'T102', authCode: 'OFF002' },
  { id: 'off_3', amount: 12.99, currency: 'USD', timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), cardLast4: '1234', cardType: 'Amex', status: 'FAILED', terminalId: 'T101', authCode: 'OFF003' },
  { id: 'off_4', amount: 89.95, currency: 'USD', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), cardLast4: '9012', cardType: 'Visa', status: 'SYNCING', terminalId: 'T103', authCode: 'OFF004' },
];

// --- Components ---
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

const StatCard = ({ title, value, icon, color }: StatCardProps) => (
  <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm relative overflow-hidden">
    <div className="flex justify-between items-start mb-4">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className={`p-2 rounded-lg bg-opacity-10`} style={{ backgroundColor: `${color}15`, color: color }}>
        {icon}
      </div>
    </div>
    <div className="text-2xl font-bold text-gray-900">{value}</div>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    STORED: "bg-amber-50 text-amber-700 border-amber-100",
    SYNCING: "bg-blue-50 text-blue-700 border-blue-100",
    FAILED: "bg-red-50 text-red-700 border-red-100",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.STORED}`}>
      {status}
    </span>
  );
};

export const OfflineTransactionsPage = () => {
  const [transactions, setTransactions] = useState<OfflineTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    // Load real transactions from localStorage (shared with POSPageSecure)
    const loadRealTransactions = () => {
      try {
        const stored = localStorage.getItem('dashboard_transactions');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Map TransactionRecord to OfflineTransaction interface
          const mapped: OfflineTransaction[] = parsed.map((t: any, index: number) => ({
            id: t.localTxnId || `off_${index}`,
            amount: t.amount,
            currency: 'USD',
            timestamp: new Date(t.timestamp).toISOString(),
            cardLast4: t.cardLast4,
            cardType: 'Card',
            status: t.status === 'PENDING' ? 'STORED' : (t.status === 'SYNCED' ? 'SYNCED' : 'FAILED'),
            terminalId: 'WEB-TERMINAL',
            authCode: t.settlementCode || 'N/A'
          }));
          // Sort by timestamp descending
          mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setTransactions(mapped);
        } else {
          setTransactions([]);
        }
      } catch (e) {
        console.error("Failed to load real transactions:", e);
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    };

    loadRealTransactions();
    
    // Listen for storage changes in other tabs/windows
    window.addEventListener('storage', loadRealTransactions);
    return () => window.removeEventListener('storage', loadRealTransactions);
  }, []);

  const handleSyncAll = () => {
    const pending = transactions.filter(t => t.status === 'STORED');
    if (pending.length === 0) {
      showToast("No pending transactions to sync", "info");
      return;
    }
    
    showToast(`Syncing ${pending.length} transactions to host...`, "info");
    
    // Simulate sync process
    setTimeout(() => {
      const stored = localStorage.getItem('dashboard_transactions');
      if (stored) {
        const parsed = JSON.parse(stored);
        const updated = parsed.map((t: any) => ({
          ...t,
          status: t.status === 'PENDING' ? 'SYNCED' : t.status
        }));
        localStorage.setItem('dashboard_transactions', JSON.stringify(updated));
        // Trigger local update
        window.dispatchEvent(new Event('storage'));
        showToast("All transactions synced successfully!", "success");
      }
    }, 2000);
  };

  const totalOfflineAmount = transactions.reduce((acc, tx) => acc + tx.amount, 0);

  if (loading) return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-between items-center">
         <div>
           <Skeleton className="h-8 w-64 mb-2" />
           <Skeleton className="h-4 w-96" />
         </div>
         <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <Skeleton className="h-32 rounded-xl" />
         <Skeleton className="h-32 rounded-xl" />
         <Skeleton className="h-32 rounded-xl" />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
           <Skeleton className="h-6 w-48" />
        </div>
        <TableSkeleton rows={5} columns={6} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Icons.Offline /> Offline Transaction Viewer
          </h1>
          <p className="text-sm text-gray-500 mt-1">View and manage transactions stored locally on terminals.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleSyncAll}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2"
          >
            <Icons.Upload /> Force Sync All
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Pending Upload" 
          value={transactions.filter(t => t.status === 'STORED').length} 
          icon={<Icons.Offline />} 
          color="#F59E0B" 
        />
        <StatCard 
          title="Total Offline Value" 
          value={`$${totalOfflineAmount.toFixed(2)}`} 
          icon={<Icons.Upload />} 
          color="#3B82F6" 
        />
        <StatCard 
          title="Sync Errors" 
          value={transactions.filter(t => t.status === 'FAILED').length} 
          icon={<Icons.Clock />} 
          color="#EF4444" 
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <h3 className="font-bold text-gray-900">Stored Transactions</h3>
          <div className="flex gap-2">
             <div className="relative">
               <input 
                 type="text" 
                 placeholder="Search..." 
                 className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
               />
               <div className="absolute left-2.5 top-2 text-gray-400">
                 <Icons.Search />
               </div>
             </div>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left relative">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold">
                <th className="px-6 py-3 bg-gray-50">Status</th>
                <th className="px-6 py-3 bg-gray-50">Date/Time</th>
                <th className="px-6 py-3 bg-gray-50">Amount</th>
                <th className="px-6 py-3 bg-gray-50">Card</th>
                <th className="px-6 py-3 bg-gray-50">Auth Code</th>
                <th className="px-6 py-3 bg-gray-50">Terminal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4"><StatusBadge status={tx.status} /></td>
                  <td className="px-6 py-4 text-sm text-gray-600">{new Date(tx.timestamp).toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">${tx.amount.toFixed(2)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{tx.cardType} •••• {tx.cardLast4}</td>
                  <td className="px-6 py-4 text-sm font-mono text-gray-500">{tx.authCode}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{tx.terminalId}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="p-4 bg-gray-50 rounded-full mb-3 text-gray-400">
                        <Icons.Offline />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900">No offline transactions</h3>
                      <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
                        All transactions have been synced to the host or no offline transactions exist.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
