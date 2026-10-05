import { useState } from 'react';
import { useNotifications } from '../contexts/useNotifications';
import { getTransactionById, type Transaction } from '../lib/api';

export const VerifyTransactionPage = () => {
  const { addNotification } = useNotifications();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [searched, setSearched] = useState(false);

  const handleVerify = async () => {
    const id = query.trim();
    if (!id) return addNotification('Error', 'Enter a transaction ID', 'error');
    setLoading(true);
    setTransaction(null);
    setSearched(false);
    try {
      const txn = await getTransactionById(id);
      setTransaction(txn);
      setSearched(true);
      if (!txn) {
        addNotification('Not Found', `No transaction found for ID: ${id}`, 'error');
      }
    } catch (e: any) {
      addNotification('Error', e.message || 'Failed to verify transaction', 'error');
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status: string) => {
    const s = (status ?? '').toLowerCase();
    if (s === 'approved' || s === 'success' || s === 'completed') return 'bg-green-100 text-green-800';
    if (s === 'declined' || s === 'failed' || s === 'rejected') return 'bg-red-100 text-red-800';
    if (s === 'pending') return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-700';
  };

  const fmt = (val: string | number | undefined | null): string =>
    val !== null && val !== undefined && val !== '' ? String(val) : '—';

  // amountMinor is in cents (e.g. 1000 = $10.00)
  const formatAmount = (amountMinor: number, currency: string) => {
    const major = amountMinor / 100;
    return `${currency} ${major.toFixed(2)}`;
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Verify Transaction</h1>
      <p className="text-sm text-gray-500 mb-6">
        Look up a transaction by its ID to verify its status and details.
      </p>

      {/* Search */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleVerify()}
          placeholder="Enter transaction ID..."
          className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition"
        />
        <button
          onClick={handleVerify}
          disabled={loading || !query.trim()}
          className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition"
        >
          {loading ? '⏳ Verifying...' : 'Verify'}
        </button>
      </div>

      {/* Not found */}
      {searched && !transaction && !loading && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center text-red-700">
          <p className="text-lg font-semibold">Transaction Not Found</p>
          <p className="text-sm mt-1">
            No record found for ID:{' '}
            <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded">{query}</span>
          </p>
        </div>
      )}

      {/* Result */}
      {transaction && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Transaction ID</p>
              <p className="font-mono text-sm text-gray-800 mt-0.5 break-all">{transaction.id}</p>
            </div>
            <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold ${statusColor(transaction.status)}`}>
              {(transaction.status ?? 'UNKNOWN').toUpperCase()}
            </span>
          </div>

          {/* Details */}
          <div className="p-6 grid grid-cols-2 gap-x-8 gap-y-5">
            <Detail label="Amount" value={formatAmount(transaction.amountMinor, transaction.currency)} />
            <Detail label="Payment Method" value={fmt(transaction.paymentMethod)} />
            <Detail label="Merchant ID" value={fmt(transaction.merchantId)} />
            <Detail label="Terminal ID" value={fmt(transaction.terminalId)} />
            <Detail label="Customer ID" value={fmt(transaction.customerId)} />
            <Detail label="Card (Masked)" value={fmt(transaction.panMasked)} />
            <Detail label="Card Brand" value={fmt(transaction.cardBrand)} />
            <Detail label="Transaction Type" value={fmt(transaction.txnType)} />
            <Detail label="STAN" value={fmt(transaction.stan)} />
            <Detail label="Auth Code" value={fmt(transaction.authCode)} />
            <Detail label="RRN" value={fmt(transaction.rrn)} />
            <Detail label="Entry Mode" value={fmt(transaction.entryMode)} />
            <Detail
              label="Date / Time"
              value={transaction.txnTimestamp
                ? new Date(transaction.txnTimestamp).toLocaleString()
                : '—'}
              fullWidth
            />
          </div>
        </div>
      )}
    </div>
  );
};

function Detail({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800 break-all">{value}</p>
    </div>
  );
}
