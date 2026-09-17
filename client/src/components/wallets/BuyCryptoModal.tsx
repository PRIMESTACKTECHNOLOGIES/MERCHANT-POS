import React, { useState, useEffect } from 'react';
import './BuyCryptoModal.css';

interface BuyCryptoModalProps {
  customerId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (orderId: string) => void;
  onError?: (error: string) => void;
}

interface BuyCryptoFormData {
  amount_usd: number;
  crypto_currency: string;
  network: string;
  payment_method: 'transak' | 'wallet_balance' | 'binance_direct';
}

const BuyCryptoModal: React.FC<BuyCryptoModalProps> = ({
  customerId,
  isOpen,
  onClose,
  onSuccess,
  onError,
}) => {
  const [formData, setFormData] = useState<BuyCryptoFormData>({
    amount_usd: 100,
    crypto_currency: 'USDT',
    network: 'tron',
    payment_method: 'binance_direct',
  });

  const [loading, setLoading] = useState(false);
  const [transakUrl, setTransakUrl] = useState<string>('');
  const [orderId, setOrderId] = useState<string>('');
  const [result, setResult] = useState<{ cryptoAmount?: number; cryptoCoin?: string; orderId?: string; provider?: string } | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/crypto/crypto-price/${formData.crypto_currency}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.price && json.price > 0) setLivePrice(Number(json.price));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [formData.crypto_currency]);

  const cryptoOptions = [
    { label: 'USDT (Tether)', value: 'USDT', networks: ['tron', 'ethereum', 'bsc', 'polygon'] },
    { label: 'BTC (Bitcoin)', value: 'BTC', networks: ['bitcoin'] },
    { label: 'ETH (Ethereum)', value: 'ETH', networks: ['ethereum'] },
    { label: 'SOL (Solana)', value: 'SOL', networks: ['solana'] },
    { label: 'BNB (Binance Coin)', value: 'BNB', networks: ['bsc'] },
  ];

  const selectedCrypto = cryptoOptions.find(c => c.value === formData.crypto_currency);
  const availableNetworks = selectedCrypto?.networks || [];

  const handleInputChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value };

    // Reset network if it's not available for selected crypto
    if (field === 'crypto_currency' && !availableNetworks.includes(newFormData.network)) {
      newFormData.network = availableNetworks[0] || 'tron';
    }

    setFormData(newFormData);
  };

  const handleInitiateBuy = async () => {
    if (!formData.amount_usd || formData.amount_usd < 10) {
      onError?.('Minimum purchase is $10');
      return;
    }

    setLoading(true);
    try {
      if (formData.payment_method === 'binance_direct') {
        const response = await fetch(`/api/crypto/buy-crypto/binance-direct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({
            customerId,
            cryptoCoin: formData.crypto_currency,
            fiatAmount: formData.amount_usd,
            network: formData.network,
            currency: 'USD',
          }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Binance purchase failed' }));
          throw new Error(err?.error || 'Binance purchase rejected');
        }
        const r = await response.json();
        setResult({
          cryptoAmount: Number(r.cryptoAmount || r.executed_qty || 0),
          cryptoCoin: r.cryptoCoin || formData.crypto_currency,
          orderId: r.binanceOrderId || r.orderId || r.order_id || '',
          provider: 'binance',
        });
        setOrderId(r.binanceOrderId || r.orderId || r.order_id || '');
        onSuccess?.(r.binanceOrderId || r.orderId || '');
        return;
      }

      if (formData.payment_method === 'wallet_balance') {
        const response = await fetch(`/api/crypto/buy-crypto`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({
            customerId,
            cryptoCoin: formData.crypto_currency,
            fiatAmount: formData.amount_usd,
            network: formData.network,
            currency: 'USD',
          }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Wallet purchase failed' }));
          throw new Error(err?.error || 'Wallet balance purchase rejected');
        }
        const r = await response.json();
        setResult({
          cryptoAmount: Number(r.cryptoAmount || 0),
          cryptoCoin: r.cryptoCoin || formData.crypto_currency,
          orderId: r.binanceOrderId || r.exchangeOrderId || '',
          provider: r.providerMode || 'wallet',
        });
        setOrderId(r.binanceOrderId || r.exchangeOrderId || '');
        onSuccess?.(r.binanceOrderId || r.exchangeOrderId || '');
        return;
      }

      // ── Transak (external on-ramp widget) ────────────────────────────────
      const response = await fetch(`/api/crypto/wallets/${customerId}/buy-crypto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate purchase');
      }

      const result = await response.json();

      if (result.success && result.transak_url) {
        setOrderId(result.order_id);
        setTransakUrl(result.transak_url);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error('Failed to initiate buy crypto:', err);
      onError?.(err.message || 'Failed to initiate purchase');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const effectivePrice = formData.crypto_currency === 'USDT' ? 1.0 : (livePrice ?? 1.0);
  const estReceive = (formData.amount_usd / Math.max(effectivePrice, 1e-9)).toFixed(8);

  const hasExternalWidget = !!transakUrl;
  const hasDirectResult = !!result && !hasExternalWidget;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content buy-crypto-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Buy Crypto</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {hasExternalWidget ? (
          <div className="modal-body transak-payment">
            <div className="success-icon">✓</div>
            <h3>Payment in Progress</h3>
            <p>Complete your purchase on Transak</p>
            <a
              href={transakUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary btn-open-transak"
            >
              Open Transak →
            </a>
            <p className="order-id">Order ID: {orderId}</p>
            <div className="info-box">
              <p>
                📝 You can close this window. We'll notify you when your purchase is complete.
              </p>
            </div>
          </div>
        ) : hasDirectResult ? (
          <div className="modal-body transak-payment">
            <div className="success-icon" style={{ background: '#F3BA2F', color: '#111' }}>✓</div>
            <h3>Purchase Complete — {result.provider === 'binance' ? 'Binance Spot' : 'Wallet'}</h3>
            <p>
              Received <strong>{Number(result.cryptoAmount).toFixed(8)} {result.cryptoCoin}</strong>
            </p>
            {result.orderId ? <p className="order-id">Order ID: {result.orderId}</p> : null}
            <div className="info-box">
              <p>
                🔐 Your crypto balance has been credited. You can view holdings in the Crypto Wallet tab.
              </p>
            </div>
            <div className="modal-footer" style={{ marginTop: '16px', flexDirection: 'column', gap: '8px' }}>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="form-group">
              <label>Amount (USD)</label>
              <div className="amount-input">
                <input
                  type="number"
                  min="10"
                  step="1"
                  value={formData.amount_usd}
                  onChange={(e) => handleInputChange('amount_usd', parseFloat(e.target.value))}
                  placeholder="Enter amount in USD"
                  disabled={loading}
                />
                <span className="currency">USD</span>
              </div>
              <small>Minimum: $10</small>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Crypto</label>
                <select
                  value={formData.crypto_currency}
                  onChange={(e) => handleInputChange('crypto_currency', e.target.value)}
                  disabled={loading}
                >
                  {cryptoOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Network</label>
                <select
                  value={formData.network}
                  onChange={(e) => handleInputChange('network', e.target.value)}
                  disabled={loading}
                >
                  {availableNetworks.map((net) => (
                    <option key={net} value={net}>
                      {net.charAt(0).toUpperCase() + net.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Payment Method</label>
              <div className="payment-methods">
                <label className="payment-option">
                  <input
                    type="radio"
                    value="binance_direct"
                    checked={formData.payment_method === 'binance_direct'}
                    onChange={(e) => handleInputChange('payment_method', e.target.value)}
                    disabled={loading}
                  />
                  <span>🛒 Binance Direct</span>
                  <small>Best liquidity · Instant spot market · Debits USD wallet</small>
                </label>
                <label className="payment-option">
                  <input
                    type="radio"
                    value="wallet_balance"
                    checked={formData.payment_method === 'wallet_balance'}
                    onChange={(e) => handleInputChange('payment_method', e.target.value)}
                    disabled={loading}
                  />
                  <span>Pay from Wallet</span>
                  <small>Instant USD debit · Best-effort exchange provider</small>
                </label>
                <label className="payment-option">
                  <input
                    type="radio"
                    value="transak"
                    checked={formData.payment_method === 'transak'}
                    onChange={(e) => handleInputChange('payment_method', e.target.value)}
                    disabled={loading}
                  />
                  <span>Pay with Transak</span>
                  <small>Google Pay, Credit Card, Bank Transfer · External widget</small>
                </label>
              </div>
            </div>

            <div className="info-box">
              <p>
                💡 You'll receive approximately{' '}
                <strong>{estReceive} {formData.crypto_currency}</strong>
                {livePrice && formData.crypto_currency !== 'USDT' ? (
                  <> (market rate: <strong>${livePrice.toFixed(2)}/{formData.crypto_currency}</strong>)</>
                ) : formData.crypto_currency === 'USDT' ? (
                  <> (stablecoin 1:1 peg)</>
                ) : null}
              </p>
              <p style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                Final amount executed via Binance may differ slightly due to market slippage.
              </p>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleInitiateBuy}
                disabled={loading}
              >
                {loading ? 'Processing...' :
                 formData.payment_method === 'binance_direct' ? 'Buy via Binance' :
                 formData.payment_method === 'wallet_balance' ? 'Buy with Wallet' : 'Continue'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BuyCryptoModal;
