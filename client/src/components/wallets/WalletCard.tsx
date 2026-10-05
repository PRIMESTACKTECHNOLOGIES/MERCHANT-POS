import React from 'react';
import './WalletCard.css';

interface WalletCardProps {
  holderName: string;
  walletCode?: string | null;
  walletId: string;
  currency: string;
  balance: number;
  balanceLabel?: string;
}

const maskWalletId = (walletId: string) => {
  const normalized = walletId.trim();
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)} **** **** ${normalized.slice(-4)}`;
};

const WalletCard: React.FC<WalletCardProps> = ({
  holderName,
  walletCode,
  walletId,
  currency,
  balance,
  balanceLabel = 'AVAILABLE BALANCE',
}) => (
  <section className="wallet-card-shell" aria-label={`${holderName}'s wallet card`}>
    <div className="wallet-card">
      <div className="wallet-card-topline">
        <span className="wallet-card-brand">PRIMESTACK</span>
        <span className="wallet-card-type">WALLET</span>
      </div>

      <div className="wallet-card-chip-row">
        <div className="wallet-card-chip" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="wallet-card-contactless" aria-label="Contactless wallet">)))</span>
      </div>

      <div className="wallet-card-number">{maskWalletId(walletCode || walletId)}</div>

      <div className="wallet-card-bottom">
        <div>
          <div className="wallet-card-label">CARD HOLDER</div>
          <div className="wallet-card-holder">{holderName || 'Wallet holder'}</div>
        </div>
        <div>
          <div className="wallet-card-label">{balanceLabel}</div>
          <div className="wallet-card-balance">
            {currency} {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
    <div className="wallet-card-meta">
      <span>Wallet ID: {walletId}</span>
      <span className="wallet-card-status">● Active</span>
    </div>
  </section>
);

export default WalletCard;
