import React from 'react';
import './ThermalReceipt.css';

interface ReceiptData {
  transactionId: string;
  transactionType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'CRYPTO_PURCHASE' | 'BANK_PAYOUT';
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  timestamp: string;
  status: string;
  
  // Optional fields based on transaction type
  cardNumber?: string;
  authCode?: string;
  merchantName?: string;
  merchantAddress?: string;
  cryptoAmount?: string;
  cryptoSymbol?: string;
  cryptoAddress?: string;
  cryptoNetwork?: string;
  txHash?: string;
  bankName?: string;
  accountNumber?: string;
  reference?: string;
  fromCustomer?: string;
  toCustomer?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  fee?: number;
}

interface ThermalReceiptProps {
  data: ReceiptData;
  onClose?: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({ data, onClose }) => {
  const handlePrint = () => {
    window.print();
  };

  const formatAmount = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const getTransactionTitle = () => {
    switch (data.transactionType) {
      case 'DEPOSIT':
        return 'CARD PAYMENT RECEIPT';
      case 'WITHDRAWAL':
        return 'WITHDRAWAL RECEIPT';
      case 'TRANSFER':
        return 'TRANSFER RECEIPT';
      case 'CRYPTO_PURCHASE':
        return 'CRYPTO PURCHASE RECEIPT';
      case 'BANK_PAYOUT':
        return 'BANK PAYOUT RECEIPT';
      default:
        return 'TRANSACTION RECEIPT';
    }
  };

  return (
    <div className="thermal-receipt-overlay">
      <div className="thermal-receipt-container">
        {/* Close button for screen view only */}
        <button className="receipt-close-btn no-print" onClick={onClose}>
          ✕
        </button>

        {/* Print button for screen view only */}
        <button className="receipt-print-btn no-print" onClick={handlePrint}>
          🖨️ Print Receipt
        </button>

        {/* Thermal Receipt Paper */}
        <div className="thermal-paper">
          {/* Header */}
          <div className="receipt-header">
            <div className="merchant-logo">
              <div className="logo-text">POS 2013</div>
              <div className="logo-subtitle">OFFLINE SYSTEM</div>
            </div>
            
            {data.merchantName && (
              <>
                <div className="merchant-name">{data.merchantName}</div>
                {data.merchantAddress && (
                  <div className="merchant-address">{data.merchantAddress}</div>
                )}
              </>
            )}
          </div>

          <div className="receipt-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

          {/* Transaction Title */}
          <div className="receipt-title">{getTransactionTitle()}</div>

          <div className="receipt-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

          {/* Transaction Details */}
          <div className="receipt-section">
            <div className="receipt-row">
              <span className="label">DATE/TIME:</span>
              <span className="value">{formatDate(data.timestamp)}</span>
            </div>
            <div className="receipt-row">
              <span className="label">TRANSACTION ID:</span>
            </div>
            <div className="receipt-row centered">
              <span className="value mono">{data.transactionId}</span>
            </div>
            <div className="receipt-row">
              <span className="label">TYPE:</span>
              <span className="value">{data.transactionType}</span>
            </div>
            <div className="receipt-row">
              <span className="label">STATUS:</span>
              <span className="value status-success">{data.status}</span>
            </div>
          </div>

          <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>

          {/* Customer Information */}
          <div className="receipt-section">
            <div className="receipt-section-title">CUSTOMER INFORMATION</div>
            <div className="receipt-row">
              <span className="label">NAME:</span>
            </div>
            <div className="receipt-row">
              <span className="value">{data.customerName}</span>
            </div>
            <div className="receipt-row">
              <span className="label">EMAIL:</span>
            </div>
            <div className="receipt-row">
              <span className="value">{data.customerEmail}</span>
            </div>
          </div>

          <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>

          {/* Card Payment Details */}
          {(data.transactionType === 'DEPOSIT' && data.cardNumber) && (
            <>
              <div className="receipt-section">
                <div className="receipt-section-title">PAYMENT DETAILS</div>
                <div className="receipt-row">
                  <span className="label">CARD NUMBER:</span>
                  <span className="value">{data.cardNumber}</span>
                </div>
                {data.authCode && (
                  <div className="receipt-row">
                    <span className="label">AUTH CODE:</span>
                    <span className="value mono">{data.authCode}</span>
                  </div>
                )}
              </div>
              <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>
            </>
          )}

          {/* Crypto Details */}
          {data.transactionType === 'CRYPTO_PURCHASE' && (
            <>
              <div className="receipt-section">
                <div className="receipt-section-title">CRYPTO DETAILS</div>
                <div className="receipt-row">
                  <span className="label">CRYPTO:</span>
                  <span className="value">{data.cryptoSymbol}</span>
                </div>
                <div className="receipt-row">
                  <span className="label">AMOUNT:</span>
                  <span className="value">{data.cryptoAmount}</span>
                </div>
                <div className="receipt-row">
                  <span className="label">NETWORK:</span>
                  <span className="value">{data.cryptoNetwork}</span>
                </div>
                {data.cryptoAddress && (
                  <>
                    <div className="receipt-row">
                      <span className="label">TO ADDRESS:</span>
                    </div>
                    <div className="receipt-row centered mono">
                      <span className="value crypto-address">{data.cryptoAddress}</span>
                    </div>
                  </>
                )}
                {data.txHash && (
                  <>
                    <div className="receipt-row">
                      <span className="label">TX HASH:</span>
                    </div>
                    <div className="receipt-row centered mono">
                      <span className="value crypto-hash">{data.txHash}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>
            </>
          )}

          {/* Bank Payout Details */}
          {data.transactionType === 'BANK_PAYOUT' && (
            <>
              <div className="receipt-section">
                <div className="receipt-section-title">BANK DETAILS</div>
                <div className="receipt-row">
                  <span className="label">BANK:</span>
                  <span className="value">{data.bankName}</span>
                </div>
                <div className="receipt-row">
                  <span className="label">ACCOUNT:</span>
                  <span className="value">{data.accountNumber}</span>
                </div>
                {data.reference && (
                  <div className="receipt-row">
                    <span className="label">REFERENCE:</span>
                    <span className="value">{data.reference}</span>
                  </div>
                )}
              </div>
              <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>
            </>
          )}

          {/* Transfer Details */}
          {data.transactionType === 'TRANSFER' && (
            <>
              <div className="receipt-section">
                <div className="receipt-section-title">TRANSFER DETAILS</div>
                {data.fromCustomer && (
                  <div className="receipt-row">
                    <span className="label">FROM:</span>
                    <span className="value">{data.fromCustomer}</span>
                  </div>
                )}
                {data.toCustomer && (
                  <div className="receipt-row">
                    <span className="label">TO:</span>
                    <span className="value">{data.toCustomer}</span>
                  </div>
                )}
              </div>
              <div className="receipt-divider-thin">- - - - - - - - - - - - - - - -</div>
            </>
          )}

          {/* Amount Section */}
          <div className="receipt-section">
            <div className="receipt-section-title">AMOUNT DETAILS</div>
            
            {data.balanceBefore !== undefined && (
              <div className="receipt-row">
                <span className="label">BALANCE BEFORE:</span>
                <span className="value">{formatAmount(data.balanceBefore, data.currency)}</span>
              </div>
            )}
            
            <div className="receipt-row amount-row">
              <span className="label">AMOUNT:</span>
              <span className="value amount">{formatAmount(data.amount, data.currency)}</span>
            </div>
            
            {data.fee !== undefined && data.fee > 0 && (
              <div className="receipt-row">
                <span className="label">FEE:</span>
                <span className="value">{formatAmount(data.fee, data.currency)}</span>
              </div>
            )}
            
            {data.balanceAfter !== undefined && (
              <div className="receipt-row">
                <span className="label">BALANCE AFTER:</span>
                <span className="value">{formatAmount(data.balanceAfter, data.currency)}</span>
              </div>
            )}
          </div>

          <div className="receipt-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

          {/* Total Section */}
          <div className="receipt-total">
            <div className="total-label">TOTAL AMOUNT</div>
            <div className="total-amount">{formatAmount(data.amount, data.currency)}</div>
          </div>

          <div className="receipt-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

          {/* Footer */}
          <div className="receipt-footer">
            <div className="footer-text">TRANSACTION APPROVED</div>
            <div className="footer-text">THANK YOU FOR YOUR BUSINESS</div>
            <div className="footer-spacer"></div>
            <div className="footer-text small">This is a computer generated receipt</div>
            <div className="footer-text small">No signature required</div>
            <div className="footer-spacer"></div>
            <div className="footer-text small">For support:</div>
            <div className="footer-text small">Email: support@pos2013.com</div>
            <div className="footer-text small">Phone: +27 60 728 9532</div>
            <div className="footer-spacer"></div>
            <div className="footer-barcode">
              <div className="barcode">
                |||  ||  |  ||  |||  |  ||  |  |||  ||  |  ||
              </div>
              <div className="barcode-number">{data.transactionId.slice(0, 12)}</div>
            </div>
            <div className="footer-spacer"></div>
            <div className="footer-text small">Powered by POS 2013 Offline System</div>
          </div>

          {/* Paper tear line */}
          <div className="paper-tear">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - ✂</div>
        </div>
      </div>
    </div>
  );
};

export default ThermalReceipt;
