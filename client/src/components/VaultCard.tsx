import { useState } from "react";
import "./VaultCard.css";

type VaultCardProps = {
  currency?: string;
};

export default function VaultCard({ currency = "USD" }: VaultCardProps) {
  const [showBack, setShowBack] = useState(false);
  const isEur = currency.toUpperCase() === "EUR";
  const folder = encodeURIComponent(isEur ? "SECOND CARD EUR" : "FIRST CARD USD");
  const front = encodeURIComponent(isEur ? "SECOND CARD FRONT SIDE.png" : "CARD FRONT SIDE.png");
  const back = encodeURIComponent(isEur ? "SECOND CARD BACK SIDE.png" : "CARD BACKSIDE.png");
  const asset = `http://${window.location.hostname}:7000/coins/cards/${folder}/${showBack ? back : front}`;

  return (
    <div className="vault-card">
      <img
        className="vault-card-art"
        src={asset}
        alt={`${currency} Vault Bank card ${showBack ? "back" : "front"}`}
      />
      <button
        type="button"
        className="vault-card-toggle"
        onClick={() => setShowBack((value) => !value)}
        aria-label={showBack ? "Show front of card" : "Show back of card"}
      >
        {showBack ? "Show front" : "Show back"}
      </button>
    </div>
  );
}
