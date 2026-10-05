import { useState, useEffect } from 'react';
import { useNotifications } from '../contexts/useNotifications';
import { getErrorMessage } from '../utils/errorMessage';
import {
  getCustomers,
  getWalletBalance,
  walletTransfer,
  type Customer,
  type WalletBalance,
} from '../lib/api';

export const WalletTransferPage = () => {
  const { addNotification } = useNotifications();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [senderId, setSenderId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [senderBalance, setSenderBalance] = useState<WalletBalance | null>(null);

  useEffect(() => {
    getCustomers()
      .then(data => {
        setCustomers(data);
        if (data.length > 0) setSenderId(data[0].id);
      })
      .catch(() => addNotification('Error', 'Failed to load customers', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!senderId) { setSenderBalance(null); return; }
    getWalletBalance(senderId)
      .then(setSenderBalance)
      .catch(() => setSenderBalance(null));
  }, [senderId]);

  const handleTransfer = async () => {
    if (!senderId) return addNotification('Error', 'Select a sender', 'error');
    if (!receiverId) return addNotification('Error', 'Select a receiver', 'error');
    if (senderId === receiverId) return addNotification('Error', 'Sender and receiver must be different', 'error');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return addNotification('Error', 'Enter a valid amount', 'error');
    if (senderBalance && amt > Number(senderBalance.balance)) {
      return addNotification('Error', 'Insufficient balance', 'error');
    }

    setBusy(true);
    try {
      const result = await walletTransfer(senderId, receiverId, amt, note || undefined);
      addNotification(
        'Transfer Sent',
        `$${amt.toFixed(2)} transferred successfully. Ref: ${result.reference}`,
        'success'
      );
      setAmount('');
      setNote('');
      getWalletBalance(senderId).then(setSenderBalance).catch(() => {});
    } catch (e: unknown) {
      addNotification('Transfer Failed', getErrorMessage(e, 'An error occurred'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const senderName = customers.find(c => c.id === senderId)?.name ?? '';
  const receiverName = customers.find(c => c.id === receiverId)?.name ?? '';
  const parsedAmt = parseFloat(amount) || 0;

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Wallet Transfer</h1>
      <p className="text-sm text-gray-500 mb-6">Transfer funds between customer wallets instantly.</p>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading customers...</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">

          {/* Sender */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From (Sender)</label>
            <select
              value={senderId}
              onChange={e => setSenderId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition"
            >
              <option value="">Select sender...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {senderBalance && (
              <p className="mt-1.5 text-xs text-gray-500">
                Balance:{' '}
                <span className="font-semibold text-gray-700">
                  {senderBalance.currency} {Number(senderBalance.balance).toFixed(2)}
                </span>
              </p>
            )}
          </div>

          {/* Receiver */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To (Receiver)</label>
            <select
              value={receiverId}
              onChange={e => setReceiverId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition"
            >
              <option value="">Select receiver...</option>
              {customers.filter(c => c.id !== senderId).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (USD)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Transfer note..."
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm outline-none transition"
            />
          </div>

          {/* Summary */}
          {senderId && receiverId && parsedAmt > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
              Transferring <strong>${parsedAmt.toFixed(2)}</strong> from{' '}
              <strong>{senderName}</strong> → <strong>{receiverName}</strong>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleTransfer}
            disabled={busy || !senderId || !receiverId || !amount}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition"
          >
            {busy ? '⏳ Processing...' : 'Send Transfer'}
          </button>
        </div>
      )}
    </div>
  );
};
