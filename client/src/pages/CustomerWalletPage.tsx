/**
 * Customer Wallet Page - Complete Wallet UI for Each Customer
 * Organized sections: Payments, Wallet, Records, Settings
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext';
import {
  getCustomers,
  getWalletBalance,
  getWalletTransactions,
  topupWallet,
  debitWallet,
  walletTransfer,
  getCryptoWallets,
  buyCryptoWithWallet,
  withdrawCrypto,
  type Customer,
  type WalletBalance,
  type WalletTransaction,
  type CryptoWallet,
} from '../lib/api';

type Section = 'payments' | 'wallet' | 'records' | 'settings';
type PaymentAction = 'send' | 'receive' | 'scan' | 'links' | null;
type WalletAction = 'add' | 'withdraw' | 'methods' | null;

export default function CustomerWalletPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  
  const [activeSection, setActiveSection] = useState<Section>('payments');
  const [paymentAction, setPaymentAction] = useState<PaymentAction>(null);
  const [walletAction, setWalletAction] = useState<WalletAction>(null);
  
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    amount: '',
    recipient: '',
    recipientDisplay: '',
    note: '',
    method: 'card',
  });
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);

  // Load customer data
  useEffect(() => {
    if (customerId) {
      loadCustomerData();
    }
  }, [customerId]);

  const loadCustomerData = async () => {
    setLoading(true);
    try {
      const [customers, bal, crypto, txns] = await Promise.all([
        getCustomers(),
        getWalletBalance(customerId!),
        getCryptoWallets(customerId!),
        getWalletTransactions(customerId!),
      ]);
      
      const cust = customers.find(c => c.id === customerId);
      setCustomer(cust || null);
      setBalance(bal);
      setCryptoWallets(crypto);
      setTransactions(txns);
    } catch (error: any) {
      addNotification('Error', error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMoney = async () => {
    if (!form.amount || !form.recipient) {
      addNotification('Error', 'Amount and recipient required', 'error');
      return;
    }

    if (form.recipient === customerId) {
      addNotification('Error', 'Cannot send money to yourself', 'error');
      return;
    }

    setLoading(true);
    try {
      await walletTransfer(
        customerId!,
        form.recipient,
        Number(form.amount),
        form.note
      );
      
      addNotification('Success', `Sent $${form.amount} to ${form.recipientDisplay || form.recipient}`, 'success');
      setForm({ amount: '', recipient: '', recipientDisplay: '', note: '', method: 'card' });
      setPaymentAction(null);
      setSearchResults([]);
      loadCustomerData();
    } catch (error: any) {
      addNotification('Error', error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const searchCustomers = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const allCustomers = await getCustomers();
      const results = allCustomers.filter(c => 
        c.id !== customerId && (
          c.id.toLowerCase().includes(query.toLowerCase()) ||
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.email?.toLowerCase().includes(query.toLowerCase()) ||
          c.phone?.toLowerCase().includes(query.toLowerCase())
        )
      ).slice(0, 5); // Max 5 results
      
      setSearchResults(results);
    } catch (error: any) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  const selectRecipient = (customer: Customer) => {
    setForm({ 
      ...form, 
      recipient: customer.id,
      recipientDisplay: `${customer.name} (${customer.email || customer.phone || customer.id})`
    });
    setSearchResults([]);
  };

  const handleAddMoney = async () => {
    if (!form.amount) {
      addNotification('Error', 'Amount required', 'error');
      return;
    }

    setLoading(true);
    try {
      await topupWallet(customerId!, Number(form.amount), form.note);
      
      addNotification('Success', `Added $${form.amount} to wallet`, 'success');
      setForm({ amount: '', recipient: '', note: '', method: 'card' });
      setWalletAction(null);
      loadCustomerData();
    } catch (error: any) {
      addNotification('Error', error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!form.amount) {
      addNotification('Error', 'Amount required', 'error');
      return;
    }

    setLoading(true);
    try {
      await debitWallet(customerId!, Number(form.amount), form.note);
      
      addNotification('Success', `Withdrew $${form.amount} from wallet`, 'success');
      setForm({ amount: '', recipient: '', note: '', method: 'card' });
      setWalletAction(null);
      loadCustomerData();
    } catch (error: any) {
      addNotification('Error', error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!customer) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-6xl mb-4">👛</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Loading Wallet...</h2>
          <p className="text-gray-600">Please wait</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto">
          <button
            onClick={() => navigate('/wallets')}
            className="mb-4 flex items-center gap-2 text-white/90 hover:text-white transition"
          >
            <span>←</span> Back to All Wallets
          </button>
          
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-3xl">
              👤
            </div>
            <div>
              <h1 className="text-3xl font-bold">{customer.name}</h1>
              <p className="text-white/80">{customer.email}</p>
            </div>
          </div>
          
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Fiat Balance */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-white/70 text-sm mb-1">Fiat Wallet</div>
              <div className="text-3xl font-bold">
                ${Number(balance?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-white/60 text-xs mt-1">USD</div>
            </div>
            
            {/* Crypto Balance */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-white/70 text-sm mb-1">Crypto Wallet</div>
              <div className="text-3xl font-bold">
                {cryptoWallets.length}
              </div>
              <div className="text-white/60 text-xs mt-1">Assets</div>
            </div>
            
            {/* Transactions */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-white/70 text-sm mb-1">Transactions</div>
              <div className="text-3xl font-bold">
                {transactions.length}
              </div>
              <div className="text-white/60 text-xs mt-1">All time</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-8">
            <button
              onClick={() => { setActiveSection('payments'); setPaymentAction(null); setWalletAction(null); }}
              className={`py-4 px-2 font-semibold transition border-b-2 ${
                activeSection === 'payments'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              💸 Payments
            </button>
            <button
              onClick={() => { setActiveSection('wallet'); setPaymentAction(null); setWalletAction(null); }}
              className={`py-4 px-2 font-semibold transition border-b-2 ${
                activeSection === 'wallet'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              👛 Wallet
            </button>
            <button
              onClick={() => { setActiveSection('records'); setPaymentAction(null); setWalletAction(null); }}
              className={`py-4 px-2 font-semibold transition border-b-2 ${
                activeSection === 'records'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              📄 Records
            </button>
            <button
              onClick={() => { setActiveSection('settings'); setPaymentAction(null); setWalletAction(null); }}
              className={`py-4 px-2 font-semibold transition border-b-2 ${
                activeSection === 'settings'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              ⚙️ Settings
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* PAYMENTS SECTION */}
        {activeSection === 'payments' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Payments</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Send Money */}
              <button
                onClick={() => setPaymentAction('send')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">📤</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Send Money</h3>
                <p className="text-sm text-gray-600">To wallet users, bank accounts, or contacts</p>
              </button>

              {/* Receive Money */}
              <button
                onClick={() => setPaymentAction('receive')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-green-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">📥</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Receive Money</h3>
                <p className="text-sm text-gray-600">Request payments, generate QR codes</p>
              </button>

              {/* Scan to Pay */}
              <button
                onClick={() => setPaymentAction('scan')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-purple-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">📷</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Scan to Pay</h3>
                <p className="text-sm text-gray-600">QR scanner for merchant payments</p>
              </button>

              {/* Payment Links */}
              <button
                onClick={() => setPaymentAction('links')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-orange-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">🔗</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Payment Links</h3>
                <p className="text-sm text-gray-600">Create & share payment links for customers</p>
              </button>
            </div>

            {/* Send Money Form */}
            {paymentAction === 'send' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold mb-4">💸 Send Money</h3>
                <div className="space-y-4">
                  <div className="relative">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Send To
                    </label>
                    <input
                      type="text"
                      placeholder="Search by name, email, phone, or customer ID..."
                      value={form.recipientDisplay || ''}
                      onChange={e => {
                        setForm({ ...form, recipientDisplay: e.target.value, recipient: '' });
                        searchCustomers(e.target.value);
                      }}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    
                    {/* Search Results Dropdown */}
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {searchResults.map(cust => (
                          <button
                            key={cust.id}
                            onClick={() => selectRecipient(cust)}
                            className="w-full px-4 py-3 text-left hover:bg-blue-50 transition border-b border-gray-100 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                                {cust.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-gray-900">{cust.name}</div>
                                <div className="text-sm text-gray-500">
                                  {cust.email || cust.phone || cust.id}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {searching && (
                      <div className="absolute right-3 top-10 text-gray-400">
                        Searching...
                      </div>
                    )}
                    
                    {form.recipient && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-green-600">
                        <span>✓</span>
                        <span>Recipient selected</span>
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Amount (USD)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-gray-500 text-lg">$</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={form.amount}
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        className="w-full pl-8 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                      />
                    </div>
                    {form.amount && Number(form.amount) > Number(balance?.balance || 0) && (
                      <div className="mt-2 text-sm text-red-600">
                        Insufficient balance (Available: ${Number(balance?.balance || 0).toFixed(2)})
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Note (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="What's this for?"
                      value={form.note}
                      onChange={e => setForm({ ...form, note: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  
                  {/* Transfer Summary */}
                  {form.recipient && form.amount && (
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <div className="text-sm font-semibold text-blue-900 mb-2">Transfer Summary</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">You Send:</span>
                          <span className="font-semibold text-gray-900">${Number(form.amount).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Transfer Fee:</span>
                          <span className="font-semibold text-green-600">$0.00 (Free!)</span>
                        </div>
                        <div className="border-t border-blue-200 pt-1 mt-1"></div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Recipient Gets:</span>
                          <span className="font-bold text-blue-600 text-lg">${Number(form.amount).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => {
                        setPaymentAction(null);
                        setForm({ amount: '', recipient: '', recipientDisplay: '', note: '', method: 'card' });
                        setSearchResults([]);
                      }}
                      className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-semibold text-gray-700 hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendMoney}
                      disabled={loading || !form.recipient || !form.amount || Number(form.amount) <= 0 || Number(form.amount) > Number(balance?.balance || 0)}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg"
                    >
                      {loading ? '⏳ Sending...' : '💸 Send Money'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Receive Money Form */}
            {paymentAction === 'receive' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold mb-4">Receive Money</h3>
                <div className="text-center py-8">
                  <div className="w-48 h-48 mx-auto bg-gray-100 rounded-xl flex items-center justify-center mb-4">
                    <div className="text-6xl">📲</div>
                  </div>
                  <p className="text-gray-600 mb-4">Show this QR code to receive payment</p>
                  <div className="font-mono text-sm text-gray-500">Wallet ID: {customerId}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* WALLET SECTION */}
        {activeSection === 'wallet' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Wallet</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Add Money */}
              <button
                onClick={() => setWalletAction('add')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-green-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">💳</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Add Money</h3>
                <p className="text-sm text-gray-600">Card, bank transfer, cash deposit</p>
              </button>

              {/* Withdraw */}
              <button
                onClick={() => setWalletAction('withdraw')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-red-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">🏦</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Withdraw</h3>
                <p className="text-sm text-gray-600">Bank withdrawal, agent withdrawal</p>
              </button>

              {/* Payment Methods */}
              <button
                onClick={() => setWalletAction('methods')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">💎</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Payment Methods</h3>
                <p className="text-sm text-gray-600">Saved cards, bank accounts, virtual cards</p>
              </button>
            </div>

            {/* Add Money Form */}
            {walletAction === 'add' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold mb-4">Add Money</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (USD)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                    <select
                      value={form.method}
                      onChange={e => setForm({ ...form, method: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    >
                      <option value="card">Credit/Debit Card</option>
                      <option value="bank">Bank Transfer</option>
                      <option value="cash">Cash Deposit</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setWalletAction(null)}
                      className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddMoney}
                      disabled={loading}
                      className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-700 font-semibold text-white disabled:opacity-50"
                    >
                      {loading ? 'Processing...' : 'Add Money'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Withdraw Form */}
            {walletAction === 'withdraw' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                <h3 className="text-xl font-bold mb-4">Withdraw Money</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (USD)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Withdrawal Method</label>
                    <select
                      value={form.method}
                      onChange={e => setForm({ ...form, method: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="bank">Bank Transfer</option>
                      <option value="agent">Agent Withdrawal</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setWalletAction(null)}
                      className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleWithdraw}
                      disabled={loading}
                      className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 font-semibold text-white disabled:opacity-50"
                    >
                      {loading ? 'Processing...' : 'Withdraw'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RECORDS SECTION */}
        {activeSection === 'records' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Transaction Records</h2>
            
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">All Transactions</h3>
                  <button className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                    Export CSV
                  </button>
                </div>
              </div>
              
              <div className="divide-y divide-gray-100">
                {transactions.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    No transactions yet
                  </div>
                ) : (
                  transactions.map((txn, idx) => (
                    <div key={idx} className="p-4 hover:bg-gray-50 transition">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            txn.transaction_type === 'credit' ? 'bg-green-100 text-green-600' :
                            txn.transaction_type === 'debit' ? 'bg-red-100 text-red-600' :
                            'bg-blue-100 text-blue-600'
                          }`}>
                            {txn.transaction_type === 'credit' ? '↓' : txn.transaction_type === 'debit' ? '↑' : '⇄'}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{txn.source || 'Transaction'}</div>
                            <div className="text-sm text-gray-500">{new Date(txn.created_at).toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold ${
                            txn.transaction_type === 'credit' ? 'text-green-600' :
                            txn.transaction_type === 'debit' ? 'text-red-600' :
                            'text-blue-600'
                          }`}>
                            {txn.transaction_type === 'credit' ? '+' : txn.transaction_type === 'debit' ? '-' : ''}
                            ${Number(txn.fiat_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs text-gray-500">{txn.status || 'completed'}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS SECTION */}
        {activeSection === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Backup */}
              <div className="bg-white rounded-xl p-6 border-2 border-gray-200">
                <div className="text-4xl mb-3">☁️</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Backup</h3>
                <p className="text-sm text-gray-600 mb-4">Cloud backup, device sync, recovery options</p>
                <button className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                  Configure Backup
                </button>
              </div>

              {/* Security */}
              <div className="bg-white rounded-xl p-6 border-2 border-gray-200">
                <div className="text-4xl mb-3">🔒</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Security</h3>
                <p className="text-sm text-gray-600 mb-4">2FA, biometrics, PIN settings</p>
                <button className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                  Security Settings
                </button>
              </div>

              {/* Notifications */}
              <div className="bg-white rounded-xl p-6 border-2 border-gray-200">
                <div className="text-4xl mb-3">🔔</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Notifications</h3>
                <p className="text-sm text-gray-600 mb-4">Push, email, SMS preferences</p>
                <button className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                  Manage Notifications
                </button>
              </div>

              {/* Help & Support */}
              <div className="bg-white rounded-xl p-6 border-2 border-gray-200">
                <div className="text-4xl mb-3">💬</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Help & Support</h3>
                <p className="text-sm text-gray-600 mb-4">FAQ, contact support, feedback</p>
                <button className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                  Get Help
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
