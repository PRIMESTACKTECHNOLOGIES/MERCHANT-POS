import React, { useState } from 'react';
import './VaultWalletCard.css';
import type { IssuedVirtualCard } from '../../lib/api';

interface VaultWalletCardProps {
  card: IssuedVirtualCard;
  holderName: string;
  revealed: boolean;
  busy?: boolean;
  onReveal: () => void;
}

const formatMaskedPan = (card: IssuedVirtualCard) => {
  if (card.cardNumber) {
    return card.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  const bin = card.bin || '416598';
  const last4 = card.last4 || '••••';
  return `${bin.slice(0, 4)} ${bin.slice(4)}•• •••• ${last4}`;
};

export default function VaultWalletCard({
  card,
  holderName,
  revealed,
  busy = false,
  onReveal,
}: VaultWalletCardProps) {
  const [showBack, setShowBack] = useState(false);
  const displayName = (card.cardholderName || holderName || 'WALLET HOLDER').toUpperCase();
  const expiry = card.expiry || '••/••';
  const cvv = revealed && card.cvv ? card.cvv : '•••';

  return (
    <div className="vault-wallet-card-wrap">
      <div className={`vault-wallet-card-stage${showBack ? ' is-back' : ''}`}>
        <section className="vault-wallet-card vault-wallet-card-front" aria-label="Vault Bank wallet card front">
          <div className="vault-card-logo">VAULT BANK</div>
          <div className="vault-card-nfc" aria-hidden="true"><span /><span /><span /></div>
          <div className="vault-card-chip" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="vault-card-number">{formatMaskedPan(card)}</div>
          <div className="vault-card-row vault-card-label-row">
            <span>CARDHOLDER</span>
            <span>EXP</span>
          </div>
          <div className="vault-card-row vault-card-value-row">
            <strong>{displayName}</strong>
            <strong>{expiry}</strong>
          </div>
          <div className="vault-card-hologram"><span>EXP</span></div>
          <div className="vault-card-visa">VISA</div>
        </section>

        <section className="vault-wallet-card vault-wallet-card-back" aria-label="Vault Bank wallet card back">
          <div className="vault-card-strip" />
          <div className="vault-card-signature">
            <span>{displayName}</span>
            <strong>CVV {cvv}</strong>
          </div>
          <div className="vault-card-operator">SANDBOX WALLET CARD · {card.currency}</div>
        </section>
      </div>

      <div className="vault-wallet-card-actions">
        <button type="button" onClick={() => setShowBack(value => !value)}>
          {showBack ? 'Show front' : 'Show back'}
        </button>
        <button type="button" onClick={onReveal} disabled={busy}>
          {revealed ? 'Hide details' : busy ? 'Loading…' : 'Reveal sandbox details'}
        </button>
      </div>
    </div>
  );
}
