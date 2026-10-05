import { useState } from "react";
import "./VaultBankCard.css";

type VaultBankCardProps = {
  holderName?: string;
  maskedPan?: string;
  expiry?: string;
  cvv?: string;
  revealedDetails?: {
    cardNumber: string;
    expiry: string;
    cvv: string;
    cardholderName?: string;
  } | null;
  detailsBusy?: boolean;
  detailsError?: string;
  onLoadDetails?: () => void;
  currency?: "USD" | "EUR";
  metal?: "silver" | "gold";
};

const VISA_LOGO = "/visa-logo.png";

export default function VaultBankCard({
  holderName = "AJI ALOSIOUS",
  maskedPan = "4165 98•• •••• 9610",
  expiry = "05/30",
  cvv = "•••",
  revealedDetails = null,
  detailsBusy = false,
  detailsError = "",
  onLoadDetails,
  currency = "USD",
  metal = "silver",
}: VaultBankCardProps) {
  const [showBack, setShowBack] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <section className={`vault-bank-card-panel vault-bank-card-panel-${metal}`} aria-label={`${currency} Vault Bank card`}>
      <div className="vault-bank-card-heading">
        <div>
          <p className="vault-bank-card-kicker">Vault Bank</p>
          <h2>Corporate card · {currency}</h2>
        </div>
        <div className="vault-bank-card-controls">
          <button
            type="button"
            className={`vault-bank-card-switch${showBack ? " is-active" : ""}`}
            onClick={() => setShowBack((value) => !value)}
            aria-pressed={showBack}
          >
            <span className="vault-bank-card-switch-track"><span /></span>
            <span>{showBack ? "Back" : "Front"}</span>
          </button>
          <button
            type="button"
            className={`vault-bank-card-switch${showDetails ? " is-active" : ""}`}
            onClick={() => {
              const next = !showDetails;
              setShowDetails(next);
              if (next && !revealedDetails) onLoadDetails?.();
            }}
            aria-pressed={showDetails}
          >
            <span className="vault-bank-card-switch-track"><span /></span>
            <span>Details</span>
          </button>
        </div>
      </div>

      <div className={`vault-bank-card-stage${showBack ? " is-back" : ""}`}>
        <div className="vault-bank-card-face vault-bank-card-front">
          <div className="vault-bank-card-sheen" />
          <div className="vault-bank-card-top">
            <span className="vault-bank-card-brand">VAULT BANK</span>
            <span className="vault-bank-card-contactless" aria-label="Contactless">
              <i /><i /><i />
            </span>
          </div>
          <div className="vault-bank-card-chip" aria-label="EMV chip">
            <span /><span /><span /><span /><span />
          </div>
          <div className="vault-bank-card-pan">{maskedPan}</div>
          <div className="vault-bank-card-bottom">
            <div>
              <span className="vault-bank-card-label">CARDHOLDER</span>
              <strong>{holderName}</strong>
            </div>
            <div>
              <span className="vault-bank-card-label">VALID THRU</span>
              <strong>{expiry}</strong>
            </div>
          </div>
          <img className="vault-bank-card-visa" src={VISA_LOGO} alt="Visa" />
        </div>

        <div className="vault-bank-card-face vault-bank-card-back">
          <div className="vault-bank-card-sheen" />
          <div className="vault-bank-card-magstripe" />
          <div className="vault-bank-card-signature-row">
            <div className="vault-bank-card-signature"><span>{holderName}</span></div>
            <button type="button" className="vault-bank-card-cvv" onClick={() => setShowCvv((value) => !value)}>
              <span>CVV</span>
              <strong>{showCvv ? cvv : "•••"}</strong>
            </button>
          </div>
          <img className="vault-bank-card-visa vault-bank-card-visa-back" src={VISA_LOGO} alt="Visa" />
        </div>
      </div>
      {showDetails && (
        <div className="vault-bank-card-details" aria-label="Vault Bank card details">
          <div><span>Cardholder</span><strong>{revealedDetails?.cardholderName || holderName}</strong></div>
          <div><span>Card number</span><strong>{detailsBusy ? "Loading…" : revealedDetails?.cardNumber || maskedPan}</strong></div>
          <div><span>Valid thru</span><strong>{revealedDetails?.expiry || expiry}</strong></div>
          <div><span>CVV</span><strong>{detailsBusy ? "Loading…" : revealedDetails?.cvv || cvv}</strong></div>
          <div><span>Currency</span><strong>{currency}</strong></div>
          {detailsError && <p className="vault-bank-card-details-error">{detailsError}</p>}
        </div>
      )}
      <p className="vault-bank-card-hint">Select the switch to view the reverse. Select CVV on the reverse to reveal or hide it.</p>
    </section>
  );
}
