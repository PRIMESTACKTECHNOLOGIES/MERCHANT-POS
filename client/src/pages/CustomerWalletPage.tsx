/**
 * Customer Wallet Page - Complete Wallet UI for Each Customer
 * Organized sections: Payments, Wallet, Records, Settings
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useNotifications } from '../contexts/useNotifications';
import './CustomerWalletPage.css';
import {
  getCustomers,
  getWalletBalance,
  getWalletTransactions,
  topupWallet,
  debitWallet,
  walletTransfer,
  sendToHotWallet,
  callProviderAndSendToMerchant,
  getCryptoWallets,
  type Customer,
  type WalletBalance,
  type WalletTransaction,
  type CryptoWallet,
} from '../lib/api';
import { getErrorMessage } from '../utils/errorMessage';

type Section = 'payments' | 'wallet' | 'records' | 'settings';
type PaymentAction = 'send' | null;
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
  const [merchantTransferOpen, setMerchantTransferOpen] = useState(false);
  const [providerEndpoint, setProviderEndpoint] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerRequestReference, setProviderRequestReference] = useState('');
  const merchantTransferInFlight = useRef(false);
  const [merchantTransfer, setMerchantTransfer] = useState({
    merchantId: '',
    amount: '',
    assetType: 'fiat' as 'fiat' | 'crypto',
    cryptoCoin: '',
    reason: '',
  });
  
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
  const loadCustomerData = useCallback(async () => {
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
    } catch (error: unknown) {
      addNotification('Error', getErrorMessage(error, 'Failed to load wallet data'), 'error');
    } finally {
      setLoading(false);
    }
  }, [customerId, addNotification]);

  useEffect(() => {
    if (customerId) {
      void loadCustomerData();
    }
  }, [customerId, loadCustomerData]);


  const handleSendMoney = async () => {
    const amount = Number(form.amount);
    if (!form.amount || !form.recipient) {
      addNotification('Error', 'Amount and recipient required', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      addNotification('Error', 'Enter a positive amount with no more than two decimal places', 'error');
      return;
    }
    if (amount > Number(balance?.balance || 0)) {
      addNotification('Error', 'Insufficient customer wallet balance', 'error');
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
        amount,
        form.note,
        customerCurrency,
      );
      
      addNotification('Success', `Sent ${formatAmount(amount)} to ${form.recipientDisplay || form.recipient}`, 'success');
      setForm({ amount: '', recipient: '', recipientDisplay: '', note: '', method: 'card' });
      setPaymentAction(null);
      setSearchResults([]);
      loadCustomerData();
    } catch (error: unknown) {
      addNotification('Error', getErrorMessage(error, 'Wallet transfer failed'), 'error');
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
    } catch (error: unknown) {
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
      setForm({ amount: '', recipient: '', recipientDisplay: '', note: '', method: 'card' });
      setWalletAction(null);
      loadCustomerData();
    } catch (error: unknown) {
      addNotification('Error', getErrorMessage(error, 'Wallet top-up failed'), 'error');
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
      setForm({ amount: '', recipient: '', recipientDisplay: '', note: '', method: 'card' });
      setWalletAction(null);
      loadCustomerData();
    } catch (error: unknown) {
      addNotification('Error', getErrorMessage(error, 'Wallet withdrawal failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const customerCurrency = balance?.currency || 'USD';
  const currencyTransactions = transactions.filter(
    (transaction) => !transaction.currency || transaction.currency.toUpperCase() === customerCurrency.toUpperCase(),
  );
  const receivedTotal = currencyTransactions.reduce((total, transaction) => (
    (transaction.transaction_type || transaction.type) === 'credit'
      ? total + Number((transaction.fiat_amount ?? transaction.amount) || 0)
      : total
  ), 0);
  const sentTotal = currencyTransactions.reduce((total, transaction) => (
    (transaction.transaction_type || transaction.type) === 'debit'
      ? total + Number((transaction.fiat_amount ?? transaction.amount) || 0)
      : total
  ), 0);
  const formatAmount = (amount: number) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: customerCurrency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
  const maskedIdentityNumber = customer?.id_number
    ? `${'•'.repeat(Math.max(customer.id_number.length - 4, 0))}${customer.id_number.slice(-4)}`
    : 'Not provided';
  const customerAddress = [
    customer?.address_line1,
    customer?.address_line2,
    customer?.city,
    customer?.postal_code,
    customer?.country,
  ].filter(Boolean).join(', ');

  const handleSendToMerchant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (merchantTransferInFlight.current) return;
    const amount = Number(merchantTransfer.amount);
    if (!merchantTransfer.merchantId.trim() || !Number.isFinite(amount) || amount <= 0) {
      addNotification('Error', 'Enter a merchant ID and a positive amount', 'error');
      return;
    }
    if (merchantTransfer.assetType === 'fiat' && amount > Number(balance?.balance || 0)) {
      addNotification('Error', 'Insufficient customer wallet balance', 'error');
      return;
    }
    if (merchantTransfer.assetType === 'crypto') {
      const cryptoWallet = cryptoWallets.find(
        (wallet) => wallet.crypto_coin.toUpperCase() === merchantTransfer.cryptoCoin.toUpperCase(),
      );
      if (!cryptoWallet || amount > Number(cryptoWallet.balance || 0)) {
        addNotification('Error', 'Insufficient balance for the selected crypto asset', 'error');
        return;
      }
    }

    merchantTransferInFlight.current = true;
    setLoading(true);
    try {
      let result: {
        amount: number;
        currency?: string;
        cryptoCoin?: string;
        merchantId: string;
      };
      if (merchantTransfer.assetType === 'fiat') {
        const amountMinor = Math.round(amount * 100);
        if (Math.abs(amount * 100 - amountMinor) > 1e-6) {
          addNotification('Error', 'Fiat transfer amounts must have no more than two decimal places', 'error');
          return;
        }
        const requestReference = providerRequestReference
          || `WPM-${window.crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
        setProviderRequestReference(requestReference);
        result = await callProviderAndSendToMerchant({
            customerId: customerId!,
            merchantId: merchantTransfer.merchantId.trim(),
            amountMinor,
            currency: customerCurrency,
            endpointUrl: providerEndpoint.trim(),
            apiKey: providerApiKey.trim(),
            requestReference,
            reason: merchantTransfer.reason.trim() || undefined,
          });
      } else {
        result = await sendToHotWallet({
            customerId: customerId!,
            merchantId: merchantTransfer.merchantId.trim(),
            assetType: merchantTransfer.assetType,
            amount,
            currency: customerCurrency,
            cryptoCoin: merchantTransfer.cryptoCoin,
            reason: merchantTransfer.reason.trim() || undefined,
          });
      }
      addNotification(
        'Success',
        `${result.amount} ${result.cryptoCoin || result.currency || customerCurrency} sent to merchant ${result.merchantId}`,
        'success',
      );
      setMerchantTransferOpen(false);
      setProviderEndpoint('');
      setProviderApiKey('');
      setProviderRequestReference('');
      setMerchantTransfer({ merchantId: '', amount: '', assetType: 'fiat', cryptoCoin: '', reason: '' });
      await loadCustomerData();
    } catch (error: unknown) {
      addNotification('Error', getErrorMessage(error, 'Merchant wallet transfer failed'), 'error');
    } finally {
      merchantTransferInFlight.current = false;
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
    <div className="customer-wallet-page">
      <header className="customer-wallet-navbar">
        <div className="customer-wallet-navbar-inner">
          <button type="button" className="customer-wallet-brand" onClick={() => navigate('/wallets')}>
            <span className="customer-wallet-brand-mark">W</span>
            <span>WALLET DASHBOARD</span>
          </button>
          <div className="customer-wallet-navbar-user">
            <span className="customer-wallet-navbar-name">{customer.name}</span>
            <button type="button" className="customer-wallet-back" onClick={() => navigate(`/customer-wallet-profile/${customer.id}`)}>
              Profile &amp; KYC
            </button>
            <button type="button" className="customer-wallet-back" onClick={() => navigate('/wallets')}>
              ← All customers
            </button>
          </div>
        </div>
      </header>

      <main className="customer-wallet-shell">
        <section className="customer-wallet-dashboard" aria-label="Customer wallet overview">
          <article className="customer-wallet-card customer-wallet-profile-card">
            <div className="customer-wallet-avatar" aria-hidden="true">
              {customer.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
            </div>
            <div className="customer-wallet-profile-copy">
              <span className="customer-wallet-eyebrow">CUSTOMER WALLET</span>
              <h1>{customer.name}</h1>
              <p>{customer.occupation || 'Personal account'}</p>
            </div>
            <div className="customer-wallet-profile-balance">
              <span>Wallet balance</span>
              <strong>{formatAmount(Number(balance?.balance || 0))}</strong>
            </div>
            <button type="button" className="customer-wallet-primary-button" onClick={() => setMerchantTransferOpen(true)}>
              ↗ Send to merchant
            </button>
          </article>

          <article className="customer-wallet-card customer-wallet-stat-card">
            <span className="customer-wallet-stat-icon received">↓</span>
            <div>
              <h2>{formatAmount(receivedTotal)}</h2>
              <p>Received</p>
            </div>
            <span className="customer-wallet-stat-caption">Wallet credits · {customerCurrency}</span>
          </article>
          <article className="customer-wallet-card customer-wallet-stat-card">
            <span className="customer-wallet-stat-icon sent">↑</span>
            <div>
              <h2>{formatAmount(sentTotal)}</h2>
              <p>Sent</p>
            </div>
            <span className="customer-wallet-stat-caption">Wallet debits · {customerCurrency}</span>
          </article>
          <article className="customer-wallet-card customer-wallet-stat-card">
            <span className="customer-wallet-stat-icon activity">↻</span>
            <div>
              <h2>{transactions.length.toLocaleString()}</h2>
              <p>Transactions</p>
            </div>
            <span className="customer-wallet-stat-caption">{cryptoWallets.length} crypto assets</span>
          </article>

          <article className="customer-wallet-card customer-wallet-details-card">
            <div className="customer-wallet-details-heading">
              <div>
                <span className="customer-wallet-eyebrow">ACCOUNT INFORMATION</span>
                <h2>Customer details</h2>
              </div>
              <span className="customer-wallet-customer-id">ID · {customer.id}</span>
            </div>
            <div className="customer-wallet-details-grid">
              <div><span>Email</span><strong>{customer.email || 'Not provided'}</strong></div>
              <div><span>Phone</span><strong>{customer.phone || 'Not provided'}</strong></div>
              <div><span>Wallet code</span><strong>{customer.wallet_code || 'Not assigned'}</strong></div>
              <div><span>Member since</span><strong>{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}</strong></div>
              <div><span>Address</span><strong>{customerAddress || 'Not provided'}</strong></div>
              <div><span>Date of birth</span><strong>{customer.date_of_birth ? new Date(customer.date_of_birth).toLocaleDateString() : 'Not provided'}</strong></div>
              <div><span>Nationality</span><strong>{customer.nationality || 'Not provided'}</strong></div>
              <div><span>ID document</span><strong>{customer.id_type || 'Not provided'}</strong></div>
              <div><span>ID number</span><strong>{maskedIdentityNumber}</strong></div>
              <div><span>ID expiry</span><strong>{customer.id_expiry ? new Date(customer.id_expiry).toLocaleDateString() : 'Not provided'}</strong></div>
              <div><span>Occupation</span><strong>{customer.occupation || 'Not provided'}</strong></div>
              <div><span>KYC status</span><strong>{customer.kyc_status || 'Not provided'}</strong></div>
            </div>
          </article>
        </section>

      {/* Main Navigation */}
      <div className="customer-wallet-tabs">
        <nav className="customer-wallet-tabs-inner">
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

      {/* Content */}
      <div className="customer-wallet-content">
        {/* PAYMENTS SECTION */}
        {activeSection === 'payments' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Payments</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              {/* Send Money */}
              <button
                type="button"
                onClick={() => setPaymentAction('send')}
                className="bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">📤</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Send Money</h3>
                <p className="text-sm text-gray-600">Transfer your balance to another customer wallet</p>
              </button>

              {/* Receive Money is unavailable until a payment-request or wallet-QR flow is implemented. */}
              <button
                type="button"
                disabled
                aria-describedby="receive-money-unavailable"
                className="bg-white rounded-xl p-6 border-2 border-gray-200 opacity-60 cursor-not-allowed text-left"
              >
                <div className="text-4xl mb-3">📥</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Receive Money</h3>
                <p id="receive-money-unavailable" className="text-sm text-gray-600">Unavailable — no payment request or wallet QR is generated.</p>
              </button>

              {/* Scan to Pay is unavailable until a scanner and payment handler are connected. */}
              <button
                type="button"
                disabled
                aria-describedby="scan-to-pay-unavailable"
                className="bg-white rounded-xl p-6 border-2 border-gray-200 opacity-60 cursor-not-allowed text-left"
              >
                <div className="text-4xl mb-3">📷</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Scan to Pay</h3>
                <p id="scan-to-pay-unavailable" className="text-sm text-gray-600">Unavailable — no QR scanner or merchant-payment handler is connected.</p>
              </button>

              {/* Payment Links is unavailable until a payment-link service is connected. */}
              <button
                type="button"
                disabled
                aria-describedby="payment-links-unavailable"
                className="bg-white rounded-xl p-6 border-2 border-gray-200 opacity-60 cursor-not-allowed text-left"
              >
                <div className="text-4xl mb-3">🔗</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Payment Links</h3>
                <p id="payment-links-unavailable" className="text-sm text-gray-600">Unavailable — no payment-link service is connected.</p>
              </button>

              <button
                type="button"
                onClick={() => setMerchantTransferOpen(true)}
                className="customer-wallet-merchant-action bg-white rounded-xl p-6 border-2 border-gray-200 hover:border-green-500 hover:shadow-lg transition text-left"
              >
                <div className="text-4xl mb-3">🏪</div>
                <h3 className="font-bold text-lg text-gray-900 mb-1">Send to Merchant</h3>
                <p className="text-sm text-gray-600">Transfer fiat with provider confirmation or move recorded crypto balance internally</p>
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
                      Amount ({customerCurrency})
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={form.amount}
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                      />
                    </div>
                    {form.amount && Number(form.amount) > Number(balance?.balance || 0) && (
                      <div className="mt-2 text-sm text-red-600">
                        Insufficient balance (Available: {formatAmount(Number(balance?.balance || 0))})
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
                          <span className="font-semibold text-gray-900">{formatAmount(Number(form.amount))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Transfer Fee:</span>
                          <span className="font-semibold text-green-600">{formatAmount(0)} (no fee)</span>
                        </div>
                        <div className="border-t border-blue-200 pt-1 mt-1"></div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Recipient Gets:</span>
                          <span className="font-bold text-blue-600 text-lg">{formatAmount(Number(form.amount))}</span>
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
                      disabled={loading || !form.recipient || !form.amount
                        || !Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0
                        || Math.abs(Number(form.amount) * 100 - Math.round(Number(form.amount) * 100)) > 1e-6
                        || Number(form.amount) > Number(balance?.balance || 0)}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg"
                    >
                      {loading ? '⏳ Sending...' : '💸 Send Money'}
                    </button>
                  </div>
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
                            {(txn.transaction_type || txn.type) === 'credit' ? '↓' : (txn.transaction_type || txn.type) === 'debit' ? '↑' : '⇄'}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{txn.source || 'Transaction'}</div>
                            <div className="text-sm text-gray-500">{new Date(txn.created_at).toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold ${
                            (txn.transaction_type || txn.type) === 'credit' ? 'text-green-600' :
                            (txn.transaction_type || txn.type) === 'debit' ? 'text-red-600' :
                            'text-blue-600'
                          }`}>
                            {(txn.transaction_type || txn.type) === 'credit' ? '+' : (txn.transaction_type || txn.type) === 'debit' ? '-' : ''}
                            ${Number(txn.fiat_amount ?? txn.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
      </main>

      {merchantTransferOpen && (
        <div className="customer-wallet-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !loading) {
            setMerchantTransferOpen(false);
            setProviderEndpoint('');
            setProviderApiKey('');
            setProviderRequestReference('');
          }
        }}>
          <section
            className="customer-wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-transfer-title"
          >
            <div className="customer-wallet-modal-heading">
              <div>
                <span className="customer-wallet-eyebrow">WALLET TRANSFER</span>
                <h2 id="merchant-transfer-title">Send to merchant wallet</h2>
                <p>Fiat uses a server-allowlisted provider endpoint and requires its SUCCESS response before posting the balance transfer. Crypto moves the recorded balance between internal ledgers; it does not send a blockchain transaction.</p>
              </div>
              <button
                type="button"
                className="customer-wallet-modal-close"
                aria-label="Close transfer dialog"
                disabled={loading}
                onClick={() => {
                  setMerchantTransferOpen(false);
                  setProviderEndpoint('');
                  setProviderApiKey('');
                  setProviderRequestReference('');
                }}
              >
                ×
              </button>
            </div>

            <form className="customer-wallet-transfer-form" onSubmit={handleSendToMerchant}>
              <label>
                Merchant ID
                <input
                  required
                  autoComplete="off"
                  placeholder="Enter merchant ID"
                  value={merchantTransfer.merchantId}
                  onChange={(event) => setMerchantTransfer({ ...merchantTransfer, merchantId: event.target.value })}
                />
              </label>
              <label>
                Asset type
                <select
                  value={merchantTransfer.assetType}
                  onChange={(event) => setMerchantTransfer({
                    ...merchantTransfer,
                    assetType: event.target.value as 'fiat' | 'crypto',
                    cryptoCoin: '',
                  })}
                >
                  <option value="fiat">Fiat wallet · {customerCurrency}</option>
                  <option value="crypto">Crypto balance · internal ledger transfer</option>
                </select>
              </label>
              {merchantTransfer.assetType === 'crypto' && (
                <label>
                  Crypto asset
                  <select
                    required
                    value={merchantTransfer.cryptoCoin}
                    onChange={(event) => setMerchantTransfer({ ...merchantTransfer, cryptoCoin: event.target.value })}
                  >
                    <option value="">Select asset</option>
                    {cryptoWallets.filter((wallet) => Number(wallet.balance) > 0).map((wallet) => (
                      <option key={wallet.id} value={wallet.crypto_coin}>
                        {wallet.crypto_coin} · {Number(wallet.balance).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {merchantTransfer.assetType === 'fiat' && (
                <>
                  <label>
                    Provider endpoint URL
                    <input
                      required
                      type="url"
                      autoComplete="url"
                      placeholder="https://provider.example.com/collect"
                      value={providerEndpoint}
                      onChange={(event) => setProviderEndpoint(event.target.value)}
                    />
                  </label>
                  <label>
                    Provider API key
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      placeholder="Enter provider API key"
                      value={providerApiKey}
                      onChange={(event) => setProviderApiKey(event.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Amount
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={merchantTransfer.amount}
                  onChange={(event) => setMerchantTransfer({ ...merchantTransfer, amount: event.target.value })}
                />
                <small>
                  Available: {merchantTransfer.assetType === 'fiat'
                    ? formatAmount(Number(balance?.balance || 0))
                    : `${Number(cryptoWallets.find((wallet) => wallet.crypto_coin.toUpperCase() === merchantTransfer.cryptoCoin.toUpperCase())?.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${merchantTransfer.cryptoCoin || 'asset'}`}
                </small>
              </label>
              <label>
                Note <span className="customer-wallet-optional">(optional)</span>
                <input
                  maxLength={200}
                  placeholder="Add a transfer note"
                  value={merchantTransfer.reason}
                  onChange={(event) => setMerchantTransfer({ ...merchantTransfer, reason: event.target.value })}
                />
              </label>
              <div className="customer-wallet-transfer-warning">
                {merchantTransfer.assetType === 'fiat'
                  ? 'The server requires the endpoint host to be allowlisted and a compatible provider API. The customer wallet amount is reserved during the request; only status SUCCESS posts the debit and merchant credit. The API key is not saved.'
                  : 'This immediately debits the recorded customer crypto balance and credits the merchant crypto ledger. No on-chain transaction is sent.'}
              </div>
              <div className="customer-wallet-modal-actions">
                <button
                  type="button"
                  className="customer-wallet-secondary-button"
                  disabled={loading}
                  onClick={() => {
                    setMerchantTransferOpen(false);
                    setProviderEndpoint('');
                    setProviderApiKey('');
                    setProviderRequestReference('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="customer-wallet-primary-button"
                  disabled={loading || !merchantTransfer.merchantId || !merchantTransfer.amount
                    || (merchantTransfer.assetType === 'crypto' && !merchantTransfer.cryptoCoin)
                    || (merchantTransfer.assetType === 'fiat' && (!providerEndpoint.trim() || !providerApiKey.trim()))}
                >
                  {loading ? 'Calling provider…' : merchantTransfer.assetType === 'fiat' ? 'CALL THE PROVIDER' : 'Confirm transfer'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
